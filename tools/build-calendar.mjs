/* Regenerates the event list in calendar.html from data/events.json.
   The Telegram controller does exactly this in the Worker, using the same
   renderer — this is the local equivalent for editing events by hand.

     node tools/build-calendar.mjs          write
     node tools/build-calendar.mjs --check  exit 1 if the file is stale (CI)
*/

import { readFile, writeFile } from "node:fs/promises";
import { patchCalendar } from "./render-events.mjs";

const root = new URL("..", import.meta.url);
const eventsPath = new URL("data/events.json", root);
const calendarPath = new URL("public/calendar.html", root);

const events = JSON.parse(await readFile(eventsPath, "utf8"));
const current = await readFile(calendarPath, "utf8");
const next = patchCalendar(current, events);

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("calendar.html is out of date — run: node tools/build-calendar.mjs");
    process.exit(1);
  }
  console.log(`calendar.html is up to date (${events.length} events).`);
} else if (next === current) {
  console.log(`calendar.html already current (${events.length} events).`);
} else {
  await writeFile(calendarPath, next);
  console.log(`calendar.html rewritten from ${events.length} events.`);
}
