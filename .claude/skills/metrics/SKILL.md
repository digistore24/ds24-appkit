---
name: metrics
description: Sets up the `metrics` module — the onboarding funnel, return by cohort and split tests. Use this when the user says "where do people drop out", "how many come back", "does my onboarding work", "I want to A/B test my welcome screen", "measure my funnel", "did that change help", or after `module add metrics`.
requires: 0.33.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Metrics — the funnel, the return, and whether the change helped

An app that has customers has three questions about them: **where do new ones
stop**, **how many come back**, and **did the thing I changed help**. This skill
answers them for THIS app — which milestones are worth counting here, where the
counting goes, and what may honestly be concluded from the result.

It is the playbook for the `metrics` module. The module's own page is
[`docs/metrics.md`](../../../docs/metrics.md); this file is the order of the work.

> 🚨 **Step 0 can end with "do not install this."** That is not politeness. The
> template argues against a metrics table
> ([`docs/retention.md`](../../../docs/retention.md) § 6–7,
> [`docs/onboarding.md`](../../../docs/onboarding.md) § 12) and for most apps it is
> right. Run step 0 honestly, or you will spend a week building a second copy of
> numbers the app already had.

## How to use this skill

Say which step you want, or start at `whether` and walk down. Each step ends
with something in the repository — a line in `docs/app.md`, a `track()` call, a
config entry — never with a plan for later.

| | |
|---|---|
| `whether` | does this app need the module at all? |
| `event` | the milestones worth counting here |
| `wire` | where the `track()` calls go |
| `on` | switch it on, and the two jobs nobody starts for you |
| `test` | run one split test properly |
| `read` | the weekly reading, and what it may say |

## 0 · `whether` — does this app need the module at all?

Ask three questions, in this order, and **write the answers down** in
`docs/app.md`. Two of them can end the conversation.

**1. What is the recurring action, and does it leave a dated row?**
[`docs/retention.md`](../../../docs/retention.md) § 1 makes you name it; § 7 shows
that if it is a dated row — a completion, a submission, a spend — then "did they
come back" is one SQL query over `grants` × that table. No module, no table, no
prune job. **If every milestone this app cares about is already a dated row, say
so and stop here.** Write the two queries instead; that is the better answer and
the operator should hear it from you rather than discover it later.

**2. Is there a step that leaves no row anywhere?** Seeing one side of a welcome
screen, reaching a page and not finishing it, being offered something and
declining — these leave no trace by design. A funnel that cannot see them is a
funnel with a hole where the drop-out is.

**3. Do they want to run split tests, or to compare against a month that has
already been overwritten?** Both need history the app does not otherwise keep:
state answers *how many are past step two now*, never *what the rate was in
March*.

**Install when 2 or 3 is a yes.** Otherwise do not.

## 1 · `event` — the milestones worth counting here

**Name the activation event first**, and take the definition from
[`docs/onboarding.md`](../../../docs/onboarding.md) § 1: it is **theirs, not
yours** ("finished the first lesson", never "visited the dashboard"), it is
**narrow** (one row, one moment, one date), and it is the **last** step of the
funnel. Write it into `docs/app.md`:

```
Activation: the member has completed their first lesson.
```

Then the funnel: **three to five steps, ending at activation.** Fewer than three
and there is no drop-out to find; more than five and every step is a rounding
error. Order them the way a customer meets them. Put the ids into
`modules/metrics/config.json`:

```json
"funnel": ["signed-up", "saw-welcome", "created-first-plan", "activated"]
```

⚠️ **The steps are independent predicates, not a path.** A later step can be
larger than an earlier one — somebody can top up a balance without ever buying a
plan — and the dashboard marks that rather than hiding it. If you see it, the
order is usually wrong.

## 2 · `wire` — where the `track()` calls go

```ts
import { track } from "@/lib/modules/server-exports";

await track("created-first-plan", session.user.id);
```

🚨 **That import path is not interchangeable with `@/modules/metrics/lib/track`.**
A file of your own naming a module directly is the hub coming back, and
`modules/boundary.test.ts` §1 refuses it BY NAME — in your app, about your own
action, with a green typecheck. The barrel is generated from this module's
manifest, so `track` is in it as soon as `node run.mjs module add metrics` has
run.

⚠️ **If `track` is not in `lib/modules/server-exports.ts`, this app's copy of the
module predates template 0.34.0** — the manifest shipped without the declaration,
which is what made the module installable and not usable. `node run.mjs update`
brings text and never `modules/`, so it cannot repair this for you. Add the line
yourself and re-generate:

```json
"serverExports": { "track": "lib/track.ts" },
```

```bash
node run.mjs module sync
```

Four rules, and the first is the one that gets broken:

1. 🚨 **Never on a read path.** Not in a page render, not in a layout, not in a
   `GET`. A milestone is something that HAPPENED — put the call in the server
   action or the handler that did it, **after** it succeeded. A call on render
   fires again on every refresh and turns the funnel into a page-view counter,
   which is the thing both shipped documents refuse.
2. **The member comes from the session**, never from a form field or a URL. The
   same rule the rest of this app follows for account actions.
3. **Once, where it happens.** The funnel counts distinct members, so a
   duplicate does not bend a percentage — but it widens the gap between
   `members` and `events` in the rolled-up day, which is how you find a call
   site that fires more than intended.
4. **It never throws and never blocks.** That is the module's promise, not
   yours to re-implement — do not wrap it in a `try`.

Finally: **add a section for `metrics_events` to
[`docs/data-protection.md`](../../../docs/data-protection.md)** in this app. The
module carries its own Art. 15 exports and its erasure path, but the inventory
that the privacy policy is written from is the app's, and no module can write
it.

## 3 · `on` — switch it on, and the two jobs nobody starts for you

```
modules/metrics/config.json → "enabled": true
```

🚨 **Then add both jobs to `config/cron.json`.** They ship disabled, because a
module may not write that file and a job with no entry there would inherit the
core's default — enabled and daily — and start deleting rows on somebody's
server the moment the module was installed:

```json
"metrics-rollup": { "enabled": true, "everyMinutes": 720 },
"metrics-prune":  { "enabled": true, "everyMinutes": 1440 }
```

⚠️ **Until that is done, `retentionDays` is a promise nobody keeps** — every
milestone row is held for ever — and the rolled-up curve that is supposed to
outlive the personal data is never written at all.

Then prove it, in this order: `node run.mjs module sync && npm run test`,
`node run.mjs restart`, `node run.mjs smoke`, `node run.mjs errors`, and finally
call `/dashboard/admin/metrics` up yourself. A green test is not a rendered page.

⚠️ **The funnel starts empty and fills from today.** Members who passed a step
last month have no row for it. Say that out loud — an operator who expects
history and sees zeroes concludes the module is broken. Where the app's own
table carries a timestamp for that step, offer a one-off backfill; where it does
not, the first weeks are the baseline.

## 4 · `test` — run one split test properly

An experiment is a block in `modules/metrics/config.json`:

```json
{ "id": "welcome-copy", "exposure": "saw-welcome", "goal": "activated",
  "variants": [{ "id": "a", "weight": 1 }, { "id": "b", "weight": 1 }] }
```

**Two events, not one.** `exposure` is who was in the test — the denominator —
and `goal` is who then succeeded. Call `track()` with `{ experiment: "…" }` at
**both** places. With only the goal marked, every variant reads 100% and the
comparison cannot differ.

Four rules:

- **One test at a time.** The module corrects for nothing when several run at
  once, and two overlapping tests measure each other.
- **Decide the change before you look.** Write down what you would do with each
  outcome; an experiment read after the fact finds whatever it is asked for.
- 🚨 **Do not stop it early because it looks good.** Checking repeatedly and
  stopping at the first favourable moment is how a coin flip becomes a finding.
  Pick a window, then read it.
- **Two variants.** Above two the module shows the counts and no verdict, on
  purpose — three pairwise comparisons at 95% each are not 95%.

## 5 · `read` — the weekly reading, and what it may say

```bash
node run.mjs metrics-report --period 30d          # for a person
node run.mjs metrics-report --period 30d --json   # for an agent
```

The JSON carries the verdict **and** the thresholds behind it, so nothing
downstream has to re-derive the rule. Read it against **last month's own
number**, never against a published benchmark — those come from a product with a
different price, buyer and cadence.

🚨 **Say "not enough data" when the module says it.** Below 100 in the test and
10 successes per variant there is no result, only two numbers. The module
refuses to name a winner there and so do you; the correct advice is *let it run
longer*, not *it looks like b*.

Two readings that need opposite fixes
([`docs/retention.md`](../../../docs/retention.md) § 6): people who activate and
never return mean the product does not repeat — a mail cannot add a reason to
come back. People who return and then stop together, at a similar point, mean
something ends there, usually the content.

## The rules

- **Server-side only. No pixel, no beacon, no `localStorage`, ever.** This app
  needs no consent banner, and that position is worth more than a chart.
- **Never on a read path.**
- **Never a raw member id from a form** — the session decides who acted.
- **The verdict is a sentence, not a percentage with an arrow.**
- **The switch is `modules/metrics/config.json`**, not `config/metrics.json` —
  the module's page says why.
- **A milestone id is a closed list.** No free text, no customer input: the
  column is read back into a heading.

## What comes next

`user-onboarding` builds what the funnel showed was missing; `ux-gateway`
audits the first five minutes the funnel is measuring. When the numbers say the
product does not repeat, that is `docs/retention.md` § 1 and § 5 — a question
about the product, which no measurement can answer for you.
