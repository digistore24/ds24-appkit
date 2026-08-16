<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Step 1e, the fall-through — asking for the look here

_Read from `build-app` step 1e, via [`menus.md`](menus.md), and **only when
neither `docs/design.md` nor a recorded `No custom identity` is on disk** — the
user came straight through the "Build my app" door and skipped phase 1. On the
normal path the look was decided in phase 1, step 1e is one sentence, and this
file is never opened._

**Everything below is the fall-through only** — nothing on disk, which means the
user came straight through the "Build my app" door and skipped phase 1. Then the
question is asked here, once, in the grammar of 1b–1d. It is the cheapest of
them, and it comes after the others because it needs their answers: a coaching
app and a calculator wear their pages differently, and by now you know which one
this is.

**First, though, look for the MATERIAL** — in `config/brand.json` and in the
brief, where the intake's question 5 puts it ([`intake.md`](intake.md)). A logo,
house colours or a website address is *literally* what the menu's row 1
enumerates, so a find is not a hint to interpret:

| Found | What to do |
|---|---|
| a mark in `config/brand.json`, or a logo / colours / a site named in the brief | say in one sentence that this is row 1 — their own brand — and hand **1** over. Do not show the menu; they already answered its only unguessable question |
| the brief says explicitly there is none | row 1 is **out**. Show the menu and say so, so nobody picks a door that leads nowhere |
| the brief says nothing about it at all | show the menu whole |

🚨 **Material is not a decision, and finding none is not a "no".** Whether this
vendor wants a look of their own is theirs to say; no absence of a logo answers
it. So the menu is still shown in rows 2, 3 and 0 — the one thing that may skip
it is a `docs/design.md` or a recorded `No custom identity` above, and those are
decisions somebody made.

**The menu is not written here.** It has one home —
[`../../design/references/menu.md`](../../design/references/menu.md) — because
`design` asks the same question when it is entered on its own, and two copies of
one question are two wordings waiting to disagree. Read that file, present the
menu as it stands, and bring the answer back here.

**What you hand over is the NUMBER, not a look.** The rows are ways IN: nobody is
picking a taste, they are saying which door they come through, and every door is a
named branch of the skill `design` — the row→branch table is in that same file.
So `design` Step 0 takes the number and goes rather than asking a second time,
and a `0` is recorded in `docs/app.md` — from the same file, see below.

**Why this menu carries no ✅ when every other one does.** The ✅ in 1b, 1c and
1d is read off the archetype — the product's shape genuinely implies whether a
challenge message wants a picture. Here it does not. No archetype knows whether
this vendor has a logo, and a tick beside row 2 would be the agent guessing at
the one fact only the vendor has. So the recommendation is left out on purpose,
and the shortcut is written **into the menu** instead: **"you choose" is row
2** — somebody who has a brand says so, and somebody who has none wants help.
Do not put a ✅ back "for consistency".

### Look before you ask — and say which look you took

`docs/guidance.md` → *How a skill works*: **look before you ask**. Two files can
already answer part of this, and both are on disk:

| Consulted, in this order | What a find means |
|---|---|
| `config/brand.json` — `logo` not `null`, and the file it names under `public/brand/` | a mark is already installed, so this app has a brand and row 1 is where it goes |
| `docs/product-brief.md` — a website address in it | there is something to take the look off, which is row 1's third input |

**Only those two.** A colour the user named back in step 1b is deliberately not
consulted: it lives in the transcript rather than in a file, and a shortcut that
cannot be reproduced from the app itself behaves differently for the next agent
who opens it. It is not thrown away either — see the conflicting find below.

Three outcomes, and 🚨 **the second and the third are different sentences**:

- **A find** → do not show the menu. Confirm row 1 instead, naming the file or
  the address: *"`public/brand/logo.svg` is already in this app, so I would take
  the look off your own brand — right?"* Then **wait**. That is the menu
  answered out loud, not the menu skipped: a confirmation is still a question.
- **Looked, found nothing** → *"I looked: `config/brand.json` has no logo, and
  `docs/product-brief.md` names no website."* Then the menu.
- **Could not look** → *"This app has no `docs/product-brief.md` yet, so there
  was nothing to read."* Then the menu.

The last two arrive at the same place and must never sound the same. A vendor
whose brief was never written should learn that this is why they are being
asked, rather than concluding that the app looked at their material and thought
little of it.

**A conflicting find is row 1 with both inputs named back**, never a silent
choice between them: a hex named in step 1b *and* a logo on disk is *"you said
`#1F6F4A` earlier and there is a logo in `public/brand/` — I use both: the file
for the mark, your hex for the accent."* Branch A's own rule is that the input
is quoted back before anything is derived
([`../../design/references/own-brand.md`](../../design/references/own-brand.md)
→ *How to put the result to them*).

**The recorded no is not written here either.** The verbatim `docs/app.md` entry
lives beside the menu, in
[`../../design/references/menu.md`](../../design/references/menu.md) →
*The recorded no* — one owner for one entry, and the marker it opens with is read
back by this step and by `design` Step 0.

Unlike 1b and 1c this is not a per-use cost and not a column — it can be done
later without a second migration. It sits here anyway because the pages built
in Step 3 follow `docs/design.md` when it exists, and restyling six pages
afterwards is the expensive version of a decision that was free before the
first one. **A "no" is an answer and is not negotiated.**

**Skip this step entirely for an experiment.** Same boundary as 1b, 1c and 1d.
