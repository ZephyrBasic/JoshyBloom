/* node --test controller/test.mjs

   Runs the controller end to end with GitHub and Meta faked out, so the whole
   path — signature, allowlist, parse, apply, render, commit, reply — is
   exercised without touching the network, the repo or a phone. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCommand, parseDate, helpText } from "./parse.mjs";
import { patchCalendar, formatDate, sortEvents } from "../tools/render-events.mjs";
import { apply, listText, normalise } from "./worker.js";
import worker from "./worker.js";

const TODAY = "2026-08-21";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const seed = JSON.parse(await readFile(new URL("../data/events.json", import.meta.url), "utf8"));
const calendarHtml = await readFile(new URL("../public/calendar.html", import.meta.url), "utf8");

/* --- dates -------------------------------------------------------------- */

test("date formats Joshy might actually type", () => {
  const ok = (input, expected) =>
    assert.equal(parseDate(input, TODAY).date, expected, `${input} → ${expected}`);

  ok("2026-08-22", "2026-08-22");
  ok("22 Aug 2026", "2026-08-22");
  ok("22 August 2026", "2026-08-22");
  ok("Aug 22 2026", "2026-08-22");
  ok("22/8/2026", "2026-08-22");
  ok("22/08/26", "2026-08-22");
  ok("22nd Aug 2026", "2026-08-22");
  ok("5 sept 2026", "2026-09-05");

  // Year omitted resolves forward, never into the past.
  ok("22 Aug", "2026-08-22");   // still ahead of 21 Aug
  ok("3 Feb", "2027-02-03");    // already gone this year
  ok("21 Aug", "2026-08-21");   // today counts as upcoming

  assert.equal(parseDate("tba", TODAY).tba, true);
  assert.match(parseDate("31 Feb 2026", TODAY).error, /isn't a real date/);
  assert.match(parseDate("next tuesday", TODAY).error, /couldn't read/);
  assert.match(parseDate("", TODAY).error, /no date/);
});

test("day comes before month, Australian style", () => {
  assert.equal(parseDate("3/4/2026", TODAY).date, "2026-04-03");
});

/* --- parsing ------------------------------------------------------------ */

test("a full add, fields in any order", () => {
  const c = parseCommand([
    "add",
    "title: In Dog We Trust",
    "where: Small Change Espresso, Nambour",
    "date: 22 Aug",
    "role: band",
    "with: Extrafoxx",
    "details: doors 6pm, $15",
    "link: facebook.com/events/123",
  ].join("\n"), TODAY);

  assert.equal(c.cmd, "add");
  assert.deepEqual(c.event, {
    title: "In Dog We Trust",
    role: "band",
    lineup: "Extrafoxx",
    where: "Small Change Espresso, Nambour",
    details: "doors 6pm, $15",
    link: "https://facebook.com/events/123",   // scheme added
    date: "2026-08-22",
    kind: "Performance",                        // inferred from role
    id: "in-dog-we-trust-2026-08-22",
  });
});

test("date on the first line, and kind inferred without a role", () => {
  const c = parseCommand("add 5 Sept\ntitle: Under My House\nwhere: East Brisbane", TODAY);
  assert.equal(c.event.date, "2026-09-05");
  assert.equal(c.event.kind, "Exhibition");
});

test("a run stays up until its last day", () => {
  const c = parseCommand("add\ndate: 28 Aug\nuntil: 30 Aug\ntitle: Our Space BNE", TODAY);
  assert.equal(c.event.date, "2026-08-28");
  assert.equal(c.event.until, "2026-08-30");
});

test("missing essentials are refused, not guessed", () => {
  assert.match(parseCommand("add\nwhere: somewhere", TODAY).message, /needs a title/);
  assert.match(parseCommand("add\ntitle: Something", TODAY).message, /needs a date/);
  assert.match(parseCommand("remove", TODAY).message, /Which one/);
  assert.match(parseCommand("frobnicate", TODAY).message, /Didn't understand/);
});

test("unlabelled lines are reported rather than silently dropped", () => {
  const c = parseCommand("add\ndate: 22 Aug\ntitle: Gig\nsome loose text", TODAY);
  assert.equal(c.cmd, "add");
  assert.match(c.warnings.join(" "), /Ignored \(no label\).*some loose text/);
});

test("help and list are recognised however they're typed", () => {
  for (const w of ["help", "HELP", "?", "commands"]) {
    assert.equal(parseCommand(w, TODAY).cmd, "help");
  }
  for (const w of ["list", "dates", "events"]) {
    assert.equal(parseCommand(w, TODAY).cmd, "list");
  }
});

/* --- applying ----------------------------------------------------------- */

test("list numbers events in the order the site shows them", () => {
  const text = listText(seed, TODAY);
  assert.match(text, /^1\. 22 Aug 2026 — In Dog We Trust/);
  assert.ok(text.indexOf("Our Space BNE") < text.indexOf("Music Jam"));
  assert.ok(text.indexOf("Late Sept") < text.indexOf("24 Oct 2026"));
});

test("remove takes the numbered event and nothing else", () => {
  const r = apply({ cmd: "remove", index: 3 }, seed, TODAY);
  assert.equal(r.events.length, seed.length - 1);
  assert.match(r.text, /Removed:[\s\S]*Music Jam/);
  assert.ok(!r.events.some((e) => e.id === "music-jam-ventspace"));
});

test("edit merges, leaving untouched fields alone", () => {
  const cmd = parseCommand("edit 3\nwhere: Ventspace, West End", TODAY);
  const r = apply(cmd, seed, TODAY);
  const e = r.events.find((x) => x.id === "music-jam-ventspace");
  assert.equal(e.where, "Ventspace, West End");
  assert.equal(e.role, "Solo");      // untouched
  assert.equal(e.date, "2026-08-29"); // untouched
});

test("editing an unannounced date clears its ordering hint", () => {
  const cmd = parseCommand("edit 5\ndate: 28 Sept", TODAY);
  const e = apply(cmd, seed, TODAY).events.find((x) => x.id === "late-sept-exhibition");
  assert.equal(e.date, "2026-09-28");
  assert.equal(e.sort, undefined);
});

test("a repeated add is absorbed, not duplicated", () => {
  const cmd = parseCommand("add\ndate: 22 Aug\ntitle: In Dog We Trust", TODAY);
  const r = apply(cmd, seed, TODAY);
  assert.equal(r.events, undefined, "nothing to commit");
  assert.match(r.text, /already up/);
});

test("out-of-range numbers are refused", () => {
  const r = apply({ cmd: "remove", index: 99 }, seed, TODAY);
  assert.equal(r.events, undefined);
  assert.match(r.text, /no 99/);
});

/* --- rendering ---------------------------------------------------------- */

test("a new event renders into calendar.html in date order", () => {
  const cmd = parseCommand("add\ndate: 1 Sept 2026\ntitle: Test Show\nwhere: Somewhere", TODAY);
  const { events } = apply(cmd, seed, TODAY);
  const html = patchCalendar(calendarHtml, events);

  assert.match(html, /<h3 class="event__title">Test Show<\/h3>/);
  assert.match(html, /<time class="event__date" datetime="2026-09-01">1 Sept 2026<\/time>/);
  // Between 29 Aug and 5 Sept.
  assert.ok(html.indexOf("Music Jam") < html.indexOf("Test Show"));
  assert.ok(html.indexOf("Test Show") < html.indexOf("Under My House"));
  // Sentinels survive, exactly one of each.
  assert.equal(html.match(/<!-- events:start -->/g).length, 1);
  assert.equal(html.match(/<!-- events:end -->/g).length, 1);
});

test("user text is escaped, so a title can't break the page", () => {
  const events = [{ date: "2026-09-01", title: `Bad <script>alert("x")</script>`, kind: "Gig" }];
  const html = patchCalendar(calendarHtml, events);
  assert.ok(!html.includes("<script>alert"));
  assert.match(html, /&lt;script&gt;/);
});

test("an unannounced date asserts nothing", () => {
  const html = patchCalendar(calendarHtml, [{ sort: "2026-12-01", display: "Dec — TBA", title: "X" }]);
  assert.match(html, /<p class="event__date" data-sort="2026-12-01">Dec — TBA<\/p>/);
  assert.ok(!/datetime="2026-12-01"/.test(html));
});

test("patching is idempotent", () => {
  const once = patchCalendar(calendarHtml, seed);
  assert.equal(patchCalendar(once, seed), once);
});

test("a page without sentinels is refused rather than mangled", () => {
  assert.throws(() => patchCalendar("<html><body></body></html>", seed), /sentinels/);
});

/* --- the worker, end to end --------------------------------------------- */

const ENV = {
  TELEGRAM_TOKEN: "bot-token",
  TELEGRAM_SECRET: "webhook-secret",
  GITHUB_TOKEN: "gh-token",
  GITHUB_REPO: "ZephyrBasic/JoshyBloom",
  GITHUB_BRANCH: "main",
  ALLOWED_USERS: "8675309",
};

const HEADER = "x-telegram-bot-api-secret-token";

/** Stands in for GitHub and the Graph API, and records what was sent. */
function fakeNetwork({ failRefOnce = false } = {}) {
  const sent = { replies: [], commits: [], blobs: [] };
  let refFailed = false;

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });

    if (u.startsWith("https://api.telegram.org/")) {
      sent.replies.push(JSON.parse(init.body).text);
      return json({ ok: true, result: { message_id: 1 } });
    }
    if (u.includes("/git/ref/heads/")) return json({ object: { sha: "HEADSHA" } });
    if (u.includes("/contents/data/events.json")) return json({ content: b64(JSON.stringify(seed)) });
    if (u.includes("/contents/public/calendar.html")) return json({ content: b64(calendarHtml) });
    if (u.includes("/git/commits/HEADSHA")) return json({ tree: { sha: "TREESHA" } });
    if (u.endsWith("/git/blobs")) {
      const { content } = JSON.parse(init.body);
      sent.blobs.push(content);
      return json({ sha: `BLOB${sent.blobs.length}` });
    }
    if (u.endsWith("/git/trees")) return json({ sha: "NEWTREE" });
    if (u.endsWith("/git/commits")) {
      sent.commits.push(JSON.parse(init.body));
      return json({ sha: "NEWCOMMIT" });
    }
    if (u.includes("/git/refs/heads/")) {
      if (failRefOnce && !refFailed) { refFailed = true; return new Response("not a fast forward", { status: 422 }); }
      return json({});
    }
    throw new Error(`unexpected request: ${init.method || "GET"} ${u}`);
  };

  return sent;
}

const update = (text, from = 8675309) => JSON.stringify({
  update_id: 1,
  message: { message_id: 2, from: { id: from }, chat: { id: from }, text },
});

async function deliver(text, { from = 8675309, secret = ENV.TELEGRAM_SECRET, ...opts } = {}) {
  const sent = fakeNetwork(opts);
  const pending = [];
  const res = await worker.fetch(
    new Request("https://ctl.example/", {
      method: "POST",
      body: update(text, from),
      headers: secret === null ? {} : { [HEADER]: secret },
    }),
    ENV,
    { waitUntil: (p) => pending.push(p) }
  );
  await Promise.all(pending);
  return { res, sent };
}

test("an add is committed and confirmed", async () => {
  const { res, sent } = await deliver("add\ndate: 1 Sept 2026\ntitle: Test Show\nwhere: Somewhere");
  assert.equal(res.status, 200);

  assert.equal(sent.commits.length, 1, "exactly one commit");
  assert.equal(sent.blobs.length, 2, "both files in it");
  assert.deepEqual(sent.commits[0].parents, ["HEADSHA"]);

  const [events, html] = sent.blobs;
  assert.ok(JSON.parse(events).some((e) => e.title === "Test Show"));
  assert.match(html, /Test Show/);

  assert.match(sent.replies[0], /^Added:[\s\S]*Test Show/);
});

test("help never reads or writes the repo", async () => {
  const { sent } = await deliver("help");
  assert.equal(sent.commits.length, 0);
  assert.equal(sent.replies[0], helpText());
});

test("a wrong webhook secret is rejected before anything is parsed", async () => {
  const { res, sent } = await deliver("remove 1", { secret: "not-the-secret" });
  assert.equal(res.status, 401);
  assert.equal(sent.commits.length, 0);
  assert.equal(sent.replies.length, 0);
});

test("a missing webhook secret is rejected", async () => {
  const { res } = await deliver("remove 1", { secret: null });
  assert.equal(res.status, 401);
});

test("a secret of the right length but wrong bytes is rejected", async () => {
  const { res } = await deliver("remove 1", { secret: "x".repeat(ENV.TELEGRAM_SECRET.length) });
  assert.equal(res.status, 401);
});

test("a stranger with the right secret changes nothing", async () => {
  const { res, sent } = await deliver("remove 1", { from: 99999 });
  assert.equal(res.status, 200, "still acked, so Telegram stops retrying");
  assert.equal(sent.commits.length, 0);
  assert.equal(sent.replies.length, 0, "and gets no reply either");
});

test("a losing race is retried on top of the other commit", async () => {
  const { sent } = await deliver("add\ndate: 2 Sept 2026\ntitle: Raced", { failRefOnce: true });
  assert.equal(sent.commits.length, 2, "first attempt rejected, second committed");
  assert.match(sent.replies[0], /Added/);
});

test("a GET is refused: there is no handshake to answer", async () => {
  const res = await worker.fetch(new Request("https://ctl.example/"), ENV, {});
  assert.equal(res.status, 405);
});

test("Telegram slash commands reach the same parser", () => {
  assert.equal(normalise("/help"), "help");
  assert.equal(normalise("/help@JoshyBloomBot"), "help");
  assert.equal(normalise("/start"), "help", "first run lands on help");
  assert.equal(normalise("/list"), "list");
  assert.equal(normalise("add\ntitle: Plain"), "add\ntitle: Plain", "untouched without a slash");
});

test("an edited message is ignored", async () => {
  const sent = fakeNetwork();
  const res = await worker.fetch(
    new Request("https://ctl.example/", {
      method: "POST",
      headers: { [HEADER]: ENV.TELEGRAM_SECRET },
      body: JSON.stringify({
        update_id: 9,
        edited_message: { from: { id: 8675309 }, chat: { id: 8675309 }, text: "remove 1" },
      }),
    }),
    ENV, { waitUntil: () => {} }
  );
  assert.equal(res.status, 200);
  assert.equal(sent.commits.length, 0);
});

test("a GitHub failure tells Joshy nothing changed", async () => {
  const sent = fakeNetwork();
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    String(url).endsWith("/git/blobs")
      ? new Response("boom", { status: 500 })
      : inner(url, init);

  const pending = [];
  await worker.fetch(
    new Request("https://ctl.example/", {
      method: "POST",
      body: update("add\ndate: 3 Sept 2026\ntitle: Doomed"),
      headers: { [HEADER]: ENV.TELEGRAM_SECRET },
    }),
    ENV, { waitUntil: (p) => pending.push(p) }
  );
  await Promise.all(pending);

  assert.equal(sent.commits.length, 0);
  assert.match(sent.replies.at(-1), /nothing was changed/);
});
