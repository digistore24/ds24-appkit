<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The archetype table — what each kind builds, shows and does

_Read from `build-app`, step 1. The ✅ columns are the defaults that steps
1b–1d put to the user as menus._

| The app should…                                 | Archetype           | What to do | What this kind should show — ✅ = the default (step 1b) | What this kind should DO alongside its customer — ✅ = the default (step 1c) | What its customer should DO — ✅ = the default (step 1d) |
|-------------------------------------------------|---------------------|----------------|---|---|---|
| Unlock digital content/courses after purchase   | **Content-Access**  | **For a course, pick its shape in [`docs/courses.md`](../../../../docs/courses.md) FIRST** — self-study, week-by-week or accompanied workshop are three different data models, and the chooser there decides it (mind its tie-break). And with the shape, its authorship: a course only the developer himself maintains lives in code, not in tables ([`docs/content-authority.md`](../../../../docs/content-authority.md)). If the brief already names the shape in the vendor's words, CONFIRM it in one sentence rather than re-asking. **And if a knowledge corpus exists (`content/knowledge-sources/`), plan the course FROM it** — subjects, structure and lesson media are already there: courses.md → *Planning from a corpus* ([`docs/knowledge.md`](../../../../docs/knowledge.md)). Otherwise: one table per "product"; gate it with `hasPlan(memberId, productKey)`. **Lesson media that do not exist yet are production work — once the course skeleton stands, OFFER the skill `content-production`** ([`docs/content-production.md`](../../../../docs/content-production.md)): scripts, tools, rendering, delivery — a course whose units stay empty is the commonest way this archetype ships half-finished | ✅ a cover picture per lesson · ✅ a progress bar · the workbook or software as a **downloadable file** (`visibility: "entitled"`) | ✅ reads what the learner submits and answers it · a look back over the course so far | ✅ a self-check closing each block · a learning game on the hard part — skill `learning-activities` |
| Send recurring messages after purchase          | **Drip/Automation** | Two different products hide in this row. **Content the learner OPENS on a timetable — any cadence, daily too — is course shape 2** ([`docs/courses.md`](../../../../docs/courses.md); unlocking needs NO cron job). **Messages PUSHED to them stay here**: a messages/schedule table for the sequence + a job in `lib/cron/jobs.ts` (`docs/cron.md`) for the sending, start at `on_payment` | ✅ a picture with every message · ✅ "how far you have come" as a bar · optionally a welcome video | ✅ reads the day's answer and replies before the next message goes out · a weekly look back | ✅ a self-check closing each week — skill `learning-activities` |
| Provide a tool/feature for buyers only          | **Gated-Tool**      | Feature pages behind `hasPlan(...)` | ✅ **the RESULT is the visible thing** — a rendered sales page rather than sales copy, a result card rather than a number. See below | ✅ **the companion IS the tool** — what the buyer pays for is the reading, the judgement or the draft. See below | — the tool IS the doing |
| Manage membership/subscription                  | **Membership**      | `hasPlan(...)` decides access — a cancellation keeps it to the end of the paid period; self-service via `billing-modes` | ✅ a profile picture · badges for what somebody has reached | ✅ a check on what a member is about to commit to or publish · a look back over what they have done | — a membership follows, it does not examine |
| Bill by usage (e.g. AI usage)                   | **Usage/Tokens**    | Prepaid tokens with auto top-up — skill `billing-modes` | ✅ a consumption chart — the shape already exists in `lib/ai/report.ts` | ✅ the metered work itself — one use, one charge, in the order check → work → charge | — the metered work IS the doing |

**The Gated-Tool row is the one people read past.** For every other archetype
the visible part is decoration around the product; for this one it IS the
product. A tool that returns a block of text asks its customer to do the last
step themselves — and that last step is usually where they would have been
willing to pay. [`docs/visuals.md`](../../../../docs/visuals.md) is the reference for
what the app can already do here.

**And it is the same row for the same reason in the fifth column: for that shape
the companion is frequently the product itself rather than an addition to it.** A
Gated-Tool whose tool takes an input, stores it and answers "saved" has not
shipped a tool — it has shipped a form. What the buyer paid for was the reading,
the judgement or the draft. [`docs/ai-providers.md`](../../../../docs/ai-providers.md)
→ *Working alongside your customer* is the reference for that half.

## The activation event — step 1f's one question

**What has a customer done when you would bet they stay?** Read it off the row
you just chose, put it to the user as a sentence, and confirm. Not a menu: it is
not customer-visible surface, and a fourth menu here would break the 1b–1d trias.

| Archetype | Activation — the first success | Return — the same thing, repeated |
|---|---|---|
| Content-Access | finished the first lesson (a `unit_completions` row) | finishes another, weekly, until the course runs out |
| Drip/Automation | **answered** the first message, not merely received it | answers the one that arrived, per drip step |
| Gated-Tool | produced their first real result | produces another, as often as the job occurs |
| Membership | did the first member thing — post, booking, whatever it is for | does it again, weekly |
| Usage/Tokens | completed the first metered run (a spend on `token_ledger`) | spends again — a balance nobody spends is a refund waiting |

Three properties rule a bad answer out, and the full reasoning is
[`docs/onboarding.md`](../../../../docs/onboarding.md) §1: **it is theirs, not
yours** ("visited the dashboard" is your page, not their success), **it is
narrow** (one row, one moment, one date), and **it is the last step of the
dashboard checklist** — if the checklist ends short of it, the checklist is
decoration.

**The second column only applies to an app that bills again.** For a one-off
purchase the honest answer is that nothing repeats: record `Return: — one-off,
nothing recurs` and do not invent a rhythm the product does not have
([`docs/retention.md`](../../../../docs/retention.md) §1).

Both lines go into the product block of `docs/app.md` at step 4b
([`app-md-template.md`](app-md-template.md)). 🚨 **Step 2 owes the first one a
table**: the event has to be a dated row somewhere in the model you are about to
create. If no table can carry it, either the event is wrong or the model is
missing one — and finding that out here is the whole reason the question is
asked before the data model rather than after the pages.

## The billing mode that follows from the archetype

The last four rows above are plans, the **Usage/Tokens** row is tokens, and an
AI tool with a base subscription is both.

The template ships with `"both"`, which shows the surfaces of both models. Leave
it there and a subscription app carries a token balance stuck at 0 on the
customer's account page, and a token app an empty "next payment" card — half an
interface that never fills up, on the pages the vendor looks at first.

It is a **display** setting: `hasPlan()`, `consumeTokens()` and the IPN do not
change, and a mode only ever hides an *empty* card, so nobody loses sight of
something they paid for. Delete the sample products you do not sell from the
same file; `lib/billing-mode.test.ts` fails the build if the two contradict each
other. Reference: `lib/billing-mode.ts`.
