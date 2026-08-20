# Joshy Bloom

Static site. No framework, no build step required to deploy — the HTML/CSS/JS
in this repo is what ships.

```
index.html          Home — hero, statement, selected work, installation, sound
calendar.html       Upcoming + past dates (events authored inline as HTML)
contact.html        Links
css/styles.css      Design system (tokens, temperatures, layout, motion)
js/main.js          Temperature, reveals, parallax, event sorting. No deps.
fonts/              Self-hosted Fraunces + Inter, latin subset, woff2
assets/img/         Originals (not served)
assets/img/opt/     Generated derivatives (served)
assets/img/manifest.json  Dimensions + LQIP per image
tools/build-images.py     Regenerates assets/img/opt/
_headers            Cloudflare Pages cache + security headers
```

## The temperature system

The single idea the design hangs on. Sections carry `data-temp-zone` with one of
`bone`, `clay`, `ash`, `ember`. `main.js` watches a 1px band across the middle of
the viewport and promotes whichever zone owns it onto `<html data-temp>`. Every
colour token is defined per-temperature in `styles.css`, so the whole page
cross-fades at once as you scroll from the ceramics (light, earthen) into the
music (dark). Sections themselves are transparent — the `<html>` background is
what you see.

To retemperature a section, change one attribute. To add a temperature, add one
`[data-temp="…"]` block of tokens.

## Adding an event

Events are written directly in `calendar.html` as ordinary list items. They are
**not** fetched from anywhere — that means they render with JavaScript disabled,
work when the file is opened straight off disk over `file://`, and cannot fail
to load. `main.js` only sorts them and retires the ones that have passed.

Copy an existing `<li>` block. Three attributes drive the behaviour:

| Attribute | Meaning |
|---|---|
| `<time datetime="YYYY-MM-DD">` | A confirmed date. Also what search engines read. |
| `data-sort="YYYY-MM-DD"` | Ordering only, for a date not yet announced. Never displayed, and asserts nothing. Use on a `<p>` instead of a `<time>`. |
| `data-until="YYYY-MM-DD"` | Last day of a run, so a multi-day show stays in Upcoming until it actually closes rather than archiving on opening day. |

The visible date text is whatever you type between the tags, so a run can read
"28–30 Aug 2026" while `datetime` stays a single machine-readable day.

Every `<p>` inside the middle `<div>` is optional — `event__role`,
`event__lineup`, `event__where`, `event__details`, `event__link`. Omit any line
you do not need and the layout closes up.

Entries with no resolvable date sort to the end of Upcoming. When nothing is
upcoming at all, the page shows a written empty state instead of a blank
section, and the Past archive unhides itself only once it has something in it.

## Images

`tools/build-images.py` reads `assets/img/*`, bakes in EXIF rotation (seven of
the originals are portrait shot as landscape), strips metadata, and writes AVIF +
WebP + progressive JPEG at 480/800/1200/1800/2400px, capped at the source width.

```bash
python tools/build-images.py
```

Originals stay in `assets/img/` and are never served. Every `<img>` carries
intrinsic `width`/`height` so there is no layout shift.

Two things worth knowing:

- `assets/img/opt/` is ~60 MB across all three formats. Only one file is ever
  fetched per image per visitor, so this costs bandwidth nothing — but it does
  make the repo heavy. If that matters, drop the JPEG tier above 1200px in
  `build-images.py`; AVIF and WebP together cover ~97% of browsers.
- Fraunces is 118 KB because it ships four variable axes. Pinning `SOFT`/`WONK`
  and narrowing `opsz` with `fonttools` would cut it substantially.

## Motion

All motion is behind `@media (prefers-reduced-motion: no-preference)`, and the
`reduce` branch is a real design state, not a disable switch — everything is
simply present, unanimated, with parallax skipped in JS as well as CSS.

Reveals are one-shot IntersectionObserver. Parallax is transform-only and
rAF-coalesced.

## Deploy

Cloudflare Pages, connected to the GitHub repo:

- Build command: *(none)*
- Build output directory: `/`

There is no server-side anything. `_headers` sets immutable caching on fonts and
generated images.

## Still needed

See `NOTES.md`.
