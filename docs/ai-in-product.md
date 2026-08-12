<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Working alongside your customer — what an AI in the product can be

> **This is a MODULE, and a fresh app does not have it.** It lives in
> `modules/companion/`; `node run.mjs module add companion` makes this app one
> that has it, and nothing in this document works until it does. There is no
> migration to run — the module declares no table of its own.
>
> ⚠️ **`node run.mjs ai-check` does NOT answer this question.** It lists a
> `companion` task in every app, installed or not: the task id is core
> vocabulary (the reasoning is in `modules/boundary.test.ts`, under the five
> refusals), so seeing it there says nothing about whether the code is wired up.
> The command that answers it is `node run.mjs module list`.
>
> **Needs template 0.8.0 or newer** for the code, 0.19.0 for the module seam. If
> there is no `modules/` directory at all, this document is describing a newer
> template than the one this app was built from — `node run.mjs update` brings
> the text, never the code, so the way to get both is a newer template.

Your app can do more than deliver things. It can **read what your customer
wrote, judge it, walk them through the work, or produce the thing with them** —
and that is usually the difference between somebody who stays subscribed and
somebody who cancels in week two.

The mechanics are in [`ai-providers.md`](ai-providers.md) → *Working alongside
your customer*. **This document is about what to build with them.**

---

## 1. What this is, and what it is not

The first mistake here is to reach for the support assistant. She is a different
thing with a different rule, and the two must not be merged.

| | The assistant | A companion |
|---|---|---|
| answers from | `content/knowledge/` — a handbook you wrote | what **this** customer produced |
| is sent | the question, the last few turns, the handbook. **Nothing about the person** | exactly the fields the call site named, one at a time, plus the customer's own text as content |
| lives in | `config/ai-chat.json`, the `chat` task | `modules/companion/companions.ts`, the `companion` task |
| the skill | `ai-chat-knowledge` | `ai-companion` |
| the reference | [`ai-chat.md`](ai-chat.md) | this file |

**The assistant's rule is a decision that stands, not a limitation the product
side inherits.** She is told she cannot see the account and she says so; nothing
about the signed-in person reaches the API. That is a data-protection decision
([`data-protection.md`](data-protection.md) §8), and lifting it would make her
unsafe to switch on for every member without a second thought. A companion is
the opposite case by construction — it is worthless unless it can see the
challenge day and the answer somebody wrote — so it gets the rule stated the
other way round: **exactly the rows its call site names, one field at a time.**
The standing rule is in the skill `guardrails`, which wins wherever anything
here disagrees with it.

Two worked sentences, so the boundary is usable rather than merely true:

- *"How do I cancel?"* is the handbook, for ever. A companion that answers it is
  a second handbook nobody maintains.
- *"Is my day-seven answer any good?"* cannot be a handbook question at all —
  the handbook does not contain the answer, because the answer is the
  customer's.

**This file has a sibling.** [`visuals.md`](visuals.md) is the catalogue of what
the customer is *handed*; this one is the catalogue of what the app *does with
them*. An app can need both, and usually does — a challenge with a picture on
every message and nobody reading the replies is half a product, and so is the
other way round.

---

## 2. What to build instead of leaving the customer alone with the work

Read this before you design a page that takes something in. Start from your
archetype (`build-app` step 1) — the defaults are the same ones its step 1c menu
is read off:

| The app is… | The default thing to build | § |
|---|---|---|
| **Content-Access** | the companion that walks the course with them · a reading of what they submitted | 2.1, 2.2 |
| **Drip/Automation** | the companion that walks the challenge with them · a reading of what they submitted · the look back | 2.1, 2.2, 2.5 |
| **Gated-Tool** | **the tool whose result is the product** · the check before they commit | 2.3, 2.4 |
| **Membership** | the check before they commit · the look back | 2.4, 2.5 |
| **Usage/Tokens** | the look back · the tool whose result is the product | 2.5, 2.3 |

**The Gated-Tool row is bold for the same reason it is bold in `build-app`.** For
every other archetype the companion is an addition to the product; for that one
it frequently **is** the product.

Every entry below says the same four things, and none of them is left for you to
guess. One of them is a rule rather than a fact: **what of their data the call
needs is a list of FIELDS, never "the member's context"** — a whole record is
exactly what may not be passed, and `guardrails` is where that rule lives.

### 2.1 The companion that walks a course or a challenge with them

**What the customer gets** — somebody to talk to about *today*, who knows which
day it is and what they said yesterday. Not a chat window on a course; a
conversation attached to one lesson or one day.

**What of their data the call needs** — the day or lesson number; that day's
task, in your words; what they wrote on **this** subject before (the panel
supplies the history — you do not fetch it).

**What one use costs** — this is a **conversation**, so the trimmed history is
re-sent on every turn. `maxHistoryTurns` on the entry is the brake, and it is
the number that decides whether a long exchange costs the same as a short one.
`node run.mjs ai-check` prints what one call costs on the model your `companion`
task is bound to.

**Gated or metered** — `requiresPlan: "<the plan the course is sold as>"`.
Not tokens: a customer who runs out halfway through a paid twelve-week challenge
is a refund conversation, not a monetisation. Metering fits work somebody chooses
to do again; it does not fit the thing they already bought.

### 2.2 The reading of what they submitted

**What the customer gets** — a reply to the work they handed in. One thing that
works, one thing to try next, in your voice, before the next task goes out.

**What of their data the call needs** — their submission; the task it answers;
optionally the previous submission, if "you did this better than last week" is
part of the product.

**What one use costs** — a **one-shot**: the customer's text is the biggest
thing sent, so `maxInputChars` on the entry is the brake (default 8 000, capped
at 20 000 — roughly 1 200 and 3 000 words). One submission is one call.

**Gated or metered** — usually `requiresPlan`, for 2.1's reason. `costsTokens`
fits where re-reading is optional and repeatable: *"ask for another pass"* is a
button somebody presses on purpose, and charging for it is honest.

🚨 **This is the shape most often built without a companion, and the fence
still applies.** An activity's `grade()` reading a submission through `runTask`
([`docs/learning.md`](learning.md), recipe C) is the same call one layer down:
it builds its request with `buildFencedRequest()` from
`@/lib/ai/customer-text` — **core** code, no module needed — and never
assembles the prompt by hand. The submission is `work`; `ask` and `about` are
appended outside the fence and are the app's own words. § 7 says where the file
is.

### 2.3 The tool whose result is the product

**What the customer gets** — the finished thing. The sales page, not the sales
copy. The reply to the difficult email, not a list of tips about difficult
emails. This is the Gated-Tool archetype's whole reason to exist: what the buyer
paid for is the reading, the judgement or the draft.

**What of their data the call needs** — whatever they filled in, field by
labelled field: the product name, the audience, the tone, the length. Your
instruction carries the craft; their fields carry the specifics.

**What one use costs** — one call per run, and the output is usually the large
half rather than the input, so the binding's `maxTokens` is what to look at.
Recipe E below is the shape when there is genuinely no conversation.

**Gated or metered** — this is the clearest case for `costsTokens`. One run, one
charge, in the order check → work → charge; the customer decides how often. A
plan on top of it is the usual shape: the plan buys access, the tokens buy runs.

### 2.4 The check before they commit

**What the customer gets** — a second pair of eyes on something they are about
to publish, send or sign up to. Not a gate — an opinion they can ignore, offered
at the moment it is cheap to change.

**What of their data the call needs** — the thing itself, and the constraint it
has to satisfy: the plan and the budget, the post and the audience, the terms
and what they actually want.

**What one use costs** — a one-shot per check, and people run it two or three
times as they edit. `maxInputChars` is the brake again.

**Gated or metered** — either, and the choice is a product decision rather than
a technical one: `requiresPlan` where the check is a promised part of the
membership, `costsTokens` where it is a thing power users do twenty times a day
and everyone else twice.

### 2.5 The look back over what they have done

**What the customer gets** — what changed, in words, over a week or a month.
People do not read their own history; they read a paragraph about it.

**What of their data the call needs** — the entries in the period, each as one
short labelled line. **Not the raw table.** If you cannot write the fields down
as a list, the entry is passing a record and `guardrails` says not to.

**What one use costs** — one call per look back, but the input grows with the
period, so a month is not four times a week — it is however much they wrote.
`maxInputChars` again, and a period the customer picks rather than the app.

**Gated or metered** — `requiresPlan` where it runs on a schedule and lands in
their inbox; `costsTokens` where they press a button for it.

---

**The pattern under all five:** find the place where your app currently answers
**"saved"**, and answer instead. That is the moment the customer is alone with
the work, and it is the moment they decide whether this was worth paying for.

**What NOT to build.** A companion with nothing of the customer's in it — one
that answers general questions about your subject — is a worse assistant than
the one this template already ships, and it costs money per answer to be worse.
And a companion handed the whole record instead of named fields is not a
shortcut; it is the rule in `guardrails` broken, and it is the difference
between an inventory a privacy policy can be written from and one that cannot.

**Five patterns cannot cover every product.** The catalogue has a row for most
apps, and **where it does not, say so and propose something rather than bending
an entry to fit**. It is a starting point, not an inventory. An agent that bends
*"a look back over what they have done"* onto an app with nothing to look back
over has built a feature nobody asked for.

---

## 3. Before you build one

Four things are already decided, and each is one place:

1. **The switch ships off.** `config/ai-companion.json` → `enabled`, read
   through `isCompanionEnabled()` and never by re-reading the JSON. A malformed
   value counts as off.
2. **The registry is your app's own list.** `modules/companion/companions.ts` ships empty.
   A second companion is a second entry — never a second component.
3. **The disclosure comes before the customer writes.** `<CompanionPanel>`
   already renders it; `node run.mjs legal-check` reports one that is switched on
   without it. It is a legal requirement (Art. 50(1) EU AI Act), not a nicety.
4. **The subject decides the conversation.** Two subjects never share a history,
   and the key is composed on the server by
   `conversationIdFor(companionId, subject)` — your page sends a subject, never
   a conversation id.

---

## 4. Recipes

These are not components in this template, deliberately: each is a few lines
against what already ships, and **none of them adds a dependency**. They use the
colour tokens in `app/globals.css`, which is what makes them correct in light and
dark **without a single `dark:` class** — dark mode here is a class on `<html>`,
not `prefers-color-scheme`.

### A — a companion on a page

The whole of it. One entry:

```ts
// modules/companion/companions.ts
export const COMPANIONS: readonly Companion[] = [
  {
    id: "day-coach",
    instruction:
      "You are a writing coach on a twelve-week course. Two short paragraphs, " +
      "warm but specific. Never rewrite their text for them.",
    requiresPlan: "kurs_komplett",
    costsTokens: 0,
    maxInputChars: 12_000,
    load: loadDay,          // Recipe B
  },
];
```

and one line on the page:

```tsx
import { CompanionPanel } from "@/lib/modules/component-registry";

<CompanionPanel companionId="day-coach" subject={day.id} />
```

🚨 **Import from the registry, never from `@/modules/companion/…`.** Your page
lives under `app/`, and `modules/boundary.test.ts` refuses any file there that
names a module directly — the generated barrel is what that refusal points at.
This used to say the module path, and following it turned your own
`npm run test` red about a page you wrote correctly.

**What you do not write:** the server action, the guard order, the rate limit,
the disclosure, the markdown renderer, the conversation key. All six exist, and
each one is a chance to be wrong — which is exactly why they are not yours.

### B — `load()`, scoped to the member

🚨 **The most important four lines in this file.** `load()` receives the
session's `memberId` and a `subject` string **the customer's browser sent**. Every
read inside it is scoped by that member id:

```ts
async function loadDay({ memberId, subject }: { memberId: string; subject: string }) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.memberId, memberId), eq(submissions.day, subject)))
    .limit(1);
  if (!row) return null;   // also the answer for a row belonging to somebody else

  return {
    about: [
      { label: "Day", value: subject },
      { label: "Task", value: row.task },
    ],
    work: [{ label: "Their answer", text: row.body }],
  };
}
```

Both conditions, always. `null` is **both** the refusal and the not-found
answer — the same value, so nothing here can be used to find out which ids
exist. Get this wrong and one customer's work is summarised back to another.

### C — gated by a plan

One field:

```ts
requiresPlan: "kurs_jahr",
```

`hasPlan(memberId, "kurs_jahr")` does the rest inside the shipped action. The key
is a `kind: "subscription"` or `"one_time"` entry from
`config/digistore-products.json`. **A token package cannot gate anything** — a
balance is not an entitlement and `hasPlan()` answers `false` for one for ever,
which would lock out exactly the customers who paid. `companionProblems()`
refuses that config at check time rather than at a customer's first click.

### D — metered by tokens

```ts
costsTokens: 5,
```

and the panel needs nothing else: the action charges **last**, so a failed
answer is not billed. What is not automatic is the customer-facing half —
**say the price next to the button, not in the ledger afterwards.** Somebody who
finds out what it cost after they pressed it has been surprised by their own app.

### E — a one-shot run, with no conversation

The § 2.3 tool. Here the app writes its own server action, and the order is
visible rather than inherited.

> 🚨 **Do not copy this block yet — it is wrong in two ways, both known, and a
> rewrite is scheduled.** It is left standing because the ORDER it shows
> (check → work → charge) is right and is the point of the recipe; the two
> defects are in the lines, and each is marked below.
>
> 1. **`ask: checked.text` hands the customer's own sentence to the model as
>    instruction.** `ask` is appended AFTER the fence and is app-authored by
>    contract — the customer's text belongs in `work`. This is the exact defect
>    a review found in the shipped action, where it is fixed and where
>    `modules/companion/actions.test.ts` now forbids the relapse. Follow
>    `modules/companion/actions.ts` (`work: […, { label, text: checked.text }],
>    ask: ASK`) rather than these lines. Writing the replacement sentence for
>    `ask` is a decision about YOUR product, which is why it is not patched here
>    in passing.
> 2. **Two of the three names are not reachable from `app/`.**
>    `isCompanionEnabled()` and `checkCompanionMessage()` are not in the
>    module's `serverExports` (only `askCompanion` is), so the only way to them
>    is `@/modules/companion/…` — and `modules/boundary.test.ts` fails any file
>    under `app/` that names a module path. Following this recipe literally
>    turns your own suite red about code you wrote correctly. Until it is
>    rewritten, put the action inside your own module, or do without those two
>    helpers and check the ceiling yourself.

```ts
"use server";
// 1. CHECK
const session = await requireActiveUser();
const memberId = session.user.id as string; // the session type has `id?: string`
// 🚨 defect 2 above: these two are not in `serverExports` and are unreachable
// from `app/`. Inside your own module they are fine.
if (!isCompanionEnabled()) return { error: "companionUnavailable" };
if (!(await hasPlan(memberId, "tool_jahr"))) return { error: "noAccess" };
const account = await getTokenAccount(memberId);
if (!hasSufficientBalance(account?.balance ?? 0, COST)) return { error: "insufficientBalance" };
const checked = checkCompanionMessage(input, MAX_CHARS);
if (!checked.ok) return { error: checked.code };

// 2. WORK — askCompanion returns a TaskResult; the answer is its `text`
// 🚨 defect 1 above: `ask` is appended AFTER the fence. What the customer wrote
// goes into `work`; `ask` is a sentence YOU write. Do not copy this line.
const { text: answer } = await askCompanion({ instruction, about, work, ask: checked.text, memberId });

// 3. CHARGE
try {
  await spendTokens({ amount: COST, note: "companion: brief-writer" });
} catch (err) {
  if (err instanceof TokenError) return { error: err.code };
  throw err;
}
```

Four things beside it, all of them real:

- **Reach for `<CompanionPanel>` wherever a conversation fits.** This path
  repeats guards the panel already has, and a server action is an HTTP endpoint
  of its own. Use it only where there genuinely is no conversation — one input,
  one result, nothing to come back to.
- **`spendTokens` takes no member id and must never be given one.** The account
  charged is always the session's own.
- **`note` is a label, never what the customer wrote.** It reaches a subject
  access request.
- **Render the result with `<AnswerText text={answer} />`** — parsed to React
  elements. Never `dangerouslySetInnerHTML`, never a second markdown renderer.

The surface around it is `Card`, `Button`, `Callout variant="danger"` for the
error and `text-muted-foreground` for the price line. No hand-picked colour
class anywhere.

---

## 5. Speaking and listening — what voice would take

A companion your customer talks to, rather than types at, is the same call with a
different way in and out — the task, the binding, the access check and the usage
record are all unchanged. What it adds is four things: a **second vendor** (none
of the five providers in `lib/ai/providers/` is reached for speech by this
layer), a **second key**, a **per-minute** price rather than a per-token one, and
**its own consent decision** — a recording of somebody speaking is a different
conversation from text they typed. Take that last one to `compliance-check`, and
use `lib/consent/` for it; there is one consent store and it ships with no
purposes declared.

**`node run.mjs ai-check` cannot price this one.** `config/ai-prices.json` is
keyed `provider/model` in per-million-token and per-picture units, and the task
layer knows only text and image — so nothing in this template binds a speech
model or prices one. The figure comes from the vendor's own price list, read at
the time you build it. A number written into this document would be wrong later
and nothing would catch it.

**Nothing in the catalogue requires it.** Not one of the five entries in § 2
needs speech to be the thing it is.

---

## 6. What this deliberately does not do

- **No streaming.** A companion answers in one go, and the spinner is honest for
  the two seconds it takes. When answers get long, the shape to reuse is the
  chat route's JSON-line stream — not a second protocol.
- **No companion in this template's own pages.** The registry ships empty on
  purpose: what a companion is for, and which shape fits which product, is a
  decision the vendor makes. Nothing here puts one in front of their customers by
  default.

---

## 7. Where things are

| File | What it is |
|---|---|
| `modules/companion/companions.ts` | **the list your app edits.** One entry per companion; ships empty |
| `modules/companion/companion.ts` | the call shape — `askCompanion()`, this module's binding to the `companion` task id |
| `lib/ai/customer-text.ts` | **CORE.** the fence that makes customer text content — `buildFencedRequest()`, the `<customer-text …>` markers, the standing rule. Any caller may import it, companion or not |
| `modules/companion/rules.ts` | the conversation key, the two input checks, the ceilings, the error codes |
| `modules/companion/switch.ts` | `isCompanionEnabled()`, `companionProblems()`, `companionOffReason()` |
| `config/ai-companion.json` | the switch. Ships `{ "enabled": false }` |
| `modules/companion/actions.ts` | the shipped server action — seven checks, then check → work → charge |
| `modules/companion/components/companion-panel.tsx` | the one surface. `<CompanionPanel companionId subject />`, imported from `@/lib/modules/component-registry` |
| `components/ai-disclosure.tsx` | the Art. 50(1) notice both AI surfaces mount |

Commands: `node run.mjs ai-check` (which model, what it costs),
`node run.mjs legal-check` (is a switched-on companion disclosed).

The skill that walks all of this with you is **`ai-companion`**.
