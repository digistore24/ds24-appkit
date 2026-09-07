<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The machine this runs on — and whether you are at it

Everything else in `docs/` describes the app. This one describes the place it is
being built, because two questions there change what may be promised. The first
is *whether the person is at that machine* and runs to
*Which one to build in*; the second is *which of the three operating systems it
is* — that one is its own page, [`portability.md`](portability.md).

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

### What it does NOT say: whether the agent can open a page

That line is about the person. The agent's browser is a different thing — a
tool inside its own program, headless, and it works on exactly the machines the
line above says no about. It is not there by default: measured over five field
runs, an agent without one asks the user to open the page and look, every time.
`node run.mjs agent-browser` says whether this app is wired for it, and
`--apply` adds Playwright's MCP server to whichever program this app is set up
for and fetches Chromium (~150 MB) — after asking, because it is the user's own
setup that changes. `node run.mjs doctor` carries it as the check
`agent-browser`, severity `info`. The tools appear in the next session.

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

## Three systems — moved

Which of the three operating systems this is, what has to be installed on each,
the shell tools that are not portable and the line-ending rule:
[`portability.md`](portability.md).
