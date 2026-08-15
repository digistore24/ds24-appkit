<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Digistore24 setup scripts

One-off, **idempotent** setup tasks that are not part of the app's runtime.
They can be run by hand or by Claude Code (skill `setup-digistore`). Plain Node
ESM — no build needed.

## Prerequisites (env)

```bash
export DIGISTORE_API_KEY="…"   # writable/developer key
```

You fetch the API key with `node run.mjs ds24-connect` (= `connect-api-key.mjs`): the
script opens the browser, you confirm at Digistore24, and the key is written
into the `.env` as `DIGISTORE_API_KEY`.

## Synchronizing products from the registry (recommended)

For apps with several offers (subscription plans + token packages),
**`config/digistore-products.json`** is the source of truth. `sync-products.mjs`
creates one product **per offer and language** via `createProduct` (or updates it
via `updateProduct`) and writes the ids back into `productIds.<env>`. One per
language because a DS24 product carries exactly one `data[language]`, and that
is the language of the buyer's order form. **The price is NOT set on the
product** (`data[amount]` is deprecated and discarded) — price and interval stay
in the registry and travel with the checkout call as `payment_plan[...]`
(`lib/digistore/checkout.ts`). Do **not** maintain payment plans in the DS24 UI;
the price would then live in two places.

**Each environment has its own product set** (`dev` / `staging` / `prod`), and
`--env` picks which one a run maintains — see `docs/environments.md`. Two older
shapes are still read as the PROD set: `productIdByLanguage` (template < 0.14.0,
one set shared by every environment) and a bare `productId`/`language` pair
(< 0.6.0, one product per offering). A `--env prod` run folds them into
`productIds.prod` in place, so sales and approvals survive.

```bash
# The normal case — creates/updates and registers the IPN:
node run.mjs ds24-sync

# Look first, change nothing:
node run.mjs ds24-sync --dry-run

# A single product only:
node run.mjs ds24-sync --key starter

# Yes to the list of NEW products it refused to create:
node run.mjs ds24-sync --create-new
```

`node run.mjs ds24-sync` adds `--apply` by itself; the scripts underneath keep the dry
run as their default, so a direct `node scripts/ds24/sync-products.mjs` still
changes nothing. `--dry-run` beats `--apply` wherever both turn up.

🚨 **Creating a product cannot be undone from here**, so the run stops the
first time it would create one, lists what would be new, and refuses. Say yes
with `--create-new`, or park what you do not sell with `"sell": false` in the
registry. Once an offering has an id nothing is being created and the gate is
silent; updates are never gated. Deleting an entry afterwards does not
unpublish the product — that is a hand in the Digistore24 backend.

## localhost and Digistore24 (`_public-url.mjs`)

Digistore24 stores **public https URLs only**. Handing it the address your app
actually runs on locally ends the sync right there:

```
DS24 API error (updateProduct): Please only use secure URLs with https://.
Change this URL accordingly: http://localhost:3000/optin/[ORDER_ID]
```

So every localhost URL travels as a redirect address that leads back to your
machine — the thank-you page above, the return address of `node run.mjs ds24-connect`
likewise:

```
http://localhost:3000/optin/[ORDER_ID]
  → https://ds24-appkit.com/redir/?port=3000&path=/optin/[ORDER_ID]
  → (302) http://localhost:3000/optin/[ORDER_ID]
```

The page behind it is static and never sees a key or a purchase; the target host
is hard-wired to localhost, only port and path come from the URL. The address
itself is in `lib/digistore/config.mjs`.

**The IPN endpoint is the exception.** That URL is called by the *Digistore24
server*, and its localhost is not yours — the redirect cannot help, which is why
`ipn-setup.mjs --auto` skips the IPN locally instead. Use `node run.mjs ds24-tunnel`.

Request approval (go-live) — sets `approval_status=pending` per product. The
marketplace follows the **product's own** `language` in
`config/digistore-products.json`: German → Germany reseller (id 1), anything
else → USA reseller (id 2). A product that names no language falls back to
`APP_LANG` and then to German, so an older registry behaves as before.
`--lang`, `--reseller` and `--siteowner` override it for the whole run:

```bash
node run.mjs ds24-approval                            # dry run = the status view
node run.mjs ds24-approval --apply                    # marketplace per product language
node run.mjs ds24-approval --lang en --apply        # force USA reseller (id 2)
node run.mjs ds24-approval --reseller US --apply    # a specific reseller: DE|US|GB|IE
node run.mjs ds24-approval --siteowner <id> --apply # a specific reseller by id (1|2|3|4)
# --force: override the refusals below (and --status, which otherwise only takes "pending")
```

The reseller IDs are hard-coded in `_resellers.mjs` (source:
`https://www.digistore24.com/support/resellers.json` — practically never change).

The dry run shows the **current** status per product (`new`/`pending`/
`approved`/`rejected`, read from `listProducts` → `approval_status_list`).

`--apply` **skips** a product already approved **at the marketplace it would
write to** — that skip is unconditional, and `--force` does not lift it,
because re-requesting an approval is never the thing you wanted. It **refuses**
three states instead, and each refusal `--force` does lift:

| Refused | Why |
|---|---|
| the status could not be read at all | writing `pending` over an approval is a step Digistore24 does not document, and the guard against it is exactly the status that failed to read |
| your account is not active at the target marketplace (`is_siteowner_active: "N"`) | the request would never be looked at, and the read side filters that entry out — so the product would be reported as never submitted for ever |
| `--status` anything but `pending` | `new` withdraws a request; `approved`/`rejected` are the reseller's verdicts, and writing `approved` onto your own product silences the greeting, turns doctor green and makes `--apply` skip it for ever |

**Only the four resellers (1 Germany, 2 USA, 3 UK, 4 Ireland) have a product
approval.** Any other siteowner is a **Direct Seller**: the vendor sells on
their own account and there is no approval step at all. The command says so and
writes nothing, and the greeting and the doctor check stay silent for such a
vendor — see `docs/digistore-integration.md`.

The read side lives in `_approval.mjs`, which also feeds the once-a-day line in
the session greeting and the `info` check in doctor (cache:
`.dev/approval-check.json`, kill switch `DIGISTORE_APPROVAL_CHECK=off`). There a
product has **one** status across all marketplaces — approved anywhere wins,
else pending, else rejected, else new — because the question is whether it can
be sold at all. Full reasoning: `docs/digistore-integration.md`.

**Before approval only test purchases.** New products are not approved at
first. In DEV that is already handled: every checkout link carries the
test-payment parameter by itself (`lib/digistore/testpay.ts`, state in
`.dev/testpay.json`). A link that arrives WITHOUT it leaves a `[testpay]` line
in `node run.mjs logs` naming which of the two allowlists declined — the
environment gate, or `DIGISTORE_CHECKOUT_HOSTS` in `lib/digistore/config.mjs`
(the checkout runs on `www.checkout-ds24.com`, not on the API domain).
Outside DEV the vendor sets the test-purchase cookie
once: <https://help.digistore24.com/hc/de/articles/23901169396241>.
You only request approval once the product description and the app are mature.

### The test-purchase key (`testpay.mjs`)

```bash
node run.mjs ds24-testpay              # fetch/refresh the key + show the state
node run.mjs ds24-testpay --json      # machine-readable
node run.mjs ds24-testpay --recreate  # rotate — every old copy stops working
```

`getTestpayKey` (undocumented DS24 API function) returns the GET parameter that
unlocks test payments on the checkout. The app fetches it by itself in DEV;
this script inspects and rotates it. The key is account-level — treat it like
a secret, and rotate before go-live.

### A single product (the old way)

`create-product.mjs` creates a single base product (for the createBuyUrl route
without a registry). Idempotent via `name_intern`; `--update` updates it.

```bash
node scripts/ds24/create-product.mjs --saas "Paid Challenge" --plan "Gold" --apply
```

## Setting up the IPN connection (idempotent)

The **normal case** is `node run.mjs ds24-sync` — that creates products
*and* sets up the IPN (the call: `ipn-setup.mjs --auto`). The `--auto` mode
derives the IPN URL from `APP_URL` and picks a stable `domain_id`:
- **live/staging** (public domain) → from the host, e.g. `app-example-de-k7f2m9x1qc`;
- **development** → `local-<project name>-<random>`, so that a changing tunnel
  URL does not multiply the connection.

The value is written into the `.env` as `DIGISTORE_IPN_DOMAIN_ID` and stays
stable. `ipnSetup` is idempotent via this `domain_id`: an existing connection
is updated (duplicates removed), otherwise a new one is created. So the same
call is both the setup and the update — **only the `domain_id` decides which**:
keep it and the connection is updated, change it and a second connection comes
into being. The defaults for events
(payment/refund/chargeback/payment_missed/last_paid_day), timing (before the
thank-you page) and category (orders) already match the IPN handler. The
generated SHA512 passphrase ends up in the `.env` as
`DIGISTORE_IPN_PASSPHRASE`; if one is already set there, it is reused.

### The `domain_id` has to be unique — hence the random tail

Digistore24 finds a connection by **(merchant, API key, `domain_id`)** and
updates the row it finds. A generic value — `test-local-1`, `local-app`,
`myapp` — is therefore not a name but a **collision**: two of the vendor's own
projects that pick the same one do not get two connections, they take turns
overwriting one. The second `ds24-sync` re-points the first project's IPN at its
own address, and from then on the first project's purchases arrive nowhere. Both
sides report success; nothing anywhere reports the loss.

That is why a **derived** value ends in ten random characters
(`local-my-app-diw2hvnz73`). The readable part says which app it is, the tail is
what makes it unique. A value passed with `--domain`, or one already sitting in
the `.env`, is taken exactly as it is — **if you choose one by hand, put
something random in it yourself.**

### Which products the connection covers (`product_ids`)

`ipnSetup` takes `product_ids`, comma-separated: `product_ids=111,222,333`.
Digistore24's own default is `all` (the whole account).

`--auto` sends the **ids from the registry** (`config/digistore-products.json`,
after the product sync has written them back), because a vendor's account
usually holds more than this app: an older funnel, a second app, somebody else's
launch. Naming the ids keeps every connection to its own products — which is
what lets two apps of the same vendor be connected at the same time.

`all` is legitimate and is the fallback while nothing is synced yet: this app
records an order for an unknown product and **grants nothing** for it
(`resolveProduct()` in `lib/digistore/payment-event.ts` returns `null`), so
foreign purchases are ignored rather than mis-granted. What `all` costs is the
separation, not the safety.

```bash
node scripts/ds24/ipn-setup.mjs --auto --products 111,222,333 --apply
node scripts/ds24/ipn-setup.mjs --auto --products all --apply
```

IPN needs a **public https URL** (DS24 checks it with a GET for HTTP 200 — the
IPN route answers GET with "OK"; it refuses a 301/302 too, which is why the
`/redir/` bridge cannot serve here). In purely local development `--auto` skips
the IPN part. To test it locally, run **`node run.mjs ds24-tunnel`**: that opens a public
address onto the running app and registers it as the IPN endpoint in one go —
`APP_URL` stays untouched (a non-local value there would switch off the
development login).

In fact `--auto` opens one **itself** when `APP_URL` is local and no tunnel is
running, so plain `node run.mjs ds24-sync` sets the IPN up locally too. It says so while
it happens: an open tunnel makes the machine reachable from the internet.

The tunnel runs in the **background** (`tunnel.mjs`, state in `.dev/tunnel.*`);
`node run.mjs status` shows it, `node run.mjs stop` ends it. A running one is reused rather than
replaced. Never opened: on `--dry-run` (a preview must not publish the machine)
and with `--no-tunnel`. A public `APP_URL` (STAGING/PROD) wins over any
tunnel and never reaches this path.

By hand (a special case, fixed values instead of derivation):

```bash
# Dry run:
node scripts/ds24/ipn-setup.mjs --url "https://app.example.de/api/ipn" \
     --domain "app.example.de"

# Execute (DS24 generates & returns the passphrase, it is written into the .env):
node scripts/ds24/ipn-setup.mjs --url "https://app.example.de/api/ipn" \
     --domain "app.example.de" --apply

# Or pass an already existing passphrase (couple them identically):
node scripts/ds24/ipn-setup.mjs --url "https://app.example.de/api/ipn" \
     --domain "app.example.de" --passphrase "<from the .env>" --apply
```

The IPN URL is always `https://YOUR-DOMAIN/api/ipn` — without further path segments.

## A note on API field names

All the calls used are verified against the real DS24 API sources:
`createProduct`, `updateProduct`, `listProducts`, `ipnInfo` and `ipnSetup`.
Both scripts are dry run by default; only `--apply` changes anything.
