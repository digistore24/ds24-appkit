<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Server checks — `response`, `load`, `memory`, `cpu`

The detail recipes for the four server-side checks of the performance gateway.
The menu, the severity ladder and the finding format are in `SKILL.md`; the
severity icons below refer to that ladder, and every measurement runs against
a production build as `SKILL.md` describes.

## 2 · `response` — how long each route takes

```bash
npx autocannon -c 1 -d 5 http://localhost:3100/
npx autocannon -c 1 -d 5 http://localhost:3100/plans
npx autocannon -c 1 -d 5 http://localhost:3100/api/healthz
```

Signed-in pages need a session cookie. Sign in with a real account, take the
`authjs.session-token` cookie from the browser, and pass it:

```bash
npx autocannon -c 1 -d 5 -H "cookie: authjs.session-token=<value>" \
  http://localhost:3100/dashboard
```

Measure the routes that matter: the home page, `/plans`, `/dashboard`,
`/dashboard/billing`, whatever the user built themselves, and `/api/healthz` as
the floor — it does almost nothing, so it tells you what the framework costs
before your code does anything at all.

| Metric | ℹ️ LOW | ⚠️ MEDIUM | ❌ HIGH | 🚨 CRITICAL |
|---|---|---|---|---|
| p95, API route | > 200 ms | > 500 ms | > 1 s | > 3 s |
| p95, page | > 500 ms | > 1 s | > 2.5 s | > 5 s |
| p95 minus p50 | > 200 ms | > 500 ms | > 1 s | > 3 s |

The third row is the one people forget. A route whose p50 is 80 ms and whose p95
is 1.4 s is not a fast route with noise — something intermittent is happening,
usually a cache miss or a connection wait, and it will get worse under load.

## 4 · `load` — the launch's crowd, 100 parallel users by default

```bash
npx autocannon -c 100 -d 20 http://localhost:3100/
npx autocannon -c 100 -d 20 http://localhost:3100/plans
npx autocannon -c 100 -d 20 http://localhost:3100/api/healthz
```

`-c 100 -d 20` is 100 open connections for 20 seconds. **The 100 is the
template's default target, not a property of the app** — nothing caps users at
it, and an app that passes carries more. If the customer named their own number
at the top of `SKILL.md` (a launch mail to 4,000, a webinar that sends everyone
at once), that number goes in place of the 100 in every command and every
table header below, and the report's `Load target:` line says which it was and
where it came from. Compare each result with the same route's single-user
number from `response`: the gap *is* the finding.

**Do not load-test `/api/ipn`.** It writes orders and grants. If you want to
know it holds, test it with invalid signatures — the rejection path is the
expensive one anyway, and it changes nothing.

**Do not load-test `/api/chat`** against a real provider unless you mean to pay
for it. Say so rather than quietly skipping it.

| Metric at `-c 100` | ℹ️ LOW | ⚠️ MEDIUM | ❌ HIGH | 🚨 CRITICAL |
|---|---|---|---|---|
| errors / timeouts | any | > 0.1 % | > 1 % | > 5 % |
| p95 latency | > 500 ms | > 1 s | > 3 s | > 10 s |
| p99 latency | > 1 s | > 2 s | > 5 s | > 15 s |
| p95 vs. single user | 3× | 5× | 10× | 25× |

**The target for the first version: zero errors, zero timeouts, p95 in the
three-digit milliseconds on dynamic pages.** Anything else is a finding, not a
result.

When it breaks: the pool first (a p95 that is a clean multiple of the single-user
time is queueing, near enough always the pool or the database), then indexes,
then the instance size. Fix one thing, measure again. Two changes at once and
you have learned nothing.

**When the app outgrows the number it was tested at**, the same three knobs
apply in the same order, and the host's own graphs are where the queueing shows
first. Rerunning this check at the new number is the whole procedure — there is
no switch in the app that was set to 100.

## 5 · `memory` — does it grow and never fall

**Server:**

```bash
node --heap-prof node_modules/next/dist/bin/next start -p 3100
# put load on it, stop it, open the .heapprofile in Chrome DevTools
```

Cheaper and usually enough: watch RSS across a load run and see whether it comes
back down after the load stops.

What actually leaks in an app this shape:

- A `setInterval` with no `clearInterval` — cron helpers, polling.
- A `Map` used as a cache with no eviction. `lib/rate-limit.ts` holds timestamps
  per key in memory by design and is bounded by its window — that is fine and
  documented. A new unbounded one is not.
- Event listeners added per request.
- A large object captured in a module-level closure.

| Server heap growth | ℹ️ LOW | ⚠️ MEDIUM | ❌ HIGH | 🚨 CRITICAL |
|---|---|---|---|---|
| after load, not released | > 10 MB | > 50 MB | > 200 MB | > 500 MB |

**Browser:** the dashboard is a long-lived client session, so it can leak too.
Open it, take a heap snapshot in DevTools, navigate between dashboard pages ten
to twenty times, snapshot again. Growth that never comes back is the finding —
detached DOM nodes and listeners that survive a route change, usually a
`useEffect` with no cleanup.

| Browser heap after 10 navigations | ℹ️ LOW | ⚠️ MEDIUM | ❌ HIGH | 🚨 CRITICAL |
|---|---|---|---|---|
| growth | > 5 MB | > 20 MB | > 50 MB | > 100 MB |

## 6 · `cpu` — hot functions and a blocked event loop

```bash
node --cpu-prof --cpu-prof-dir=.dev node_modules/next/dist/bin/next start -p 3100
# put load on it, stop it, open the .cpuprofile in Chrome DevTools
```

Node is single-threaded per process: anything synchronous blocks **every**
request, not just its own. So the findings that matter are the blocking ones.

- **Synchronous I/O in a request path** — `readFileSync`, `execSync`. The
  assistant's handbook is read from `content/knowledge/` (`lib/ai/knowledge.ts`);
  reading it per request rather than once is **HIGH**.
- **Crypto in the request path.** `scrypt` in `lib/credentials/hash.ts` is
  deliberately expensive — that is the point of a password hash, and it is
  correctly the async form. A synchronous variant is **CRITICAL** under load.
- **JSON work on large payloads** on every request — cache it or narrow it.
- **A regex that backtracks.** Also a security finding (ReDoS); mention it in
  both reports.

| | ℹ️ LOW | ⚠️ MEDIUM | ❌ HIGH | 🚨 CRITICAL |
|---|---|---|---|---|
| one function, share of CPU | > 10 % | > 25 % | > 50 % | > 75 % |
| synchronous block | > 10 ms | > 50 ms | > 200 ms | > 1 s |
