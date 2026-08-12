<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Where each provider keeps its keys — the per-provider walk-through

Part of the skill `setup-monitoring`, step 2. SKILL.md holds the procedure —
which credential is which, where a value may live, and what happens if one lands
in the repository. This file holds the part that is different per provider: what
the credential is called there, which page carries it, what its API can do
instead of a click path, and which variable name its own library expects.

> **The page names and addresses below were read on 2026-08-11.** Vendors rename
> their navigation and move their endpoints, so **confirm each one against the
> provider's own site at the moment you need it** — and *if the page you fetch
> today says something else, the page wins.* Say so out loud when it happens
> rather than quietly following a stale path.

**No prices, no quotas and no plan sizes are written down here**, on purpose and
for the same reason step 1 gives: a number somebody budgeted on is worse stale
than missing. Fetch the provider's own pricing page when the question comes up.

## The shape every one of them has

Whatever the vendor, the same two things come out of this — and SKILL.md §2a is
the rule for telling them apart:

| | |
|---|---|
| **the ingest credential** | belongs to the **app**. It goes into `.env` for DEV and into the host's secret store for STAGING and PROD |
| **the read/admin credential** | belongs to **you**, for the length of this step. It creates the project and mints the first one, and it is never written into a file |

Where a provider issues only one thing that does both, say so plainly and treat
it as the read/admin one: a credential that can administer the account does not
become safe by being needed twice.

## 1 · An error tracker (Sentry, and its kind)

**What the ingest credential is called there:** the **DSN** — *Data Source Name*,
a single address that carries the project's public key inside it. It is what the
library posts reports to.

| | |
|---|---|
| **Where the DSN is** | *Settings → Projects → `<your project>` → Client Keys (DSN)*. The value to copy is the one labelled **DSN**, and it is a whole `https://…` address, not just the key part |
| **The read/admin credential** | an **auth token**, under *Settings → Auth Tokens* at the organisation level (a personal one lives under *Settings → Account → API → Auth Tokens*). Scope it to what this step needs — creating a project and reading its keys — and nothing wider |
| **What the API can do** | create the project and read the DSN back, so neither needs a click path: `POST /api/0/teams/{organization}/{team}/projects/` creates one, `GET /api/0/projects/{organization}/{project}/keys/` returns its client keys, DSN included. Both take the auth token as a bearer header. Confirm the current paths in the provider's API documentation before you call them |
| **Account creation** | needs the browser and needs the person — there is no token path around signing up and accepting terms |
| **The variable its library expects** | `SENTRY_DSN` on the server |

⚠️ **There is a browser-side twin of that variable** (`NEXT_PUBLIC_…`), because
reporting from the visitor's browser needs the DSN in the JavaScript bundle. The
template's own secret scanner treats a `NEXT_PUBLIC_` line as the thing it is —
already published to everybody who loaded a page. **Whether this app reports from
the browser at all is a step 3 decision**: set the server variable here, and
leave the other one until there is code that reads it.

## 2 · Full APM (Datadog, and its kind)

**Two keys, and here the distinction is not a subtlety — the vendor names them
separately and means it.**

| | |
|---|---|
| **The ingest credential** | the **API key**, under *Organization Settings → API Keys*. This is what an agent or a library sends measurements with |
| **The read/admin credential** | the **application key**, under *Organization Settings → Application Keys*. It reads and administers, and it is the one that must never leave the shell |
| **What the API can do** | mint and list API keys — `POST /api/v2/api_keys` and `GET /api/v2/api_keys` — authenticated with the API key *and* the application key together. So the person creates the account and the first pair in the browser, and everything after that is yours to do |
| **The variables its library expects** | `DD_API_KEY`, plus `DD_SITE` for the region the account was created in — the wrong site value fails with an authentication error that reads like a bad key |

🚨 **The API key is 32 hex characters and carries no vendor marker at all.** That
is the case SKILL.md §2e is about: nothing in this app's secret scanner can
recognise it by its value, and the only honest anchor is the exact variable name
that holds it. Read §2e before deciding what to do about that — and until a rule
exists, say plainly that the scanner does not know this key.

## 3 · An uptime check

Thin on purpose: **step 4 of this skill sets an uptime check up** — its
walk-through is at the bottom of this file (*Step 4*), so it is not written
twice. What belongs in step 2 is only this:

- These services check an address from outside. This app already has the two
  endpoints for it — `/api/healthz` and `/api/readyz` — so nothing has to be
  built for one.
- Their credential is a single **API key** for the service's own API, found under
  the account's settings (UptimeRobot puts it under *My Settings → API keys*;
  Better Stack under *Integrations → API tokens*). It is a **read/admin**
  credential in the sense of §2a: it creates and edits monitors. **It is not an
  ingest credential and nothing in this app ever sends it anywhere**, so it does
  not belong in `.env` at all.
- So: create the account with the person now if the plan is to use one, and stop
  there. The monitor itself is step 4.

## 4 · A plain OpenTelemetry endpoint

**There is no account here and no key of this kind at all** — OpenTelemetry is a
way of sending measurements, not a service that receives them. The credential
belongs to whichever backend the operator already has (Grafana Cloud, SigNoz, a
system their company runs), and it is that backend's own documentation that says
where it lives.

What is the same everywhere:

| | |
|---|---|
| **The ingest credential** | an address plus a header. The header carries the backend's key, and it is the ingest credential of §2a — `.env` for DEV, the host's secret store for STAGING and PROD |
| **The variables** | `OTEL_EXPORTER_OTLP_ENDPOINT` for the address and `OTEL_EXPORTER_OTLP_HEADERS` for the header, both read straight from the environment by every OpenTelemetry library |
| **Read/admin** | whatever the backend uses. If the operator already has a working setup, ask them for the ingest address and header only — there is no reason for this step to hold anything that can administer their system |

⚠️ **A header variable holds the whole credential inside a longer string**
(`Authorization=Bearer …`). It is still a value, it still never goes into
`.env.example`, and the name is what gets documented there.

# Step 3 — the package, the wiring, and how to find one event

> **The same rule as above, and it matters more here**: these shapes were read on
> **2026-08-11**. SDK options get renamed and default differently between major
> versions, so **confirm each one against the provider's own current
> documentation before you write it** — and *if the page you fetch today says
> something else, the page wins.* Say so out loud when it happens.

Four things are asked of every provider below, because SKILL.md §3b and §3c ask
them of every provider: the **package**, the **initialisation shape** for this
app's `instrumentation.ts` hook, the **identity switch that stays off**, the
**scrubbing hook** the app's own `lib/diagnostics/redact.mjs` shapes go into, and
**how the provider is searched for a single marker**.

Two rules from SKILL.md §3b apply to every snippet here and are not repeated in
each one: the import is **dynamic** (`await import(…)`), and the initialisation
is **wrapped** so it cannot throw out of `register()`.

## 1 · An error tracker (Sentry, and its kind)

| | |
|---|---|
| **Package** | `@sentry/nextjs` — one package, and it is the only one this step installs |
| **Where it goes** | inside the existing `register()` in `instrumentation.ts`, after `installErrorCapture()` and before `checkEnvironment()`. **Not** in a `sentry.server.config.ts` of its own: that file is a second startup path, and this app already has one that is ordered on purpose |
| **The shape** | `const Sentry = await import("@sentry/nextjs"); Sentry.init({ dsn: process.env.SENTRY_DSN, sendDefaultPii: false, beforeSend })` — and the whole thing inside a `try`/`catch` that logs one line |
| **No key** | `SENTRY_DSN` unset means **do not call `init` at all**, and say nothing. Passing an empty DSN is not the same as not initialising, and it is the version that logs on every start |
| **The identity switch** | `sendDefaultPii: false`. It is the vendor's default today, and it is written out anyway — it is the switch a tutorial tells somebody to flip, and an explicit `false` with a comment is what makes flipping it a decision |
| **The scrubbing hook** | `beforeSend(event)` (and `beforeSendTransaction` where traces are on). Run every string you pass through the shapes in `lib/diagnostics/redact.mjs` — never write a second list |
| **Searching for one marker** | *Issues* → the search box, query `"<marker>"`. By API: `GET /api/0/projects/{organization}/{project}/issues/?query=<marker>` with the auth token of §2a as a bearer header. An empty `[]` is the answer the FIRST search wants |

## 2 · Full APM (Datadog, and its kind)

| | |
|---|---|
| **Package** | `dd-trace` for the Node side. `DD_API_KEY` **and** `DD_SITE` both have to be set — a wrong site fails as an authentication error that reads like a bad key |
| **The shape** | `const tracer = (await import("dd-trace")).default; tracer.init({ logInjection: true })`, in the same place and equally wrapped |
| **The identity switch** | there is no `sendDefaultPii` here: the tracer attaches **no** user by itself, and what would attach one is your own `tracer.setUser(…)`. **Do not call it**, and say that it is not being called — a switch that does not exist still needs the sentence, or the next reader assumes the protection is there |
| **The scrubbing hook** | 🚨 **this family has no per-event hook of the first row's kind.** The honest consequence: whatever you send it is what it keeps, so the redaction has to happen **before** the send, in your own code, through `lib/diagnostics/redact.mjs`. Say this plainly rather than implying a hook exists |
| **Searching for one marker** | *Error Tracking* or *Log Explorer* with the marker as the query. By API: `POST /api/v2/logs/events/search`, authenticated with the API key **and** the application key together |

## 3 · An agent that wants to load first (New Relic, and its kind)

Named separately because of one property that changes the answer: **its agent
expects to be the first thing the process loads** (`node -r newrelic …` or an
equivalent), which is the opposite of the dynamic import §3b requires.

So there is no honest snippet for this app's `register()`. Two lawful outcomes,
and the choice is the operator's: wire it the vendor's way at the **process**
level (the host's start command, outside `instrumentation.ts` entirely) and
record that in `docs/app.md`, or choose a provider whose SDK initialises inside
the hook. **Do not pretend it fits in `register()`** — a late-loaded agent
reports partial data and looks exactly like a working one.

## 4 · A plain OpenTelemetry endpoint

| | |
|---|---|
| **Packages** | `@opentelemetry/sdk-node` plus an exporter (`@opentelemetry/exporter-trace-otlp-http` and its kind). ⚠️ **This is the one row that is several packages**, so §3a's "exactly one" reads as "exactly the set this backend needs, and nothing beyond it" |
| **The shape** | `const { NodeSDK } = await import("@opentelemetry/sdk-node"); new NodeSDK({ … }).start()` — same place, same wrapping. Address and header come from `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`, read by the libraries themselves |
| **The identity switch** | nothing attaches a person by default. What would is an attribute you add yourself — so the rule is simply that **no span attribute carries a member id, an address or anything a customer typed** |
| **The scrubbing hook** | a span processor of your own, in front of the exporter, running the `lib/diagnostics/redact.mjs` shapes over the attributes it forwards |
| **Searching for one marker** | whatever the receiving backend offers — Grafana, SigNoz, the company's own. 🚨 There is no API to name here, so **name the exact view and the exact query you used**, and look yourself. "It should be in Grafana somewhere" is not the second search |

# Step 4 — the uptime check: creating it, and one alarm that really arrives

> **Same rule as above, and it is the reason this section is dated**: the shapes
> below were read on **2026-08-11** from each vendor's own API documentation.
> Endpoints and field names move — **confirm each one at the moment you call it,
> and if the page you fetch today says something else, the page wins.** Say so
> out loud rather than quietly following a stale path.

SKILL.md §4 holds the rules — bind the check to the status code, match the body
only on `"status":"ready"` with its quotes, send the alarm through the
provider's own channel, prove one alarm arrives. This file holds the part that
is different per provider.

## What the two checks are, whatever the provider

| | `/api/healthz` | `/api/readyz` |
|---|---|---|
| **Answers** | `200 {"status":"ok"}` — the process is answering, and it asks nothing else (that route has no imports at all) | `200 {"status":"ready"}`, or **`503 {"status":"not-ready"}`** when `select 1` did not come back |
| **The rule to configure** | 2xx only, and where a body match is offered, `"status":"ok"` | 2xx only — **never "any response"**, because 503 is this endpoint's deliberate answer — plus, at most, `"status":"ready"` **with quotes and colon** |
| **Interval** | the short one | the **longer** one: every call runs a `select 1` against the production database |
| **Credential** | none, and none may be sent. Both are public by design (`app/route-protection.test.ts`) | none |

🚨 **The bare word `ready` is the defect this step exists to prevent.** It is a
substring of `not-ready`, so a keyword check written on it reports green while
the database is unreachable — silently, and for ever. Two provider shapes make
that mistake especially easy and are called out in their rows below: a keyword
type whose polarity is a number, and a "keyword present" check on a body that
contains the word in both directions.

## The five questions, and where each provider answers them

Ask exactly these of whichever provider was chosen in step 1, because they are
what step 4 needs and nothing more: what the object is **called** there, which
call **creates** one, how the **matching rule** is expressed, how an **alert
destination** is attached, and how the check's **last run** is read back.

### 1 · Better Stack (Uptime)

| | |
|---|---|
| **The object** | a **monitor** |
| **Create** | `POST https://uptime.betterstack.com/api/v2/monitors`, `Authorization: Bearer <token>`. The token is the read/admin credential of §2a — shell only, never `.env` |
| **The matching rule** | `monitor_type` decides what "up" means. `status` accepts any 2xx; `expected_status_code` checks against the `expected_status_codes` array; `keyword` requires `required_keyword` to be **present**. For readiness use a status-based type, and where a keyword is wanted too, `required_keyword` is the string `"status":"ready"` — with its quotes — never `ready`. ⚠️ `keyword_absence` also exists and inverts the meaning; picking it by accident is a check that passes only while the app is broken |
| **Interval** | `check_frequency`, in **seconds** |
| **Alert destination** | boolean flags on the monitor — `email`, `sms`, `call`, `push` — or `policy_id` for an escalation policy. All of them are the provider's own channels, which is what §4 asks for |
| **Read the last run back** | `GET /api/v2/monitors/{id}` → **`status`** (`pending`, `up`, `down`, `paused`, `validating`, `maintenance`) and **`last_checked_at`**. 🚨 `pending` is literally *"created, never run"* — the state SKILL.md §4 says must never be reported as health |
| **Delete** | `DELETE /api/v2/monitors/{id}` — how the throwaway check goes away again |

### 2 · UptimeRobot

| | |
|---|---|
| **The object** | a **monitor**; a keyword monitor is a monitor `type` rather than a separate thing |
| **Create** | v3 is the current API: `https://api.uptimerobot.com/v3/`, resource paths (`/monitors`, `/integrations`), bearer token in the `Authorization` header. The legacy v2 is still answering — `POST https://api.uptimerobot.com/v2/newMonitor`, form-encoded, `api_key` in the body — so **check which one the account's key belongs to before writing a call** |
| **The matching rule** | a keyword monitor takes `keyword_value` plus a `keyword_type` that says whether the alarm fires when the keyword **exists** or when it does **not exist**. 🚨 That polarity is a number, and getting it the wrong way round produces a check that is green exactly while the app is down. For readiness the intent is *alert when `"status":"ready"` is absent* — write that intent down beside the value, and confirm the current number in their docs rather than from memory |
| **Interval** | `interval`, in **seconds** |
| **Alert destination** | **alert contacts** — mail, and the integrations the account has. A monitor is joined to them by id (v2 passes them as `alert_contacts`); a monitor with none created is a check nobody hears |
| **Read the last run back** | list or get the monitor and read its `status`. It has a value meaning **"not checked yet"**, distinct from up and from down — that value is the middle of SKILL.md §4's three states. `logs` / `response_times` return what it has actually seen. Confirm the numeric codes against the current documentation |
| **Delete** | v2 `POST /v2/deleteMonitor` with the `id`; v3 the corresponding `DELETE` on the resource path |

### 3 · Anything else — Cronitor, Pingdom, Checkly, a host's own check

Do not guess. Fetch that provider's API reference and answer the five questions
above **in writing** before creating anything, then follow the same procedure:
the object's name is theirs, the rules are SKILL.md §4's. Two shapes recur and
both are traps worth naming while you read: an assertion language where
`response.body contains ready` is the natural thing to type, and a default that
treats **any** HTTP answer as up.

### Where the provider genuinely has no API for this

Say so **by name** — *"UptimeRobot/Better Stack/… has an API for monitors, this
one does not"* — and then hand over the exact screen and the exact values, in a
table the person can work through: the address, the rule, the interval and the
alert destination. Never dress a click path as a command, and never claim to
have created something that a person still has to create.

## The deliberate alarm, in order

The epic asks for one alert that is really received. This is the only way to get
it that is honest and does not take the live app down. Do all of it, in order:

1. **Say it will wait.** One check interval passes between causing the failure
   and the alert arriving — on a free tier that is the minutes class, not the
   seconds class. Say so before starting, or the session looks like it hung.
2. **Create a THROWAWAY check** — its name says so, e.g. `alarm-test (delete
   me)` — pointed at **`/api/healthz`** and carrying the **readiness** rule
   (`"status":"ready"` present). That endpoint answers `{"status":"ok"}`, so the
   rule cannot be satisfied and the check fails at once, while touching nothing
   a customer can reach.
3. **Wait one interval**, then confirm **with the person** that the alert is in
   their hand — the mail, the message, the call. Their confirmation is the
   result; the provider's own "an alert was sent" line is not.
4. **Delete the throwaway check** in the same session, and say that it is gone.
5. **Say what it proves**: the provider really polls, a rule of this shape
   really fails, and the alert really reaches **this person**. And what it does
   not prove: nothing at all about the live app, which was never touched.

❌ **A provider's built-in *"send test notification"* button is not accepted as
this proof.** It never runs a check, so a check that could never fail passes it
just as well — it tests the notification channel and leaves the question open.

⚠️ **Where the provider offers no body matching at all**, the fallback is a
throwaway check on an address certain to 404 (`/api/healthz-does-not-exist`).
It proves the polling and the alert path but **not** the rule — so say **which
of the two you used**, rather than reporting the same sentence for both.

## Reading it back — created, running, reporting

🚨 **"The check exists" is not a result.** Read back from the provider that the
check has **run at least once** and what it answered, and name the states apart
in words rather than in a colour:

| | What the provider shows | What it means |
|---|---|---|
| **no check** | nothing with that name | nobody is watching |
| **a check that has never run** | Better Stack `pending`; UptimeRobot's "not checked yet"; an empty `last_checked_at` | created, and silent for the same reason a deleted one is silent |
| **a check that has run and found the app up** | `up` with a `last_checked_at` in the last interval | this, and only this, is the answer worth reporting |

The template's own vocabulary already carries the distinction: `node run.mjs
cron --list` marks an **enabled job whose last run is `never`** as a finding for
exactly this reason.

## The line that goes into `docs/app.md`

One dated line under `## Decisions worth remembering`, in the file's own voice.
It names the endpoints, the interval, where the alert goes and — the part that
makes a quiet month mean something — **the date the deliberate alert arrived**:

```markdown
- Uptime: <provider>, since 2026-08-11 — /api/healthz every <interval>,
  /api/readyz on the longer one, both bound to the status code, readiness also
  matching "status":"ready" (never the bare word: it is a substring of
  not-ready). Alerts go to <the provider's own channel>. A deliberate alert was
  caused and received on 2026-08-11.
```

🚨 **Nothing in this app re-derives that date**, deliberately: the alternative
is the app polling its own monitoring provider, which is one more thing to
configure and one more thing to be silently broken. The date is the evidence,
and a silence with no date behind it is not evidence of anything.
