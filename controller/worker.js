/* Telegram → calendar controller.
   Cloudflare Worker. Deployed separately from the site; the site itself stays
   a folder of static files with no server-side anything.

   Telegram posts an inbound message here. If the webhook secret checks out and
   the sender is on the allowlist, the message is parsed into an event, written
   into data/events.json, rendered into calendar.html, and both are committed
   in one commit. The site redeploys. Joshy gets a reply saying what changed.

   Secrets (wrangler secret put …): TELEGRAM_TOKEN, TELEGRAM_SECRET,
   GITHUB_TOKEN. See README.md.
*/

import { parseCommand, helpText, todayInBrisbane } from "./parse.mjs";
import { patchCalendar, sortEvents, formatDate, formatRange, endDate } from "../tools/render-events.mjs";
import { repoClient } from "./github.mjs";

const API = "https://api.telegram.org";

/* --- Telegram plumbing -------------------------------------------------- */

/**
 * Telegram echoes back the secret given to setWebhook, in a header. Unlike
 * Meta there is no signature over the body, so this token and the allowlist
 * are the entire gate — which is why the allowlist is checked separately
 * below rather than being treated as a formality.
 */
export function tokenValid(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;

  // Constant-time: compare every byte regardless of where they diverge.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Replies are plain text on purpose. Telegram's markdown modes require
 * escaping that varies by mode, and a stray character in a venue name would
 * either break the formatting or fail the send outright. The same strings go
 * into commit messages, where entities would just be noise.
 */
async function reply(env, chatId, body) {
  const res = await fetch(`${API}/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: body.slice(0, 4000),
      link_preview_options: { is_disabled: true },
    }),
  });
  // Never log the response URL: the bot token is in the path.
  if (!res.ok) console.error("reply failed", res.status, (await res.text()).slice(0, 300));
}

/**
 * Telegram clients send commands as /list, /help, and a first-run /start,
 * optionally suffixed with the bot's name. Strip that so the parser sees the
 * same words it would get from any other source.
 */
export function normalise(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return trimmed;
  const stripped = trimmed.slice(1).replace(/^([A-Za-z_]+)@\w+/, "$1");
  return /^start\b/i.test(stripped) ? "help" : stripped;
}

/* --- presentation ------------------------------------------------------- */

const describe = (e) => {
  // Same rule the page uses, so the reply is never a different claim.
  const when = e.display || (e.until && e.date && formatRange(e.date, e.until)) ||
               formatDate(e.date) || "TBA";
  const bits = [e.where, e.role, e.time, e.details].filter(Boolean);
  return `${when} — ${e.title}${bits.length ? `\n   ${bits.join(" · ")}` : ""}`;
};

export function listText(events, today) {
  if (!events.length) return "Nothing in the calendar right now. Send \"help\" to add something.";
  return sortEvents(events)
    .map((e, i) => {
      const end = endDate(e);
      const past = end && end < today ? "  (past)" : "";
      return `${i + 1}. ${describe(e)}${past}`;
    })
    .join("\n\n");
}

/* --- the actual work ---------------------------------------------------- */

/** Applies one command against a fresh read of the repo. Returns the reply
    text, and the files to commit if anything changed. */
export function apply(command, events, today) {
  if (command.cmd === "help") return { text: helpText() };
  if (command.cmd === "error") return { text: command.message };
  if (command.cmd === "list") return { text: listText(events, today) };

  const ordered = sortEvents(events);
  const next = [...events];
  let text;

  if (command.cmd === "add") {
    const clash = events.find(
      (e) => e.title?.toLowerCase() === command.event.title.toLowerCase() &&
             (e.date || e.sort) === (command.event.date || command.event.sort)
    );
    // Telegram retries any delivery it does not get a prompt 200 for; without
    // this, one message could land twice.
    if (clash) return { text: `That one's already up:\n\n${describe(clash)}` };

    next.push(command.event);
    text = `Added:\n\n${describe(command.event)}\n\nLive in a minute or two.`;
  } else {
    const target = ordered[command.index - 1];
    if (!target) {
      return { text: `There's no ${command.index}. Send "list" to see the numbers.` };
    }
    const at = next.indexOf(target);

    if (command.cmd === "remove") {
      next.splice(at, 1);
      text = `Removed:\n\n${describe(target)}`;
    } else {
      const updated = { ...target, ...command.event };
      // A new date line replaces the old one whole. Anything the previous one
      // left behind — the ordering hint, the wording shown in its place, the
      // end of a run that is no longer a run — would otherwise outlive it and
      // keep being shown, since the page prefers all three over the date.
      // Wording Joshy sets himself in the same message is his own and stays.
      if (command.event.date) {
        delete updated.sort;
        if (!command.event.display) delete updated.display;
        if (!command.event.until) delete updated.until;
      }
      if (command.event.sort) {
        // Words order the entry but assert nothing, so the machine-readable
        // claim they replace has to come down with it.
        delete updated.date;
        if (!command.event.until) delete updated.until;
      }
      next[at] = updated;
      text = `Updated:\n\n${describe(updated)}`;
    }
  }

  if (command.warnings?.length) text += `\n\n${command.warnings.join("\n")}`;
  return { text, events: next };
}

async function handleMessage(env, chatId, body) {
  const today = todayInBrisbane();
  const command = parseCommand(normalise(body), today);

  // Read-only commands never touch the repo.
  if (command.cmd === "help" || command.cmd === "error") {
    return reply(env, chatId, apply(command, [], today).text);
  }

  const repo = repoClient(env);

  // One retry: if someone else pushed between our read and our write, GitHub
  // rejects the non-fast-forward and we redo the edit on top of their commit.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { headSha, events, calendar } = await repo.read();
    const result = apply(command, events, today);

    if (!result.events) return reply(env, chatId, result.text);

    const json = `${JSON.stringify(result.events, null, 2)}\n`;
    try {
      await repo.commit({
        headSha,
        files: {
          "data/events.json": json,
          "public/calendar.html": patchCalendar(calendar, result.events),
        },
        message: `Calendar: ${command.cmd} via Telegram\n\n${result.text.split("\n")[2] || ""}`.trim(),
      });
      return reply(env, chatId, result.text);
    } catch (err) {
      if (attempt === 1) throw err;
      console.warn("commit raced, retrying", err.message);
    }
  }
}

/* --- entry point -------------------------------------------------------- */

export default {
  async fetch(request, env, ctx) {
    // Telegram only ever POSTs. There is no subscription handshake to answer:
    // the webhook is registered once, out of band, with a setWebhook call.
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    if (!tokenValid(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_SECRET)) {
      return new Response("bad token", { status: 401 });
    }

    let update;
    try { update = await request.json(); } catch { return new Response("bad json", { status: 400 }); }

    // Edits and channel posts are ignored: only a plain new message counts.
    const msg = update.message;
    if (msg?.text && msg.from && msg.chat) {
      const allowed = (env.ALLOWED_USERS || "")
        .split(",").map((s) => s.trim()).filter(Boolean);

      if (allowed.includes(String(msg.from.id))) {
        // Acknowledge quickly or Telegram redelivers the whole update.
        ctx.waitUntil(
          handleMessage(env, msg.chat.id, msg.text).catch(async (err) => {
            console.error(err);
            await reply(env, msg.chat.id,
              "Something went wrong on my end and nothing was changed. Try again in a moment.");
          })
        );
      } else {
        // Anyone who finds the bot can message it, so this is a real gate and
        // not a formality. Logged so a new controller's id can be read out of
        // `wrangler tail` and added to ALLOWED_USERS.
        console.warn("rejected sender", msg.from.id, msg.from.username || "(no username)");
      }
    }

    return new Response("ok", { status: 200 });
  },
};
