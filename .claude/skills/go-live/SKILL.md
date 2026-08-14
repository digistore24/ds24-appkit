---
name: go-live
description: Brings the app online and proves that a purchase really unlocks access — pre-flight, the hosting handed to `setup-hosting`, then Digistore products and approval, the IPN on the real domain, a real test purchase and a re-check of security and performance live. Use this when the app is built, secured and scaled — before marketing — and when the user says "let's go live", "put it online for real", "launch it", "the whole launch", or asks whether a purchase will really work in production.
requires: 0.15.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Go-Live — putting it online and verifying it

Goal: get the app **reliably live** and prove that the purchase-to-access flow works
in production. Guide the user step by step; they do not have to know anything
technical by heart. The reference behind every step is
[`docs/DEPLOY.md`](../../../docs/DEPLOY.md).

The **hosting itself is its own skill** — `setup-hosting` — because it is a
conversation of its own: which host, what it costs, an account, a CLI, a token, a
database. This skill owns the two ends around it: is the app ready to go, and does it
really sell once it is up.

## 1. Pre-flight (before the deploy)

Eight checks, each a **stop condition**, and you run them yourself. Four the host
enforces anyway at boot, where the same fault reads as a broken deploy. What each
costs when skipped, and the one no boot guard can catch:
[`references/preflight.md`](references/preflight.md).

1. **Green locally** — `node run.mjs test` and `node run.mjs build`, no errors.
2. **Mail delivery exists** — otherwise `node run.mjs mail-setup`. Mandatory in
   STAGING/PROD, where the app aborts at startup without it. **The single most common
   reason a first deploy fails.**
3. **The sender address is on the app's own domain** and verified at the provider
   (DKIM/SPF), and `NEXT_PUBLIC_APP_NAME` is set **at the host**.
   `node run.mjs doctor --deploy` gives the verdict from this machine.
4. **The app's own address is set at the host** — `APP_URL=https://YOUR-DOMAIN`,
   no trailing slash, and no `AUTH_URL`/`NEXTAUTH_URL` beside it. STAGING/PROD abort
   at startup without it, because everything the app MAILS OUT takes its origin from
   it — the sign-in link above all (`setup-hosting` step 7).
5. **Somewhere for files to live — *if the app takes files*.** `config/media.json` →
   `enabled` first; if yes, `node run.mjs media-check`. Booking the bucket was
   `setup-hosting` step 6b; this is the check that it happened.
6. **The home page sells the product, not the template** — a still-placeholder
   `app/page.tsx` is the skill **`salespage`**.
7. **The icons are the app's** — the three under `public/icons/` against
   `app/icon.png`; they land on a customer's home screen and stay. The skill is
   **`design`**.
8. **Migrations and the law** — `drizzle/` up to date (`node run.mjs db-generate`),
   and `node run.mjs legal-check` green **before** the deploy: a placeholder Impressum
   on a live domain is both a legal problem and the first thing a visitor reads. What
   fixes it is **`compliance-check`**.

## 2. Hosting → **`setup-hosting`**

Start that skill and let it finish. It picks the host with the user, says what it
costs before anything is booked, installs the CLI, authenticates, creates the app, the
managed Postgres and the media bucket, sets every environment variable, wires
`npm run db:migrate` into the deploy and puts a domain on it.

Come back here when the app answers on its domain.

## 3. Database in production

`setup-hosting` wires `npm run db:migrate` as the host's **pre-deploy step**, so it
runs before each new version takes traffic. If it was left out, put it in now rather
than migrating by hand — a manual step in a deploy is one that gets skipped exactly
once ([`docs/DEPLOY.md`](../../../docs/DEPLOY.md) → *Migrations*).

**Then two things the migration did not do, and neither happens by itself.** The
operator account — "first sign-in becomes owner" is DEV-only, so on a live app the
first person through the door may be a customer — is
`node run.mjs user-create --email you@example.com --role owner --apply` against the
production `DATABASE_URL`. And the app's own CONTENT is still only on the machine it
was built on: step 5's **content parity** item.

## 4. Digistore: products, approval & IPN on live

**Every environment has its own product set** — what the user has been test-buying
locally is the `[DEV]` set and it never goes live
([`docs/environments.md`](../../../docs/environments.md)). This creates the **PROD**
one, and only **after the app is deployed and answers**: registering the IPN needs
`https://YOUR-DOMAIN/api/ipn` to return HTTP 200. You run all of it.

1. `APP_URL_PROD=https://YOUR-DOMAIN` into the local `.env` — **not** `APP_URL`,
   which stays local or the development login dies.
2. `node run.mjs ds24-sync --env prod` — the live products, their ids into
   `productIds.prod`, and the prod IPN connection scoped to exactly those products.
   Never `node scripts/ds24/sync-products.mjs`: it skips the IPN, and purchases then
   unlock nothing. Two stops here:
   - 🚨 **It adopts; it must never recreate.** An older app's products have no set,
     and the first `--env prod` run updates them in place so sales and approvals
     survive. **`would create` in the dry run for a product that already sells: stop
     and look before applying.**
   - 🚨 **Read the warnings and fix the registry first.** Last moment to get one
     product per plan AND language right; a gap puts half your customers on an order
     form in the wrong language, and fixing it later means new products, new
     approvals and dead links you already handed out.
3. Nothing to do about **prices** — they travel with the checkout call, so create no
   payment plans in the Digistore24 interface.
4. `node run.mjs ds24-approval --apply`, once the product description and the app are
   mature. Read the dry run first, then check that **every** row reaches `approved`
   and not only the first — a bilingual plan is two products at two marketplaces, and
   the second gets forgotten. **A Direct Seller has no approval step at all**: the
   command says so and writes nothing. That rule and every refusal `--apply` makes on
   purpose: [`docs/digistore-integration.md`](../../../docs/digistore-integration.md).
5. `node run.mjs ds24-testpay --recreate` — rotate the test-purchase key. It is
   account-level, so an old copy on a live checkout URL unlocks free purchases.
6. **Get the IPN secrets to the host.** Step 2 wrote `…_PROD` reference copies of
   the passphrase and the domain id into the local `.env`; store both at the host
   under the **unsuffixed** names and redeploy. **Until then the live app rejects
   every IPN signature** and a paid purchase unlocks nothing
   ([`docs/DEPLOY.md`](../../../docs/DEPLOY.md)).

## 5. Smoke test (live)

Six things have to be true before the launch is finished. The walk-through — the
commands, what their output means, and the two content legs that may still need
filling — is [`references/smoke-live.md`](references/smoke-live.md).

- **The app and its database answer** — `/api/healthz` and `/api/readyz`. These two
  are what `setup-monitoring` step 4 makes repeat, so offer it once the launch is done.
- **Every page answers, signed in** — `node run.mjs smoke --url https://…` after
  `node run.mjs smoke-account --apply` gave it a way in. No 5xx, and "N protected
  page(s) NOT checked" is not a pass.
- **The sign-in mail itself is right**, not only the page it leads to: the product's
  name, a **button whose link is on the live domain** — not `localhost`, not the
  host's internal name; that is `APP_URL` at the host, and the boot guard can only
  prove it is *a* URL, never that it is *yours* — footer links on the live domain,
  the Impressum's text in the **mail's** footer.
- **The domain is verified in Google Search Console** — now, not when something goes
  wrong: it is where Google reports a Safe-Browsing flag and the only place a review
  can be asked for ([`docs/troubleshooting.md`](../../../docs/troubleshooting.md)).
- **Production holds the app's own content and knowledge media**, if it ships any.
  `node run.mjs content-check --env prod` green is the exit condition — and then one
  real content page opened by hand, because an empty course page is a clean 200
  ([`docs/content.md`](../../../docs/content.md)).
- **A purchase works end to end** — "test connection" in Digistore24 (IPN
  `connection_test` → 200), then a real/test purchase: the order shows up and access
  is unlocked. Custom domain + HTTPS active.

## 6. Checking the experience, security & performance against LIVE

- Run **`ux-gateway`**, **`security-gateway`** and **`performance-gateway`** once more
  against the live instance — the full pass in each, and this time the `host` check
  has something to look at and the load test runs against the live URL at `-c 100`.
  All three write a dated report into `docs/reports/`, and those reports are the
  record that the launch was checked. Only when they are green is "live" finished.
- **`ux-gateway` has something here it cannot have locally: a real purchase on the
  real domain.** Buy one as a stranger would, on a phone, and stop on the page you
  land on afterwards. That is the screen the whole launch is judged on, and the one
  nobody sees until the day it is live.

## 7. Safeguards

- Know the rollback path (roll the previous deploy back at the host).
- Backups of the production DB enabled.

## Principles
- **Test live first, then advertise.** Do not market anything that is not verified live.
- **Secrets only at the host**, never in the code/repo.

Next step after a successful go-live: **`go-to-market`** (marketing).
