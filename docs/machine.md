<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The machine this runs on — and whether you are at it

Everything else in `docs/` describes the app. This one describes the place it is
being built, because two questions there change what may be promised. The first
is *whether the person is at that machine* and runs to
*Which one to build in*; the second is *which of the three operating systems it
is* and runs from *Three systems* to the end.

> **Is the person reading this sitting at the screen this code runs on?**

Most of the time, yes — a laptop, a terminal or a desktop app, the app at
`http://localhost:3000`, a browser that opens when something asks it to. All of
the guidance is written for that case, and where it holds, nothing here applies.

Where it does not hold, three promises quietly stop being true, and none of them
fails loudly.

## How you know

The session greeting says it, and **only when the answer is no**:

```
[Machine: no browser here — hand the user links, and see docs/machine.md …]
```

`node run.mjs doctor` carries the same thing as the check `browser`, severity
`info` — never a blocker, because there is nothing to install. It is not a fact
about software; it is a fact about where the person is.

The measurement is deliberately narrow: **can a browser be opened here.** That
is the one thing observable from inside the process, and it is a good proxy —
a machine with no screen is a machine nobody is watching. It is recorded in
`.dev/setup-ok.json` alongside the platform, so the same project folder opened
somewhere else does not inherit the answer.

## What changes when the answer is no

### 1. A link is something you hand over, not something you open

`node run.mjs ds24-connect` prints the Digistore24 approval address and waits for
somebody to confirm it. Where no browser opens, **that link is the entire path**:
give it to the user, ask them to open it, and say that nothing continues until
they have. The script now says so itself rather than claiming a window appeared.

The same applies to the hosting logins in `setup-hosting` — and there is a way
round those: see [`DEPLOY.md`](DEPLOY.md) for `RAILWAY_TOKEN`, `FLY_API_TOKEN`
and DigitalOcean's access token, which need no browser at all.

If the API key cannot be fetched that way either, there is a path that needs
neither browser nor terminal — the user creates the key themselves and it is
passed straight in:

```bash
node run.mjs ds24-connect --manual --key <the key they created>
```

### 2. `localhost` is this machine's, not theirs

Every sentence in the guidance that says *"open http://localhost:3000"* assumes
one computer. Where the code runs somewhere else, that address on the user's
machine reaches **their** computer and finds nothing.

So do not send them there. Say what you checked and what you saw
(`node run.mjs smoke`, `node run.mjs errors`), and if the surroundings offer a
preview of a running app, use that. The honest sentence is *"I cannot show it to
you from here yet"* — followed by the plan to put it somewhere they can reach,
which is the skill `setup-hosting`.

The one that is not a matter of wording: **`node run.mjs ds24-tunnel` publishes
the machine it runs on.** Where that is not the machine the person is at, the
tunnel is still correct — the IPN reaches the running app — but it is worth
knowing what has just been put on the public internet.

### 3. Their work is somewhere else, and it has to travel

On one machine, a commit is simply there. Where the code lives elsewhere, the
user gets it back over whatever their surroundings use for it — commonly a
**branch** and a **pull request**: a copy of the changes, waiting for them to
accept it.

Both are worth one plain sentence when they first appear, because they are
usually the first two pieces of version-control vocabulary somebody meets:

> "I have put the changes on a **branch** — a separate line of the project, so
> nothing is overwritten while you look. To bring them into your copy, accept
> the **pull request** (the request to pull those changes in). Nothing is lost
> either way; if you would rather change something first, say so."

Never present it as a step they should already understand.

## Which one to build in, if somebody asks

For a developer, all of them work. For somebody who is not one, the difference
is not convenience but **how a problem announces itself**:

| | on this machine | somewhere else |
|---|---|---|
| Node, database, tooling | has to be installed — but `doctor` says so plainly and `setup-machine` does it | usually already there |
| Seeing your own app | `http://localhost:3000`, in your own browser | only what the surroundings offer |
| Approving at Digistore24 | the browser opens | a link you pass on |
| Getting your work back | it is already on your disk | over a branch, and somebody has to explain that |
| When something is missing | it stops, and names the skill that fixes it | it quietly does not happen |

**So: build on the machine the person is sitting at, where there is a choice.**
The installation is the one hurdle, it is the loud kind, and `setup-machine`
exists for exactly it. Everything the other way round is quiet — and quiet is
what nobody can debug.

---

# Three systems

**This app has to run on Linux, macOS and Windows.** Claude Code, Codex,
Antigravity and OpenCode all run on all three, so all three are places where
somebody builds on this template — a developer on Windows who cannot start it has
no way around it. That makes portability a property of the product, not a
nice-to-have, and the rest of this page is the shape it takes.

## What has to be installed

**Node.js ≥ 20** (with npm) and **git** — nothing else. **Docker** is used for
Postgres where it exists and is not required where it does not (see below);
**cloudflared** is only for receiving Digistore24 IPNs on your own machine.

**A person installs exactly one of those by hand: git** (plus the AI program
itself); everything after that — Node included — is installed *here*, by the
agent, through `setup-machine`, because the alternative is a checklist on a web
page, and a checklist is where non-developers stop.

```
a person:   the AI program · git · git clone · start it in the folder
the agent:  Node · dependencies · database · migrations · .env
```

**Windows in practice means Git Bash or WSL2.** A native PowerShell is not a
target — Claude Code needs Git for Windows there anyway, so `bash` may be
assumed. Git Bash is the narrower of the two: write for it and both work.

## Where the install commands live

**In exactly one place: `scripts/dev/fixes.json`**, read by
`scripts/dev/doctor.mjs`. A repeated list drifts, always for the system nobody
here runs — and it is JSON rather than code, because a machine with no Node
cannot run `doctor` yet `setup-machine` can still *read* the table in its step 0.

What do I need → `node run.mjs doctor`; something missing → the skill
`setup-machine`; a command changes → `fixes.json` and nowhere else.
`scripts/setup.test.ts` fails if an entry loses one of the three systems, or if
the skill carries install commands of its own.

**macOS does not go through Homebrew.** The `darwin` entries name the way that
works on a Mac as it comes; `darwinFix()` in `doctor.mjs` upgrades them to
`brew install …` at runtime *when brew is already there*. Never turn that around
— a table that assumes brew hands `brew: command not found` to most Mac users.

## Docker where it is, Postgres where it is not

**Docker is used where it is, and replaced where it is not — nobody is asked.**
The first start looks at the machine (`scripts/db/driver.mjs`): a Docker that
*answers* — the daemon, not the PATH — gives `DB_DRIVER=docker`, anything else
gives `DB_DRIVER=local` and Postgres from an npm package
(`scripts/db/local.mjs`) — real Postgres 16, same wire protocol, so
`DATABASE_URL`, `db/index.ts`, `drizzle/` and every script stay untouched
([`database.md`](database.md)).

Three properties are load-bearing:

- **It happens once and is written into `.env`** — a Docker Desktop that did not
  start looks exactly like a machine that never had one, and deciding afresh
  would point an existing project at a second, empty database.
- **Existing data outranks the machine.** A `.dev/pgdata` keeps running without
  Docker, even once Docker turns up.
- **A written-down value is obeyed and never overwritten**, and an unknown one
  throws instead of quietly starting the wrong database
  (`scripts/db/driver.test.ts`).

**Never present Docker as a prerequisite**, and never change `DB_DRIVER` on a
project that already holds data — whoever explicitly wants the other way round
changes the line by hand while the database is still empty.

## The traps

They are always the same, and all of them are in the tooling, never in the app
code:

| Don't | Because | Instead |
|---|---|---|
| `make` | absent on Windows, needs the Xcode CLT on macOS | a task in `run.mjs` |
| `lsof`, `ss`, `netstat` | not installed everywhere; `lsof` hides other users' sockets | `portInUse()` from `scripts/dev/ports.mjs` (a TCP connect) |
| `pgrep`, `pkill`, `ps -o pgid=` | missing or crippled outside Linux | remember the PID yourself in `.dev/`, then `process.kill(pid)` |
| `kill -TERM -$PGID` (process group) | POSIX process groups do not exist on Windows | kill the remembered PID; spawn children detached |
| `setsid`, `nohup` | Linux only | `spawn(…, { detached: true }).unref()` in Node |
| `sed -i`, `mktemp` | GNU wants no argument, BSD/macOS wants one | `setEnvValue()` from `scripts/lib/env-write.mjs` |
| `curl`, `wget` | not guaranteed, and flags differ | `fetch()` — Node has it built in |
| `openssl` | not everywhere, LibreSSL on macOS | `node:crypto` |
| `date +%s%N`, `readlink -f`, `realpath` | GNU-only flags | Node (`Date.now()`, `path.resolve`) |
| `split("\n")` on a file from disk | on Windows every line ends on `\r` | `split(/\r?\n/)` — see *Line endings* below |

**No `make` at all**, therefore: commands run through `node run.mjs <command>`.
The `Makefile` is only an alias; never point the user at it.

**The rule of thumb that settles most cases: anything that starts, stops or finds
a process belongs in a `.mjs` script, not in bash.** Node is guaranteed present
— it is a Next.js app — and `child_process.spawn`, `process.kill` and `fs`
behave the same on all three systems, while every shell tool above does not.

**Exactly one exception — the question the rule cannot answer: is there a Node
here at all?** The `SessionStart` guard in `.claude/settings.json` asks it
in shell, because a Node program that is not there cannot report its own
absence. It is written `if ! command -v node …; then echo …; fi` — not `||` — on
purpose: a shell that does not understand it prints **nothing**, where `||`
would print a false warning. Silence is the safe failure here; a false alarm is
not. ([`troubleshooting.md`](troubleshooting.md) → *No greeting appeared* is the
same story from the symptom's end.)

**Ask the thing, not the process table.** Whether a service is alive is answered
by a TCP connect or an HTTP GET, never by hunting in `ps` — portable by
construction, survives a recycled PID, and answers "does it respond?" instead of
a proxy for it. `scripts/dev/ports.mjs` is written that way.

`scripts/portability.test.ts` scans `run.mjs` and `scripts/` for the tools in the
table above and fails the run when one shows up — it is the reason this does not
quietly rot back into a Linux-only project. Don't switch it off.

## Two spawn rules

Both are written out at the top of `run.mjs`:

- **Spawning `npm` needs a shell** — it is a `.cmd` shim on Windows, and Node
  refuses those without one since 18.20/20.12 (`EINVAL`). Our own scripts start
  as `spawn(process.execPath, ["scripts/…mjs", …args])` — no shell, so user
  arguments cannot be mangled; `docker`, `git`, `cloudflared` need neither.
- 🚨 **Never pass a `shell` option yourself — that decision belongs to
  `scripts/lib/proc.mjs`**, and `scripts/portability.test.ts` fails the build on
  a second one: `shell: true` beside an args array escapes nothing (Node 24's
  `DEP0190`); `spawnCommand()` starts `cmd.exe` only where the resolved file
  really is a `.cmd`/`.bat`, with every argument quoted, and `openUrl()` lives
  there too — opening a URL is the one case with no way around a shell.

## Line endings — LF, on all three systems

Git for Windows defaults to `core.autocrlf=true` and checks text files out with
**CRLF**, which used to break two things silently:

- **Every `.env` key read back "not set"** — a `$`-anchored pattern never matches
  a line ending in `\r` — so a fresh `AUTH_SECRET` was minted on every run,
  signing everybody out.
- **`node run.mjs update` did nothing, for ever**: the `.template-version` hashes
  are taken over LF content, so every guidance file looked "edited in this app".

**`.gitattributes` decides this, not the machine's git config** — one line,
`* text=auto eol=lf`, and all three systems see the same bytes.
`scripts/portability.test.ts` asserts it is there and that no file in the project
carries `\r\n`.

Two rules follow for anything you write:

- 🚨 **Split a file on `/\r?\n/`, never on `"\n"`.** The `.env` matters most — it
  is gitignored, so `.gitattributes` never sees it; go through `setEnvValue()` /
  `readEnvValue()` (`scripts/lib/env-write.mjs`, `scripts/lib/env.mjs`) rather
  than parsing `.env` again somewhere else.
- 🚨 **Normalise before hashing** — `normalizeText()` from
  `scripts/dev/update-plan.mjs`; on Windows it is the difference between an
  update that works and one that silently refuses.
