<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Step 1c — the menu, the confirmation, the recorded no, and what a row switches on

_Read from `build-app` step 1c, and from nothing else. The rule stays in the
skill; this is the wording, and what a chosen row becomes in code._

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
