---
name: ux-gateway
description: The experience check for this app. Looks at it the way a paying customer does — the first five minutes after a purchase, dead ends in the flows, actions that report nothing back, hand-built elements, unreadable text in dark mode, wording nobody understands, keyboard and screen reader, small screens, work the customer hands over that nothing comes back from — then fixes and reports. Use it after the app has pages and billing, before the security gateway, and whenever somebody says "my customers do not find their way around", "nobody uses it after they buy", "this looks unfinished", "is this understandable?".
requires: 0.4.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# UX gateway — look, judge, fix

The app works. This asks the other question: **can somebody who did not build it
use it, and does the person who just paid know what to do next?**

Those are not the same question as "does the page render", and nothing else in
this project asks them. `node run.mjs smoke` proves a page answers 200;
`vitest` proves a rule holds. Neither has ever opened the app and wondered what
the button does.

The method is: **look → judge → fix → look again.** Look means *open the page*,
not read the file. A finding you have not seen on a screen is a guess with a
severity attached to it.

The rules this measures against are **[`docs/ux.md`](../../../docs/ux.md)** and
`CLAUDE.md` § **UI**. Read `docs/ux.md` first — it is the single copy, this is
the audit against it. Where the two disagree, `docs/ux.md` wins.

## How to use this skill

Ten checks. You do not have to know which one you want.

| # | Check | What it looks at | Roughly |
|---|---|---|---|
| 1 | **`all`** | everything below, in the right order | 40–65 min |
| 2 | **`first-run`** | the first five minutes: purchase → dashboard. Does the empty app say what to do? | 10 min |
| 3 | **`flows`** | every path a member takes, including the unhappy ones. Dead ends | 10–15 min |
| 4 | **`feedback`** | does every action say what happened, and does destructive ask first | 5–10 min |
| 5 | **`kit`** | the design system: hand-built elements, hard-coded colours, both modes, small screens | 5 min |
| 6 | **`words`** | wording, i18n gaps, error codes shown raw, empty states with nothing in them | 10 min |
| 7 | **`access`** | keyboard, focus, names, contrast — WCAG 2.1 AA | 10 min |
| 8 | **`visuals`** | pages that hand the customer nothing but paragraphs; pictures that are broken, heavy, or contact somebody | 10 min |
| 9 | **`alongside`** | surfaces that take a customer's work and hand back nothing but a confirmation; a companion that is undisclosed or given away | 10 min |
| 10 | **`fix`** | fix the findings of the last report | depends |

**How to dispatch:**

- If the user already said what they want ("is the dashboard understandable?",
  "check the mobile view"), start that check. Do not show the menu first.
- Otherwise show the table, say that **`all`** is the one to run before a
  launch, and wait. A number, a name or a description all count.
- When somebody says "my customers do not get it" without more: **`first-run`**
  first. It takes ten minutes and it usually IS the answer.
- **You run the commands and you open the pages** — through your Bash tool and
  the browser, not by telling the user to do it. That is the rule for the whole
  template.

Every check ends the same way: findings with a severity → into the report →
offer to fix.

## Start the app. Always.

This gateway cannot be done from the files.

```bash
node run.mjs start          # DB + migrations + app
node run.mjs ux-check       # the measurable half — contrast, kit, names, menus
node run.mjs smoke          # every page answers
node run.mjs errors         # what the log caught behind a 200
```

`ux-check` is the narrow half and it takes two seconds: contrast of every token
pair in both modes, hard-coded colours, hand-built elements, icon buttons with
no name, images with no `alt`, and pages under `/dashboard` that nothing leads
to — in no menu AND with no page linking to them. ⚠️ Since template 0.27.0 that
includes `[param]` pages: a lesson or a group page is reached by a link and
never by a menu entry, so for those the only sensible answer to a finding is the
link, never a `NAVIGATION` line. Before 0.27.0 they were skipped, and that is how
a finished course shipped with no way into any lesson.
**Run it first and fold its findings in** — they are already measured, so they
go straight into the report with a file and a line. One exception: its
**images with no `alt`** belong under check 8 with the rest of what goes wrong
with pictures, so that one fix does not become two findings.

Then open the app. Signed in as a **member**, not as the owner — the owner sees
an admin area the customer will never meet, and every judgement made from the
owner's session is made about the wrong app. In DEV a member costs nothing to
get: only the *first* account in a fresh app becomes `owner`
(`lib/users/bootstrap.ts`), so signing in through the development login with a
second address you make up gives you exactly what a customer has. Where there is
no browser, `node run.mjs user-create --email … --apply` writes the same row
(`member` is the default role).

**A note on what you can and cannot see.** If a browser tool is available, use
it and say so in the report. If it is not, say *that* — "judged from the code,
not opened" belongs in **Worth a look**, not in the count. An unseen page is not
a passed page.

**And if you have none, you can usually get one.** All four programs this
template supports speak MCP, and Playwright ships an MCP server that gives you a
browser — navigate, click, screenshot. That is a change to the user's own setup,
not to this app, so **offer it and let them decide**:

> "I can only judge these pages from the code. If you add the Playwright MCP
> server to <your program>, I can open them and actually look. Shall I walk you
> through it? It takes a minute, and it is useful well beyond this check."

If they say no, or it does not work, carry on and be honest in the report about
which checks were done on a screen and which were not. Checks 5 and 7 (`kit`,
`access`) are the ones that suffer most; `node run.mjs ux-check` already covers
their measurable half, and that half needs no browser at all.

## What counts as a finding

The ladder and the four-line `Where:` / `Why:` / `Fix:` / `Evidence:` format are
the shipped ones — [`docs/guidance.md`](../../../docs/guidance.md) → *One report
shape*. What each rung means here:

| | Severity | Meaning |
|---|---|---|
| 🚨 | **CRITICAL** | Somebody who paid cannot reach what they bought, or is told nothing at all about it. Fix before anything else — this is a refund in waiting. |
| ❌ | **HIGH** | Most people will be stuck, or will read a working app as broken. Fix before the launch. |
| ⚠️ | **MEDIUM** | Real friction, or an inconsistency people will notice. Fix soon. |
| ℹ️ | **LOW** | Polish. When you get around to it. |

**What counts as shown, here:** a file and a line, a page you opened, or a number
from `ux-check`. "This could be confusing" with nothing under it goes into **Worth
a look**, not into the count — and that matters more here than anywhere else in
the template, because taste arguments are cheap to produce and expensive to read,
and a report full of them is a report nobody opens twice. **Why** says what it
costs the person, in plain words — not "poor affordance".

**Never report a deliberate decision as a defect.** Four that come up every
time, all documented, none of them findings:

- The app sets **no cookie banner** and must not grow one (`docs/compliance.md`).
- Sign-in is a **magic link** by default; a password is optional on purpose.
- A **segmented control built by hand** — the kit ships no ToggleGroup. The kit
  DOES ship `<Checkbox>`, `<RadioGroup>` and `<Switch>` — a hand-built one of
  those is a finding, with one carve-out: a **native input in a form that must
  work without JavaScript** (the `/plans` auto-reload consent is the shipped
  example, with the reasoning in a comment above it). A Radix control cannot
  reach `FormData` without JS, so there the native input is the correct element,
  styled from tokens.

  The template's own four such places are named in `RAW_ELEMENT_EXCEPTIONS`
  (`scripts/ux/rules.mjs`), each with its reason, so `ux-check` counts them in
  its green line instead of warning about them for ever. **Yours go in the same
  list** — it is code, so `node run.mjs update` never touches it. Do that only
  for a place you have judged: an entry with no reason is an exemption nobody
  can review, and the list is keyed on the element as well as the file, so a
  different hand-built control in the same file is still reported.
  (Needs template 0.27.0; before that the four were reported on every run.)
- **The shipped default look on an app with no `docs/design.md`.** Keeping it
  is the `0` from `build-app` step 1e, recorded in `docs/app.md` — an answer,
  not an unfinished job. The way to a look of its own is the skill `design`,
  and only the user opens that door.

## 1 · `all` — the full pass

In this order. It is not arbitrary: the checks that decide whether the app is
usable at all come before the ones that decide whether it is pleasant.

1. **`first-run`** — the moment the app is judged on. If this is wrong, nothing
   further down matters.
2. **`flows`** — the paths out of it, including the unhappy ones.
3. **`feedback`** — whether the app answers when spoken to.
4. **`kit`** — cheap, measured, and it explains half of "looks unfinished".
5. **`words`** — after the structure, because rewording a dead end does not fix it.
6. **`access`** — independent of all of the above; run it whenever.
7. **`visuals`** — second to last, because it asks whether the app hands over
   anything worth looking at, and that is a question about the product rather
   than about the interface. It is also one of the two whose fixes are new
   features, so it is one somebody may reasonably defer.
8. **`alongside`** — last, and beside `visuals` for the same reason. `visuals`
   asks whether there is anything to look at; this asks whether anything comes
   **back**. Both are questions about the product rather than about the
   interface, both have fixes that are new features rather than repairs, and
   both are ones somebody may reasonably defer.

Then: one report, one summary, one offer to fix.

## 2 · `first-run` — the first five minutes

The walk from purchase to dashboard, done as the customer: what to do at each
step, where the template already holds the answer, and the finding that is
almost always there on a young app. The full recipe is in
[`references/checks-first-run.md`](references/checks-first-run.md) — read it
before running this check.

## 3 · `flows` — every path, including the unhappy ones

The paths that exist in every app built on this template, the screen in each
that usually has nothing on it, and the missed payment that has to be checked
by hand. The full recipe is in
[`references/checks-flows-feedback.md`](references/checks-flows-feedback.md) —
read it before running this check.

## 4 · `feedback` — does the app answer when spoken to

What to check across the three feedback mechanisms: silent Server Actions,
redirects that say nothing on the other side, messages travelling in the URL,
destructive actions that do not ask, double submits, slow things. The full
list is in
[`references/checks-flows-feedback.md`](references/checks-flows-feedback.md),
together with check 3 — read it before running this check.

## 5 · `kit` — the design system

What `node run.mjs ux-check` settles, how a `docs/design.md` changes the
baseline this check audits against, and the two things you still have to look
at yourself — dark mode by eye, small screens. The full recipe is in
[`references/checks-kit-words-a11y.md`](references/checks-kit-words-a11y.md) —
read it before running this check.

## 6 · `words` — is it written for the customer

The five questions: i18n gaps, error codes reaching a person, identifiers on
customer-facing pages, empty states with nothing in them, and the five most
important sentences read out loud. The full list is in
[`references/checks-kit-words-a11y.md`](references/checks-kit-words-a11y.md),
together with checks 5 and 7 — read it before running this check.

## 7 · `access` — usable without a mouse

What `ux-check` measures, the second half for interactive elements — play
every one with the keyboard alone, to the final verdict — and the by-hand
checks, every one of which is a real failure rather than a nicety. The full
recipe is in
[`references/checks-kit-words-a11y.md`](references/checks-kit-words-a11y.md) —
read it before running this check.

## 8 · `visuals` — is there anything to look at?

Whether the app hands its customers anything but paragraphs: what a result
surface is, the severity table, the greps, and the rule that the fix names a
catalogue entry from `docs/visuals.md` rather than "add an image". The full
recipe is in
[`references/checks-visuals-alongside.md`](references/checks-visuals-alongside.md)
— read it before running this check.

## 9 · `alongside` — does anything come back?

Whether anything comes back for the work a customer hands over: the two
commands to run first, the severity table, where this check does not go, and
the handovers to `ai-companion`. The full recipe is in
[`references/checks-visuals-alongside.md`](references/checks-visuals-alongside.md),
together with check 8 — read it before running this check.

## 10 · `fix` — fixing what was found

1. **CRITICAL and HIGH first**, in the order they are in the report.
2. **Fix it where the rule lives**, not where it showed up. A missing
   acknowledgement is a step in the checklist, not a sentence pasted onto one
   page; a wrong colour is a token, not a class.
3. **Use the kit.** Anything missing: `npx shadcn@latest add <component>`.
4. **Both language files. Both modes.** Every time.
5. **Look at it again** — open the page, do the thing, and re-run
   `node run.mjs ux-check`. Then `node run.mjs test` and `node run.mjs smoke`.
6. **Update the report** — what was fixed, what stays open, and why.

Anything that needs a decision rather than a change (a different price story, a
plan that genuinely has no content behind it, a feature the app does not have)
goes back to the user as one clear question.

## The report

Every run writes one, whether it found anything or not. That is what makes "did
we already look at this?" answerable in three months.

It goes to **`docs/reports/ux-YYYY-MM-DD.md`**, and its shape — the header above
the tally, the five sections in their order — is
[`docs/guidance.md`](../../../docs/guidance.md) → *One report shape*. One header
line is this skill's own, and it is the one that keeps an unopened page honest:

```markdown
Checks: first-run, flows, feedback, kit, words, access, visuals, alongside
Seen:   opened in a browser, signed in as a member        (or: judged from code)
App:    local, commit a1b2c3d
```

So `## Worth a look` here holds two kinds of thing: what was **not opened**, and
the low-confidence observations.

The spoken summary says what a new customer meets today, what is in their way and
what was fixed; its straight yes or no is whether you would put this in front of a
paying stranger.

## Accepted deviations

Some of it is deliberate — a house style, a control the kit does not ship, a
deliberately sparse page. This skill's register is
**`docs/reports/ux-accepted.md`**, and the rules that go with it are
[`docs/guidance.md`](../../../docs/guidance.md) → *Accepted is not the same as
fixed*:

```markdown
| Finding | Where | Why accepted | By | Date | Review |
|---|---|---|---|---|---|
| Sparse dashboard on a fresh install | app/dashboard/page.tsx | nothing to show until the first purchase | Anna | 2026-07-27 | after the first ten customers |
```

⚠️ That register and `RAW_ELEMENT_EXCEPTIONS` are not the same thing and do not
replace each other. The register is a JUDGEMENT with a name and a date on it,
for anything this skill found; the list is what makes one particular check stop
repeating itself. A hand-built control you decide to keep belongs in both — the
list so the check is quiet, the register so the decision has an owner and a
review date.

**Two records, and check 9 is the first thing here that reads both.** They mean
opposite things and must not be merged:

- **`docs/app.md`** holds the decision *against building* something — "no
  companion, deliberately, because …". That is what makes a check **silent**, and
  it is written there by `build-app`, not by this gateway.
- **`docs/reports/ux-accepted.md`**, above, holds a finding a check **did** raise
  that the user then accepted. The realistic one for check 9 is a companion left
  deliberately free in a free tier — the ❌ HIGH gating row, accepted with a
  reason.

And the shared rule that a CRITICAL is not accepted reads plainly here: a customer
who cannot reach what they paid for is not a matter of taste.

## STOP — ask a person

Do not decide these on your own:

- **Rewording anything about price, plan contents or what a purchase includes.**
  That is the offer, and it is on file at Digistore24 as well. Wrong wording
  here is a legal problem, not a UX one.
- **Removing or hiding a legal page, a consent purpose or the AI disclosure.**
  `compliance-check` owns those, and Art. 50 AI Act is not a layout question.
- **Changing what a plan unlocks** to make an empty page look fuller.
- **A redesign.** This gateway fixes findings; it does not restyle an app
  somebody chose the look of. If the answer is "this needs to look different",
  say so and hand over to the skill **`design`** if the user wants it — that
  is the one place a look is chosen, changed and written down
  (`docs/design.md`).
- **Building the visual features check 8 proposes.** Reporting that a page hands
  out nothing but text is this gateway's job; deciding to build a chart, a
  result card or an image feature is the user's, and it is a feature rather than
  a fix. Report it, name the catalogue entry, and hand over to **`visuals`** if
  they want it. A gateway that quietly grows the product is one nobody can let
  run unattended.
- **Building the onboarding check 2 proposes.** Reporting that the checklist
  still says "buy something" is this gateway's job; choosing the activation
  event and building the steps, a survey or a nudge is the user's, and it is
  product design rather than a fix. Report it, name the section in
  `docs/onboarding.md`, and hand over to **`user-onboarding`** if they want it.
- **Building the companion check 9 proposes.** Reporting that a surface takes a
  customer's work and gives nothing back is this gateway's job; deciding to build
  a companion is the user's, and it is a feature rather than a fix — one that
  costs money on **every use** and sends what the customer wrote to a third
  party. Report it, name the catalogue entry, and hand over to **`ai-companion`**
  if they want it. The same goes for switching `config/ai-companion.json` on, and
  for changing what a companion is gated by — that is *"Changing what a plan
  unlocks"* above, with a bill attached.

## Next step

After a green UX gateway: **`security-gateway`** — the same shape, the same
report, for safety instead of clarity. Then `performance-gateway`.

Run this one again after any larger change to the interface, and `go-live`
brings it back for the live instance — a local pass proves the pages, not the
thing your customer actually opens.
