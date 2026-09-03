<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The short intake — five questions, announced before they are asked

Step 0's "the idea is there" branch. Two sentences are an idea, not a
specification, and what they leave open does not stay open: it gets decided
while you build, silently, and reappears as finished work nobody chose. This
asks the open points once, at the only moment they are still free.

**Announce it before you ask it.** That announcement is half the value — a
person who knows five questions are coming, and what happens after them, is not
the person who wonders for thirty minutes whether anything is going right.

> "Good — I can build that. Five short questions first, about two minutes, so I
> don't decide things for you that you should decide. After that I'll show you
> what your app will look like when I'm done, and only then start building — in
> stages of roughly ten minutes each. After every stage you can open the app
> and look at it, and I stop and ask before the next one. If you'd rather I ran
> straight through, say so then."

Adjust the numbers to the truth, never downward for comfort.

**Why all five at once, and announced.** The people who open this template are
often not developers, and a short concrete idea — *"an app for nutrition
coaches"* — leaves more open than it settles: who pays, what the buyer walks
away with, what it is called, what it looks like. **What it leaves open does not
stay open.** It gets decided silently, by whoever builds next, and reappears as
finished work nobody chose. Asking the five together, and saying beforehand that
you are going to, is what turns those decisions back into the customer's.

## The five

Ask them **in one bundle**, numbered, and wait for the reply. Not five
separate turns — that is the same conversation stretched over five waits, and
it teaches people to answer without reading.

| | The question | What it settles |
|---|---|---|
| **1** | Who pays for this, and what do they walk away with? | the buyer and the outcome — the two things a salespage, a plan and every later menu are written from |
| **2** | What do they actually do in it in their first week? | scope. It is the difference between an app and a list of features |
| **3** | How should it bill — one purchase, a subscription, or by usage? | `billingMode` in `config/digistore-products.json`, which Step 1 needs anyway |
| **4** | What is it called? | `NEXT_PUBLIC_APP_NAME` in the `.env`. Nothing asks this today, so every app is called "Your App" until somebody notices |
| **5** | Do you already have a logo, house colours or a website? | the **material** Step 1e needs. Its menu's row 1 is exactly that list, and only the vendor knows whether any of it exists — see below |

**A "don't know" is a valid answer to any of them, and it is not chased.**
Write `open` in the brief, say which step will come back to it, and move on. The
questions exist to stop silent decisions, not to extract five answers.

**Question 3 comes back later. Question 5 does not — and the difference is the
whole reason 5 is worded the way it is.**

- **3 is a decision**, and Step 1 confirms it rather than re-asking: read what
  the brief says, say what it implies, and ask for **confirmation** rather than a
  choice. Same mechanism the brief's labels already use (`SKILL.md`, Step 1's
  grammar) — an answered question is not open any more.
- **5 collects MATERIAL, and material is not a decision.** Step 1e reads the
  brief for it exactly as it reads `config/brand.json`, because a logo, house
  colours or a website found there *is* its menu's row 1 — so it names the door
  that implies and hands the number over instead of asking again.
  **But nothing found is not an answer either way.** It rules row 1 out; it says
  nothing about whether this vendor wants a look of their own, which is theirs to
  say and no absence of material decides. So 1e still shows the menu, with row 1
  already off the table.

🚨 **Do not turn 5 back into "should it get a look of its own?"** That question
records a *decision*, and Step 1e recognises decisions only in `docs/design.md`
and in the recorded `No custom identity`. A decision written anywhere else leaves
1e's own lookup finding nothing while this file tells it the matter is settled —
and then no menu is shown, no number is handed over, and the skill `design` is
never entered at all. Its Step 2 is the only place all four dials get filled
together, so the app ends up with one or two of them turned by hand. That is
measured, not hypothetical: field report `2026-08-11T1712-gated-tool`.

**Question 4 is written where it takes effect**, not only into the brief:
`NEXT_PUBLIC_APP_NAME=<the name>` in the `.env`. A name that lives only in a
document is a name the app does not wear.

## What this is not

- **Not `market-research`.** No target-audience research, no sources, no
  competitors. If the answers to 1 and 2 come back vague — "everyone", "all
  sorts of things" — that is the vague-idea branch of Step 0, and the skill for
  it is `market-research`. Hand over instead of asking a sixth question.
- **Not for an experiment.** "Hello World" or a page to get a feel for the
  template gets built immediately, same boundary as the SAAS rule in
  `CLAUDE.md`. Five questions in front of a two-liner drives away exactly the
  people who are still working out what this is.
- **Not a gate you argue with.** Somebody who says "just build it, I'll look
  after" gets that — write down in `docs/app.md` what went undecided, and carry
  on.

## The end picture — before the first file, not after the last

After Step 1e and **before Step 2 touches the data model**, put the whole thing
in front of the user in plain words and **wait for a yes**:

- the **pages** their customer will see, by the name the customer would call
  them — not `app/dashboard/[slug]/page.tsx`
- what a buyer **does** there, in the order they would do it
- what they **pay** and what they get for it
- what is deliberately **not** in it yet

Half a page, no file paths, no table names. Then: *"Shall I build that? Say what
is wrong and I'll change it — after this it becomes code, and changing it then
costs real time. I'll build it in stages, one line of that list at a time, and
after each one you can open it and look."* The yes starts the FIRST stage, not
the whole list — [`stages.md`](stages.md) is what happens after it.

**Then write it down, and write it down as they agreed it.** The same four points
go into `docs/plan.md` — the shape is
[`plan-md-template.md`](plan-md-template.md) — including what they said no to
while you were agreeing it, dated, with the reason in their own words. This is
the only file that says what is still TO be built: `docs/product-brief.md` is the
idea and `docs/app.md` is the record of what already exists, so a session that
stops after page two of five leaves nothing saying there were five.

Two reasons it sits exactly here. Everything before this point is talk and
costs a minute to revise; everything after it is a migration, six pages and a
schema. And it is the answer to the complaint this whole step exists for —
**"I don't understand what she is building"** — which cannot be fixed by
narrating the build better, only by agreeing on the result before it starts.

A correction at this point is a cheap success, not a failure. Say so.
