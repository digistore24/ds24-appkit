---
name: coach
description: The guide through the project — works out where this app stands and which skill comes next, and routes a concrete problem to the place that solves it. Use this when the user asks "what is the next step?", "how do I solve XY?", "where am I?", "which skill do I need?", "I am stuck", or when they describe a symptom (an error page, a purchase that never arrived, the assistant answering "I do not know") without naming a skill.
requires: 0.26.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The coach — which step, which skill, which command

This app is built in steps, each with a skill behind it. This skill **finds the
right one** and builds nothing itself. It answers two questions and nothing
else; their triggers are disjoint, so read one file below and never both:

| The question | What answers it |
|---|---|
| **"What is the next step?"**, "where am I?" | `node run.mjs journey --json` **first**, then [`references/where-am-i.md`](references/where-am-i.md) for the handful of things no command can read |
| **"How do I solve XY?"** — a symptom | [`references/symptoms.md`](references/symptoms.md), the symptom table. Read it when a symptom arrives, and not before |

## 1. Where the project stands is a command

**Run `node run.mjs journey --json` before you say anything.** The path — the
steps, their order, the phase each belongs to and what proves each one done — is
DATA, in `scripts/dev/journey.mjs`, and that file is the original every other
telling of it answers to — `CLAUDE.md`, `README.md`, the greeting's
`[Journey: …]` line. So this skill reads it through the command instead of
walking the disk. **A list kept in four places is a list that is wrong in three
of them** — this skill was the fourth copy, and now it is not a copy at all.

Per row: `state` (`done`, `open`, `declined`, `stale`, `blocked`,
`needs-newer-template`, `unknown`), `evidence` — what was looked at — and
`performedBy`. `next` is the ONE row to name; `nextSentence` is already written.
Two of those states are answers rather than absences: **`declined`** is a
recorded "no" — say so and move on — and **`needs-newer-template`** is code
this copy does not have, so the step is `node run.mjs update`, never the skill.

**The user does not always know where they are; the project does.** What the
command cannot read is judgement — a thin brief, a placeholder page with swapped
texts, a report older than the last big change, a fork needing one question. That
is [`references/where-am-i.md`](references/where-am-i.md), read when the
journey's answer needs weighing rather than every time.

## 2. "What is the next step?"

Name **one**. Not the remaining list, not a plan for the afternoon — the single
thing that comes next, in one or two sentences, plus what it will do. Then offer
to start it right away, and start it if the user says yes.

Two things this gets wrong if you let it:

- **The next step is not always the next row in the table.** Somebody who has
  just built three pages usually wants a fourth, not `setup-digistore`. Read what
  they have been doing; the path is the default, not a rail.
- **Optional stays optional.** `billing-modes`, `ai-chat-knowledge`,
  `ai-providers` and `mobile-companion` are offered when there is a reason for
  them, never because they have not been done yet.

## 3. Most work is not a skill

A new page, a column, a text, a colour, a bug — that is ordinary work, and the
answer is to do it, not to route it somewhere. The skills cover the **stations**
of the project; everything between them is just building, and `CLAUDE.md` is the
guide for that.

So when nothing here fits: say so in one sentence and get on with the work.
Sending somebody to `build-app` because they asked for a button is worse than
useless — it costs them a conversation and gives them nothing.

## The rules

1. **One next step, never a catalogue.** Somebody who asks what to do next is
   already unsure; a list of fourteen options is not an answer to that.
2. **Look before you ask, and looking is the command.** The journey answers most
   of it from disk; ask only about what its `evidence` says nobody recorded.
3. **Hand over — do not half-do it.** The coach ends by *starting* the skill it
   named. Explaining what `setup-digistore` would do and then stopping leaves the
   user exactly where they were.
4. **Never invent a step.** If it is not a skill in `.claude/skills/` and not a
   command in `run.mjs`, it is not on this path.
5. **Skipping is the user's decision.** `security-gateway` and `compliance-check`
   are the two that get skipped. Name what it costs — once, in a sentence — and
   then do as they ask.
