---
name: operate
description: The recurring round for an app that is already live — asked in one sitting: what is known to be wrong with what it runs, the errors a 200 hides, whether the scheduled jobs still run, and what a stranger reaches. Use this when the user says "is my app still ok", "is everything running", "check my live app", "did anything break overnight", "a job seems dead", "the nightly cleanup has stopped", "nothing has been checked in months", "has anybody looked at this in a while", "what do I have to do now that it is live", or asks for a routine, weekly or monthly check. Being TOLD when it breaks, without asking, is `setup-monitoring` instead.
requires: 0.23.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The operating round — asked in one sitting, written down once

Building the app was a project and it ended. Running it is not: a live app keeps
owing a handful of questions, and nobody remembers all of them. This skill is
the round — it asks them in one sitting, reads the answers the way they are
meant to be read, and leaves a dated report behind.

**The duties themselves are [`docs/operations.md`](../../../docs/operations.md)**
— what each one is, which command answers it and which document owns the
subject. That file is the map and this skill is the walking; where the two
disagree, the map wins. Do not restate it here.

🚨 **The one thing this round can get wrong that nothing else catches: reporting
green because it skipped.** Every command below has a state that is neither
*found something* nor *found nothing* — a rung that could not look, an exit 2, an
environment with no address, a `docs/reports/` folder that was never created. On
a developer's machine that state is the **majority** state. Rendered as a tick it
is worse than no round at all, because it manufactures confidence. Two lists,
always: what was checked, and what was not.

## How to use this skill

Eight checks. You do not have to know which one you want.

| # | Check | What it looks at | Roughly |
|---|---|---|---|
| 1 | **`all`** | everything below, in the right order | 10–20 min |
| 2 | **`safety`** | what is known to be wrong with what this app runs | 3–5 min |
| 3 | **`errors`** | the errors a 200 hides, in the app people actually use | 2 min |
| 4 | **`jobs`** | the work nobody asks for — did it run, did it fail, is it switched on | 2 min |
| 5 | **`content`** | whether the environment holds what the app needs in order to answer | 3–5 min |
| 6 | **`reach`** | what a stranger gets: every page, and the two endpoints an uptime checker calls | 3–5 min |
| 7 | **`gates`** | when each dated report last ran, measured against the last change | 2 min |
| 8 | **`fix`** | fix the findings of the last round | depends |

**How to dispatch:**

- If the user already said what they want ("are my jobs still running?", "did
  anything break overnight?"), start that check. Do not show the menu first.
- Otherwise show the table, say that **`all`** is the default and the one to run
  after a deploy, and **wait** for an answer. A number, a name or a description
  all count.
- After a deploy, when something feels wrong, or when in doubt: **`all`**.
- **You run the commands** — through your Bash tool, not by telling the user to
  type them. That is the rule for the whole template.

This round is far shorter than `security-gateway` or `ux-gateway`, and that is
worth saying out loud: almost all of it is a command answering, not an agent
reading code. "20–40 minutes" is what stops people running a gateway weekly.

⚠️ **One phrase, two answers — and this skill is the one that gets started by
mistake.** *"How would I even know if my app is down?"* and *"is my app still
ok?"* sound alike and are not the same request: **being told**, without anybody
asking, at three in the morning, is the skill **`setup-monitoring`** — something
outside the app, because an app that is down cannot report being down. **Looking
now**, on purpose, in one sitting, is this round. If what the user actually wants
is to be told, say so in one sentence and **hand over to `setup-monitoring`**
rather than walking the round and leaving them exactly where they were. Somebody
who wants both gets both, in that order.

## 0. Read the environment first — do not ask what you can read

**Run this before any question and before any check**, including when the user
named one. It costs seconds and it decides which half of every check below can
run at all.

| The question | Where the answer is | What it means |
|---|---|---|
| Is this app live at all, and where? | `APP_URL`, `APP_URL_PROD`, `APP_URL_STAGING`, `APP_ENV` in `.env` | `APP_URL` is the LOCAL address by contract. A deployed address is `APP_URL_PROD` / `_STAGING`; neither set means the remote half of this round cannot run |
| Has anybody checked its safety, and when? | `.dev/security-check.json` — `checkedAt`, `complete`, `counts` | three states, below |
| Which gates have ever run here? | the newest `docs/reports/<kind>-YYYY-MM-DD.md` per kind | the folder is absent in a fresh app — that is check `gates`, and it is a finding |
| When did this app last change? | `git log -1 --format=%cd` | what every report's date is measured against |
| Which jobs exist and which are switched on? | `config/cron.json`, then `node run.mjs cron --list` | the file says switched on; the command says whether they actually ran |
| Is anything watching it? | `docs/app.md` → *Decisions worth remembering*; `package.json` for a provider package; `instrumentation.ts` | a recorded **"no"** is an answer — say so and do not re-open it |
| Which template version is this app on? | `package.json` → `version` | two checks below name a refinement that needs 0.24.0 |

Then **say what you found in one short paragraph, before the menu** — the shape
`coach` §1 and `setup-monitoring` §0 already use:

> *"This app is live at `https://app.example.com` (production), on template
> 0.24.0. Its safety was last measured four days ago with three rungs not asked;
> `docs/reports/` holds a `security-` report from 12 July and nothing else, and
> the last change here was yesterday."*

### What you may ask, and the criterion behind it

**Nothing readable is asked.** That is the rule, not the list — a later check
inherits it. Asking a question the disk already answers is how a skill teaches
its user that the questions do not matter, and then the one question that does
matter gets an absent-minded answer too.

So ask only what genuinely leaves no trace:

- Has anybody actually **read** the mailbox `notifyOperators()` writes to? The
  app can prove it sent; it cannot prove anybody opened it.
- Did a customer complain about something you have **not reproduced**? That is
  the one finding no command here can reach.
- Is there a deployed address that is **not in this `.env`** — a second
  environment, a staging host somebody set up by hand?

And ask **none** of these, ever: which host this is on, whether the app is live,
when the last report was written, which jobs exist, whether monitoring was
chosen. All five are in the table above.

### The security record has three states, not two

`.dev/security-check.json` is written by `node run.mjs security-check` and by the
daily `check-advisories` job. Read it, do not re-measure it:

| | |
|---|---|
| **absent** | nobody has run a check in this working copy. `.dev/` is gitignored and is deliberately not copied into a new worktree, so this is honest rather than broken |
| **present but past its bound** | the reader in `scripts/security/verdict.mjs` refuses a record older than its own bound and answers `null`. Treat that as *nobody has looked here recently* — never as an error. The number is the code's, not this file's |
| **present and current** | use `counts` and `complete` as they are. `complete: false` is the ordinary state — see *What is NOT a finding* |

## 1 · `all` — the whole round

Run 2 → 7 in that order, then write the report, then offer the fix. The order is
not arbitrary: `safety` needs no address and no running app, so it always
produces something; `reach` and `content` are the two that most often cannot run
at all, and finding that out early keeps the round honest about its own size.

Then: one report, one spoken summary with **two** lists, one offer to fix.

## 2 · `safety` — what is known to be wrong with what this app runs

```bash
node run.mjs security-check                              # this folder
node run.mjs security-check --url https://your-app       # and the live domain
node run.mjs security-check --json                       # for the report's rows
```

The second invocation is the one that asks what a **stranger** receives from the
real domain — headers, cookie flags, every `/dashboard` route probed with no
session. Run it whenever §0 found a deployed address. `--json` gives you the same
facts as data when you are turning the answer into report rows.

**How it is read.** One tally line, findings CRITICAL-first, one exit code. The
exit code is about findings only: non-zero at ❌ HIGH or 🚨 CRITICAL, and a rung
that skipped **never** turns it red.

**How it is misread.** The `⏭ NOT ASKED` blocks are the interesting part of a
green run, and the tally line ends with `⏭ not asked 4` exactly when there is
something in it. Each block carries its own `Reason:` and `Blind to:` line —
copy both into the *not checked* list rather than summarising them. The command
says it itself:

```
⚠️  2 finding(s), none at HIGH or above — 4 rung(s) were not asked.
```

Two more things this check is not. It is **never a gate** — it asks the network,
and its answer moves without this app changing. And the accepted block is not
news: an accepted advisory carries a written reason in
`scripts/security/accepted.mjs` and is not a finding to re-raise.

State **no rung count anywhere.** The number has moved three times in a
fortnight; the command prints the current one.

## 3 · `errors` — the errors a 200 hides

```bash
node run.mjs errors --url https://your-app --env prod    # a DEPLOYED app
node run.mjs errors                                      # the local one
```

A page that answers 200 and renders a raw timestamp, drops a translation or
mismatches its hydration is a broken page with a green status code.

🚨 **The exit codes are the whole point of this command**, and getting them wrong
is the single failure this round exists to prevent:

| | |
|---|---|
| **0** | it looked, and found nothing |
| **1** | it looked, and found something — a finding |
| **2** | *I could not look* — a 404, a timeout, a 429, an answer that is not JSON. **Into the *not checked* list, never a `✓`** |

Exit 2 prints `✗ Could not look — …` on stderr and no tick at all. A refusal
names the `.env` key that would satisfy it, and that key is what you report:
`APP_URL_PROD` + `DIAGNOSTICS_SECRET_PROD`, or `APP_URL_STAGING` +
`DIAGNOSTICS_SECRET_STAGING`. Quote the key as printed — the names are
deliberate rather than derived, and inventing `DIAGNOSTICS_SECRET_PRODUCTION`
sets a variable nothing ever reads.

`--env` accepts `dev` and `prod` as spellings for `development` and
`production`, plus the three full names. Anything else is **refused rather than
guessed**, with the three valid names in the message. Never work around a
refusal; it is the scoping that stops a production credential travelling to a
mistyped domain.

⚠️ The window it reads lives in **one instance's memory** and empties on every
restart, which is why the success line always names the window. An empty answer
means *nothing in the last N lines since <time>*, never *your app is fine*.

## 4 · `jobs` — the work nobody asks for

```bash
node run.mjs cron --list --url https://your-app          # a DEPLOYED app
node run.mjs cron --list                                 # the local one
```

`config/cron.json` says which jobs are switched on; this says whether they
actually ran. An **enabled** job whose last run is `never` and any non-zero
failure count are already marked as findings by the command and counted in its
closing line.

**How it is misread.** `No jobs are registered.` is a legitimate answer — an app
may have no scheduled work — and so is a job that is `OFF` and has never run: it
has correctly never run. Those two are not the same row as an enabled job that
never ran. And `--list` **exits 0 whatever it finds**, deliberately: on a freshly
deployed app every enabled job says `never`.

Locally the command needs the app running and says so by name; that is a *not
checked*, with `node run.mjs start` as its reason. What a job may assume and the
traps that come with scheduling anything stay in
[`docs/cron.md`](../../../docs/cron.md).

## 5 · `content` — does the environment hold what the app needs

```bash
node run.mjs content-check --env prod    # per environment
node run.mjs kb-check                    # where the assistant is switched on
node run.mjs media-check                 # where the app stores files
node run.mjs ai-check                    # where the app calls a model
```

🚨 **`content-check` asks an ENVIRONMENT over HTTP whether it holds this app's
rows — one answer per owner. It is not a local file check**, and treating it as
one is how an operator ends up believing it proved something about their
handbook. The other three are local and only belong in the round where the app
actually has those features.

**How it is misread.** A module that cannot answer is a **failure**, never a
pass — a green tick for a question nobody asked is the worst answer available.
Green is still not *"it renders"*; that is your eyes. `kb-check` treats an
unreachable store as a problem rather than a skip. And an environment that is
not configured exits 2 with the key it wants (`SETUP_KEY`, `SETUP_KEY_PROD`) —
*not checked*, with that key named.

## 6 · `reach` — what a stranger gets

```bash
node run.mjs health --url https://your-app    # six probes, one verdict — needs template 0.24.0
node run.mjs smoke  --url https://your-app    # every page, called once
```

`health --url` is the one that asks together: is it answering at all
(`/api/healthz`), does its database answer (`/api/readyz`), is anything scheduled
failing or stalled, what are its pages hiding behind a 200, does the media store
answer, and when did the last payment notification arrive. On an app below
template 0.24.0 that command does not exist — compose the same answer from
`smoke --url` and `errors --url` and say in the report that you did.

**`/api/healthz` and `/api/readyz` are what an uptime checker is pointed at** —
that is the skill `setup-monitoring`, and it is something OUTSIDE the app, since
an app that is down cannot report being down. Neither you nor the operator calls
them by hand; `health --url` is what asks them from here.

**How it is misread.** `smoke`'s line *"9 protected page(s) NOT checked"* is
**not** a pass — those are the pages carrying the real queries; provision the
sign-in once with `node run.mjs smoke-account --apply` and run it again.
`health`'s exit **2** means *there was no address to ask*: it prints
`✗ Could not look — …` and never a `✓`. An unreachable app is an **answer** —
one CRITICAL from `liveness` and the other five reporting `⏭ NOT ASKED` with
that as their reason, which is one fact reported once rather than five timeouts.
And *"there is nothing to check"* is a `✓` **with its evidence line**, never a
bare tick: an app that has sold nothing has no payment notification to miss.

## 7 · `gates` — when each dated report last ran

No command of its own. Two readings, together:

```bash
ls docs/reports/
git log -1 --format=%cd
node run.mjs security-scope    # what a recurring pass would NOT look at — needs template 0.24.0
```

Take the newest file per kind — `security-`, `ux-`, `performance-`,
`compliance-`, `onboarding-` — and compare its date against the last change. **A
report older than the last big change is worth about as much as no report.** An
open CRITICAL or HIGH in one of them is the next step whatever else this round
says.

🚨 **`docs/reports/` missing entirely is a finding at ⚠️ MEDIUM**, not a blank.
A fresh app has no such folder — each writer creates it the first time it has
something to write — so an empty tree means no gateway has ever run here, and an
app nobody has ever inspected is not an app that passed.

`security-scope` is the sharp half: it prints the base commit, the changed files
and the line the command exists for — `NOT looked at: 812 of 826 files. This is
not a full pass.` Where there is no dated report it answers `mode: full` with
that as its reason. It judges nothing and exits 0 whatever it finds.

## 8 · `fix` — route, do not re-implement

A finding belongs to the skill that owns it, and that skill already has a fix
pass with its own report:

| The finding | Who fixes it |
|---|---|
| a security finding, an accepted risk, a recurring pass | **`security-gateway`** — check `fix`, or check `since` for the scoped re-run |
| an interface finding, an empty state, wording | **`ux-gateway`** — check `fix` |
| slow pages, a query, load | **`performance-gateway`** |
| a legal page, consent, a data-subject right | **`compliance-check`** |
| a job that is wrong rather than merely failing | ordinary work, with [`docs/cron.md`](../../../docs/cron.md) beside you |
| an environment that is empty | the publish step — [`docs/content.md`](../../../docs/content.md) |

Two fix passes for one finding is how two reports start disagreeing. Name the
skill, **offer to start it now**, and start it if the user says yes.

🚨 **`fix` never means "the agent deploys".** The deploy stays a human act.

## What counts as a finding

The severity ladder and the four-line format are the shipped ones and are **not**
restated here in other words — two copies drift. Read them in
[`docs/guidance.md`](../../../docs/guidance.md) → *One report shape*:
🚨 CRITICAL, ❌ HIGH, ⚠️ MEDIUM, ℹ️ LOW, and every finding written as `Where:` /
`Why:` / `Fix:` / `Evidence:` in that order.

**This round rates nothing of its own** — which is why it is the one skill here
with no severity table. Where a command already rated something, keep its rating:
the commands in this round rate on that same ladder on purpose, so a severity
invented beside one of them would be a second opinion about a measurement.

After the findings, offer to start the fix — naming the skill that owns it and
asking whether to start it now. Describing what could be done leaves the user
exactly where they were.

## 🚨 What is NOT a finding

This table is the core of the round. Each of these states is neither *found
something* nor *found nothing*, and each has exactly one right place to go.

| The state | What it means | What the round does |
|---|---|---|
| `⏭ NOT ASKED` blocks, and `⏭ not asked N` in the tally | a rung could not look | into the *not checked* list, with the rung's own `Reason:` and its `Blind to:` line |
| `complete: false` in `.dev/security-check.json` | at least one rung skipped | **the ordinary state on a developer's machine.** Not a finding, and not an alarm |
| `node run.mjs errors` exiting **2** | *I could not look* — a 404, a timeout, a 429, an answer that is not JSON | *not checked*, never a `✓`. Exit 1 is *I found something*; only exit 0 is an answer |
| `docs/reports/` missing entirely | no gate has ever run in this app | a **finding** at ⚠️ MEDIUM — an app nobody has ever inspected is not an app that passed |
| a deployed address that is not configured | the remote half cannot run | *not checked*, with the `.env` key that would fix it named |
| `No jobs are registered.` from `cron --list` | a legitimate state | not a finding — an app may have no scheduled work |

**Why `complete: false` is ordinary, written out rather than asserted.** It is
set whenever *any* rung skipped, and on a laptop several skip as a matter of
course: the rung that compares this app against the published template wants the
network, the rung that asks what a stranger receives wants a deployed address,
the signature rung wants an npm new enough for the registry's current signing
keys, and the highest rungs want a tool the machine does not have — *"the
interesting path is the one where it is missing"*
(`scripts/security/tier2.mjs`). On a machine that HAS the network, the address
and the tools, the same `false` is worth asking about.

🚨 **So copy each `⏭` block's `Reason:` line into *not checked* rather than
counting the skips.** Every one of them names the act that clears it, and that is
the only place three states that look identical are told apart: `ECONNREFUSED …`
is the network and clears itself, `EEXPIREDSIGNATUREKEY: this npm (…) is older
than the registry's key rotation` is **this machine's npm** and never clears
itself until somebody updates it, and *found no dependencies to audit* means
nothing is installed. A skip you report as "could not look" without its reason
is a skip the operator cannot act on. [`docs/operations.md`](../../../docs/operations.md)
carries the table.

**It is a family, not a rule of one command**, and the argument for the second
column — why *could not be checked* is neither a pass nor a finding, and which
other commands in this app say the same sentence in their own words — is
[`docs/guidance.md`](../../../docs/guidance.md) → *Two columns, and why the second
one has to exist*. This round is the sharpest case of it, not the only one.

## The report

**`docs/reports/operations-YYYY-MM-DD.md`**, and its shape — the path convention,
the header above the tally, the finding format, the spoken summary — is
[`docs/guidance.md`](../../../docs/guidance.md) → *One report shape*. Create
`docs/reports/` if it is not there, and if you had to create it, that is the
⚠️ MEDIUM from check `gates`, in this same report.

What this round's report does differently, because it reports a state rather than
a pass:

```markdown
# Operating round — 2026-08-11

App:      https://app.example.com (production) · template 0.24.0 · commit a1b2c3d
Checked:  safety, errors, jobs, gates
Not checked: 2 — content (no SETUP_KEY_PROD in the .env),
                reach (no deployed address: APP_URL_PROD is not set)
Tally:    🚨 CRITICAL 0   ❌ HIGH 0   ⚠️ MEDIUM 1   ℹ️ LOW 2   ⏭ not asked 4

## Findings
## Not checked
(one line per item: what it was, and the reason in the command's own words)

## Open from earlier rounds
(what the last report left open and is still open)
```

**`Checked:` and `Not checked:` are two header lines, the second carrying its
count**, above the tally and never folded into it, with `## Not checked` as the
section that goes with them. The tally ends in `⏭ not asked N` rather than
`✅ accepted N`: this round accepts nothing and keeps no register, because a
finding here belongs to the skill that owns it (§8) and so does the decision to
accept it. And it fixes nothing itself — hence `## Open from earlier rounds` in
place of `## Open`, and no `## Fixed in this run` and no `## Worth a look` at all.

The closing sentence is never "✓ clean" when anything was not checked; it takes
the shape the commands themselves already print:

> *"Nothing found in what ran — 2 checks were not asked. That is not a clean
> bill."*

**This report's date and stem are the only state this round creates** — which the
shared shape says of every report, and which is load-bearing here: the greeting
fact that says when this round last ran reads this file's **name** and needs
nothing else.

## The rules

1. **You run the commands**, through your Bash tool, and you report what came
   back. Never "run this and tell me what it says".
2. **Two columns, always.** Checked and not-checked are separate lists in the
   report and in the spoken summary. A tick for a check that did not run is the
   one failure this skill exists to prevent.
3. **Never a gate.** This round is in no Makefile, in no `npm test`, in no hook
   and in no deploy, and it must not become one. It asks the network and a
   deployed app, so its answer moves without this app changing — and a check
   like that wired into a release is a brake, and a brake is what somebody
   eventually removes, taking the intent with it.
4. **It runs when somebody asks.** Nothing here schedules itself, adds a line to
   the session greeting or sends a mail. Each of those channels already has
   exactly one producer, and neither of them is this skill.
5. **Point at the reference, do not restate it.** The duties are
   [`docs/operations.md`](../../../docs/operations.md); the mechanisms are the
   documents it names. This skill is the round, not a second copy of either.
