<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Onboarding — from paid to convinced

This file is about the **end user** of the app you are building: the person who
just paid and is now looking at it for the first time. It answers one question —
**what do you build so that this person understands the app, finds their way in,
and gets to the thing they paid for** — and it answers it per pattern: what the
checklist steps should say, whether this app needs a welcome survey, what a
wizard is for, why there is no product tour, and how to know whether any of it
worked.

The **mechanics** of the first five minutes — the checklist component, why a
step's `done` is derived from state and never stored, why there is no dismiss
button — are [`ux.md`](ux.md) §1 and `lib/onboarding/rules.ts`. This file does
not repeat them; it says what to put **into** that machinery. The skill that
walks this file with you is **`user-onboarding`**, and the audit that checks the
result is `ux-gateway` (check `first-run`).

One fact frames everything here, and it is worth saying before any pattern:
**your customer has already paid.** Most SaaS onboarding advice is written for
trials, where the first session sells the product. Here the first session
decides something sharper — whether the purchase gets kept or refunded. The
customers an app loses, it loses in the first days, and usually not in the
first session: most people come back once or twice before they either settle in
or give up. So the first session's job is not to show everything. It is to
produce one real success, and to make the way back obvious.

---

## 1. The activation event — decide this before any pattern

**Every pattern below is aimed at one moment, so name the moment first.** The
activation event is the thing a customer has done after which you would bet
they stay — one sentence, one event, readable from your own tables:

| Archetype | The event, typically |
|---|---|
| Content-Access | finished the first lesson (a row in `unit_completions`, or your course shape's equivalent — [`courses.md`](courses.md)) |
| Drip/Automation | answered the first message, not merely received it |
| Gated-Tool | produced their first real result with the tool |
| Membership | did the first member thing — the first post, the first booking, whatever this membership is for |
| Usage/Tokens | completed the first metered run (a `token_ledger` row with a spend on it) |

Three properties make an event usable, and each one rules something out:

- **It is theirs, not yours.** "Visited the dashboard" and "opened the settings"
  are your pages, not their success. The event lives in the app's *own* tables —
  the ones `build-app` created for this product.
- **It is narrow.** "Used the app three times" is a hope, not an event. One row,
  one moment, one date.
- **It is the last step of the checklist** (§2). If the checklist ends anywhere
  short of it, the checklist is decoration.

Write it into `docs/app.md` under *Decisions worth remembering*, as one line:

```
Activation: the member has completed their first lesson (unit_completions row exists).
```

That line is what the skill reads back next session, what §12 measures against,
and what stops every later onboarding conversation from starting over.

## 2. The checklist — the strongest pattern, and it ships

**A short checklist of real milestones beats every other onboarding device this
template could carry, and the component is already on your dashboard.**
`<OnboardingChecklist>` renders on `app/dashboard/page.tsx`, with two shipped
blueprint steps that are meant to be replaced the moment your app does
something of its own ([`ux.md`](ux.md) §1 holds the mechanics and the three
load-bearing properties).

What the steps should *say* is this file's half, and there are four rules:

- **3 to 5 steps, each a milestone toward the activation event** — never a
  feature visit. "Create your first project" is a step; "have a look at the
  reports page" is a tour wearing a checklist's clothes.
- **The last step is the activation event itself** (§1). Everything on the list
  is on the path to it, and anything not on that path is not on the list.
- **Every step carries an `href` to the place it is done.** A step that names a
  task without taking the customer there is a riddle, and the customer solves it
  by writing to support.
- **A step the state already satisfies shows as done from the first look** —
  "account created", or the purchase itself. That head start is legitimate here
  precisely because it is *true*: the tick is derived from what really happened,
  which is the difference between momentum and a trick. Do not pad the list with
  fake pre-ticked steps to manufacture it.

Each step's `done` is a query against real state — the shipped steps in
`app/dashboard/page.tsx` show the shape, and the comment block above them says
why it must stay that way. Texts go into both `messages/de.json` and
`messages/en.json` under `onboarding`, like every other visible sentence.

## 3. Empty states teach — the second surface, and it ships

**The checklist says what to do next; the empty page is where they land when
they try — and both must point at the same action.** `<EmptyState>` is
mandatory for every list that can be empty (`CLAUDE.md` § UI, rule 3, and
[`ux.md`](ux.md) §1); what this file adds is the coherence rule: the empty
state's button and the checklist's current step lead to the same place. An app
whose checklist says "create your first project" while the empty projects page
offers "import from CSV" as its only button is arguing with itself, and the
customer loses either way.

Where a blank start is genuinely hard — a content tool, an editor, anything
where the first object takes effort — the empty state may offer a **template or
example** as its second action (§8 says how sample data stays honest). The
sentence itself names the benefit, not the mechanism: "Your first report shows
you where the money went" beats "No reports yet".

## 4. A welcome survey — build it per app, and only if the answer drives something

**A survey whose answers change nothing is a form, and a form between a paying
customer and their product is a cost with no return.** That is the test, and it
is why the template ships no survey component: whether an answer *can* change
something — which checklist steps render, which template is offered, which of
two first tasks is proposed — is a property of your app, not of the kit.

When the answer does drive something, the recipe is short:

1. **2 to 4 questions, at most.** Role, goal, experience — whatever the app
   actually branches on. Every question you ask and ignore teaches the customer
   that your questions can be skipped.
2. **The answer is app state.** A column on your own table (or on `users`), set
   by a Server Action — never a separate answers table with UI logic hanging off
   it. The checklist stays derived from real state either way; the survey answer
   is simply one more piece of real state it may read.
3. **A `<Card>` on the dashboard, rendered while the column is null.** Its
   "done" is derived exactly like a checklist step's, so it leaves by being
   answered — the same rule as everything else on that page. Kit components
   only, texts in both language files.
4. **Skippable, visibly.** A "skip" that stores a null is an answer too, and the
   app must work on it. A customer who skips is telling you the default path
   should be good — make it good rather than asking again.

## 5. Wizards — only for setup the app genuinely cannot run without

**One honest test decides it: would skipping the wizard leave the app broken,
or merely empty?** Empty is the checklist's job (§2) — a wizard in front of a
working app is a locked door in front of a person who already paid. Broken is
different: an app that cannot do anything until the customer connects an
account or provides a key may legitimately walk them through exactly that.

If the test says wizard:

- **Only the fields the app cannot run without.** Everything else has a
  settings page and a later.
- **One thing per screen, progress visible** ("step 1 of 3"), and a "later"
  wherever a step is not strictly load-bearing.
- **It is pages plus a redirect rule, not a framework.** A `/dashboard/setup`
  page built from the kit, and a redirect while the required state is missing —
  the same derived-state logic as everything else. The template ships no wizard
  primitive because there is nothing to ship: the kit already is one.

## 6. Tours and tooltips — why this template does not ship a tour

**A product tour needs a stored "seen" flag, and that flag is exactly the
stored tick this template refuses to hold** (`lib/onboarding/rules.ts` says
why a stored copy of a derivable truth is the copy that goes wrong). It is not
an accident that the refusal and the industry's experience point the same way:
forced overlay tours are the most-skipped, least-retained onboarding device
there is, and a tour that fires again on every device change or refund would be
worse than none.

The template's answer to "how does the customer learn the UI" is a ladder, in
order:

1. **Pages that need no explanation** — that is `ux-gateway`'s whole job.
2. **The checklist** (§2), which points at the next real action.
3. **The empty state** (§3), which explains the page the customer is on.
4. **The assistant** ([`ai-chat.md`](ai-chat.md)), whose handbook's first
   folder is literally `content/knowledge/00-onboarding/` — the first way
   through the app, answered when the customer asks. That is the user-triggered
   walkthrough this template already has, and unlike an overlay it works on the
   fourth visit as well as the first.

A **tooltip** clarifies one control where a label cannot carry everything —
that is allowed and occasionally right. A *sequence* of tooltips is a tour, and
the ladder above applies.

## 7. Gamification — real wins only, and the seam is `learning-activities`

**Celebrate what happened, never what you wish had happened.** A progress bar
bound to real steps (the checklist has one built in), a course progress derived
per shape ([`courses.md`](courses.md)), a badge for something a member actually
reached — those work, because the customer recognises the achievement as
theirs. Points for logging in, streak pressure on a B2B tool, confetti on
"profile saved" — those read as the app celebrating itself, and in a product
somebody uses for work they read as unserious.

Where gamification genuinely carries weight is learning products, and there the
template has a shipped seam: **[`learning.md`](learning.md)** — games, checks
with a pass mark, graded exercises, judged on the server (skill
`learning-activities`, template ≥ 0.9.0). A learning game closing a course
block IS onboarding for a Content-Access app: it is the activation event with a
verdict attached.

Whether this app gamifies at all is a product decision — make it once, write it
into `docs/app.md` under the decisions, and let pages inherit it.

## 8. Sample data — labelled, deletable, never fake

**An example is a teaching device; unlabelled sample data is a lie the
customer discovers later.** Where a blank start is hard (§3), an example object
helps — under four rules:

- **Loaded by the customer, never pre-seeded silently.** A "Load an example"
  button in the empty state creates it; the customer knows where it came from
  because they made it happen.
- **Named as what it is** — "Example project — delete me", not "Q3 Report".
- **Deletable like anything else**, and gone means gone.
- **It never ticks a checklist step and never counts as activation.** A step's
  `done` predicate excludes sample-flagged rows, or the checklist congratulates
  the customer on work they have not done — and §12's number becomes fiction.
  This is the rule people break by accident, which is why it is written here.

## 9. After the first session — a nudge without an email engine

**Most customers who activate do it on a return visit, so the return visit is
worth more than another hour of first-session polish.** The template
deliberately ships no drip-campaign engine — what it has is mail delivery and
the job registry in `lib/cron/jobs.ts` ([`cron.md`](cron.md)), and for
onboarding that is enough for exactly one thing: **a single reminder to the
customer whose activation event has not happened.**

The recipe, and each line is load-bearing:

- One job, following every rule in [`cron.md`](cron.md): it is **idempotent**
  because it records that it sent (a `nudgedAt` column beside your own tables is
  the honest way — this is operational state, not a derived tick), and its
  detail line is numbers only.
- It selects accounts whose **activation event (§1) is absent after N days** —
  read from the same tables the checklist reads. Three to five days fits most
  apps; pick one and write it down.
- **One mail, ever.** A customer who did not come back for the second mail is
  not coming back for the fifth, and every further send spends your sender
  reputation on someone who has left.
- The mail names the **next undone step and links to it** — the same step the
  checklist would show. Not a feature list, not a newsletter.
- **It is a marketing-adjacent mail, so consent is a real question.** A single
  service message about a purchased product is defensible; anything more needs
  a purpose in `config/consent.json` — [`compliance.md`](compliance.md) owns
  that line, and the skill stops there rather than deciding it for you.

### The welcome mail — the same machinery, one step earlier

**The app sends its buyer nothing.** Digistore24 sends the receipt; the app puts
a toast on `/dashboard` (`/optin/[orderId]` → `components/flash-toast.tsx`) and
that is all — so a customer who closes the tab has no written way back in. One
mail fixes it, and it is the same recipe as the nudge with two differences:

- **It names the first undone step and links to it** — the step the checklist
  would show (§2), not a feature list and not a welcome letter about you.
- 🚨 **It does NOT hang off the IPN.** Digistore24 redelivers the notification
  until it gets a 200, so anything on that path runs again — and a send cannot be
  taken back. `lib/digistore/payment-event.ts` already holds the rule for that
  door: nothing may endanger the order write. So the mail is a **job**, like the
  nudge: it selects the grants of the last N hours that carry no welcome mark,
  and `claimSend()` names the WINDOW (`welcome-mail:<YYYY-MM-DD>`) because a send
  key names a piece of work and never a person (`lib/notify/sent-once.ts`). The
  per-customer "already sent" is a column beside your own tables, exactly like
  the nudge's `nudgedAt`.
- ⚠️ **`lib/notify/*` addresses operators today.** A recipient path to the member
  is part of this work, not something already there.
- **Consent is the same STOP**, and this one sits closer to transactional than
  the nudge does: a single service message about a product somebody just bought.
  Say so, then let the user decide — [`compliance.md`](compliance.md) owns it.

**It is not shipped, deliberately.** A mail the app sends in the operator's name,
carrying their imprint (`lib/email.ts` puts it in the footer), from a decision
nobody made, would start sending the moment somebody configures mail delivery for
the *login*. Anything the customer will see is proposed, never assumed.

What NOT to build: a sequence, a campaign table, an open-rate tracker. The
second is a product decision, the third is a tracking question — and the first
is churn management, which is a real subject with its own file rather than an
extension of this one: **[`retention.md`](retention.md)** covers the second
visit, what Digistore24 owns and this app must not rebuild, and the single extra
mail that is licensed there.

## 10. Which patterns for which archetype

**Not every pattern earns its place in every app — this table is the starting
answer, and the skill's `decide` step walks it with you.** ✅ = usually worth
building for this archetype · — = usually skip it, and the reason is in the
column's section above.

| Archetype | Checklist steps that fit (§2) | Survey (§4) | Wizard (§5) | Gamification (§7) | Sample data (§8) |
|---|---|---|---|---|---|
| **Content-Access** | start lesson 1 → finish lesson 1 (= activation) | — one course, one path; ✅ only if courses differ by level and the answer picks one | — the purchase already unlocked it | ✅ the natural home — progress per shape, a check closing a block | — the content IS the example |
| **Drip/Automation** | confirm the channel → read message 1 → answer message 1 (= activation) | ✅ when the answer sets cadence or track | — | ✅ "day 4 of 30" derived from the grant date | — |
| **Gated-Tool** | provide the tool's needed input → first run → first real result (= activation) | ✅ when it picks the starting example or mode | ✅ the one archetype where required setup is common (a key, a connection) | — a tool celebrates by working | ✅ an example input showing what "good" looks like |
| **Membership** | complete profile → first member action (= activation) | — the membership already is the segment | — | ✅ badges for what somebody reached — already the archetype's default in `build-app` | — a community with fake members is a ghost town wearing a costume |
| **Usage/Tokens** | first metered run (= activation) → see the consumption chart | — | — the balance came with the purchase | — the meter is the feedback | ✅ a free first run on an example input, if the unit price makes that affordable |

Two rows deserve their footnote read: the **Gated-Tool** wizard cell is the
only ✅ in that column, and it still passes through §5's test first; the
**Membership** sample-data cell is a — with teeth, because faking activity in a
social product is the one place §8's honesty rule cannot be patched by a label.

## 11. What not to do

Each row names the mistake and where the correct version lives:

| Do not | Instead |
|---|---|
| Show everything in session 1 — every feature introduced, every panel explained | the checklist's 3–5 steps (§2); the rest reveals itself when the customer gets there |
| A forced tour on first login | the ladder in §6 |
| A dismiss button on the checklist | there is none, deliberately — [`ux.md`](ux.md) §1 says why it must stay gone |
| Steps that describe your UI ("visit the reports page") | steps that describe their progress ("see where your money went") — §2 |
| A survey the app ignores | §4's test: no consequence, no survey |
| A wizard in front of a working app | §5's test: broken vs. empty |
| Pre-seeded fake content, fake counters, fake activity | §8 — loaded by the customer, labelled, excluded from `done` |
| Measuring "checklist completed" and calling it activation | §12 — the event, not the flow, is the number |
| A mail sequence to the inactive | one nudge (§9), then let go |

## 12. Measuring it

**Activation rate = accounts that reached the event ÷ accounts that paid.**
Both halves are rows you already have — grants on one side
(`lib/entitlements/manage.ts` maintains them), the event's table (§1) on the
other. One SQL query, run by hand when you want the number; the skill's `check`
step runs it with you.

What the number is for: **comparing you to you.** Measure before and after an
onboarding change, on the same window (say, accounts older than 7 days). An
absolute number without that context mostly produces anxiety.

**There is a second number, and it is the one that says whether the first one
mattered** — the return rate, built the same way out of the same two tables:
[`retention.md`](retention.md) §6. An app whose activation rate rises while its
return rate does not has got better at first impressions and no better at the
product.

What NOT to add for it: an analytics tool, a tracking cookie, an events table
written on every page view. The shipped answer to "this app sets no tracking
cookie and needs no banner" ([`compliance.md`](compliance.md)) is worth more
than a funnel chart, and the query above needs none of it. If the operator
wants the number on a page some day, it is one card in the admin area reading
the same two tables — build it when they ask, not before.

---

## What the command settles, and what it cannot

`node run.mjs ux-check` and `node run.mjs smoke` prove the pages render, and
`ux-gateway` (check `first-run`) judges the first five minutes against
[`ux.md`](ux.md). **None of them can tell you whether your activation event is
the right one, or whether your steps mean anything to a person** — that is a
judgement about your product, made once in §1 and revisited when the number in
§12 says so. The skill `user-onboarding` exists so that judgement gets made
deliberately instead of shipping as whatever the blueprint happened to say.
