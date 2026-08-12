<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Interactive elements — games, checks, and work that gets judged

> Needs template 0.9.0 or newer — `node run.mjs update` brings the text, not
> the code. `modules/activity/` and `<ActivityPanel>` are what this file builds
> on; an older clone reads a description of code it does not carry.
>
> **And it is a MODULE.** A fresh app does not have it — `node run.mjs module
> add activity`, then `node run.mjs db-migrate`. Until then its code is in the
> tree and does nothing: no texts, no error messages, nothing wired up.
> [`docs/modules.md`](modules.md) says what that means.

An online course that is videos plus PDFs asks nothing of the learner. What
sells now is the element the learner *does* — a game, a check, an exercise
that answers back — and in this template every such element is three pieces
that already exist:

| Piece | Where |
|---|---|
| the entry — id, gate, cost, attempts, `load()`, `grade()` | `modules/activity/activities.ts` (ships empty; its header carries the three rules and a worked example) |
| the surface — resume, submit, announcements, feedback | `<ActivityPanel activityId subject>` + `useActivity()`, both imported from `@/lib/modules/component-registry` (the code is `modules/activity/components/activity-panel.tsx`; its header carries the five game-UI rules) |
| the result — attempts, score, passed, resume point | `activity_results`, written only by the server (`modules/activity/results.ts`) |

**The seam is for every element — the free, unlimited, unjudged one first
of all.** "Attempt-limited" is what `maxAttempts` makes of an element, not
what the framework is: recipe A's game has `maxAttempts: null` and no pass
mark, and it is the framework's home case, not its exception. The smell to
stop at: a second server action that grades — a hand-rolled practice path
beside the seam is a second place that must keep answers server-side, and
the second one is where they leak.

The one sentence that shapes everything: **a submission from a browser is
data about an attempt, never the result of one.** `grade()` is the only
place a score comes into being, and the solution never leaves the server —
a quiz with its answers in the client bundle renders correctly, returns 200,
passes every test, and is worthless the day one buyer opens the dev tools.

`subject` is the unit's slug (`"lektion-3"`) — the same string a
`<CompanionPanel>` on that unit uses. One lesson, one string.

## Which element belongs to which course shape

The course shapes are [`docs/courses.md`](courses.md); this is the map back:

| Shape | Elements that fit |
|---|---|
| **1 — self-study course** | a game or a check per block (recipes A, B); progress over the blocks (D); the look back at the end (E) |
| **2 — week-by-week programme** | a self-check closing each week (B); progress from the weeks themselves, not from elements (`docs/courses.md` shape 2) |
| **3 — accompanied workshop** | at most an optional self-check (B) — **the submission is not an element**: a person reads it, nothing grades it, and it lives in the workshop's own `submissions` table (recipe C says where the line runs) |

## Recipe A — the learning game

The hardest case, so it is first: local state, interruption, a score the
browser must not be able to claim. And note what it is NOT: not an exam.
`maxAttempts: null`, no `passMark`, `costsTokens: 0` — free, unlimited
practice IS this recipe. Do not build a lighter path beside it.

**The entry** (in `ACTIVITIES` — the registry header's worked example is this
game at full length):

```ts
{
  id: "silben-spiel",
  requiresPlan: "kurs_komplett",
  costsTokens: 0,
  maxAttempts: null,                       // a game is replayable
  async load({ memberId, subject }) {
    // the words WITHOUT their syllable boundaries — the split is the
    // solution, and the solution stays here
  },
  async grade({ memberId, subject, submission, previous }) {
    // parse the answers (data, never a verdict), count on the server,
    // final only when every word is answered — and the score only on the
    // final verdict: a scored checkpoint is a free probe
  },
}
```

**The surface** — the page renders the panel, the game UI is yours:

```tsx
import { ActivityPanel } from "@/lib/modules/component-registry";

<ActivityPanel activityId="silben-spiel" subject={unit.slug}>
  <SilbenSpiel />
</ActivityPanel>
```

🚨 **Import from the registry, never from `@/modules/activity/…`.** Your page
lives under `app/`, and `modules/boundary.test.ts` refuses any file there that
names a module directly — the generated barrel is what that refusal points at.
This used to say the module path, and following it turned your own
`npm run test` red about a page you wrote correctly. `useActivity()` comes from
the same place.

`SilbenSpiel` is a client component built on `useActivity()`: `data` (what
`load()` returned), `resume` (JSON-plain — store positions, never
judgements), `submit()` guarded by `pending`, `announce()` for state changes
a screen reader should hear. The five rules in the panel header are the
build spec: **keyboard first** (a drag without a key path is the naive build
and a BFSG defect), one live region, a time limit needs an alternative,
controls `disabled={activity.pending}`, and a model-grading `grade()`
inherits the companion's disclosure duty.

**Checkpoints** are verdicts with `final: false`: they save the resume point,
count no attempt, and must carry no score.

## Recipe B — the check with a pass mark

A quiz is a game with one round and a judgement. The differences, and they
are all registry fields:

```ts
{
  id: "abschluss-check",
  requiresPlan: "kurs_komplett",
  costsTokens: 0,
  maxAttempts: 3,        // refused BEFORE grade() — a refused attempt costs nothing
  passMark: 0.7,         // one definition of passing (rules.ts → passedFrom)
  // load(): the questions, NEVER the expected answers
  // grade(): compare on the server, return { final: true, score, maxScore }
}
```

`passed` derives from the pass mark unless `grade()` says otherwise, and it
is **sticky**: having passed does not un-happen on a failed retake —
`score`/`attempts` still tell the latest story. "Not judged" is `null`, not
`false`; the panel renders the difference.

## Recipe C — work that is handed in and judged

Somebody submits something, and a judgement comes back. **Decide first who
judges — the answer picks the storage:**

- **A person judges** (the workshop shape): this is NOT an activity. The
  submission is prose, nobody grades it, nothing is metered — it goes in the
  app's own `submissions` table, and the whole build is
  [`docs/courses.md`](courses.md) shape 3. The human path is the product,
  not the fallback: for these vendors, a text only a machine has read is a
  text nobody has read.
- **The app judges** (a code exercise, a structured task): an activity whose
  `grade()` does the judging — deterministically, or through a model via
  `runTask` (then the disclosure duty applies, and
  [`docs/ai-in-product.md`](ai-in-product.md) §2.2 is the reading pattern).
  🚨 **A submission on its way to a model goes through
  `buildFencedRequest()` from `@/lib/ai/customer-text` first** — never straight
  into a `system` block or a bare user message you assembled yourself. It
  returns the `{ system, messages }` you hand to `runTask`, with what the
  customer wrote inside `<customer-text …>` and the standing rule beside it that
  names that text content rather than instruction. It is **core** code and needs
  no module installed; the companion is merely its first caller, and reading a
  submission is the surface prompt injection actually pays on. The field the
  submission goes in is `work` — `ask` and `about` travel outside the fence and
  are yours to word. Mechanics:
  [`docs/ai-providers.md`](ai-providers.md) → *Working alongside your customer*.
  Metering is the registry's `costsTokens`; the charge happens only for a
  recorded, final outcome — a lost race never costs the customer a token.
- **Both** exist in one app without touching: the workshop's submission in
  its table, an optional self-check (recipe B) beside it — and the
  self-check judges its own questions, never the submitted text.

## Recipe D — progress over a course

Derived, never stored: `activityProgress(results, expected)` in
`modules/activity/progress.ts` counts completions against what the page
currently expects and names the next open element. There is no progress
column and none is missing — a reset drops the count by itself, a removed
unit stops counting the moment the page stops expecting it. Render the
fraction the way `components/onboarding-checklist.tsx` does
(`role="progressbar"`) — copy the shape, not the component.

## Recipe E — the look back at the end

When `activityProgress(...).fraction` reaches 1, say something worth the
course: what they did, where they were strong, what to keep practising —
assembled from their own `activity_results` rows (scores, attempts,
completions), optionally read by a companion
([`docs/ai-in-product.md`](ai-in-product.md) §2.5).

**No certificate with evidentiary weight.** A look back describes; a
document that claims to *prove* competence makes a promise the vendor — not
the template — has to keep, to employers and in disputes. If a vendor wants
one anyway, that is a product decision to record in `docs/app.md` with its
wording checked by `compliance-check`, not a recipe to copy.

## What this file refuses to promise

- **No element in the template.** `ACTIVITIES` ships empty; an element the
  template put in front of a vendor's customers is one nobody chose.
- **No client-side grading, ever** — not for "just a practice quiz" either.
  The practice quiz trains the buyer to open dev tools before the real one.
- **No streak mechanics or engagement scoring in the recipes.** What a
  learner did is data about their ability (`docs/data-protection.md` §8b);
  recording every keystroke to gamify it is a different product with a
  different privacy answer, and it is a vendor's deliberate decision, not a
  default.
