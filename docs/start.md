<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Start here

**Version 2 · 2026-07-28** — say which version you are following if anything below
goes wrong; it makes the answer findable.

You are reading this because somebody pasted a prompt into you that said *"read
https://ds24-appkit.com/start.md and follow it"*. They want to build a SaaS
product they can sell — software with accounts, a paid area, and a purchase that
unlocks it — and they want to bill it through **Digistore24**.

There is a finished template for exactly that: **ds24-appkit**. Sign-in, user
management, roles, the Digistore24 billing with its signed webhook, plans,
subscriptions, prepaid tokens, an optional in-app AI assistant — all built and
tested. Your job is not to build any of that. Your job is to get them into it,
and then get out of the way.

**Follow this file to the end of one branch, then stop reading it.** Everything
past that point is written down inside the project itself, and it is written
better there because it can be kept current with the code. Nothing about how the
app works belongs here.

---

## Step 1 — work out what you are

Do not guess this. Ask if you are unsure.

**Can you run commands on this person's computer and write files to it?**

- **Yes** — you are a coding agent in a terminal: Claude Code, OpenAI Codex CLI,
  Antigravity CLI, OpenCode, the Code tab of the Claude desktop app, or something
  similar. → **Branch A**.
- **No** — you are a chat: claude.ai, ChatGPT, Gemini in a browser, or an
  assistant in some other app. You can read and write text and nothing else. →
  **Branch B**.

Say which one you concluded, in one line, before you continue. If you get this
wrong the person will follow instructions that cannot work.

**And read "this person's computer" literally, because for several of the
programs above it is a setting rather than a fact.** The same desktop app can
put you on their machine or in a cloud session on a different one; so can a
terminal over SSH. You are still Branch A either way — you have a shell and you
can write files — but a second thing is then also true, and it is the one that
catches people out: **they cannot see what you can see.** No browser opens where
you are, `http://localhost:3000` on their computer is not the app you started,
and your work reaches them only once it travels. Say which of the two it is,
in the same line, and once the project exists read
[`machine.md`](machine.md) — it is written for exactly this.

---

## Branch A — you have a terminal

### A1. Check the two tools

```bash
node --version    # needs to be 20 or higher
git --version
```

If both answer, skip to **A2**.

If something is missing, install it. These commands are the ones the project
itself uses — do not substitute your own:

| | Linux | macOS | Windows |
|---|---|---|---|
| **Node.js** | download from https://nodejs.org | download from https://nodejs.org | `winget install OpenJS.NodeJS` |
| **git** | https://git-scm.com/downloads | `xcode-select --install` | `winget install Git.Git` |

Three things that catch people out, every time:

- **Do not install Node from a Linux distribution's package manager.** No `apt
  install nodejs`, no `dnf`, no `pacman`. Those are regularly older than 20 and
  the app will fail in ways that look like bugs. Use nodejs.org. (`brew install
  node` on a Mac that already has Homebrew is fine.)
- **On macOS and Windows, open a NEW terminal after installing Node.** The `PATH`
  is only set in a new one. Otherwise `node --version` says "command not found"
  and it looks like the install failed.
- **`xcode-select --install` is not the full Xcode.** It opens a window, they
  click once, and git comes with it.

On Windows, work in **Git Bash** (it comes with git) or WSL2 — not PowerShell.

### A2. Get the project — as **their** repository, not ours

**Do not `git clone https://github.com/digistore24/ds24-appkit`.** That is the
step to get right, and it is the one that gets skipped, because cloning looks
like the obvious move and fails silently: the copy points at a repository they
cannot write to, so the first `git push` is refused and everything they build
lives on one machine, with no history anywhere else. This is not a repository to
contribute to — it is a starting point to take a copy of.

`ds24-appkit` is a **GitHub template repository**, so taking that copy is one
step. What they get is a repository of their own, with the same files and no
shared history. Nothing in the project needs a link back to ours, so a copy made
this way loses nothing.

Ask first what the repository should be called and whether it may be public.
**Private is the right default** — it is their product.

**If `gh` is there and signed in, do it yourself.** Check, do not assume:

```bash
gh auth status
```

Answers "Logged in" → one command, and it clones as well:

```bash
gh repo create my-app --template digistore24/ds24-appkit --private --clone
cd my-app
```

**Otherwise the person does it in the browser.** It is three clicks and no
install — do not install `gh` for this, and do not run `gh auth login` for them
(it opens a browser and wants a code typed in; they are the one at the screen).
Tell them:

1. open https://github.com/digistore24/ds24-appkit
2. press the green **"Use this template"** → **"Create a new repository"**
3. give it a name, choose **Private**, **"Create repository"**
4. copy the address of the new repository and paste it back to you

Then you clone *that* one:

```bash
git clone https://github.com/<them>/<their-app>
cd <their-app>
```

**Only if they have no GitHub account and do not want one**, clone ours after
all — and say the sentence that goes with it, once, plainly: this copy has no
repository behind it, so their work exists only on this computer, and a
disk that dies takes the product with it. It is repaired later with
`git remote set-url origin <their new repo>`, nothing has to be rebuilt.

```bash
git clone https://github.com/digistore24/ds24-appkit
cd ds24-appkit
```

### A3. Restart yourself inside the folder

**This is the step that goes wrong most often.** Your session has to be running
*in* the project folder — the one with `package.json` in it, whatever they named
their repository. Started one level up, you will not find the project's guidance
or its skills, and everything after this will feel oddly empty.

So: end this session, and start again in that folder — `claude`, `codex`,
`agy` or `opencode`, whichever you are.

### A4. Hand over

From here the project speaks for itself. In the new session:

1. Read `AGENTS.md` (or `CLAUDE.md` — same file, two names) in full. It is the
   rulebook, and it is long on purpose.
2. If no greeting appeared when you started, run `node run.mjs greet`. It says
   whether this machine is ready to build on. Silence is not the same as "fine".
3. Then just tell the user to say **"Build my app"** — or say it for them if they
   already told you what they want to build.

**Do not come back to this file.** It knows how to get the project; the project
knows everything else.

---

## Branch B — you are a chat without a machine

Be straight about this in your first sentence: you cannot install anything, clone
anything or run anything. Pretending otherwise wastes their afternoon.

What you *can* do is the part that has to happen anyway and is genuinely better
in a conversation. Do these two things, in this order.

### B1. Sharpen the product idea

Most people arrive with either a vague idea or none. Interview them — properly,
one question at a time, not a questionnaire:

- What do they already know or do that other people pay for?
- Who specifically has that problem? Not "small businesses" — which ones?
- What would the software actually *do* for that person, in a sentence?
- What is the smallest version that is still worth paying for?
- Who is already listening to them — a list, an audience, clients, a following?

Then write it up as a short **product brief**: the audience, the problem, what
the app does, what someone gets when they pay, and what the first version leaves
out. Half a page. Tell them to save it — they will paste it into the project
later as `docs/product-brief.md`, and the build starts from it.

If they have no idea at all and no appetite to find one right now, say so kindly
and stop. The template cannot help someone who has nothing to sell yet.

### B2. Hand them the next prompt

They need a coding agent on a real computer. The template works with **Claude
Code, OpenAI Codex CLI, Antigravity CLI and OpenCode** — if they already use one,
that is the one. If they use none, Claude Code is the one the project's
walkthroughs are written against: https://claude.com/download

Give them this to copy, and tell them to paste it into that program once it is
running:

```
Read https://ds24-appkit.com/start.md and follow it.
Here is my product brief:

<paste the brief here>
```

That is the whole handover. The next program reads this same file, takes Branch A,
and gets them into the project.

---

## What this file is not

It is a doorway, and it stays a doorway. It does not describe the data model, the
billing, the skills, the commands, or how anything in the app works — all of that
lives in the project and changes with it. A copy of it here would be wrong within
a month, and wrong on a web page is worse than absent.
