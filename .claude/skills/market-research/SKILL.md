---
name: market-research
description: Start here if you do NOT yet have a clear SAAS idea (or want to sharpen one) — interviews you about expertise, interests and existing reach, suggests target audiences, then derives a product idea that can be sold through Digistore24, a product brief, and a hand-over to `build-app`. Use this when the user says "I don't have an idea yet", "help me find something to sell", or asks what they could build.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# From the idea to a product proposal (market research)

Goal: derive a **concrete SAAS product** from what **you** are good at or can
reach, one that a real target audience needs — and that can be sold through
Digistore24 (digital products, courses, memberships, tools).

Guide the user **step by step** through the following phases. Ask questions with
the question tool (AskUserQuestion), summarize briefly after every phase and
have it confirmed before you move on. Don't invent facts — research them.

## Phase 1 — Interview: the starting point

Ask questions (in 1–2 rounds) to understand expertise, motivation and assets:
- **Expertise/background:** What do you really know your way around in
  (professionally, hobby, problems of your own you have solved)?
- **Existing idea:** Do you already have a product idea or target audience in
  mind?
- **Reach/assets:** Do you already reach people (email list, social media,
  community, customers)? That often decides success.
- **Goal & scope:** Side income or main business? How much time? One-off
  purchase or subscription preferred?

Summarize the answers as a short profile and have it confirmed.

## Phase 2 — Target audience candidates

Derive **2–4 concrete target audiences/niches** from the profile (specific, not
"all self-employed people", but e.g. "alternative practitioners who sell courses
online"). For each candidate name briefly: who, why you can credibly serve them,
and whether experience shows they pay for digital products.

Have the user **choose one target audience** (or add one of their own).

## Phase 3 — Research: situation & challenges

Research the chosen target audience **with real sources**. Use web search
(WebSearch/WebFetch); if the `deep-research` skill is available, use it for a
deeper, source-backed analysis. Clarify:
- **Situation & workflows:** How do these people work today? What do they earn
  with?
- **Pain points:** Which recurring problems, time sinks, frustrations?
- **Existing solutions & gaps:** What do they already use, what is missing?
- **Willingness to pay:** What do they already spend money on (courses, tools,
  templates)?

Summarize the findings **with source references** (3–6 key points). Prioritize
one or two problems that are frequent, painful and solvable.

## Phase 4 — Product proposal

**Ask two questions before you write a single feature down**, in one breath —
they are the same move at two depths, and splitting them would double the
ceremony for a one-sentence answer. It is the earliest place the rule in
`docs/guidance.md` → *How a skill works* (**"Anything the customer will SEE, and
anything the app will DO for them, is proposed, never assumed"**) applies — here
it shapes the product rather than a page.

> "What does your customer end up holding? A text they still have to put
> somewhere themselves — or something finished they can look at, show or
> publish?"

> "And what does your app DO alongside them while they work — does it read what
> they hand in, judge it, or produce the thing with them? Or do they do the work
> themselves and the app keeps it?"

**If the product is an online course, one more question — in the vendor's
terms, never in this file's:** *"Do your customers work through it at their
own pace, get it piece by piece, or hand something in that you read — or does
it never end?"* The answer is the course's SHAPE — three different
applications, told apart in [`docs/courses.md`](../../../docs/courses.md) —
and "it never ends" is the honest fourth answer: that is no course but the
Membership archetype, and the chooser's last section says so. Write the
answer into the brief **in the vendor's words** (there is deliberately no
third machine-read label — see Phase 5's warning about the two that exist),
so `build-app` Step 1 can CONFIRM the shape in one sentence instead of
deriving it from nothing. (If they also hand something in **that a person
reads**, it is the workshop, regardless of pacing — auto-graded self-checks
are not hand-ins.)

**Then let THOSE answers — all of them — change how every feature is WORDED** — it is not a note
to add beside the list, it is the list. An app that "generates sales copy" and
one that "generates a finished sales page with a picture" are two different
products, built two different ways, and only one of them is something somebody
pays for every month. The difference is decided here, long before anybody writes
code: `build-app` can only build out what this file says.

So: *"produces the ad text"* is a feature that has not had this question asked
of it. *"produces a finished ad — headline, body and image — that the customer
can post"* is the same feature after it has.

**The second question does the same thing to the other half of the product.**
*"a challenge a day"* and *"a challenge a day with somebody reading your answer"*
are two different products, built two different ways, and only one of them is
one people stay subscribed to. A customer who is alone with the work is a
customer who stops after week two, and no amount of finished output fixes that.

Three shapes each answer usually takes, to make both concrete:

| Instead of | The finished thing |
|---|---|
| a block of sales copy | a rendered sales page under its own address, with a hero image, that the customer can share |
| a number ("your score: 73") | a result card they can download and show somebody |
| a list of suggestions | the same suggestions as cards with previews |

| Instead of | Alongside the customer |
|---|---|
| a form that stores the day's answer | an answer that gets read, and replied to before tomorrow's task |
| a list of the entries they made | a look back over the week that names what changed |
| a checklist they tick off | a check on the plan before they commit to it |
| a video and a PDF per lesson | something the learner DOES that answers back — a check, a game, judged on the server (`docs/learning.md`) |

**This is not a request for more features.** It is the same feature, delivered
one step further along — and that step is usually where the willingness to pay
is. Keep the scope small; make the OUTPUT finished.

Now derive **one concrete SAAS proposal** (2 variants to choose from if needed):
- **Problem** (one clear statement) and **target user** (from phase 2).
- **Value proposition** in one sentence.
- **What the customer ends up holding** — one line, from the question above.
- **MVP feature scope:** 3–5 core features — **deliberately small** and
  buildable on this template (auth + data model + a few pages, access tied to
  the purchase). Each one describes what the customer RECEIVES, not what the app
  computes — **and, where it applies, what the app does with them while they use
  it.**
- **Digistore billing:** What is the "product"? One-off purchase, subscription
  or membership? How does the purchase unlock the value (the IPN records it, the
  app asks the entitlement API — see `docs/entitlements.md`)?
- **Name suggestion** (optional).

Check the proposal against `guardrails` (money, customer data, secrets) and
point out open issues (e.g. legally sensitive data).

Present the proposal and **iterate** until the user is satisfied.

## Phase 5 — Handover to the build

Write the result into a short **product brief** at `docs/product-brief.md`
(problem, target user, value proposition, MVP features, billing model, sources).
A minimal brief may already exist — `build-app` step 0 writes one whenever the
user arrived with a clear idea, and `coach` can route such a project back into
research. **Extend that file, never start a second one**: two briefs are two
versions of the truth, and the later skills read exactly one path.

**One line in it has a fixed shape**, because `build-app` reads it back — it is
how the next skill knows what to propose instead of asking the question again:

```md
**Output artifact:** a finished sales page with a hero image, under its own
address, that the customer can share
```

**A second line has the same fixed shape**, for the same reason and read by the
same skill:

```md
**Alongside the customer:** a coach that reads each day's answer and replies
before the next task goes out
```

and, for the honest other answer, which is a real one:

```md
**Alongside the customer:** nothing — they do the work themselves and the app
keeps it for them
```

Write both exactly like that — the bold label, then the thing itself in one
sentence. Not "a sales page (see features)"; the sentence has to stand on its own.

⚠️ **Both labels are load-bearing, literally.** `build-app` matches on
`**Output artifact:**` and on `**Alongside the customer:**` character for
character, and so does `coach` when it works out where a project stands.
Reword either label and the step that reads it silently turns back into an open
question — the vendor is asked something they already answered, in a later
session, by an agent with no way of knowing.

**Then write the plan — `docs/plan.md`.** The brief says what the product IS;
nothing on disk yet says what is still TO be built, and the list you just agreed
on is exactly that. One flat file, one line per thing the customer will be able
to DO, plus what was decided against and why. The shape is the same one
`build-app` uses:
[`../build-app/references/plan-md-template.md`](../build-app/references/plan-md-template.md).
Each line moves into `docs/app.md` once that thing exists and its tests are
green, so the file is always the part still ahead — and a plan that lives only in
this conversation is gone when the session is.

Then continue with the skill **`design`** — the look of the app, phase 1.2 of the
path: the four dials turned once, from their own brand if they have one, written
into `docs/design.md` so every page built afterwards follows it. It costs nothing
per use and about fifteen minutes, and it is far cheaper here than restyling six
finished pages later. **Shall I start `design`?** After that come **`build-app`**
(archetype, data model, pages) and **`setup-digistore`** (connecting the
billing).

## Principles

- **Research instead of guessing:** back up statements about the target audience
  with sources.
- **Start small:** an MVP that stands on this template within a manageable time
  beats the grand castle in the air.
- **Take reach seriously:** a target audience you can reach is worth more than
  the "bigger" market opportunity without access.
- **Fit the sales model:** Digistore24 is strong with digital products, courses,
  memberships and tools — aim the proposal at that.
- **Finish the output, not the feature list.** The usual way a proposal from
  this skill disappoints is not too few features — it is each one stopping one
  step short of what the customer wanted to hold (Phase 4).
- **And the second way is a product nobody is inside.** Everything is delivered,
  nothing is accompanied: the customer gets the material and does the work alone.
  That is the one people cancel in week two, and it is decided in Phase 4 too.
