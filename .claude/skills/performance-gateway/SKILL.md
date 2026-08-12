---
name: performance-gateway
description: The performance check for this app. Measures where it is slow and fixes it — response times per route, database queries and missing indexes, N+1 patterns, the connection pool, behaviour under ~100 parallel users, memory leaks, a blocked event loop, bundle size and Core Web Vitals — then reports. Use it after the security gateway and before the launch, and whenever somebody says "it is slow", "it times out", "the live app feels slow", "will it hold under load?".
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Performance gateway — measure, fix, measure again

The goal for the first version is plain and testable: **~100 concurrent users,
no errors, page and API responses fast enough that nobody notices them.** Not
"make it fast".

The method is the whole point: **measure → find the bottleneck → fix → measure
again.** Do not guess. Almost every slow app in this shape is slow for one of
three reasons — the connection pool, a missing index, or a query inside a loop —
and all three are visible in a measurement and invisible in a code read.

Written for **this** template: Next.js 16, postgres.js + Drizzle on Postgres, a
single Node process on Railway/Render/Fly/DigitalOcean. It names the actual
files, so it can be specific where a generic guide can only be plausible.

## How to use this skill

Eight checks. You do not have to know which one you want.

| # | Check | What it measures | Roughly |
|---|---|---|---|
| 1 | **`all`** | everything below, in the right order | 30–50 min |
| 2 | **`response`** | how long each route takes, one user at a time | 5 min |
| 3 | **`db`** | queries, indexes, N+1, the connection pool | 10–15 min |
| 4 | **`load`** | ~100 parallel users: errors, latency, throughput | 10 min |
| 5 | **`memory`** | server heap and browser heap — does it grow and never fall | 10 min |
| 6 | **`cpu`** | hot functions, a blocked event loop | 10 min |
| 7 | **`frontend`** | Lighthouse, Core Web Vitals, bundle size | 5–10 min |
| 8 | **`fix`** | fix the findings of the last report | depends |

**How to dispatch:**

- If the user already said what they want ("the dashboard is slow", "run a load
  test"), start that check. Do not show the menu first.
- Otherwise show the table, say that **`all`** is the one to run before a launch,
  and wait. A number, a name or a description all count.
- When somebody just says "it is slow": **`response`** first. It takes five
  minutes and it tells you which of the other checks to run.
- **You run the commands** — through your Bash tool, not by telling the user to
  type them. That is the rule for the whole template.

Every check ends the same way: findings with a severity → into the report →
offer to fix.

## Measure against a production build. Always.

`node run.mjs start` runs `next dev`, which compiles on demand, ships no
minified bundle and is several times slower than the real thing. Numbers taken
against it are not wrong by a little — they are meaningless, and they send you
optimising code that is already fast.

Before any measurement:

```bash
node run.mjs stop
npm run build
npx next start -p 3100        # or the deployed URL, which is better still
```

Load-test against port 3100, not 3000, so a `next dev` left running somewhere
cannot quietly answer instead. Where the app is already deployed, measure the
deployed instance: it has the real database latency, the real instance size and
the real network in it. Note in the report which one you measured — the numbers
mean different things.

The load generator and the app share a machine locally. That costs perhaps 20 %
and does not change any conclusion, but say it in the report rather than
pretending the number is clean.

## What counts as a finding

The ladder and the four-line `Where:` / `Why:` / `Fix:` / `Evidence:` format are
the shipped ones — [`docs/guidance.md`](../../../docs/guidance.md) → *One report
shape*. **Severity here is measured, not felt:**

| | Severity | Meaning |
|---|---|---|
| 🚨 | **CRITICAL** | The app falls over or is unusable. Fix before anything else. |
| ❌ | **HIGH** | Everyone notices. Fix before the launch. |
| ⚠️ | **MEDIUM** | Measurable, tolerable today, worse with more data or more users. |
| ℹ️ | **LOW** | Worth doing when convenient. |

The thresholds per check are in each check's reference file, linked from its
section below. They are the boundary, not a
target: an endpoint at 190 ms is not "fine", it is "not a finding".

**What counts as shown, here, is a number.** "Feels slow" is not a finding; "p95
1.9 s against a 300 ms threshold" is, and it goes on the `Evidence:` line. If you
cannot measure it, it goes in **Worth a look**, not in the count.

## 1 · `all` — the full pass

In this order. It is not arbitrary: each step tells you what to expect from the
next, and the database is the answer far more often than anything else.

1. **`response`** — the map. Which routes are slow at all.
2. **`db`** — the cause, in most cases.
3. **`load`** — does it survive 100 people. Run it after the database is fixed,
   or you spend the run measuring the same bottleneck a hundred times.
4. **`memory`** — leaks only show under sustained load, so straight after.
5. **`cpu`** — only if `response` or `load` pointed at it. Usually skippable.
6. **`frontend`** — independent of all of the above; run it whenever.

Then: one report, one summary, one offer to fix.

## 2 · `response` — how long each route takes

One user, no contention. This is the baseline everything else is measured
against.

The recipe — the autocannon commands per route, the session cookie for
signed-in pages, which routes to measure, and the p95 thresholds per severity
(including the p95-minus-p50 row people forget) — is in
**`references/checks-server.md`**; read that section before running this check.

For anything over threshold, find out where the time goes before optimising:
a slow database query (→ `db`), a call to an external API (an AI provider,
Digistore24 — cache it or make it not block the render), work on every render
that could be done once, or an oversized payload. Say which, with evidence.

## 3 · `db` — the usual culprit

The full recipe for this check is in **`references/checks-database.md`** — the
connection pool and its CRITICAL misconfigurations, finding missing indexes on
the tables the user added (`pg_stat_user_tables`, `EXPLAIN ANALYZE`), counting
queries to catch N+1 with its per-page thresholds, and the smaller habits:
column selection, pagination, the checkout-URL cache, pruning the append-only
tables. Read it in full when you run this check.

## 4 · `load` — ~100 parallel users

The proof. Against the production build, on the routes a real visitor hits.

The recipe — the autocannon commands, the thresholds at `-c 100`, the target
for the first version, and what to fix first when it breaks — is in
**`references/checks-server.md`**; read that section before firing the load.
It also names the two routes that must never be load-tested (`/api/ipn`, and
`/api/chat` against a real provider).

## 5 · `memory` — does it grow and never fall

Leaks are invisible in a five-minute test and fatal in a week. Measure during or
right after the load test, when the process has actually done work.

The recipe — how to measure the server heap (`--heap-prof`, or simply RSS
across a load run), what actually leaks in an app this shape, the browser-heap
procedure via DevTools snapshots, and the growth thresholds for both — is in
**`references/checks-server.md`**; read that section when you run this check.

## 6 · `cpu` — hot functions and a blocked event loop

Only worth running when `response` or `load` pointed here — a route that is slow
with the CPU idle is waiting on something, not computing.

The recipe — the `--cpu-prof` command, the blocking patterns that matter here
(synchronous I/O, sync crypto, JSON work on large payloads, a backtracking
regex) and the thresholds — is in **`references/checks-server.md`**; read that
section when you run this check.

## 7 · `frontend` — what the visitor actually waits for

The full recipe for this check is in **`references/checks-frontend.md`** — the
Lighthouse command, what to measure when there is no Chrome, which pages count
and why, the thresholds for Lighthouse score, Core Web Vitals and first-load
JS, and what is usually behind a bad number in this template. Read it in full
when you run this check.

## 8 · `fix` — fixing what was found

Same discipline as the security gateway, plus one rule of its own.

1. **Highest severity first**, and within that, the cheapest fix first. A pool
   setting is one line; a query rewrite is an afternoon.
2. **One change at a time, then measure again.** This is the rule that makes the
   whole skill work. Two changes and one improvement teaches you nothing about
   which one did it — and the other one may have made things worse.
3. **Write the before and after into the report.** "p95 1.9 s → 240 ms" is the
   only thing that proves the fix was a fix.
4. **`node run.mjs test`** afterwards. A query rewrite that changes behaviour is
   not an optimisation, it is a bug.
5. **Do not optimise what nobody waits for.** A 40 ms admin page used twice a
   week is not a finding, whatever the threshold says. Say so and move on.

## The report

Every run writes one, whether it found anything or not — so that "have we
already tested this under load?" is answerable in three months, and so the next
run has a number to compare against.

It goes to **`docs/reports/performance-YYYY-MM-DD.md`**, and its shape — the
header above the tally, the five sections in their order — is
[`docs/guidance.md`](../../../docs/guidance.md) → *One report shape*. Two things
are this skill's own:

- **The line that says where this ran is called `Measured:`**, because here it
  also carries the build and the load generator's own pessimism:

  ```markdown
  Checks:   response, db, load, frontend     (memory, cpu: skipped — no finding pointed there)
  Measured: production build, localhost:3100, commit a1b2c3d
            (load generator on the same machine — expect ~20 % pessimism)
  ```

- **A `## Numbers` table, above the findings.** It is the reason the next run has
  something to compare against, and `## Fixed in this run` carries a before → after
  for the same reason:

  ```markdown
  ## Numbers
  | Route | p50 | p95 | p95 @ -c 100 | errors |
  |---|---|---|---|---|
  | /            | 40 ms | 70 ms  | 210 ms | 0 |
  | /plans       | 60 ms | 120 ms | 340 ms | 0 |
  | /dashboard   | 180 ms | 1.9 s | 6.2 s  | 0 |
  ```

The spoken summary says what is slow, what was fixed and what the app now does at
100 parallel users; its straight yes or no is whether it is ready to launch.

## Accepted baselines

Some slowness is a deliberate trade. This skill's register is
**`docs/reports/performance-accepted.md`**, and the rules that go with it (not
counted, its own section, only the user accepts one) are
[`docs/guidance.md`](../../../docs/guidance.md) → *Accepted is not the same as
fixed*. Its table has two columns of its own, and they are the point:

```markdown
| Route / thing | Metric | Accepted | Why | By | Date | Review |
|---|---|---|---|---|---|---|
| /dashboard/admin/purchases | p95 1.4 s | ≤ 2 s | owner-only, twice a week | Anna | 2026-07-26 | when it has staff |
```

If the measured value drifts past what was accepted, it is a normal finding again
— **the acceptance covers a number, not a route.**

## STOP — get a human

- The fix requires spending money (a bigger instance, a managed pooler, a CDN).
  Name the option and the cost; do not book anything.
- The fix means deleting or archiving customer data. That is a `guardrails` STOP.
- The load test would run against the live app with real customers on it. Ask
  first, and prefer a staging instance.

## Next step

After a green performance gateway: **`compliance-check`** (legal), then
**`go-live`** (putting it online), then **`go-to-market`** (marketing).

`go-live` runs this again against the live instance — and that is the run whose
numbers actually count.
