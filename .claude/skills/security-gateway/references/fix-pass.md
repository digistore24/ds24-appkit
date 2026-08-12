<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# `fix` — from a finding to a proven fix

Part of the skill `security-gateway`, check 9 (`fix` — fixing what was found).
SKILL.md holds the pass as seven steps; this file holds the mechanics.
Severities and the format of a finding are defined in SKILL.md.

## Why this file exists

**A fix that has not been measured is a claim.** The agent that wrote the fix is
the worst available witness to it, and *"I re-read the code and it looks right"*
is the shape of every regression this template has already shipped once.

Two words do the work here and they are not the same word:

| | |
|---|---|
| **changed** | a diff exists |
| **fixed** | the finding is gone **and** something proves the re-run could have found it |

A finding absent from a re-run may be fixed, or the re-run may not have looked.
The whole security ladder was built to keep those apart — three states per rung,
a written reason on every skip, `complete: false` in the record when anything was
skipped. This is where that machinery gets **used**: the proof of a fix is a rung
that *ran*, not a tally that *fell*.

## Step 1 — which proof shape applies

Say it out loud before you touch a file, because it decides what step 4 has to
produce.

```
countable finding                          semantic finding
─────────────────────────────────────      ─────────────────────────────────────
it came out of `security-check`            you read the code and judged it
(checks 4 and 5, and the `live` rung)      (checks 2, 3, 6, 8)

node run.mjs security-check --json         a test that reproduces the hole
  the finding's id is absent      ← gone →   the test is green
  its rung's state ≠ "skipped"    ← needle → the same test was RED before
```

And a third case that is neither: **a finding no test can reach** — a rotation at
a provider, a header stripped by a CDN, a host setting somebody has to change in
a web console. Say **unproven**, in that word, name what would prove it, and put
it under `## Open`. Never under `## Fixed in this run`.

## Step 2 — apply the change

**One finding, one change.** Small and targeted: a security fix bundled into a
refactor cannot be reviewed and cannot be reverted.

**A test where a test is possible.** The template already tests the sharp edges —
`lib/digistore/ipn.test.ts`, `lib/ai/tools.test.ts`,
`lib/impersonation/guard.test.ts`. A new guarantee gets a new test, or it will
quietly disappear in six months.

🚨 **Write the test BEFORE the fix and watch it fail.** That red run is half the
proof, and it is the half that gets skipped, because writing it costs five
minutes and re-reading the code costs none. Record both outputs — the red one and
the green one. *"A guard whose probe cannot fire is worse than no guard: it
reports success"* (`scripts/lib/source-text.test.ts`).

## Step 3 — the four checks, each with its own "could not look"

Run all four, in this order, and report each with **three** possible outcomes.
"Passed" and "nobody looked" are the same colour everywhere else in this app
too, which is why they are separated here by hand.

| Command | Passed | Failed | Could not look |
|---|---|---|---|
| `npm run typecheck` | exit 0 | exit non-zero, with the file and the line | — |
| `npm run test` | exit 0 | a red test, named | — |
| `node run.mjs smoke` | the success line carries **`, N of them signed in`** | `✗ N page(s) with a server error` (exit 1) | a line saying `N protected page(s) NOT checked — <reason>` — **exit 0, and not a pass** |
| `node run.mjs errors` | exit 0, and the window it looked at is named | **exit 1** — findings | **exit 2** — *"unreachable, 404, rate-limited, unusable answer"*. A refusal never prints a `✓` |

`node run.mjs test` is typecheck **and** tests in one command. Using it is fine;
reporting one result for it is not — *"it compiles"* and *"the tests are green"*
are two answers the operator is owed separately.

### The two traps, both of which look green

🚨 **`smoke` without a session prints its success line and exits 0.** Without a
sign-in the protected pages are counted as redirects and never rendered — and
the line then reads *"✓ All 41 page(s) answer without a server error."* with **no
`of them signed in` clause at all**, still exit 0. The proof is the **presence of
that clause**, never the absence of a complaint. `--no-signed-in` turns the
second pass off entirely and says so; so does a sign-in that could not happen,
in a line beginning `·  N protected page(s) NOT checked`. Those nine or so pages
are the ones carrying the real queries.

⚠️ **`errors` reads `.dev/dev.log`, so it needs the app running.** An app that is
not up is a *could not look*, not a green. Start it (`node run.mjs start`) and
run it again. Against a deployed app the same command takes `--url https://…` and
answers over `DIAGNOSTICS_SECRET` — where that is missing the answer is exit 2,
which is again not a pass.

**Any *could not look* means the fix is not proven.** Say which check could not
look and why, in the evidence block, on that check's own line.

## Step 4 — the proof, and it has two halves

Neither half counts alone.

| | |
|---|---|
| **The finding is gone** | the same check, run again, in the same scope — and the finding is not in its output |
| **The needle** | evidence the re-run **could have found it**: that it looked, rather than that it was quiet |

### A countable finding

```bash
node run.mjs security-check --json
```

Read two things out of that answer:

1. the finding's id is **absent** from `rungs[].findings`;
2. the rung that reported it has `"state": "clean"` or `"found"` — 🚨 **never
   `"skipped"`.**

A finding that vanished because the advisory rung could not reach the network is
not a fixed finding. It is the failure the whole ladder exists to prevent,
arriving through the back door: a skipped rung reports no findings, and no
findings looks exactly like success. The record's `complete: false` and the
`⏭ not asked` block in the human output say the same thing in two other places —
any one of them is enough to withhold the word *fixed*.

**Scope is part of the claim.** A fix proven against `--url https://…`, or against
a run scoped by check 10 (`since`), says so in the evidence block: a smaller
re-run is a smaller claim, and the two runs are named by their scope.

### A semantic finding

The test from step 2, with both outputs:

```
before the fix:  ✗ IDOR: a foreign memberId reaches listGrantsFor()   (1 failed)
after the fix:   ✓ lib/entitlements/manage.test.ts                    (1 passed)
```

A test that was never red proves that it passes, which is a different sentence.
If you cannot make it fail on the unfixed code, say so — that is the third case
from step 1, and it goes under `## Open`.

## Step 5 — the diff, beside the result of each check

Show the change itself: `git diff` for the files you touched, or the file and the
lines where the diff is too large to paste. Then the evidence block, and it has a
fixed shape so that two fixes are comparable and a missing line is visible:

```
Fixed — Vulnerable dependency: <package>@<version>  (❌ HIGH, GHSA-xxxx-xxxx-xxxx)
  Change:    package.json +1/−1, package-lock.json +18/−12
  Proof:     security-check: the advisories rung ran (state "found" → the id is gone)
  Needle:    that rung was NOT skipped in the confirming run — it answered off the
             lockfile, evidence line quoted below
  typecheck: ✓
  test:      ✓ 2157 passed
  smoke:     ✓ 41 page(s), 9 of them signed in
  errors:    ✓ nothing in the window (500 lines since 12:03)
  Deploy:    not done — your decision
```

🚨 **Anything that cannot fill a line writes what happened there** — never a
blank, and never a `✓`:

```
  smoke:     — could not look: 9 protected page(s) NOT checked (no owner account)
  errors:    — could not look: exit 2, the app was not running
  Proof:     UNPROVEN — the header is stripped by the CDN; only a request to the
             live domain after the CDN rule changes would show it
```

## Step 6 — the report

`docs/reports/security-YYYY-MM-DD.md`, the shape SKILL.md fixes.

- `## Fixed in this run` — **one evidence block per fix**, in the shape above.
- `## Open` — everything else, with the reason. 🚨 A fix whose proof is missing or
  partial belongs here, not above, however good the diff looks. *Changed* and
  *fixed* are two words.
- The spoken summary keeps its shipped shape — what was found, what was fixed,
  what is still open, and whether the app can go live, as a straight answer — and
  gains one clause: **what was proven, and by what.**

## Step 7 — stop

**You do not deploy.** No push, no host CLI, no "while I am here". Deploying is
the operator's next decision and it happens in `go-live` or in their host's own
deploy — say that in one sentence and stop.

Committing is theirs in the same breath. The template's rule that a finished
change is a commit stays true; offer it, and never do it silently inside a
security pass.

Then offer exactly two next things: **the next finding**, or **the report**.

⚠️ **A failing check is not a smaller success.** Name the check and its output,
do not present the fix as done, and offer the two honest ways forward — fix the
new problem, or revert the change. The finding stays open with the failure
recorded beside it, and the pass does not move to the next finding while
anything is red: one finding, one change, one measurement.

## The three shortcuts that make a finding disappear without fixing anything

All three are **refusals**. Each is worth naming out loud when it is refused,
because each of them works.

🚨 **1. Weakening or deleting a shipped test.** `CLAUDE.md`: *"a shipped test
that fails is a finding about your change, not an obstacle in its way"*. A red
shipped test after a security fix is a **second finding**, and it is reported as
one. Deleting an assertion to reach green converts a measurement into a silence.

🚨 **2. Accepting the finding instead of fixing it.** Adding a GHSA id to
`scripts/security/accepted.mjs`, or a row to `docs/reports/security-accepted.md`,
makes the number go away in one line. SKILL.md's *Accepted risks* already rules
on it: **only the operator accepts a risk — never you, and never silently**, a
**CRITICAL is not accepted** at all, and an entry without a written reason is an
exemption nobody can name (`scripts/security/rules.mjs`). Bringing a finding to
the operator as a decision is legitimate. Writing the entry yourself is not.

⚠️ **3. `npm audit fix`.** SKILL.md already says it fixes none of the
supply-chain facts the ladder reports. What it *does* do is re-resolve the whole
tree — a change nobody reviewed, arriving inside a security fix, in the one file
whose whole job is to say which bytes this app installs. An advisory fix is a
version moved in `package.json` plus `npm install`, and the lockfile change is
part of the diff you show in step 5.

### And two fixes that are documented as not being the fix

| Finding | The fix that is not the fix |
|---|---|
| `drift` (dependencies behind the template) | `node run.mjs update` — it carries guidance text and never code, so it would bring the paragraph describing the problem forward and leave the dependency where it is |
| a missing security header on the live domain | editing `next.config.ts`, which already sends it — something in FRONT of the app stripped it, and that is where to look |
| the missing CSP | pasting an `unsafe-inline` policy. The template ships none deliberately; the `live` rung reports it without rating it, and rating it here would be inventing a finding |

## A worked example, end to end

The advisory finding, because it is the one a non-developer meets first.

**The finding**, from `node run.mjs security-check`:

```
❌ HIGH — Vulnerable dependency: tar-fs@2.1.1
   Where:    package-lock.json
   Why:      GHSA-pq67-2wwv-3xjx — link following lets an extracted archive write
             outside the destination directory.
   Fix:      Raise it to 2.1.2 or later.
   Evidence: npm advisory, production dependency, answered off the lockfile.
```

**Step 1** — countable. It came out of `security-check`, so the proof is the
`--json` re-read plus the rung's state.

**Step 2** — one change: the version in `package.json`, then `npm install`.
No `npm audit fix`. No test — an advisory is not a behaviour this app can assert
about itself, so the test half is legitimately absent here and the needle is the
rung's state instead.

**Step 3** — the four checks:

```
npm run typecheck   → exit 0
npm run test        → exit 0, 2157 passed
node run.mjs start && node run.mjs smoke
                    → ✓ All 41 page(s) answer without a server error, 9 of them signed in.
node run.mjs errors → exit 0, nothing in the window (500 lines since 12:03)
```

The `smoke` line is read for its **clause**, not its tick. Without
`, 9 of them signed in` the same line would be a run that never rendered a
protected page, and it would still have exited 0.

**Step 4** — the proof:

```bash
node run.mjs security-check --json
```

`tar-fs@2.1.1` and `GHSA-pq67-2wwv-3xjx` are gone from every rung's `findings` —
and the npm advisory rung reads `"state": "found"` (it found other, accepted,
dev-only things) rather than `"skipped"`. It looked. That is the needle.

Had it read `"state": "skipped", "reason": "the registry did not answer"`, the
honest report is:

```
  Proof:     UNPROVEN — the advisories rung was SKIPPED in the confirming run
             (the registry did not answer). The id's absence proves nothing.
```

…and the finding stays under `## Open` until a run that could look says otherwise.

**Step 5–7** — the evidence block from step 5, one line in
`## Fixed in this run`, and then a full stop: the operator decides whether this
gets deployed, and whether it gets committed.
