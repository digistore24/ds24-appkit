<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The menu — which way into a look of its own

**This file is the menu's only home.** The same question is asked in two places —
`build-app` step 1e, and the skill `design` when it is entered on its own — and
both read it from here. Whoever changes the wording changes it in this file and
nowhere else; a user who answers this menu in one place and lands in the other
must never meet a second version of it.

## The menu

Present it as it stands, then **wait**:

```
How should this app look?

  1  I already have a brand — a logo, house colours, a website, or just
     the hex code if that is all you have
  2  nothing yet — I look at two or three comparable products and put
     named directions to you
  3  just one thing — a colour, a serif headline. Nothing else moves
  0  keep the shipped look (petrol on warm grey, Figtree with Source Serif 4 headings, a monogram tile in ink)

A number, please. Nothing here is marked ✅: whether you already have a
brand is not something I can read off your product. "You choose" takes 2.
```

## The rows are ways IN, not looks

Nobody is picking a taste here. They are saying which door they come through, and
every door is a **named branch of the skill `design`** — which is what makes a
number handed over from `build-app` usable at all, instead of the same menu asked
a second time.

| Row | Where it goes |
|---|---|
| **1** | `design` **Step 1A** — their own brand: the logo, the stylesheet, the site, or the bare hex |
| **2** | `design` **Step 1B** — two or three comparable products, then named directions |
| **3** | `design` **Branch C** — that one thing, the matching slice of Step 3, nothing else |
| **0** | nothing runs, and it is recorded in `docs/app.md` under *Decisions worth remembering* |

## The three answers

- **A number** → exactly that row's branch, and nothing besides it.
- **"you choose"** → **row 2**. The shortcut sits **in** the menu rather than in
  prose, because somebody who trusts the suggestion should not have to read four
  rows to say so. No row carries a ✅: no archetype knows whether this vendor has
  a logo, so a tick beside row 2 would be the agent guessing at the one fact only
  the vendor has.
- **`0` — "none of it"** → the shipped look stays, and it is **written down**,
  dated, in `docs/app.md`. **A `0` is not negotiated**: it is an answer, and a
  skill that argues with it teaches people to stop answering.

## The recorded no — the verbatim entry

**This is the entry's only home too**, for the same reason as the menu: it used
to stand in two files at once (`design` Step 2 and `build-app`'s own reference),
differing only in where the line broke. Both read it from here now. Write it into
`docs/app.md` under *Decisions worth remembering*, with the real date:

```md
- **No custom identity.** Decided on <date>: the shipped look (petrol on warm grey, Figtree with Source Serif 4 headings, a monogram tile in ink)
  stays. If it comes back, the way in is the skill `design`.
```

🚨 **The string `No custom identity` is load-bearing** — it is the marker that
says a look was declined rather than forgotten, and it is read back as one:
`build-app` step 1e treats it as an answer and does not re-ask, and `design`
Step 0 stops on it. Reword the sentence after it if you must; leave those three
words exactly as they are.

**Skip the menu entirely for an experiment** — same boundary as everywhere else
in this template: somebody trying it out gets the small thing they asked for,
without a menu.
