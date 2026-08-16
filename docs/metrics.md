<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Metrics — onboarding funnel, retention and split tests

This module answers three questions about the app it is installed in, and no
others: **where do new customers stop**, **how many are still here after N
days**, and **did the change I made help**.

Everything it holds lives in this app's own database; nothing is sent anywhere.

## What it is not

- **Not an analytics tool.** No page views, no sessions, no devices, no
  referrers. It records milestones somebody's code decided are milestones.
- **Not a tracker.** 🚨 There is no pixel, no beacon and no `localStorage`
  anywhere in it, and there must never be one. This app needs no consent banner
  because a purchase runs on Art. 6(1)(b) and nothing it puts on the device
  goes beyond what is strictly necessary ([`docs/compliance.md`](compliance.md)
  § 2). Writing to the device would move it under § 25 TDDDG — for numbers this
  module already has on the server.
- **Not the core's job** — and the core argues against it. See the next
  section, which states that case rather than hiding it.

## The template argues against this module. Read that first.

Two shipped documents say you should not need what is here, and they are worth
reading before installing it:

- [`docs/onboarding.md`](onboarding.md) § 12 — *"What NOT to add for
  it: an analytics tool, a tracking cookie, an events table written on every
  page view."*
- [`docs/retention.md`](retention.md) § 6 and § 7 — the recurring
  action is **already a dated row in one of the app's own tables**, so the
  return rate is one SQL query over `grants` × that table. § 7 goes further:
  a `lastSeenAt` column would be *"the events table § 6 refuses wearing a
  column's clothes"*, and § 8 lists *"add analytics to answer 'are they coming
  back?'"* as a mistake.

**Both are right for most apps, and this module is a deliberate deviation.**
What it accepts and what it buys:

| The core's position | Why this module still stores rows |
|---|---|
| The action is already a dated row — query it | True where the app HAS such a row. This module is sold into apps whose schema nobody here has seen; a `track()` call is one line at the place the thing happens, while a per-app mapping of table and column has to be re-derived whenever the schema moves, and breaks silently when a column is renamed |
| An events table is refused | Both refusals name *"written on every page view"*. Nothing here is on the read path: a row appears only where somebody's code called `track()` for a named milestone |
| Two SQL queries answer it | They answer **today**. § 6 also asks you to *"measure before and after a change, on the same window"* — and a step that leaves no row (seeing one side of a welcome screen leaves no trace by design) has no before to compare |
| The banner stays gone | It does. Server-side only, nothing on the device, no consent question — that is not negotiable here either |

**The price, stated plainly:** one table of personal data, its section in
`docs/data-protection.md`, both Art. 15 exports, an erasure path and a prune
job the operator has to switch on. `metrics_daily` carries none of that — it
holds no member column, which is what lets the curve outlive the rows it came
from.

If your app's milestones are all dated rows you already have, **the honest
answer is the core's**: write the two queries and skip this module.

## Two tables

| | |
|---|---|
| `metrics_events` | one milestone one member reached, and when. **Personal data.** Pruned on `retentionDays` |
| `metrics_daily` | the same thing counted per day, event and variant. **No member column**, kept for good |

The `metrics-rollup` job fills the second from the first. That is what lets the
events be pruned on a retention window while the before/after curve survives —
the history you optimise against outlives the personal data behind it.

`metrics_events` appears in **both** Art. 15 exports (the member's own download
and `node run.mjs data-export`). Deleting an account nulls the member link and
keeps the row: *eleven people reached step two in March* is a fact about the
product, not about any of the eleven.

## Setting it up

The module ships **switched off**, because a funnel nobody has defined shows a
row of zeroes and reads as a broken product.

1. `node run.mjs module add metrics`
2. `node run.mjs db-migrate`
3. Decide what **activated** means in this app — one event, readable from the
   app's own tables, narrow ([`docs/onboarding.md`](onboarding.md) § 1).
   Write it into `docs/app.md` as `Activation: …`.
4. List the milestones in `modules/metrics/config.json` under `funnel`, in order.
5. Call `track()` at each place where one of them actually happens.
6. `"enabled": true` in that same file.
7. 🚨 **Add both jobs to `config/cron.json`** — see *The two jobs* below. Without
   this step nothing is ever rolled up and nothing is ever pruned.
8. `node run.mjs module sync && npm run test`

The skill `metrics` walks all eight with you and writes steps 4 and 5.

> ⚠️ **The switch is `modules/metrics/config.json`, not `config/metrics.json`.**
> It is the one module of the six that keeps its switch inside itself, and it is
> a leftover: this module was written to be shipped separately from the template,
> where a switch in the core's `config/` would have turned a customer's own
> `npm run test` red — `modules/boundary.test.ts` §1c explains those files one by
> one against a hard-coded map, and a file not in that map is unexplained by
> construction.
>
> It ships in the tree now, so that reason is gone. Moving the file to
> `config/metrics.json` and adding the §1c entry is open, and the trade is a
> one-off migration for every app that already holds the file. Until then the
> cost is that `node run.mjs module list` cannot print the path, and this page is
> the answer instead.

## Recording a milestone

```ts
import { track } from "@/lib/modules/server-exports";

await track("first-report-created", memberId);
await track("finished-setup", memberId, { experiment: "welcome-copy" });
```

🚨 **The barrel, never `@/modules/metrics/lib/track`.** The two lines compile
identically and only one of them is allowed: a file of the app's own naming a
module directly is the hub coming back, and `modules/boundary.test.ts` §1 refuses
it by name in the app that wrote it. `lib/modules/server-exports.ts` is generated
from this module's `serverExports` declaration and carries `track` from the moment
the module is installed — the same door `askCompanion()` comes through
([`docs/modules.md`](modules.md) → *What a module joins by declaring itself*). It is
**server-side only**: nothing that imports from it may be a client component.

⚠️ **If `track` is not in that barrel, this app's copy of the module predates
template 0.34.0** — it shipped with no `serverExports` at all, which is what made
the module installable and not usable, and `node run.mjs update` brings text and
never `modules/`, so it cannot repair the manifest for you. Add
`"serverExports": { "track": "lib/track.ts" }` to `modules/metrics/module.json`
and run `node run.mjs module sync`.

- Call it **where the thing happens**, once. The funnel counts distinct
  members, so a duplicate does not bend a percentage — it widens the gap
  between `members` and `events` in the rolled-up day, which is the signal that
  a call site fires more often than intended.
- It **never throws and never blocks**. A measurement that can fail the thing it
  measures is worse than no measurement.
- `memberId` may be `null` for something before sign-in. The row still counts at
  the top of the funnel; it simply belongs to nobody.

⚠️ **The funnel starts empty and fills from the day you install it.** Members
who completed a step last month have no row for it — the event is recorded when
it happens, not reconstructed. Where the app's own table carries a timestamp for
that step, a one-off backfill is possible and the skill will offer it; where it
does not, the honest answer is that the first weeks are the baseline.

## Split tests

An experiment is a block in `modules/metrics/config.json`:

```json
{ "id": "welcome-copy", "variants": [{ "id": "a", "weight": 1 }, { "id": "b", "weight": 1 }] }
```

`variantFor(memberId, experiment)` decides the side — a hash of the pair, so the
same member is always on the same side, with **no assignment table** to migrate
and no way for two servers to disagree. The experiment id is part of the hash so
that two tests do not split the population down the same line; otherwise the
second would be measuring the first.

🚨 **The module refuses to name a winner it cannot support.** Below
100 exposed *and* 10 conversions **per variant**, the reading is
`not-enough-data` and the page says so in a sentence instead of showing two
percentages and an arrow. Above it, a two-proportion z-test at 95% decides. It
is a guardrail, not a statistician: it assumes the groups are independent and
that nobody changed the app mid-flight, and it corrects for nothing when several
tests run at once. Every way it can be wrong is a reason to run longer, never to
trust a smaller number.

## Looking at it

Two surfaces, one set of numbers — the page and the command share the queries
(`lib/queries.mjs`) and the judgements (`rules.mjs`), so they cannot disagree.

| | |
|---|---|
| `/dashboard/admin/metrics` | the operator's page: funnel, cohorts, split tests. Owner only, no action, every filter a link |
| `node run.mjs metrics-report` | the same reading as text |
| `node run.mjs metrics-report --json` | **the form the coding agents in the project read.** Carries the verdict *and* the thresholds behind it, so an agent cannot take two rates for a result |
| `node run.mjs content-check` | how many rows each table holds — and whether the rollup has ever run, which is the state worth noticing |

`--period 7d|30d|90d|all` on the command, `?period=…` on the page. Exit codes:
`0` nothing to fix, `1` the config has problems (an experiment may be silently
not running), `2` could not look — no `DATABASE_URL`, or the database did not
answer. 🚨 The last one is its own state on purpose: *"there is nothing here"*
and *"I could not see"* must never render alike.

## The two jobs

| | |
|---|---|
| `metrics-rollup` | recomputes the last three days into `metrics_daily`. Idempotent: it upserts on `(day, event, experiment, variant)`, so a second run recomputes a day instead of doubling it, and a missed run repairs itself |
| `metrics-prune` | deletes `metrics_events` rows older than `retentionDays`, in batches |

🚨 **Both ship disabled, and neither starts on its own.** A module may not write
`config/cron.json`, and a job with no entry there would inherit the core's
default — enabled and daily — which would mean installing this module started
deleting rows on somebody's server. So the operator adds them:

```json
"metrics-rollup": { "enabled": true, "everyMinutes": 720 },
"metrics-prune":  { "enabled": true, "everyMinutes": 1440 }
```

⚠️ **Until that is done, `retentionDays` is a promise nobody keeps** — every
milestone row is held for ever — and the rolled-up curve that is supposed to
outlive the personal data is never written at all. `node run.mjs cron --list`
says what is running; `content-check` shows events with no rolled-up days, which
is exactly this state.

Twelve hours for the rollup rather than twenty-four is deliberate: due-ness is
measured from the last FINISH, so a daily job drifts later every day and
eventually skips a calendar day in silence ([`docs/cron.md`](cron.md)).
The rollup recomputes rather than accumulates, so a second run costs one query.

Neither sends mail. `ops-watchdog` is the only producer of operational
reporting in this app, and a second one would either swallow its findings or put
two mails on one morning.
