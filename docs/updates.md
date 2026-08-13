<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Keeping the guidance up to date

This app is a **copy** of a template that is still being worked on. The code is
yours from the moment you cloned it — nobody changes it behind your back. The
*guidance* is a different matter, and that is what this page is about.

## Why this exists

You build this app with an AI agent, and the agent knows what the text in this
project tells it: the guidance file on every session — `CLAUDE.md` or `AGENTS.md`,
depending on which program you use, and they are the same file under two
names — plus `docs/` and `.claude/skills/` when something points at them. Those files are the reason it uses `hasPlan()`
instead of reading a billing table, reaches for `<Callout>` instead of picking
colours, and runs `setup-digistore` instead of inventing a checkout.

A copy of them from six months ago is how an agent confidently rebuilds by hand
a feature that has been in the template for months — and does it worse, because
the version in the template has been through a security gateway and yours has
not.

So there is one command:

```bash
node run.mjs update           # what would change — nothing is written
node run.mjs update --apply   # write it
```

For a person at the terminal there is also the guided form,
`node run.mjs update-agents`: it shows the same plan, asks `[y/N]`, and writes
only on an explicit yes. It is the two commands above folded into one sitting —
nothing more. Without a terminal to ask on (a pipe, a CI step) it refuses
rather than deciding by itself.

## What it touches, and what it never touches

| | |
|---|---|
| **Updated** | `CLAUDE.md` and `AGENTS.md`, `README.md`, `docs/*.md`, `.claude/skills/**` |
| **Never touched** | everything under `app/`, `lib/`, `db/`, `components/`, `config/`, `messages/`, `scripts/` — all of your code, and every setting |
| **Never touched** | `docs/app.md`, `docs/product-brief.md`, `docs/reports/` — your own writing |
| **Never touched** | any of the files above **that you edited yourself** (see below) |

Text only, and the reason is simple: a doc cannot collide with the page you built
last week, a `lib/` file can. **A code update is a separate, deliberate step** —
if you want one, fetch the current template into a second folder and compare.

## A file you changed is yours

`.template-version` records the hash every guidance file had **when this app was
created**. That is the whole safety mechanism:

- the file still matches its hash → nobody here touched it → it is replaced
- the file differs → somebody wrote something into it → **it is left alone**, and
  `update` says so

So if you added your own rules to `CLAUDE.md` — house style, a decision you keep
having to repeat, a warning about your own domain — they stay. `update` will
report that file as `keep` for ever, and if you want the new version you read it
in the template repo and merge the part you want by hand.

🚨 **Do not "fix" that by overwriting them anyway.** A `keep` is not a failure the
update is asking to be helped past — it is the mechanism doing its job, and a
house rule silently replaced by the template's wording is the one loss this
channel was built to make impossible.

## Where the files come from

From the public repo this app was cloned out of:

<https://github.com/digistore24/ds24-appkit>

Nothing is published anywhere else and there is no second copy to keep in sync:
the manifest is that repo's own `.template-version`, and the files are the files.
Whatever a `git clone` would hand somebody today is exactly what `update` reads —
so the two cannot drift apart, and you can always look at any of it in a browser
before you let it near your app.

Two more refusals, both deliberate:

- **A skill that needs newer code is not installed.** Skills may declare
  `requires:` in their frontmatter. A description of a feature whose code is not
  in your copy is worse than no description: the agent would explain it to you and
  then fail to find a line of it.
- **Nothing is ever deleted.** A skill the template withdrew is reported and
  stays. It may be the one you built your week on.

Everything `--apply` writes is a normal file change in git:

```bash
git diff          # read exactly what changed
git checkout .    # throw it all away again
```

## The line in the greeting

The session greeting (`scripts/dev/update-check.mjs`) checks **once a day**
whether there is anything newer, and
says one line when there is. That check is the only part of this app that talks
to anybody, so, plainly:

- it is **one GET** of one public file on GitHub —
  `raw.githubusercontent.com/digistore24/ds24-appkit/main/.template-version`
- it sends **no query string, no body, no identifier** — nothing about you, your
  app, your customers or your machine. It does not reach a server of ours at all:
  GitHub sees an IP fetch a public file, exactly as a browser would
- the answer is cached in `.dev/` for 24 hours, so twenty sessions cost one
  request
- it never blocks and never fails: no network, no answer, no line

Switch it off in your `.env`:

```dotenv
TEMPLATE_UPDATE_CHECK=off
```

Then nothing is fetched at all, and `node run.mjs update` still works whenever
you run it yourself.

## For the agent

Do not run `--apply` on your own initiative. Show the user what would change, say
in one sentence what the improved skills are about, and let them decide. The
exception is the one they asked for: "update the template" means run it.
