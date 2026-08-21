# Content still needed

Nothing below was invented. Each item is either a marked placeholder in the
markup or a caption written only from what is visibly in the photograph.

## Events — how I read your notes

All seven dates are live in `calendar.html`. I checked every weekday against
the calendar and they all match what you wrote (28 Aug really is a Friday,
29 Aug and 22 Aug really are Saturdays). **All years assumed 2026.**

Five readings you should check, because your notes were shorthand:

| Your note | How I rendered it |
|---|---|
| `Our Space BNE ~ Common Ground` | Title **Our Space BNE**, venue **Common Ground**. Could be the reverse — tell me if so. |
| `Under My House exhibit ~ 5th Sept` | Title **Under My House**, **East Brisbane**, 6pm–10pm. |
| `Solo gig at Ventspace ... "Music Jam" event at 5pm` | Title **Music Jam**, role **Solo**, venue **Ventspace, South Brisbane**. |
| `Northern nsw arts factory` | **Arts Factory, Northern NSW**. |
| `Norman park bowls` | **Norman Park Bowls, Brisbane** (Brisbane confirmed by you). |

The end-of-September exhibition shows as **"Late Sept — TBA"**. It has no
`<time datetime>` because no date has been announced; it carries a `data-sort`
of 2026-09-30 purely so it lands between 5 Sept and 24 Oct instead of falling
to the bottom. Nothing on the page claims it happens on the 30th.

Band credits read **"Band"** rather than naming the instrument.

Still missing: everything for the **late-September exhibition**.

## Artwork metadata

Confirmed and on the site as given:

- **Protected Spirits**, 2026, ceramic
- **Untitled**, 2026, sold
- **Tower of Dreams**, 2022, NFS — appears twice by design: the detail shot
  (the candle-studded column) sits in Selected Work, and the full installation
  has its own section carrying the statement and the curator credit. Say the
  word if you'd rather it only appeared once.

Still needed:

- **"Vessels"** — the group of ridged vessels on the pale surface. Plain
  description, not a title. Needs a real title, year, materials, dimensions.
- **"Before firing and glazed finished piece"** — your caption, left as written.
- **Tower of Dreams** — has title, year, status and curator, but still needs
  **venue and city**. There's a TODO next to the curator credit.

Availability: per your note, anything not marked sold is treated as available
and nothing is displayed about it. Only *Untitled* carries a "Sold" tag, and
*Tower of Dreams* carries NFS.

## The beach passage

Set in `index.html` under `<!-- ── process ── -->`, with a comment telling
future editors not to copy-edit it.

Three corrections applied at your direction:

- "I creating" → **"I am creating"**
- "I hope around" → **"I hop around"**
- "that lead me here" → **"that led me here"**

**One left untouched:** "And now its a space to indulge in" — you didn't call
this one out, so I left it exactly as written. Say the word if you want `its`
→ `it's`.

I also render your `--` as a typographic em dash in "But one thing for sure —
is that this brings me joy."

`@spotwillows` is credited beneath the passage, linked to their Instagram.
There is a TODO in the markup noting the still is a placeholder for their
original video — swapping it means replacing one `<picture>` with a `<video>`.

## Decisions I made that you should confirm

- **Country acknowledgement.** The home footer reads *"Joshy Bloom works on the
  lands of the Turrbal and Jagera peoples. Brisbane ~ Magandjin."* You did not
  give me this line — I wrote it from the fact that Magandjin/Brisbane is
  Turrbal and Jagera/Yuggera country. **Please confirm the wording or replace it
  with Joshy's own.** An acknowledgement in someone else's voice should be
  theirs, not mine.
- **Pronouns.** Your bio uses "their practice", so the site avoids pronouns
  entirely rather than guessing. Alt text says "Joshy", never "he" or "they".
- **The `~` in "Brisbane ~ Magandjin"** is kept exactly as you wrote it.

## Images optimised but not placed

- `portrait-urban`, `portrait-balaclava` — the balaclava-with-ceramic shot is
  striking but tonally quite different from the rest.
- `archive-child`, `archive-toddler` — childhood photos, one with a microphone.
  These would make a genuine "origins" moment in the Sound section, but they are
  personal enough that I did not want to publish them without asking.

## Known gaps in the build

- **No mobile nav treatment yet.** Three links fit on one line down to 320px, so
  there is no hamburger and no JS for it. A fourth link would need revisiting.
- **No favicon, no sitemap.xml, no robots.txt.**
- **Calendar and Contact are thinner than Home.** Correct, responsive and
  on-system, but each could take another compositional pass.
- **Visual QA: done now**, on a real screen. All three pages at 1440px, and all
  three at 390px in an iframe (Chrome won't size a window below ~500px). No
  horizontal overflow anywhere; nav stays on one line at 390px; the calendar's
  generated markup is indistinguishable from the hand-authored version it
  replaced. Two things came out of it, both open:

  - **The hero title is below the fold on a short viewport.** The hero is
    `100svh` (787px of content) but a 13" laptop window gives ~610–750px, so you
    land on the page and see an empty field plus the top of one image — the name
    only appears once you scroll. It composes properly at 900px+ and on mobile.
    Worth capping the display size against viewport height, or pulling the title
    block up out of the bottom of the hero.
  - **`mix-blend-mode: difference` on the masthead washes out over mid-tone
    images.** Over the pale "Vessels" shot, WORK and CALENDAR drop to very low
    contrast. It's fine over dark and over flat background. A small scrim behind
    the nav, or swapping to a solid colour once past the hero, would fix it.

  Not bugs, for the record: the fixed masthead appears displaced and sections
  appear blank if you screenshot mid-smooth-scroll. Both are compositor
  artefacts of the capture, not layout.
