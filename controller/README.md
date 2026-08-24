# Calendar controller

Lets Joshy add, edit and remove calendar dates by messaging a Telegram bot.

**The site stays static.** This Worker never serves a page and never talks to a
visitor. It edits `data/events.json` and `public/calendar.html` in the repo and pushes
one commit; the site Worker rebuilds from that commit. If this Worker is down,
misconfigured or deleted, joshybloom.com is completely unaffected — it is still
the same folder of HTML, CSS, JS and images it was before.

```
Joshy's phone
   ↓  Telegram
Telegram Bot API
   ↓  POST with a shared secret header
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
test.mjs       End to end with GitHub and Telegram faked out
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
Telegram's slash forms (`/help`, `/list`, and the first-run `/start`) reach the
same parser.

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

### 2. Create the bot

In Telegram, message [@BotFather](https://t.me/BotFather):

1. `/newbot` → give it a display name, then a username ending in `bot`
   (e.g. `JoshyBloomCalendarBot`). BotFather replies with the **bot token**.
2. Optional but nice: `/setdescription` and `/setcommands`, pasting

   ```
   help - what I understand
   list - show the calendar
   ```

No business account, no phone number, no verification, no approval wait. The
**bot** needs a username; you and Joshy do not.

> The bot cannot message you first — Telegram only lets it reply to someone who
> has messaged it. Send `/start` once from each phone that will use it.

### 3. Find the user IDs

The allowlist uses **numeric Telegram user IDs**, not phone numbers (a bot is
never told the sender's number) and not usernames (which can be changed or
given away).

Message [@userinfobot](https://t.me/userinfobot) from each phone and it replies
with the id. Or skip it: deploy first, message the bot, and read the
`rejected sender <id>` line out of `npx wrangler tail`.

Put them in `wrangler.toml`:

```toml
ALLOWED_USERS = "111111111,222222222"   # Zephyr, Joshy
```

### 4. Configure and deploy

Invent a webhook secret — any random string, e.g. `openssl rand -hex 32`. It is
shared between `setWebhook` and the Worker; it is not the bot token.

From `controller/`:

```bash
npx wrangler secret put TELEGRAM_TOKEN    # from BotFather
npx wrangler secret put TELEGRAM_SECRET   # the random string you just made
npx wrangler secret put GITHUB_TOKEN      # see below
npx wrangler deploy
```

Secrets are stored encrypted by Cloudflare. They are never written to
`wrangler.toml` and never appear in this repo.

**GitHub token:** a fine-grained personal access token
([settings](https://github.com/settings/personal-access-tokens/new)) scoped to
**only** `ZephyrBasic/JoshyBloom`, with **Contents: read and write**. Nothing
else. That is the entire blast radius if it ever leaks — someone could edit this
one repo, and every change is in the git history.

### 5. Register the webhook

Deploy prints a URL like `https://joshybloom-calendar.<subdomain>.workers.dev`.
Telegram has no handshake to answer; you just tell it where to post, once:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
        "url": "https://joshybloom-calendar.<subdomain>.workers.dev",
        "secret_token": "<TELEGRAM_SECRET>",
        "allowed_updates": ["message"]
      }'
```

Check it took:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

`pending_update_count` should be 0 and `last_error_message` absent. A
`401 bad token` there means `secret_token` and `TELEGRAM_SECRET` disagree.

### 6. Test

Message the bot from your own phone first, since you are on the allowlist too:

```
/start
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

1. **`X-Telegram-Bot-Api-Secret-Token`** — the string given to `setWebhook`,
   echoed back on every delivery and compared in constant time before the JSON
   is parsed. Nothing that doesn't know it can reach the parser.
2. **User allowlist** — the secret only proves *Telegram* sent the message, not
   who wrote it. Anyone who finds the bot can message it, so `from.id` is
   checked against `ALLOWED_USERS`. Anyone else is logged, ignored, and gets no
   reply at all.

This differs from the Meta version in kind: Telegram signs nothing, so gate 1 is
a shared secret rather than an HMAC over the body. Gate 2 was always the one
that decided *who* may edit, and it is unchanged — so in practice the security
is equivalent. Keep the bot token out of logs: it sits in the request path.

Titles and every other field are HTML-escaped on the way into the page, so a
message cannot inject markup. There is a test for it.

The Worker only ever writes those two paths, and always in one commit with the
parent it read, so a concurrent push is rejected rather than clobbered (it
retries once on top of the newer commit).

## Cost

Cloudflare Workers' free tier is 100,000 requests a day; this will use a handful.
The Telegram Bot API is free, with no per-message fee and no conversation
window to stay inside.

## Known limits

- **Text messages only.** A photo or voice note is ignored. Adding an image to
  an event would mean running it through `tools/build-images.py`, which the
  Worker can't do.
- **Past events are retired in the browser, not at build time**, exactly as
  before — `main.js` moves them to the archive on load. Nothing needs to run on
  a schedule.
- **Telegram may retry a delivery** it doesn't get a prompt `200` for. An
  identical `add` (same title and date) is absorbed rather than duplicated, but
  an `edit` sent twice applies twice — it is idempotent in effect, since the
  second run sets the same fields.
- **Edited messages are ignored.** Correcting a typo in a sent message does
  nothing; send a new one.
