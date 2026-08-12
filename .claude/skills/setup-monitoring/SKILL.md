---
name: setup-monitoring
description: Decides what watches the app once it is live, then sets it up — an error tracker, full APM, an uptime check or a plain OpenTelemetry endpoint, with what each costs at THIS app's size, one recommendation rather than a market survey, and an alarm that actually reaches the operator. Use this when the user says "how would I even know if my app is down", "how do I find out something broke", "do I need Sentry", "something should tell me when it fails", "monitoring", "uptime", "alerts", "a customer saw an error and I never did", "where do I put the Sentry key", or when the app is live and nothing is watching it. Being TOLD without asking is this skill; looking now, on purpose, is `operate`.
requires: 0.23.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Something that watches the live app — choosing it, and setting it up

The app is online. The person in front of you is not going to sit in front of a
log file, and the failure they are afraid of is the one a customer runs into on
a Sunday — the one they hear about three days later, or never, because the
customer simply left.

**Step 1 picks one thing to watch it with, step 2 gets its key in place, step 3
installs it and proves one event really arrives, and step 4 puts something
OUTSIDE the app that keeps asking whether it is alive.** The first is a decision
and ends with a name, a reason and a line in the app's own notebook; the second
stores exactly one credential where it belongs and installs nothing at all.

**The four things you are choosing between are not four equal products.** Three
of them answer different questions, and the fourth is not a product at all.
Step 1 says which question each one answers, and which one I would take.

## What you do, and what stays with them

You read the files, you fetch the pricing pages, you write the notebook entry,
and in step 2 you make the provider's own API calls and write the `.env`.
**Two things stay with the person**: creating the account and agreeing to the
provider's terms — nobody can accept terms on somebody else's behalf. Step 1
needs neither, so nothing there waits on a browser.

## 0. Look first — is anything watching this already?

Read before you ask a single question, then say what you found. Four files
answer almost all of it:

| The question | Where the answer is | What it means |
|---|---|---|
| Was this already decided? | `docs/app.md` → *Decisions worth remembering* | a recorded choice **or a recorded "no"** — both are answers. See the rule below |
| Is something already wired in? | `package.json` dependencies for a provider's package; `instrumentation.ts` for wiring (the file Next.js runs once when the app starts); `.env` / `.env.example` for a provider key | something is already there → say what, and stop rather than adding a second one |
| Is this app even live yet? | `APP_URL` and `APP_ENV` in `.env` | still `localhost` → there is nothing to watch. Say so and hand back to **`setup-hosting`** / **`go-live`**; come back after |
| Where would an alarm even go? | `config/notifications.json` and whether an owner account exists | the app can write to its operator, but **nothing sends through that channel in a fresh app**. Know it so you do not promise a channel that has no sender |

🚨 **A recorded "no" is an answer.** If `docs/app.md` already says monitoring was
declined and why, say so in one sentence and stop. Do not run the menu again. A
question that has been answered and gets asked a fourth time trains people to
stop reading the questions.

⚠️ **`docs/app.md` may not exist yet** — it is created by `build-app` (step 4b).
"No such file" means *this app has no notebook yet*, not an error. If you have
to write into it in step 1, create it first from
[`build-app/references/app-md-template.md`](../build-app/references/app-md-template.md).

Then say what you found, in one sentence: *"Nothing is watching this app yet —
it is live at `<APP_URL>`, and the only thing that would tell you it broke is a
customer."*

## 1. The four options, and the one I would take

### What this app already answers on its own — and what it never will

Say this before the options, because it is what makes the choice honest: this
app is not blind today, it is only **silent**.

- `node run.mjs errors --url https://your-app` asks the deployed app for its own
  errors — including the ones a **200 hides**, a broken date, a missing text
  (`CLAUDE.md` → *Never ship a broken page*).
- `node run.mjs smoke --url https://your-app` calls every page and reports what
  came back.
- `/api/healthz` says the process answers; `/api/readyz` asks the database too.

All three answer **when asked**. Nobody asks at three in the morning, and the
error window the app keeps lives in one instance's memory and empties whenever
it restarts. **What you are buying in this step is not sight. It is being told.**

### The four options

**Every line in the table below is about SHAPE, and shape is the only thing
written down here.** The shapes were read off each provider's own pricing page
on **2026-08-10** (Sentry, Datadog, UptimeRobot and Better Stack) and off
OpenTelemetry's own documentation for the last row. **No figure from those pages
was copied into this file**, on purpose — see *Look the price up* below. And a
shape ages too: if the page you fetch today says something else, **the page
wins**, and you say so out loud.

| | Answers | What moves the bill | Cannot see |
|---|---|---|---|
| **An error tracker** (Sentry, and its kind) | *what broke, where, in which version, for which customer* — the stack trace (the list of calls that led to the crash), grouped so ten reports of one bug arrive as one issue. It also carries traces: a trace is the timeline of one request through the app | **event volume** — how many errors get sent, not how many customers you have. So the cost risk is one noisy bug, not success. There is a free tier sized for an app with a handful of customers, then a per-month team tier | that the app is **down**. An app that is not running throws nothing, and silence looks exactly like health. It is not host monitoring either: no CPU, no disk, no database numbers |
| **Full APM** (Datadog, and its kind) — *APM* is application performance monitoring: traces, host metrics, logs, dashboards and alarms in one place | *everything*, which is genuinely its strength — for somebody who will build and read dashboards | priced **per host per month** (a host is one running machine or container) **and per product**: infrastructure, APM and logs are separate line items, logs by volume on top. That is a shape built for a fleet; for one app instance plus one managed Postgres it is by a wide margin the most expensive answer here | nothing much — the problem is the opposite. Its cost is not a number to fear, it is a **direction**: the bill grows with things nobody deliberately switched on |
| **An uptime check** (UptimeRobot, Better Stack, Cronitor and their kind) | *is it reachable from outside* — and it mails, messages or phones somebody when it is not. This app already has the two endpoints for it, `/api/healthz` and `/api/readyz` | the cheapest row here, and a usable free tier is normal. What the free tier limits is the **check interval** — how often it looks, counted in minutes where the paid one is counted in seconds — and the **alert channels**: mail and chat free, a text message or a phone call paid | **why** anything broke. And it cannot see the failure this template cares about most: a page that answers **200** and is visibly broken for the customer looking at it |
| **A plain OpenTelemetry endpoint** | *nothing by itself.* OpenTelemetry (OTel) is a standard for sending traces and measurements somewhere; its own documentation says it "is not an observability backend itself". So the question it answers is whichever backend receives them — Grafana Cloud, SigNoz, an existing company system | either another vendor's bill, or a server the operator now runs, patches and pays for | the decision. "We will use OTel" is a choice of **wire format**, not a choice of what watches the app. Honest for somebody who already has a backend to point at; a trap for somebody who does not |

### Look the price up, then say it out loud

**There are no prices in this repository, on purpose** — they change, and a
number somebody budgeted on is worse when it is stale than when it is missing.
The same rule `setup-hosting` holds, for the same reason.

So before the user signs up anywhere, **fetch the current pricing page of the
one or two actually in play** and give **one rough monthly figure for what this
app needs**: one app, one small database, one operator reading the alarms. One
sentence is enough:

> "At this size that is roughly X a month — and it stays there until the app
> gets a lot busier or a lot noisier. I can tell you what would push it up."

Two things you may say without looking, because they are shape and not numbers:

- **The four rows are not in the same bracket.** Full APM is the outlier, and
  the gap is not small. Never quote a figure from one provider and then set the
  user up on another.
- **A free tier is not automatically a saving.** Three failures hide in the free
  rows, and each one arrives at the worst possible moment:
  - an error allowance that runs out **during the incident that used it up** —
    the one hour you needed it, it stops accepting;
  - a check interval long enough to **miss a short outage entirely**, so the
    dashboard says everything was fine while customers saw nothing;
  - a **retention** window — how long the provider keeps what it collected —
    that deletes the event before anybody looks at it. Retention is the free-tier
    limit nobody reads, and it is the one that makes Monday useless.

If they want the free tier after hearing that, do it, and say once which of the
three to watch for. It is their money.

### One question, not four

Ask **one** question, with the recommendation already inside it:

> "Do you already have an account at one of these? If not, I would take
> **Sentry**: it answers the question this app actually fails on — a page that
> broke for one customer while everything looked fine from outside — and its
> free tier covers an app of this size."

| If they say | Take | Because |
|---|---|---|
| nothing / no idea | **an error tracker (Sentry)** | the failure this app really has is a broken page, not a dead server. Free at this size, one package, one wiring point |
| "I need to know when it is **down**" | **an uptime check** — and say the two endpoints are already built | that is a different question, and it is the cheap one. It is **step 4** of this skill, so it is not either/or |
| "my company already uses Datadog / Grafana" | **that one** | an account somebody already pays for and already knows how to read beats a new one. The same rule `setup-hosting` applies to a host they already have |
| "I want the full picture" | **the error tracker first**, and say why | full APM for one instance is a fleet product at fleet prices, and dashboards nobody reads cost exactly as much as dashboards somebody reads |
| "none of it" | **write it down** | a "no" is an answer. An unrecorded one gets proposed again three sessions later |

**Do not run a comparison.** They asked to be told when their app breaks, not
for a market survey. An operator who cannot judge four options picks the one
with the best landing page, and that is reliably the most expensive one.

### Write the decision down — including "none"

The decision goes into `docs/app.md` under **`## Decisions worth remembering`**,
not under `## Features`: nothing was built here, something was decided. One
dated line, in the file's own voice, and it **names what was decided against**
— the rejected alternative cannot be read out of the code, and it is exactly
what gets proposed again three sessions later.

Both directions are entries:

```markdown
- Monitoring: Sentry, chosen 2026-08-10 — errors are the failure this app has;
  full APM rejected: per-host, per-product pricing for a single instance.
- Monitoring: none, deliberately, decided 2026-08-10 — <the operator's reason>.
  Do not propose again; revisit when there are paying customers.
```

🚨 **A "none" entry opens `Monitoring: none` and says what would make it worth
revisiting.** Those two words are load-bearing: Step 0 above stops on them, and so
does anything else that reads this step back. Without them a refusal is an omission.

## 2. The account, the key, and where it may live

Say where this is going before you start: *"I create the account with you, get
one key out of the provider, put it where it belongs for this machine and for
the live app, and leave nothing of it in the repository. A few minutes. At the
end the app CAN report — nothing will have reported yet, and that is step 3."*

**Look on disk before you ask for anything**: `docs/app.md` for step 1's
decision, `.env` for a provider key somebody already put there, `package.json`
for a package already installed. A key already in `.env` means this was started
before — continue from there rather than minting a second one.

The per-provider walk-through — page names, values, API calls, variable names —
is in **`references/providers.md`** beside this file. Read the section for the
chosen provider, and **confirm every page name and address against the
provider's own site at the moment you need it**: that file carries the date it
was read, and *if the page you fetch today says something else, the page wins.*

### 2a. Two credentials, and only one of them belongs to the app

Most providers hand out **two** things, and treating them as one is how a key
that owns the whole account ends up in a file that gets copied around. Say which
one you are holding, out loud, every time.

| | What it is | Where it lives |
|---|---|---|
| **the ingest credential** | what the **app** sends its reports with — an error tracker's *DSN* (the address plus key its library posts to), an APM vendor's API key, an OTLP address and its header | DEV: this machine's `.env`. STAGING/PROD: the host's own **secret store** — the place a hosting provider keeps values for you so they never sit in a file |
| **the read/admin credential** | what **you** use once, here — to create the project through the provider's API, and in step 3 to ask whether one report arrived | the shell you are working in, for as long as this step takes. It is never written down |

The second row keeps the three rules `setup-hosting` §5 states for a hosting
token, word for word, because it is the same kind of thing:

- **Never into `.env`, never into the repo, never into a file you commit.**
- **Into the shell for as long as the step takes**, and no longer.
- If one has been somewhere it should not — a chat, a screenshot, a commit — say
  so plainly and **revoke** it at the provider (cancel it there, so the value
  stops working). A revoked key costs two minutes; a leaked one costs the account.

⚠️ **An error tracker's DSN is semi-public by design** — reporting from the
visitor's browser puts it in the JavaScript everybody downloads, and the vendors
say so. That is a reason to be exact about *which* credential you are holding,
never a licence to commit it: it is still an address somebody else can flood, and
the file it belongs in is `.env`. Whether this app reports from the browser at
all is a step 3 decision, not one to take here.

### 2b. What you do, and what needs a person

**The person** creates the account and agrees to the provider's terms — nobody
can accept terms on somebody else's behalf. **You** do everything the provider's
API can do: create the project, mint the key, read it back — with `fetch()`,
which Node has built in, never `curl`, which is not on every machine here. You
run the commands and say what came back; never hand over a command line and wait.

**If there is no browser on this machine** — the greeting says
`[Machine: no browser here …]`, or `node run.mjs doctor` reports the `browser`
check as absent — follow [`docs/machine.md`](../../../docs/machine.md): hand over
the link, say what they will see, and say that nothing continues until they
confirm. Do not claim a window opened here. Where the provider has a key path
needing no browser at all, name it and take it — the way `setup-hosting` names
`RAILWAY_TOKEN` and `FLY_API_TOKEN`; `references/providers.md` says who has one.

### 2c. Where a value may live

| Place | What goes in it | Does git see it |
|---|---|---|
| `.env` | the **value**, for DEV only — written with `setEnvValue()` (`scripts/lib/env-write.mjs`) | **no**, it is gitignored |
| `.env.example` | the **name** only, commented out, with a line saying what it is | **yes** — so never a value |
| the host's secret store | the **value** for STAGING and PROD — `railway variables --set …`, `fly secrets set …`, DigitalOcean's `type: SECRET` entry in the app spec, Render's *Environment* panel | no |
| the shell | the read/admin credential of 2a, for the length of this step | no |

🚨 **Never edit `.env` by hand, and never with `sed`, `>>` or an editor.**
`setEnvValue()` is this app's one writer: it normalises line endings (a Windows
checkout is the case that breaks silently) and it replaces a commented-out
`# KEY=` line **in place** rather than leaving a second one below it. Use it, or
the value is set twice and the app reads whichever comes last.

**No `_PROD` or `_STAGING` reference copy is created here**, and that is not an
omission. Those exist where a command on THIS machine calls the deployed app and
has to send that host's secret (`CRON_SECRET_PROD`, `DIAGNOSTICS_SECRET_PROD`).
Monitoring has no such caller: the app **sends**, and nothing here asks the
provider on its behalf. A copy nothing reads is one more place for a key to sit.

### 2d. The name goes into `.env.example`, the value never

**Edit `.env.example` first, then write the `.env`** — in that order, so the
section exists in the file a fresh clone is seeded from. The shape is the one the
rest of that file uses: a banner comment saying what it is and where it comes
from, then the key commented out with an empty value.

```
# === Monitoring ==============================================================
# What the app sends its error reports with. Created in the provider's own
# console. On a developer machine the value belongs here; in STAGING and PROD
# it lives in the host's secret storage instead.
# SENTRY_DSN=
```

That commented line is exactly what `setEnvValue()` replaces in place, so the
`.env` ends up with one line for the key and no duplicate. 🚨 **Never put a value
in `.env.example`** — not even a harmless-looking example one: that file is
git-tracked, and this app asserts that it scans clean.

### 2e. If a key lands in the repository anyway

Say what would actually happen, because two of the three answers surprise people.
`node run.mjs security-check` has a rung called `secrets`, and this is what it
says for each case:

| Where the value is | What `security-check` says |
|---|---|
| in `.env` — the correct place | ℹ️ LOW, *"not committed, but present"*. Its evidence is a **count**, never a value. This is the setup working, and it is reported only so its silence is not mistaken for nobody having looked |
| an `.env` file in git's **index** — staged, about to be committed | 🚨 CRITICAL, and the fix is an **order**: rotate at the provider → `git rm --cached` → `.gitignore` → clean the history **last**. Cleaning before rotating leaves a live key out there |
| pasted into a tracked source file | **measured: nothing sees it**, unless somebody has taught the scanner this provider's shape. See below |

**And git HISTORY is not scanned by that rung at all** — a value that was
committed and later deleted is invisible to it. The rung says so about itself;
that question is a separate rung and it needs `gitleaks` installed.

#### The third row, and how to close it

**Measured on 2026-08-11 against this template's own rules**
(`scripts/security/patterns.mjs`), by planting each value in a tracked file and
running the rung:

| planted in a tracked `.ts` file | what the rung said |
|---|---|
| a modern error-tracker DSN — 32 hex characters, `@`, the ingest host | **nothing** |
| an APM API key — 32 hex characters, no vendor marker | **nothing** |
| either of them on a `NEXT_PUBLIC_…` line | **nothing** |
| a legacy DSN carrying `user:password@host` | 🚨 CRITICAL — the one rule that fits |

That is not a defect. Every rule there is anchored on a **value**, there is no
entropy rule, and the refusal is what buys the property worth having: the shipped
app scans to **zero** findings, so a first run is a clean report rather than five
things somebody learns to ignore. The file's own header invites the customer to
extend it.

So, in this order, and **do all four parts or none of them**:

1. **Plant the needle first and watch it NOT be found.** Put one fake but
   correctly shaped value in a tracked file, run `node run.mjs security-check`,
   and show that nothing is reported. A rule added without this step is a rule
   nobody has measured.
2. **Add the rule** to this app's own `scripts/security/patterns.mjs`, with a
   written reason and the date on the entry. Anchor it on the **shape** —
   for a DSN that is the whole address, never the hex on its own.
   ⚠️ **A rule whose pattern names no literal anchor is refused by this app's own
   test suite** (`scripts/security/patterns.test.ts` → *"anchors every rule on a
   literal, never on a run of random characters"*). Measured: a rule anchored on
   `://` passes; one that is only a run of hex characters fails by name. Where the
   provider's key genuinely carries no marker, the only honest anchor is the exact
   variable name that holds it — and then that name goes into that test's own
   anchor list too, as a decision somebody wrote down, never as a wildcard over
   `*API_KEY*`. ⚠️ Give the new rule id a clause in `describeRule()`
   (`scripts/security/rungs/secrets.mjs`) in the same edit — measured: without one
   the finding's `Evidence:` line says only *"it looks for a credential shape"*,
   which tells its reader nothing about what fired.
3. **Run it again and watch it be found** — 🚨 CRITICAL, with the file and the
   line. Two runs, because one green run proves nothing about a check that never
   looked.
4. **Take the needle out, run a third time, and show the app is back to zero.**
   That is the property this template protects and it is now yours to keep.

🚨 **Until that rule exists, say it plainly: the scanner does not know this key.**
Never *"security-check will catch it"* about a shape nobody taught it.

Two facts that change what to worry about, and both are good news:

- **`node run.mjs update` never touches `scripts/`.** A rule added here survives
  every future update — that command carries text and never code.
- **A monitoring key appearing in a log line is already redacted** before the
  error window can hand it out (`lib/diagnostics/redact.mjs` carries a DSN shape
  and a long-hex shape). If the rule you add covers a shape that file does not,
  say so — do not widen the redactor as a side effect.

### 2f. Say where this app now stands

Name **one of three states**, and never let two of them sound alike:

| | |
|---|---|
| **nothing configured** | no key anywhere. Say what is missing and what it would take |
| **DEV configured, the deployed app not** | the value is in `.env` and the host has nothing. The live app — the only one customers use — is still silent |
| **both configured, and nothing has been proven yet** | every place has its value |

🚨 **The third one is not success.** Nothing has reported yet, and a dashboard
that has received nothing looks exactly like an app with no errors. The proof is
step 3, and until it has run, "configured" is all anybody may claim.

Then write one dated line into `docs/app.md` under **`## Decisions worth
remembering`** — which provider, which variable name, and that the value is in
`.env` and in the host's secret store. Never the value itself.

## 3. Install it, wire it, and prove it

Say where this is going: *"I install the one package your choice needs, wire it
into the file the app runs at startup, keep anything about a person out of it,
and then break something on purpose and go and find it again. Ten minutes, and
at the end there is a dated line saying monitoring was PROVEN, not configured."*
**Look on disk first** — a package already in `package.json`, or wiring already
in `instrumentation.ts`, means somebody started this before: carry on from it
rather than adding a second one.

### 3a. One package, then three checks

Install exactly what the chosen provider needs and nothing else — you run it,
and `references/providers.md` names the package and the wiring shape per
provider. Then `npm run typecheck` (it compiles), `npm run test` (nothing else
broke), and **`node run.mjs start`, reading the `✓ Environment: …` line back**.
The third is not redundant: green tests do not prove the app **boots**, and
`instrumentation.ts` is the one file where a mistake takes the whole app down at
startup rather than on one page. `package-lock.json` changes when you install —
it belongs in the same commit as the wiring.

### 3b. Where it goes, and why the order is the whole of it

`instrumentation.ts` is what Next.js runs once when the app starts, and **it is
read before it is touched**: the file is mostly reasoning, and every rule here is
argued in it. Its order is not stylistic, and the wiring joins it in one place:

> the `NEXT_RUNTIME !== "nodejs"` return · `installErrorCapture()` ·
> **← the provider's initialisation goes here** · `checkEnvironment()` and its
> `throw` · the `NEXT_PHASE === "phase-production-build"` return · the scheduler.

| The rule | Why it is that way |
|---|---|
| **`installErrorCapture()` stays first** | the file says why: the environment check's own `console.error` lines and the scheduler's `[cron] tick failed` are exactly what an operator later goes looking for through `node run.mjs errors --url …`. Anything placed above it costs those lines |
| **the init goes before `checkEnvironment()`** | so a startup that ABORTS is reported too — the failure an operator most needs to hear about and is least likely to see, because the app that would have told them is the app that did not start |
| **both guards are respected**, never duplicated and never moved | the edge return above (everything below it is Node-only by construction) and the build-phase return below (never initialise during a build) |
| **a dynamic `await import()`, never a static one** | every import in that file is dynamic and the comments say what happens otherwise: a provider SDK is a large graph, the hook is built for the edge runtime too, and a static import is how startup stops resolving on a machine where nothing looks wrong |
| **it must never be able to stop the app** | wrap the initialisation, log one line if it fails, carry on. An app that refuses to boot because its error tracker is unhappy has traded a reported error for an outage |
| **no credential means do nothing, quietly** | not a warning on every start — one that fires in every session is one people stop reading. An app with no key behaves exactly like an app that chose no provider, so **say which of the two this one is** rather than leaving it to be guessed |

### 3c. What must not leave the app

The tracker receives error text, **stack frames** (the list of calls that led to
the crash) and request paths. Four things, none of them optional:

| | |
|---|---|
| **the identity switch stays off** | by the vendor's own option name (`references/providers.md`), and said out loud rather than assumed |
| **scrub through the shapes this app already has** | `lib/diagnostics/redact.mjs` is its existing scrubber — addresses, bearer tokens, connection strings, long hex runs — and those shapes go into the SDK's own scrubbing hook. A second redaction list is the mistake CLAUDE.md names under *Rules*, and it drifts from the first within a month |
| **the provider joins `docs/data-protection.md` §5** | as a recipient, naming what reaches it. `compliance-check` drafts the privacy policy from that file, so an unlisted processor is a policy that is wrong the moment it is written |
| **reporting from the BROWSER is a separate, recorded decision** | and not part of this step: it puts the ingest address into the JavaScript every visitor downloads and sends the visitor's own data (`docs/compliance.md` §2). This step wires **server-side only**, and choosing otherwise goes into `docs/app.md` with that consequence beside it |

### 3d. The proof — one marker, searched twice

🚨 *"It is wired and nothing went wrong"* proves the file compiles, and an event
sent from your own shell proves the credential. Neither proves that the **app**
reports. So, in this order, and all six of them:

| | |
|---|---|
| 1 · **compose a marker** | a fixed label plus a fresh random tail, e.g. `monitoring-probe-<12 hex characters>`. ⚠️ Measured 2026-08-11 against `lib/diagnostics/redact.mjs`: a tail of **32 or more hex characters** comes back as `<secret>` and **seven or more digits** as `<number>`, so a marker of either shape is scrubbed before anybody could find it. Twelve hex characters survives |
| 2 · **search the provider for it NOW** | and expect nothing. Without this first search, a hit later proves only that the provider has events in it |
| 3 · **raise it from inside the running app** | a temporary `app/api/<name>-probe/route.ts` whose handler does nothing but `throw` the marker, plus its one line in `app/route-protection.test.ts` → `PUBLIC` with the sentence saying what guards it. Measured: without that line the test fails and names the route — the backstop working, not an obstacle. ⚠️ And `node run.mjs smoke` never walks a `route.ts` under `app/api/`, so this probe is invisible to it by construction; do not go looking for it there |
| 4 · **call it once** | and report the status that came back |
| 5 · **search again** | by the provider's API where there is one, otherwise by naming the exact page and the exact thing to look for — and looking yourself. Count **events**, not text matches: the same marker in the message and again in the code frame is one event twice |
| 6 · **take both edits out** | then run `npm run test` and `npm run typecheck` again and say the tree is back. Never assume it |

❌ *"Check your dashboard and tell me whether you see it"* is not this step, and
❌ making an existing page throw instead is worse than it looks: it breaks a real
surface, and what it proves is indistinguishable from an accident.

### 3e. Say what was proven — and write the date down

Name what holds now — the package is installed, `instrumentation.ts` initialises
it, the credential is valid, events arrive, and you found one — then name what
does **not**: that the **deployed** app reports is a different claim with a
different proof, which is to read the variable back out of the host's own secret
store, redeploy, and repeat 3d against the deployed address.

Then one dated line into `docs/app.md` under `## Decisions worth remembering`:
the provider, the variable name, where the wiring sits, and **the date the probe
last succeeded**. 🚨 *"Nothing reported" and "nothing is reporting" look identical
from a dashboard* — a silence with a dated proof behind it and a silence with no
proof at all are two different sentences, and that date is the only thing telling
them apart.

## 4. Something that keeps asking

Say where this is going: *"I set up something outside your app that keeps asking whether it is
alive, then set one alarm off on purpose so you have seen one arrive — that last part waits one
check interval."* You make the calls, with step 2's read/admin key held in the shell and written nowhere; per provider: [`references/providers.md`](references/providers.md) → **Step 4**.

🚨 **Write the rule so it CAN fail.** Bind it to the **HTTP status**: 2xx passes, and "any
response" is the same bug elsewhere — readiness answers 503 on purpose. Match the body only
as a second condition, and then on `"status":"ready"` **with its quotes and its colon**, never
the bare word: the failing body is `{"status":"not-ready"}`, **`ready` is a substring of
`not-ready`**, so a check on that word passes on the very failure it exists to catch.

| | |
|---|---|
| **The two endpoints** | `/api/healthz` says the process is answering and asks nothing else; `/api/readyz` also runs `select 1` against the database and answers **503** when it cannot reach it. Both are public by design, so a check needs no credential — and `{"status":"ok"}` shares no keyword with readiness at all. Watch **both**. Today the only thing calling either is `node run.mjs health --url …`, which answers when ASKED; this step is what makes the asking repeat |
| **Where the alarm goes** | the **provider's** own mail, chat or phone route — never `config/notifications.json` / `notifyOperators()`: an app that is down cannot mail you about being down, and this app's mail runs inside it. A third channel with a producer of its own, so the one-reporter rule is untouched |
| **The interval** | liveness short, readiness **longer** — every `/api/readyz` call runs a `select 1` on the production database. Fetch the free tier's limit now and say it as a SHAPE (minutes rather than seconds), never as a figure and never as equivalent to a paid one: a check that looks every few minutes cannot see a short outage at all |
| **One alarm, on purpose** | a **throwaway** check on `/api/healthz` carrying the READINESS rule — `{"status":"ok"}` cannot satisfy `"status":"ready"`, so it fails at once without touching anything a customer can reach. Wait one interval, have the person confirm the alert is in their hand, then delete the check. ❌ The provider's *"send test notification"* button is **not** this: it never runs a check, so a check that could never fail passes it too |
| **Created is not running** | read back from the provider that the check has **RUN**, and what it answered. *No check* · *a check that has never run* · *a check that has run and found the app up* are three different sentences, and only the last is health |
| **What it cannot see** | *is it reachable*, and nothing else — not a page that answers **200** and is visibly broken (*Never ship a broken page*), and never **why**. The two halves that do: step 3's tracker, and `node run.mjs errors --url …`, which answers when asked, empties on every restart and belongs to one instance |

## Next

Say what now holds — something outside this app keeps asking, the alarm reaches a person, one
alarm has really arrived, and `docs/app.md` carries the endpoints, the interval, the channel and
**that date** — then offer the one next thing: **`go-to-market`**, or back to whatever the user
was doing. If step 1's answer was "none", none of this ran: say what was recorded, what would make it worth reopening, and hand back.

## The rules

1. **Look before you ask.** `docs/app.md`, `.env`, `package.json` — the answer
   to "is anything watching this?" is on disk in most apps.
2. **A recorded "no" is an answer.** Say so and stop.
3. **Say the price before they sign up** — one figure, fetched now, never from
   this file or from memory.
4. **One recommendation, not four options.** The reason belongs in the same
   sentence as the name.
5. **Never promise a channel that has no sender.** Nothing in a fresh app writes
   to its operator by itself.
6. **The decision is written down the moment it is made**, in both directions.
   A decision that lives only in a chat transcript is gone when the session is.
7. **Two credentials, and they are treated differently.** The app's own goes into
   the environment; the one that can administer the account goes into the shell
   for the length of the step and nowhere else.
8. **A value never enters a file git tracks** — the name goes into
   `.env.example`, the value into `.env` through `setEnvValue()` and into the
   host's secret store. And never claim `security-check` catches a key shape
   nobody has taught it.
9. **"Configured" is not "working", and a proof is a marker searched twice.** A
   dashboard that has received nothing looks exactly like an app with no errors,
   and an event sent from your own shell proves only the credential. The search
   that comes back EMPTY is what makes the second one mean anything.
