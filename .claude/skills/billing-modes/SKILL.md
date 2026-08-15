---
name: billing-modes
description: Sets up the billing models beyond the one-off purchase — fixed subscriptions, usage-based prepaid tokens with auto top-up, and subscription self-service. Use this after setup-digistore, when the app is meant to bill recurring or by usage, and when the user says "a monthly membership", "cancellable at any time", "paid by use, not a flat fee", "a balance they top up and work through", or asks about tokens, auto top-up, cancellation, payment details or invoices.
requires: 0.14.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Billing models: subscriptions & prepaid tokens

Prerequisite: **`setup-digistore` is done** (API key, IPN, checkout are in
place). This skill builds on that. The code is ready to use in
`lib/digistore/billing.ts`, `lib/tokens/` and `db/schema-tokens.ts` — your job
is to guide the vendor through selection and configuration, **not** to rewrite
the billing.

Full reference with code examples: **`docs/digistore-billing-modes.md`**.

## Step 1 — Choose a billing model

Ask the vendor how billing should work (multiple choices possible):

| Model | When | What it needs |
|--------|------|----------------|
| **Fixed subscription** (monthly/yearly) | plannable access, membership | subscription plan(s) + subscription management |
| **Prepaid tokens** (usage) | AI usage, API calls, "pay per use" | token packages + consumption logic + auto top-up |
| **Both combined** | base subscription + usage on top | both building blocks |

A very common cut for AI apps: **a small base subscription + tokens by usage**.

**Write the answer down — one line, and the app follows it.** In
`config/digistore-products.json`:

```json
{ "billingMode": "subscriptions" | "tokens" | "both", "products": { … } }
```

You set this yourself, right after the vendor has answered. It turns off the
surfaces of the model they do not use: a subscription-only app stops showing a
token balance stuck at 0 and the correction form in the support screen, a
tokens-only app stops showing "next payment" and the plan list. Without it the
vendor is left looking at half an interface that never fills up, and asks why.

Two things to know before you set it:

- **It is cosmetic, and deliberately so.** `hasPlan()`, `consumeTokens()` and
  the IPN behave the same in every mode, and a mode only ever hides an **empty**
  card. Somebody who still holds tokens keeps seeing them after a switch — the
  flag is a layout decision, and a layout decision must not revoke what was paid
  for. The one exception is the manual balance correction, which mints tokens:
  that follows the mode alone and refuses in a subscriptions-only app.
- **Then take the products you do not sell out of the offer** — either delete
  the entry, or park it with `"sell": false`, which keeps it in the file as a
  shape to copy from while no Digistore24 product is created for it and `/plans`
  leaves it out. The two must agree — `lib/billing-mode.test.ts` fails the build
  on a token package that is still ON SALE in a `"subscriptions"` app, because
  `ds24-sync` would create it at Digistore24 and it would be buyable while the
  app renders nothing that credits it. A parked one is skipped by that check, so
  you no longer have to delete a package to set `"subscriptions"`.
  *(`"sell"` needs template 0.30.0.)*

Reference: `lib/billing-mode.ts`.

## Step 2 — Create products (registry)

Every offering (subscription plan **and** token package) is **one Digistore24
product**. Declare them in **`config/digistore-products.json`** (`kind`, name,
description, `priceCents`, for subscriptions `billingInterval`, for tokens
`credits`). Then create them — **you run this yourself**, do not ask the user to
type it:

```bash
node run.mjs ds24-sync
```

🚨 **The first run refuses, on purpose.** It prints every product that would be
NEW at Digistore24, says that creating them cannot be undone from here, and
stops — nothing is created (and nothing is updated: the refusal ends the whole
run), and the IPN is not registered yet. Read the list out to the user; park
what they do not sell with `"sell": false`, and confirm what remains with
`node run.mjs ds24-sync --create-new` — parking alone only gets through when
nothing NEW is left on the list, so a run that still creates anything needs the
flag. Once every offering carries an id nothing is being created and later runs
pass straight through without it. *(Needs template 0.30.0.)*

That writes the id(s) back into `productIds.<env>` (one Digistore24 product
per offer, language **and environment** — a DS24 product carries exactly one
language, the buyer's order form; a plain run on your machine maintains the
dev set) and registers that environment's IPN. Use
the `make` target, **not** `node scripts/ds24/sync-products.mjs` directly — the
script alone skips the IPN hookup, and purchases then never unlock anything.

**No payment plans in the DS24 interface.** Price, currency and interval come
from the registry and travel with the checkout call as `payment_plan[...]`.
Each environment sells its own product set (see `docs/environments.md`).

Checkout for a signed-in Member runs through **`checkoutLinkFor`** from a
server action, carrying `buildIdentity({ memberId, checkoutToken, productKey,
kind })` in `tracking[custom]`; blueprint: `app/plans/actions.ts`. For anonymous
visitors it is **`checkoutLinksFor`** (the shared, cached links). Never a plain
product link.

### Where the buyer lands afterwards — and what they are told

The purchase does not end at the payment. Digistore24 sends the buyer to
`/optin/[orderId]`, which polls until the IPN has created the order and then
routes them on:

- **signed in, the order is theirs** → `redirect("/dashboard?purchase=<id>")`,
  and the dashboard names what they bought.
- **not signed in** (buying without an account is a supported path) → the page
  stays and offers the way in, naming the address to sign in with. Their
  purchase is attached at that first sign-in.

**This is the feedback case people get wrong, so it is worth stating.** A
`redirect()` is where "every action reports back" quietly stops: the code that
knows the purchase succeeded ends by sending the person elsewhere, and the page
they land on says nothing. The template has a mechanism for exactly this —
**`<FlashToast>`** (`components/flash-toast.tsx`): it fires once and then strips
its query parameter, so a reload does not repeat the message.

**Never put the message in the URL.** The parameter carries a *reference*; the
receiving page resolves it — `purchaseNoticeFor(memberId, ds24OrderId)` in
`lib/digistore/member-billing.ts`, scoped to the signed-in member, so one
customer's link can say nothing on another's screen. It answers "which plan was
unlocked" or "how many tokens were credited", the credits taken from
`orders.credits` (recorded at payment time), never from the live registry.
Nothing is said for an order that is not `paid` — a refund must not be
congratulated. The rule is pure and tested:
`lib/digistore/purchase-notice.ts`.

Build any further post-purchase feedback the same way. The full table of the
three feedback mechanisms is in `CLAUDE.md`, under **UI**.

## Step 3 — Fixed subscription (if chosen)

Plan as a product with `kind: "subscription"` + `billingInterval` (`"1_month"` /
`"12_month"`) and `priceCents`. Both travel with the checkout call, so nothing
is maintained inside DS24. The IPN maintains status and management links in the
table **`subscriptions`**.

Build the **subscription self-service** into the customer dashboard:
- Show the billing state: `subscriptions.status` + `billingInterval`. <!-- not-an-access-check: displayed to the customer -->
  Information for the customer, **never** the access check — that one is
  `hasPlan(memberId, productKey)`, see `docs/entitlements.md`.
- **Cancel** → `stopRebilling(apiKey, ds24PurchaseId)` (after confirmation by
  the signed-in customer). Access stays until the end of the period — the
  entitlement ends on `last_paid_day`, not on the cancellation.
- **Change payment details** → link to the DS24 `renewUrl` (no API of your own).
- **Invoices** → `invoiceUrl` per payment; history via `listPurchases`.

## Step 4 — Prepaid tokens (if chosen)

1. **Packages** are products with `kind: "token"` in the registry (`credits`,
   `priceCents`) — created via `node run.mjs ds24-sync` (step 2).
2. **Purchase**: the identity string carries the product key, so the IPN knows
   which package to book (`p:<productKey>`). `tokens:<key>` remains only for
   anonymous checkouts and for purchases made before this shipped. Either way
   `forceRebilling` (`settings[force_rebilling]=Y`) is set automatically.
   **`forceRebilling` is not optional:** it stores the payment details and thus
   creates the chargeable `purchase_id`. Without it, step 5's auto top-up has
   nothing to charge against and silently cannot work.
3. **Crediting**: happens automatically in the IPN (`creditTokens`, idempotent)
   — don't credit anything synchronously. It requires an attributed payment:
   a purchase made without signing in is credited when the buyer first signs
   in, not at payment time.
4. **Consumption**: `spendTokens({ amount, note })` from `lib/tokens/spend.ts`,
   on every use. It charges **the signed-in Member** — it takes no member id,
   and that is the point:

   ```ts
   import { getTranslations } from "next-intl/server";

   import { requireActiveUser } from "@/lib/authz";
   import { getTokenAccount, hasSufficientBalance } from "@/lib/tokens/account";
   import { spendTokens } from "@/lib/tokens/spend";
   import { TokenError } from "@/lib/tokens/rules";

   export async function generateReportAction() {
     const session = await requireActiveUser();
     const t = await getTranslations("errors");
     // CHECK first — see below for why.
     const account = await getTokenAccount(session.user.id as string);
     if (!hasSufficientBalance(account?.balance ?? 0, 5)) {
       return { error: t("insufficientBalance") };
     }
     try {
       const report = await buildReport();          // then the work
       await spendTokens({ amount: 5, note: "report generation" });
       return { ok: true, report };
     } catch (err) {
       if (err instanceof TokenError) return { error: t(err.code) };
       throw err;
     }
   }
   ```

   Four rules that go with it:

   - **Check → work → charge, in that order.** Charging first bills for work
     that then fails; doing the work with no check in front gives the result
     away free, because by the time `spendTokens` throws, the expensive part
     has already run. That second one is the mistake that actually gets made.
   - **The price is yours, never the request's.** `amount` comes from what was
     done, in code. Read it from a form and the customer sets it to 0.
   - **Never pass a member id.** `consumeTokens({ memberId })` is the primitive
     underneath and belongs to the IPN and the admin pages. A Server Action is
     an HTTP endpoint of its own, so `memberId` out of a `FormData` is an IDOR
     that drains somebody else's balance.
   - **`note` is personal data** — it reaches a subject access request
     (`docs/data-protection.md`). A short label for WHAT was charged, never what
     the Member wrote.

   A shortfall throws `TokenError("insufficientBalance")` and writes nothing.
   `spendTokens` is **not idempotent** — two submissions charge twice, so keep a
   double-click off with `disabled={isPending}`.
5. **Auto top-up is already wired end to end** — you do not call anything:
   - The buyer ticks a checkbox on the token card at `/plans`. The wish travels
     as one more pair in `tracking[custom]` (`r:1`), because at checkout time
     the chargeable `purchase_id` does not exist yet.
   - The **IPN arms it** once the payment confirms and the mandate exists
     (`shouldArmAutoReload` in `lib/digistore/attribution.ts`) — only on a
     resolved identity, and only on the delivery that actually booked the
     credit, so a retry cannot re-arm what a Member turned off.
   - **`spendTokens` triggers it** after every successful debit. A failed charge
     is logged and swallowed: the Member's operation already succeeded and was
     already paid for, so it must not report an error.
   - The Member sees the state and can turn it off on the **Tokens** tab of
     `/dashboard/billing`.

   `setAutoReload` and `autoReloadIfNeeded` remain exported for a cron sweep
   across low balances, which is more robust than the inline trigger if your app
   has a scheduler. The credit **always** arrives by IPN — never credit in the
   charge path.

### How the on-demand charge works

`createBillingOnDemand` charges against an **existing `purchase_id`** (no new
checkout). Prerequisites: a writable key + the DS24 permission "billing on
demand" + a chargeable purchase_id — a subscription, or a purchase that was
bought with `settings[force_rebilling]=Y` (see step 4.2). DS24 limit: 10
charges/day, 1/minute per purchase_id.

## Step 5 — Tests & database

- Apply the schema: `node run.mjs db-migrate` (the migration for
  `subscriptions`/`token_accounts`/`token_ledger` is already in `drizzle/`).
  Pour your own schema changes into a migration with `node run.mjs db-generate` first.
- **Write tests** for your billing rules (models: `lib/tokens/tokens.test.ts`,
  `lib/digistore/billing.test.ts`). `npm run typecheck && npm run test` must be
  green.

## Next step

Once the billing is in place, before the launch in this order:
**`ux-gateway`** → **`security-gateway`** → **`performance-gateway`** →
**`compliance-check`** → **`go-live`** → **`go-to-market`**.

## Important rules

- **Crediting exclusively through the IPN.** A `createBillingOnDemand` call
  **never** credits directly — otherwise balance would wrongly be booked when a
  payment fails.
- **Idempotency & lock are mandatory.** Credits are unique via `(accountId,
  ds24OrderId)`; auto top-up only runs through `claimReloadSlot`.
- **Never switch off the signature verification (SHA512)** — the IPN handler is
  fail-closed.
- **No mock/demo fallback** on DS24 API errors — throw errors.
- **For changes to the billing logic, read `guardrails` first** (STOP
  criterion).
