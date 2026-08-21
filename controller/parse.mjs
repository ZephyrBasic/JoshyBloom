/* Parses the WhatsApp messages Joshy sends into event objects.

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
  title: "title", name: "title", what: "title", event: "title",
  kind: "kind", type: "kind",
  role: "role",
  with: "lineup", lineup: "lineup", support: "lineup", supports: "lineup",
  where: "where", venue: "where", at: "where", location: "where",
  details: "details", info: "details", time: "details", price: "details",
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

    if (fields.date) {
      const d = parseDate(fields.date, today);
      if (d.error) return { cmd: "error", message: `${d.error}. Try "date: 22 Aug 2026".` };
      if (d.date) event.date = d.date;
      else { event.sort = today; event.display = event.display || "TBA"; }
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

    if (event.link && !/^https?:\/\//i.test(event.link)) event.link = `https://${event.link}`;

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
      return { cmd: "error", message: `Nothing to change. Add lines like "where: New venue".` };
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
    "details: doors 6pm, $15",
    "link: facebook.com/events/...",
    "",
    "Only *date* and *title* are required — leave out any line you don't need.",
    "",
    "Dates: 22 Aug · 22 Aug 2026 · 22/8 · 2026-08-22 · tba",
    "For a run, add *until: 30 Aug* and it stays up until the last day.",
    "*kind: exhibition* or *kind: gig* if I guess wrong.",
    "",
    "Changes go live in a minute or two.",
  ].join("\n");
}
