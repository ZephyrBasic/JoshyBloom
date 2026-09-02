/* Parses the Telegram messages Joshy sends into event objects.

   Deliberately deterministic — no model call, no network, no dependencies.
   Everything it understands is listed in `helpText()`, and every parse is
   echoed back in the reply so a misread is visible immediately.

   Format is one labelled field per line, in any order:

     add
     date: 22 Aug
     title: In Dog We Trust
     where: Small Change Espresso, Nambour
     with: Extrafoxx, Henpeck
     details: doors 6pm, $15
*/

import { formatDate } from "../tools/render-events.mjs";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

/* Every label Joshy might reasonably type, mapped to the one field it sets. */
const FIELDS = {
  date: "date", on: "date", when: "date", day: "date",
  until: "until", to: "until", ends: "until", till: "until",
  title: "title", name: "title", what: "title",
  // "event" is the word the page prints for the kind, so it is the word
  // Joshy reaches for. It used to be a second name for the title.
  kind: "kind", type: "kind", event: "kind",
  role: "role",
  with: "lineup", lineup: "lineup", support: "lineup", supports: "lineup",
  where: "where", venue: "where", at: "where", location: "where",
  time: "time", times: "time", starts: "time",
  details: "details", info: "details", price: "details",
  link: "link", url: "link", tickets: "link", rsvp: "link",
  display: "display", as: "display",
};

/** Brisbane is UTC+10 year round, so a fixed offset is correct, not a
    simplification. Returns today's date there as "YYYY-MM-DD". */
export function todayInBrisbane(now = new Date()) {
  return new Date(now.getTime() + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

const pad = (n) => String(n).padStart(2, "0");
const isRealDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * Understands "2026-08-22", "22 Aug 2026", "22 Aug", "22/8/2026", "22/8",
 * and "tba"/"tbc"/"soon". A year-less date resolves to its next occurrence,
 * so "22 Aug" typed in September means next year, not eight months ago.
 *
 * @returns {{date: string}|{tba: true}|{error: string}}
 */
export function parseDate(input, today = todayInBrisbane()) {
  const raw = String(input || "").trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  if (!raw) return { error: "no date given" };
  if (/^(tba|tbc|soon|unknown|later)$/.test(raw)) return { tba: true };

  const thisYear = Number(today.slice(0, 4));
  let y, m, d;

  let mt;
  if ((mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw))) {
    [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  } else if ((mt = /^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{2,4}))?$/.exec(raw))) {
    d = +mt[1]; m = MONTHS[mt[2]]; y = mt[3] ? +mt[3] : null;
  } else if ((mt = /^([a-z]+)\.?\s+(\d{1,2})(?:\s+(\d{2,4}))?$/.exec(raw))) {
    m = MONTHS[mt[1]]; d = +mt[2]; y = mt[3] ? +mt[3] : null;
  } else if ((mt = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(raw))) {
    // Day first: Australian convention, and the only reading consistent with
    // the rest of the site.
    d = +mt[1]; m = +mt[2]; y = mt[3] ? +mt[3] : null;
  } else {
    return { error: `couldn't read "${input}" as a date` };
  }

  if (!m) return { error: `couldn't read the month in "${input}"` };
  if (y !== null && y < 100) y += 2000;

  if (y === null) {
    y = thisYear;
    if (`${y}-${pad(m)}-${pad(d)}` < today) y += 1; // next occurrence
  }
  if (!isRealDate(y, m, d)) return { error: `${input} isn't a real date` };

  return { date: `${y}-${pad(m)}-${pad(d)}` };
}

/* Separators Joshy might put between two dates. Tried in this order, with a
   bare hyphen last, because a hyphen is also a separator *inside* a date
   ("2026-09-28", "22-8") and would otherwise split one in half. */
const RANGE_SEPARATORS = [
  /\s+(?:to|until|till|through|thru)\s+/i,
  /\s*[–—]\s*/,
  /\s+-\s+/,
  /-/,
];

/**
 * One date, or a run of them written on a single line: "28 Sept - 4 Oct",
 * "28 Sep to 4 Oct 2026", "28/09/26-4/10/26".
 *
 * The whole string is tried as one date first, so anything that already
 * parsed keeps parsing the same way. Only then is it split, and a split is
 * accepted only when both halves are real dates — so an unreadable date
 * still gets the plain single-date complaint rather than a confusing one
 * about ranges.
 *
 * The end is resolved against the start rather than today, so "28 Dec - 4 Jan"
 * ends in the following January instead of the one already gone.
 *
 * @returns {{date:string}|{date:string,until:string}|{tba:true}|{error:string}}
 */
export function parseDateRange(input, today = todayInBrisbane()) {
  const single = parseDate(input, today);
  if (!single.error) return single;

  const raw = String(input || "").trim();
  for (const sep of RANGE_SEPARATORS) {
    const parts = raw.split(sep);
    if (parts.length !== 2) continue;
    const [from, to] = parts.map((p) => p.trim());
    if (!from || !to) continue;

    const start = parseDate(from, today);
    if (!start.date) continue;
    const end = parseDate(to, start.date);
    if (!end.date) continue;

    if (end.date < start.date) {
      return { error: `"${to}" is before "${from}"` };
    }
    return { date: start.date, until: end.date };
  }

  return single;
}

/* Where in a month a vague date sits. Only ever used for ordering. */
const VAGUE = {
  early: "start", start: "start", beginning: "start", "1st": "start",
  mid: "middle", middle: "middle",
  late: "end", end: "end", ending: "end",
};

/**
 * An ordering hint for a date line that is words rather than a date:
 * "Late Sept — TBA", "early March", "sometime around 12 Oct".
 *
 * Takes the first month named, places it by any early/mid/late (or an
 * explicit day, if one is there), and resolves the year forward exactly the
 * way a year-less date does. This orders the entry and nothing more — the
 * markup still asserts no date, because none was given.
 *
 * @returns {string|null} "YYYY-MM-DD", or null if no month is named.
 */
export function sortHint(input, today = todayInBrisbane()) {
  const words = String(input || "").toLowerCase()
    .replace(/(\d)(st|nd|rd|th)/g, "$1")
    .split(/[^a-z0-9]+/).filter(Boolean);

  let m = null, place = null, d = null, y = null;
  for (const w of words) {
    if (m === null && MONTHS[w]) { m = MONTHS[w]; continue; }
    if (place === null && VAGUE[w]) { place = VAGUE[w]; continue; }
    if (/^\d{4}$/.test(w)) y ??= +w;
    else if (d === null && /^\d{1,2}$/.test(w) && +w >= 1 && +w <= 31) d = +w;
  }
  if (!m) return null;

  const thisYear = Number(today.slice(0, 4));
  const lastDay = (year) => new Date(Date.UTC(year, m, 0)).getUTCDate();
  const dayIn = (year) =>
    Math.min(d ?? (place === "end" ? lastDay(year) : place === "middle" ? 15 : 1), lastDay(year));

  if (y === null) {
    y = thisYear;
    if (`${y}-${pad(m)}-${pad(dayIn(y))}` < today) y += 1;
  }
  return `${y}-${pad(m)}-${pad(dayIn(y))}`;
}

/** "1pm", "1:30 pm", "13:00" -> minutes past midnight, or null. */
function clock(input) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(input.trim());
  if (!m) return null;

  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (min > 59) return null;

  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;               // 12am is midnight, 12pm is noon
    if (m[3] === "pm") h += 12;
  } else if (h > 23) return null;

  return h * 60 + min;
}

const showClock = (mins) => {
  const h24 = Math.floor(mins / 60);
  const min = mins % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}${min ? `:${pad(min)}` : ""}${h24 < 12 ? "am" : "pm"}`;
};

/**
 * A time, or a run of one: "1pm", "13:00", "1pm - 4pm", "6pm–10pm".
 * Read the same way and split on the same separators as a date, then written
 * back in the one style the page uses, so times set months apart still match.
 *
 * Nothing is refused: a time it can't read is Joshy's own wording ("doors 6pm,
 * band 9pm") and is kept exactly as typed.
 *
 * @returns {{text: string, read: boolean}}
 */
export function parseTime(input) {
  const raw = String(input || "").trim();
  if (!raw) return { text: "", read: false };

  const lower = raw.toLowerCase();
  const one = clock(lower);
  if (one !== null) return { text: showClock(one), read: true };

  for (const sep of RANGE_SEPARATORS) {
    const parts = lower.split(sep);
    if (parts.length !== 2) continue;
    const from = clock(parts[0]);
    const to = clock(parts[1]);
    if (from === null || to === null) continue;
    return { text: `${showClock(from)} – ${showClock(to)}`, read: true };
  }

  return { text: raw, read: false };
}

/**
 * Pulls the link out of a `link:` line.
 *
 * Joshy pastes share text at least as often as a bare URL — "Residue Opening
 * Night https://…" is exactly what Eventbrite's share button hands you — so
 * the line is searched for a URL rather than assumed to be one. Taking the
 * whole line and prefixing a scheme to it is what produced
 * "https://Residue Opening Night https://www.eventbrite.com…".
 *
 * A bare domain still gets its scheme, which is the form the help text shows.
 *
 * @returns {{url: string|null, extra: string}} the link, and any words around it
 */
export function parseLink(input) {
  const raw = String(input || "").trim();

  // A scheme wins wherever in the line it appears — but only where what
  // follows is host-shaped. The value this replaced began "https://Residue",
  // which is a perfectly good scheme match and a useless link.
  const hostShaped = (u) => /^https?:\/\/[^/?#\s]*\.[^/?#\s]/i.test(u);
  for (const found of raw.matchAll(/https?:\/\/\S+/gi)) {
    if (hostShaped(found[0])) {
      return { url: found[0], extra: raw.replace(found[0], " ").trim() };
    }
  }

  // Otherwise a bare domain: dotted, no spaces, and a real-looking TLD, so
  // ordinary prose ("ask me", "e.g") is not mistaken for one.
  const m = /(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]\S*)?/i.exec(raw);
  if (!m) return { url: null, extra: raw };
  return { url: `https://${m[0]}`, extra: raw.replace(m[0], " ").trim() };
}

const KINDS = {
  performance: "Performance", perform: "Performance", gig: "Performance",
  music: "Performance", band: "Performance", set: "Performance",
  show: "Performance", live: "Performance",
  exhibition: "Exhibition", exhibit: "Exhibition", exhibiting: "Exhibition",
  installation: "Exhibition", install: "Exhibition", art: "Exhibition",
  ceramics: "Exhibition", market: "Market", workshop: "Workshop",
};

export const slugify = (s) =>
  String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 40) || "event";

/** Splits the body into labelled fields, tolerating stray blank lines and
    both ":" and "-" as the separator. Unlabelled lines are collected so the
    caller can tell Joshy what was ignored rather than silently dropping it. */
function readFields(lines) {
  const fields = {};
  const stray = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = /^([a-z]+)\s*[:\-–]\s*(.+)$/i.exec(t);
    const key = m && FIELDS[m[1].toLowerCase()];
    if (key) fields[key] = m[2].trim();
    else stray.push(t);
  }
  return { fields, stray };
}

/**
 * @returns {{cmd:"help"|"list"}
 *          |{cmd:"add"|"edit", event:object, index?:number, warnings:string[]}
 *          |{cmd:"remove", index:number}
 *          |{cmd:"error", message:string}}
 */
export function parseCommand(text, today = todayInBrisbane()) {
  const lines = String(text || "").split(/\r?\n/);
  const head = (lines.shift() || "").trim();
  // \S+ rather than \w+ so a bare "?" counts as a command.
  const m = /^(\S+)\s*(.*)$/.exec(head);
  if (!m) return { cmd: "error", message: "Empty message." };

  const verb = m[1].toLowerCase();
  const rest = m[2].trim();

  if (verb === "help" || verb === "?" || verb === "commands") return { cmd: "help" };
  if (verb === "list" || verb === "dates" || verb === "events") return { cmd: "list" };

  if (["remove", "delete", "cancel", "rm"].includes(verb)) {
    const n = Number.parseInt(rest, 10);
    if (!Number.isInteger(n) || n < 1) {
      return { cmd: "error", message: `Which one? Send "list" for the numbers, then "remove 3".` };
    }
    return { cmd: "remove", index: n };
  }

  if (verb === "add" || verb === "new" || verb === "edit" || verb === "change") {
    const isEdit = verb === "edit" || verb === "change";
    let index = null;
    if (isEdit) {
      index = Number.parseInt(rest, 10);
      if (!Number.isInteger(index) || index < 1) {
        return { cmd: "error", message: `Which one? Send "list" for the numbers, then "edit 3".` };
      }
    } else if (rest) {
      // "add 22 Aug" — treat anything on the first line as the date.
      lines.unshift(`date: ${rest}`);
    }

    const { fields, stray } = readFields(lines);
    const warnings = stray.length
      ? [`Ignored (no label): ${stray.map((s) => `"${s}"`).join(", ")}`]
      : [];

    const event = {};
    for (const k of ["title", "role", "lineup", "where", "details", "link", "display"]) {
      if (fields[k]) event[k] = fields[k];
    }

    // Left as written when it can't be read, the same as `date:`. No warning:
    // the reply reads the time back either way, and "doors 6pm, band 9pm" is
    // a perfectly ordinary thing to write.
    if (fields.time) event.time = parseTime(fields.time).text;

    if (fields.date) {
      const d = parseDateRange(fields.date, today);
      if (d.date) {
        event.date = d.date;
        if (d.until) event.until = d.until;
      } else if (d.tba) {
        event.sort = today;
        event.display = event.display || "TBA";
      } else {
        // `date:` is the line that becomes the date on the page, so words it
        // can't read are printed as Joshy wrote them rather than refused.
        // They are ordered by whatever month they name and assert nothing.
        event.display = event.display || fields.date;
        event.sort = sortHint(fields.date, today) || today;
        warnings.push(
          `Couldn't read "${fields.date}" as a date, so I've shown it as written, ` +
          `in the list under ${formatDate(event.sort)}.`
        );
      }
    }

    if (fields.until) {
      const u = parseDate(fields.until, today);
      if (u.error) return { cmd: "error", message: `${u.error} (until). Try "until: 30 Aug".` };
      if (u.date) event.until = u.date;
    }

    if (fields.kind) {
      const k = KINDS[fields.kind.toLowerCase()];
      if (k) event.kind = k;
      else warnings.push(`Didn't recognise kind "${fields.kind}" — used it as written.`),
           event.kind = fields.kind;
    }

    if (fields.link) {
      const { url, extra } = parseLink(fields.link);
      if (url) {
        event.link = url;
        if (extra) warnings.push(`Used the link and ignored "${extra}".`);
      } else {
        delete event.link;
        warnings.push(`I couldn't find a link in "${fields.link}", so I left it alone.`);
      }
    }

    if (!isEdit) {
      if (!event.title) {
        return { cmd: "error", message: `Every event needs a title. Add a line: "title: In Dog We Trust".` };
      }
      if (!event.date && !event.sort) {
        return { cmd: "error", message: `Every event needs a date. Add a line: "date: 22 Aug", or "date: tba".` };
      }
      // Matches how the site already reads: anything with a stated role is a
      // performance, anything else is shown as an exhibition.
      if (!event.kind) event.kind = event.role ? "Performance" : "Exhibition";
      event.id = `${slugify(event.title)}-${event.date || event.sort}`;
    } else if (!Object.keys(event).length) {
      // If a line was understood but came to nothing — a `link:` with no link
      // in it — the reason is more use than the generic prompt.
      return {
        cmd: "error",
        message: warnings.length
          ? warnings.join("\n")
          : `Nothing to change. Add lines like "where: New venue".`,
      };
    }

    return { cmd: isEdit ? "edit" : "add", event, index, warnings };
  }

  return {
    cmd: "error",
    message: `Didn't understand "${verb}". Send "help" for what I know.`,
  };
}

export function helpText() {
  return [
    "I keep the calendar on joshybloom.com up to date. Four things:",
    "",
    "*list* — every date, numbered",
    "*add* — a new date",
    "*edit 3* — change date 3",
    "*remove 3* — take date 3 down",
    "",
    "To add one, put each detail on its own line:",
    "",
    "add",
    "date: 22 Aug",
    "title: In Dog We Trust",
    "where: Small Change Espresso, Nambour",
    "role: band",
    "with: Extrafoxx, Henpeck",
    "time: 6pm",
    "details: $15",
    "link: facebook.com/events/...",
    "",
    "Only *date* and *title* are required — leave out any line you don't need.",
    "",
    "Dates: 22 Aug · 22 Aug 2026 · 22/8 · 2026-08-22 · tba",
    "For a run, write both ends: *date: 28 Sept - 4 Oct*. It stays up until the last day.",
    "Anything else I can't read — *date: Late Sept — TBA* — goes up exactly as you write it.",
    "*time: 1pm* or a range, *time: 1pm - 4pm*. *details:* is for the rest — price, doors.",
    "*event: exhibition* or *event: gig* if I guess wrong.",
    "",
    "Changes go live in a minute or two.",
  ].join("\n");
}
