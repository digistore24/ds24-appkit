<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# How guidance is written in this repo

This file is for whoever WRITES guidance — a new skill, a new doc, a new block in
`CLAUDE.md`. It is not read by every session, deliberately: the rules below are
an authoring contract, and an authoring contract loaded on every turn of every
app is exactly the kind of text this project keeps moving out of `CLAUDE.md`.

What lives here: the division of labour between the five surfaces, and the
contract every skill keeps.

## The five surfaces, and the one question each answers

A fact belongs in exactly one of these. Two copies drift, and the copy that is
not the owner is the one nobody updates.

- **`CLAUDE.md`** — a line belongs here only if an agent that has read no other
  file would otherwise cause damage it cannot see. Every `##` section is at most
  40 lines and ends in a bold link to the doc that carries its long form.
- **`SKILL.md` frontmatter** — says *when to start*, never *how it works*. If a
  sentence would still be true after the steps were rewritten, it is not a
  trigger and does not belong in the description.
- **`SKILL.md` body** — the ORDER of the work: steps, decision points,
  hand-overs. Anything still true if the steps changed does not belong in it.
- **`references/*.md`** — what ONE step of ONE skill reads once: a catalogue, a
  long example, a template. Linked from its own skill and from nothing else,
  never from `CLAUDE.md`.
- **`docs/*.md`** — the full form of one subsystem with more than one reader, and
  the only place a fact appears in full. Everything else points here.

One of those sizes is measured rather than trusted:
`scripts/docs-coverage.test.ts` keeps
every `SKILL.md` under 500 lines, because the whole body loads when the skill
triggers and over that mark it has stopped being a procedure and become a
catalogue the customer's session pays for on every use. The fix is never to
delete it — it is to move the catalogue into `references/` beside the skill.

## How a skill works — the same way every time

Whoever writes or changes a skill keeps to this, because a user who has found
their way around one skill has then found their way around all of them:

- **You run the commands.** Through your Bash tool, and you report what came
  back. Never "run `node run.mjs …` and tell me what it says" — the people here
  are not developers, and a command handed over is a conversation that stops.
- **Say where this is going, not just what you are doing.** Before a stretch
  that will run for several minutes: one sentence on what you are about to do,
  roughly how long, and **what will be true when it is finished** — then a line
  per step as it lands. The last of those three is the one that is usually
  missing. Measured, against real sessions: a run somebody described as "thirty
  silent minutes" turned out to speak forty-nine times, the longest gap being
  four minutes. They were not short of text. They were short of a thread — every
  line said what was happening and none of them said where it ended, which from
  the other chair is indistinguishable from a machine going in circles.
- **No technical word arrives unexplained.** Commit, branch, pull request, port,
  migration, schema, environment variable — each is a word somebody here is
  meeting for the first time. Use it where it is the right word, and put its
  plain meaning in the same sentence, once. A question nobody can parse gets
  answered at random, and that answer then travels on as if it were a decision.
- **Look before you ask.** Almost everything a skill needs to know is on disk:
  `.env`, the files under `config/`, the tables in `db/`, the reports in
  `docs/reports/`. Ask only about what genuinely leaves no trace, and then in
  one sentence.
- **Two shapes, and every skill is one of them — numbered either way**, so the
  user can always see where they are and answer with a number.
  - A skill that **builds** something is a numbered path: step 0 asks whether
    the thing is wanted or already there, then steps 1, 2… in order — whether
    the file spells them as `Step N` headings or as a numbered list.
    `build-app`, `setup-digistore`, `ai-chat-knowledge`, `setup-hosting`.
  - A skill that **inspects** something is a numbered menu of independent
    checks, each with what it looks at and roughly how long it takes. Item 1 is
    the full run and the default. If the user's request already names one check,
    start it and skip the menu; otherwise show the menu and **wait**.
    `ux-gateway`, `security-gateway`, `performance-gateway`.
- **Point at the reference, do not copy it.** Where a `docs/…` file already
  explains the thing in full, the skill names it in its first few lines and
  reads it — it does not restate it. Two copies drift, and the one in the skill
  is the one nobody updates.
- **One severity ladder, one shape for a finding.** 🚨 CRITICAL, ❌ HIGH,
  ⚠️ MEDIUM, ℹ️ LOW, and every finding says *Where · Why · Fix · Evidence* in
  that order — in full under *One report shape* below, which is where the four
  rungs and the four lines are owned.
- **Anything that produces a verdict writes it down**, dated, into
  `docs/reports/` — so that "have we already done that?" has an answer next
  month; the shape of that file is *One report shape* below. Anything that
  produces a plan or a text writes it into `docs/`.
- **Anything the customer will SEE, and anything the app will DO for them, is
  proposed, never assumed.** Where an app produces something a person looks at,
  shows or publishes — or could read, judge or produce *alongside* them while
  they work — the agent lays the possibilities out as a numbered menu and
  **waits**. It does not pick on the developer's behalf, and it does not quietly
  build the version with nobody in it either — that is a decision too, and an
  unmade decision is how an app ends up handing its customers paragraphs and a
  form.

  Three answers, and all three are valid:

  | | |
  |---|---|
  | **numbers** | exactly those get built |
  | **"you choose"** | take the default and carry on, no further question. The shortcut for somebody who trusts the suggestion, and it must be offered IN the menu rather than hidden in prose |
  | **"none of it"** | nothing of it gets built — and it goes into `docs/app.md` under the decisions either way, because a rejected alternative that was not written down is one that gets proposed again three sessions later. For the second question the reason is sharper: it costs money on every use, so a "no" is an answer to a real cost rather than a failure to persuade |

  **When** matters as much as whether: before the data model, because whether a
  message can carry a picture is a column before it is a layout — and a
  companion needs columns too, for the submission it reads and the subject its
  turns hang on. **Once**, at that point — not again on every page afterwards. A
  menu per page would be the same question asked six times, which trains people
  to answer it without reading; later pages inherit the decision and only ask
  again where they hand the customer something, or take something from them,
  that the first decision did not cover.

  **Trying things out is exempt**, on the same boundary as the SAAS rule in
  `CLAUDE.md` → *What gets built here*. Somebody who asks for "Hello World" gets
  Hello World, not a menu.

- **End by naming the next skill and offering to start it.** A skill that stops
  with "you could now…" leaves the user exactly where they were.

## One report shape

Five skills produce a verdict and write it down: the four gateways
[`ux-gateway`](../.claude/skills/ux-gateway/SKILL.md),
[`security-gateway`](../.claude/skills/security-gateway/SKILL.md),
[`performance-gateway`](../.claude/skills/performance-gateway/SKILL.md) and
[`compliance-check`](../.claude/skills/compliance-check/SKILL.md), plus
[`operate`](../.claude/skills/operate/SKILL.md) for the round on an app that is
already live. `user-onboarding` writes one too.

**This is the shape, once, and every one of them points here for it.** What stays
with a skill is what is genuinely its own: the names of its checks, a section the
others do not have, the name of its accepted register. The rest was five copies
of one page, which is the drift this whole file argues against.

### Where the file goes

`docs/reports/<kind>-YYYY-MM-DD.md`, where `<kind>` is `security`, `ux`,
`performance`, `compliance`, `operations` or `onboarding`. **A second run on the
same day adds `-2`, then `-3`.** That suffix is not decoration: the code that
reads these names accepts a date and an optional `-N` and nothing else
(`scripts/dev/journey.mjs`, `scripts/dev/operations.mjs`,
`scripts/security/scope.mjs`), so a report named any other way is a report the
app cannot see. Create the folder if it is not there.

**Every run writes one, whether it found anything or not** — that is what makes
"have we already done that?" answerable in three months.

🚨 **The report's NAME is the whole record.** Nothing else is written down: no
`.dev/` file, no config key, no table. `node run.mjs journey` and the session
greeting read the newest name per kind and never open the file, so a second place
to record that a run happened would be a second truth to keep in step. The
`<kind>-accepted.md` register beside them carries no date at all, deliberately —
it is not a run, and the readers above refuse it by name for that reason.

### The header, and the tally under it

```markdown
Checks: secrets, deps, code, pay, api        (host: skipped — not deployed yet)
App:    local, commit a1b2c3d

🚨 CRITICAL 0   ❌ HIGH 2   ⚠️ MEDIUM 3   ℹ️ LOW 1   ✅ accepted 2
```

- **`Checks:`** names every check of that skill, and **every one that did not run
  in full says so with its reason** — *scoped*, or *skipped because …*. A check is
  never silently omitted, and never left to be inferred from an absence.
- **One line says where this ran, and carries the commit.** `App:` in most of
  them; `performance-gateway` calls the same line `Measured:`, because there it
  also carries the build and the load generator's own pessimism.
- **The tally counts findings only.** An accepted entry is not in it, and neither
  is anything under `## Worth a look`.
- 🚨 **Anything that qualifies the whole report sits ABOVE the tally** — a scope,
  a count of what could not be looked at. A reader who meets `🚨 0 ❌ 0` first has
  formed an opinion by the time the qualification arrives, and no amount of
  correct text underneath takes it back.

### The sections, in this order

| | |
|---|---|
| `## Findings` | each in the four-line format below, CRITICAL first |
| `## Fixed in this run` | what was PROVEN fixed, with the measurement or the file |
| `## Open` | what stays, and why — a decision, a cost, a dependency, an unproven fix |
| `## Worth a look` | the low-confidence observations. No severity, no count |
| `## Accepted …` | from the register, with the reason and who accepted it |

A skill ADDS a section where it has something the others do not — `## Numbers`
above the findings in `performance-gateway`, `## Not covered by this run` after
them in a scoped security pass, `## Not checked` in `operate`, `## Scope` first in
`compliance-check`. It does not reorder the five above, and it does not rename one
to mean something slightly different.

### The severity ladder

🚨 **CRITICAL**, ❌ **HIGH**, ⚠️ **MEDIUM**, ℹ️ **LOW** — four rungs, the same four
everywhere, always with the emoji, because a report is skimmed before it is read.

**What each rung MEANS is the skill's own**, and deliberately so: money reachable
right now, an app that falls over, a customer who cannot reach what they paid for
and something that is unlawful today are four different sentences about one word.
So each skill states its own four meanings — and none of them invents a fifth
rung, renames one, or grades on a number out of ten.

**Where a command already rated something, keep its rating.** `node run.mjs
ux-check`, `security-check` and `legal-check` rate on this same ladder on purpose,
so a severity invented beside one of them is a second opinion about a measurement.

### The four lines of a finding

```
🚨 CRITICAL — Admin action reachable without an owner check
   Where:    app/dashboard/admin/users/actions.ts:34
   Why:      A server action is an HTTP endpoint. Any signed-in member can POST
             to it and change another member's role.
   Fix:      requireOwner() at the top of the action, before the first query.
   Evidence: The action calls auth() but never checks session.user.role.
```

*Where · Why · Fix · Evidence*, four lines, always in that order.

- **Where** is a file and a line, a route, or the page you opened.
- **Why** says what somebody gets out of it, or what it costs them, in plain
  words. The name of a category is not a reason: "Broken Function Level
  Authorization", "poor affordance" and "GDPR non-compliance" are labels.
- **Fix** is a change somebody can make, not a principle.
- **Evidence** is what you actually saw or measured.

**Only report what you can show.** A finding needs a code path you read, a
request you sent, a page you opened or a number you measured; what counts as
showable in a given domain is that skill's own sentence. Anything resting on an
assumption goes into `## Worth a look` — no severity, no count. A confident wrong
finding costs the user an afternoon and teaches them to ignore the next report.

### Accepted is not the same as fixed

Some findings are deliberate. Rather than rediscovering them every run they go
into an undated register beside the reports, `docs/reports/<kind>-accepted.md`:

```markdown
| Finding | Where | Why accepted | By | Date | Review |
|---|---|---|---|---|---|
| Rate limiter is per process | lib/rate-limit.ts | single instance for now | Anna | 2026-07-26 | when scaled out |
```

- An accepted entry is **not counted** in the tally, and appears in its own
  section of every later report.
- **Only the user accepts one — never you, and never silently.** Bringing a
  finding to them as a decision is the job. Writing the row yourself is not, and
  it is the cheapest way there is to make a number go away without fixing
  anything.
- An entry with no written reason is an exemption nobody can name.
- 🚨 **A CRITICAL is not accepted.** If somebody wants to accept one, that is the
  moment to say plainly what it means.
- When the `Review` condition has come true — the app was scaled out, the date has
  passed — it is an ordinary finding again.
- **A skill may ADD a column its domain needs, or make one of these six stricter,
  and then it says why in one sentence.** `performance-gateway` carries the
  measured value and the accepted one, because there the acceptance covers a
  number rather than a route; `compliance-check` insists on a named person and a
  calendar date, because a legal position expires with the law. What it does not
  do is drop one of the six, or keep a name while quietly meaning something else
  by it.

### Two columns, and why the second one has to exist

🚨 **A check that could not look is neither a pass nor a finding, and it needs a
column of its own.** `operate` is the sharpest form of it: `Checked:` and
`Not checked:` are two separate header lines, the second carrying its count, and
the closing sentence is never "✓ clean" while anything is in the second list.

**It is a family, not a rule of one skill.** Every measuring thing in this app
says the same sentence in its own words, and all of them mean *a refusal is not a
silence*: `smoke`'s *"9 protected page(s) NOT checked"* — which `CLAUDE.md` →
*Never ship a broken page* names outright as a line that must not be read as a
pass — `kb-check`'s unreachable store, `module remove`'s *"I could not look"*,
`content-check`'s module that cannot answer, and `ux-check`, where green means
**counted**, not good.

A tick for a question nobody asked is the worst answer available, because it is
the only one nobody ever goes back to.

### Then say it out loud

**Three or four sentences, ending in a straight yes or no.** What was found, what
was fixed, what is still open — and then the one question the run exists to
answer, as *"yes"* or *"no, because X"*: can this go live, would you put it in
front of a paying stranger, will it hold at a hundred people.

Never a summary of the report. The spoken sentence is the one people act on, and
it carries none of the report's qualifications unless it says them itself — which
is why a scoped pass names its scope there too, and a round with a *not checked*
list says so there before it says anything that sounds clean.
