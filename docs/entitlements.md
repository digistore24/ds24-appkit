<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Entitlements: what a Member may use

One question, one answer: **`lib/entitlements/manage.ts`**. Everything on this
page is about that file, and about the three functions it exports for your app.

```ts
import { hasPlan, entitlementsFor, planStartedAt } from "@/lib/entitlements/manage";
```

Code:

- `lib/entitlements/manage.ts` — the API (`hasPlan`, `entitlementsFor`,
  `planStartedAt`) and the writes behind it.
- `lib/entitlements/rules.ts` — `chooseGrantTransition`: what each Digistore24
  event does to access. Pure, and covered by `rules.test.ts`.
- `db/schema-entitlements.ts` — the `grants` table.
- `app/api/ipn/route.ts` → `lib/digistore/payment-event.ts` — where the events
  arrive and the grants get maintained. You do not call into this yourself.
- `lib/tokens/account.ts` — the token balance, which is a *different* thing; see
  [Tokens are not entitlements](#tokens-are-not-entitlements).

---

## The check: `hasPlan`

```ts
hasPlan(memberId: string, productKey: string): Promise<boolean>
```

One Member, one plan, one boolean. This is what a feature asks.

```ts
if (await hasPlan(memberId, "basic_monthly")) {
  // the feature
}
```

`productKey` is a key from `config/digistore-products.json` — the same registry
the plans page and the checkout use. **It throws on a key the registry does not
know** (`Error: Unbekanntes Produkt: <key>`), and that is on purpose: a typo
that quietly returned `false` would be a paying customer locked out of a feature
that simply never appears, with no log line saying why. A programming error has
to look like one.

## The list: `entitlementsFor`

```ts
entitlementsFor(memberId: string): Promise<Entitlement[]>

interface Entitlement {
  productKey: string;
  source: "purchase" | "manual";
  accessUntil: Date | null;
}
```

Everything the Member may currently use, in one query. Use it to render a list,
a badge or an account overview:

```ts
const owned = await entitlementsFor(memberId);
const keys = owned.map((e) => e.productKey);   // ["basic_monthly"]
```

`source` says where it came from: `"purchase"` — somebody paid — or `"manual"`,
an entitlement an operator handed out from `/dashboard/admin/users/<id>`, either
permanently or through a day they picked. A Product Key held both ways appears
**once**, reported as `"purchase"`.

### Your code never learns which it was

And that is the point of the whole design, not an accident of the return type.

```ts
// Answers true for a subscription that billed this morning AND for the comp
// the operator typed in at 11pm to fix a support case. Identically. There is
// no second function and no flag.
if (await hasPlan(memberId, "basic_monthly")) { /* the feature */ }
```

An operator can settle a purchase that never matched, or hand somebody a month
of goodwill, and the feature works on the customer's next page load — with
nothing in your app to change, nothing to teach and nothing to deploy. A
`hasPlan` written against `orders` would have needed a second code path for
every one of those cases, and each of those paths would have been the one nobody
tested.

So `source` is there for a **person** to read — the operator's own page shows it
so support can explain a row months later. It is not a branch to write. Treat
`"manual"` as second class in a feature check and every comp your operator hands
out becomes a bug report; write `source === "purchase"` into a gate and you have
rebuilt the mistake this page exists to prevent.

### `accessUntil`, and the two things `null` means

`accessUntil` is the instant access runs out — and `null`, the normal case,
means something different depending on `source`:

- **`source: "purchase"` → always `null`.** Purchased access ends by *event*
  (`last_paid_day`), never by a stored day. There is no end date to show, and
  there is no other column that is one: `subscriptions.nextPaymentAt` says when
  money moves next, keeps naming a day after a cancellation, and reading it here
  is exactly what this whole page tells you not to do.
- **`source: "manual"` → `null` when the operator granted it permanently.**
  Otherwise it holds the last millisecond of the day they picked.

Rendering it takes one extra option, and it is not optional:

```tsx
const format = await getFormatter();     // next-intl, never toLocaleDateString

row.accessUntil
  ? format.dateTime(row.accessUntil, { dateStyle: "long", timeZone: "UTC" })
  : t("noEndDate")                       // a real sentence, never a blank cell
```

**`timeZone: "UTC"` is load-bearing.** The value is stored in UTC as the last
millisecond of the chosen day, so without the pin every viewer ahead of UTC
reads the *following* day — and on 31 December, the following year. A blank cell
for `null` is the other half: the customer cannot tell "runs forever" from "we
forgot to say".

The account page the template ships — `app/dashboard/account/page.tsx` — does
both, and is the shortest thing to copy from.

Note the asymmetry with `hasPlan`: `entitlementsFor` returns what is stored and
never consults the registry, so a Product Key you removed from
`config/digistore-products.json` still turns up here — while `hasPlan` on that
same key throws. Removing a key that customers hold is a migration, not an edit.

## Since when — `planStartedAt`

```ts
planStartedAt(memberId: string, productKey: string): Promise<Date | null>
```

The third function, and the one a drip-released course asks: **since when** does
this Member hold this plan. `null` means no *active* grant for that key — not
"no such product"; an unknown key throws, exactly as `hasPlan` does.

🚨 **Do not answer this out of `entitlementsFor()`.** That reader is a
`DISTINCT ON (product_key)`: it returns exactly **one** row per key, chosen by
purchase-beats-comp and then by the furthest `accessUntil` — **never by age**.
"The earliest of the grants `entitlementsFor()` returns" is vacuous over a single
row, and the date that row carries belongs to whichever grant won a contest about
something else entirely. A Member who bought, refunded and bought again gets their
clock started on the wrong grant, silently, and the only symptom is a week that
opens on the wrong day.

`planStartedAt()` aggregates `min(created_at)` over the ACTIVE grants for that key
instead — the earliest of the currently active ones. A re-buy after a refund
therefore restarts the clock, deliberately. A paused grant is not active, so it
reads `null`, and `null` is not week one: say "your access is paused".

Do not reach for `listGrantsFor()` instead — that is the Operator's read, it
carries the operator's `note`, and it is forbidden on member surfaces. The worked
use is [`courses.md`](courses.md) → *Drip release*.

---

## Gating a page: the whole thing

```tsx
// app/dashboard/reports/page.tsx
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { hasPlan } from "@/lib/entitlements/manage";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Not entitled? Send them where they can become entitled.
  if (!(await hasPlan(session.user.id, "basic_monthly"))) {
    redirect("/plans?needs=basic_monthly");
  }

  return <p>The paid feature.</p>;
}
```

Three things this small example is doing deliberately:

1. **The check is on the server, in the page.** A Server Action or a route
   handler is an HTTP endpoint of its own — it is not protected by the page that
   renders its button. Every action behind a paid feature repeats the check.
2. **It is derived per request**, never cached as a boolean on the user row or
   in the session. A stored "yes" survives the chargeback that should have
   revoked it. The check is one indexed query; you do not need to save it.
3. **`redirect("/plans?needs=<key>")`, not a 404.** The customer who is not entitled is
   usually a customer who would like to be. The key in the query is how `/plans`
   says which plan the click was waiting for (`app/plans/needs.ts`); a bare
   `/plans` reads as the price list, and a member who arrived there from a
   page has no idea why — measured on a field-test app.

---

## Where the answer comes from

`hasPlan` and `entitlementsFor` read **`grants`** — the app's own record of who
may use what. They do not read `orders` and they do not read `subscriptions`,
and that is the single most important thing on this page:

| Table | What it is | Answers "may they use this"? |
|---|---|---|
| `grants` | the app's own access record | **yes — this is the source** |
| `orders` | the financial record: what was paid, and what became of the money | no <!-- not-an-access-check: describing what the table is for --> |
| `subscriptions` | a mirror of what Digistore24 believes about the rebilling | no <!-- not-an-access-check: describing what the table is for --> |

Two answers to "may this person use this" drift apart; one does not. And the
billing tables do not merely fail to answer — they answer *wrongly*, because
they carry values that mean the opposite of the access decision. The worked
example is a cancellation, below.

### The events decide, and nothing else

The IPN maintains `grants`, and it does so from the **raw event name**:

| Event | Effect on access |
|---|---|
| `on_payment`, `on_payment_subscription_signup` | grants it — and lifts a suspension, if there is one |
| `on_refund` | ends it, for good |
| `on_chargeback` | ends it, for good |
| `on_payment_missed` | **suspends** it — reversible |
| `last_paid_day` | ends it. This is how purchased access normally expires |
| `on_rebill_cancelled` | **nothing at all** |
| `on_rebill_resumed` | **lifts a suspension** — and only that. Support restarted the billing; no money moved, so it never creates a grant |
| anything else | nothing |

Ended is ended: no later event reopens a grant that a refund, a chargeback or
the last paid day closed. A redelivered payment event cannot hand access back to
a refunded customer, and an operator restarting the rebilling months after
expiry lifts nothing.

### And they all have to arrive under the SAME key

Which grant an event acts on is decided by one column, `grants.ds24_purchase_id`
— and what it holds is the Digistore24 **order id**, because that is the only
identifier an IPN payload carries. Every transaction of one order shares it
(Digistore24 documents it as *"multiple transactions of the same order have the
same order-ID"*), so the refund arrives under the same key the payment created
the grant with. That property is the whole reason a refund can find anything: a
refund typically comes with no `custom` at all, nothing in it names the product,
and the handler has only the key.

🚨 **The column is named after a field that does not exist**, and the story is
worth knowing before anybody "tidies" it. The handler used to read
`body["purchase_id"]`; Digistore24 sends no such field, so the value was NULL,
`activateGrant` refused for want of a key, and every paying customer of every app
built from this template got no access at all — with the order row written, the
webhook answering 200 and the whole test suite green. The read point
(`lib/digistore/payment-event.ts`) carries the post-mortem, `ipn-fields.test.ts`
refuses the class, and `scripts/deploy-ipn.mjs` in the factory now buys, refunds
and checks over real HTTP on every `make test`.

⚠️ **An app deployed before that fix has orders with a NULL key**, and they are
not lost: the money and the product key are recorded, so one statement puts them
back into reach, and the next sign-in turns them into grants by itself (the claim
pass in `lib/digistore/claim.ts`).

```sql
update orders set ds24_purchase_id = ds24_order_id where ds24_purchase_id is null;
```

Do **not** try to reproduce this from a mapped status. The mapping collapses
`on_rebill_cancelled` and `last_paid_day` into the same value, and those two
mean opposite things about access — which is precisely why
`chooseGrantTransition` takes the raw event name and has no status parameter at
all.

---

## The three surprises

### 1. A cancelled subscription still has access

This is the one that catches everybody.

Digistore24 sends **two** events for a cancellation, days or months apart:

- `on_rebill_cancelled` — immediately, when the buyer or support stops the
  rebilling. Billing stops. **Access does not.**
- `last_paid_day` — when the period that was actually paid for is over. *Now*
  access ends.

Somebody who cancels a yearly plan in month one keeps everything for eleven more
months. They paid for it. An app that blocks them on the cancellation has taken
money and withheld the goods, and the support ticket is a refund request.

`hasPlan` gets this right on its own. You only get it wrong by going around it —
by reading the billing state and treating "cancelled" as "blocked".

### 2. A missed payment reads as no entitlement — but is not the end

`on_payment_missed` **suspends** the grant. `hasPlan` answers `false` and
`entitlementsFor` leaves the key out entirely, exactly as if the entitlement were
gone.

It is not gone. The row is still there, the suspension is reversible, and the
next successful payment (or an operator restarting the rebilling) lifts it and
the entitlement comes straight back. So:

- **Do not delete the customer's data** when the entitlement disappears. A card
  that expires over a weekend is the ordinary case, not an account closure.
- Prefer wording like "your access is paused" over "your account was deleted".

You cannot tell the two apart from `hasPlan` alone — so there is a second reader
for the *message*, and only for the message:

```ts
import { entitlementsFor, suspendedKeysFor } from "@/lib/entitlements/manage";
import { pausedKeys } from "@/lib/entitlements/rules";

const owned  = await entitlementsFor(memberId);
const paused = pausedKeys(owned, await suspendedKeysFor(memberId));
// paused = ["basic_monthly"] → "your access to Basis is paused"
```

`suspendedKeysFor` returns Product Keys and nothing else — no note, no operator
— and `pausedKeys` subtracts what the Member can still use another way, because
one key held through a failed subscription *and* an operator's comp is not
paused at all. Neither of them decides anything: `hasPlan` stays the check, and
a key in `paused` is a key the Member may **not** use right now.

Without this the card-expiry customer gets an empty list and no explanation,
which is the failure this whole section is about.

### 3. A Member can hold two plans at once — or briefly none

A Digistore24 plan switch is not one event. The old rebilling stops and a new
purchase starts, and the two arrive **days apart, in either order**. So an
upgrading customer holds:

- **both** keys for a while — the old one has not expired, the new one is live;
- or, if the old plan expired first, **neither**, until the new payment lands.

The per-key dedupe merges duplicate grants for the *same* Product Key. It does
not merge different keys, and it must not: they are different entitlements.

So there is no such thing as "the Member's plan":

```ts
// WRONG — shows the wrong plan to every upgrading customer, and crashes for
// the one who is briefly between plans.
const plan = (await entitlementsFor(memberId))[0].productKey;

// RIGHT — ask per feature.
const canExport = await hasPlan(memberId, "basic_yearly");
```

If you want to *display* something like a current plan, pick it deliberately —
highest tier wins, say — and handle the empty case. Do not let an array index
make that decision for you.

---

## The Operator's support page

`/dashboard/admin/users/<id>` is where support looks at one Member whole, and
it deliberately reads a *different* list than your features do:
`listGrantsFor()` returns every entitlement this account has ever held — live,
paused, expired or over, each labelled by `grantState()`
(`lib/entitlements/rules.ts`) and carrying the reason it ended. Using
`entitlementsFor` there would be wrong: that one is the app's access answer and
deliberately hides the very rows support is asked about.

A manual grant handed out from that page is **permanent or bounded, and the
Operator picks which**. No date means it runs until somebody revokes it. A date
means access ends at the **end** of that day — `accessUntilFromDay()` stores
the last millisecond of it in UTC, and nothing is scheduled: the term is simply
compared against the clock on every read.

The grant picker (`grantableProducts()`) offers `kind: "subscription"` and
`kind: "one_time"` entries only. A token package cannot be handed out as a
grant, because a balance is not an entitlement and `hasPlan()` would answer
`false` for such a row for ever — a support case about missing tokens is a
balance correction (`adjustTokens()`), not a grant.

Revoking is terminal, and only `source: "manual"` rows can be revoked at all —
purchased access ends by Digistore24 event, and the refusal lives in the
`UPDATE` itself, not merely in the menu. Because ending is terminal, the remedy
for a revocation made in error is a *new* manual grant; that is why two
identical manual grants for the same Product Key are legal, and the per-key
dedupe reports the key once regardless.

One operational note: `node run.mjs smoke` cannot see this page — it skips
`[id]` routes, and it is not signed in either. After changing anything here,
open it by hand with a real Member id and run `node run.mjs errors`: the page
renders dates and grant states, which is exactly the material that breaks
without changing the status code.

---

## Tokens are not entitlements

Prepaid tokens are a **balance**, not access, and they live in
`lib/tokens/account.ts`. A purchase of a token package never creates a grant, so
`hasPlan(memberId, "starter")` is `false` for every Member, forever — `starter`
ships as a `kind: "token"` package in the registry. Only `kind: "subscription"` and
`kind: "one_time"` entries become entitlements.

```ts
import { getTokenAccount, hasSufficientBalance } from "@/lib/tokens/account";
import { spendTokens } from "@/lib/tokens/spend";
import { TokenError } from "@/lib/tokens/rules";

// Read the balance (undefined = the Member has no account yet).
const account = await getTokenAccount(memberId);
const balance = account?.balance ?? 0;

// Pure check, no database — use it to disable a button or price a job.
if (!hasSufficientBalance(balance, 42)) {
  // offer them a top-up
}

// Spend. Charges the SIGNED-IN Member — note that no id is passed.
// Transactional, with a row lock: safe under concurrent requests.
try {
  const left = await spendTokens({ amount: 42, note: "report generation" });
  // `left` is the new balance
} catch (err) {
  if (err instanceof TokenError) {
    // err.code === "insufficientBalance" — translate it: t(err.code)
  }
  throw err;
}
```

Four rules, and the first is the one this function exists for:

- **It takes no member id — never give it one.** The account charged is always the
  session's own (`requireActiveUser()`, which also turns away blocked accounts), so
  a `memberId` out of a `FormData` cannot drain another customer's balance. 🚨 **An
  optional parameter defaulting to the session does not solve this** — it only makes
  the bad call compile again. The underlying `consumeTokens({ memberId, … })` stays
  exported for the IPN and the Operator pages, where naming somebody else is the
  job; features do not call it. Charging on behalf of somebody else needs a function
  of its own, opening with `requireOwner()`, exactly as `adjustTokens` does.
- **The price is yours, computed in code.** Read `amount` from the request and the
  customer sets it to 0.
- **`note` is a label, not content** — it reaches a subject access request
  (`node run.mjs data-export`). "report generation", never what the Member typed.
- **It is not idempotent.** Two submissions charge twice — keep a double-click off
  with `disabled={isPending}`, and never build a blind retry around it.

A shortfall throws `TokenError("insufficientBalance")` rather than returning
`false`, and writes **nothing**. Every booking lands in the ledger, so a balance is
always explainable.

The order is **check → work → charge**, gating on `hasSufficientBalance` before the
expensive part starts, and getting it the other way round fails in both directions:
charging first bills for work that then fails, and working with no check in front
gives the result away for free, because by the time `spendTokens` throws the
expensive part has already run. That second one is the mistake that actually gets
made. The gap between the check and the charge is real but bounded at one operation,
and the row lock inside `consumeTokens` still stops a balance going negative under
racing requests. Closing that gap properly would mean reserving tokens up front and
settling afterwards — a reservation needs expiry and reconciliation of its own, and
this template deliberately does not build one for a failure that costs at most one
operation's worth of work.

**Spending is never gated on `billingMode`** — that switch is cosmetic, and refusing
to spend would strand customers still holding a paid balance.

The two models combine well and are meant to: a subscription gates *whether*
the feature exists for this customer, the balance limits *how much* they use it.

```ts
if (!(await hasPlan(memberId, "basic_monthly"))) return notEntitled();
await spendTokens({ amount: cost, note: "report generation" });
```

Buying packages, auto top-up and the subscription self-service:
`digistore-billing-modes.md`.

---

## Rules

- **Never answer an access question from a billing table.** `hasPlan` /
  `entitlementsFor`, always. A hand-written query beside them is a second answer
  that will drift from the first.
- **Never store the answer** as a boolean on the user, in the session or in a
  cache. Derive it per request.
- **Never gate on a mapped status.** The events decide; the mapping loses the
  distinction that matters.
- **Repeat the check in Server Actions and route handlers.** The page rendering
  the button protects nothing.
- **Ask per feature, not "which plan".** Two plans at once is a legal state.
- Before you change the entitlement logic itself, read the skill **`guardrails`**
  — this is a money path.
