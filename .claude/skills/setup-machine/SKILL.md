---
name: setup-machine
description: Gets this machine ready to develop the app — checks what is missing (Node, git, optionally Docker and cloudflared), installs it after asking, and prepares the project — Linux, macOS and Windows alike. Use this on the first run in a fresh clone, whenever the session start reports `setup=blocked`, and whenever a command fails with something like "node: command not found", "docker: not found", "npm not found", "the database does not answer" or "cannot connect". Also use it when there is NO session greeting at all, or a startup hook error mentioning `node` — that is a machine without Node, and this skill installs it.
requires: 0.20.0
---
<!-- requires: raised from 0.2.0 when Gemini CLI was replaced by Antigravity CLI.
     Step 5b names `--agent antigravity`, and that value lives in
     scripts/dev/agent-configs.mjs — which is CODE, and `node run.mjs update`
     ships text only. Without this line an app from before the change would take
     the new instructions and run a flag its own copy does not have, failing with
     "Unknown program". Refused is the right answer there: it keeps the old text,
     which matches the old code. -->
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Getting this machine ready

The app runs on Linux, macOS and Windows. What has to be installed is short —
**Node.js and git**, plus optionally Docker and cloudflared — and **you** put it
there together with the user, rather than handing them a list. Docker is not on
the required list: where it is missing, the database runs without it (step 4).

**Do not do this before every task.** If the check comes back clean, say so in
one sentence and carry on with what the user actually asked for. A setup
walkthrough for somebody whose machine is already fine is pure noise.

## Where the commands come from — the one rule

Everything you need to know about this machine, you get from:

```bash
node run.mjs doctor --json
```

That is the **only** source of install commands. Never type one out of your own
knowledge, never adapt one from another project, never pipe a script off the
internet into a shell. `scripts/dev/fixes.json` holds the table for all three
systems and `scripts/dev/doctor.mjs` reads it; this file deliberately holds
none, so there is nothing here that can go out of date. If a fix is missing from
the JSON, that is a bug in `fixes.json` — fix it there, do not work around it
here.

**There is exactly one exception, and it is step 0 below**: on a machine with no
Node, `doctor` cannot run, because it is a Node program itself. Then you read
`scripts/dev/fixes.json` with your file tool instead. That is the same table —
you are still reading it rather than knowing it, which is the whole point of the
rule.

The JSON gives you, per check:

| Field | What you do with it |
|---|---|
| `ok` | `false` = something to handle |
| `severity` | `blocker` = must be solved · `optional` = offer it · `info` = mention at most |
| `detail` | why it is not ok — say this to the user |
| `fix.command` | the exact command for **this** machine |
| `fix.url` | a page to install from, when there is no command |
| `fix.admin` | needs sudo/Administrator → **the user runs it, not you** |
| `fix.gui` | an installer with a window → **the user clicks, not you** |
| `fix.restart` | the machine has to be restarted afterwards |
| `fix.note` | an extra step that goes with it — pass it on, it is there for a reason |

## The walkthrough

### 0. Is there a Node here at all?

```bash
node --version
```

An answer → skip straight to step 1, this step is not for you. **Most machines
answer.**

No answer — "command not found", "not recognized" — then this is the one case
the rest of this file cannot handle, because every command in it starts with
`node`. It is also the normal state of a machine somebody just installed Claude
Code and git on, so treat it as a starting point and not as a fault:

1. Read `scripts/dev/fixes.json` with your file tool.
2. Take `fixes` → `node` → the entry for this system (`linux`, `darwin` for
   macOS, `win32` for Windows).
3. Hand it over by the flags exactly as in step 3 below. On all three systems
   this one is `admin` or `gui`, so **the user installs it, not you** — say what
   it is, why it is needed, and wait.
4. `node --version` again. Then start at step 1.

Two things worth saying out loud while you wait, because both cost people an
hour otherwise:

- **A new terminal is needed afterwards.** The installer puts Node on the PATH,
  and a shell that was already open does not have it. In Claude Code that means
  the session has to be restarted.
- On **macOS** the `.pkg` from nodejs.org is the whole job — there is no
  Homebrew to install first, and you should not suggest one.

### 1. Look

Run `node run.mjs doctor --json` and read it. `"ok": true` at the top level means
nothing is blocking.

### 2. Nothing missing?

Say it in one sentence, run `node run.mjs setup`, and hand over to **`build-app`**
(or carry on with whatever the user came for). Stop here.

### 3. Something missing — one at a time

Work through the `blocker` checks in the order they arrive. For each one, tell
the user in one sentence *what* is missing and *why it matters*, then act by the
flags:

- **Neither `admin` nor `gui`** → ask "shall I install it?", and on a yes run
  `fix.command` yourself with your Bash tool.
- **`admin: true`** → you cannot answer a password prompt. Give the user the
  command and ask them to run it — in Claude Code they can type `!` followed by
  the command and the output lands right here in the conversation.
- **`gui: true`** (Docker Desktop, Xcode Command Line Tools) → a person has to
  click through it. Give them `fix.command` or `fix.url`, say what the installer
  will ask, and wait.
- **`restart: true`** → say up front that the machine needs a restart, so nobody
  is surprised mid-way. After the restart the session starts over — that is
  normal, and this skill picks up where it left off.
- **A `note`** always gets passed on. `sudo usermod -aG docker $USER` followed by
  a re-login is not an optional detail: without it every docker command fails
  with a permission error that looks like a broken installation.

**After every step, run `doctor --json` again.** Never assume an install worked
because the command exited 0 — Docker Desktop in particular installs fine and
then is not running.

### 4. Docker is not a blocker — and there is nothing to decide

Docker used to be the biggest hurdle here, on Windows by a distance: Docker
Desktop, WSL2, a restart. It is not one any more, and **you do not offer a
choice about it.** On the first start the project looks at the machine
(`scripts/db/driver.mjs`): a Docker that answers is used, and where there is
none, Postgres comes from an npm package instead — the real PostgreSQL 16, so
`DATABASE_URL`, the migrations and every command behave identically. The answer
is written into `.env` as `DB_DRIVER`, once, and stays put.

So `docker` arrives as `severity: "optional"`, and you treat it like every other
optional check: mention it at most, never install it unasked, and never make the
user wait for it. What you say when it is missing is one sentence, and it is
good news:

> "There is no Docker on this machine — the app brings its own Postgres, so
> there is nothing to install. Your local setup then deviates slightly from what
> runs on the server later, and that is the only difference."

Install Docker only when the user asks for it themselves. Two things not to do:
do not talk somebody with a working Docker into the other way round (there is
nothing to gain and a difference to production to lose), and **never change
`DB_DRIVER` on a project that already has data** — the other database starts
empty, and to the user that reads as "the app forgot everything".

### 5. Prepare the project

```bash
node run.mjs setup
```

That is `.env` (including a generated `AUTH_SECRET`), the dependencies, the
database and the pending migrations, in one go.

### 5b. Which program is this?

This app ships wired for four — Claude Code, Codex CLI, Antigravity CLI and
OpenCode — so that it works whichever one it was opened in. Now that somebody is
actually working here, take the other three out:

```bash
node run.mjs agent-setup --agent claude|codex|antigravity|opencode --apply
```

**You know which one you are, so say it** — do not leave it to detection. The
command reads environment variables when nobody tells it, which is a convenience
and not a mechanism: it cannot distinguish reliably, and a wrong guess removes
the wiring somebody is using. **In Antigravity CLI it cannot guess at all** —
that program sets no environment variable of its own — so there the flag is the
only way and the command will refuse without it.

Nothing is lost either way. The skills, the guidance and the greeting are shared
and stay; only the other programs' config goes, and `--agent <other>` or `--undo`
puts it back. Mention it in half a sentence — it is housekeeping, not a decision
the user has to make.

⚠️ **If you are Antigravity CLI, one thing is not housekeeping**: that program
has no session-start event, so nothing greeted you and nothing will. Run
`node run.mjs greet` yourself before writing any file — it prints the
`[Setup: …]` line the rest of this skill turns on.

### 6. Prove it

```bash
node run.mjs start
node run.mjs smoke
```

A green check is not proof — a loaded page is. `smoke` calls every page and
reports server errors; see `CLAUDE.md` → *Never ship a broken page*. Only after
this do you say the machine is ready.

If `smoke` reports a 5xx, look at `node run.mjs logs` for the real stack trace.

A `307` to `/login` is correct, not an error: those pages are protected. `smoke`
then calls them a second time signed in as the owner — and on a machine that has
just been set up it usually cannot, because there is no `owner` account yet. It
says so in one line with the reason, and that is a normal state here, not a
finding.

**There is nothing to create for it.** The first account in a fresh app becomes
`owner` by itself in DEV (`lib/users/bootstrap.ts`) — the user signs in at
http://localhost:3000/login with any address and that is the admin. Say that,
rather than asking them for an address.

**Unless the greeting says `[Machine: no browser here]`.** Then that address is
theirs, not this machine's, and sending them to it sends them nowhere — they
open it and find nothing running. What to say instead is
[`docs/machine.md`](../../../docs/machine.md); the first account still makes
itself, it just cannot be made from a screen nobody is sitting at yet. Only if you need the signed-in pass
*before* anybody has signed in once is there a command, because
`scripts/dev/sign-in.mjs` deliberately creates no account:
`node run.mjs user-create --email … --role owner --apply`.

### 7. Hand over

Say in one sentence what changed, and start **`build-app`** — or carry on with
what the user originally wanted.

## What you never do

- **Never disable a check to get past it.** A skipped check is a failure moved
  to a later, more confusing moment.
- **Never edit `.env` by hand.** `setEnvValue()` in `scripts/lib/env-write.mjs`
  is the single writer; hand-editing loses comments and duplicates keys.
- **Never install anything the JSON did not name.** No global npm packages, no
  version managers, no "while we're at it". This is somebody's machine.
- **Never install a package manager to install something else with.** On macOS
  that is Homebrew and the temptation is real, because most instructions on the
  internet start there. The JSON already names a way that does not need it, and
  where Homebrew *is* present the JSON hands you the Homebrew command by itself
  — so there is never a reason to add one. Installing it uninvited costs the
  user a long download, a password prompt and a PATH they have to fix by hand.
- **Never change `DATABASE_URL`, `DB_PORT` or `APP_URL` to make something fit.**
  Occupied ports resolve themselves (`node run.mjs start` steps to the next free
  one and writes it down). A hand-picked port that disagrees with the running
  database is the one failure mode nobody finds afterwards.
- **Never claim it works without having run `smoke`.**

## Three things that surprise people

- **`doctor` can only ever report Node as "too old", never as "missing".** If
  Node were absent, `run.mjs` could not have run at all — the check would not
  exist to fail. That is not a gap in the report, it is the shape of the
  problem, and step 0 is where it is handled.
- **Claude Code does not need Node, so a machine can very well have one and not
  the other.** It ships as its own program. What the *app* needs is Node, and
  the normal first run is exactly this: Claude Code and git installed by hand,
  everything after that installed here.
- **On Windows the commands belong in Git Bash or WSL2**, not in PowerShell or
  cmd. The `shell` check says so when it applies. Git Bash comes with Git for
  Windows, which Claude Code needs there regardless.
