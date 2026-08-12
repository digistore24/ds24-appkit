---
name: user-onboarding
description: Gives an app a real first session for its END USER — the person who paid: the activation event, this app's own first steps instead of the shipped blueprint, a welcome survey or a comeback nudge, and a check of what exists. Use this when the user says "my customers sign up and never come back", "nobody finishes the setup", "how do I explain my app to new users", "people buy and then do nothing", "nobody uses it after they buy", "I want a welcome tour / first steps", or when the dashboard still shows the two shipped blueprint steps. The audit twin is `ux-gateway` (check first-run); building what it found is this skill.
requires: 0.4.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# User onboarding — the first session, built on purpose

Every app built on this template greets its new customer with whatever the
blueprint happened to say, unless somebody decides otherwise. This skill is
that decision: **what should the person who just paid do first, and what does
the app do to get them there?**

**The reference is [`docs/onboarding.md`](../../../docs/onboarding.md).** Read
it; do not restate it here. It carries the patterns, the archetype table, what
not to build, and the reasoning behind every rule this skill applies. The
mechanics of the shipped checklist — derived state, no dismiss — are
[`docs/ux.md`](../../../docs/ux.md) §1 and `lib/onboarding/rules.ts`; where
anything here seems to disagree with those two, they win.

## How to use this skill

| | What it does | Roughly |
|---|---|---|
| **1 · `decide`** | pin the activation event and pick the patterns for THIS app | 10 min |
| **2 · `steps`** | replace the blueprint checklist with this app's real steps | 20–30 min |
| **3 · `survey`** | a 2–4 question welcome survey whose answers change something | 20–30 min |
| **4 · `nudge`** | one reminder for the customer whose activation never happened | 20 min |
| **5 · `check`** | the onboarding that already exists: does it mean this app? | 10 min |

- If the user already said which one ("nobody finishes the setup" → `steps`;
  "can we ask new users what they want?" → `survey`), **start that one and skip
  the menu**.
- Otherwise show the table, say that **`decide`** is where somebody who has not
  thought about it yet should start, and **wait**.
- "My customers sign up and never come back" with nothing else → **`decide`**.
  It is ten minutes, and the answer to that sentence is almost never another
  feature — it is an activation event nobody ever named.
- **You run the commands and you open the pages** — through your Bash tool and
  the browser, never by handing the user a command to run.

**There is deliberately no "run them all".** `decide` is the default instead,
and it is the item that says which of the others this app even wants. An app
that gets a survey, a wizard and a nudge because they were on a menu has an
onboarding built for the menu, not for its customers —
[`docs/onboarding.md`](../../../docs/onboarding.md) §10 is one table precisely
so that most cells can say "skip it".

**First, always — look before you ask:**

- `docs/app.md` → an `Activation:` line under the decisions, and any recorded
  "no" (no survey, no gamification). **A recorded no is an answer** — say you
  found it and move on; do not propose it again as if it were new.
- `app/dashboard/page.tsx` → are the checklist steps still the two shipped
  blueprint ones? That single glance separates "was never designed" from "was
  designed and may need revisiting".
- `db/schema.ts` → the app's own tables. The activation event lives in one of
  them, and reading them first is what lets you propose candidates instead of
  asking an open question.
- `docs/product-brief.md` → who the customer is and what they bought. An
  onboarding conversation that has not read it proposes steps for the wrong
  person.

## 1 · `decide` — the event, then the patterns

The one question everything else hangs on
([`docs/onboarding.md`](../../../docs/onboarding.md) §1): **what has a customer
done the moment you would bet they stay?**

Read the schema first, then put 2–3 candidates to the user in their own terms,
as a numbered menu with a default marked and a `0` row:

```
Your app stores courses, lessons and completions. The moment I would bet a
customer stays:

  1  they finished their first lesson            ✅ my suggestion
  2  they finished the whole first module
  3  they merely opened lesson 1 — weakest, counts curiosity as commitment

  0  something else — tell me in a sentence

Give me a number, or say "you choose" and I take 1.
```

Then read the archetype row in
[`docs/onboarding.md`](../../../docs/onboarding.md) §10 and propose the pattern
set the same way — which checklist steps, whether a survey or a nudge earns its
place here, whether the wizard test (§5 there) even applies. Most cells should
stay unbuilt, and saying so is part of the proposal.

Whatever is decided — including every "no" — goes into `docs/app.md` under
*Decisions worth remembering*, with the `Activation:` line in the shape §1
shows. That line is the contract every other item below reads.

## 2 · `steps` — the checklist becomes this app's

Needs an `Activation:` line; if there is none, run `decide` first — steps
derived from no event are steps derived from taste.

1. **Work backwards from the event**: 3–5 milestones, the event itself last,
   every step with an `href` to where it is done
   ([`docs/onboarding.md`](../../../docs/onboarding.md) §2 has all four rules).
2. **Each step's `done` is a query against real state** — the shipped steps in
   `app/dashboard/page.tsx` are the shape to copy, and the comment block above
   them says what must not change. No new table, no stored tick; if a step
   seems to need one, the step is wrong, and `lib/onboarding/rules.ts` explains
   why.
3. **Check the empty states point the same way** (§3 there): the page a step
   links to must, when empty, offer the same action the step names.
4. Texts in **both** `messages/de.json` and `messages/en.json` under
   `onboarding`.
5. Verify like any page work: `npm run typecheck && npm run test`, then
   `node run.mjs start`, sign in as a **member** — a second made-up address,
   never the owner, because the owner sees an app the customer does not — walk
   `/dashboard` with the checklist in its undone state, then
   `node run.mjs errors`.
6. One entry in `docs/app.md`: the steps, each step's `done` predicate as code,
   and the date.

## 3 · `survey` — only if the answer drives something

The first sentence of this item is a refusal:
**a survey whose answers change nothing does not get built**, however nicely it
was asked for — [`docs/onboarding.md`](../../../docs/onboarding.md) §4. So the
item starts with the question "what would the app DO differently per answer?",
and if the honest answer is "nothing yet", the finding is "no survey", written
into `docs/app.md`, and this item ends well.

When there is a real branch:

1. **2–4 questions**, each one the app branches on. Propose them as a menu and
   wait — the questions are customer-visible product surface.
2. **The answer is a column** on the app's own table (or `users`), via
   `node run.mjs db-generate` → `db-migrate` like every schema change. Never an
   answers side-table with UI logic hanging off it.
3. **A `<Card>` on the dashboard rendered while the column is null**, kit
   components only, visibly skippable, texts in both language files. Its
   disappearance is derived, like everything on that page.
4. Same verify loop as `steps`, plus: skip the survey as the member and confirm
   the app is whole without an answer.
5. `docs/app.md`: the questions, the column, what each answer changes.

## 4 · `nudge` — one reminder, then let go

The recipe is [`docs/onboarding.md`](../../../docs/onboarding.md) §9 and the
rules are [`docs/cron.md`](../../../docs/cron.md); this item only sequences
them:

1. Needs the `Activation:` line (`decide` first) — the job selects accounts
   whose event is absent after N days, read from the same tables the checklist
   reads.
2. One entry in `lib/cron/jobs.ts`: idempotent because it **records that it
   sent** (a `nudgedAt` column, written in the same pass as the send), detail
   line numbers-only, throws on failure.
3. **STOP before anything that mails: consent.** Say in one sentence that this
   is a marketing-adjacent mail, that a single service reminder about a
   purchased product is the defensible shape, and that anything beyond it needs
   a purpose in `config/consent.json` — then let the user decide.
   `compliance-check` owns that line; do not settle it yourself.
4. Verify: `node run.mjs cron --job <id>` twice — the second run must send
   nothing and say so in numbers. Then `node run.mjs cron --list` and read the
   detail line back.
5. `docs/app.md`: the job id, N, and the one-mail-ever rule as written.

## 5 · `check` — does the onboarding that exists mean this app?

Narrow on purpose: `ux-gateway` (check `first-run`) walks the whole first five
minutes; this item audits the onboarding *machinery* on an app that already
has some. Findings in the four-line shape (*Where · Why · Fix · Evidence*), the
severity ladder from `docs/guidance.md` → *How a skill works*:

| | Severity | What |
|---|---|---|
| ❌ | **HIGH** | The checklist still holds the two shipped blueprint steps while the app does something of its own — the app's only advice to a new customer is "buy something". The same standing finding `ux-gateway` check 2 raises; quote it, do not re-derive it. Fix: item `steps` |
| ❌ | **HIGH** | An `onboarding`/`seen`/`dismissed` table, column or cookie in `db/schema.ts` or the pages — a stored copy of a derivable truth. Fix: derive it; `lib/onboarding/rules.ts` is the reasoning, [`docs/ux.md`](../../../docs/ux.md) §1 the rule |
| ❌ | **HIGH** | A tour overlay or auto-firing modal on first dashboard load — [`docs/onboarding.md`](../../../docs/onboarding.md) §6's ladder replaces it |
| ⚠️ | **MEDIUM** | A step with no `href`, or steps that do not end at the activation event, or more than 5 of them |
| ⚠️ | **MEDIUM** | Sample data that ticks a step or counts toward activation (§8 there) — the checklist is lying |
| ⚠️ | **MEDIUM** | A survey column nothing reads (§4's test, failed after the fact) |

Also run the §12 measurement once with the user — activation rate as one SQL
query over grants × the event's table — and put the number in the verdict, so
the next run has something to compare against.

The verdict is written, dated, to **`docs/reports/onboarding-YYYY-MM-DD.md`**
(create the folder if it is missing): findings, the number, what was fixed,
what stays open. A check that found nothing writes that down too — that is
what makes "did we already look?" answerable.

## The rules

1. **A "no" is an answer, and it gets written down** — `docs/app.md`, under the
   decisions, with the date. Most cells of the archetype table SHOULD be a no.
2. **Nothing here stores a tick.** Every "have they done it?" is read from
   state; the one legitimate stored fact is the nudge's own `nudgedAt`, which
   records an action the app took, not a truth about the customer.
3. **Anything the customer will SEE is proposed, never assumed** — the steps,
   the survey questions, the nudge mail. Numbered menu, `0` row, "you choose"
   offered in the menu (`docs/guidance.md` → *How a skill works*).

## What comes next

- Steps, survey or nudge built → **`ux-gateway`** (check `first-run`) looks at
  the result the way a paying stranger does.
- The app is a course whose activation is a finished lesson → the elements the
  customer DOES are the skill **`learning-activities`**.
- The nudge raised the consent question → **`compliance-check`** (check
  `consent`) settles it properly.
