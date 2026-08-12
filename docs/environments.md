<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Environments: DEV · STAGING · PROD

The app runs in up to three environments, and **each one has its own product
set at Digistore24** (`config/digistore-products.json` → `productIds.<env>`).
`node run.mjs ds24-sync --env dev|staging|prod` maintains exactly one set per
run and never touches the others; without `--env` the environment follows
`APP_ENV`, so a plain `ds24-sync` on your machine syncs DEV and the same
command on the deployed host syncs PROD.

**STAGING is optional.** Most apps go dev → prod and never create a staging
set — that is fine as long as they test (test purchases against the dev set,
`node run.mjs smoke`/`errors`, and go-live's live checks). A staging set earns
its place when real people test on a public domain before the launch.

| What | DEV (local) | STAGING (optional) | PROD |
|-----|-------------|--------------------|------|
| `APP_URL` | `http://localhost:3000` | staging domain | live domain |
| `DATABASE_URL` | local Postgres (Docker) | staging DB | prod DB |
| Products (`productIds.<env>`) | own set, names carry ` [DEV]` | own set, ` [STAGING]` | own set, clean names |
| Thank-you/IPN target | Cloudflare Quick Tunnel / redirect → localhost | `APP_URL_STAGING` | `APP_URL_PROD` (or `APP_URL` on the host) |
| IPN connection | own (`DIGISTORE_IPN_DOMAIN_ID`, scoped to the dev ids) | own | own |
| Payments | **DS24 test purchases** | test purchases | real purchases |
| Marketplace approval | not needed | not needed | **the** approval (prod set only) |
| Mail delivery | optional | **mandatory** | **mandatory** |
| Sign-in without a mail account | **yes** (development sign-in) | no | no |

All sets live in one vendor account, told apart by the internal name
(`key__language__env`) and — for a human in the DS24 backend — by the name
suffix and the app's own **product group** (folder), which the sync creates
once and records in the registry (`productGroupId`).

> **Compatibility:** an app that has never run an env-aware sync keeps its old
> shared products — they count as the PROD set (`ds24-sync --env prod` adopts
> them, updating instead of recreating, so sales and approvals survive), and
> an environment without a set of its own falls back to the prod set at
> runtime. So nothing breaks on update; the dev set starts to exist the first
> time you run `node run.mjs ds24-sync` locally.
>
> **In DEV the test payment sets itself up:** every checkout link the app
> builds carries the Digistore24 test-payment parameter (fetched via the API,
> cached in `.dev/testpay.json` — see `lib/digistore/testpay.ts`, inspect with
> `node run.mjs ds24-testpay`). Like the development sign-in it is an
> allowlist: only `APP_ENV=development`, only on localhost, never under
> `NODE_ENV=production`, hard off with `DS24_TESTPAY=off`. On STAGING (a public
> domain) the vendor sets the DS24 test-purchase cookie in the browser instead.

`APP_ENV` (`development` | `staging` | `production`) does not only name the
environment — **hard rules** hang off it:

- **STAGING and PROD require mail delivery.** If it is missing, the server
  start aborts with an explanation (`instrumentation.ts` → `lib/env-guard.ts`).
  Better a clear error at deploy time than a running app that nobody
  can sign in to.
- **The development sign-in only applies in DEV.** If no mail delivery is
  configured, the sign-in page signs you in locally without a magic link and
  without a password, so you can get going right away. Four conditions have to
  hold at the same time for that: `APP_ENV`=development, `NODE_ENV`≠production,
  `APP_URL` on localhost, and no mail delivery. As soon as you run
  `node run.mjs mail-setup`, it disappears.
- **Unknown `APP_ENV` values count as `production`.** So a typo leads to the
  strictest environment, not to the loosest.

The concrete values come from the respective `.env` or from the host's secrets.

## What data lives where — nothing crosses by itself

Each environment has its **own database and its own media store.** The table
above lists three `DATABASE_URL`s because there are three databases — a row
written into one exists in none of the others, and the same holds for every
file in a media store. The repo is the only thing all environments share.

| | Travels dev → prod how |
|---|---|
| Code, pages, migrations, `content/` and `config/` files | by itself, with every deploy (git) |
| The schema | `npm run db:migrate` in the deploy hook — structure, never rows |
| Digistore products | `node run.mjs ds24-sync --env prod` (one set per environment) |
| **Rows** — catalog entries, media rows | `node run.mjs content-apply --env prod` |
| **Rows** — accounts, grants, community rooms, courses | your agent, over the setup surface ([`setup-mcp.md`](setup-mcp.md)). ⚠️ Two routes now, and a row class belongs to exactly one of them — never both, or they drift |
| Media files (bytes) | shipped ≤ 10 MB: with the repo, via `content-apply` · staged: `node run.mjs content-media-sync --env prod --apply` |
| Knowledge media (the assistant's) | `node run.mjs kb-media-sync --env prod --apply` |
| Customer data | **never.** It is born in its environment and stays there |

The failure this table exists to prevent: an app built and tested locally —
course rows in the local Postgres, videos in the local store — deployed, and
live **empty**, with every local gate green. `node run.mjs content-check --env prod` is the command that catches it, and  [`content.md`](content.md) is
the full story.

## Receiving IPNs locally (DEV) — Cloudflare Quick Tunnel

Digistore24 has to reach the IPN via HTTPS. Locally that works without extra
services through a **free Cloudflare Quick Tunnel** (no account, no domain):

```bash
node run.mjs start      # app on http://localhost:3000
node run.mjs ds24-sync  # products + IPN — opens the tunnel by itself if it needs one
```

`node run.mjs ds24-sync` notices that `APP_URL` is local, opens the public address onto
your running app and registers it at Digistore24 as the IPN endpoint (path
always `/api/ipn`). It announces that plainly: while the tunnel runs, your
machine is reachable from the internet. It runs in the **background** and
returns — no terminal of its own, no Ctrl-C. `node run.mjs status` shows it, `node run.mjs stop`
ends it along with the app and the database.

`node run.mjs ds24-tunnel` does the same on its own, without touching the products. An
already-running tunnel is reused by both, so the order never matters.

**`node run.mjs stop` ends the tunnel, `node run.mjs start` brings it back.** You do not have to
think about it: once an app has an IPN connection (`DIGISTORE_IPN_DOMAIN_ID` in
the `.env`), every `node run.mjs start` re-opens the tunnel and re-points Digistore24 at
it. An app that never received an IPN gets nothing — `node run.mjs start` does not put
your machine on the internet on its own — and with a public `APP_URL`
(STAGING/PROD) it never happens at all.

The address is **new every time**, and it has to be: a free quick tunnel gets a
random name on each start, and keeping one would need a Cloudflare account, a
named tunnel and your own domain. That is why the connection hangs off a stable
`domain_id` — every open updates the same connection instead of adding another.

Two things deliberately do **not** open a tunnel:

- `node run.mjs ds24-sync --dry-run` — a preview must not publish your machine.
  ⚠️ Note which way round that is: **`ds24-sync` APPLIES**, and `--dry-run` is the
  preview. It is the one command here whose bare form writes.
- `node run.mjs ds24-sync --no-tunnel` — to get the old behaviour back.

If you want to do the registration yourself:

```bash
node scripts/ds24/ipn-setup.mjs \
  --url "https://<random>.trycloudflare.com/api/ipn" --apply
```

Notes:
- **`APP_URL` stays as it is** — deliberately. It is the address of your app,
  not of a temporary tunnel, and a non-local value there switches the
  development login off (`lib/auth/dev-login.ts`); you would suddenly be unable
  to sign in locally. The tunnel address goes to `ipn-setup.mjs` directly.
- The tunnel URL **changes on every start** — the next `node run.mjs ds24-tunnel` registers
  the new one by itself. The `domain_id` stays stable through that
  (`local-<projectname>-<random>`, in the `.env`), so the connection is updated
  instead of multiplied. The random tail is not decoration: Digistore24 finds a
  connection by (merchant, API key, `domain_id`), so two of your own projects
  that both call themselves `local-app` overwrite each other's IPN — silently,
  and the loser's purchases then arrive nowhere. See
  `docs/digistore-integration.md`.
- A brand-new address takes half a minute or so to be reachable worldwide.
  Until then Digistore24 answers "http error 0" — `node run.mjs ds24-tunnel` knows that and
  simply tries again.
- Every environment has its **own IPN connection** (its own `domain_id`),
  scoped to that environment's product ids — so a dev test purchase reports to
  your machine and a live purchase to the live app, at the same time, in one
  vendor account. One consequence to know: a dev app whose dev set is empty
  falls back to the prod products at checkout, and those purchases arrive at
  the **prod** connection, not the tunnel — sync the dev set
  (`node run.mjs ds24-sync`) and the loop closes locally.
- The IPN signature check (SHA512) applies locally too — `DIGISTORE_IPN_PASSPHRASE`
  in the `.env` has to match the DS24 setting.

## Products per environment & go-live

One command, one environment per run:

```bash
node run.mjs ds24-sync                 # your machine: the DEV set (names carry [DEV])
node run.mjs ds24-sync --env prod      # the LIVE set — needs APP_URL_PROD in the .env
                                       # (or run it on the deployed host, where APP_URL is the domain)
node run.mjs ds24-sync --env staging   # optional, only if you run a staging host
# No payment plans in the DS24 UI: price and interval travel with each checkout
# call as a payment_plan. One price, one place — config/digistore-products.json.
node run.mjs ds24-approval --apply     # approval for the PROD set (approval_status=pending);
                                       # reseller from language (DE→1, otherwise US→2)
```

A locally-run `--env prod` stores the prod connection's values as reference
copies (`DIGISTORE_IPN_PASSPHRASE_PROD`, `DIGISTORE_IPN_DOMAIN_ID_PROD`) —
copy them into the host's secrets as the unsuffixed keys and redeploy; until
then the live app rejects every IPN signature. And it can only register the
IPN once the prod host already answers (`/api/ipn` must return HTTP 200), so
the order is: deploy first, then `--env prod`, then the secrets.

Details on go-live: skill **`go-live`**.
