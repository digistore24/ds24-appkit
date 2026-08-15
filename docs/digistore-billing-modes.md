<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Billing models: subscriptions + prepaid tokens

Besides one-off purchases (`createBuyUrl`, see `digistore-createbuyurl.md`) the
template supports two further models, on their own or **combined**:

1. **Subscription with a fixed payment** — recurring monthly/yearly.
2. **Usage billing with prepaid tokens** — the customer buys token packages;
   usage draws tokens down; at a low balance it is **topped up automatically**.

A typical cut: **base subscription (fixed) + usage-based tokens for the AI
usage**. Both run through the same DS24 account, IPN and checkout.

Which of the two an app uses is **declared, not guessed** — see
[Which model this app uses](#which-model-this-app-uses-billingmode) below.

Code:
- `config/digistore-products.json` — **product registry** (source of truth): one
  DS24 product per offer, language **and environment** (dev/staging/prod);
  the ids are written back into `productIds.<env>` by `sync-products.mjs`.
  Also holds `billingMode` — which of the two models this app sells.
- `lib/billing-mode.ts` — reads it: `sellsPlans()`, `sellsTokens()`.
- `lib/digistore/products.ts` — registry access (price, interval, features).
- `lib/digistore/checkout.ts` — **registry entry → checkout link**
  (`checkoutLinksFor`), on top of `createBuyUrl`.
- `lib/digistore/billing.ts` — `createBillingOnDemand`, `stopRebilling`,
  `getPurchase`, `listPurchases`.
- `lib/tokens/packages.ts` — token packages (from the registry, kind="token").
- `lib/tokens/account.ts` — balance, consumption, credit, auto-reload.
- `lib/entitlements/manage.ts` — **what a Member may use** (`hasPlan`,
  `entitlementsFor`). The access question is answered here, never from the
  billing tables below; see `entitlements.md`.
- `db/schema-tokens.ts` — `subscriptions`, `tokenAccounts`, `tokenLedger`.
- IPN: `app/api/ipn/route.ts` (credit + subscription upsert).
- Scripts: `scripts/ds24/sync-products.mjs` (create/update),
  `scripts/ds24/request-approval.mjs` (approval at go-live).

## Which model this app uses (`billingMode`)

Most apps sell one of the two, not both. That is a line in the registry, and it
is **the first thing to set** — every surface below reads it:

```json
{
  "billingMode": "subscriptions",
  "products": { … }
}
```

| Value | The app sells | What disappears from the interface |
|---|---|---|
| `"subscriptions"` | plans (`kind` `subscription` / `one_time`) | token balance on `/dashboard/account`; balance, ledger and the correction form on `/dashboard/admin/users/<id>` |
| `"tokens"` | prepaid credit (`kind: "token"`) | the entitlement list on `/dashboard/account`; the "next payment" card on `/dashboard`; the grant-by-hand form |
| `"both"` | both — the default | nothing |

Read it through `lib/billing-mode.ts`, in a **server** component or a server
action:

```ts
import { sellsPlans, sellsTokens } from "@/lib/billing-mode";

// Not `!sellsTokens()` on its own — see the rule below.
const showBalance = sellsTokens() || balance !== 0;
```

Never in a client component: the module imports the registry, and that JSON
carries prices and Digistore24 product ids that have no business in a browser
bundle. Resolve it on the server and pass the boolean down as a prop.

### The four rules

1. **It is cosmetic. It never decides access.** `hasPlan()`,
   `entitlementsFor()`, `consumeTokens()` and the IPN behave identically in
   every mode. The mode is a setting somebody flips while a customer holds a
   paid balance; a display setting that revokes what was paid for is a refund
   request, not a layout change.
2. **A mode may hide an empty thing, never a non-empty one.** Every call site
   is written as `!sellsTokens() && balance === 0`. So an app switched from
   tokens to subscriptions still shows the customers who bought tokens what
   they still hold — and a wrongly set flag costs nothing but a card the vendor
   did not want anyway.
3. **One exception: the manual balance correction.** `adjustTokens()` throws
   `TokenError("tokensNotSold")` when the app sells no tokens, before any
   balance is read — it *mints* tokens. The refusal is in the function, not in
   the form, because a server action is an HTTP endpoint of its own. A legacy
   balance stays visible, consumable and creditable by IPN; only creating
   tokens out of nothing stops. To correct one, set the mode back.
4. **Mode and registry must agree.** `lib/billing-mode.test.ts` fails the build
   on a token package declared in a `"subscriptions"` app: `ds24-sync` would
   create it at Digistore24 and it would be buyable there, while the app renders
   nothing that credits the buyer — a money hole no dry run shows. The check is
   one-directional: an enabled mode with no products yet is fine, and is the
   normal state while the app is still being built.

Taking the products you do not sell out of the offer is part of setting the
mode, and there are two ways to do it:

- **`"sell": false`** on the entry — it stays in the file as a shape to copy
  from, no product is created for it, `/plans` leaves it out, and it no longer
  counts as a contradiction here. This is usually what you want when the mode
  might change back.
- **Delete the entry** — when you are sure you will never need it.

⚠️ Neither of them unpublishes anything. A product `ds24-sync` has already
created stays at Digistore24 until you deactivate it there, by hand, and an old
checkout link keeps working until you do.

🚨 **`sell` and `billingMode` are not two words for the same thing.** The mode
is about a whole HALF of the model — it hides the surfaces of subscriptions or
of prepaid credit, and it is purely cosmetic (see the two rules at the top of
this file). `sell` is about ONE offering and it is not cosmetic: it decides
whether a Digistore24 product gets created for it and whether anybody can buy
it. What they have in common is that neither takes access away from anybody who
has already bought.

**And that is safe for the shipped test suite.** Every test here that needs a
Product Key reads one out of THIS file through `lib/digistore/test-product-keys.ts`
rather than naming `basic_monthly` or `starter` — so deleting a sample product
does not turn somebody's suite red about a product they deliberately do not sell.
Where your registry no longer holds the *shape* a test needs at all — an app
selling a single one-off product has neither a subscription nor a token package —
that test **SKIPS with the reason printed**, rather than turning red or, worse,
passing for a different reason than the one it was written for.
*(Needs template 0.25.0.)*

## Products: registry + checkout via createBuyUrl

Every offer (subscription plan **and** token package) is **one DS24 product per
language**, each with a stable id. One product per language, because a DS24
product carries exactly one and that one is the language of the buyer's order
form — see [`digistore-integration.md`](digistore-integration.md) → *The order
form's language*. Declare products in `config/digistore-products.json` and
create them:

```bash
node run.mjs ds24-sync
```

That writes the id(s) back into `productIds.<env>` **and** registers that
environment's IPN connection.
(`node scripts/ds24/sync-products.mjs --apply` only does the products — the
purchases would then unlock nothing.)

**The price stays in the registry.** `data[amount]` on the DS24 product is
deprecated and discarded; instead `priceCents`, `currency` and `billingInterval`
travel with every checkout call as `payment_plan[...]`. DS24 does offer a
`createPaymentPlan` API, but a stored plan would put the price in a second place
and could not do free trials, upgrades, vouchers or per-link affiliate
commissions. **No payment plans in the DS24 interface.**

Checkout:

```ts
import { checkoutLinksFor } from "@/lib/digistore/checkout";
import { sellableProducts } from "@/lib/digistore/products";

const links = await checkoutLinksFor(sellableProducts(), { buyer: { email } });

const link = links.get("starter");
// { url } → render the buy button
// { url: null, blocker } → "notSynced" | "notConnected" | "error"
```

**Take the whole registry, never a hand-picked list of kinds.** An earlier
version of this very example built its list as
`[...productsByKind("subscription"), ...productsByKind("token")]` — which reads
like the complete registry and is not: it drops every `kind: "one_time"`
product, and the sales page shipped with exactly that bug for a while (a vendor
whose only product was a one-off course saw an empty page). If you need the
registry *grouped* the way the plans page shows it, `planSections()` in
`lib/digistore/plan-sections.ts` is the one place that decides which kinds
exist and in what order — extend it rather than enumerating kinds at a call
site.

`checkoutLinksFor` sets two things per token package by itself: the
`tokens:<key>` marker the IPN books the credit against, and
`settings[force_rebilling]=Y` — without which no chargeable `purchase_id` comes
into being and the auto-reload below cannot work. URLs are cached for 20h
(`buy_url_cache`) and regenerate whenever the offer changes. Blueprint:
`app/plans/page.tsx`. Which environment's product a link sells follows
`APP_ENV` (`docs/environments.md`).

The cache key carries the language (`"<key>:<language>"`), because the visitor's
locale decides which of the offer's DS24 products they are sent to.

---

## 1. Prepaid tokens: buying more & auto-reload (`createBillingOnDemand`)

`createBillingOnDemand` charges a further payment against an **existing
`purchase_id`** — the customer's payment method is already authorized, **no new
checkout** is needed. That is exactly what carries buying more tokens and the auto-reload.

### Prerequisites

- A **writable API key** and, in the DS24 account, the **"billing on demand"** right.
- A **chargeable `purchase_id`**. It comes into being through:
  - a **subscription** (every subscription `purchase_id` is chargeable), or
  - a purchase made with **`settings[force_rebilling]=Y`** — that keeps the
    payment method on file for later on-demand charges. `checkoutLinksFor` sets
    this for every `kind: "token"` entry (`forceRebilling` in
    `lib/digistore/checkout.ts`).
- **DS24 limits:** 10 charges/day and 1/minute per `purchase_id` (production).

### Flow (important: credit only via IPN)

```
Customer has purchase_id ──▶ createBillingOnDemand(apiKey, {purchaseId, productId,
                                                     priceCents, custom:"m:…;t:…;p:starter"})
      │                         (charges; does NOT credit)
      ▼
DS24 processes payment ──▶ IPN on_payment (custom = "m:…;t:…;p:starter")
      ▼
IPN handler ──▶ creditTokens(...)  (idempotent via order_id → balance +credits)
                 only once the payment is attributed to a member; an
                 anonymous purchase waits for the buyer to sign in
```

The credit **never** happens synchronously in `createBillingOnDemand`, but only
once DS24 confirms the payment via IPN — exactly as with a normal purchase. The
The `custom` value carries the buyer's identity — member id, checkout token
and product key — which connects charge and credit and says WHOSE credit it
is. See `lib/digistore/custom.ts`. The older `tokens:<packageKey>` marker is
still parsed for purchases created before this, but is never sent again.

### First purchase of a package (without on-demand)

The **first** purchase runs through the normal checkout link:

```ts
import { checkoutLinksFor } from "@/lib/digistore/checkout";
import { getProduct } from "@/lib/digistore/products";

const links = await checkoutLinksFor([getProduct("starter")], { buyer: { email } });
const link = links.get("starter");
// -> if link.url, open it for the buyer.
```

The `custom` identity string and `settings[force_rebilling]=Y` are set by
`checkoutLinksFor` itself. The latter is what makes the later auto-reload
possible at all — it is what keeps the payment method on file.

The IPN credits the tokens **and** remembers the `purchase_id` on the token
account (`linkPurchaseId`) — the basis for the later auto-reload.

### Auto-reload

**It is wired end to end — application code calls nothing.**

1. The buyer ticks a checkbox on the token card at `/plans`. The wish travels to
   Digistore24 as one more pair in `tracking[custom]` (`r:1`), because at
   checkout time the chargeable `purchase_id` does not exist yet.
2. The **IPN arms it** once the payment confirms and the mandate exists —
   `shouldArmAutoReload` (`lib/digistore/attribution.ts`). Only on a resolved
   identity, and only on the delivery that actually booked the credit, so a
   Digistore24 retry cannot re-arm what a Member turned off.
3. **`spendTokens` triggers it** after every debit — including a debit that
   FAILED for lack of funds, which is the strongest signal a top-up is due. The
   call runs after the response (`after()`), so an outbound payment call never
   sits in the Member's request.
4. The Member sees the state on the **Tokens** tab of `/dashboard/billing` and
   can switch it off — and back on, as long as a mandate is stored.

`autoReloadIfNeeded` checks the threshold, takes **a lock atomically**
(`claimReloadSlot` → prevents a double charge on parallel requests) and calls
`createBillingOnDemand`. Credit + lock release happen in the IPN. If the charge
fails, the lock is released immediately.

**And it stops after two charges that nothing answered.** This is the part to
read before changing anything above it.

The lock has a six-hour stale timeout, so a crashed process cannot hold a slot
for ever. That is right — and it is also, when an IPN never arrives at all, the
interval at which the same charge repeats: the card is billed, the balance is
never credited, so the threshold is still undershot, and six hours later the
slot is taken over and the card is billed again. **Four times a day, for ever,
and under Digistore24's 10-per-day cap so nothing outside this app stops it.**

Nothing in that sequence looks like a fault. Every charge *succeeds*, no
exception is thrown, and the Member's own switch still reads "on". The only
anomaly is a credit that does not arrive.

So `token_accounts.reloadAttempts` counts the charges since the last one that
came back as a booked credit — incremented inside `claimReloadSlot`'s own atomic
`UPDATE`, so it cannot drift from the lock — and `reloadIsPaused()` refuses at
`RELOAD_ATTEMPT_LIMIT` (2). Two, because one unconfirmed charge is the normal
state of every healthy top-up while the IPN is in flight, and Digistore24 is
allowed to be slower than the stale timeout.

**Paused, not disarmed.** `autoReloadEnabled` stays `true` and the mandate is
untouched, because nothing about the Member's intent changed — only our
confidence that the charge reaches them. It resumes **by itself** the moment a
credit books, and the Member's own off/on switch clears the counter too.

Who finds out, and how:

| | |
|---|---|
| **The Operator, per Member** | a warning on `/dashboard/admin/users/<id>` — the page they open when a customer writes in |
| **The Operator, in total** | the scheduled job `check-stuck-reloads`, hourly, a bare count. It has to be a job: a Member stuck at a zero balance stops using the app, so `spendTokens` is never called again and nothing on the request path would ever notice |
| **The log** | one `console.error` naming the member id, in `node run.mjs logs` |

The Member is deliberately told nothing new: their setting is still on and still
what they asked for. What stopped is ours to fix.

**Do not add a second trigger.** Calling `autoReloadIfNeeded` yourself after
`spendTokens` charges twice as often for no benefit. A **cron** sweep across
accounts with a low balance is the one legitimate addition, and it replaces
nothing — it catches the Member who stops using the app mid-drain.

**Do not build a dashboard control that calls `setAutoReload({ enabled: true })`
with a `purchaseId` you chose.** Arming belongs to the IPN, which is the only
place that knows a mandate is real. The Member-facing switch is
`setAutoReloadEnabled`, which flips the flag and refuses when no mandate is
stored.

The threshold is **clamped below the package's credits** (`clampThreshold`).
A threshold at or above them is satisfied again the instant the top-up lands, so
the next spend charges the card again, and the next — a loop only Digistore24's
10-per-day cap ends.

Auto top-up is **disarmed automatically** when the purchase behind the mandate
is refunded or charged back, and when the account is blocked.

### Billing consumption

**The call your feature makes is `spendTokens` (`lib/tokens/spend.ts`).** It
charges the signed-in Member for what they just used and returns the balance
left over:

```ts
import { spendTokens } from "@/lib/tokens/spend";
import { TokenError } from "@/lib/tokens/rules";

try {
  const left = await spendTokens({ amount: 5, note: "report generation" });
} catch (err) {
  if (err instanceof TokenError) { /* t(err.code) — "insufficientBalance" */ }
  throw err;
}
```

**It takes no member id, and must never grow one.** The account charged is
always the session's own (`requireActiveUser()`, which also turns away blocked
accounts). A Server Action is an HTTP endpoint in its own right, so a
`memberId` read out of a `FormData` is an IDOR that drains another customer's
balance — and an optional parameter defaulting to the session does not fix
that, it just makes the bad call compile again. If you ever genuinely need to
charge somebody else (a team seat billed to the owner), write a separate
`spendTokensFor({ actor, memberId })` that opens with `requireOwner()` — the
same deal `adjustTokens` already makes.

Three more rules:

- **Check → work → charge, in that order.** Charging first bills for work that
  then fails; doing the work with no check in front gives the result away free,
  because by the time `spendTokens` throws, the expensive part has already run.
  Gate on `hasSufficientBalance` before starting. The remaining gap is bounded
  at one operation, and the row lock still stops a negative balance.
- **`amount` is your price, computed in code.** Taking it from the request lets
  the customer set it to 0 and use the app for free.
- **`note` is personal data.** It appears in `node run.mjs data-export`
  (`docs/data-protection.md`). Use a short label for what was charged, never the
  content the Member submitted.

Underneath, `consumeTokens` runs in a transaction with a row lock (`FOR UPDATE`),
so two requests racing on the same balance are serialised and neither can drive
it below zero. It throws `InsufficientTokensError`; `spendTokens` turns that into
the translatable `TokenError("insufficientBalance")` and writes nothing. Check
with `hasSufficientBalance` beforehand where you would rather offer a top-up
than show a failure. Every booking lands in the `tokenLedger` (audit).

`consumeTokens({ memberId, … })` stays exported as the primitive — it is what
the IPN and the Operator pages use, where the caller legitimately names somebody
else. Features do not call it.

**A spend is never gated on `billingMode`.** That switch is cosmetic
(`lib/billing-mode.ts`); refusing to spend in a subscriptions-only app would
strand customers who still hold a paid balance.

---

## 2. Subscription management (cancel · payment details · invoices)

The IPN maintains one row per subscription in `subscriptions` (status, interval and
the management links supplied by DS24). With that you offer in the customer dashboard:

| Function | Implementation |
|----------|----------------|
| **Status/interval** | `subscriptions.status` (`active`/`paused`/`cancelled`) + `billingInterval` (`1_month`/`12_month`). Shown to the customer; it is **not** the access check — see below. | <!-- not-an-access-check: display in the self-service UI -->
| **Cancel** | `stopRebilling(apiKey, ds24PurchaseId)`. Access remains until the end of the period (DS24 sends `last_paid_day`). Alternatively link the customer to `rebillingStopUrl`. |
| **Change payment details** | **No API** — link to the DS24 link `renewUrl` (the customer updates their payment data there). |
| **View invoices** | `invoiceUrl` per payment; history via `listPurchases(apiKey, { email })`. |

If links are missing in the IPN payload, load them with `getPurchase(apiKey, purchaseId)`.

```ts
import { stopRebilling } from "@/lib/digistore/billing";
import { ds24ApiKey } from "@/lib/digistore/settings";
// Cancellation after confirmation by the signed-in customer:
await stopRebilling(ds24ApiKey(), sub.ds24PurchaseId);
// The IPN sets it to 'cancelled' later. (not-an-access-check: display only.)
// The mirror row is not the access answer. The customer KEEPS access until
// DS24 sends last_paid_day — hasPlan() answers true until then.
```

**What the customer may use is a separate question**, and this table does not
answer it. `subscriptions` mirrors what Digistore24 believes about the billing;
`grants` is the app's own record of access, and `hasPlan(memberId, productKey)`
reads it. The gap between them is not academic: between the cancellation and
`last_paid_day` the mirror says "cancelled" and the customer is still entitled
to everything they paid for. See **`entitlements.md`**.

---

## Rules

- **Credit only through the IPN.** Never credit directly in the
  `createBillingOnDemand` call — otherwise a failed payment gets credited wrongly.
- **Idempotency.** Credits are unique over `(accountId, ds24OrderId)`; a
  duplicate IPN does not book again.
- **Lock against double charging.** Always run auto-reload through `claimReloadSlot`.
- **The signature check (SHA512) stays mandatory** — the IPN handler is fail-closed.
- **Writable key & passphrase are secrets** (they live in the `.env` or in the
  host's secret management, read via `lib/digistore/settings.ts`).
- Before changing this billing logic, read the skill **`guardrails`** first.
