/* WhatsApp → calendar controller.
   Cloudflare Worker. Deployed separately from the site; the site itself stays
   a folder of static files with no server-side anything.

   Meta posts an inbound message here. If the signature checks out and the
   sender is on the allowlist, the message is parsed into an event, written
   into data/events.json, rendered into calendar.html, and both are committed
   in one commit. Pages redeploys. Joshy gets a reply saying what changed.

   Secrets (wrangler secret put …): META_APP_SECRET, META_TOKEN,
   META_VERIFY_TOKEN, GITHUB_TOKEN. See README.md.
*/

import { parseCommand, helpText, todayInBrisbane } from "./parse.mjs";
import { patchCalendar, sortEvents, formatDate, endDate } from "../tools/render-events.mjs";
import { repoClient } from "./github.mjs";

const GRAPH = "https://graph.facebook.com/v21.0";

/* --- Meta plumbing ------------------------------------------------------ */

/** Meta signs the raw body with the app secret. Verified before the JSON is
    even parsed, so an unsigned payload never reaches the parser. */
async function signatureValid(raw, header, secret) {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);

  // Constant-time: compare every byte regardless of where they diverge.
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function reply(env, to, body) {
  const res = await fetch(`${GRAPH}/${env.META_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) },
    }),
  });
  if (!res.ok) console.error("reply failed", res.status, (await res.text()).slice(0, 300));
}

/* --- presentation ------------------------------------------------------- */

const describe = (e) => {
  const when = e.display || formatDate(e.date) || "TBA";
  const bits = [e.where, e.role, e.details].filter(Boolean);
  return `${when} — ${e.title}${bits.length ? `\n   ${bits.join(" · ")}` : ""}`;
};

export function listText(events, today) {
  if (!events.length) return "Nothing in the calendar right now. Send \"help\" to add something.";
  return sortEvents(events)
    .map((e, i) => {
      const end = endDate(e);
      const past = end && end < today ? "  (past)" : "";
      return `*${i + 1}.* ${describe(e)}${past}`;
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
    // Meta retries webhooks it thinks failed; without this, one message could
    // land twice.
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
      // A changed date invalidates an unconfirmed-date entry's ordering hint.
      if (command.event.date) delete updated.sort;
      next[at] = updated;
      text = `Updated:\n\n${describe(updated)}`;
    }
  }

  if (command.warnings?.length) text += `\n\n${command.warnings.join("\n")}`;
  return { text, events: next };
}

async function handleMessage(env, from, body) {
  const today = todayInBrisbane();
  const command = parseCommand(body, today);

  // Read-only commands never touch the repo.
  if (command.cmd === "help" || command.cmd === "error") {
    return reply(env, from, apply(command, [], today).text);
  }

  const repo = repoClient(env);

  // One retry: if someone else pushed between our read and our write, GitHub
  // rejects the non-fast-forward and we redo the edit on top of their commit.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { headSha, events, calendar } = await repo.read();
    const result = apply(command, events, today);

    if (!result.events) return reply(env, from, result.text);

    const json = `${JSON.stringify(result.events, null, 2)}\n`;
    try {
      await repo.commit({
        headSha,
        files: {
          "data/events.json": json,
          "public/calendar.html": patchCalendar(calendar, result.events),
        },
        message: `Calendar: ${command.cmd} via WhatsApp\n\n${result.text.split("\n")[2] || ""}`.trim(),
      });
      return reply(env, from, result.text);
    } catch (err) {
      if (attempt === 1) throw err;
      console.warn("commit raced, retrying", err.message);
    }
  }
}

/* --- entry point -------------------------------------------------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Meta's one-time subscription handshake.
    if (request.method === "GET") {
      const p = url.searchParams;
      if (p.get("hub.mode") === "subscribe" &&
          p.get("hub.verify_token") === env.META_VERIFY_TOKEN) {
        return new Response(p.get("hub.challenge"), { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    }

    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    const raw = await request.text();
    if (!(await signatureValid(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET))) {
      return new Response("bad signature", { status: 401 });
    }

    let payload;
    try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

    const allowed = (env.ALLOWED_NUMBERS || "")
      .split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean);

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        for (const msg of change.value?.messages || []) {
          if (msg.type !== "text") continue;
          // Second gate. A valid signature only proves Meta sent it, not who
          // wrote it — anyone who finds the number could message the bot.
          if (!allowed.includes(String(msg.from).replace(/\D/g, ""))) {
            console.warn("rejected sender", msg.from);
            continue;
          }
          // Acknowledge inside 20s or Meta retries the whole delivery.
          ctx.waitUntil(
            handleMessage(env, msg.from, msg.text.body).catch(async (err) => {
              console.error(err);
              await reply(env, msg.from,
                "Something went wrong on my end and nothing was changed. Try again in a moment.");
            })
          );
        }
      }
    }

    return new Response("ok", { status: 200 });
  },
};
