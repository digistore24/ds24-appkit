<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Checkout links with `createBuyUrl`

The app creates checkout URLs at runtime via the Digistore24 function
`createBuyUrl` and sends a **complete custom payment plan** along with it —
so price, currency and interval are decided by the app, not by the Digistore product.
**One** base product in Digistore24 per offer is enough.

Implementation: `lib/digistore/buyUrl.ts`.

## Usage

**Most of the time there is nothing to build here.** A plan out of
`config/digistore-products.json` gets its link from `checkoutLinkFor(def, ctx)`
(one offering, click time) or `checkoutLinksFor(defs, ctx)` (a whole page) in
`lib/digistore/checkout.ts`. Those wrap everything below — the offer mapping,
the thank-you URL, the cache *and* the DEV test-payment parameter — and they
return `{ url: null, blocker }` instead of throwing, so a page never renders a
dead button. Reach for them first.

`/plans` uses **both**, and which one depends on whether anybody is signed in
(`app/plans/page.tsx`):

- **Signed in → built on click.** A button posts to a server action
  (`app/plans/actions.ts`), which calls `ensureCheckoutToken(memberId)` and then
  `checkoutLinkFor(def, { buyer, customTracking: buildIdentity({ … }) })`. The
  identity travels to Digistore24 in `tracking[custom]` and comes back on every
  later event, which is how the payment finds its owner even when the buyer paid
  under a different address. Nothing is asked of Digistore24 while the page
  renders.
- **Signed out → the shared cached link.** `checkoutLinksFor` maps registry
  entries onto offers, sets the thank-you URL (`/optin/[ORDER_ID]`) and returns
  `{ url }` or `{ url: null, blocker }`.

Both need a **`writable`** key.

The layer underneath, for a checkout you genuinely build yourself:

```ts
import { getOrCreateBuyUrl } from "@/lib/digistore/buyUrl";
import { withTestpayParam } from "@/lib/digistore/testpay";
import { ds24ApiKey } from "@/lib/digistore/settings";

const url = await getOrCreateBuyUrl({
  apiKey: ds24ApiKey(),                // writable key needed (from the .env)
  offer: {
    key: "gold",                       // stable offer key
    productId: "123456",               // DS24 base product
    priceCents: 900,                   // 9.00 EUR
    currency: "EUR",
    billingInterval: "1_month",        // omit = one-off payment
    title: "Paid Challenge - Gold",    // placeholder {TARIF} on the checkout page
    description: "Gold plan (monthly)",
  },
  thankyouUrl: `${appUrl}/optin/[ORDER_ID]`, // DS24 replaces [ORDER_ID]/[BUYER_EMAIL]
});

// The last step, and it is not optional — see below.
// In DEV this appends the test-payment parameter; everywhere else it is a
// no-op, and it never throws.
return await withTestpayParam(url);
// -> open the returned url for the buyer (link/redirect)
```

## The language is NOT set here — it comes from the product

There is no language parameter on `createBuyUrl`, and that is not an oversight
to work around: **the order form's language is a property of the Digistore24
product** (`data[language]`), and a product carries exactly one. Whatever you
pass here, a buyer sent to the German product fills in a German form.

So the language is chosen one level up, by choosing *which product* to send
them to. `config/digistore-products.json` holds one id per language and
environment (`productIds`), and `checkoutLinkFor(def, ctx, locale)` /
`checkoutLinksFor(defs, ctx, locale)` resolve the visitor's locale to the right
one. Reach for those and it is already handled; the full reasoning is in
[`digistore-integration.md`](digistore-integration.md) → *The order form's
language*.

If you build your own path on `getOrCreateBuyUrl`, that resolution is yours:

```ts
import { checkoutProductFor } from "@/lib/digistore/products";

const chosen = checkoutProductFor(def, locale);   // { productId, language } | null
```

⚠️ **And then `offer.key` must carry the language too** — see the caching rule
directly below. It is one cache row per key, so two languages sharing a key
serve each other's checkout URL.

## Caching (important)

- URLs are cached per `offer.key` in the table `buy_url_cache`,
  **TTL 20h** (safety margin below the 24h validity of the DS24 URL).
- **`offer.key` includes the language** — `offerFor()` builds it as
  `"<productKey>:<language>"`. There is one row per key, so a shared key would
  let the German and the English checkout URL evict each other on every page
  view and, in the window between, hand the German form to an English buyer
  straight out of the cache. The `offerHash` does not save you here: it detects
  that the offer changed, it does not give the two a row each.
- **If the offer changes** (price, interval, title, thank-you URL …), the
  `offerHash` changes → a **new URL** is created automatically.
- **User-specific URLs are never cached**: as soon as `buyer`, `affiliate`,
  `campaignKey`, `trackingKey` or `upgradeOrderId` is set, a fresh one is
  created every time — and likewise when `customTracking` carries a buyer
  identity (`m:<memberId>;t:<token>;…`), which names one particular member.
- `customTracking` is judged by its **content**, not by whether it is set. A
  token package sets it on every offering (`tokens:<key>`), and those URLs
  stay shared — otherwise every token card would trigger a live Digistore24
  call on each page view. See `lib/digistore/custom.ts`.

## Test payments in DEV — the link is not finished without it

`getOrCreateBuyUrl` and `createBuyUrl` return an **undecorated** URL. In DEV a
checkout link additionally carries the Digistore24 **test-payment parameter**,
and that is what makes a local test purchase a single click: the checkout opens
in test mode, on a product the marketplace has not approved yet, with no cookie
to set. The parameter is fetched once via the undocumented `getTestpayKey`
(name, value and `expires_at` all come from the response) and cached in
`.dev/testpay.json`. `node run.mjs ds24-testpay` shows it, `--recreate` rotates
it.

```ts
import { withTestpayParam } from "@/lib/digistore/testpay";

return await withTestpayParam(url);   // the last step of any checkout path
```

Forgetting it does not break anything visibly — which is why it gets forgotten.
The app works, the checkout opens, and the developer simply has no way to buy
anything locally and goes looking for the cookie instead.

Four rules, and the first two — WHEN the parameter may exist, and WHERE it may
go — are the ones that matter:

- **DEV and localhost only.** ⚠️ The parameter takes **test payments**: anyone
  who opens a link carrying it gets the product **without paying**, and the IPN
  that follows grants real entitlements. So it must never reach a URL a customer
  can open. You do not implement that check — `withTestpayParam()` re-checks
  `isTestpayActive()` itself on every call, an allowlist where anything not
  clearly recognised as development counts as production (a typo in `APP_ENV`
  lands on "production", not on "development"). **Never re-implement or loosen
  that gate at a call site, and never append the parameter by hand:** the key is
  **account-level**, so pasted onto a live checkout URL of the same vendor
  account it unlocks free purchases there too. Treat it like a secret; that is
  why it lives in gitignored `.dev/` and never in `.env`. Hard off:
  `DS24_TESTPAY=off`.
- **Only onto a Digistore24 checkout host**, and the list of them is
  `DIGISTORE_CHECKOUT_HOSTS` in `lib/digistore/config.mjs`. ⚠️ **The checkout
  does not run on the API domain.** `createBuyUrl` answers with
  `https://www.checkout-ds24.com/...` — a *different registrable domain* from
  `digistore24.com`, and an allowlist that knew only the latter dropped the
  parameter from every single link in DEV. Nothing was red: the app ran, the
  page rendered, the suite was green, and the developer met *"Das Produkt wurde
  noch nicht genehmigt."* on a product that is simply not approved yet. Matching
  is the exact host or a dot-boundary subdomain — `notdigistore24.com` and
  `checkout-ds24.com.evil.example` are refused, and there is a test for each. If
  Digistore24 ever adds a third domain, that list is the one line to change.
- **After the cache, never before.** Decorate the **return value**, as above.
  `getOrCreateBuyUrl` writes its result into `buy_url_cache`, a table keyed per
  offering with no member dimension — a decorated URL written there is handed to
  every later visitor. This is why `lib/digistore/buyUrl.ts` deliberately does
  not decorate, and `lib/digistore/checkout.test.ts` fails the build if the call
  moves into it.
- **It never breaks the checkout.** No API key, a DS24 error, a timeout, an
  unwritable `.dev/`, an unknown host — every failure returns the undecorated URL
  with one `console.warn`, and a failed fetch is not retried for ~5 minutes. The
  host case is the one that used to be silent; it now names the host and says
  where the list lives, once per host per process rather than once per plan card.

Outside DEV — a STAGING domain, or the live one before approval — the way to a
test purchase is the vendor's
[test-purchase cookie](https://help.digistore24.com/hc/de/articles/23901169396241),
set once per browser.

## Rules (from the reference implementation)

- Bracket notation for nested parameters (`payment_plan[first_amount]`).
- Price as a euro string with a dot (`"9.00"`), not in cents, not with a comma.
- `number_of_installments = 0` means an **unlimited subscription** (not "no payment").
- The thank-you URL must be **HTTPS**, otherwise Digistore rejects it.
- API base from `lib/digistore/config.mjs` (`https://www.digistore24.com`) —
  the same for every installation, so not a `.env` value.
- On an invalid affiliate code it is retried once **without** the affiliate.
