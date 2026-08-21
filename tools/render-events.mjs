/* Renders data/events.json into the <li> blocks that live inside
   calendar.html. Pure, dependency-free ESM so the same code runs in Node
   (tools/build-calendar.mjs) and in the Cloudflare Worker (controller/).

   The output is ordinary HTML written into the page at commit time, not
   fetched at runtime — the calendar keeps working with JavaScript off. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

export const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "2026-08-22" -> "22 Aug 2026". Parsed as plain calendar parts, never as a
    Date, so the result never shifts with the runtime's timezone. */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Ordering key. A confirmed `date` and an unconfirmed `sort` rank the same;
    only `date` is ever asserted in the markup. Undated entries trail. */
const sortKey = (e) => e.date || e.sort || null;

export function sortEvents(events) {
  return [...events].sort((a, b) => {
    const ak = sortKey(a);
    const bk = sortKey(b);
    if (!ak && !bk) return 0;
    if (!ak) return 1;
    if (!bk) return -1;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

/** The last day an event is still current — the end of a run, or its one day. */
export const endDate = (e) => e.until || e.date || null;

function renderDate(e) {
  const text = escapeHtml(e.display || formatDate(e.date) || "TBA");
  const until = e.until ? ` data-until="${escapeHtml(e.until)}"` : "";

  // A <time datetime> is a machine-readable claim that the event happens on
  // that day. Anything unannounced gets a <p data-sort> instead, which orders
  // the entry without asserting anything.
  if (e.date) {
    return `<time class="event__date" datetime="${escapeHtml(e.date)}"${until}>${text}</time>`;
  }
  const sort = e.sort ? ` data-sort="${escapeHtml(e.sort)}"` : "";
  return `<p class="event__date"${sort}${until}>${text}</p>`;
}

const line = (cls, value) =>
  value ? `            <p class="${cls}">${escapeHtml(value)}</p>\n` : "";

export function renderEvent(e) {
  let body = `            <h3 class="event__title">${escapeHtml(e.title || "Untitled")}</h3>\n`;
  body += line("event__role", e.role);
  body += line("event__lineup", e.lineup);
  body += line("event__where", e.where);
  body += line("event__details", e.details);
  if (e.link) {
    body += `            <a class="event__link" rel="noopener"\n` +
            `               href="${escapeHtml(e.link)}">Event details</a>\n`;
  }

  return `      <li>\n` +
         `        <article class="event">\n` +
         `          ${renderDate(e)}\n` +
         `          <div>\n` +
         body +
         `          </div>\n` +
         (e.kind ? `          <p class="event__kind">${escapeHtml(e.kind)}</p>\n` : "") +
         `        </article>\n` +
         `      </li>`;
}

export function renderEvents(events) {
  if (!events.length) return "";
  return sortEvents(events).map(renderEvent).join("\n\n");
}

/* --- patching calendar.html -------------------------------------------- */

const START = "<!-- events:start -->";
const END = "<!-- events:end -->";

/** Replaces everything between the sentinels. Throws rather than guessing if
    the sentinels are missing, so a malformed page is never committed. */
export function patchCalendar(html, events) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`calendar.html is missing the ${START} / ${END} sentinels`);
  }
  const block = renderEvents(events);
  return html.slice(0, a + START.length) +
         "\n" + (block ? block + "\n" : "") +
         "      " + html.slice(b);
}
