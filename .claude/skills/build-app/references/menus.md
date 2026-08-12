<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The menus and the recorded no — verbatim examples

_Read from `build-app`, steps 1b, 1c, 1e and 3: the wording for the brief
confirmations, the three menus with their presentation notes, the `docs/app.md`
entries that record a no, what a chosen 1c row switches on, the answer handling
written out per step, and the same question asked once per surface in step 3.
The rule itself — three answers, a `0` that is an answer and is not negotiated,
skipped entirely for an experiment — stays in the skill._

## Step 1b — what the customer gets to SEE

The confirmation when `docs/product-brief.md` already answers it:

> "The brief says: *a finished sales page with a hero image*. So each page needs
> one picture — generated (~$0.05) or uploaded. Generated?"

The menu:

```
What should your customer get to see?

  1  a picture with every challenge message     ✅   upload or AI      ~$0.05 each
  2  "how far you have come" as a bar           ✅   your own data     nothing
  3  a welcome video on the start page               embed             nothing
  4  a picture the participant uploads themselves    upload            storage

  0  none of it — text only

Give me numbers, or say "you choose" and I take the ones marked ✅.
```

**Two archetypes have a single ✅**, and for them this is one row rather than a
menu — ask it as a yes/no and move on. The ✅ column is the starting point, not
the whole list: add a row when this particular app obviously wants one (a
participant uploading their own picture, say). What you must not do is drop the
step because the list is short.

The recorded no — the entry for `docs/app.md` under *Decisions worth
remembering*. **It opens with a fixed sentence and the app's own words follow**,
the way Step 1e's entry does:

```md
- **No customer-facing visuals.** Decided on <date>: no pictures in the challenge
  messages — the vendor writes them themselves and has no picture material. If it
  comes back, the way in is `docs/visuals.md` → *Putting files in*.
```

🚨 **The string `No customer-facing visuals` is load-bearing** — it is the marker
that says pictures were declined rather than forgotten, and it is read back as
one: the skill `visuals` stops on it in its own Step 1 and does not propose the
step again. The sentence after it is this app's own, because "challenge messages"
is whatever its archetype calls them — write that in the app's words and leave
those three exactly as they are. **The date goes on that same line**, as it does in
Step 1e's entry: a refusal is read back so it can be REVOKED, and a reader that
finds no date beside the marker reports the "no" without one.

That entry is the whole reason to ask rather than to assume: without it the
same suggestion arrives again in three sessions, and somebody spends the
conversation a second time.

### The three answers, for this step

- **Numbers** → exactly those, and nothing else.
- **"you choose"** → the ✅ rows, no further question. Offer it in the menu
  itself every time; somebody who trusts the suggestion should not have to read
  four rows to say so.
- **`0`** → text only, and **write it into `docs/app.md`** under *Decisions
  worth remembering* — the verbatim entry is the one above.

**Two things not to do here.** Do not ask what a picture should *look* like —
that is the customer's business, at the moment they use the app, not a decision
to make at build time. And do not turn a `0` into a negotiation: it is an
answer, and a skill that argues with it teaches people to stop answering.

**Skip this step entirely for an experiment.** Same boundary as the SAAS rule in
`CLAUDE.md`: somebody trying the template out gets the small thing they asked
for, without a menu.

## Step 1c — what the app DOES alongside the customer

The confirmation when `docs/product-brief.md` already answers it:

> "The brief says: *a coach that reads each day's answer*. So each day's
> submission goes to a model and comes back with a reply — about $0.01 per
> participant per day. Shall I build that?"

The menu:

```
What should your app DO alongside your customer?

  1  reads each day's answer and replies to it    ✅   their answer + the day    ~1 cent each
  2  looks back over the week, names what changed ✅   their entries that week   ~2 cents each
  3  checks a plan before they commit to it            the plan they wrote       ~1 cent each
  4  produces the finished thing they came for         what they filled in       ~3 cents each

  0  none of it — they do the work, the app keeps it

Give me numbers, or say "you choose" and I take the ones marked ✅.
```

The ✅ marks come from the archetype's row, so they move with it — the two above
are the Drip/Automation defaults. **The prices are an order of magnitude, not a
quote:** what one call actually costs depends on the company the `companion`
task is bound to and on how much the customer wrote, and it ships on `"auto"`.
`node run.mjs ai-check` prints the real figure for this installation. Say the
rough number rather than nothing — somebody deciding whether to buy this needs
to know it is cents and not euros — and say that it is rough.

**The rows are read off the archetype, not invented.** The ✅ column is the
starting point: add a row where this particular app obviously wants one, and say
so. What you must not do is drop the step because the list is short — for an
archetype with a single ✅ this is one row and a yes/no question, not a menu, and
it is still asked.

The recorded no:

```md
- **No AI companion.** Decided on <date>: the vendor reads the answers
  themselves, and a per-use cost is not wanted. If it comes back, the way in
  is `build-app` step 1c.
```

**Why a "no" is written down, and why it is easier to give here than in 1b.**
This menu costs money **on every use, for ever** — so "no" is a legitimate
answer to a real cost, not a failure to persuade. And an unrecorded "no" is
proposed again three sessions later by an agent that has no way of knowing it
was settled, which spends the vendor's conversation a second time on a question
they already answered.

What gets switched on for a chosen row: `"enabled": true` in
`config/ai-companion.json`, an entry in `modules/companion/companions.ts` (the
instruction, which plan gates it, what one use costs, and a `load()` that reads
**this member's** subject and nothing else), `<CompanionPanel …/>` on the page,
the disclosure (`<AiDisclosure surface="companion" />` — a legal requirement,
not a nicety), and the access decision: `hasPlan()` for a plan, `spendTokens()`
for metered use, never a billing table.
[`docs/ai-providers.md`](../../../../docs/ai-providers.md) → *Working alongside
your customer* is the reference.

### The three answers, for this step

- **Numbers** → exactly those, and nothing else. Each one becomes an entry in
  `modules/companion/companions.ts` and a `<CompanionPanel companionId subject />` on the
  page that carries it. One surface, several call sites — never a second panel.
- **"you choose"** → the ✅ rows, no further question. Offer it in the menu
  itself every time; somebody who trusts the suggestion should not have to read
  four rows to say so.
- **`0`** → nothing is built, and it is **written into `docs/app.md`** under
  *Decisions worth remembering* — the verbatim entry is the one above.

**And it is not negotiated.** Same rule as Step 1b: a `0` is an answer, and a
skill that argues with it teaches people to stop answering.

**Two things not to do here.** Do not ask which model or which company — that is
`config/ai-models.json` and the skill `ai-providers`, the shipped binding is
`"auto"`, and it runs on whichever key is in the `.env`. And do not build the
companion now: this step decides, Step 2 gives it its columns and Step 3 its
surface. A panel built before the data model is the second migration this step
exists to avoid.

**Skip this step entirely for an experiment.** Same boundary as Step 1b and as
the SAAS rule in `CLAUDE.md`: somebody trying the template out gets the small
thing they asked for, without a menu.

## Step 1e — how should it look?

**First: this step is a precondition, and usually there is nothing to ask.** The
look belongs to phase 1 of the path, so `design` has normally already run by the
time `build-app` does. Two files answer the question outright, in this order:

| Read | What a find means |
|---|---|
| `docs/design.md` | this app has chosen. Name the direction it records in ONE sentence — that is the look Step 3's pages follow — and go to Step 1f |
| `docs/app.md` → *Decisions worth remembering* → **No custom identity** | the shipped look was chosen, deliberately and with a date. Say so in one sentence and go to Step 1f |

**Neither is re-opened here.** A recorded answer that gets asked again is an
answer the user stops trusting, and `design` Step 0 makes the same check for the
same reason. Whoever wants a change goes to `design`, which edits
`docs/design.md` first and applies it after.

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

## Step 3 — the same question, once per surface

**One question per result surface, asked while you build it:** wherever a page
hands the customer a RESULT, ask once whether it is a result to look at. Not a
menu this time — Step 1b already settled what this app shows. This is the
smaller, per-page version of it, and it exists because Step 1b decides the
product while this decides a page nobody thought about at the time.

**And one question per surface that takes work IN, asked the same way:**
wherever a page takes a submission, an answer, a photo or a plan from the
customer, ask once whether they should get back more than a confirmation that it
was saved. Not a menu — Step 1c already settled what this app does. This is the
page nobody thought about at the time.

Ask it **while that surface is built**, not later. The gateway that audits this
afterwards is `ux-gateway`, and a question deferred to it is a question asked
after the customer has already used the page.

A page that returns nothing but paragraphs is a decision, and so is a page that
answers work with nothing but "saved" — so make both visible: either put
something there, or note in `docs/app.md` why not.
[`docs/visuals.md`](../../../../docs/visuals.md) is the reference for the first
(what the store can hold, how a picture gets on a page, what one generated image
costs) and [`docs/ai-providers.md`](../../../../docs/ai-providers.md) → *Working
alongside your customer* for the second.
