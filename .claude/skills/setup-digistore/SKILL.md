---
name: setup-digistore
description: Sets up Digistore24 billing — the API key, the products, the IPN connection (webhook + SHA512 passphrase) and the checkout links; the agent runs the commands itself (`ds24-connect`, `ds24-sync`). Use this as soon as the app is meant to receive sales or process completed purchases, and when the user says "somebody paid and the app knows nothing about it", "a test purchase never arrives", "connect Digistore24", or asks for a checkout link.
requires: 0.30.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Setting up Digistore24 billing

The integration is already built (`lib/digistore/`, `app/api/ipn/route.ts`) and the
reference behind every step below is
[`docs/digistore-integration.md`](../../../docs/digistore-integration.md). **Read
it once before step 1**: this file is the ORDER of the work, never a second copy of
the mechanics.

## You do this — not the user

You set the billing up yourself and you do not rewrite the integration: you call
the commands through your Bash tool, and you never hand the user a `make …` or a
`! node run.mjs …` line — most of them are not developers.

**Never say that you "cannot obtain" the API key or the products for the user.**
That is wrong: the commands exist for exactly that purpose, and product ids are
**nothing anybody has to fetch**. The **only** step that necessarily stays with
the user is one click: the authorization in the browser at Digistore24.

## How the billing works

Digistore24 is the **merchant of record** — it runs the checkout, takes the
money, and handles VAT and refunds — and the app touches no money: it **reacts to
events**. A purchase arrives as the IPN event `on_payment`, is attributed to a
Member out of `tracking[custom]` and recorded; refunds, chargebacks and missed
subscription payments update that record.

🚨 **Not a payment provider, and the difference reaches the customer.** A PSP
processes a payment for the seller; Digistore24 GmbH SELLS — where it resells it
is the buyer's contractual partner and carries the invoice, the VAT and the right
of withdrawal. **The money is collected by Digistore24 either way**, and their
name is what turns up on the buyer's bank statement. So customer-facing text says
*the platform we sell through*, never *our payment provider* — and which parts of
the deal it carries is the vendor's contract rather than a property of this app:
**[`docs/compliance.md`](../../../docs/compliance.md)** → *who sells?*

⚠️ **The shipped handler is idempotent; the EVENT is not.** Digistore24
redelivers until it gets a 200, and the signature check says who wrote the
payload rather than whether it has been seen — so a retry replays the whole
handler. What survives it is three UNIQUE constraints on the three things the
template writes, and anything you add beside them carries its own or is done
twice. **[`docs/digistore-integration.md`](../../../docs/digistore-integration.md)**
→ *Replay*.

🚨 **The IPN is what grants access, never the billing row.** The event is the
authority, the row is the record — ask `hasPlan(memberId, productKey)` when you need
to know what somebody may use, and set no status by hand. The events, the payload,
the attribution rules and what an unattributed payment does are
*The IPN* and *What "one vendor" means in the code* in that reference.

## 0. Is the operator the only vendor — and is this already done?

The vendor question first, and almost always the answer is yes — then everything
below applies unchanged: **one** Digistore24 account per installation, the key in
the `.env`, the operator gets paid.

Ask the other question only when it is genuinely open — **does anybody other than
the operator get paid?** If the app's own users are meant to sell to *their*
customers (a course platform, a booking tool for coaches, a shop builder), that is
the **platform** shape: not a setting, not built here, and not something to start
from memory or to build "just in case". Both shapes, and the full design of the
platform one including the two mistakes that cost money, are *Pick the shape first*
and *Shape B* in that reference. Do not raise it unprompted with somebody who simply
wants to sell their own app.

**Then look before you run anything:** with `DIGISTORE_API_KEY` in the `.env` and ids
already in `config/digistore-products.json` for this environment, this skill is done
— say so and go to **Next step**.

## 1. Connect the API key — `node run.mjs ds24-connect`

Run it yourself, in this order:

1. Say in **one sentence** what is about to happen: *"I'm establishing the
   connection to Digistore24 now. Your browser will open in a moment — sign in
   there and confirm the access; I'll take care of the rest."* Where the greeting
   says `[Machine: no browser here]`, promise the other thing: *"I'll give you a
   link in a moment — open it and confirm there; I'll wait."*
2. **Say which account this will connect, because the script cannot.** It is
   whichever Digistore24 account is signed in in that browser at the moment of
   confirming, no choice is offered, and nothing afterwards reports the name back —
   somebody with two accounts otherwise finds out weeks later, when the products
   turn up in the wrong one.
3. Call it with a **generous timeout (10 minutes / 600000 ms)**: the script polls
   Digistore24 until the approval has happened, and gives up after 8 minutes.
4. Stop on `✓ DIGISTORE_API_KEY saved in .env`, confirm that to the user, and go
   to step 2.

**The one failure that must not be misread: the app does not have to be running,
so the landing page after the approval failing to load is NOT a failed setup.**
The key arrives in the terminal either way — read the output, which says
`✓ Approval received.` and then `✓ DIGISTORE_API_KEY saved in .env`. What to do
when no browser opens at all, and the route for a user who has neither a browser
nor a terminal, are both [`docs/machine.md`](../../../docs/machine.md).

Why the flow looks like this — the developer key, the polling, why there is never a
local web server, why a `localhost` address travels through the public redirect
page — is
[`docs/digistore-integration.md`](../../../docs/digistore-integration.md) →
*How an API key comes into being* and *Localhost URLs travel through the redirect*.
The flags are [`references/one-off-setup.md`](references/one-off-setup.md).

## 2. Decide what is actually on sale — BEFORE the sync

🚨 **Do this first, not afterwards.** `config/digistore-products.json` ships with
example plans, and every entry in it becomes a real product in the user's
Digistore24 account. **That cannot be undone from here**: deleting an entry
later does not remove the product over there — it has to be deactivated in the
Digistore24 backend, by hand.

Go through the list WITH the user and say what it is: *"the template comes with
three example plans. Which of these do you actually sell?"* Then, per entry:

- **Sell it** → adjust name, price, interval or credits.
- **Not sell it, but keep the shape** → `"sell": false`. The entry stays in the
  file as something to copy from, no product is created, and it does not appear
  on `/plans`.
- **Never need it** → delete the entry.

One entry per plan, never a second price list in the code, and no prices on the
Digistore24 product at all.

## 3. Create products and the IPN — `node run.mjs ds24-sync`

One command, idempotent, and it **applies** — the preview is
`node run.mjs ds24-sync --dry-run`. It creates or updates the plans from
`config/digistore-products.json`, writes the ids back, and registers the webhook
`…/api/ipn` **via API** with its SHA512 passphrase: the user enters **nothing** in
the Digistore24 interface.

**The first run will stop and show you a list.** Anything that would be created
NEW is printed and the run refuses, because creating is the irreversible half.
That is not an error — it is the last look before products exist:

1. Read the list out to the user, by name.
2. Wait for their yes. If something on it is wrong, go back to step 2 above.
3. Then run `node run.mjs ds24-sync --create-new`.

Later runs pass straight through: an offering that has been synced carries an
id, so nothing is being created and nothing is asked. Updates are never gated.

Four more things to do while it runs, and only the first is a command:

- **Run it plain.** Without `--env` it follows `APP_ENV`, so on the user's machine
  it maintains the **DEV** set and the live set stays untouched. The prod set is a
  go-live step (`go-live`), staging is optional:
  [`docs/environments.md`](../../../docs/environments.md).
- 🚨 **Read the sync's warnings out loud to the user.** A plan missing a language
  still sells, and those buyers get an order form in the wrong language, which
  nothing else in the app will ever mention. Why, and what the registry has to look
  like: *The order form's language* in that reference. The same goes for a
  `"sell": false` entry the sync says is still buyable at Digistore24 — that one
  needs a hand in the vendor backend, and nothing else will ever raise it.
- **Say that their machine is reachable from the internet** if the sync opened a
  Cloudflare Quick Tunnel for the IPN — it does that by itself while `APP_URL` is
  local, and they must not learn it from a log line later
  ([`docs/environments.md`](../../../docs/environments.md)).
- **A skipped IPN is not a failed sync** — the products are done. It skips only when
  it truly cannot (app not running, `cloudflared` missing) and names which; fix that
  and run it again.

## 4. Check the connection

The user can trigger "Test connection" in Digistore24 as soon as the IPN is
registered: a validly signed IPN is answered `200`, an invalid signature `403`.
**Neither complaint below is a thing to guess at — each has its own command:**

| What you hear | What you run |
|---|---|
| the test connection returns `403` | `node run.mjs ds24-ipn-verify` — recomputes the signature over the raw body that arrived, against every known variant (`--order ABC123`, or `--all`) |
| "the purchase went through and nothing happened in the app" | `node run.mjs ds24-purchase --order ABC12345` — Digistore24's own read-only view of that order; do not send the user into their backoffice for it |

Both verdicts and what each of them means are *"The purchase worked but nothing
happened"* in that reference. Where no IPN ever arrived,
`node run.mjs ds24-ipn --auto --apply` re-registers the connection.

## 5. Test a purchase from the app

**In DEV that works by itself, approved or not:** every checkout link the app
builds carries the Digistore24 test-payment parameter, so clicking a plan card
opens the checkout in test-payment mode — nothing to set up, no cookie to set.
`node run.mjs ds24-testpay` shows the key, `--recreate` rotates it. It **never
activates outside DEV**, and the key is **account-level — treat it like a
secret**; outside DEV, on a STAGING domain, the vendor sets the test-purchase
cookie once instead
([`docs/digistore-createbuyurl.md`](../../../docs/digistore-createbuyurl.md) →
*Test payments in DEV*).

⚠️ **If the checkout nevertheless says the product is not approved, do not
conclude that approval is the answer — look first.** Open the link and check the
address bar for the parameter, then read `node run.mjs logs` for a line
beginning `[testpay]`: it names which of the two allowlists declined, the
environment gate or the checkout host. Requesting approval to work around a
missing parameter is a go-live step spent on a bug.

**Approval is not this skill's job.** A product sold through one of the four
Digistore24 resellers is unapproved at first and only test purchases work; a
Direct Seller has no approval step at all. Requesting it
(`node run.mjs ds24-approval --apply`) waits until the description and the app are
mature — a go-live step, in the skill `go-live`.

## 6. Checkout links

`/plans` already builds them, on **two paths** — one for a signed-in member, whose
identity travels in `tracking[custom]` so that a later payment finds its owner, and
one shared cached link for a visitor. Neither ever renders a dead button.

⚠️ **Take one of those two unless you have a reason not to — the layer underneath
returns an UNFINISHED URL**, without the DEV test-payment parameter, so a checkout
built by hand on `getOrCreateBuyUrl` leaves the developer unable to buy anything
locally and nothing reports a fault. Its last step would have to be
`await withTestpayParam(url)` on the **return value**, after the cache. Both paths,
that rule, the cache and the language:
[`docs/digistore-createbuyurl.md`](../../../docs/digistore-createbuyurl.md).

## 7. The one-off cases

A single product outside the registry, the IPN with a fixed URL, a flag of
`ds24-connect`: [`references/one-off-setup.md`](references/one-off-setup.md).

## Next step

**`billing-modes`** if the app should bill recurring or by usage — subscriptions
(monthly/yearly), prepaid tokens with auto top-up (`createBillingOnDemand`) and
the subscription self-service (cancel, payment details, invoices).

**`salespage`** is worth offering in the same breath: from this moment the app has
real products, real prices and a working checkout, which is everything the home
page needs to stop being the template's placeholder. Then, before the launch:
`salespage` → `ux-gateway` (now that there is a checkout, the first five minutes
can be checked) → `security-gateway` → `performance-gateway` →
`compliance-check` → `go-live` → `go-to-market`.

## Important rules

- **Signature verification is mandatory and fail-closed.** Without a valid
  SHA512 signature an IPN is rejected with `403`. Never loosen that check.
- **No demo/mock fallback.** If an API call fails, an error is thrown — a failed
  checkout must never count as a success.
- **API key & passphrase are secrets.** They live in the `.env` (in STAGING/PROD
  in the hoster's secret management) and are read exclusively through
  `lib/digistore/settings.ts` — never in the code, in the repo or in logs.
  `ds24ApiKey()` throws if the key is missing; no silent fallback.
- **Look a field name up, never guess it.** The payload, the events, the
  `createBuyUrl` parameters, which API function needs which key, and Digistore24's
  own authoritative references:
  [`docs/digistore-integration.md`](../../../docs/digistore-integration.md).
