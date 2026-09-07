<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The session greeting — what it says, and what its absence means

Every session in this app opens with one printed line from `node run.mjs greet`
— the same line the `SessionStart` hook prints on its own where the agent
program has one. It carries up to two statements, and each is read before the
first file is touched:

| Line | Says | Owned by |
|---|---|---|
| `[Setup: …]` | whether this machine can run the app at all — `ok — verified <date>`, `ok — not verified yet`, or `blocked — …` | `node run.mjs doctor`, skill `setup-machine` |
| `[Operations: …]` | what is open about RUNNING this app at HIGH or above — printed only when something is | the security record, `node run.mjs security-check` |

Two rules follow, and both are stated in `CLAUDE.md` → *First: meet the user
where they are*: **no building before a `node` command has answered in this
session**, and **no greeting at all is a case of its own** — absence of a
signal is never a signal, so the line is asked for by hand (`node run.mjs
greet`) before anything else happens. The rest of this page is the mechanics:
how the line reaches the session, why it sometimes does not, and every sentence
the second statement can carry.

## No greeting appeared — one script, three wirings and one guidance rule

The greeting is not decoration: it carries the `[Setup: …]` line the project's
rulebook builds its hard precondition on — whether this machine can run the app
at all. It is printed by `scripts/dev/session-start.mjs`, and because the
programs do not agree on how a command runs at session start, that same script
is invoked three different ways. It lives in `scripts/dev/` and not under any one
program's folder for exactly that reason — it is shared tooling, like everything
else in there:

| | |
|---|---|
| Claude Code | `.claude/settings.json` → `hooks.SessionStart` |
| Codex CLI | `.codex/config.toml` — `[[hooks.SessionStart]]` entries, enabled by `[features] codex_hooks = true` in the same file |
| OpenCode | `.opencode/plugins/session-start.js` — it has no declarative hooks, so this one is a module subscribing to `session.created` |
| **Antigravity CLI** | **nothing — and that is the finished answer, not a gap.** See below |

🚨 **The fourth program has no session-start event, so it gets no hook.**
Antigravity CLI fires exactly five (`PreToolUse`, `PostToolUse`,
`PreInvocation`, `PostInvocation`, `Stop`), and none of them is "a session
began". Hanging the greeting off `PreInvocation` was considered and rejected on
three counts, each fatal on its own:

- **It is too late.** That event fires before a MODEL invocation, so the
  earliest it can run is after the user has already typed something. The
  greeting exists to be read before the first file is touched.
- **It cannot reach the person.** Its only output is `injectSteps`, which puts
  text in front of the model. There is no field that displays anything to the
  human, and the CLI's own ephemeral messages are reported as invisible in the
  interface — they land in the transcript file and nowhere a person looks.
- **Getting it wrong is silent.** A `hooks.json` entry naming an event this
  program does not have is dropped without a word — no error, no warning, no
  line in the output. That is exactly how somebody ends up believing a greeting
  is wired when nothing runs, which is the failure this whole section exists to
  prevent.

So: no hook, rather than one that looks wired and does nothing. A greeting that
fails silently is worse than one that was never promised.

What replaces it is the rule in `CLAUDE.md` / `AGENTS.md`: *absence of a signal
is never a signal — if no greeting appeared, run `node run.mjs greet` before you
touch a file.* That sentence was written for a hook that failed to fire, and in
this program it is simply the normal path. It needs no wiring at all, because
Antigravity reads `AGENTS.md` by itself — there is no context-filename setting
to configure, and none is missing. Both halves are asserted by
`scripts/agent-setup.test.ts` — that this program ships no greeting hook, and
that the sentence standing in for one is still in both files — so the exemption
cannot quietly decay into an omission.

The project ships wired for all four, and `node run.mjs agent-setup` reduces it
to one. That order is deliberate: a fresh clone works in whichever program it is
opened in, before anybody has run anything — the command is the tidy-up
afterwards, never a precondition. It removes the wiring for the three programs
not in use, records what it removed in `.agent-profile.json` so `node run.mjs
update` does not put them back, and can restore any of it (`--agent <other>` or
`--undo`). It never touches `.claude/skills/`, the guidance or the greeting:
those are shared by all four. `setup-machine` runs it on the first session; the
person building never has to know it exists.

⚠️ **One of the four cannot be detected, and `agent-setup` says so rather than
guessing.** Antigravity passes session context to hooks as stdin JSON and sets
no environment variable of its own, so there is nothing to read. Run without
`--agent` inside it, the command refuses and lists the four names — which is the
correct outcome: a wrong guess removes the wiring somebody is using.

One case the script cannot cover is its own absence. It is a Node program, so a
machine without Node cannot report that it has no Node — and "the agent and git
installed, Node not yet" is the ordinary state of a fresh clone rather than an
exotic one: the agent does not need Node, git does not need Node, and the app
needs it for everything. So a second hook says it in shell instead — three words
asking whether `node` exists — which is why a machine without one greets with
`[Setup: blocked — node]` rather than with silence. That hook is the single
deliberate exception to the project's rule that tooling is written in Node, not
bash: it starts no process, finds no process, and is the one check that cannot
be written in the language it is checking for. The config files it lives in are
JSON and cannot hold a comment, which is why the reason is written down here.

**And why the precondition is hard rather than a courtesy.** A machine without
Node does not stop an app from coming into being — every file of it can be
written — and it gives way at the first command that runs any of it. The failure
arrives after the work, not before it, which is the whole reason `CLAUDE.md`
asks for one answered `node` command before the first file is written rather
than for a check somewhere later.

Three of the four hook mechanisms are young, and two of them have open bugs
where the hook silently stops firing. That is what `node run.mjs greet` is for:
it prints the same greeting on demand. If no greeting appeared, run it —
silence is never the same as "fine".


## `[Operations: …]` — every sentence it can say

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
