---
name: learning-activities
description: Gives an app the elements its customer DOES — a learning game, a check with a pass mark, an exercise that answers back, graded on the server; also whether a course needs one at all, and an audit. Use this when the user says "my people never finish the course", "they watch the videos and drift away", "I want a quiz in lesson three", "can the course have a game", "how do I test whether they understood it", "I need somewhere people really PRACTISE", "free practice by topic and mock exams", "I want to see who passes and where they are weak", or when a course hands out videos and asks nothing back. For the course's overall shape use `courses`; for a companion that talks, `ai-companion`.
requires: 0.9.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Interactive elements — what the customer does, and how it is judged

A course that is videos plus PDFs asks nothing of the learner. This skill
adds the asking half: a game, a check, an exercise — built on the seam the
template ships, where **the verdict is only ever reached on the server**.

The reference is [`docs/learning.md`](../../../docs/learning.md) — the five
recipes, the shape→element map, and what the catalogue refuses to promise.
**This skill does not repeat it.** Where a fact is needed, that file is named
and the conversation moves on.

## Step 0 — is the module part of this app?

The seam is a **module**: it lives in `modules/activity/` and a fresh app does
not have it, the same way a fresh app has no community. Nothing below works
until it does.

```bash
node run.mjs module list        # is "activity" installed?
node run.mjs module add activity
node run.mjs db-migrate         # its table
```

If `module list` shows it under *"present but not installed"*, its code is in
the tree and does nothing: no texts, no error messages, nothing wired up. One
command fixes that, and it belongs at the start of this skill rather than in the
middle of the first recipe — see [`docs/modules.md`](../../../docs/modules.md).

## How to use this skill

Four items. You do not have to know which one you want.

| # | | What it does | Roughly |
|---|---|---|---|
| 1 | **`decide`** | should this course carry elements at all — and which, where | 10 min |
| 2 | **`build`** | build one recipe: registry entry, `grade()`, the game UI in the panel | 30–60 min |
| 3 | **`gate`** | who may use it, attempts, pass mark, and what one graded try costs | 10 min |
| 4 | **`check`** | the one that already exists: is the solution in the bundle, is it playable by keyboard | 15 min |

**How to dispatch:**

- If the user already said what they want ("a quiz in lesson three"), start
  that item. Do not show the menu first.
- Otherwise show the table, say that **`decide`** is where somebody who has
  not thought about it starts, and **wait**.
- *"My people never finish the course"* with nothing else: **`decide`**.
- **You run the commands** — through your Bash tool, not by telling the user
  to type them. That is the rule for the whole template.

## First, always

Look before you ask (`docs/guidance.md` → *How a skill works*):

- `modules/activity/activities.ts` — which entries exist. Empty is the shipped
  state, not a defect.
- `docs/app.md` — was a decision **against** elements recorded? Then say so
  and stop; a recorded "no" is an answer, not an opening position.
- Which course shape this app is (`docs/app.md`, or the tables in
  `db/schema.ts`) — the shape→element map in `docs/learning.md` says what
  fits, and shape 3's submission is **never** an element.

## 1 · `decide` — should it, and which?

The question, in the vendor's terms, as a numbered menu with cost per row
(the Step-1d grammar from `build-app` — "you choose" takes the defaults,
`0` is a real answer and goes into `docs/app.md` with its reason):

> Your course delivers — what should your customers DO in it?
>
> 1. a self-check closing each block/week (they see what stuck) — free per use
> 2. a learning game on the hard part (they practise, not re-read) — free per use
> 3. a graded exercise the app judges (code, structured tasks) — free, or tokens if a model judges
> 4. you choose — I take what fits your shape
> 0. none of it — the course stays as it is
>
> A game or check costs nothing per use unless a model grades it; what it
> costs you is the building of it, once.

Free, unlimited, unjudged practice is row 1 and 2 — **the framework's home
case**, `maxAttempts: null` and no pass mark. Never build a lighter grading
path beside the registry "because it is only practice": a second path is a
second place that must keep answers server-side.

Write the outcome into `docs/app.md` — the chosen elements with their units,
or the `0` with its reason.

## 2 · `build` — one recipe

Recipes A–C in [`docs/learning.md`](../../../docs/learning.md) are the spec;
the seam is three pieces and the order is fixed:

1. **The entry** in `modules/activity/activities.ts` — id (`[a-z0-9-]`, ≤ 40),
   `requiresPlan`, `costsTokens`, `maxAttempts`, `passMark`, `load()`,
   `grade()`. The file header's three rules are the contract; the third is
   the whole point: **the solution never leaves the server.** `load()` sends
   the questions, never the expected answers; `grade()` compares on the
   server; a checkpoint carries no score.
   🚨 **A `grade()` that sends the submission to a model builds its request
   with `buildFencedRequest()` from `@/lib/ai/customer-text`, never by hand.**
   That is CORE code — no module to install — and it hands you the
   `{ system, messages }` `runTask` takes, with the submission inside
   `<customer-text …>` and the rule beside it that names it content rather than
   instruction. The submission goes in `work`; `ask` and `about` are appended
   outside the fence and must be your own words, never the customer's. Judging
   what somebody wrote is the surface prompt injection actually pays on, so
   assembling the prompt yourself is the one shortcut here that costs something.
2. **The tables** the entry reads — per app, `build-app` Step 2 shape
   (`db-generate` → read → `db-migrate`).
3. **The surface** — `<ActivityPanel activityId subject>` around your game
   UI, which reaches everything through `useActivity()`. The panel header's
   five rules are the build spec for the UI; **keyboard first** is rule 1,
   and a time limit needs an alternative.

`subject` is the unit's slug — the same string a companion on that unit
uses. Then: `npm run typecheck && npm run test`, `node run.mjs start`, play
it yourself **with the keyboard only**, `node run.mjs errors`, and one entry
in `docs/app.md` (the access gate as code).

## 3 · `gate` — who, attempts, price

All registry fields, never props (a gate the browser sends is no gate):

- `requiresPlan`: a key from `config/digistore-products.json`. `null` is
  first-class and means every signed-in member: the free practice element.
  Never invent a fake key to avoid it.

  🚨 **ONE key, and the course it sits in may be sold under SEVERAL.**
  `config/course.json` → `planKeys` is a list, because one offering is one
  Digistore24 product per billing interval; this field is not. So an activity
  inside a course sold monthly and yearly that names one of the two refuses the
  other half of its buyers — the element simply is not there for them, behind a
  page that renders. Until this registry takes a list, the honest answers are
  `null` (every signed-in member, and the course's own gate has already decided
  who reaches the page) or a key EVERY buyer of that course holds. Do not pick
  one of the two intervals and hope.
- `maxAttempts` + `passMark`: a check judges, a game usually does not
  (`maxAttempts: null`). Refused attempts happen BEFORE grading and cost
  nothing.
- `costsTokens`: only when each graded try costs the vendor something (a
  model in `grade()`). The charge lands only on a recorded, final outcome —
  and then `billing-modes` is the skill for the token side.

## 4 · `check` — the one that already exists

For each entry in `ACTIVITIES`, in order:

1. **The solution's location.** Read `load()` and the client components: do
   the expected answers, the split, the correct options appear anywhere the
   browser can see — including checkpoint verdicts and the resume `state`?
   Build the app (`node run.mjs build`) and search the bundle for a known
   answer string. 🚨 CRITICAL if found: the element renders, returns 200,
   passes every test, and is worthless.
2. **The keyboard.** Play the element with the keyboard alone — every
   interaction, to the final verdict. ❌ HIGH if stuck: a consumer product
   without a key path is a BFSG defect, not a nice-to-have.
3. **The announcements.** Does the verdict reach a screen reader (the
   panel's live region or a Callout), and does the game announce its own
   state changes through `announce()`?
4. **The gates.** `requiresPlan` set? `maxAttempts` where the element
   judges? A model in `grade()` → disclosure mounted (`legal-check` knows),
   and the submission fenced — `buildFencedRequest()` from
   `@/lib/ai/customer-text`, with the text in `work` and nothing the customer
   typed in `ask` or `about`? ❌ HIGH for a hand-built prompt: nothing goes
   red, and the one string an attacker fully controls reaches the model as
   instruction.

Findings in the house shape (🚨/❌/⚠️/ℹ️ · Where · Why · Fix · Evidence),
and the verdict goes dated into `docs/reports/` **every time** — a solo
`check` too. Anything that produces a verdict writes it down; "have we
already done that?" needs an answer next month.

## The rules

- **Anything the customer will SEE or DO is proposed, never assumed** — the
  menu in `decide`, once, before the data model.
- 🚨 **Judging paying learners at a distance is a licensing question before it is
  a product one.** *Überwachung des Lernerfolgs* is one of the elements that make
  a course **Fernunterricht** under § 1(1) Nr. 2 FernUSG, and such a course needs
  state authorisation before it may be sold at all. ⚠️ **Which recipe you are on
  changes the answer**: an auto-graded check (recipe B) is the case Digistore24's
  own criteria call harmless, while a `grade()` a **model or a person** performs,
  recipe C, and a community where members ask about the material are the ones
  that carry it. This skill advertises the trigger ("I want to see who passes and
  where they are weak"), so it owes the user the question with it: say once that
  it exists, name what is on disk, and hand it to `compliance-check` —
  [`docs/compliance.md`](../../../docs/compliance.md) §6.5. **Never answer it
  yourself**; it is a lawyer's and an authority's call, exactly like the
  high-risk fork that skill already refuses to decide.
- **A `0` is recorded and not argued with.**
- **Shape 3's submission is not an element.** A person reads it; the line is
  recipe C.
- **Put the page's access check in ONE function and call it from everywhere** —
  the page, and later the content source that makes the page findable. On
  template 0.18.0 and newer the assistant can LINK to a page she looked up, and
  then a source more permissive than its page hands a non-buyer a link that
  bounces them back — an existence oracle no gate here can catch. Two
  `hasPlan()` calls that agree today are two that can drift. The checklist is
  [`docs/content-source.md`](../../../docs/content-source.md) → *The five
  things that make a link work*.

## What comes next

An element that judges belongs in the UX pass (`ux-gateway` — its keyboard
check now has something to check) and the security pass (`security-gateway`
— the bundle search). Name whichever has not run and offer to start it.
