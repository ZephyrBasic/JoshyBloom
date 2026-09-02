/* node --test controller/test.mjs

   Runs the controller end to end with GitHub and Meta faked out, so the whole
   path — signature, allowlist, parse, apply, render, commit, reply — is
   exercised without touching the network, the repo or a phone. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCommand, parseDate, parseDateRange, sortHint, helpText } from "./parse.mjs";
import { patchCalendar, formatDate, formatRange, sortEvents } from "../tools/render-events.mjs";
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

test("a range written as one date line, the way Joshy actually types it", () => {
  const ok = (input, date, until) => {
    const r = parseDateRange(input, TODAY);
    assert.deepEqual({ date: r.date, until: r.until }, { date, until }, input);
  };

  ok("28 Sept - 4 Oct", "2026-09-28", "2026-10-04");
  ok("28 Sept – 4 Oct", "2026-09-28", "2026-10-04");
  ok("28 Sep 2026 - 4 Oct 2026", "2026-09-28", "2026-10-04");
  ok("28/09/26 - 4/10/26", "2026-09-28", "2026-10-04");
  ok("28/09/26-4/10/26", "2026-09-28", "2026-10-04");
  ok("28 Sept to 4 Oct", "2026-09-28", "2026-10-04");
  ok("2026-09-28 - 2026-10-04", "2026-09-28", "2026-10-04");

  // The end resolves against the start, so a run over new year ends in it.
  ok("28 Dec - 4 Jan", "2026-12-28", "2027-01-04");
});

test("a lone date is still read whole, hyphens and all", () => {
  // Would be split into nonsense if the range separator were tried first.
  assert.equal(parseDateRange("2026-08-22", TODAY).date, "2026-08-22");
  assert.equal(parseDateRange("22-8", TODAY).date, "2026-08-22");
  assert.equal(parseDateRange("22 Aug", TODAY).until, undefined);
  assert.equal(parseDateRange("tba", TODAY).tba, true);
  // A misread stays the plain single-date complaint, not a range one.
  assert.match(parseDateRange("next tuesday", TODAY).error, /couldn't read/);
});

test("a backwards range is refused rather than stored", () => {
  assert.match(parseDateRange("4 Oct 2026 - 28 Sept 2026", TODAY).error, /before/);
});

test("the date line accepts a range, and says so when it can't read one", () => {
  const c = parseCommand("edit 5\nDate: 28 Sept - 4 Oct", TODAY);
  assert.equal(c.cmd, "edit");
  assert.equal(c.event.date, "2026-09-28");
  assert.equal(c.event.until, "2026-10-04");

  // The dead end Joshy hit: a date line it can't read is no longer refused,
  // and the help says how to write a run.
  assert.match(helpText(), /28 Sept - 4 Oct/);
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

test("a run shows both ends, without repeating what they share", () => {
  assert.equal(formatRange("2026-08-28", "2026-08-30"), "28–30 Aug 2026");
  assert.equal(formatRange("2026-09-28", "2026-10-04"), "28 Sept – 4 Oct 2026");
  assert.equal(formatRange("2026-12-28", "2027-01-04"), "28 Dec 2026 – 4 Jan 2027");

  const html = patchCalendar(calendarHtml, [
    { date: "2026-09-28", until: "2026-10-04", title: "Residue" },
  ]);
  assert.match(html, /datetime="2026-09-28" data-until="2026-10-04">28 Sept – 4 Oct 2026</);
});

test("a placeholder date doesn't outlive the date it stood in for", () => {
  // The exact stuck entry: a real date arrives, but "Late Sept — TBA" is what
  // the page keeps printing until the placeholder is cleared with it.
  const seeded = [{
    id: "late-sept-exhibition", sort: "2026-09-30",
    display: "Late Sept — TBA", title: "Residue", kind: "Exhibition",
  }];
  const cmd = parseCommand("edit 1\ndate: 28 Sept - 4 Oct", TODAY);
  const { events, text } = apply(cmd, seeded, TODAY);

  assert.equal(events[0].display, undefined);
  assert.equal(events[0].sort, undefined);
  assert.equal(events[0].until, "2026-10-04");
  // What Joshy is told must be what the page shows.
  assert.match(text, /28 Sept – 4 Oct 2026/);
  assert.match(patchCalendar(calendarHtml, events), /28 Sept – 4 Oct 2026/);
});

test("a display Joshy sets himself survives a date change", () => {
  const seeded = [{ id: "x", date: "2026-09-01", display: "Spring", title: "X" }];
  const cmd = parseCommand("edit 1\ndate: 2 Sept\ndisplay: Later in Spring", TODAY);
  assert.equal(apply(cmd, seeded, TODAY).events[0].display, "Later in Spring");
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

/* --- date: is what the page shows --------------------------------------- */

test("a date line it can't read is shown as written, not refused", () => {
  const c = parseCommand("add\ndate: Late Sept — TBA\ntitle: Residue", TODAY);
  assert.equal(c.cmd, "add");
  assert.equal(c.event.display, "Late Sept — TBA");
  // Nothing machine-readable is invented for words.
  assert.equal(c.event.date, undefined);
  // Said out loud rather than silently accepted.
  assert.match(c.warnings.join(" "), /as written/);
});

test("words still order the entry by the month they name", () => {
  // Reproduces the sort key this entry was given by hand.
  assert.equal(sortHint("Late Sept — TBA", TODAY), "2026-09-30");
  assert.equal(sortHint("early March", TODAY), "2027-03-01");
  assert.equal(sortHint("mid Nov", TODAY), "2026-11-15");
  assert.equal(sortHint("sometime around 12 Oct", TODAY), "2026-10-12");
  assert.equal(sortHint("no month in here", TODAY), null);
});

test("a worded date renders without asserting a date", () => {
  const c = parseCommand("add\ndate: Late Sept — TBA\ntitle: Residue", TODAY);
  const html = patchCalendar(calendarHtml, [c.event]);
  assert.match(html, /<p class="event__date" data-sort="2026-09-30">Late Sept — TBA<\/p>/);
  assert.ok(!/datetime="2026-09-30"/.test(html));
});

test("swapping a real date for words takes the machine claim down with it", () => {
  const seeded = [{ id: "x", date: "2026-08-28", until: "2026-08-30",
                    display: "28–30 Aug 2026", title: "Common Ground" }];
  const { events } = apply(parseCommand("edit 1\ndate: Late Sept — TBA", TODAY), seeded, TODAY);

  assert.equal(events[0].display, "Late Sept — TBA");
  assert.equal(events[0].sort, "2026-09-30");
  assert.equal(events[0].date, undefined);
  assert.equal(events[0].until, undefined);
});

test("a new single date doesn't leave the old run's end behind", () => {
  const seeded = [{ id: "x", date: "2026-08-28", until: "2026-08-30",
                    display: "28–30 Aug 2026", title: "Common Ground" }];
  const { events } = apply(parseCommand("edit 1\ndate: 5 Sept", TODAY), seeded, TODAY);

  assert.equal(events[0].date, "2026-09-05");
  assert.equal(events[0].until, undefined);
  assert.equal(events[0].display, undefined);
});

test("date: is echoed back as what the page will show", () => {
  const { text } = apply(parseCommand("add\ndate: Late Sept — TBA\ntitle: Residue", TODAY), [], TODAY);
  assert.match(text, /Late Sept — TBA — Residue/);
});

/* --- the labels Joshy calls the fields by -------------------------------- */

const ARTS_FACTORY = [
  "add",
  "date: 24 Oct 2026",
  "title: In Dog We Trust (A Bit Grim III)",
  "role: Band",
  "with: O.R.B, EXEK, Screensaver, & more",
  "where: The Arts Factory, Byron Bay",
  "time: 1pm",
  "link: https://tickets.oztix.com.au/outlet/event/04ab",
  "event: gig",
].join("\n");

test("every label lands in its own field", () => {
  const c = parseCommand(ARTS_FACTORY, TODAY);
  assert.equal(c.cmd, "add");
  assert.deepEqual(c.event, {
    date: "2026-10-24",
    title: "In Dog We Trust (A Bit Grim III)",
    role: "Band",
    lineup: "O.R.B, EXEK, Screensaver, & more",
    where: "The Arts Factory, Byron Bay",
    time: "1pm",
    link: "https://tickets.oztix.com.au/outlet/event/04ab",
    kind: "Performance",
    id: "in-dog-we-trust-a-bit-grim-iii-2026-10-24",
  });
  assert.deepEqual(c.warnings, []);
});

test("every field lands in the class the page styles", () => {
  const html = patchCalendar(calendarHtml, [parseCommand(ARTS_FACTORY, TODAY).event]);

  assert.match(html, /<time class="event__date" datetime="2026-10-24">24 Oct 2026<\/time>/);
  assert.match(html, /<h3 class="event__title">In Dog We Trust \(A Bit Grim III\)<\/h3>/);
  assert.match(html, /<p class="event__role">Band<\/p>/);
  assert.match(html, /<p class="event__lineup">O\.R\.B, EXEK, Screensaver, &amp; more<\/p>/);
  assert.match(html, /<p class="event__where">The Arts Factory, Byron Bay<\/p>/);
  assert.match(html, /<p class="event__time">1pm<\/p>/);
  assert.match(html, /<p class="event__kind">Performance<\/p>/);
  // The time reads after the venue, where the page has always put it.
  assert.ok(html.indexOf("event__where") < html.indexOf("event__time"));
  assert.ok(html.indexOf("event__time") < html.indexOf("event__link"));
});

test("time is its own field, no longer part of details", () => {
  const c = parseCommand("add\ndate: 24 Oct 2026\ntitle: X\ntime: 1pm\ndetails: $15, over 18s", TODAY);
  assert.equal(c.event.time, "1pm");
  assert.equal(c.event.details, "$15, over 18s");

  const html = patchCalendar(calendarHtml, [c.event]);
  assert.match(html, /<p class="event__time">1pm<\/p>/);
  assert.match(html, /<p class="event__details">\$15, over 18s<\/p>/);
});

test("a time can be a range, however it's written", () => {
  const t = (input) =>
    parseCommand(`add\ndate: 24 Oct 2026\ntitle: X\ntime: ${input}`, TODAY).event.time;

  assert.equal(t("1pm"), "1pm");
  assert.equal(t("1PM"), "1pm");
  assert.equal(t("1:30 pm"), "1:30pm");
  assert.equal(t("13:00"), "1pm");
  assert.equal(t("12am"), "12am");
  assert.equal(t("1pm - 4pm"), "1pm – 4pm");
  assert.equal(t("1pm to 4pm"), "1pm – 4pm");
  assert.equal(t("6pm–10pm"), "6pm – 10pm");
  assert.equal(t("18:00 - 22:00"), "6pm – 10pm");
  // Anything it can't read is Joshy's wording, kept as typed.
  assert.equal(t("doors 6pm, band 9pm"), "doors 6pm, band 9pm");
});

test("event: names the kind, which is the word the page prints", () => {
  const c = parseCommand("add\ndate: 24 Oct 2026\ntitle: Residue\nevent: exhibition", TODAY);
  assert.equal(c.event.kind, "Exhibition");
  assert.equal(c.event.title, "Residue");
});

test("the reply reads back the time along with the rest", () => {
  const { text } = apply(parseCommand(ARTS_FACTORY, TODAY), [], TODAY);
  assert.match(text, /24 Oct 2026 — In Dog We Trust \(A Bit Grim III\)/);
  assert.match(text, /The Arts Factory, Byron Bay · Band · 1pm/);
});
