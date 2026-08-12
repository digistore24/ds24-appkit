<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Operating this app — what recurs, and what answers it

Building the app is a project and it ends. Running it is not: an app that is
live keeps owing a handful of things — that what it runs has no known hole in
it, that its pages are not hiding an error behind a 200, that its scheduled work
still runs, that somebody has looked at it since the last big change. Every one
of those already has a command or a skill here. What has been missing is the
list.

**This file is that list, and it is a map rather than a manual.** Each section
says three things and stops: what the duty is, what answers it, and which
document owns the subject. Where a mechanism is explained, the link goes to the
file that owns it — that file is the one kept current, and a second copy here
would be the one that quietly goes stale.

Nothing in here is a gate. Nothing runs on its own because you read it.

**Walking the list is a skill: [`operate`](../.claude/skills/operate/SKILL.md).**
It reads this app's own files to work out where it stands, runs the checks below
in one sitting, keeps *checked* and *could not be checked* in two separate
columns, and writes `docs/reports/operations-YYYY-MM-DD.md` every time — even
when it found nothing. This page is the map; that skill is the walking. It adds
no gate either.

## The short version

| The duty | What answers it | How often |
|---|---|---|
| Where am I, and what comes next | `node run.mjs journey` · skill `coach` | whenever the thread was lost |
| Is the live app healthy | `node run.mjs health --url https://…` | after every deploy, and whenever something feels wrong |
| What is known to be wrong with what it runs | `node run.mjs security-check` · skill `security-gateway` | a job asks daily; you read the greeting's line |
| The errors a 200 hides | `node run.mjs smoke --url …` · `node run.mjs errors --url …` | after every deploy |
| The scheduled jobs | `node run.mjs cron --list --url …` | when `health` names `jobs`, and after adding one |
| Content in an environment | `node run.mjs content-check --env prod` | after every publish |
| When each gate last ran | the newest file in `docs/reports/` · `node run.mjs security-scope` | before a release, and before deciding a check is unnecessary |
| Data that ages out | the pruning jobs · `node run.mjs db-prune-ipn` / `db-prune-ai` | the jobs do it; you check once that they are |
| Backups | **this app makes none** — the managed Postgres you booked does | when you book it, and before a risky migration |
| Being told instead of asking | skill `setup-monitoring` · the `ops-watchdog` job · the greeting | once, at go-live |
| Keeping this guidance current | `node run.mjs update` | when the greeting says something is new |
| A message nobody recognises | [`docs/troubleshooting.md`](troubleshooting.md) | when it happens |

## Where am I, and what comes next

```bash
node run.mjs journey          # the whole picture, one screen
node run.mjs journey --next   # the two sentences alone
node run.mjs journey --json   # the same facts, for an agent
```

Needs template 0.26.0. The four phases, every step in them, what state each one is
in and **why** — read off this app's own files on every call. It measures nothing, asks no network and
**writes nothing at all**: there is no cache, no stamp, no "last seen" file. What
proves a step done is a file that is already there, so a derived answer can never
be stale, and a cache of a cache would be a second truth with its own TTL.

Four things it does that a list of steps cannot, and each is the whole reason the
command exists rather than a paragraph somewhere:

- **It names ONE next step, with the reason it is next and an offer to start it.**
  Somebody who asks what to do next is already unsure, and fourteen options is not
  an answer. The reason is the evidence it read — *"app/page.tsx is still the
  template"* — never a sentence written in advance.
- **A recorded "no" stays visible** (`you said no, 2026-08-09`) and is never
  proposed again. A refusal nobody can see is a refusal nobody can revoke.
- **A step whose code is not in this copy says so** and names
  `node run.mjs update`, rather than sending you at a feature that is not there.
  Same for a step that needs a module: it names the `module add` that would
  install it — and a module list it could not READ says *could not look*, never
  *not installed*.
- **The ten optional extras are a count and a question**, not ten rows. A shelf
  offered in order is a checklist, and a checklist is how somebody ends up
  building a mobile app for a product nobody has bought yet. Ask *"what else can
  it do?"* and the agent will say.

The path itself lives in exactly one machine-readable place
(`scripts/dev/journey.mjs`); this command, the session greeting's `[Journey: …]`
line and the skill [`coach`](../.claude/skills/coach/SKILL.md) all read it, so
none of the three can drift from the others. `coach` is the conversation —
it routes a symptom to the skill that fixes it; this is the picture.

## Is the live app healthy

```bash
node run.mjs health --url https://your-app.example
```

One command, one verdict, one exit code. It asks the deployed app whether it is
answering at all, whether its database answers, whether anything scheduled is
failing or stalled, what its pages are hiding behind a 200, whether its media
store answers, and when the last payment notification arrived. Each of those has
a finer command further down this page; this is the one that asks them together,
and it is the right first move when the question is *"is something wrong?"*
rather than *"is this particular thing wrong?"*. Needs template 0.24.0.

**How the answer is misread.** Exit **2** means *there was no address to ask* —
it prints `✗ Could not look — …` on stderr and never a `✓`. An unreachable app
is an **answer, not a silence**: `liveness` reports it and the rest say
`⏭ NOT ASKED` with that as their reason rather than timing out again about the
same fact. And *"there is nothing to check"* is a `✓` **with its evidence
line**, never a bare tick — an app that has sold nothing has no payment
notification to miss, and the line says which, because a bare tick beside `ipn`
reads as *payments are arriving*.

What to do about a finding is [`docs/DEPLOY.md`](DEPLOY.md) → *Proving it
works*, which is what the command's own closing line points at.

## What is known to be wrong with what it runs

```bash
node run.mjs security-check                            # this folder
node run.mjs security-check --url https://your-app.example   # and the live domain
```

A ladder of independent checks — the advisory databases, package signatures, the
public registry, this app's own defences, the files git is about to publish, and
what a stranger receives from the real domain — with one verdict and one exit
code. Needs template 0.21.0; the rung that asks the live domain needs 0.23.0.
Every rung is described in `CLAUDE.md` → *Local commands*, and the judgement
half — severities, what to fix, what to accept in writing — is the skill
[`security-gateway`](../.claude/skills/security-gateway/SKILL.md), which writes
the dated report.

🚨 **A rung that did not run is not a pass, and the `⏭` blocks are the
interesting part of a green run.** The command says so itself rather than
leaving it to be inferred:

```
✓ Nothing found in the rungs that ran — 3 rung(s) were not asked.
  That is not a clean bill: read the ⏭ block(s) above for what nobody looked at.
```

Each of those blocks carries a `Reason:` and a `Blind to:` line, and the tally
line above them ends with `⏭ not asked 3` — a field that appears only when there
is something in it.

**`complete: false` in `.dev/security-check.json` is the ORDINARY state on a
developer's machine, and reading it as an alarm is one day of noise followed by
a field nobody looks at again.** It is false whenever any rung skipped, and on a
laptop several skip as a matter of course: the rung that compares this app
against the published template wants the network, the rung that asks what a
stranger receives wants a deployed address, the signature rung wants an npm new
enough for the registry's current signing keys, and the highest rungs want a tool
— `gitleaks`, a container scanner — that the machine simply does not have and
that nothing here will ever download for you. On a machine that HAS the network,
the address and the tools, the same `false` is worth asking about.

🚨 **Which is why the `Reason:` line is the one to read, not the count of skips.**
Every skip in this ladder names the act that clears it — `brew install gitleaks`,
`docker pull aquasec/trivy`, "no `--url` was given" — and the three that look
alike from the outside are told apart there and nowhere else:

| the reason says | what it is | what clears it |
|---|---|---|
| `ECONNREFUSED: the registry did not answer …` | the network between here and the registry | being back on it |
| `EEXPIREDSIGNATUREKEY: this npm (…) is older than the registry's key rotation …` | **this machine's npm**, not the app and not the registry | `npm install -g npm@latest` — waiting never does |
| `… found no dependencies to audit …` | nothing is installed here | `npm install` |

The middle one is worth knowing before you meet it, because npm's own sentence
about it names a package that has nothing wrong with it. npmjs.org retired one
signing key and published a new one; tarballs published before that still carry a
signature made with the retired key, and npm 9 rejects those where npm 10 and
newer accept a signature made while its key was valid. Measured on one install,
one afternoon: npm 9.9.4 refuses, npm 10.9.9 answers.

`npm -v` says which one is here, and it is worth asking rather than assuming:
Node bundles an npm, but an npm installed beside it wins, and it can be older
than the Node around it — the case this was measured on was Node 22 carrying an
npm 9.2.0.

This page deliberately does not say how many rungs there are. The number has
moved repeatedly; `node run.mjs security-check` prints the current one, and a
count written here would be a fact with an expiry date.

## The errors a 200 hides

```bash
node run.mjs smoke  --url https://your-app.example    # every page, called once
node run.mjs errors --url https://your-app.example    # what its log picked up
```

A page that answers 200 and renders the wrong date, drops a translation or
mismatches its hydration is a broken page with a green status code, and nothing
about the status code will tell you. `errors --url` asks the deployed app for a
bounded, redacted window of its own stderr over `DIAGNOSTICS_SECRET`; needs
template 0.22.0.

The routine, and how each answer is rated, is `CLAUDE.md` → *Never ship a broken
page*. Getting the app onto a host so that there is something to ask at all is
[`docs/DEPLOY.md`](DEPLOY.md).

**How these are misread.** `smoke`'s line *"9 protected page(s) NOT checked"* is
**not** a pass — those are the pages carrying the real queries; provision the
sign-in once with `node run.mjs smoke-account --apply` and run it again.
`errors --url` exits **1** for *found something* and **2** for *could not look*,
and the refusal never prints a `✓`. Its window lives in one instance's memory
and empties on every restart, which is why the success line always names the
window it read.

## The scheduled jobs

```bash
node run.mjs cron --list --url https://your-app.example
```

Work with no request behind it: deleting what has aged out, closing what nobody
closed, asking the advisory databases, mailing you when something has quietly
stopped. `--list` says which jobs this app has, when each last finished and
which are failing; an enabled job that has never run and a non-zero failure
count are marked as findings and counted in one closing line. Needs template
0.22.0 for `--url`.

⚠️ **`--list` exits 0 whatever it finds, deliberately** — on a freshly deployed
app every enabled job reports *never run*, and an exit code there would fail a
release for a fact about its age.

How a job is declared, what it may assume, and the traps that come with
scheduling anything are [`docs/cron.md`](cron.md). Which jobs a fresh app ships
with, and which of them mail you, is `CLAUDE.md` → *Scheduled jobs*.

## Content in an environment

```bash
node run.mjs content-check --env prod
node run.mjs content-publish --env prod --apply    # needs template 0.24.0
node run.mjs kb-check
```

Nothing this app ships travels between environments by itself. `content-check`
asks whether an environment actually holds this app's content — every owner
answering for its own rows — and `content-publish` is how it gets there without
a production password. `kb-check` is the same question for the assistant's
handbook: format, size, media references, cost per answer.

The owning documents are [`docs/content.md`](content.md) (what travels and what
does not), [`docs/environments.md`](environments.md) (what DEV, STAGING and PROD
each hold) and [`docs/knowledge.md`](knowledge.md) (the corpus the handbook is
written from). An app with the `courses` module also has
`node run.mjs courses-diff --env prod`, a read-only preview of what publishing
would change — [`docs/courses.md`](courses.md).

**How these are misread.** A module that cannot answer `content-check` is a
**failure**, never a pass — a green tick for a question nobody asked is the
worst answer available. And green still is not *"it renders"*; that is your
eyes. `kb-check` treats an unreachable store as a problem, never a skip.

## When each gate last ran

Anything in this app that produces a verdict writes it down, dated, into
`docs/reports/` — `security-`, `ux-`, `performance-`, `compliance-`,
`onboarding-`, `operations-` (the round above, whether or not it found
anything), alongside the undated `<kind>-accepted.md` registers where an
accepted risk is recorded with its reason, and the append-only
`module-removals.md`. So *"has anybody looked at this app since the last big
change?"* is answered by a directory listing.

🚨 **A fresh app has no `docs/reports/` folder at all, and its absence is a
finding rather than a green.** Each writer creates it the first time it has
something to write; an empty tree means no gateway has ever run here.

A report older than the last big change is worth about as much as no report —
compare its date against `git log -1 --format=%cd`, and an open CRITICAL or HIGH
in it is the next step whatever else looks more urgent. That rule, and the
routing from a symptom to the skill that owns it, live in the skill
[`coach`](../.claude/skills/coach/SKILL.md).

```bash
node run.mjs security-scope
```

That command says what a **recurring** security pass would look at since the
newest dated report, and — the line it exists for — what it would **not**:
`NOT looked at: <n> of <total> files. This is not a full pass.` Because a scoped
run that finds nothing prints the same report as a full run that finds nothing.
Where there is no dated report, no git, or no commit at or before that day, it answers
`mode: full` with that as its reason, because a diff against nothing is not a
review. It judges nothing and exits 0 whatever it finds. Needs template 0.24.0.

## Data that ages out

Most of this happens without you. The shipped jobs delete AI-usage rows, IPN-log
rows, spent impersonation records, setup-surface records and abandoned uploads
on their own schedules; `node run.mjs cron --list` is what says whether they
really are. The same sweeps are available by hand, without the app running:

```bash
node run.mjs db-prune-ipn --days 30
node run.mjs db-prune-ai  --days 90
node run.mjs data-export --email "kunde@example.de"    # one person, as JSON
```

What this app stores about people, for how long and on what grounds is
[`docs/data-protection.md`](data-protection.md); which EU rules reach the app at
all is [`docs/compliance.md`](compliance.md), and the skill
[`compliance-check`](../.claude/skills/compliance-check/SKILL.md) is what turns
that into a dated report.

⚠️ **One retention question is open by design and belongs to the operator, not
to a job:** nothing in this app ever deletes an order. That is correct while the
statutory retention period runs and wrong once it has. The reasoning is
[`docs/data-protection.md`](data-protection.md) → *Retention*.

## Backups, and what the host is responsible for

🚨 **This app makes no backups of its own.** There is no command for it and
there should not be: the app has no privileged access to the database it runs
on, and a dump it wrote for itself would be a worse answer than the provider's
own snapshots — kept somewhere else, restorable to a point in time, and somebody
else's job to test.

Backups are a property of the managed Postgres that was booked. Which hosts
include them, what each costs, and what the cheap "unmanaged" option quietly
makes yours instead are [`docs/DEPLOY.md`](DEPLOY.md). Before a migration that
drops a column or a table, check that a backup exists —
[`docs/database.md`](database.md).

## Being told, rather than having to ask

Every command on this page answers **when asked**. Two things in this app ask
without you:

- the job **`ops-watchdog`** mails the operator once when something has quietly
  stopped working — the security record, failing or stalled jobs, the media
  store, a payment webhook gone silent. One mail naming all of them, counts
  only, nobody named. It runs because `config/cron.json` says so, and
  `"enabled": false` there is what stops it. Needs template 0.24.0.
- the **session greeting** reads the last security record and prints one
  `[Operations: …]` line — only when something is open at HIGH or above, or the
  record is missing, damaged, stale or measured nothing at all. 🚨 Its absence
  is a state, not an omission. Every sentence it can say is the table below.
  Needs template 0.24.0.

### `[Operations: …]` — every sentence it can say

The line is composed from what the measuring things already wrote down —
`.dev/security-check.json` from `node run.mjs security-check`, and the NAME of the
newest `docs/reports/operations-*.md` the skill `operate` left behind — and it
**measures nothing itself**: no rung, no network, no file opened, one small JSON
read and one directory listing. **One line, one producer**, however many things it
has to say: worst first, at most two named in full, the rest as `+N more`, ending
in the command for the worst of them.

🚨 **Its ABSENCE is a state, not an omission**, and reading it as "nobody has
looked" is the one way to get this line wrong: silence means *at least one check
ran and nothing is open at HIGH or CRITICAL*. Every other case has a sentence of
its own —

| The line says | What it means |
|---|---|
| *never checked on this machine* | no record at all, and this app has pages or a brief. On the untouched template this is deliberately silent: nobody has checked the app nobody has built |
| *the last check's record cannot be read* | there IS a record and it is damaged. Not the same claim as "never" — somebody may well have looked |
| *last checked `<date>` … past the 7-day bound* | too old to speak for this app. Advisory databases move daily |
| *could not look at anything: `n` of `n` rungs not asked* | it ran and every rung skipped — typically a machine with no network. 🚨 This is the case where "nothing found" would be a lie |
| *`n` CRITICAL, `n` HIGH open (checked `<date>`; `n` of `n` rungs not asked)* | something serious is open. The threshold is the command's own (`failsVerdict()`), so the line and the exit code can never disagree |
| *the operating round last ran on `<date>` … past the 30-day bound* | the skill `operate` has not walked this app in a month. Read off the NAME of the newest `docs/reports/operations-*.md`; no file is ever opened |
| *the operating round has never run here* | no such report at all, on an app that has pages or a brief. On the untouched template this is silent too — a fresh clone has never been live |
| *(no line at all)* | at least one rung ran, nothing open at HIGH or above, and the round is not overdue |

Three things follow from that, and each is deliberate. A MEDIUM or a LOW **in the
security record** buys no line — meeting one at the start of every session for a
week is how people learn to skip the whole block. `complete: false` buys no line
**either**: `live` skips on every laptop for ever, `drift` skips with no network,
and the two tier-2 rungs skip wherever their tool is not installed, so an
incomplete ladder is the ORDINARY state of a developer's machine (see
*`complete: false` is the ordinary state* above). And whenever the line does
appear it names how many rungs were **not asked** — because "nothing found" and
"nobody asked" must never look the same.

⚠️ **The overdue round is itself an ℹ️ LOW, and that is not a contradiction.** It
is a fact about the app, not a finding in a report, and its severity is doing one
job: it ranks the round below every open security finding, so a session that has
both meets the CRITICAL first and the housekeeping second — by the same sort that
orders everything else on this line, never by a special case.

It carries no finding: no package, no path, no host, no title — the record does not
hold them, deliberately, and the round's report is never opened. The commands it
names are `node run.mjs security-check`, which is what prints the findings, and the
skill `operate`, which is what walks the round.

🚨 **Neither of those is monitoring, and the difference is the one that matters
at three in the morning: an app that is down cannot mail you about being down.**
What buys that is something OUTSIDE the app — an uptime checker pointed at
`/api/healthz` (the process answers) and `/api/readyz` (the database answers
too), and an error tracker that reports the page a customer just met, while they
are still on it. Those endpoints ship and answer; nothing in a fresh app calls
them. Choosing a provider, getting its key in the right place, wiring it and
proving one event really arrives is the skill
[`setup-monitoring`](../.claude/skills/setup-monitoring/SKILL.md).

## Keeping this guidance current

```bash
node run.mjs update           # what would change — writes nothing
node run.mjs update --apply   # write it
```

The code in this app belongs to its operator and nobody changes it behind their
back. `CLAUDE.md`, the rest of `docs/` and `.claude/skills/` are a different
matter: they are how an agent knows what this app can already do, and a
six-month-old copy of them is how a feature that shipped long ago gets rebuilt
by hand, worse, next to the one that was already there. What the update touches,
what it refuses, and what it never deletes are
[`docs/updates.md`](updates.md).

⚠️ It carries **text and never code**. A dependency this app has fallen behind
on is reported by `security-check`'s drift rung, and `update` will not fix it —
that is a different act with a different risk.

## When the message is unfamiliar

A hydration mismatch that is not yours, a sign-in that breaks because two copies
of the app share a machine, a database that belonged to a different app, dates
that come back a day out, an app that went live empty. Each of those looks like
a bug and is not one.
[`docs/troubleshooting.md`](troubleshooting.md) is the list, by symptom.

## What this document is not

- **Not a manual.** Every subject above is fully explained somewhere else, by a
  file that is kept current with the code it describes. This page names the duty
  and points; the moment it starts explaining *how* something works, it has
  become a second copy, and the copy that is not the owner is the one that goes
  stale.
- **Not a second [`docs/cron.md`](cron.md) or [`docs/DEPLOY.md`](DEPLOY.md).**
  Those two are where the mechanisms live. If what you need is a job's `run()`
  signature or a host's deploy hook, this page has already done its job by
  getting you there.
- **Not a gate.** Nothing here runs in `node run.mjs test`, in a hook, or as a
  condition of shipping. The commands it collects ask the network or a deployed
  app, and their answers move without this app changing — a check like that
  wired into a release is a brake, and a brake is what somebody eventually
  removes, taking the intent with it.
- **Not a schedule anybody owes.** The *how often* column is a starting point,
  not a contract. On a developer's machine an incomplete measurement is the
  normal state, and a round that treats it as an alarm is noise within a day.
