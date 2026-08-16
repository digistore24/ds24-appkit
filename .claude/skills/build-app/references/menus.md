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

**Everything below the two files above is the fall-through only** — nothing on
disk, which means the user came straight through the "Build my app" door and
skipped phase 1. Then the question is asked here, once, in the grammar of 1b–1d:
the material to look for first, the menu's one home in `design`, what a `0`
records, and why this menu alone carries no ✅ are in
[`menus-look.md`](menus-look.md). 🚨 **Read that file only in that case** — on
the normal path the two files above have already answered, and re-asking a
recorded answer is the one thing this step must not do.

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
