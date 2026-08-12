<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Scheduled jobs — things the app does without being asked

Some work has no request behind it. Deleting data that has aged out, sending a
reminder, reconciling something overnight. This is where that lives.

```ts
// lib/cron/jobs.ts — add an entry, and it is scheduled.
{
  id: "remind-expiring-plans",
  describe: "Mail members whose access ends in three days.",
  async run({ now, settings }) {
    const sent = await remindExpiring(now);
    return `${sent} reminder(s) sent`;   // one line of numbers, stored and shown
  },
}
```

```json
// config/cron.json — and when it runs.
"remind-expiring-plans": { "enabled": true, "everyMinutes": 1440 }
```

That is the whole mechanism. Everything below is the reasoning and the traps.

> ℹ️ **`remindExpiring()` is a sketch, not a function in this tree.** The example
> is written as a mail job because that is the shape rule 1 below is about; there
> is no such job in the template, and searching for one is a wasted five minutes.
> A real mail job's two missing halves — how it reaches the operator and how it
> avoids sending twice — are `notifyOperators()` and `claimSend()`, under rule 1.

---

## The short version

| | |
|---|---|
| The jobs | `lib/cron/jobs.ts` → `CRON_JOBS` |
| When they run | `config/cron.json` |
| Who runs them | the app itself, while it is up (`lib/cron/scheduler.ts`) |
| What ran, and when | `node run.mjs cron --list` |
| Run one now | `node run.mjs cron --job <id>` |
| The other way in | `POST /api/cron` with `Authorization: Bearer $CRON_SECRET` |
| Where the record lives | the `cron_runs` table, one row per job |

---

## How it runs

**The app schedules itself.** `instrumentation.ts` starts a timer at server
start; once a minute it asks the database which jobs are due and runs them.
Nothing has to be configured, on any host, and a fresh install cleans up after
itself from the first day.

That is a deliberate change from how this template used to work. There was a
cron *endpoint* and a line in `docs/DEPLOY.md` telling the Operator to point
their host's scheduler at it — a step at the end of a deploy, different on every
platform, for a job whose failure is completely invisible. Nothing breaks when
nobody schedules it. The table just grows and the data just stays, and the first
sign of trouble is a GDPR question you cannot answer.

**The endpoint is still there**, for the Operator who would rather their
platform decide the hour:

```json
// config/cron.json
{ "enabled": false }
```

```
POST https://YOUR-DOMAIN/api/cron
Authorization: Bearer <CRON_SECRET>
```

Same registry, same locking, same records. There is no second list of jobs
anywhere.

**`node run.mjs cron` calls that endpoint on your local app.** It does not
reimplement the jobs, deliberately: two implementations agree until the day they
do not, and a job you triggered by hand would prove nothing about the path
production takes. So a manual run exercises the real authentication, the real
lock and the real bookkeeping.

---

## The schedule is an interval, not a cron expression

`everyMinutes`, and that is all:

```json
"prune-ai-usage": { "enabled": true, "everyMinutes": 1440, "retentionMonths": 12 }
```

| | |
|---|---|
| `enabled` | `false` switches this job off. Everything else stays. |
| | ⚠️ **`--job <id>` runs it anyway.** Naming a job by hand is an instruction, not a schedule, so `"enabled": false` does not protect a job from `node run.mjs cron --job prune-ai-usage`. If you switched a deletion off because you want the data, do not then force it. |
| `everyMinutes` | 1440 = daily, 60 = hourly, 10080 = weekly. Minimum 1. |
| anything else | passed to the job as `settings`. The scheduler never reads it. |

**There is no cron parser here, and that is a decision.** A parser is either a
dependency or a bug, and "at 03:15 on Tuesdays" is not something any job in this
app needs. A job is due when it last **finished** longer ago than its interval —
measured from the finish, so a job slower than its own interval never queues up
behind itself.

If you genuinely need a wall-clock hour, you already have the tool: switch the
in-app scheduler off and let your host's cron call `/api/cron`. That is a thing
crontab is good at and this file is not.

**A job that has never run is due immediately.** A fresh deploy does its first
cleanup rather than waiting a day, and a job whose row was deleted recovers on
its own.

---

## Two instances, one job

Every app process holds its own timer. Two containers behind a load balancer
both wake up, both look at the same database, and both would run the same
deletion — so the claim and the due-check are **one conditional UPDATE**:

```sql
UPDATE cron_runs SET locked_at = now()
WHERE job = $1
  AND (locked_at IS NULL OR locked_at < $stale)
  AND (last_finished_at IS NULL OR last_finished_at < $due)
RETURNING job
```

Whoever gets a row back runs it. The other gets nothing and moves on, silently.
Read-then-write would leave a gap that both pass through — the same reason
`claimReloadSlot()` works the way it does where a card is about to be charged.

**A lock older than an hour is treated as abandoned.** A process that dies
mid-job leaves the lock set and nothing else would ever clear it; without the
stale window, one crash stops a daily job for ever. The cost of getting it wrong
is a job running twice, which is why:

---

## The four rules for a job

1. **It must be safe to run twice.** The scheduler tries hard, and a redeploy at
   the wrong moment, a stale lock, or an Operator pressing the button will still
   get you a second run. Deleting rows older than a cutoff is idempotent.
   Sending a mail is not, unless the job records that it sent one.
2. **It returns one line of numbers.** That line is stored in `cron_runs` and is
   what somebody reads to find out whether the job is working. **No address, no
   member id, no text anybody typed** — `cron_runs` has to stay a table with no
   privacy question attached (`docs/data-protection.md` §11).
3. **It throws on failure.** The runner records `failed`, counts it, and the
   next tick tries again. Swallowing an error makes a broken job look like a
   healthy one, which is the exact failure this whole mechanism exists to make
   visible.
4. **It finishes in well under an hour.** That is the stale-lock window. A job
   still running when its lock goes stale can be started a second time beside
   itself.

### Rule 1 for a job that MAILS — `claimSend()`, and the channel it mails through

Rule 1 ends on "unless the job records that it sent one" and for a long time
said nothing about *how*. It does now, and there is one answer rather than one
per job — the second job to need this would otherwise have built a second
mechanism, and the second one would have been different.

```ts
import { notifyOperators } from "@/lib/notify/operators";

const { sent, recipients, reason } = await notifyOperators({
  key: `weekly-reconcile:${week}`,        // what this message IS — see below
  now,                                    // the tick's clock, never new Date()
  compose: (t) => ({
    subject: t("reconcile.subject", { n: open }),
    heading: t("reconcile.heading", { n: open }),
    paragraphs: [t("reconcile.body", { n: open, checked })],
    cta: { label: t("reconcile.cta"), url: `${base}/dashboard/admin/orders` },
  }),
});
return `${open} of ${checked} unresolved, ${sent}/${recipients} mailed${reason ? ` (${reason})` : ""}`;
```

ℹ️ **A sketch, like the one at the top of this file** — `weekly-reconcile` and
its message keys are made up, and the shipped job that really does this is
`courses-digest`, under *What ships* below. Copy the SHAPE from here and the
details from there.

⚠️ **Note what the sketch does not do: put a date in the mail.** `compose()` is
handed a `format` for the operator's language as its second argument, and
`courses-digest` takes it and deliberately does not use it — the age of one item
is a step closer to *who* than a count is, and a digest is read in an inbox this
app does not control ([`community.md`](community.md)). Reach for the formatter
when the message is genuinely about a date, not because it is there.

Seven things are worth knowing before you use it:

- **Compose first, then claim, then send.** `claimSend(key, now)`
  (`lib/notify/sent-once.ts`) inserts one row into `notification_sends` with
  `on conflict do nothing` and returns whether it got one. `notifyOperators()`
  calls it **before** the first delivery, which loses a message when the
  transport then fails — deliberately. A lost digest is visible (the job throws,
  rule 3) and self-healing (the next window counts the same queue again); a
  duplicate is invisible and teaches the operator to skim, and a skimmed channel
  is the same state as no channel. Your `compose()` runs **before** the claim,
  so a mistake of yours — the classic being `format.dateTime()` on something
  that is not a `Date` — costs the run and not the window.
- ⚠️ **Both halves of "visible and self-healing" have an edge, and neither is
  theoretical.** *Visible* is about a job that FAILS. A process killed between
  the claim and the deliveries — a redeploy, an OOM kill — never reaches
  `finish()` in `lib/cron/run.ts`, so `cron_runs` keeps the previous detail
  while the claim row is committed: that message is gone and nothing says so.
  *Self-healing* is about a job that repeats a STANDING queue, which the digest
  is. A one-off, event-shaped message heals nothing, because the next window has
  nothing left to count — whoever sends one is taking a different trade and
  should write that down where they send it.
- ⚠️ **The marker debounces the MESSAGE, not the delivery.** Two operators, the
  second one's address bouncing: the first gets the mail, the run throws, the
  key stays claimed, and the second never gets this window's message — not on
  this run and not on a later one. `notification_sends` holds no recipient state
  on purpose, and a key per recipient would force an address or an id into the
  key, which is the one thing the grammar below forbids. A per-recipient
  delivery guarantee needs a different table, and that is a decision rather than
  an extension.
- 🚨 **The key names the WORK and carries the WINDOW.**
  `courses-digest:2026-08-09`, never `courses-digest` — a key without a window
  is claimed once and never again, so the channel goes quiet for ever and looks
  like a channel with nothing to say. And it never names a PERSON: the grammar
  (`^[a-z0-9][a-z0-9-]*(:[a-z0-9-]+)*$`, at most 120 characters) refuses an
  address and a sentence outright, which is the cheap half of that rule; the
  expensive half is this paragraph. That is also why the table needs no pruning
  job — the row count is bounded by (jobs × windows).
- **The channel is a config file: `config/notifications.json`.** `"enabled"`
  ships **true** — unusual here, and argued in `lib/notify/config.ts`: every
  sender through it is a job carrying `enabledByDefault: false`, and two off
  states in series make a channel nobody finds. `"locale"` is which language
  operator mail is written in, and it lives there because `users` has no
  language column.
- **It never throws for being unable to send.** Switched off, a broken config
  file, no mail transport at all, no reachable owner, already sent — five
  reasons, all returned as `reason` and none of them an error. **Three things do
  throw, and all three are faults rather than states**, each a `NotifyError`
  with a code: `badSendKey` (your key does not match the grammar — refused
  before the config is even read, because it is a mistake in your code and not
  a condition of the app), `composeFailed` (your `compose()` threw) and
  `deliveryFailed` (a transport that was there and failed). 🚨 **The message is
  a COUNT in all three cases** and the original goes to `console.error`:
  Postmark's error body names the recipient, an `Intl` error quotes the value it
  choked on, and rule 2 is about exactly those strings reaching `cron_runs`.
- **Going round the channel puts that back.** `sendOperatorMail()` in
  `lib/email.ts` is exported so `notifyOperators()` can import it, not as a
  second entrance: called directly it throws with the provider's own text, which
  is the leak the channel exists to contain.
  `lib/notify/envelope-guard.test.ts` fails the build on a caller outside the
  channel — with an `operator-mail-ok` hatch, per line and with a reason, for a
  path whose errors genuinely never reach `cron_runs`.

### 🚨 A job that deletes many rows does it in batches — `pruneInBatches()`

Rule 4 has one recurring way of being broken, and `delete … where created_at <
cutoff` is it. It is the obvious statement, it is correct, and on the only
installation that needs it — the app that has been running for years and is
pruning for the first time — it does three things nobody wants:

- **It brings every deleted id back to count them.** `returning({ id })` on a
  million rows is hundreds of megabytes **in the process that serves requests**;
  the scheduler runs inside the app and there is no worker.
- **It can outlive the stale-lock window**, and then the next tick starts the
  same job beside the first while the original still holds row locks on a table
  the app is writing to.
- **And it can never finish.** One `DELETE` is one transaction: if the run dies,
  it rolls back — nothing deleted, the same attempt tomorrow, for ever. So the
  retention window an operator configured is a promise the app quietly does not
  keep, which is a data-protection question rather than a performance one.

So a sweep goes through **`pruneInBatches()`** (`lib/cron/prune.ts`): batches of
10,000 within one time budget per JOB, returning `{ deleted, stoppedEarly }`.
A partial run appends `STOPPED_EARLY_NOTE` to the job's line — from the shared
constant, so "10,000 deleted" every day for a week cannot look like "finished".

```ts
const deadline = pruneDeadline();          // one per job, not per sweep
const swept = await pruneInBatches(
  { table: myRows, id: myRows.id, olderThan: myRows.createdAt },
  cutoff,
  deadline,
);
return `${swept.deleted} row(s) deleted` + (swept.stoppedEarly ? STOPPED_EARLY_NOTE : "");
```

⚠️ **The schema owes an index that leads with the cutoff column, and it is for
the DAILY run rather than the first one.** Measured on a table of 40,000 rows
with none old enough: an index scan at cost 4.31, where without the index
Postgres reads every row to establish there is nothing to do — once a day, for
ever. The first catch-up run is a sequential scan either way and the planner is
right about that. Batching bounds the one enormous run; the index bounds the
thousand small ones. `modules/community/schema.test.ts` is the worked example of
holding a sweep and its index together.

Two more rules, less about correctness and more about not being surprised:

- **`now` comes from the context, never `new Date()` inside the job.** One tick,
  one clock. It is also what makes a job testable.
- **A job runs inside the app**, so it has `db`, `lib/email.ts`, `hasPlan()` and
  everything else. That is why the registry is TypeScript and not a shell
  command: the second job anybody writes needs one of those.

---

## What ships

Nine jobs. Six are housekeeping — they delete or close rows and objects that
have aged out. The other three delete nothing and fix nothing: one makes a state
visible that is invisible from every other angle inside the app, one asks a
question whose answer lives outside the app entirely and writes down what came
back, and one reads what the other two wrote and is the only place this app ever
MAILS an operational report. Those three are the ones worth reading if you are
about to write a job of your own.

| | | |
|---|---|---|
| `prune-ai-usage` | daily | deletes model-call rows past the retention window |
| `prune-ipn-log` | daily | deletes raw webhook payloads past 60 days |
| `close-impersonations` | 5 min | closes support sessions whose 30 minutes ran out and that nobody ended |
| `prune-impersonations` | daily | deletes impersonation records past the retention window |
| `prune-setup-audit` | daily | deletes setup-surface records past the retention window, and every spent confirmation |
| `prune-abandoned-uploads` | daily | removes direct-to-bucket uploads that were promised, never arrived and expired |
| `check-stuck-reloads` | hourly | **reports only** — auto top-ups that billed a card and never got a credit back |
| `check-advisories` | daily | **records only** — asks the advisory databases about the versions this app resolved |
| `ops-watchdog` | 6 h | **the only job that MAILS an operational report** — one mail when the security record, the jobs, the media store or the payment webhook says something is open |

`lib/cron/ids.mjs` is the list this table is written from — if the two ever
disagree, that file is right.

### `prune-ai-usage` — 12 months

```json
"prune-ai-usage": { "enabled": true, "everyMinutes": 1440, "retentionMonths": 12 }
```

`ai_usage` is the first table in this app that grows with **use** rather than
with customers: one row per model call, for ever. Twelve months keeps
"what did AI cost me last November" answerable and a year-on-year comparison
possible.

⚠️ **This deletes cost history.** The AI-costs page can only report what is in
the table, so a pruned period reads as **zero**, not as unknown. If the numbers
matter to your accounting, export before you shorten the window.

The retention is **calendar months**, not `30 × n` days: somebody who writes 12
means the same date last year, and 360 days is five days short of that, every
year, with nothing to say so.

### `prune-ipn-log` — 60 days

The IPN log keeps the full raw payload of every incoming webhook, which is buyer
PII. Sixty days is long enough to diagnose a failed webhook and short enough to
defend as data minimisation. This one used to be a hand-wired endpoint; it is
now an entry in the registry like everything else.

### `close-impersonations` — every 5 minutes

Closes the record of a support session whose thirty minutes ran out and that
nobody ended. Stepping out, signing out and noticing the expiry on a live
request all have a moment to write the end — **closing the tab does not**, and
nothing ever comes back to that session. Without this job those rows stay open
for ever and the record becomes unreadable within a week: a finished session and
a running one look identical. Idempotent by construction — the `UPDATE` excludes
rows that already carry an end.

### `prune-impersonations` — 12 months

⚠️ **This deletes the answer to "did somebody go into my account last spring".**
The window matches what this template already keeps `ai_usage` for; a shorter
one weakens a member's own subject access request, and that is the trade being
made rather than a default nobody thought about.

### `prune-setup-audit` — 24 months

The append-only record of what an operator's agent did to an environment over
`/api/setup`, plus every spent or expired confirmation token. ⚠️ **The floor is
in `pruneSetupAudit()` and it THROWS below one month** rather than obeying:
`retentionMonths: 0` is not a retention setting, it is switching the control off
while leaving something that looks like a policy in the config. Whoever wants to
keep everything disables the job.

### `prune-abandoned-uploads` — daily

The fourth requirement of the direct-to-bucket upload path (`docs/visuals.md`):
a ticket is minted, the browser gets an address, and then the tab is closed. That
object has no `media` row, so no page renders it, no export lists it and account
deletion never reaches it — storage nobody is billed for understanding. It works
**by row**, never by listing the bucket, and is idempotent by construction: a
second run finds what the first could not remove and nothing else.

### `check-stuck-reloads` — hourly, and it changes nothing

The odd one out, and the reason it is here rather than on the request path.

Auto top-up bills a card and waits for the IPN to book the credit. When that IPN
never arrives, the balance is never raised, the threshold is still undershot,
and six hours later the stale-lock timeout hands the slot back — so the card is
billed again. `reloadIsPaused()` stops that at the second unconfirmed charge
(see [`digistore-billing-modes.md`](digistore-billing-modes.md) → *Auto-reload*),
which closes the loop but says nothing to anybody.

**Nothing about that state looks like a fault.** Every charge succeeded, no
exception was thrown, and the Member's own switch still reads "on".

And it cannot be left to the spend path to notice, which is the part worth
copying into your own job: a Member stuck at a zero balance **stops using the
app**, so `spendTokens()` — the only thing that ever calls
`autoReloadIfNeeded()` — is never called again. The account that most needs
reporting is the one nobody touches. A state that only a request can discover is
a state nobody discovers.

It reports a bare count, per rule 3 above: who it happened to belongs on
`/dashboard/admin/users/<id>`, which is behind `requireOwner()`, and in
`node run.mjs logs`. `cron_runs` has no privacy question attached and stays that
way.

### `check-advisories` — daily, and it records rather than mails

The other job that changes nothing. `node run.mjs security-check` is the command
somebody runs when they want to know; this is the same question asked while
nobody is at the keyboard, so that an advisory published on a Saturday is already
known by the time anybody looks. Needs template 0.24.0.

**What it asks.** The two **advisory** rungs of that command's ladder, and only
those: `osv` (OSV.dev, over the versions `package-lock.json` resolved) and then
`advisories` (`npm audit`). `osv` goes first because it is bounded by
construction while `advisories` spawns npm through a runner with no timeout, and
the rung that can hang must not be able to stop the one that cannot. Everything
else the ladder asks — signatures, the registry heuristics, the posture checks,
version drift, the live domain, secrets — is **not asked**, because
`npm ci --dry-run` in a temp directory and a deployed app probing its own public
domain every night are not things to switch on for people without asking them.

🚨 **So the record it writes always says `complete: false` and always names the
rungs it did not ask.** That is the whole design rather than a shortfall: a
record that asked two questions must never look like a record that asked all of
them. Every unasked rung is written into the record as `not asked` with a reason
naming the command that asks everything, and the list of them is read off the
ladder at run time — so a rung added to this template later is covered the day it
arrives, with no edit here.

**What leaves the machine.** Exactly what the command already sends when an
operator runs it: the **names and versions** of this app's dependencies, to
`api.osv.dev` and — only when OSV returned hits — npm's audit endpoint. No app
name, no domain, no identifier, nothing about a customer. ⚠️ A **private**
package's name travels with the rest. The difference from the command is
consent, not content: "when I run it" and "every night from my production app"
are different things to agree to, which is why it is written here rather than
implied.

**It records and never mails.** No mail, no greeting line, no second record — it
writes `.dev/security-check.json`, the one record the session greeting's
`[Operations: …]` line reads. Reporting a finding to an operator is a different
job's business; two jobs on one mail channel would have one swallow the other's
message (see rule 1 above on `claimSend()`).

**Its line into `cron_runs` is a tally**, e.g.
`2 of 10 rung(s) answered — 0 critical, 0 high, 0 medium, 1 low, 0 accepted; 8 not asked`.
No package, no path, no host — and **no rung's skip reason** either: those carry
upstream text, and this table stays one with no privacy question attached. The
reasons are in the record.

**It bounds itself**, because nothing else does: `npm audit` is spawned through a
runner with no timeout at all. The budget is `budgetSeconds` in the entry below,
120 by default, and a rung that has not answered by then is recorded as not asked
with that as its reason — the record is still written and the job still succeeds,
because a slow network is not a broken job. ⚠️ The limit of that mechanism, said
plainly: abandoning a rung is not killing a child process. Whatever npm was
spawned keeps running until it exits on its own; what the record says is that the
rung did not answer, which is true.

**A run in which nothing could be measured is not a failure** — every rung skips,
the record says so, and the greeting renders it as *"the last check could not
look at anything"*. The job only throws when it could not do its work at all: the
`scripts/security/` tree not reachable from the running app, which is a
deployment defect rather than a state of the world.

**Switching it off is one line**, in `config/cron.json`:

```json
"check-advisories": { "enabled": false, "everyMinutes": 1440, "budgetSeconds": 120 }
```

It ships **on** deliberately — the whole point is that nobody has to remember to
look, and a job that ships off is a job nobody switches on. The refusal is one
word in a file the operator already has.

### `ops-watchdog` — every six hours, and the only place this app mails

The third job that changes nothing, and the one the other two are for. It reads
four operational facts and, when any of them is open, sends **one** mail naming
all of them, worst first. When nothing is open it sends nothing at all. Needs
template 0.24.0.

**A mail that never arrived and a mail there was nothing to send look identical
from an inbox**, and that is the whole reason this job exists in the shape it
does: the difference is written into `cron_runs.lastDetail`, where somebody can
see it.

**What it reads** — four checks, each from the place that already holds the fact:

| check | it is a finding when | severity |
|---|---|---|
| security | the record `check-advisories` writes says `critical > 0` or `high > 0` | 🚨 / ❌, from the record's own counts |
| jobs — failing | an **enabled** job's last run ended `failed` | ❌ HIGH |
| jobs — stalled | an **enabled** job's last finish is further back than 3× its own interval | ⚠️ MEDIUM |
| media | the store this app writes to did not answer | ❌ HIGH |
| ipn | this app sold recently and no payment notification has arrived for over a week | ⚠️ MEDIUM |

Four checks, five conditions — the job table answers two questions.

🚨 **It READS the security record; it never runs `node run.mjs security-check`.**
No spawn, no npm, no ladder. A scheduled job inside a running app shelling out to
the registry would put the network and half a minute of traffic on the process
that serves your customers, and would make a command deliberately in no gate into
the thing your app's health depends on.

**Three things it deliberately does not report.** A job that has **never**
finished is not a stalled job — `cron_runs` does not say when this app was
deployed, so a freshly deployed app would otherwise mail its owner about every
job on its first night; never-run is reported by `node run.mjs cron --list` and
by `node run.mjs health`, where a person can judge it. A job that is **OFF** is
never a finding, because it is not supposed to be running. And an app with **no
products for this environment, or no sale in ninety days**, has no missing
purchases — that is reported as *checked and nothing to report*, never as *not
checked*.

⚠️ **"Consecutive failures" is not claimed anywhere**, in the code or in the
mail. `cron_runs` holds one row per job, updated in place, and carries no
history — a streak cannot be read out of it, so it is not asserted. What is
measurable is *its last run failed*, and that is what fires.

**Its three lines, and they are not confusable:**

| what happened | `lastOutcome` | `lastDetail` |
|---|---|---|
| nothing open | `ok` | `nothing open — 4 check(s) ran, 0 could not be checked` |
| reported | `ok` | `3 finding(s), 2/2 mailed` |
| already said this window | `ok` | `3 finding(s), already notified this window` |
| **not** reported | `ok` | `3 finding(s), no mail sent (noTransport)` |
| **the mail itself failed** | **`failed`** | the channel's own count, thrown |

Read down the last column: *there was nothing to send* and *the mail did not go*
are different sentences, and the one that means the alarm itself broke is the
only one on `failed` — so `cron --list` and `node run.mjs health` both show it as
a finding, and the failure of the alarm becomes an alarm of its own.

🚨 **A check that could not be MADE is counted and never dropped.** It appends
`, N could not be checked` to every line — a watchdog reporting "nothing open"
while three of four checks failed is exactly the defect this is for. But it never
triggers a mail on its own: *"the security check has never run here"* is true and
a mail about it every six hours is noise, so that state is reported where a human
is already looking (`node run.mjs health`, the session greeting, `cron --list`)
and named **inside** a mail that is going out anyway.

**What is in the mail:** counts, states and the command that prints the detail.
Never a job id, never a package, never a path, never a bucket, never an address,
never a member, never `lastDetail`. Every sentence comes out of
`messages/{de,en}.json` in the operator language from `config/notifications.json`.
*"2 job(s) failed on the last run"* sends you to `cron --list` for the names,
which is one command and no leak.

**The window, and why the interval is 360.** The send key is
`ops-watchdog:<UTC day>:<8 hex>`, where the hex is a digest of the **sorted list
of open condition ids** — and of nothing else.

- The **window** alone would not do: a key claimed by the day's first mail would
  swallow a second problem appearing six hours later.
- The **digest** must not contain counts or timestamps: a failure tally ticking
  from 2 to 3 would mint a new key, every tick would mail, and you would learn to
  filter the channel.
- **Six hours, not twenty-four:** due-ness counts from the last FINISH while the
  window is a UTC calendar day, so a daily job drifts past midnight and skips a
  day in silence. Four attempts a day, one mail per distinct condition set.

**Two limits, stated rather than implied.** A process killed **between** the
claim and the delivery — a redeploy, an OOM kill — never records anything, so
that window's message is gone with nothing saying so. And a mail the provider
**accepted and then never delivered** is invisible from here: the transport
throwing is the only delivery signal this app has. Knowing that a message
*arrived* is a monitoring provider's job.

**Its two switches, and both halves matter:**

```json
"ops-watchdog": { "enabled": true, "everyMinutes": 360 }
```

The registry entry says `enabledByDefault: false`, so **deleting** the line above
does not start it by inheritance (no entry means enabled *and* daily). The line
above is the decision to run it; setting `"enabled": false` there stops the mail.
The channel itself is `config/notifications.json`, which ships **on** precisely
because every sender through it ships off.

---

## A MODULE can bring a job, and two do

Everything above is the core's. A module registers its own jobs the way it
registers everything else — from its manifest:

```json
"cron": "cron.ts",
"cronJobs": ["community-prune"]
```

Two fields, and neither works alone. `cron` is the file whose default export is
the job bodies; `cronJobs` is the names. The split is the same one
`lib/cron/ids.mjs` already makes against `lib/cron/jobs.ts` — `lib/cron/config.ts`
has to know which configured job does not exist, and it is read by
`instrumentation.ts`, which is built for the edge runtime too. Importing the
bodies there would put the whole database layer in front of a decision about
whether to start a timer.

The generated halves are `lib/modules/cron-registry.ts` (bodies) and
`lib/modules/cron-ids.mjs` (names); `CRON_JOBS` and `JOB_IDS` are the core's plus
those. A module's ids must start with its own id, so nothing can shadow
`prune-ai-usage`.

> ⚠️ **`cronJobs` used to be accepted with no executor behind it.** It validated,
> `module list` printed it, and the greeting was even taught to keep quiet about
> it so the customer would not be nagged — while nothing registered the job, so it
> could never run. Three readers honouring a promise nobody kept, with the one
> signal that would have revealed it deliberately suppressed. The manifest now
> refuses one field without the other.

### 🚨 Leaving a job out of `config/cron.json` is not "off"

A job with no entry inherits `JOB_DEFAULTS` — **enabled, daily**. So omitting an
entry schedules a job; it does not silence it.

That is a problem a module cannot solve in that file, because `config/cron.json`
belongs to the core: an entry there would name a job that every app *without*
the module does not have, which `configProblems()` correctly calls "a job that
does not exist". So a job declares its own posture:

```ts
{ id: "community-prune", enabledByDefault: false, describe: "…", run }
```

The operator's file wins in both directions — an explicit `true` turns on a job
whose default is off, an explicit `false` turns off one whose default is on. Only
its **silence** consults the job.

### `community-prune` — the shipped example, and it ships OFF

The community module brings it. It performs the same three sweeps as
`node run.mjs community-prune`: private messages past the window in
`config/community.json` (which ships at `0`, meaning off), moderation-trail rows
and *handled* spam reports past a year. An unhandled report is never deleted at
any age — those rows are what the automatic send-block is derived from.

**Two entry points, one behaviour, and one difference an operator has to know:
the command is a dry run unless you pass `--apply`, and a job cannot ask.** That
asymmetry is why this one arrives switched off rather than merely undocumented.
To turn it on:

```json
"community-prune": { "enabled": true, "everyMinutes": 1440, "retentionDays": 365 }
```

Why two implementations of one sweep rather than one shared: it is the shape
`prune-ai-usage` and `node run.mjs db-prune-ai` already have. The command is bare
Node so an operator can point it at any `DATABASE_URL` without a build; the job
runs inside the app where the schema symbols are. What they share is the part that
*decides* — the windows, `configuredNumber()` and `retentionCutoff()`.

### `courses-digest` — the second one, and it MAILS

The courses module brings it, and it is the first job in this template that
sends anything. Once a day it counts the hand-ins nobody has answered and tells
the operator the number.

**Why a job at all, when the operator already has a dot in the sidebar.** The dot
(shape 3's answering surface, `docs/courses.md`) has exactly one property: it is
only there while the operator is *already in the app*. A workshop sells "a person
reads what you send in", its failure mode is silence, and silence looks from the
outside exactly like "nothing is waiting" — the same shape as
`check-stuck-reloads` above. The mail also carries a NUMBER, and one waiting and
forty waiting are different days.

**What is in it: a count and a link.** Never a name, an address, a member id, a
lesson title, a word anybody handed in, or the date of a single hand-in. Cron
rule 2 covers the line in `cron_runs`; the MAIL is under the sharper rule
[`community.md`](community.md) states about digests — it is delivered to an inbox
this app does not control and read on whichever device holds it — plus the
course's own: who is working through which lesson is purchase information, so a
waiting list in a mail would be the roster that module refuses to have.
`modules/courses/lib/cron-boundary.test.ts` reads the job as text and fails on any
reader that carries a person.

**It reads the course's switch first**, before it counts, so a switched-off course
costs no round-trip and sends nothing — and it asks the NARROW question
(`isCourseSwitchedOn()`), because in the broken-config state the hand-ins keep
arriving and the page the mail points at is the one that diagnoses the fault.

It ships DISABLED like `community-prune`, and for a sharper version of the same
reason: a job that mails does not start on its own. To turn it on:

```json
"courses-digest": { "enabled": true, "everyMinutes": 720 }
```

⚠️ **Twelve hours for a once-a-day mail is not a typo, and it is the general rule
for any job whose key carries a WINDOW.** Two clocks meet here and nothing ties
them together: due-ness is measured from the last FINISH, so every run drifts a
little later, while the key is nailed to the UTC calendar day. At `1440` the run
eventually crosses midnight UTC and the key jumps two days — one calendar day
gets no mail at all. Halve the interval and every window is attempted twice;
`claimSend()` still lets exactly one message through and the second attempt
reports `already notified today`. **On a windowed key a shorter interval is
safer, not chattier.**

Two more switches sit behind it and neither is this file's:
`config/notifications.json` decides whether the app may write to its operator at
all, and mail delivery has to be configured (`node run.mjs mail-setup`) — without
either, the job runs, counts, and reports `no notification sent (…)` with the
reason. That line is the point: "green because it sent" and "green because it
skipped" are the same colour otherwise.

---

## Changing a retention window

One number, one file, effective on the next run:

```json
"prune-ai-usage": { "retentionMonths": 24 }
```

Two things the code will not let you do by accident, both of which delete
everything:

- **`"retentionMonths": null`** — `Number(null)` is `0`, and so is `Number("")`
  and `Number(false)`. Every one of them reads as a perfectly valid zero-month
  retention. `configuredNumber()` in `lib/cron/rules.mjs` refuses all of them and
  the job falls back to its default. A deliberate `0` has to be written as a
  number.
- **A typo'd job name.** `config/cron.json` naming a job that is not in the
  registry is reported by name — `node run.mjs cron --list` shows it, and
  `lib/cron/rules.test.ts` fails the build if the *shipped* file has one. A job
  nobody looks up is a job that silently never runs, and a rename is how that
  happens.

---

## Is it actually running?

The question this whole thing is built to answer, because a cleanup that quietly
stopped looks exactly like a cleanup with nothing to do.

```bash
node run.mjs cron --list
```

```
prune-ai-usage  —  daily
  Delete AI-usage rows older than the retention window (default 12 months).
  last run: 3 h ago (ok) — 412 row(s) older than 12 month(s) deleted

check-stuck-reloads  —  hourly
  Count accounts whose auto top-up stopped charging because no credit came back.
  last run: 12 min ago (ok) — 1 account(s) stopped charging — top-up billed, no credit booked

✓ No findings — every enabled job has run, and none is failing.
```

⚠️ **`(ok)` is about the job, not about what it found.** The second line above
is a healthy run reporting an unhealthy app: somebody's card was billed and no
credit ever arrived. A reporting job is green whenever it managed to count, so
read the count, not the status. Every run also writes a `[cron]` line to
`node run.mjs logs`.

### Two states are findings, not rows

A listing where every block looks the same is a listing you skim. Two of those
blocks mean the scheduler stopped, so they are marked on the ladder this app
uses everywhere (🚨 CRITICAL, ❌ HIGH, ⚠️ MEDIUM, ℹ️ LOW) and counted in the one
line the command ends on:

| | |
|---|---|
| ⚠️ **enabled, and `last run: never`** | on a week-old installation the scheduler is not running — most likely the app is restarted more often than the interval, or `config/cron.json` says `"enabled": false` |
| ❌ **`n of m run(s) failed`** | a job threw. What it said is in `lastDetail` on the line above, the stack trace is in `node run.mjs logs` |

🚨 **A job that is `OFF` and has never run is not a finding** — it has correctly
never run. `community-prune` and `courses-digest` ship switched off, so on a
fresh install that is exactly their state.

**A finding never changes the exit code.** `--list` is a view you run casually,
and on a freshly deployed app *every* enabled job says `never`; the line at the
bottom is a sentence, not a verdict. `--job <id>` and a plain `cron` run still
exit non-zero when a job fails, because a scheduler that never gets an alert is
the thing this whole page exists to prevent.

### The same question, asked of the DEPLOYED app

There is no shell on the host, and there does not need to be:

```bash
node run.mjs cron --list --url https://your-app.example.com
```

It reads the same `GET /api/cron?list`, prints the same blocks and the same
findings, and needs nothing installed on the other end. **This replaces sending
that request by hand** — it is the sibling of `node run.mjs errors --url …` and
behaves the same way in the two respects that matter:

- **The secret comes from the URL's hostname, never from a flag.** The address
  is matched against `APP_URL_PROD` / `APP_URL_STAGING` and the matching
  `CRON_SECRET_PROD` / `CRON_SECRET_STAGING` is sent. A host that matches
  neither gets a refusal, never a fallback — see below.
- **Unreachable, refused and not-configured are three different sentences.**
  Nothing answered at all; the host has a different secret than the key here;
  the deployed app has no `CRON_SECRET` in its own secrets (it answers 503 for
  exactly that). Each names what to do, and none of them is the local advice to
  restart the app — that is about your machine, not somebody's server.

An answer that is not a job list is refused rather than printed as an empty
success, whichever address it came from.

---

## `CRON_SECRET`

The endpoint protects itself with a bearer token, because `proxy.ts` matches
`/dashboard` only and everything under `app/api/` is public until it does — the
same rule `/api/ipn` and `/api/v1` live by.

**Without `CRON_SECRET` set, the endpoint refuses to run at all** (503, so an
Operator can tell "never configured" from "wrong token"). It can never be left
open as a "delete my data" URL by somebody who has not reached that step.

Locally `node run.mjs cron` generates one into `.env` on first use, exactly as
`AUTH_SECRET` is generated. In STAGING and PROD it belongs in the host's secret
management — `docs/DEPLOY.md`.

**The in-app scheduler needs no secret.** It is not making a request.

### Asking a deployed app: `CRON_SECRET_PROD` / `CRON_SECRET_STAGING`

The plain `CRON_SECRET` is **this machine's**, and it is the one that gets
generated. The suffixed names are **reference copies** of what is set in each
deployed host's secret storage — the convention `SETUP_KEY_PROD`,
`DIAGNOSTICS_SECRET_PROD` and `MEDIA_S3_*_PROD` already use. Neither is ever
generated here; you set the value on the host and copy the same one into
`.env`.

```
APP_URL_PROD=https://your-app.example.com
CRON_SECRET_PROD=…            # the same value the host has
```

🚨 **The secret is scoped to the host it was provisioned for, and that is a
security property rather than a convenience.** `--url` is matched against the
`APP_URL_*` hostnames, and only the key belonging to the one that matches is
sent. A typo, a lookalike domain, a staging address with production credentials
in the `.env` — all of them get a refusal naming the hosts the app does know.
There is no "probably meant" fallback, because this token triggers jobs that
delete customer data.

⚠️ **A remote run never generates a `CRON_SECRET` into your `.env`.** It would
invent a value the deployed app has never heard of, send it, collect the
inevitable 401 and then blame your `.env` for it. When the key is missing, the
command says which key to set and where its value comes from — and writes
nothing. The local path keeps generating one exactly as it always did.

---

## When the app is not running

Two jobs have offline twins that go straight at the database:

```bash
node run.mjs db-prune-ai --dry-run    # count first — it also prices what would go
node run.mjs db-prune-ai --days 90
node run.mjs db-prune-ipn --days 30
```

They exist for the case where you want rows gone and the app is down, and for
the `--dry-run` the scheduled path has no equivalent of. They are the only
duplication in here, and they are duplicated on purpose: a cleanup you can only
run by starting the app is a cleanup you cannot run when the app is the problem.

---

## Files

| File | What it is |
|---|---|
| `lib/cron/jobs.ts` | **The registry.** Adding a job is adding an entry. |
| `lib/cron/rules.mjs` | Pure: due, stale, retention windows, config faults. |
| `lib/cron/config.ts` | `config/cron.json`, read in one place. |
| `lib/cron/run.ts` | The claim, the run, the bookkeeping. |
| `lib/cron/scheduler.ts` | The timer. Started from `instrumentation.ts`. |
| `app/api/cron/route.ts` | The way in from outside. |
| `scripts/cron/run.mjs` | `node run.mjs cron`. Calls the endpoint. |
| `db/schema-cron.ts` | `cron_runs`. |
