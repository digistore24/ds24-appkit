---
name: security-gateway
description: The security check for this app. Scans it for holes — unprotected routes, access to other people's data (IDOR), secrets in the code, a bypassed IPN signature, a chat tool that hands out too much, XSS, vulnerable packages, a misconfigured host, text hidden in the files an agent reads as instruction — then fixes and reports. Use it before the app processes real payments and customer data, after larger changes, and whenever somebody asks "is this safe?", "is this route protected?", "is there a secret in the code?", "could something be hidden in a module I installed?".
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Security gateway — scan, judge, fix

This app handles **money and customer data**. Before it goes live, and after
anything larger changes, it gets checked properly: **scan → judge → fix →
verify → report.** Wave nothing through.

This is not a generic OWASP recital. It is written for **this** template —
Next.js 16, Auth.js, Drizzle on Postgres, Digistore24 for the money — and it
names the actual files, the actual columns and the actual routes. That is what
makes it worth more than a scanner: a scanner finds patterns, this finds the
holes this app can actually have.

The standing rules it checks against live in **`guardrails`** — that skill is the
single copy, this one is the audit against it. Where the two ever disagree,
`guardrails` wins.

## How to use this skill

Ten checks. You do not have to know which one you want.

| # | Check | What it looks at | Roughly |
|---|---|---|---|
| 1 | **`all`** | everything below, in the right order | 20–40 min |
| 2 | **`code`** | access control: who may see and change what | 10–15 min |
| 3 | **`pay`** | the money: IPN signature, idempotency, entitlements | 5 min |
| 4 | **`secrets`** | what must never be in git — and what harmlessly is | 5 min |
| 5 | **`deps`** | the packages and their known holes | 2 min |
| 6 | **`api`** | the endpoints that answer without a session | 5–10 min |
| 7 | **`host`** | environment, headers, the live configuration | 5 min |
| 8 | **`verdicts`** | judged elements: is the solution where the customer can read it | 5–10 min |
| 9 | **`fix`** | fix the findings of the last report | depends |
| 10 | **`since`** | the recurring pass: only what changed since the last report *(needs template 0.24.0)* | 3–10 min |

**How to dispatch:**

- If the user already said what they want ("check the secrets", "is `/api/v1`
  safe?"), start that check. Do not show the menu first.
- Otherwise show the table, say that **`all`** is the one to run before a
  launch, and wait for an answer. A number, a name or a description all count.
- Before a launch, after a security-relevant change, or when in doubt: **`all`**.
- For the recurring round on an app that has **already been reviewed once**, and
  only then: **`since`** (§10). No previous report means `all` — a diff against
  nothing is not a review.
- **You run the commands** — through your Bash tool, not by telling the user to
  type them. That is the rule for the whole template.

Every check ends the same way: findings with a severity → into the report →
offer to fix.

## What counts as a finding

The ladder, the four-line `Where:` / `Why:` / `Fix:` / `Evidence:` format and the
confidence rule are the shipped ones and are **not** restated here in other words
— read them in [`docs/guidance.md`](../../../docs/guidance.md) → *One report
shape*. What is this skill's own is what each rung means here:

| | Severity | Meaning |
|---|---|---|
| 🚨 | **CRITICAL** | Money or foreign data is reachable right now. Stop and fix it before anything else. |
| ❌ | **HIGH** | Fix before the launch, or before the next deploy if the app is already live. |
| ⚠️ | **MEDIUM** | Real, but it needs a second condition to become dangerous. Fix soon. |
| ℹ️ | **LOW** | Hardening. When you get around to it. |

**What counts as shown, here:** a code path you have actually read, or a request
you have actually sent. Anything resting on an assumption about code you did not
read goes into **Worth a look**, not into the count. And **Why** says what
somebody gets out of it — not "Broken Function Level Authorization".

## 1 · `all` — the full pass

Run the checks in this order. It is not arbitrary: the cheap ones that find the
worst things come first, so a launch that has to stop stops early.

1. **`secrets`** — the only finding class that stays dangerous after you fix it
   (the key is out; it has to be rotated). Always first.
2. **`deps`** — two minutes, and the fix is usually one command.
3. **`code`** — the long one, and the one that finds what scanners cannot.
4. **`pay`** — small, sharp, and the most expensive when wrong.
5. **`api`** — needs the app running (`node run.mjs start`).
6. **`verdicts`** — only where `ACTIVITIES` has entries; skip it with a note
   otherwise. It needs the production build, and it finds the failure every
   other check is blind to.
7. **`host`** — only meaningful once there is a host; skip it with a note before
   the first deploy.

Then: one report, one summary, one offer to fix.

If the environment has a security review tool (`/security-review`), run it as
well and fold its findings in. It reads the diff; this reads the app. They do
not overlap as much as they look like they do.

## 2 · `code` — access control

The deep read. Do not grep your way through this one — **read the files**. The
list is short because the template is fixed:

```
proxy.ts  auth.config.ts  auth.ts  lib/authz.ts  lib/roles.ts
lib/entitlements/manage.ts        lib/tokens/spend.ts
lib/ai/tools.ts  modules/api/keys/keys.ts   (when the api module is installed)
lib/impersonation/session.ts  lib/impersonation/guard.ts
lib/credentials/hash.ts  lib/rate-limit.ts  lib/email-change/manage.ts
db/schema.ts             lib/privacy/export.ts
lib/setup/               (the third delivery layer — the ONLY one that takes
                          member ids by design, so an id it fails to check is
                          an id nothing else would have accepted)
modules/community/lib/embeds.ts   (when the community module is installed and
                                   switched on)
every app/**/actions.ts           every app/api/**/route.ts
every modules/*/routes/*.ts       (the v1 handlers; app/api/v1/**/route.api.ts
                                   only re-exports them)
```

The last three joined in template 0.24.0 — all three were customer-data surfaces
by this skill's own definition already, so naming them makes the full pass
slightly larger and lets §10 hold its own list against this one.

Plus everything the user has built themselves — their own pages under
`app/dashboard/`, their own tables in `db/`, their own actions. That is where
new holes come from; the template's own code has been through this before.

The recipes for this check are in **`references/check-code.md`** — which
routes are public on purpose and which by accident, IDOR and the `memberId`
ownership column, why entitlement is answered by `hasPlan(memberId,
productKey)` and never by a billing table, the chat-tool audit, the community
pass (the kill switch, DM scoping, embeds, the live channel, activity leaks,
an impersonated session), the impersonation audit, and the
input/output fingerprints (SQL injection, XSS, timing-safe comparison, weak
randomness, secrets shipped to the browser). Read that file in full while
running this check; it carries the severity for every finding.

## 3 · `pay` — the money

Small check, sharp questions. `lib/digistore/`, `app/api/ipn/route.ts`,
`lib/entitlements/`, `lib/tokens/`.

- **The SHA512 signature check is active and fail-closed** (`lib/digistore/ipn.ts`).
  Invalid signature → 403, no side effects, no "log it and carry on". A bypass —
  an early return, a `if (process.env.NODE_ENV !== "production")`, a commented
  check — is **CRITICAL**. This is the only thing standing between a stranger
  and free access to every product.
- **Order status is set through IPN events only.** Anything else writing
  `orders.status` is **CRITICAL**. <!-- not-an-access-check: this is the write rule; access is hasPlan() -->

- **Idempotency by `ds24OrderId`.** Digistore24 retries; a repeat must not book
  twice. On tokens the pair is `(accountId, ds24OrderId)`. **HIGH.**
- **No mock or demo fallback on an API error.** A `catch` that returns a fake
  successful purchase grants access for free. **CRITICAL.**
- **Prices come from Digistore24**, never from the client. A form field that
  decides what something costs is **CRITICAL**.
- **Auto top-up goes through `claimReloadSlot`** (`lib/tokens/spend.ts`) — the
  slot is what stops a double charge under concurrency. **HIGH.**

## 4 · `secrets` — what must never be in git

```bash
node run.mjs security-check
```

That is where this check starts, exactly as §5 does — one rung of it scans the
**working tree** and needs nothing installed. It reads git's index and the
staged blobs, its rules are anchored on credential SHAPES rather than on
variable names, and there is deliberately no entropy rule. A finding gives you
`path:line` and never the value. What exactly it reads, and the measurement
behind that refusal, are in **`references/checks-secrets-and-deps.md`**.
Needs template 0.23.0.

🚨 **The working tree is always covered; git HISTORY only where `gitleaks` is
already on the machine.** They are two rungs, deliberately: the working-tree one
needs nothing installed and always runs, and `secrets-history` runs `gitleaks`
over the history where that tool happens to be there — it is **never
downloaded**, so on a machine without it the rung reports `⏭ not asked` with the
reason and the one-line way to get it, which is never a pass. The tree rung says
so in its own covers line rather than letting its silence answer for history: a
value that was committed and later deleted is invisible to it. So the command
settles the first row of the verdict table below (in the tree now → 🚨 CRITICAL),
and the second row (not in the tree, but in history) is either the higher rung's
(❌ HIGH, with the commit and the value redacted) or yours with
`git log -p --all -S`.

**A skipped rung goes into the report's `Checks:` line as skipped** — exactly the
treatment `host` gets before the first deploy: `(history: skipped — gitleaks not
installed)`. A check nobody ran must be visible in the header, or three months
later the report reads as if everything had been looked at.

The rule that keeps this check honest: **a secret is a finding when the concrete
value is in git and has not been rotated.** Not the file — the value. A local
`.env` full of live keys that was never committed is the setup working as
designed, and reporting it as CRITICAL teaches the user to ignore you — the
command rates that one ℹ️ LOW and carries a count rather than a value, for
exactly this reason.

**The same command carries a second working-tree rung, and its subject is not a
secret but a character.** `Invisible characters in the tree` reads every file
git tracks and reports bidirectional overrides (the Trojan Source trick — a
host or a condition rendered as its own opposite), Unicode tag characters
(U+E0000–U+E007F, which mirror ASCII invisibly and which several models decode
and follow) and runs of zero-width. It matters here rather than in general
because three doors write somebody else's text into files an agent then reads
as INSTRUCTION — `module add --from`, `node run.mjs update`, and the corpus
`knowledge-intake` distils into `content/knowledge/` for the model's system
block. A review is the control on all three, and this class of character is
what defeats a review. A finding in `CLAUDE.md`, `docs/`, `.claude/skills/` or
`content/` is rated one step worse than the same character in code, for that
reason. Needs template 0.32.0.

⚠️ **Its two blind spots are named on every run, in the rung's own evidence
line: code COMMENTS and `*.test.*` files** — this template ships three tests
that plant such characters because rejecting them is what they assert, and two
comments that carry one to illustrate the attack they describe. The tag block
is the exception and is scanned everywhere with no exclusion at all, because
nothing in a source tree has an innocent reason to hold one. What no scan of
the working tree can answer is what somebody SENDS the app at runtime; the
fence for that is `buildFencedRequest()` in `lib/ai/customer-text.ts`, and it
is a `code` question (§2), not this one.

How to run the rest of it is in **`references/checks-secrets-and-deps.md`** — the tools,
the skip list (sandbox keys, publishable keys, the shipped developer key a
scanner *will* raise and that is not a finding), the two verification commands
and the verdict table, the checks that apply regardless of tools, and the fix
order (rotate at the provider first, clean the history last). Read it before
reporting anything as a leaked secret, and before fixing one.

## 5 · `deps` — the packages

```bash
node run.mjs security-check
```

That is the command, not a bare `npm audit`. Six rungs of the ladder ask about
the packages: **two advisory databases** (npm, asked twice — what SHIPS and the
whole tree — and **OSV.dev** over the versions the lockfile resolved, reporting
only what npm did not), **`signatures`** and **`registry`** for what no advisory
database can answer yet, and **`posture`** and **`drift`**, which are about the
app rather than about its packages. It needs nothing installed (it answers off
the lockfile and says so) and `--json` gives you the same facts as data. What
each rung measures, what it deliberately does not, its ratings, the three
answers `npm ci --dry-run` can give, the two skips that are never findings —
and how to fix the ones that do ship (updates, `overrides`, framework versions,
and which eslint-chain findings are already judged and **not yours to fix**) —
are in **`references/checks-secrets-and-deps.md`**. Read it before writing any
of this up and before touching `package.json` over an audit finding.

Four rules hold whatever the ladder says:

- **What is accepted is a SET, never a count.** `scripts/security/accepted.mjs`,
  one written reason per id; an empty set is the normal state and a set that
  matches nothing is good news, so never report a count of accepted findings as
  if it were a measurement.
- 🚨 **`registry`'s three are facts, and you write them up as facts.**
  "Published 2 days ago" is a fact about a release, not an accusation about a
  package. Report what was measured and what the operator should look at (the
  changelog, the diff, who publishes it now); never `npm audit fix`, which fixes
  none of them, and never a word like "malicious" the measurement does not
  support. Each rung's line names both numbers — asked and deliberately not
  asked — and your report repeats that scope.
- **Dev-only vulnerabilities do not ship** and rarely deserve a launch delay —
  say so rather than counting them.
- 🚨 **Read the `⏭ not asked` blocks before you write anything down.** A rung
  that could not look prints its reason and what it would have covered, and that
  is never a pass — the closing line says "nothing found in the rungs that ran".
  It goes into the report's `Checks:` line as skipped with its reason, exactly as
  `host` does before the first deploy. An app whose report says `deps` passed
  when the registry never answered is worse than one with no report.

*(If this command is not in your app, this copy of the template predates it —
`node run.mjs update` carries text and never code. Run the two `npm audit`
commands by hand and judge the dev-only findings as described below.)*

## 6 · `api` — the endpoints that answer without a session

Needs the app running — `node run.mjs start`, then work against
`http://localhost:3000`. Seven route handlers exist; go through them.

What each route must do, and the questions that apply to all of them and to
every server action — another member's id in the request, a method nobody
thought about, what comes back that should not, missing rate limits, error
responses that say too much — are in
**`references/checks-api-host-verdicts.md`**. Work through that file with the
app running.

## 7 · `host` — configuration and the live environment

Before the first deploy most of this is not yet answerable — say so and move on
rather than inventing findings.

The checklist is in **`references/checks-api-host-verdicts.md`** — security
headers (and why there is deliberately no CSP), HTTPS, secrets in the host's
secret store, `APP_ENV`, the database, the cron secret and backups.

**The countable half of it is one command:
`node run.mjs security-check --url https://<the live domain>`.** Its `live` rung
asks the deployed app what a **stranger** gets — the four security headers as
they actually arrive after every proxy and CDN, the cookie flags on the real
origin, and every `/dashboard` route probed once with **no session**, where a
2xx is 🚨 CRITICAL. Run it before you write this section up and repeat what it
measured; it needs no account and no key, and it sends nothing at all — no
cookie, no bearer token, no `DIAGNOSTICS_SECRET`.

Three things to read correctly rather than argue with:

- **A missing CSP is reported in its evidence line and is NOT a finding.** That
  is the documented decision above, not an oversight in the rung — do not "fix"
  it into a finding, and do not write it up as one.
- **"the home page set no cookies, so no cookie flag was inspected" is not a
  pass.** It is the rung saying nobody looked, and it is the normal answer for a
  signed-out home page. Repeat the sentence; never turn it into a tick.
- **Before there is a deployed address it skips**, with that as its reason.
  Say so and move on — a skip here is never a failure, and the rest of this
  section is still yours to judge by hand.

⚠️ It does not replace §2 (`code`) or `app/route-protection.test.ts`: those ask
whether anybody DECIDED about a route, and this asks whether the decision is
being honoured by whatever is serving it. A green rung is not evidence that a
gate is right, only that the world is not being shown the page.

## 8 · `verdicts` — is the solution where the customer can read it?

Only where `ACTIVITIES` (`modules/activity/activities.ts`) has entries. The
failure this section exists for is invisible to every other check: a judged
element whose answers reach the browser renders, returns 200 and stays green
everywhere — and is worthless.

The three steps — reading every entry's `load()` and its client components,
searching the built bundle for a known answer string, and the gates as
registry fields — are in **`references/checks-api-host-verdicts.md`**.

The rule behind all three is `guardrails` → *A verdict is never reached in
the browser*; the deeper audit (keyboard included) is the skill
`learning-activities`, item `check`.

## 9 · `fix` — fixing what was found

Fix in severity order: every CRITICAL, then every HIGH. MEDIUM and LOW are the
user's call — name what each one costs and let them decide. 🚨 **A fix that has
not been measured is a claim**, so this is a pass with seven steps, per finding:

1. **Name the finding and its proof shape** — countable (it came out of
   `node run.mjs security-check`) or semantic (you read the code). A finding no
   test can reach is a third case and ends up *unproven*.
2. **Apply the change. One finding, one change** — a fix bundled into a
   refactor cannot be reviewed or reverted — plus **a test where a test is
   possible** (`lib/digistore/ipn.test.ts` is the model), written BEFORE the
   fix and watched to fail.
3. **The four checks**, each with three outcomes — passed, failed, *could not
   look*: `npm run typecheck`, `npm run test`, `node run.mjs smoke`,
   `node run.mjs errors`. 🚨 `smoke` proves itself by the clause **`, N of them
   signed in`** in its success line, never by the absence of a complaint: a run
   that could not sign in says `N protected page(s) NOT checked` and exits 0
   anyway. `errors` exits **2** for *could not look*, and needs the app running.
4. **Prove it — two halves, neither enough alone**: the same check again in the
   same scope with the finding gone, AND a needle that it could have found it.
   Countable: that rung's `state` in `security-check --json` is `clean` or
   `found`, 🚨 **never `skipped`**. Semantic: the test was RED before.
5. **Show the diff** beside the result of every check, in the fixed evidence
   shape — a line nothing can fill says what happened there, never a `✓`.
6. **Update the report.** `## Fixed in this run` is for proven fixes, `## Open`
   for everything else, with the reason. *Changed* and *fixed* are two words.
7. **Stop.** A failing or unlooked check means not done: name it, offer the fix
   or the revert, and never start the next finding while anything is red.

Three shortcuts are **refusals** and each of them works: weakening a shipped
test, writing the finding into `accepted.mjs` yourself, and `npm audit fix`.
Anything you cannot fix without a decision (a rotation at a provider, a host
setting, deleting data) goes back to the user as one clear question. Both proof
shapes, the four checks with their exit codes and their two traps, the evidence
block, the three refusals with the file that argues each, and a worked example
are in **`references/fix-pass.md`** — read it in full before the first fix.

🚨 **You do not deploy.** Not a push, not a host CLI: that is the operator's
next decision (`go-live`, or their host's own deploy), and so is the commit —
offer both, do neither.

## 10 · `since` — the recurring pass

Only for an app that already has a dated report. It asks the smaller question —
**what changed after it** — so that the second review costs minutes and
therefore happens at all.

```bash
node run.mjs security-scope        # --json for the same facts as data
```

That names the report it measures from, the base commit, the changed files
(**untracked ones included**), the areas pulled in whole, and the line this
check exists for: `NOT looked at: n of m files`. Where it answers `mode: full` —
no dated report, no git, no commit at or before that report's day — run **`all`**
instead and say so out loud.

| Check | In a `since` pass | Why |
|---|---|---|
| `secrets` (§4) | **FULL, always** | the only class that stays dangerous after you fix it — a key in an untouched file is still out |
| `deps` (§5) | **FULL, always** | an advisory appears without any file changing, and the ladder costs seconds |
| `code` (§2) | diff-scoped | this is where the 20–40 minutes live |
| `pay` (§3) | full **iff** the diff touches the money surfaces, else a **named skip** | small, but it reads four whole subsystems |
| `api` (§6) | the changed handlers, **plus** full when `proxy.ts`, `auth.config.ts` or `guardApi()` changed | one changed door does not move the others; one changed guard moves all of them |
| `verdicts` (§8) | full when `ACTIVITIES` or a `load()` changed, else its existing skip | unchanged from today |
| `host` (§7) | unchanged — skipped before a deploy; `live` still runs with `--url` | it asks about a server, not about a file |

A diff into money, authentication, entitlements or customer data widens the
scope to that whole area (`ALWAYS_IN_FULL` in `scripts/security/scope.mjs`, held
against §2/§3 above by a test), and the report says which file pulled it in.

🚨 **A scoped run that finds nothing looks exactly like a clean app.** The scope
goes in the report header **above** the tally, with a `## Not covered by this
run` section — and *clean*, *safe* and *no findings* never appear without the
scope in the same sentence. The mechanics, both refusal cases, the empty diff
and a worked report are in **`references/recurring-pass.md`**; read it in full
while running this check.

## The report

Every run writes one, whether it found anything or not. That is what makes "did
we already do the security pass?" answerable in three months.

It goes to **`docs/reports/security-YYYY-MM-DD.md`**, and its shape — the header
above the tally, the five sections in their order, the spoken summary at the end
— is [`docs/guidance.md`](../../../docs/guidance.md) → *One report shape*. Three
things are this skill's own:

- **`Checks:` names the seven checks above**, and for every one that did not run
  in full it says **scoped** or **skipped with its reason** — the treatment
  `host` already gets before the first deploy.

- **A `Scope:` block, and a `## Not covered by this run` section after the
  findings, belong to a `since` pass (§10) and to nothing else.** Where they do
  belong they are required, in numbers, above the tally:

  ```markdown
  Scope:  since docs/reports/security-2026-08-01.md (base a1b2c3d) — 14 files changed,
          2 areas reviewed in full. NOT looked at: 812 of 826 files.
          This is not a full pass.
  ```

  🚨 A scoped run that finds nothing looks exactly like a clean app, so *clean*,
  *safe* and *no findings* never appear without the scope in the same sentence.
  The worked report is in **`references/recurring-pass.md`**.

- 🚨 **`## Fixed in this run` is a claim about measurements, not about diffs.** A
  fix whose proof is missing or partial — a check that could not look, a rung
  that skipped — belongs under `## Open`, with what would prove it (§9, step 6).

The spoken summary carries two clauses the shared shape does not: **what was
proven and by what**, and — after a `since` pass — that it **was** a scoped pass,
what it covered, and when the last FULL pass was. Its straight yes or no is
whether the app can go live.

## Accepted risks

Some findings are deliberate. This skill's register is
**`docs/reports/security-accepted.md`** — create it the first time something is
accepted. Its table and the rules that go with it (not counted, its own section,
only the user accepts one, a CRITICAL never) are
[`docs/guidance.md`](../../../docs/guidance.md) → *Accepted is not the same as
fixed*.

## STOP — get a human

Do not paper over these yourself. Report them and wait:

- A suspicion that customer data has actually leaked.
- A payment or signature check that was bypassed on the live instance.
- Access to another customer's data that already happened, rather than could.
- A live secret in a public repository.

`guardrails` has the full list and what to do.

## Next step

After a green security gateway: **`performance-gateway`** — the same shape, the
same report, for speed instead of safety.

`go-live` runs both again against the live instance, and it is right to: a local
pass proves the code, not the deployment.
