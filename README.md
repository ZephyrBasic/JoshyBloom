# Joshy Bloom

Static site. No framework, no build step required to deploy — the HTML/CSS/JS
in this repo is what ships.

```
public/             Everything Pages publishes — and nothing else
  index.html        Home — hero, statement, selected work, installation, sound
  calendar.html     Upcoming + past dates (generated from data/events.json)
  contact.html      Links
  css/styles.css    Design system (tokens, temperatures, layout, motion)
  js/main.js        Temperature, reveals, parallax, event sorting. No deps.
  fonts/            Self-hosted Fraunces + Inter, latin subset, woff2
  assets/img/opt/   Generated derivatives
  _headers          Cloudflare Pages cache + security headers

data/events.json    Every date. The source of truth for the calendar.
assets/img/         Originals. Never published.
assets/img/manifest.json  Dimensions + LQIP per image. Build-time only.
tools/build-images.py     assets/img/ -> public/assets/img/opt/
tools/build-calendar.mjs  data/events.json -> public/calendar.html
tools/render-events.mjs   Shared renderer, used by the build and the controller
controller/         WhatsApp calendar controller. A separate Cloudflare Worker
                    that writes to this repo. Not part of the site.
```

Anything outside `public/` is source, and is never uploaded anywhere.


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

Three ways, all ending in the same place:

1. **WhatsApp.** Joshy messages the bot; it commits and Pages redeploys. See
   `controller/README.md`.
2. **Edit `data/events.json`,** then regenerate:

   ```bash
   node tools/build-calendar.mjs
   ```

3. **Edit `calendar.html` directly** — but the next regeneration overwrites it.
   Don't.

The generated markup lives between `<!-- events:start -->` and
`<!-- events:end -->`. Everything outside the sentinels is yours to edit freely.

Events are written into the page at commit time, **not** fetched at runtime.
That means the calendar renders with JavaScript disabled, works from `file://`,
and cannot fail to load. `main.js` only reorders the list and retires dates that
have passed.

### Event fields

| Field | |
|---|---|
| `date` | `YYYY-MM-DD`. A confirmed date. Becomes `<time datetime>`, which is what search engines read. |
| `sort` | `YYYY-MM-DD` for a date **not** yet announced. Orders the entry without asserting anything, and is never displayed. Use instead of `date`, not alongside it. |
| `until` | Last day of a run, so a multi-day show stays in Upcoming until it actually closes rather than archiving on opening day. |
| `display` | Overrides the date text, e.g. `28–30 Aug 2026` or `Late Sept — TBA`. The `datetime` stays a single machine-readable day. |
| `title` | Required. |
| `kind` | The tag on the right: `Performance`, `Exhibition`, … |
| `role`, `lineup`, `where`, `details`, `link` | All optional. Omit any and the layout closes up. |

Entries with no resolvable date sort to the end. When nothing is upcoming, the
page shows a written empty state rather than a blank section, and the Past
archive unhides itself only once it has something in it.

```bash
node tools/build-calendar.mjs --check   # CI: fails if calendar.html is stale
node --test controller/test.mjs         # 27 tests, no network needed
```

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

- `public/assets/img/opt/` is ~63 MB across all three formats. Only one file is ever
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

The site is a **Worker with static assets** — `wrangler.toml` at the repo root
declares `public/` as the asset directory and defines no `main`, so no
server-side code runs. Cloudflare serves the files from its edge.

Workers Builds deploys it on every push to `main`:

| | |
|---|---|
| Path | `/` |
| Build command | *(none)* |
| Deploy command | `npx wrangler deploy` |

Locally:

```bash
npx wrangler dev --port 4321    # local preview
npx wrangler deploy --dry-run   # validate without shipping
npx wrangler deploy             # ship
```

Use `wrangler dev` rather than a plain static server: Cloudflare serves
`/calendar`, not `/calendar.html`, and only wrangler reproduces that. A bare
`python -m http.server -d public` will 404 on every nav link.

**URLs are extensionless.** Cloudflare's asset handling 307s `/calendar.html`
to `/calendar`, so internal links, `canonical`, `og:url` and the sitemap all
name the extensionless form — a canonical that points at a redirect is worse
than useless. Old `.html` links still resolve, they just cost a hop.

`public/_headers` sets immutable caching on fonts and generated images.
`public/404.html` is served for unknown paths via `not_found_handling`.

The calendar controller is a **second, separate** Worker built from
`controller/` in this same repo. It only writes to the repo and cannot affect
the site — see `controller/README.md`.

## Still needed

See `NOTES.md`.
