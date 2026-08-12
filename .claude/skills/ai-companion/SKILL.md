---
name: ai-companion
description: Makes an app work ALONGSIDE its customer rather than only delivering to them — a companion that walks a course or challenge, a reading of what somebody submitted, a tool whose result is the product, a check before they commit, a look back; also whether to have one at all, and an audit. Use this when the user says "my customers just get a list", "it does not do anything for them", "my app only saves what they type", "could it help my users while they work", "they put something in and get a real answer back", or when a page takes work from a customer and answers "saved". For WHICH AI company and what a call costs use `ai-providers`; for the support assistant's handbook use `ai-chat-knowledge`.
requires: 0.8.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Working alongside your customer

Most apps built here deliver something and stop. The customer gets the lesson,
the challenge, the template — and then does the work alone. This skill is about
the other half: **reading what they wrote, judging it, walking them through it,
or producing the thing with them.**

The reference is
[`docs/ai-in-product.md`](../../../docs/ai-in-product.md) — the catalogue, the
recipes and what each pattern costs. **This skill does not repeat it.** Where a
fact is needed, that file is named and the conversation moves on.

## Step 0 — is the module part of this app?

The seam is a **module**: it lives in `modules/companion/` and a fresh app does
not have it, the same way a fresh app has no community. Nothing below works
until it does.

```bash
node run.mjs module list         # is "companion" installed?
node run.mjs module add companion
```

If `module list` shows it under *"present but not installed"*, its code is in
the tree and does nothing: no registry, no texts, no error messages, nothing
wired up. One command fixes that, and it belongs at the start of this skill
rather than in the middle of the first recipe — see
[`docs/modules.md`](../../../docs/modules.md).

⚠️ **No `db-migrate` here, and that is not an omission.** This module declares no
table of its own: what a companion says lives in the chat's own store, which is
core. So `module add` is the whole installation.

**Installed is still not switched on.** `config/ai-companion.json` ships
`{ "enabled": false }` and stays the operator's file — item **4** below is where
that gets flipped. Two different questions, and merging them is how an app ends
up billing for a feature nobody chose.

## How to use this skill

Five items. You do not have to know which one you want.

| # | | What it does | Roughly |
|---|---|---|---|
| 1 | **`decide`** | should this app work alongside its customer at all — and where | 10 min |
| 2 | **`build`** | build one entry from the catalogue | 30–60 min |
| 3 | **`gate`** | who may use it, and what one use costs them — a plan, or tokens | 15 min |
| 4 | **`switch-on`** | the machine half: a key, the `companion` binding, the switch | 10 min |
| 5 | **`check`** | the one that already exists: disclosed, gated, scoped, inside its ceiling | 10 min |

**How to dispatch:**

- If the user already said what they want ("build me the coach", "who should be
  allowed to use it"), start that item. Do not show the menu first.
- Otherwise show the table, say that **`decide`** is where somebody who has not
  thought about it starts, and **wait**.
- *"It does not do anything for them"* with nothing else: **`decide`**.
- **You run the commands** — through your Bash tool, not by telling the user to
  type them. That is the rule for the whole template.

**There is deliberately no "run them all."** The inspecting skills
(`ux-gateway`, `security-gateway`) open with one, because running every check
before a launch is always right. Here it would mean building four features
nobody asked for — the opposite of this skill's own first rule.

## First, always

```bash
node run.mjs ai-check
```

It says whether this app can call a model at all, which company answers the
`companion` task, and what one call costs. On a machine with no key, three of
the five items below are conversations about something that fails at the last
step — better to know that in the first ten seconds.

It also prints a line when a key is configured and nothing product-side calls
it: *"You are paying for a model, and this app uses it only to answer support
questions."* That is this skill's opening question, answered by a command.

## 1 · `decide` — should it, and where?

**Look before you ask.** Read these two first, and report what you found rather
than asking about it:

| Where | What it answers |
|---|---|
| `docs/product-brief.md` → an `Alongside the customer:` line | what was decided when the product was worked out |
| `docs/app.md` → *Decisions worth remembering* | a decision taken since, **including a "no"** |

**A decision already taken is reported, not proposed again** — for or against. A
recorded *"no AI companion, deliberately, because…"* is an answer: say so, and
move on. Re-proposing something the vendor declined in session one is how a skill
becomes one people skip.

If the brief has no such line, read the decisions section instead and **say which
one you read**. Do not invent a second place to record it.

**Then the menu**, read off the archetype (`build-app` step 1, and
`docs/ai-in-product.md` § 2's index — they are the same list). Put the
possibilities as a numbered menu and **wait**, with the three answers offered in
the menu itself:

- **numbers** → exactly those get built
- **"you choose"** → the defaults for this archetype, no further question
- **`0`** → none of it, and it goes into `docs/app.md` under *Decisions worth
  remembering*, with the date and the reason

A `0` is easy to give here and should be: **it costs money on every use, for
ever.** That makes "no" an answer to a real cost rather than a failure to
persuade — and an unrecorded one is proposed again three sessions later by an
agent that has no way of knowing it was settled.

Where the app already has surfaces, the sharpest question is the one in the
catalogue: **where does this app currently answer "saved"?** That is the moment
the customer is alone with the work.

## 2 · `build` — one entry from the catalogue

Pick the pattern from `docs/ai-in-product.md` § 2, then follow Recipe A and
Recipe B there. In outline, and the outline is the point of how little there is:

1. an entry in `modules/companion/companions.ts` — the instruction, the plan or the price,
   the ceiling, and a `load()`;
2. `<CompanionPanel companionId subject />` on the page that carries it.

🚨 **`load()` is the part to get right, and it is four lines.** It receives the
session's member id and a subject string the customer's browser sent. Every read
inside it is scoped by that member id, and a subject belonging to somebody else
returns `null` — which is both the refusal and the not-found answer. Recipe B has
it as code; use that, do not describe it from memory.

**A second companion is a second entry, never a second component.** If you are
about to write a second panel, the thing you actually want is another row in the
registry.

Where there is genuinely no conversation — one input, one result, nothing to come
back to — Recipe E is the one-shot shape. Reach for the panel everywhere else.

## 3 · `gate` — who, and at what price

Two questions, and the catalogue says which fits each pattern:

- **`requiresPlan: "…"`** — the companion is part of what they bought.
  `hasPlan()` decides, never a billing table. The key is a subscription or
  one-time product from `config/digistore-products.json`; **a token package
  cannot gate anything**, and `companionProblems()` refuses that config rather
  than letting it fail at a customer's first click.
- **`costsTokens: N`** — they pay per use. The shipped action charges **last**,
  so a failed answer is not billed.

The judgement worth making out loud: **metering fits work somebody chooses to do
again, not the thing they already bought.** A customer who runs out of tokens
halfway through a paid twelve-week challenge is a refund conversation.

If they meter it, **say the price next to the button**, not in the ledger
afterwards.

## 4 · `switch-on` — the machine half

Three things, and an app missing any of them shows a notice instead of a
companion:

1. **A provider key** in `.env`. Any one of the five — the `companion` task
   ships on `"auto"`. Which company they pay is the skill `ai-providers`, not
   this one.
2. **The binding**, already in `config/ai-models.json` as a `companion` entry on
   `"auto"`. Only worth touching if they want a different company for the
   companion than for the assistant, which is allowed and means two AI
   recipients — `compliance-check` cares about that.
3. **The switch**: `config/ai-companion.json` → `"enabled": true`. It ships off.

Then `node run.mjs ai-check` again, and `node run.mjs legal-check` — a companion
switched on without its disclosure is reported there, and it is a legal
requirement rather than a nicety.

## 5 · `check` — the one that already exists

Five questions, in this order, and the first is a command:

1. **Is it disclosed?** `node run.mjs legal-check`. Switched on without a notice
   is a finding, not a preference.
2. **Is it gated or metered?** An entry with `requiresPlan: null` and
   `costsTokens: 0` is a paid feature every signed-in visitor spends the
   operator's money on. That may be deliberate — ask.
3. **Does `load()` scope by member id?** Read it. Both conditions, always.
4. **Is `maxInputChars` set?** The default is 8 000 characters, and the history
   is re-sent on every turn of a conversation.
5. **Does the panel read at 380 px and in dark mode?** Open it.

**The full audit of an app that already exists is `ux-gateway`'s own check** —
it walks every surface, including the ones where there is no companion at all.
This item looks at *one* companion, the one somebody is building or has just
built. Two ladders for one finding is what that split avoids.

## The rules

- **A "no" is an answer, and it gets written down.** Not negotiated, not asked
  again next session. `docs/app.md` under *Decisions worth remembering*.
- **`guardrails` wins.** This work sends what a customer wrote to a third party,
  which puts it inside that skill's STOP criteria. The standing rule for what a
  product-side call may be given lives there; where anything here disagrees with
  it, it is wrong.

## What comes next

- **Built one** → **`compliance-check`**. The privacy policy is drafted from
  `docs/data-protection.md`, and a companion is in it now (§8a) — what it sends,
  to which company, and for how long.
- **It costs money** → `/dashboard/admin/ai-costs`, grouped by task. That is what
  makes *"what does my coach cost me"* a question with an answer.
- **The app already exists and you want it looked at whole** → **`ux-gateway`**.
