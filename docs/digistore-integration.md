<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Digistore24: the integration, and the two shapes of app it serves

Three things connect this app to Digistore24, and they are the same three in
every app built on this template:

| | What it is | Where it lives |
|---|---|---|
| **The API key** | what lets the app call the Digistore24 API at all — fetched interactively through the browser, never typed into a form | `lib/digistore/settings.ts`, `scripts/ds24/connect-api-key.mjs` |
| **The IPN** | Digistore24's webhook. Every payment, refund, chargeback and cancellation arrives here, SHA512-signed | `app/api/ipn/route.ts`, `lib/digistore/ipn.ts`, `lib/digistore/payment-event.ts` |
| **The checkout** | `createBuyUrl` with a complete payment plan attached, so price and interval are decided by the app | `lib/digistore/checkout.ts` → `lib/digistore/buyUrl.ts` |

What differs between apps is **whose Digistore24 account the money lands in**,
and that is a fork with consequences all the way down to the database. Decide it
before you build billing, not after. Both answers are written out here so that
neither of them has to be researched.

## Pick the shape first

| | **A — one vendor** | **B — platform** |
|---|---|---|
| Who sells | the operator of the installation, and nobody else | every user of the app, each through their own Digistore24 account |
| Whose account is paid | the operator's | the user's |
| How many API keys | exactly one, in the `.env` | one per connected user, in the database |
| Who connects | the operator, once, in the terminal | each user, in the app, whenever they like |
| Needs a **Developer** API key of its own | no | **yes** |
| Status in this template | **built. Nothing to design** | **not built.** This doc is the build guide |

**Shape A is the default and covers most apps.** "I sell a SAAS product" is
shape A. Someone signing up is a *customer*, and customers do not sell anything.
Build shape B only when the app's own users need to take money from *their*
customers — a course platform, a booking tool for coaches, a shop builder. If in
doubt, ask the one question that settles it: *does anyone other than the operator
get paid?* No → shape A.

Do not build shape B "just in case". It multiplies the API key, the IPN
passphrase, the product list and the order table by the number of tenants, and
every one of those is money-relevant.

## The words

Six roles, and two of them are routinely confused into a money bug. Read this
once; the rest of the doc uses these terms exactly.

| Term | Who | In shape A | In shape B |
|---|---|---|---|
| **operator** | whoever runs this installation — usually the developer reading this | the one and only seller | runs the platform, sells nothing through it |
| **vendor** | whoever's Digistore24 account is being called or paid | the operator | a user of the app who connected their own account |
| **buyer** | whoever hands over money | a customer of the operator | a customer of *that vendor* |
| **Member** | a signed-in user of this app (`users`, `orders.memberId`) | the same person as the buyer | the **vendor**, or the buyer, or neither — see below |
| **developer key** | identifies the *calling application*, grants no account access | the one the app kit ships with | **your own** |
| **API key** | grants access to one Digistore24 account (`writable` here) | one, in the `.env` | one per vendor, in the database |

Two consequences of that table, both worth pinning down before writing code:

- **"vendor" is relative, not absolute.** Wherever this doc or the API reference
  says "the vendor's key", in shape A that simply *is* `ds24ApiKey()` from the
  `.env`. Nothing is missing there.
- **In shape B, buyer and Member come apart.** A vendor's buyer usually has no
  account in your app at all, while the vendor does. `orders.memberId` means
  *buyer* everywhere in this template, so the vendor needs a column of its own —
  shape B, step 1.

---

## Shared mechanics

True in both shapes; read this once.

### The API

Base `https://www.digistore24.com/api/call/<function>/format/json`, POST,
form-urlencoded, the key in the **`X-DS-API-KEY` header** — not as a parameter.
A response is only a success when `result === "success"`; anything else throws.
`lib/digistore/client.ts` (app) and `scripts/ds24/_client.mjs` (scripts) are the
only two places that speak HTTP to Digistore24. Do not add a third.

Two traps, each of which has already cost a day here:

- **Booleans arrive as the strings `"Y"` / `"N"`.** Both are truthy in
  JavaScript, so `if (res.created)` is true even when nothing was created. Use
  `isYes()` (`scripts/ds24/_client.mjs`).
- **No mock fallback, ever.** A failed API call throws. A checkout that silently
  "succeeded" without a Digistore24 URL is a lost sale that looks fine in the
  logs.

Full function reference: <https://www.digistore24.com/api/docs/index.html>
(Swagger; the machine-readable spec is `openapi.yaml` next to it). Look a field
name up there rather than guessing it.

### How an API key comes into being

Digistore24 has no client-secret handshake. Instead there is an interactive flow
that a **developer key** starts on behalf of a vendor. A developer key carries no
account permissions of its own — it identifies the *calling application*, the way
an OAuth client id does. Only the vendor's approval in the browser mints a key
with permissions, and that key belongs to the vendor's account.

```
requestApiKey(permissions, return_url, …)     ← authenticated with the DEVELOPER key
    → { request_url, request_token }
       send the vendor's browser to request_url; they sign in and approve
retrieveApiKey(token = request_token)          ← authenticated with the DEVELOPER key
    → { api_key, request_status: pending | aborted | completed, note }
```

- `permissions` is `read-only` or `writable`. **This template needs
  `writable`** — it creates products and generates checkout links, and both
  write.
- **`retrieveApiKey` is a question, not a delivery.** A not-yet-approved request
  answers `result: "success"` with `request_status: "pending"`, so asking again
  is the documented way to wait. This is why nothing has to be delivered to the
  waiting machine, and why `connect-api-key.mjs` needs no local web server.
- `return_url` decides only where the browser is left standing afterwards. It is
  **not** how you learn the approval happened — do not build on that.
- Digistore24 accepts **public https URLs only**, for `return_url` and
  `site_url` alike. An `http://localhost` is rejected outright.
- Undocumented but real: on some accounts `retrieveApiKey` also returns
  `thankyou_page_key`, which is usable as the IPN passphrase. `connect-api-key.mjs`
  saves it when it is there.
- **Disconnecting** is the API function `unregister`, called with **that
  vendor's** key (not the developer key). It deletes the key server-side
  *together with the IPN connections belonging to it*. Delete your stored copy
  afterwards.

Reference: [How to generate an API key interactively](https://dev.digistore24.com/hc/en-us/articles/32486158815121-How-to-generate-an-API-key-interactively).

### Localhost URLs travel through the redirect

That https-only rule holds for **every** URL the API is handed — thank-you and
opt-in pages just as much as `return_url`. Handing Digistore24 the address the
app actually runs on locally ends the call on the spot (*"Please only use
secure URLs with https://"*). So every such URL travels as a redirect address
that leads back to your machine:

```
http://localhost:3000/optin/[ORDER_ID]
  → https://ds24-appkit.com/redir/?port=3000&path=/optin/[ORDER_ID]
```

The `return_url` of the key flow travels the same way, to
`http://localhost:<port>/ds24-connected` — a page of the app itself
(`app/ds24-connected/page.tsx`). Neither that page nor the redirect ever sees the
API key; the script fetches it from Digistore24 directly.

That happens by itself — in the scripts (`scripts/ds24/_public-url.mjs`) and in
the checkout at runtime (`lib/digistore/public-url.ts`). The two are twins;
change one, change the other. Never hand a raw localhost URL to the Digistore24
API, and do not "fix" a rejection by inventing an https address that nothing
answers on — the call would succeed and every visitor would land nowhere.

The IPN endpoint is the one place the redirect cannot serve: Digistore24 calls
that URL *itself*, so `/redir/` would land on the Digistore24 server's own
localhost. The IPN needs a genuinely public URL — locally that is the Quick
Tunnel (`docs/environments.md`) — and `ipnSetup` enforces it by fetching the
address and insisting on HTTP 200, refusing even a 301/302 (next section).

### The IPN

`app/api/ipn/route.ts` does three things and nothing else: verify the SHA512
signature, answer the connection test with `OK`, hand a verified payload to
`onPaymentEvent()`. The signature check stays at the edge and stays first.

- **Fail closed.** No passphrase or a bad signature → `403`, nothing is
  processed. Never loosen this.
- **Digistore24 retries until it gets a 200.** So a handler that throws is
  correct behaviour, and a handler that swallows an error silently loses a
  payment for good — the event is never redelivered.
- `ipnSetup` verifies the URL by **fetching it and insisting on HTTP 200**
  (a 301/302 is refused too), which is why the endpoint answers `GET` with `OK`
  and why localhost cannot be registered.
- Every event, every payload field and the exact signature algorithm:
  [Events](https://dev.digistore24.com/hc/en-us/articles/32480561422353-Events).
  On a rejected IPN, do not guess — `node run.mjs ds24-ipn-verify` recomputes
  the signature over the raw body that actually arrived.

#### Registering it: two parameters decide whether events arrive

`ipnSetup` is **both the setup and the update** — the same call, and the
`domain_id` decides which: an existing connection for that id is updated, an
unknown one creates a second connection.

**`domain_id` must be unique, and a readable name is not.** Digistore24 finds a
connection by **(merchant, API key, `domain_id`)**. So `test-local-1`,
`local-app` or `myapp` is not a name but a collision waiting for the vendor's
second project: the two do not get two connections, they take turns overwriting
one. The later `ds24-sync` re-points the earlier app's IPN at its own address,
and that app's purchases then arrive nowhere — both runs report success, and
nothing anywhere reports the loss. **Put something random in it**
(`local-my-app-diw2hvnz73`). `ipn-setup.mjs` does that by itself for any id it
derives; an id you pass with `--domain` is yours to make unique.

**`product_ids` says which products the connection covers**, comma-separated
(`111,222,333`); Digistore24's default is `all`. `node run.mjs ds24-sync` sends
the ids from `config/digistore-products.json` once the product sync has written
them back, because a vendor's account usually sells more than this app — naming
them is what lets two apps of the same vendor be connected at once. `all` stays
safe here rather than merely tolerable: an order for a product the registry does
not know is recorded and **grants nothing** (`resolveProduct()` in
`lib/digistore/payment-event.ts` returns `null`), so foreign purchases are
ignored, not mis-granted. What `all` costs is the separation.

#### "The purchase worked but nothing happened" — ask Digistore24

```bash
node run.mjs ds24-purchase --order ABC12345      # --json for everything
```

`getPurchase` returns Digistore24's own view of one order: status, product,
buyer, billing type, next payment and the management links. It is read-only, and
it splits the complaint in two:

- **Digistore24 does not know the id** → no purchase happened, or it happened in
  another vendor account. Nothing here is broken.
- **Digistore24 knows it and `/dashboard/admin/purchases` does not** → the order
  was paid and no IPN reached this app. That is the connection: a URL that no
  longer answers (a closed tunnel), a `domain_id` another project overwrote, or
  a `product_ids` list this product is not in.

For an IPN that *did* arrive and was rejected, the other command is the one:
`node run.mjs ds24-ipn-verify` recomputes the signature over the stored body.

Fields worth knowing before you design anything:

| Field | Why it matters |
|---|---|
| `merchant_id`, `merchant_name` | **who sold.** The vendor's numeric id and Digistore24 name |
| `ipn_config_api_key_id` | the numeric prefix of the API key whose connection this is — for key `12345-xxxx`, `12345`. **Present on order events, absent on the connection test** |
| `ipn_config_domain_id` | the `domain_id` passed to `ipnSetup` |
| `custom` | whatever the app sent as `tracking[custom]`, returned on *every* later event for that purchase. Documented as `string(63)`, and the identity pairs already fill most of it |
| `api_mode` | `live` or `test`. Test purchases arrive as `test` — whether made with the test-purchase cookie or with the testpay parameter that DEV checkout links append by themselves (`node run.mjs ds24-testpay`). The template deliberately processes `test` events exactly like `live` ones: that identical path is what makes a test purchase prove the chain. An operator who wants test orders segregated in PROD branches on this field — nothing in the template does |
| `order_id` | stable across all transactions of one order → the idempotency key, **and the key everything downstream hangs on**: the grant, the subscription mirror and the auto top-up mandate are all stored under it (columns named `ds24_purchase_id`, for historical reasons). A refund carries the same value as the payment it reverses, which is what lets it close what the payment opened |
| ~~`purchase_id`~~ | 🚨 **there is no such IPN field.** It is in no parameter table Digistore24 publishes, and a captured live `on_payment` of 173 parameters does not carry it (`lib/digistore/ipn-vectors.json` → `captured-on-payment`). The name belongs to the **API**, where `getPurchase` documents it as *"the Digistore24 order id"* — the same value, under a different name, in a different place. Reading it out of a payload is what cost every app built from this template its grants: the order was written, the webhook answered 200, and the paying customer got nothing (`lib/digistore/payment-event.ts` carries the post-mortem; `lib/digistore/ipn-fields.test.ts` is what now refuses the whole class) |

### 🚨 Replay — the signature does not stop it, and neither does the handler

`lib/digistore/ipn.ts` verifies the SHA512 signature timing-safely, fail-closed,
at the edge, before anything else runs. That answers *did Digistore24 write this*.
It does **not** answer *have I seen it before*: there is no timestamp check and
no nonce, deliberately — Digistore24 **redelivers an event until it receives
`OK` with HTTP 200**, so a handler that refused a repeat would break the retry
that makes the whole chain reliable.

So a redelivery replays `onPaymentEvent()` from its first line, and the reason
that is safe today is **three UNIQUE constraints**, not the webhook:

| | |
|---|---|
| `orders.ds24OrderId` | `onConflictDoUpdate` — and its `set` is written so money moves in ONE direction (a refunded order cannot flip back to paid) |
| `invoices.ds24TransactionId` | `onConflictDoNothing` — one invoice per payment, a retry adds none |
| `(accountId, ds24OrderId)` on the token ledger | what makes a double credit impossible; `creditTokens()` reports `credited: false` on the second run |

⚠️ **That is a property of those three write paths, and nothing else inherits
it.** Whatever you hang off this event — a welcome mail, a module's own hook, a
table of your own — is replayed with it and must carry its own idempotence. The
rule is the one `CLAUDE.md` already states for scheduled jobs, one door over:
*it must be safe to run twice*. Deleting rows older than a cutoff is idempotent;
**sending a mail is not**, unless the sender records that it sent one —
`claimSend()` in `lib/notify/`, claim before you send.

The failure mode is quiet and it is not rare: a retry is the NORMAL path after
any transient error, so "it worked when I tested it" and "it sends one mail" are
different statements. If you need the stronger guarantee at the door rather than
per table, the shape is a dedup row on `(ds24_order_id, event)` written before
`onPaymentEvent()` — that is a deliberate design change, not a default, because
it also swallows the redelivery that a genuinely failed first attempt needs.

### The order form's language — one product per language

**A Digistore24 product carries exactly ONE language, and that language is the
language of the order form your buyer fills in** — the field labels, the
buttons, the payment-method names, the cancellation terms. It is
`data[language]` on the product, and **`createBuyUrl` has no parameter that
could override it** (its `expectedArgs` are `buyer`, `payment_plan`,
`tracking`, `urls`, `placeholders`, `settings` and `addons` — no language
anywhere).

So an app whose UI speaks German and English cannot send both audiences to one
product. One of the two would be asked for their card details in the other's
language, which is exactly the moment a purchase gets abandoned.

**Two products, one per language, is the only way**, and the registry says so:

```json
"basic_monthly": {
  "name": "Basic (monthly)",
  "priceCents": 1900,
  "sell": true,
  "productIds": {
    "dev":  { "de": null, "en": null },
    "prod": { "de": null, "en": null }
  }
}
```

(`sell` is optional and defaults to sold — see *Keeping an entry without
selling it* below. It is written out in the shipped entries so the switch is
visible rather than something you have to know about.)

`node run.mjs ds24-sync` creates one Digistore24 product per entry — with
`data[language]` set — and writes the ids back, **per environment**: `--env
dev|staging|prod` maintains one of the sets in `productIds` (default from
`APP_ENV`; dev/staging names carry a visible ` [DEV]`/` [STAGING]` suffix, and
all of the app's products sit in one Digistore24 product group — see
`docs/environments.md`). At checkout the visitor's locale picks which of the
running environment's products they are sent to
(`lib/digistore/products.ts` → `checkoutProductFor`).

### Nothing is created without your yes

🚨 **Creating a Digistore24 product cannot be undone from this repo.** Removing
the entry from `config/digistore-products.json` afterwards does not unpublish
it — the product stays in the vendor account and an existing checkout link
keeps working until somebody deactivates it in the Digistore24 backend, by
hand.

So `ds24-sync` refuses the first time it would create something. It prints
every row that would be NEW, says the step is irreversible, and stops without
writing anything — no product, no product group, and no IPN registration
either, so `APP_URL` being local does not put a Cloudflare tunnel up for a run
that was declined. Two ways on:

- `node run.mjs ds24-sync --create-new` — yes, that is the list.
- `"sell": false` on the entries you do not sell, then run it again.

**It only fires while something would be created.** An offering that has been
synced carries an id, so every later run passes straight through and updates
what is there; updates are reversible and are never gated. A sixth product
added next year asks again, because the irreversible step is per product.

### The two token packages the template used to ship

`config/digistore-products.json` ships three example offerings — two
subscription intervals and one token package — because that is the smallest set
that still demonstrates the two rules the rest of this file is about: one
product per language, and monthly-and-yearly naming both keys. It used to ship
five, and the other two were a price ladder. If you want one, this is the
shape; paste it beside `starter` and adjust:

```json
"pro": {
  "name": "Pro Tokens",
  "tagline": "For regular use",
  "description": "5,000 tokens as a one-off balance. No subscription.",
  "kind": "token",
  "credits": 5000,
  "priceCents": 3900,
  "currency": "EUR",
  "features": ["5,000 tokens", "No subscription", "Balance does not expire"],
  "imageUrl": null,
  "sell": true,
  "productIds": {
    "dev":  { "de": null, "en": null },
    "prod": { "de": null, "en": null }
  }
}
```

A `business` tier was 15,000 credits at 9,900 cents. Note that `/plans` lays
token packages out in a three-column grid
(`lib/digistore/plan-sections.ts`), so a ladder of three fills it; one package
on its own is a single card, which is also fine.

### Keeping an entry without selling it — `"sell"`

An entry with `"sell": false` stays in the registry as a shape to copy from,
and nothing offers it: no Digistore24 product is created, `/plans` leaves it
out, and the checkout Server Action refuses it — which matters because that
Action is an HTTP endpoint, so removing a card from the page does not remove
the route behind it.

**A missing `sell` means SOLD.** Every registry written before the field
existed keeps selling, and only a literal `false` parks an entry; anything else
(`"false"` as a string, `0`, `null`) is refused when the registry loads rather
than guessed at, because the truthy reading would put a product on sale.

🚨 **Parking is about SELLING, never about ACCESS.** Whoever bought the
offering keeps it: `hasPlan()` and `entitlementsFor()` still answer for it, the
IPN's reverse lookup still resolves its product ids, and the IPN connection is
still scoped to include them — so rebills, refunds, chargebacks and missed
payments all keep arriving. An automatic top-up armed on a parked token package
also keeps running: the member asked to be charged while it was on offer, and
taking it off offer is not a reason to stop.

It is also the gentler answer to a `billingMode` contradiction. Switching an
app to `"subscriptions"` used to mean DELETING its token packages to get past
the refusal; parking them does the same and keeps the text.

Four things follow, and none of them is optional reading:

- **Cover every locale from `i18n/config.ts`.** A locale with no entry still
  sells — the buyer falls back to another language's product rather than
  hitting a dead button — but they get the wrong form. `ds24-sync` warns about
  the gap; nothing else ever will, because the app renders fine and the
  purchase completes.
- **Each language product is approved separately**, at the marketplace its
  language belongs to (see the next section). Approving the German one says
  nothing about the English one.
- **The IPN names whichever product was actually bought**, and
  `productByDs24Id()` searches every language of every offering. One
  `productKey`, one entitlement — a German and an English buyer of the same
  plan get the same access.
- **Your product copy is NOT translated.** `name`, `description`, `tagline` and
  `features` stay one text and are sent to every language product. That is the
  same deliberate decision the plans page makes (CLAUDE.md →
  Languages): it is your copy, and Digistore24 carries exactly what you wrote.
  The *form* around it is what follows the buyer's language.

> **Since template 0.6.0.** Before that an offering had a single `productId`
> plus a `language` field, and the order form's language was whatever the API
> session happened to default to. And before template 0.14.0 every environment
> shared one `productIdByLanguage` map. Both shapes are still read (as the
> PROD set), so an older registry keeps selling, and `ds24-sync --env prod`
> migrates them into `productIds.prod` the next time it runs — updating the
> products you already have, never duplicating them, so sales and approvals
> survive.

### The checkout

One base product per offer **and language** at Digistore24; **the price does
not live there**.
The API discards `data[amount]`, so `priceCents`, `currency` and
`billingInterval` travel with each `createBuyUrl` call as `payment_plan[…]`.
There is a `createPaymentPlan` API and this template deliberately does not use
it — a stored plan puts the price in a second place that drifts, and a stored
plan is fixed: free trials (`test_interval`), upgrades and downgrades
(`upgrade_order_id`), vouchers and per-link affiliate commissions all only work
when the plan travels with the checkout call. **One price, one place.**
Details: `docs/digistore-createbuyurl.md`, `docs/digistore-billing-modes.md`.

---

## Shape A — the operator is the only vendor

**This is what the template already is.** There is nothing to design, and the
work is three commands. Do not rebuild any of it.

### Set it up

```bash
node run.mjs ds24-connect    # browser approval → DIGISTORE_API_KEY into .env
node run.mjs ds24-sync       # products from config/digistore-products.json + IPN connection
node run.mjs ds24-approval --apply   # go-live only: request product approval
```

The agent runs these itself — see the skill **`setup-digistore`**, which is the
step-by-step guide including the local-tunnel and thank-you-page details. The
only step that cannot be automated is the vendor's single click in the browser.
All three commands are shape-A commands: they assume one key in the `.env` and
one IPN connection.

Approval is a **go-live step**: request it only once the product description
and the app are mature. Before that only **test purchases** are possible — and
they prove the whole chain, because the template processes them exactly like
live ones (`api_mode` above). In DEV that is automatic: every checkout link
carries the DS24 test-payment parameter by itself (`lib/digistore/testpay.ts`;
inspect/rotate with `node run.mjs ds24-testpay`). Outside DEV the vendor sets the
[test-purchase cookie](https://help.digistore24.com/hc/de/articles/23901169396241).

### Looking at the buy forms before any of that — the DEV fixture

Until `ds24-sync` has run there is not one buy form on `/plans`. Every product
in `config/digistore-products.json` ships with `productIds: null`, so every card
renders *"Not created at Digistore24 yet"* — there is nothing to judge in dark
mode, nothing to check at 380 px, and nothing to look at while writing the page.

**On your own machine, add `?preview=checkout`:**

```
http://localhost:3000/plans?preview=checkout
```

Every card then shows the buy form a visitor would get once the products exist —
the button, the layout, and the auto-reload checkbox on each token package.

**Do not fake it instead.** The way this used to be done was a dummy product id
in `config/digistore-products.json` plus a dummy `DIGISTORE_API_KEY` in `.env`,
then undoing both. `.env` is gitignored, but **the registry is not**: a
forgotten dummy id gets committed, and the next `node run.mjs ds24-sync` then
calls `updateProduct` on a Digistore24 product that does not exist. The preview
holds no state at all — close the tab and it is gone.

Four things it deliberately is **not**:

| | |
|---|---|
| **not a checkout** | pressing *Buy* resolves the real registry, finds no product, and lands on the same `?checkout=error` message it otherwise would. Nothing is charged and nothing is unlocked |
| **not a link** | it renders the form, never an `<a href>` to a checkout that does not exist. A dead link is what `checkoutLinksFor()` exists to refuse |
| **not a mock of the API** | it asks Digistore24 nothing at all, so it can never make a real outage look healthy. The `error` state is untouched and still reachable — the rule in `guardrails` holds |
| **not available anywhere else** | it needs `APP_ENV=development`, `NODE_ENV` other than `production` and a **localhost** `APP_URL` — the same allowlist as the development login and the test-payment parameter (`lib/digistore/preview.ts`). Anything unrecognised counts as production. On a deployed app the parameter does nothing |

It **reads** `APP_URL` and never changes it — setting `APP_URL` to a non-local
value switches off the development login and locks you out of your own app.

The page offers the link by itself while the products are missing, so you do not
have to remember it. `DS24_PLANS_PREVIEW=off` in `.env` removes it on one
machine.

### Which marketplace a product is submitted to

Approval is requested **per marketplace** (`data[approval_status][<siteowner>]`),
and which one follows the **product's own language**, not the app's:

| The product's `language` | Marketplace |
|---|---|
| `de` (or anything starting with "de") | Digistore24 GmbH, Germany — siteowner **1** |
| anything else | Digistore24 Inc., USA — siteowner **2** |

The languages are the keys of the per-language maps in `productIds` (see
above), and there is one Digistore24 product per key — so **an offering sold
in both languages is submitted to both marketplaces**, each product where it
belongs, and each gets its own verdict. Submitted is always the **prod set**:
approval is a go-live step, and `[DEV]`/`[STAGING]` products have no business
on a marketplace. `node run.mjs ds24-approval` lists them as `basic_monthly (de)` and
`basic_monthly (en)`; an offering with a single language keeps its bare key.

That is not a feature of the approval command. It falls out of the registry
already holding one product per language, for the order-form reason above.

`--lang`, `--reseller` and `--siteowner` override the rule for every product in
the run. The ids come from `scripts/ds24/_resellers.mjs`. A registry still in
the pre-0.6.0 shape falls back to its `language` field, then to `APP_LANG`,
then to German.

### Direct Sellers have no product approval — and then none of this applies

**Only the four resellers approve products:** Germany (1), USA (2), UK (3),
Ireland (4). Any other siteowner is a **Direct Seller** — the vendor sells on
their own account, and Digistore24 has no approval step there at all. Nothing to
request, nothing to wait for, nothing that has to happen before selling.

That is not a detail, it is the difference between a reminder and a permanent
false alarm, so the whole feature switches itself off for such a vendor:

- `node run.mjs ds24-approval` with a Direct Seller siteowner says so and exits
  without writing anything. Requesting an approval there would put a value on a
  live product that nobody will ever act on.
- The session greeting and the doctor check stay **silent**, and the cache is
  dropped. Two independent signals reach that conclusion: a
  `DIGISTORE_SITEOWNER_ID` outside 1–4 (then the API is not even asked), and a
  response in which no reseller is active for the account.
- A `approval_status` on a non-reseller entry is ignored rather than read as a
  verdict — the field means nothing there, and counting it would report an
  approval nobody granted.

"Could not read the status" and "does not apply" are kept apart throughout. The
first is worth saying out loud; the second is worth saying nothing about.

### Reading the approval status back

Requesting approval is a write with no visible answer — Digistore24 decides
later, and `retrieveApiKey` is *not* how you learn it happened (see above). The
read side has one source: every `listProducts`/`getProduct` item carries
`approval_status_list`, one entry per reseller with `approval_status` one of
`new` (never requested), `pending`, `approved` or `rejected`, plus
`is_siteowner_active` and the rejection reason. That field is **probed, not
documented** (2026-07-28) — the OpenAPI spec does not list it — which is why
`scripts/ds24/_approval.mjs` tolerates every way it could change and answers
"say nothing" rather than guessing.

**A product has one status, aggregated across every marketplace it is active
for: approved anywhere wins, else pending, else rejected, else new.** The
question being answered is "can I sell this?", and a product approved in
Germany sells in Germany whatever the US reseller decided — so nothing nags
about it. A rejection is only worth reporting while nobody has approved it
anywhere, and then it is the most useful thing to say, because it names
something the vendor has to do in their account. A marketplace the account is
not active for is ignored entirely; it cannot act, so its verdict says nothing.

The per-marketplace view still exists and is what `--apply` uses — see below.

Three surfaces read it, and they share one cache (`.dev/approval-check.json`,
one `listProducts` call per day, a week once everything is approved, and a
refetch as soon as the set of synced products changes). The request carries a
**3-second timeout**, because it sits in front of every session; an API that
answers more slowly than that costs a day of silence, not a slow greeting.

- **The session greeting** says one bracketed line while a synced product is
  unrequested, pending or rejected — worst state wins, at most three products
  named — and is silent otherwise. Off with `DIGISTORE_APPROVAL_CHECK=off` in
  the `.env`, which also deletes the cache so nothing keeps reporting from it.
- **`node run.mjs doctor`** carries the same answer as an `info` check, from
  the cache only, and reports **every** state that is not approved — including
  `pending`, which means real sales are still impossible. A cache nobody has
  refreshed in 30 days is ignored rather than reported as current.
- **`node run.mjs ds24-approval`** (the dry run) shows the live status per
  product and writes what it learned into the cache, so an approval granted an
  hour ago does not keep being reported as pending.

**`--apply` refuses rather than guessing.** It skips a product already
`approved` **at the marketplace it would write to** (a product approved in
Germany may still have a legitimate request to make in the USA; that skip is
unconditional — `--force` does not lift it, because re-requesting an approval is
never what you wanted). It **refuses**, and `--force` lifts each of these:

- **the status could not be read at all** — the API failed, or the product is
  not in the response. The reseller side acts on `pending` products only, and
  whether re-writing `pending` over an approval resets it is undocumented; that
  is not a thing to find out on a live account.
- **your account is not active at the target marketplace**
  (`is_siteowner_active: "N"`). The request would never be looked at, and the
  read side filters that entry out — so the product would go on being reported
  as never submitted, for ever, with repeating the command changing nothing.
- **`--status` anything but `pending`.** `new` withdraws a request, and
  `approved`/`rejected` are the reseller's verdicts. A vendor writing `approved`
  onto their own product silences the greeting, turns the doctor check green and
  makes `--apply` skip it for ever — for a product no reseller ever looked at.

**Deliberately not built:** no in-app notice and no checkout blocker for an
unapproved product. Test purchases work before approval, so blocking the
checkout would disable something that works; and `checkoutBlockersFor()`
answers without network on purpose, while the approval answer lives in a
`.dev/` cache that a deployed server does not have. The reminder is for the
developer, in the terminal — the customer-facing surface is unaffected.

### What "one vendor" means in the code

These are load-bearing decisions, not accidents:

- **The credentials live in the environment, not the database.**
  `DIGISTORE_API_KEY` and `DIGISTORE_IPN_PASSPHRASE`, read only through
  `lib/digistore/settings.ts`. `ds24ApiKey()` throws when unset;
  `hasDigistoreApiKey()` is the soft check for UI ("not connected yet").
- **There is no UI for entering a key, on purpose.** An input field for a secret
  is attack surface, and the key belongs to the operator of the installation, not
  to a signed-in user. Do not add one. Do not add a "settings" page for it.
- **Billing rows carry no vendor column.** `orders.memberId` is the *buyer*
  (`db/schema-digistore.ts`); one installation bills through one account, so
  namespacing rows by vendor would buy nothing but a trap.
- **One IPN connection, one passphrase, one stable and UNIQUE `domain_id`**
  (`DIGISTORE_IPN_DOMAIN_ID`). `ipn-setup.mjs` is idempotent through it:
  delete-then-create against the same `domain_id`, so a changed URL updates the
  connection instead of multiplying it. Stable and unique are two requirements,
  not one — the second is why a derived id carries a random tail (above).
- **`tracking[custom]` names the buyer**, as
  `m:<memberId>;t:<checkoutToken>;p:<productKey>;k:<kind>`
  (`lib/digistore/custom.ts`). That is how a payment finds its owner even when
  the buyer paid under a different address. The identity in that field is tried
  first and the buyer's e-mail address only afterwards, as an *unauthenticated*
  fallback — and an address matching more than one account is refused rather than
  guessed. An unattributed payment is recorded
  but never credited — it is claimed at the buyer's first sign-in, or attached by
  hand under `/dashboard/admin/purchases`.

### When someone asks for a "connect Digistore" button

That request is shape B, and it is the one place where the two get mixed up in
practice. **Do not bolt an API-key field onto shape A** — not on an account page,
not "just for now", not hidden behind an admin role. A key field is a second way
into the credentials, it is a secret in a form, and it does not solve the actual
problem: the IPN, the products and the checkout would all still be single-tenant,
so the second vendor's sales would arrive on the first vendor's connection or not
at all.

Either the operator is the only seller (then the key is already in the `.env` and
there is nothing to connect), or the app is a platform — and then read on.

### The shipped developer key

`lib/digistore/config.mjs` carries `DIGISTORE_DEVELOPER_KEY`, the key that makes
`ds24-connect` work without anybody registering anything. It is openly in the
code because it is not a secret: it identifies the app kit, and it grants no
access to any account. **In shape A that is all you need.** In shape B it is not
(see step 0).

---

## Shape B — the app is a platform

**None of this exists in the template.** What follows is the complete design, so
that building it is a build and not a research project. Everything under *Shared
mechanics* still holds; what changes is that each of the three moving parts
becomes per-tenant.

Before step 0, re-read *The words* above. The error this shape invites is
treating the vendor as if they were the buyer — the template's `orders.memberId`
means buyer, and a platform needs a second, independent dimension for the vendor.
Do not overload the first one.

### Step 0 — create your own Developer API key

At Digistore24, in the vendor view: **Settings → Account access → tab "API
keys" → "New API key" → API permissions: "Developer" → Save.** The key is then
shown in the "API key" field. Keep it in the platform's own environment, e.g.
`DIGISTORE_DEVELOPER_KEY` in the `.env`, and read it through a single accessor
next to `ds24ApiKey()`.

**Do not ship the app kit's key for this.** It belongs to the app kit's account,
it is public, and it can be rotated or revoked without anybody asking you. On top
of that, the values you pass to `requestApiKey` — `site_url`, `comment` — are
what the vendor reads on the approval page: they should name *your* platform.
A developer key is free, carries no permissions, and is the one piece of setup
that genuinely cannot be automated away.

### Step 1 — the table everything else hangs off

One row per connected Digistore24 account. Sketch, in this template's idiom
(`db/schema-digistore.ts` for the conventions):

```ts
export const ds24Connections = pgTable("ds24_connections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // The VENDOR — a Member of this app who sells. Not the buyer.
  vendorId: text("vendor_id").notNull().references(() => users.id),
  // Path segment of this connection's own IPN URL. Opaque and unguessable:
  // it is what tells the endpoint whose passphrase to verify against.
  connectionId: text("connection_id").notNull().unique(),
  // Secrets. Encrypted at rest, never rendered, never logged.
  apiKey: text("api_key"),               // null once disconnected
  ipnPassphrase: text("ipn_passphrase"), // null once disconnected
  // Not a secret: the numeric prefix of the api key ("12345-xxxx" → "12345").
  // Cross-check against ipn_config_api_key_id on incoming order events.
  apiKeyId: text("api_key_id"),
  status: text("status").notNull(),      // pending | connected | disconnected
  requestToken: text("request_token"),   // one-shot, only while pending
  requestedAt: timestamp("requested_at"),
  connectedAt: timestamp("connected_at"),
});
```

**The row is created before the browser ever leaves for Digistore24**, in
`status: "pending"` — that is what makes the ordering in step 3 work, and it is
where the `request_token` lives while the vendor is away.

**The row outlives the connection.** On disconnect the secrets are nulled and the
status flips; the row itself stays, because `orders` and everything downstream
reference it. Deleting it would orphan financial records (see step 6).

### Step 2 — the connect flow, in the app

Replace the terminal script with two server-side steps. Read
`scripts/ds24/connect-api-key.mjs` first — it is the same flow, and its comments
name the mistakes already made once.

**Start (a server action on a "Connect Digistore24" button):**

1. Create the connection row (`status: "pending"`, a fresh `connectionId`).
2. `requestApiKey` with the **developer key**: `permissions=writable`,
   `return_url` = a page of your app, `cancel_url`, `site_url` = your platform,
   `comment` = something the vendor will recognise.
3. Store `request_token` on the row. It is a one-shot credential — it stops
   working once used, aborted or stale.
4. Redirect the vendor to `request_url`.

**Finish.** Two ways, and you want both:

- when the browser comes back to `return_url`, call `retrieveApiKey(token)` once
  and finish immediately in the common case;
- and a **background retry** for the vendor who approved but never came back
  (closed the tab, lost the redirect). `pending` simply means "ask again later";
  `aborted` means give up and clear the row. Do not rely on the redirect alone —
  that is the single most likely way a platform ends up with vendors who approved
  and are still shown as unconnected. `lib/cron/jobs.ts` is where a retry job
  belongs (`docs/cron.md`).

On `completed`: store the key **encrypted at rest**, store its numeric prefix
separately, and never render the key — not in a form, not masked, not in a log
line, not in an error message. Then go straight to step 3; a connected vendor
without an IPN connection receives no events, which looks exactly like a broken
integration.

`APP_URL` must be a public https address for any of this to work. Locally,
`return_url` needs the same redirect detour every other localhost URL takes
here — see `lib/digistore/public-url.ts` and `scripts/ds24/_public-url.mjs`.

### Step 3 — one IPN connection per vendor, with its own URL

Order matters, because the URL has to exist before the connection can be
registered against it:

1. take the `connectionId` from the row (it already exists — step 1);
2. `ipnSetup` **with that vendor's key**: `ipn_url =
   https://YOUR-PLATFORM/api/ipn/c/<connectionId>`, `name` = your platform,
   `domain_id` = your platform's slug, `sha_passphrase: "random"`;
3. store the `sha_passphrase` Digistore24 returns on the row, and flip the status
   to `connected`.

`domain_id` may stay a constant here, and one constant is enough: scoping is by
(merchant, API key, `domain_id`), and each vendor connects with their own key.
Reusing it means a reconnect replaces that vendor's connection instead of adding
a second one. Make that constant your platform's own name and not a generic one
— the vendor may be connected to a second platform that reasoned the same way.

`product_ids` is worth setting in this shape rather than leaving at `all`: a
connected vendor sells things that have nothing to do with your platform, and
`all` sends you every one of those events to store and ignore.

**Each connection gets its own IPN URL**, with an opaque, unguessable
`connectionId`. The route then knows which passphrase to verify against before it
looks at the payload at all:

```ts
// app/api/ipn/c/[connectionId]/route.ts — the shape, not the whole thing
export async function POST(request: Request, { params }) {
  const conn = await connectionByPublicId((await params).connectionId);
  // Unknown or disconnected → 403. Fail closed, exactly as today.
  if (!conn || conn.status !== "connected") return new Response("…", { status: 403 });

  const body = Object.fromEntries(new URLSearchParams(await request.text()));
  if (!verifyIpnSignature(body, await ipnPassphraseFor(conn))) {
    return new Response("Invalid signature", { status: 403 });
  }
  // Only now is the payload trustworthy — and the vendor is conn.vendorId,
  // taken from the row. Never from merchant_id in the payload.
  await onPaymentEvent(body, { vendorId: conn.vendorId });
  return new Response("OK");
}
```

The alternative — one shared `/api/ipn` that routes on `ipn_config_api_key_id`
— looks tidier and does not work:

- **The connection test carries no `ipn_config_*` fields.** Its payload is
  `merchant_id`, `merchant_name`, `product_ids` and the signature, so a shared
  route has no signed way to pick a passphrase, and every vendor's "Test
  connection" button fails.
- **`custom` cannot rescue it either.** It is documented as `string(63)`, the
  buyer identity already fills most of that (`lib/digistore/custom.ts`), and it
  is absent from non-order events entirely.

So: **route by URL, verify with that connection's passphrase, and attribute the
sale to the vendor that connection belongs to.** Never to `merchant_id` out of
the payload.

That last sentence is the whole security model of this shape, and it is worth
being explicit about why. Each vendor can read their own passphrase in their
Digistore24 backoffice. With a shared passphrase, or with attribution taken from
a payload field, vendor A could post a validly signed IPN that claims to be
vendor B's sale — granting access, crediting tokens, or moving a subscription in
an account they do not own. Per-connection URL plus per-connection passphrase
plus attribution-by-connection makes that forgery structurally impossible rather
than merely unlikely. `ipn_config_api_key_id` is still worth checking against the
row's stored prefix on order events — as a cheap consistency check, not as the
routing decision.

### Step 4 — products belong to the vendor, not to the app

`config/digistore-products.json` holds one global `productId` per offer, written
back by `ds24-sync`. In a platform that is wrong by construction: each vendor's
products live in *their* account and have *their* ids. The registry stays the
source of truth for shape and price; the `productId` moves to a per-connection
table, and syncing becomes a per-vendor operation triggered when a vendor
connects (or edits their offers), not a one-off command.

`productByDs24Id()` (`lib/digistore/products.ts`) has to become
per-vendor-scoped too, or two vendors with the same product id collide.

### Step 5 — checkout with the vendor's key

`createBuyUrl` called with vendor X's key produces a checkout that pays vendor X.
So `checkoutLinksFor` / `getOrCreateBuyUrl` need the vendor's key threaded
through, and the `buy_url_cache` key must include the vendor — **a cached URL
leaking across tenants sends money to the wrong account.** That is the single
most expensive bug available in this shape; write the test for it first.

### Step 6 — disconnect

Offer it, and mean it: call `unregister` with the vendor's key (which deletes the
key *and* its IPN connections at Digistore24), then null the stored key and
passphrase and set the row to `disconnected`.

**Keep the row and keep the `orders`** — they are financial records, and they
reference the connection. A reconnect later is a *new* row with a new
`connectionId` and a new URL; the old one stays behind as history. A vendor who
cannot disconnect in your app will do it from the Digistore24 side instead, and
then your app holds a dead key and quietly stops receiving events — so treat "the
key stopped working" as a state to detect and show, not as an impossibility.

### What has to change in the template

| Today | Shape B |
|---|---|
| `DIGISTORE_API_KEY` in `.env` | `ds24_connections` (step 1); the env holds only the developer key |
| `ds24ApiKey()` reads the env | `ds24ApiKeyFor(vendorId)` reads the table |
| no key-entry UI, on purpose | a connect/disconnect UI — still no key *input*, the browser flow stays the only way in |
| one `/api/ipn`, one passphrase | `/api/ipn/c/<connectionId>`, passphrase per connection |
| `orders` has no vendor column | `orders`, `subscriptions`, `token*` and `buy_url_cache` all carry the vendor |
| `productId` in the registry JSON | `productId` per connection |
| `/dashboard/admin/*` = the operator's view of everything | two levels: platform admin, and each vendor's own view of their own sales |
| `node run.mjs ds24-connect` / `ds24-sync` | per-vendor operations in the app; the CLI commands stay shape-A only |

Everything else the template already does stays as it is and stays valuable: the
signature verification, the event→status mapping, idempotency by `order_id`, the
claim/attribution logic, the IPN log, the entitlement layer. None of it is
single-tenant by nature; it only needs the vendor threaded through.

### Two things this doc will not decide for you

- **How the platform earns.** The money goes to the vendor's account. Digistore24
  has affiliate commissions and Joint Venture / Cross Upsell shares (the IPN
  payload carries `amount_affiliate` and `amount_partner`), and a platform fee
  billed separately through your *own* account is shape A running alongside shape
  B. Which of these is permitted for your case is a question for Digistore24 —
  ask them before you build a revenue model on an assumption.
- **Who is liable for what.** A platform whose users sell to consumers has
  obligations the single-vendor case does not. See `docs/data-protection.md` for
  the data side, and the **`compliance-check`** skill.

---

## Reference

Which key each function needs. "The vendor's key" is `ds24ApiKey()` from the
`.env` in shape A, and the connected vendor's stored key in shape B.

| Function | Authenticated with | Purpose |
|---|---|---|
| `requestApiKey` | developer key | start the interactive approval → `request_url`, `request_token` |
| `retrieveApiKey` | developer key | ask whether it happened → `api_key`, `request_status` |
| `unregister` | the vendor's key | delete that key and its IPN connections |
| `ipnSetup` | the vendor's key | create **or update** the IPN connection (`ipn_url`, `name`, `domain_id`, `product_ids`, `sha_passphrase`) — the `domain_id` decides which |
| `ipnInfo` / `ipnDelete` | the vendor's key | read / remove by `domain_id` |
| `getPurchase` | the vendor's key | one order as Digistore24 sees it — status, product, links (`node run.mjs ds24-purchase`) |
| `listPurchases` | the vendor's key | the same for many, filtered (e.g. by buyer address) |
| `listProducts`, `getProduct`, `createProduct`, `updateProduct`, … | the vendor's key (`writable`) | products — `updateProduct` is also what writes an approval request |
| `createBuyUrl` | the vendor's key (`writable`) | checkout URL + payment plan |
| `createBillingOnDemand` | the vendor's key (`writable`) | charge a stored mandate (token top-up) |
| `getTestpayKey` | the vendor's key | the GET parameter that unlocks **test payments** on a checkout URL (undocumented, but real — DigiMember uses it). Returns `testpay_key`, `get_param_name`, `expires_at`; `do_recreate` rotates the key. DEV checkout links append it by themselves (`lib/digistore/testpay.ts`); inspect/rotate with `node run.mjs ds24-testpay` |

- API reference: <https://www.digistore24.com/api/docs/index.html>
- IPN events & payload: <https://dev.digistore24.com/hc/en-us/articles/32480561422353-Events>
- Interactive key creation: <https://dev.digistore24.com/hc/en-us/articles/32486158815121-How-to-generate-an-API-key-interactively>
- In this repo: skill **`setup-digistore`** (shape A, step by step),
  `docs/digistore-billing-modes.md` (subscriptions & prepaid tokens),
  `docs/digistore-createbuyurl.md` (checkout links),
  `docs/entitlements.md` (what a purchase unlocks),
  `docs/environments.md` (local IPN, tunnels, DEV/STAGING/PROD).
