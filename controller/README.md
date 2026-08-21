# Calendar controller

Lets Joshy add, edit and remove calendar dates by messaging WhatsApp.

**The site stays static.** This Worker never serves a page and never talks to a
visitor. It edits `data/events.json` and `public/calendar.html` in the repo and pushes
one commit; The site Worker rebuilds from that commit. If this Worker is down,
misconfigured or deleted, joshybloom.com is completely unaffected — it is still
the same folder of HTML, CSS, JS and images it was before.

```
Joshy's phone
   ↓  WhatsApp
Meta Cloud API
   ↓  signed POST
Cloudflare Worker  ──►  reply to Joshy
   ↓  one commit (GitHub Git Data API)
GitHub repo
   ↓  push
Workers Builds     ──►  static site
```

## Why the events are still inline HTML

The obvious design is to store events somewhere and `fetch()` them from the
page. That would quietly break two things the calendar currently guarantees: it
renders with JavaScript disabled, and it cannot fail to load. So the Worker
renders the `<li>` markup itself, at commit time, using the same
`tools/render-events.mjs` as the local build. What ships is ordinary HTML.

`data/events.json` is the source of truth. `public/calendar.html` is generated from it
and committed alongside it, so the two can never drift.

## Files

```
worker.js      Entry point: verify, authorise, dispatch, reply
parse.mjs      Message → event object. Deterministic, no model call
github.mjs     Read two files, write them back in one commit
test.mjs       End to end with GitHub and Meta faked out
wrangler.toml  Non-secret config
```

```bash
node --test controller/test.mjs      # no network, no credentials needed
```

## What Joshy sends

```
add
date: 22 Aug
title: In Dog We Trust
where: Small Change Espresso, Nambour
role: band
with: Extrafoxx, Henpeck
details: doors 6pm, $15
link: facebook.com/events/...
```

Only `date` and `title` are required. Also `list`, `edit 3`, `remove 3`, `help`.

Dates: `22 Aug` · `22 Aug 2026` · `22/8` · `2026-08-22` · `tba`. Day before
month. A year-less date resolves to its **next** occurrence, so "22 Aug" typed
in September means next year. `until: 30 Aug` keeps a run up until its last day.

Every parse is echoed back in the reply, so a misread is visible immediately —
and `remove` undoes anything, as does `git revert`.

## Setup

### 1. Point the site Worker at the repo

This is the one change to the workflow. The site Worker must build from GitHub
rather than from manual uploads, or the controller's commits never reach the
site.

Cloudflare dashboard → Workers & Pages → the **site** Worker → Settings → Build
→ **Connect** to `ZephyrBasic/JoshyBloom`, branch `main`, with Path `/`, no
build command, and deploy command `npx wrangler deploy`. The root
`wrangler.toml` does the rest.

### 2. Meta app

Needs a Meta Business account and a phone number that is **not already
registered to a personal WhatsApp account**. This is the fiddliest part; budget
half an hour.

1. [developers.facebook.com](https://developers.facebook.com/apps) → **Create
   app** → *Business* → add the **WhatsApp** product.
2. WhatsApp → **API Setup**. Note the **Phone number ID** and add Joshy's own
   number under *To* as a test recipient.
3. App settings → Basic → reveal the **App secret**.

The test access token on that page expires in 24 hours. For a permanent one:
Business Settings → **System users** → add one with admin access to the app →
*Generate new token* → scopes `whatsapp_business_messaging` and
`whatsapp_business_management` → set expiry to **Never**.

### 3. Configure and deploy

Put the two non-secret values in `wrangler.toml`:

```toml
META_PHONE_ID   = "…"          # from API Setup
ALLOWED_NUMBERS = "61412345678" # Joshy's number, E.164, no +
```

Then from `controller/`:

```bash
npx wrangler secret put META_APP_SECRET    # app secret from step 2
npx wrangler secret put META_TOKEN         # system user token from step 2
npx wrangler secret put META_VERIFY_TOKEN  # any random string you invent
npx wrangler secret put GITHUB_TOKEN       # see below
npx wrangler deploy
```

Secrets are stored encrypted by Cloudflare. They are never written to
`wrangler.toml` and never appear in this repo.

**GitHub token:** a fine-grained personal access token
([settings](https://github.com/settings/personal-access-tokens/new)) scoped to
**only** `ZephyrBasic/JoshyBloom`, with **Contents: read and write**. Nothing
else. That is the entire blast radius if it ever leaks — someone could edit this
one repo, and every change is in the git history.

### 4. Subscribe the webhook

Deploy prints a URL like `https://joshybloom-calendar.<subdomain>.workers.dev`.

Meta app dashboard → WhatsApp → Configuration → **Edit** webhook:

- Callback URL: the Worker URL
- Verify token: whatever you set as `META_VERIFY_TOKEN`

Click **Verify and save** — the Worker answers Meta's handshake. Then
**Manage** → subscribe to the **`messages`** field. This is easy to miss, and
without it nothing is ever delivered.

### 5. Test

Message the WhatsApp number from Joshy's phone:

```
help
list
add
date: 1 Jan 2027
title: Test
```

Then `remove` it by its number. Check the repo for the commits.

```bash
npx wrangler tail        # live logs if something is quiet
```

## Who can change the calendar

Two independent gates, both of which must pass:

1. **`X-Hub-Signature-256`** — HMAC-SHA256 of the raw body under the app secret,
   compared in constant time, checked before the JSON is parsed. Nothing but
   Meta can produce a valid one.
2. **Number allowlist** — a valid signature only proves *Meta* sent the message,
   not who wrote it. Anyone who finds the number can message the bot, so the
   sender is checked against `ALLOWED_NUMBERS`. Anyone else is logged, ignored,
   and gets no reply at all.

Titles and every other field are HTML-escaped on the way into the page, so a
message cannot inject markup. There is a test for it.

The Worker only ever writes those two paths, and always in one commit with the
parent it read, so a concurrent push is rejected rather than clobbered (it
retries once on top of the newer commit).

## Cost

Cloudflare Workers' free tier is 100,000 requests a day; this will use a handful.
Meta's Cloud API does not charge for service conversations — Joshy messages
first, and replies land inside the 24-hour window. Meta changes pricing
periodically, so it's worth a glance at the dashboard occasionally, but there is
no template or marketing messaging here.

## Known limits

- **Text messages only.** A photo or voice note is ignored. Adding an image to
  an event would mean running it through `tools/build-images.py`, which the
  Worker can't do.
- **Past events are retired in the browser, not at build time**, exactly as
  before — `main.js` moves them to the archive on load. Nothing needs to run on
  a schedule.
- **Meta may retry a delivery.** An identical `add` (same title and date) is
  absorbed rather than duplicated, but an `edit` sent twice applies twice — it
  is idempotent in effect, since the second run sets the same fields.
