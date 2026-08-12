<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# `since` — the recurring pass

Part of the skill `security-gateway`, check 10 (`since` — only what changed
since the last report). SKILL.md holds when this check runs and the table of
what may be scoped; this file holds the mechanics. Severities and the format of
a finding are defined in SKILL.md.

## Why this check exists

The first security pass costs 20–40 minutes and gets run. The second one costs
20–40 minutes and does not — so three weeks after a launch the honest answer to
*"is my app still safe?"* is a full pass nobody has time for, and the answer
people take instead is the old report's date.

This check makes the recurring round cheap enough to actually happen. It is not
a smaller version of `all`; it is a different question. `all` asks *is this app
safe*. `since` asks *did the last three weeks break anything* — and the two are
only the same answer on an app that has not changed.

## Step 1 — ask for the scope

```bash
node run.mjs security-scope           # the text
node run.mjs security-scope --json    # the same facts as data
```

It exits **0** whatever it finds. It reports a scope; it does not judge one, it
writes nothing, and it is in no gate.

```
Scope for a recurring security pass

  Report:  docs/reports/security-2026-08-01.md   (2026-08-01)
  Base:    a1b2c3d  — the last commit at or before 2026-08-01T23:59:59 (local time)
  Changed: 14 file(s)   committed 9 · staged 1 · unstaged 2 · untracked 2   (a file can be in more than one)

  In full (the diff touched them):
    money           lib/tokens/spend.ts
    customer data   db/schema.ts

  Changed, and no check reads them:
    messages/de.json, messages/en.json, docs/app.md

  NOT looked at: 812 of 826 files. This is not a full pass.
  secrets and deps run in full anyway — they are never scoped to a diff.
```

Under `--json` the same answer carries `report`, `base`, `files` (the whole
changed set plus the four listings it came from), `inFull`, `uncovered` and
`notLooked { count, total }`.

Three things about it that are worth knowing before you trust the number:

- **The report's file NAME is the date.** A heading inside the file is prose
  somebody edited; `security-accepted.md` and `module-removals.md` live in the
  same folder and are correctly ignored, because neither is a report of a run.
- **The base is the last commit at or before the END of that day**, so
  everything committed on the day the report was written sits behind it. The
  other rounding would push that day's work into every later scope for ever.
- **Untracked files are in the changed set.** That is where a new page lands,
  and a scope that drops them is a review of everything except the new work.

## Step 2 — the two cases that are NOT a scope

### `mode: "full"` — there is nothing to measure from

No dated report, no git on the machine, no commit at or before the report's day
(a shallow clone, a repository younger than the report, a folder that is not a
repository at all):

```
Scope: FULL — no dated report in docs/reports/. A diff against nothing is
       not a review, so this pass reads the app rather than a change set.
```

**Run `all` and say so in one sentence** before you start. Never a smaller scope
and never a guess — and never treat "no report" as "nothing has changed", which
is the same two words meaning opposite things.

### An empty diff — nothing changed since the report

```
Scope:  nothing has changed since docs/reports/security-2026-08-01.md (base
        a1b2c3d). The verdict of that report still stands, so this run carries
        no severity tally of its own.
```

Say exactly that, name the report, and **carry no severity tally**. Still run
`secrets` and `deps` in full: those two can find something new on a tree nobody
touched, and their result is the only fresh number such a report has.

🚨 An empty diff is never written up as `🚨 0 ❌ 0 ⚠️ 0 ℹ️ 0`. That is the shape
of a clean full pass, and printing it here is a lie told by formatting rather
than by a sentence — which is why nothing in the tooling will produce it for
you.

## Step 3 — run the checks, per the table in SKILL.md §10

Two of them are never scoped, and the reasons are not laziness:

- **`secrets`** is first in the full pass for a reason SKILL.md §1 states: it is
  *"the only finding class that stays dangerous after you fix it (the key is
  out; it has to be rotated)"*. A credential sitting in a file nobody touched
  this month is still out. Scoped to the diff, the check would only ever see
  keys pasted since the last report.
- **`deps`** is `node run.mjs security-check`, which reads the lockfile, two
  advisory databases, the registry, the posture files and (with `--url`) the
  live domain. None of that is a function of the diff — an advisory is published
  by a stranger, without anybody here changing a line. It costs seconds and its
  answer changes daily.

So a `since` pass is **the whole ladder plus a diff-scoped read**, which is why
even the empty-diff report above carries a fresh `security-check` result.

**A diff into money, authentication, entitlements or customer data widens the
scope to that whole area** — however little of it changed. Those areas are a
named list in the code (`ALWAYS_IN_FULL` in `scripts/security/scope.mjs`), held
against SKILL.md's §2/§3 file lists by a test, so the two cannot become two
different opinions about what is sharp. The report says which file pulled which
area in.

## Step 4 — the report

Same file, same place (`docs/reports/security-YYYY-MM-DD.md`), plus two things a
full pass does not have:

```markdown
# Security report — 2026-08-22

Scope:  since docs/reports/security-2026-08-01.md (base a1b2c3d) — 14 files changed,
        2 areas reviewed in full. NOT looked at: 812 of 826 files.
        This is not a full pass.
Checks: secrets (full), deps (full), code (diff-scoped), pay (skipped — the diff
        touches no money surface), api (diff-scoped), host (skipped — no deployed
        address), verdicts (skipped — ACTIVITIES is empty)
App:    local, commit 9f8e7d6

🚨 CRITICAL 0   ❌ HIGH 0   ⚠️ MEDIUM 1   ℹ️ LOW 0   ✅ accepted 2

## Findings
(the one MEDIUM, in the four-line format)

## Not covered by this run
A full pass reads 826 files; this read 14 plus two areas in full (money,
customer data). Not read: everything under app/dashboard/ that did not change,
every module route, the community surfaces, and the seven route handlers §6
covers. The last FULL pass was 2026-08-01 — three weeks ago.

## Fixed in this run
## Open
## Worth a look
## Accepted risks
```

**The `Scope:` block sits ABOVE the tally**, always. A reader who meets
`🚨 0 ❌ 0` first has already formed an opinion by the time the qualification
arrives, and no amount of correct text underneath takes it back.

**Every check that did not run in full appears in `Checks:`** as *scoped* or
*skipped with its reason* — the treatment `host` already gets before the first
deploy, and the same three states a rung of `security-check` has: ran clean, ran
and found something, did not run. A check is never silently omitted.

## 🚨 What a scoped run may not say

This is the section to re-read before writing the summary, because every failure
this check can have is a wording failure:

- **"Clean", "safe" and "no findings" never appear without the scope in the same
  sentence.** Not in the report, not in the spoken summary, not in a commit
  message. The template's own precedent is `security-check`'s closing line,
  which says *"nothing found in the rungs that ran"* and deliberately never
  *"clean"*.
- **The spoken summary names the date of the last FULL pass, every time.** It is
  the sentence people act on, and it is the one that otherwise carries none of
  this. *"Nothing new in the fourteen files that changed since 1 August; the
  last full pass was 1 August, three weeks ago."*
- **"Can this go live?" is never answered from a scoped run.** A launch question
  gets a full pass — say that plainly rather than converting a small answer into
  a big one.
- **Never present the `NOT looked at` number as reassurance.** It is not "we
  covered the important 14"; it is "812 files were not read on this pass, and
  the reason that is acceptable is the report of 1 August".

The failure all four prevent is one failure: a full pass that finds nothing and
a scoped pass that finds nothing print the same report. The first means somebody
looked at the app. The second means somebody looked at fourteen files. Six weeks
later `coach` reads the newest report, sees a date and a clean tally, and says
the security pass is done.
