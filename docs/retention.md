<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Retention — from convinced to still here

[`onboarding.md`](onboarding.md) ends at the moment a customer first succeeds.
This file starts at the second visit and asks the other half: **what makes the
person who paid come back, and what may this app do about it.**

The skill that walks it with you is **`user-onboarding`** (item `return`) — the
same skill, because the two questions share an answer: an app whose activation
event nobody named has no recurring action either.

Two facts frame everything below, and both narrow the job rather than widen it.

**The first: your customer already paid, and most churn machinery is not yours.**
Digistore24 is the reseller. The rebill, the retry after a card fails, the
letters that go with it and the cancellation itself all happen there. Industry
figures put involuntary churn — failed cards, expired cards — at roughly a fifth
to two fifths of all subscription churn, and a good dunning sequence at
recovering more than half of it. **Every one of those levers sits at
Digistore24.** What reaches this app is the outcome, as an event
([`digistore-integration.md`](digistore-integration.md)). So the honest scope of
this file is small, and §2 is mostly a list of things not to build.

**The second: retention here is a product question far more than a messaging
one.** The template ships no drip engine, no campaign table and no analytics,
deliberately ([`compliance.md`](compliance.md) — it is why this app needs no
cookie banner). What it ships instead are the surfaces people actually come back
*for*: a course with progress, a check that can be passed, a room with unread
posts. §5 is that list, and for most apps it is the whole answer.

---

## 1. The recurring action — the counterpart to the activation event

[`onboarding.md`](onboarding.md) §1 names the moment a customer first succeeds.
**This names the one they repeat.** One sentence, one event, readable from your
own tables — and, unlike the activation event, it carries a *cadence*:

| Archetype | The recurring action, typically | Cadence |
|---|---|---|
| Content-Access | finishes another lesson | weekly |
| Drip/Automation | answers the message that arrived | per drip step |
| Gated-Tool | produces another real result | as often as the job occurs |
| Membership | posts, books, or whatever the membership is *for* | weekly |
| Usage/Tokens | spends from the balance again | monthly at worst — a balance nobody spends is a refund waiting |

The cadence is not decoration. **An action with no expected rhythm cannot go
quiet**, and "gone quiet" is the only thing §4 and §6 can act on. Pick the
slowest rhythm you would still call healthy, and write it down.

Three properties, and each rules something out:

- **It is the same kind of thing as the activation event, done again.** If the
  recurring action is a different activity entirely, one of the two is wrong —
  usually the activation event, which was set at something the product does not
  actually repeat.
- **It has a plausible ceiling.** A course with twelve lessons cannot be
  "returned to" for ever, and pretending otherwise produces a nudge that chases
  people who have finished. Say what *done* looks like.
- 🚨 **Some products have none, and that is an answer.** A one-off purchase — a
  tool used once, a file bought and downloaded — has no recurring action, and
  inventing one produces a mail nobody wanted. Write `Return: — one-off,
  nothing recurs` and stop. Everything below then does not apply to this app,
  which is the honest outcome and not a gap.

Write it into `docs/app.md`, in the product block beside `Activation:`
(`build-app` → `references/app-md-template.md` carries both slots):

```
Return: the member completes a lesson each week (unit_completions row in the last 7 days).
```

## 2. What Digistore24 owns — and what that forbids here

**The subscription lives at Digistore24, not in this app.** The app holds
entitlements, and entitlements are the *consequence* of events it receives. That
one sentence rules out most of what a churn playbook would tell you to build:

| Do not build | Because |
|---|---|
| A cancellation flow with a save offer | The customer cancels **at Digistore24**. This app never sees the intent, only the result — and by then the decision is made. A cancel button in the app that does not actually cancel is worse than none |
| An exit survey at cancellation | Same reason: there is no moment to attach it to. If you want the reason, ask it *after*, once, in the mail §4 licenses — or accept that you will not get it |
| A pause or downgrade offer | It is a Digistore24 product change, not an app state. Offering it here means promising something the app cannot perform |
| Your own dunning: retry logic, payment-failed mails | The retry sits at Digistore24. A second set of letters about the same failed card puts two mails on one customer's morning, and yours is the one with no button that works |
| Win-back mails to people who left | Their access ended; often their account is gone or their data erased on request. See §8 |

⚠️ **`on_rebill_cancelled` does nothing in this app, deliberately** — a
cancelled subscription keeps its access to the end of the paid period, and
`last_paid_day` is what ends it. So "they cancelled" is not a moment this app
can react to at all, and a feature built on it would fire on the wrong day or
never.

What is left as genuinely yours is §3, §4 and §5. That is the whole list.

## 3. Paused access — it ships, and it ships in one place only

**`on_payment_missed` suspends access reversibly**, and a suspended plan
disappears from `hasPlan()` and `entitlementsFor()` alike
([`entitlements.md`](entitlements.md)). So without a word, a paying customer
whose card expired opens the app and finds their product simply gone. `CLAUDE.md`
→ *Access* states the rule: **say "your access is paused", never nothing at all.**

**That sentence is already built.** `pausedKeys()` (`lib/entitlements/rules.ts`)
separates a suspended plan from an absent one, and
`app/dashboard/account/page.tsx` renders it as a `<Callout variant="warning">`
with `account.pausedTitle` / `account.pausedBody` in both language files. It says
the right thing — a payment did not go through, the account and the data remain,
it all comes back when the payment does. **Do not rebuild it.**

⚠️ **What is worth checking is WHERE it appears, because there is one place and
it is not the one they land on.** The customer whose access was suspended opens
`/dashboard`, or the feature page they had bookmarked — and on those the plan is
merely gone. `/dashboard/account` is where they go *afterwards*, to work out why.
Whether this app needs the same callout on the page its customers actually
arrive at is a question about your pages, and `ux-gateway` (check `flows`)
already owns the missed payment as something to walk by hand.

Two rules if you do add it anywhere:

- **A `<Callout>`, never a toast** — it is a state, and a state must stay on
  screen (`CLAUDE.md` → *UI*, rule 1).
- 🚨 **It must not read like an account closure.** The plan is coming back. A
  page that answers "no active plan" to somebody mid-retry has turned a bank's
  timeout into a cancellation, which is the one churn this app causes itself.

## 4. The comeback mail — one, and only for the quiet

**Read §5 first, and expect it to answer this.** If the honest reason people do
not come back is that there is nothing to come back to, a mail does not fix it —
it works once and then teaches the customer to ignore you. A message is the last
thing on this list, not the first.

[`onboarding.md`](onboarding.md) §9 licenses exactly one mail, to the customer
whose **activation** never happened. This section extends it by one case and
nothing more: the customer who activated, kept going, and then **went quiet** —
no recurring action (§1) for a multiple of its cadence. 🚨 **These are two
different populations, and that is the whole licence.** A second mail to the
*same* person about the *same* silence is the sequence §9 forbids, and "they
still did not come back" is never the reason for it.

Everything about §9's recipe holds unchanged, and it is short because it is the
same recipe:

- One entry in `lib/cron/jobs.ts`, following every rule in [`cron.md`](cron.md):
  **safe to run twice**, one line of numbers as its detail, throws on failure.
- 🚨 **Idempotent because it records that it sent** — `claimSend()` from
  `lib/notify/sent-once.ts`, *claim before you send*. A claimed key is spent for
  ever, which is the point: a redeploy or a stale lock must not produce a second
  mail.
- ⚠️ **`lib/notify/*` addresses operators today**, not members. A recipient path
  to the customer is part of the work, not something to assume.
- **One mail per lapse, not one per customer, and never a sequence.** The
  distinction matters here where it did not in §9: somebody may go quiet in
  March and again in September, and those are two different silences. What is
  still forbidden is the second mail about the *same* one.
- **It names the next real thing and links to it** — the open lesson, the
  unspent balance. Not a feature list, not a newsletter.
- 🚨 **STOP before anything mails: consent.** A single service reminder about a
  purchased product is the defensible shape; anything past it needs a purpose in
  `config/consent.json`, which ships empty. [`compliance.md`](compliance.md)
  owns that line — do not settle it here.

**Pick the threshold from the cadence, not from a benchmark.** Three missed
weekly rhythms is a real silence; three missed days is a customer on holiday.
And a customer who has *finished* (§1's ceiling) is not quiet — exclude them, or
the mail chases people to congratulate them for stopping.

## 5. What already ships and carries this

**For most apps built on this template, retention is answered here and nowhere
else.** These are the surfaces people come back *for*, and every one of them is
a module you install rather than a mechanism you build:

| | What it gives the returning customer | |
|---|---|---|
| `courses` | progress that survives the session — "day 4 of 30", the next unit waiting | [`courses.md`](courses.md) |
| `activity` | something to pass, judged on the server — a real win, not a badge | [`learning.md`](learning.md) |
| `community` | other people, and an unread badge in the sidebar that means something | [`community.md`](community.md) |
| `companion` | an answer to work they handed in, which is a reason to hand in more | [`ai-in-product.md`](ai-in-product.md) |

The judgement to make is *which one this product actually needs* — and that is
what the skills `courses`, `learning-activities`, `community` and `ai-companion`
each ask in their own `decide` item. **A membership with nothing in it but
content is the shape this table exists to fix**, and no mail repairs it.

⚠️ On gamification the rule from [`onboarding.md`](onboarding.md) §7 holds
unchanged and gets sharper with time: **real wins only.** A streak that punishes
a missed day pushes exactly the fragile customer this file is about, and points
with no meaning behind them are UI noise that people stop seeing in a fortnight.

## 6. Measuring it

**Return rate = customers who did the recurring action again in the window ÷
customers who were active before it.** Both halves are rows you already have —
the grants on one side ([`entitlements.md`](entitlements.md)), the action's own
table (§1) on the other. One SQL query, run by hand when you want the number.

What it is for is the same as [`onboarding.md`](onboarding.md) §12: **comparing
you to you.** Measure before and after a change, on the same window. Published
retention benchmarks come from products with a different price, a different
buyer and a different cadence; against your own number from last quarter they
are noise.

Two readings worth separating, because they need opposite fixes:

- **People activate and never return** → the product does not repeat. §5, not §4.
  A mail cannot add a reason to come back.
- **People return for a while and then stop together, at a similar point** →
  something ends there. Usually the content runs out, and the ceiling in §1 was
  real all along.

🚨 **What NOT to add for it:** an analytics tool, a tracking cookie, an events
table written on every page view. That refusal is the same one
[`onboarding.md`](onboarding.md) §12 makes, and it is what
[`compliance.md`](compliance.md) trades for this app needing no cookie banner.
The queries above need none of it.

## 7. `lastSeenAt` — the column you do not need

Every "gone quiet" rule needs a date, `users` carries `createdAt` and
`blockedAt` and nothing else, and so the same column gets proposed every time.
**The answer is no, and it is worth knowing why rather than being told.**

**There is no cheap "last seen" in this app.** The session is a JWT
(`auth.config.ts`), so the `sessions` table is never written and the sign-in
event fires once per session rather than once per visit — a customer who comes
back weekly for a month may sign in exactly once. A column fed from that is not
*last seen*; it systematically under-counts precisely the returning customers
§6 is trying to find. Any honest `lastSeenAt` is therefore a **write on the read
path**, one per member per visit, which is the events table §6 refuses wearing a
column's clothes — plus a retention period, plus a line in
[`data-protection.md`](data-protection.md), plus probably a prune job.

**And you do not need it, because §1 already gave you the date.** The recurring
action is by definition a dated row in one of this app's own tables — a
completion, a submission, a spend. "Did they come back?" is §6's query with a
second date on it, over `grants` × that table. No column, no write, no consent
question, no prune job. That is not a workaround; it is the better measurement,
for the reason [`onboarding.md`](onboarding.md) §1 gives: *opened the app* is
your page, *finished the lesson* is their success.

The only case that survives all of this is an app whose recurring action leaves
no row anywhere — and that app has a §1 problem, not a schema problem.

## 8. What not to do

Each row names the mistake and where the correct version lives:

| Do not | Instead |
|---|---|
| Build a cancellation flow, save offer or exit survey | §2 — the cancellation happens at Digistore24 and this app never sees it |
| Send your own payment-failed letters | §2 — the retry is Digistore24's; §3 is your half |
| Show "no active plan" to somebody whose payment is being retried | §3 — a paused plan is coming back |
| A sequence, a campaign table, an open-rate tracker | §4 — one mail per silence, then let go |
| Chase customers who finished | §1's ceiling — they did not leave, they arrived |
| Win-back mails after access ended | §2 — and often the account is gone; erasure is not a suppression list |
| Streaks that punish, points with nothing behind them | §5 — real wins only, [`onboarding.md`](onboarding.md) §7 |
| Add analytics to answer "are they coming back?" | §6 — two SQL queries answer it, and the banner stays gone |
| Add `users.lastSeenAt` to find the quiet ones | §7 — the session is a JWT, so it would not mean what it says, and §1's action is already dated |
| Compare yourself to a published retention benchmark | §6 — compare yourself to you |
| Name a recurring action for a one-off product | §1 — `Return: — one-off` is an answer |

---

## What the commands settle, and what they cannot

Nothing in `node run.mjs` measures retention, and nothing will: it is a question
about people, answered by the two queries in §6 and by looking at §5's surfaces
the way a returning customer does (`ux-gateway`). What the commands *do* settle
is that the machinery underneath still runs — `node run.mjs cron --list` says
whether the job in §4 last ran and what it said ([`cron.md`](cron.md)), and the
recurring round that asks it is the skill `operate`.

**The judgement this file exists for is §1**, made once, revisited when §6's
number says so. The skill `user-onboarding` (item `return`) is where it gets
made deliberately, instead of an app quietly assuming its customers had a reason
to come back.
