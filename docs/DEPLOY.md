<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Deployment — putting the app on a server

This is the reference. The guided way through it is the skill **`setup-hosting`**
(`node run.mjs`-driven, it does the work and hands the user the two or three
things only they can do). Read this when you want to know *why* a step is there,
or when you are doing it by hand.

## What this app needs from a host

Four things, and they are what rules most hosts in or out:

1. **Node ≥ 20 and a process that keeps running.** The app schedules its own
   jobs while it is up (`docs/cron.md`) and holds a database pool. A platform
   that freezes the process between requests breaks both — see the warning about
   free tiers below.
2. **A Postgres it can reach**, with a connection string. Managed is the point
   here: nobody building their first SaaS should also be running a database.
3. **A public https domain.** Not a nicety — Digistore24 refuses to store any
   other kind of URL, so without one there is no IPN and no purchase reaches the
   app.
4. **Somewhere to put secrets** that is not the repository.

Two things it does **not** need, and it is worth knowing before somebody sets
out to build them: **no Docker** (the hosts below build it themselves) and **no
special production build**. `npm run build` and `npm run start` are the whole
contract. `output: "standalone"` is available in `next.config.ts` and switched
off deliberately — it only pays for itself when you build your own image.

If you do switch it on, the content machinery travels with it: `next.config.ts`
traces `config/modules.json`, the module manifests, `scripts/content/` and the
whole `content/` tree for `/api/setup`, so `node run.mjs content-check` keeps
answering from inside the image instead of reporting *"I could not look"*. An
installed module's own applier directory comes from its manifest, so a module
you add later needs nothing here. The handbook has the same protection
([`ai-chat.md`](ai-chat.md)). What is **not** copied is what a standalone build
never copies — `.next/static` and `public/` go into the image beside
`server.js` by hand, as the Next docs describe.

**`npm run db:migrate` runs in production.** It uses the migrator from
`drizzle-orm`, a runtime dependency, so it still works in an image that dropped
its devDependencies — which every one of these hosts does. (It used to be
`drizzle-kit migrate`, and that one is gone from the image by the time you need
it. If you read that instruction in an older copy of this file, this is what
changed and why.)

## The four hosts

All four deploy from a GitHub repository, all four give you a managed Postgres,
all four give you an https subdomain to start with. They differ in what the
agent can do for the user and in what breaks quietly.

| | **Railway** | **Render** | **Fly.io** | **DigitalOcean** |
|---|---|---|---|---|
| Setting it up | dashboard or CLI | dashboard | **CLI** (`fly launch`) | dashboard or CLI |
| Agent can drive it end-to-end | mostly | partly | **yes** | mostly |
| Migration before the new version starts | pre-deploy command | pre-deploy command *(paid plans)* | `release_command` | `PRE_DEPLOY` job |
| Where the money goes | app + usage-billed database | app + database, both per plan | app is cheap, **the database is not** | app + database, both per plan |
| The trap | usage billing has no ceiling | **the free tiers** (below) | check the database price first | pick the region twice |

### What it costs — look it up, never quote it from memory

**There are deliberately no prices in this repository.** They change, a stale
number in a document is worse than no number (somebody budgets on it), and the
one thing that must be right is the figure the user hears *before* they book
anything.

So: **read the host's own pricing page at the time**, and give one rough monthly
estimate for what this app actually needs — **one small always-on instance plus
one small Postgres**. Both parts, not just the app; the database is regularly the
larger half, and on one of the four it is several times the app.

Two things about the shape of it are stable enough to say without looking:

- **The four are not in the same price bracket.** Three land close together;
  **Fly.io's managed Postgres is the outlier by a wide margin**. Do not recommend
  Fly without pricing its database first — the deploy experience is the best of
  the four, and that is exactly why somebody ends up there without noticing.
- **Nothing here is free**, and the free tiers that exist are not a saving (next
  section).

**Which one?** If the user has no opinion: **Railway** — shortest path, and no
surprise on the database. **Fly.io** if the agent should do everything and the
user nothing, once the database price has been named and accepted; a sensible
middle is the app on Fly.io with the database elsewhere (see its section).
Render is the one to be careful with, DigitalOcean the one to pick if the user
is already there.

### The free tiers, and why this app should not be on one

Two of them will happily hand you something free, and both fail in a way that
looks like a bug in your app three weeks later:

- **A web service that spins down when idle.** Render's free plan stops the
  process after **15 minutes** without traffic, and waking it up takes about a
  minute. With the process stop the scheduled jobs — the ones that delete buyer
  data after 60 days (`docs/cron.md`) — and a Digistore24 IPN that runs into a
  minute of cold start is a purchase that unlocked nothing.
- **A database that expires.** Render's free Postgres expires **30 days after
  creation**, with a 14-day grace period to upgrade it; after that Render
  deletes it *and all of its data*. That is customers, orders and grants, gone
  on a date nobody wrote down.

Say this once, plainly, and let the user decide. It is their money and their
risk — but nobody should discover either of these from a support mail.

## What has to be in the environment

Everything below is set **at the host**, never in the repository. The values are
the ones from `.env.example`; `.env` itself is never deployed.

**Required — the app refuses to start without them** (`lib/env-guard.ts` checks
this at startup and aborts, deliberately, rather than running an app nobody can
sign in to):

| Variable | Value |
|---|---|
| `DATABASE_URL` | from the host's Postgres — usually injected for you |
| `AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AUTH_TRUST_HOST` | `true` — all four run the app behind a proxy |
| `APP_URL` | the live domain, `https://…`, no trailing slash. **This is where the sign-in link points** — `AUTH_TRUST_HOST` only says which `Host` values are accepted, and behind a router that is `localhost:8080`. `AUTH_URL` is derived from this and must not be set to anything else (`docs/auth-setup.md`) |
| `APP_ENV` | `production` (or `staging`) |
| **mail — one of the two** | `POSTMARK_SERVER_TOKEN` + `POSTMARK_SENDER`, **or** `SMTP_HOST` + `SMTP_USER` + `SMTP_PASSWORD` (+ `SMTP_FROM`) |
| `EMAIL_FROM` | the sender address (fallback when no `SMTP_FROM`/`POSTMARK_SENDER`) — **must live on the app's own domain** (boot-enforced; `docs/auth-setup.md` → the sender rule; deliberate exception: `EMAIL_FROM_FOREIGN_DOMAIN`) |
| `MEDIA_DRIVER` | `s3` — see below. Anything else and the app refuses to start |
| `MEDIA_S3_ENDPOINT` | your bucket provider's endpoint |
| `MEDIA_S3_BUCKET` | the bucket's name |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | its credentials |
| `MEDIA_S3_REGION` | **required on everything except Cloudflare R2** — see the note below |

> **Mail is not optional in production, and this is the mistake that costs the
> first deploy.** In DEV you can sign in without it (the development login); in
> STAGING and PROD that route does not exist, because it is an auth bypass. So an
> app deployed without a mail transport starts, checks, and stops with
> `✗ Startup aborted`. Set it up *before* the first deploy —
> `node run.mjs mail-setup` walks through it locally, `docs/auth-setup.md` has
> the detail.

> **Files go in a bucket, and this is the mistake that costs the first
> redeploy.** In DEV uploads land on your own disk and everything works. On a
> host that is not storage: the next deploy replaces the machine and every file
> with it, and a second instance has its own disk — so an upload lands on one,
> the next request is answered by the other, and a customer's picture is there
> about half the time. Because none of that shows up while you are testing on
> one machine, the app **refuses to start** rather than warning.
>
> **Seven providers are carried and one big one is not.** Amazon S3,
> DigitalOcean Spaces, Cloudflare R2, Backblaze B2, Hetzner Object Storage,
> MinIO and Wasabi. **Google Cloud Storage does not work** — the app signs its
> own requests and GCS wants a different algorithm value and `x-goog-*` copy
> headers, which is a second signer rather than a setting. The reasoning, the
> three exact mismatches and the one measurement that would overturn the answer
> are in `docs/visuals.md` → *Seven providers*. The per-host instructions below
> say which of the seven is closest to hand.
> `node run.mjs media-check` writes, reads, copies and deletes a test object to
> prove whichever you picked.
>
> 🚨 **`MEDIA_S3_REGION` is required on everything except R2.** It defaults to
> `auto`, which is what Cloudflare R2 documents and what MinIO ignores — and
> **AWS S3, Backblaze B2 and Wasabi validate it and answer 403 without it.** Left
> unset against one of those, the app starts, every check passes, and the first
> upload fails after your customer has waited for their file to travel. The app
> deliberately does not refuse to start over it: it cannot tell which provider an
> endpoint belongs to, so the guard would have to guess and a wrong guess would
> refuse a working R2 setup. `node run.mjs media-check` says it in words instead.
>
> `MEDIA_S3_PUBLIC_BASE_URL` is genuinely optional — set it to a CDN or a custom
> domain on the bucket and public images reach visitors without touching your
> app at all.

**Required as soon as the app sells anything** — written into the local `.env`
by `node run.mjs ds24-connect` and `node run.mjs ds24-sync --env prod` (there
as `…_PROD` reference copies), and copied from there to the host under the
**unsuffixed** names:

`DIGISTORE_API_KEY` · `DIGISTORE_IPN_PASSPHRASE` · `DIGISTORE_IPN_DOMAIN_ID`

**Optional, by what the app does:**

| Variable | When |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | sign-in with Google (`docs/auth-setup.md`) |
| one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY` | the assistant or any other AI task (`docs/ai-providers.md`) |
| `CRON_SECRET` | to check from your machine whether the scheduled jobs are running (`node run.mjs cron --list --url …`, below), and if the host does the timing instead of the app. Without it that endpoint refuses to run at all |
| `DIAGNOSTICS_SECRET` | to read this app's own error window from your machine with `node run.mjs errors --url …` (below). Without it that endpoint answers 404 like a route that was never built |
| `APP_TIME_ZONE` | the zone dates are rendered in (default `Europe/Berlin`) |
| `DB_POOL_MAX` | lower than 10 on a small database — see the note under Railway |
| `NEXT_PUBLIC_APP_NAME` | the app's name in the interface |
| `MEDIA_S3_PUBLIC_BASE_URL` | where a browser reads public files — a CDN or a custom domain on the bucket (`docs/visuals.md`) |

> **`NEXT_PUBLIC_…` is baked in at build time, not read at run time.** Setting it
> after the build changes nothing and looks like the host ignoring your variable.
> Set it before the build, then redeploy.

## Migrations — the step to get right once

The rule: **the schema is migrated before the new version serves a request.**
Every host below has a hook for exactly that, and using it is the difference
between a deploy and an outage — a new version querying a column its migration
has not created yet answers 500 to everybody.

The command is always the same:

```
npm run db:migrate
```

It is idempotent (it applies what has not run yet and nothing else), it is safe
to run twice, and it is safe to run while the old version is still serving —
provided the migration itself is written that way. `docs/database.md` has the
two rules for that: new columns nullable or with a default, and a removal only
after the version that stopped using them is live.

**After the very first deploy, two things are still missing — and neither
arrives by itself.** The migration creates every TABLE; it fills none of them.
A fresh production database is empty, and so is a fresh production bucket.

**First, the operator account.** The first person to sign in becomes a
customer — **not** an operator. So create the account yourself, before you
announce the app:

```
node run.mjs user-create --email you@example.com --role owner --apply
```

against the production `DATABASE_URL`. (The "first account becomes owner" rule
is DEV-only, on purpose: a fresh production database is empty in exactly the
same way, and there the first person through the door is a stranger.)

**Second, your content.** Rows written into the local database and files put
into the local media store stayed on your machine — a course built and tested
locally goes live EMPTY unless its content is applied to production, and every
local gate stays green while it does. If this app ships content
(`content/media-manifest.json`, `scripts/content/appliers/`), the go-live step
is:

```
node run.mjs content-media-sync --env prod --apply    # staged media → prod bucket
node run.mjs content-apply --env prod                 # rows + shipped media
node run.mjs content-check --env prod                 # green = prod holds it
```

with the production `DATABASE_URL` set the same way as for `user-create`. The
whole story — what travels with a deploy and what never does — is
[`docs/content.md`](content.md); the guided version is the `go-live` skill.

---

## Railway

**What the user books:** a Railway account (GitHub sign-in), then the **Hobby**
plan — Railway has no free tier that runs anything permanently. Postgres is a
service inside the same project, billed by usage.

**How the agent gets in:**

```
node run.mjs doctor --deploy     # names the install command for THIS system
railway login                    # opens the browser — the user confirms, once
railway whoami                   # proof it worked
```

For a machine that has no browser, the user creates a token in the dashboard
(*Account Settings → Tokens*) and it travels as an environment variable:

```
RAILWAY_TOKEN=…  railway status
```

**The deploy:**

1. `railway init` (or *New Project → Deploy from GitHub repo* in the dashboard).
2. Add Postgres: `railway add --database postgres`. **The app does not get
   `DATABASE_URL` from this by itself** — the database is a service of its own,
   with its own variables, and the app service has to point at it:

   ```
   railway variables --set "DATABASE_URL=${{Postgres.DATABASE_URL}}" --service <app>
   ```

   That is a **reference**, not a copy: it resolves at deploy time, so it still
   holds after the database is rotated or moved. Pasting the literal string is
   the version that works today and breaks quietly later. (`Postgres` is the
   database service's name — `railway status` shows what yours is called.)
3. Variables: `railway variables --set "AUTH_SECRET=…" --set "APP_ENV=production"`
   … — everything from the table above. Quote each pair; several of these values
   contain characters a shell would otherwise eat.
4. Set the **pre-deploy command** to `npm run db:migrate` (service → *Settings →
   Deploy*). This is the migration hook; without it you are migrating by hand
   after every schema change, and one day you will forget.
5. `railway up`, or push to the connected branch.
6. Domain: *Settings → Networking* gives you a `…up.railway.app` to start with;
   a custom domain is a CNAME. Put whichever one is final into `APP_URL`.

**Two Railway-specific things.** Usage billing has **no ceiling by default** —
set a spend limit in the dashboard on day one. And its Postgres plans are small
on connections; if the app logs `too many clients`, set `DB_POOL_MAX=5`.

## Render

**What the user books:** a Render account, a **Starter** web service (not Free —
see above) and a **paid Postgres** (the free one expires after a month).

**How the agent gets in:** it largely does not, and that is the honest answer.
Render is set up in the dashboard; the user clicks. There is an API and a CLI,
but the first-time setup is a browser flow (authorising GitHub, picking plans),
so plan for guiding rather than doing.

**The deploy:**

1. *New → Web Service* → connect the repo.
   - Build command: `npm ci && npm run build`
   - Start command: `npm run start`
2. *New → Postgres*, then copy its **Internal Database URL** into the web
   service as `DATABASE_URL`. Internal, not external: same data centre, no
   public hop, and no SSL to configure.
3. Environment: everything from the table above, under *Environment*.
4. **Pre-Deploy Command:** `npm run db:migrate`. It exists on paid instance
   types only — one more reason Free is not a saving here. On a plan without it,
   run the migration in the shell after each deploy that carries a schema change,
   and know that this is the manual step you will eventually skip.
5. Domain: `…onrender.com`, or a custom one under *Settings → Custom Domain*.
   Into `APP_URL`.

## Fly.io

The one the agent can do end to end, because everything is a command — and the
one where the database costs real money. Read the next paragraph before
recommending it.

**What the user books:** a Fly account with a payment method. The app itself is
cheap — a shared-CPU machine, no plan to choose up front. **The database is
not.** Fly's Managed Postgres has no small entry plan the way the other three
do; its cheapest tier is a real managed database with high availability, backups
and connection pooling, and it is priced like one. **Look up the current MPG
price before you recommend Fly at all**, and say it out loud.

Three honest options, and the user picks:

| | |
|---|---|
| **Fly app + Fly MPG** | everything in one place, everything scriptable, backups and failover included — and the most expensive of these four combinations by some way |
| **Fly app + an external Postgres** (Neon, Supabase) | keeps the part that makes Fly nice — the deploy — and drops the part that makes it expensive. Put the connection string in `DATABASE_URL` by hand and skip step 2 below |
| **Another host entirely** | if the database price is the deciding factor, Railway is the shorter path anyway |

**Never the unmanaged one as a way to save money.** `fly postgres create` makes a
Postgres *you* operate: Fly says plainly it offers no support for it, and
scaling, version upgrades, security patches, off-site backups and outage
recovery are yours. For somebody launching their first SaaS that is not a
cheaper database, it is an unpaid second job with their customers' data on it.

**MPG is not in every region.** The list is shorter than Fly's app regions and
is being extended; check it before choosing one (`fly mpg create` offers what is
available). If the user's region is not among them, that is an argument for the
external database, not for putting the app somewhere far from its data.

**How the agent gets in:**

```
node run.mjs doctor --deploy     # names the install command for THIS system
flyctl auth login                # browser, once
flyctl auth whoami
```

Headless: the user creates a token (`flyctl tokens create deploy`, or in the
dashboard) and it travels as `FLY_API_TOKEN`.

**The deploy:**

1. `fly launch` — detects Next.js, writes a `Dockerfile` and a `fly.toml`, and
   asks about a database. Say **no** to Postgres here and decide it in step 2 on
   purpose, with the price on the table, rather than accepting what the wizard
   picks.
2. Postgres, if it is to be Fly's:
   ```
   fly mpg create --name my-saas-db --region fra --plan basic --volume-size 10
   fly mpg attach <cluster-id> -a my-saas
   ```
   `attach` **sets `DATABASE_URL` on the app itself** — there is no string to
   copy. It sets the *pooled* URL (PgBouncer), which is the right default: the
   app opens its own pool on top, and a pooler in front of a 1 GB database is
   what keeps a handful of app instances from exhausting its connections.
   Same region as the app, both times.

   With an external database instead, skip this step and set the connection
   string as a secret in step 3 like any other value.
3. Secrets — one command, and they are encrypted at rest:
   ```
   fly secrets set AUTH_SECRET=… APP_ENV=production APP_URL=https://… \
     POSTMARK_SERVER_TOKEN=… POSTMARK_SENDER=… EMAIL_FROM=… \
     DIGISTORE_API_KEY=… DIGISTORE_IPN_PASSPHRASE=… DIGISTORE_IPN_DOMAIN_ID=…
   ```
4. **The migration hook** — into `fly.toml`, and this is the piece `fly launch`
   does not write for you:
   ```toml
   [deploy]
     release_command = "npm run db:migrate"
   ```
   It runs in a one-off machine before the new version takes traffic. A failing
   migration cancels the release instead of publishing a broken app.
5. `fly deploy`. Then `fly logs`, and `fly status` for what is running.
6. Domain: `…fly.dev` to start with; `fly certs add your-domain.com` for your
   own, after pointing the DNS at it.

**Check the generated Dockerfile once.** `fly launch` writes it from what it
finds, and it prunes devDependencies for the runtime image — which is fine here
(`next`, `drizzle-orm` and `postgres` are all runtime dependencies), but it is
worth a look rather than a hope.

**If the app logs `prepared statement "…" already exists`, the pooler is why.**
`fly mpg attach` hands over the pooled URL, and a PgBouncer pooling per
transaction can hand two statements of one prepared query to two different
backend connections. This app talks to Postgres through `postgres.js`, which
prepares by default. Two ways out, in this order: the app's own pool is small
enough not to need the pooler (`DB_POOL_MAX=5` and the **direct** connection URL
from the MPG dashboard), or `prepare: false` on the client in `db/index.ts`.
Current PgBouncer versions support prepared statements in transaction mode, so
this may never appear — it is here because when it does, it appears in
production, under load, and reads like a bug in the app.

## DigitalOcean App Platform

**What the user books:** a DigitalOcean account, an **App Platform** app on the
Basic plan, and a database. Two shapes: a **dev database** (single node, cheapest,
fine to start) or a **managed Postgres cluster** (more expensive, backups and
failover). Both are created alongside the app.

**How the agent gets in:**

```
node run.mjs doctor --deploy     # names the install command for THIS system
doctl auth init                  # asks for a Personal Access Token
doctl account get
```

The token is the one thing only the user can produce: **API → Tokens →
Generate New Token**, scope *write*. It goes into `doctl auth init` or into
`DIGITALOCEAN_ACCESS_TOKEN` — and nowhere near the repository.

**The deploy.** App Platform is described by a spec file, which is the part
worth having in the repo — the dashboard flow is the same thing with more
clicking. Write `.do/app.yaml`:

```yaml
name: my-saas
region: fra                      # the same region as the database
services:
  - name: web
    github:
      repo: YOUR-NAME/YOUR-REPO
      branch: main
      deploy_on_push: true
    build_command: npm ci && npm run build
    run_command: npm run start
    instance_size_slug: apps-s-1vcpu-0.5gb
    instance_count: 1
    http_port: 8080
    envs:
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}     # the binding — never a pasted string
      - key: APP_ENV
        value: production
      - key: AUTH_TRUST_HOST
        value: "true"
      - key: AUTH_SECRET
        value: …
        type: SECRET
jobs:
  - name: migrate
    kind: PRE_DEPLOY               # runs before the new version takes traffic
    github:
      repo: YOUR-NAME/YOUR-REPO
      branch: main
    build_command: npm ci
    run_command: npm run db:migrate
    envs:
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
databases:
  - name: db                       # this name is what ${db.DATABASE_URL} refers to
    engine: PG
    version: "16"
    production: false              # false = the cheap dev database; true = a managed cluster
```

Then `doctl apps create --spec .do/app.yaml`, and afterwards
`doctl apps update <id> --spec .do/app.yaml`.

**Four DigitalOcean-specific things:**

- **`http_port` must match.** App Platform routes to the port it is told;
  `npm run start` listens on `PORT`, which the platform sets. Leave both alone
  and they agree — the number above is only there because the spec wants one.
- **Pick the region twice, the same both times.** An app in Frankfurt talking to
  a database in New York works, and is slow in a way that looks like your code.
- **Secrets go in as `type: SECRET`**, which encrypts them; without it the value
  sits readable in the app spec, and the spec is in your repository.
- **Its Postgres requires SSL.** The connection string DigitalOcean hands over
  carries `?sslmode=require`, and the app honours what the URL says. Take the
  string as given — trimming the parameter is how you get a connection refused
  on the first request and not before.

---

## Connecting Digistore24

1. `node run.mjs ds24-connect` in the terminal. The browser opens, the user
   confirms at Digistore24 — the API key lands in the local `.env`
   (`DIGISTORE_API_KEY`). There is deliberately **no** UI for entering keys.
2. Once the app is deployed and answers, sync the **prod product set**: set
   `APP_URL_PROD=https://YOUR-DOMAIN` in the local `.env` and run
   `node run.mjs ds24-sync --env prod`. It creates the live products (their
   own set — your local `[DEV]` products stay untouched) **and** registers the
   prod IPN connection via API (the URL is always
   `https://YOUR-DOMAIN/api/ipn`, signature SHA512). `APP_URL` itself stays
   local — changing it kills the development login. The generated passphrase
   and the stable domain id are written into the `.env` as
   `DIGISTORE_IPN_PASSPHRASE_PROD` / `DIGISTORE_IPN_DOMAIN_ID_PROD`
   (reference copies). Nothing has to be entered by hand in the Digistore24
   interface. (Running the sync **on** the host works too — there `APP_ENV` is
   `production`, so a plain `node run.mjs ds24-sync` targets prod and writes
   the unsuffixed keys.)
3. Copy the values into the host's secrets — **unsuffixed**, that is what the
   app reads: `DIGISTORE_API_KEY`, `DIGISTORE_IPN_PASSPHRASE` (= the `_PROD`
   value), `DIGISTORE_IPN_DOMAIN_ID` (= the `_PROD` value). Redeploy.
4. Trigger "test connection" in Digistore24 → the IPN must answer `200`.

## Scheduled cleanup

**There is nothing to set up.** The app schedules its own jobs while it is
running — see [`docs/cron.md`](cron.md). Two ship, both daily:

| Job | What it deletes | Window |
|---|---|---|
| `prune-ai-usage` | AI-usage rows — the cost history | 12 months |
| `prune-ipn-log` | IPN-log rows — raw webhook payloads, i.e. buyer PII | 60 days |

Both windows are one number in `config/cron.json`.

This used to be a manual step: an endpoint, and a line here telling you to point
your host's scheduler at it. It was the most skippable line in this document,
and skipping it left buyer data in the log for ever with nothing to say so.

**Two things to check after the first deploy**, because "it runs by itself" is
worth verifying once rather than assuming for a year:

```bash
node run.mjs cron --list --url https://YOUR-DOMAIN
```

and the `[cron]` lines in the app's log. There is nothing to install on the
host: this reads the same `GET /api/cron?list` from your machine, prints every
job with when it last ran and what it said, and marks the two states that mean
something — an **enabled** job that has never run, and any job with a failed run
behind it — ending on one line saying how many there are.

It needs two values in your local `.env`, and neither is generated for you:

```
APP_URL_PROD=https://YOUR-DOMAIN
CRON_SECRET_PROD=…            # the SAME value you set in the host's secrets
```

The secret is picked by matching the address against `APP_URL_PROD` /
`APP_URL_STAGING`, so it is never sent to a host it was not provisioned for —
a mistyped domain gets a refusal rather than your token. Unreachable, "the host
has a different secret" and "the host has no `CRON_SECRET` at all" are three
different messages; `last run: never` a week in means the scheduler is not
running — most likely the app is being restarted more often than the interval,
or `config/cron.json` has `"enabled": false`. Full reference:
[`cron.md`](cron.md).

### If you would rather your platform did the timing

Some hosts stop a container between requests, and some Operators simply want the
cleanup at 03:00 and not "24 h after last time". Both are handled the same way:

1. `"enabled": false` in `config/cron.json` — the in-app timer stops, the jobs
   stay.
2. Set `CRON_SECRET` in the host's secrets
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. Have the scheduler call it once a day:

   ```
   POST https://YOUR-DOMAIN/api/cron
   Authorization: Bearer <CRON_SECRET>
   ```

   - **Railway / Render / Fly / DigitalOcean:** a cron job running
     `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://YOUR-DOMAIN/api/cron`.
   - **A plain server / crontab:** the same `curl` line — or, with database
     access and no running app, `node run.mjs db-prune-ai` and
     `node run.mjs db-prune-ipn`.

Without `CRON_SECRET` the endpoint refuses to run (503, fail closed), so it can
never be left open as a "delete my data" URL. The in-app scheduler needs no
secret — it is not making a request.

## Proving it works

A deploy that finished is not a deploy that works. In order:

```
node run.mjs health --url https://YOUR-DOMAIN                    # one verdict — see below
DATABASE_URL="postgres://…" node run.mjs smoke-account --apply   # once — see below
node run.mjs smoke --url https://YOUR-DOMAIN
```

`health` is the one command to run first, and the one to run again a week later.
It asks six things and gives you **one verdict**: is the app answering
(`/api/healthz`), does its database answer (`/api/readyz`), is anything
scheduled failing or stalled, what are its pages hiding behind a 200, does the
media store answer, and when did the last payment notification arrive. Each
answers `✓`, a finding, or `⏭ NOT ASKED` **with a reason** — a probe that could
not look never counts as a pass. Three exit codes: **0** nothing found, **1**
something at HIGH or CRITICAL is open, **2** there was no address to ask, which
is *"I could not look"* and never *"it passed"*. `--json` gives an agent the
same facts, and every run leaves `.dev/health-check.json` behind. It needs the
two secrets below (`CRON_SECRET`, `DIAGNOSTICS_SECRET`) for four of its six
probes — without them those four say so by name instead of passing quietly.

The two public URLs it asks are still yours to point an **uptime checker** at,
and that is what they are for — they need no credential:

```
https://YOUR-DOMAIN/api/healthz      → {"status":"ok"}
https://YOUR-DOMAIN/api/readyz       → {"status":"ready"}   (this one talks to
                                       the database, and answers 503
                                       {"status":"not-ready"} when it cannot)
```

🚨 **Point the checker at the STATUS CODE, and match the body only with the
quotes**: `"status":"ready"`, never the bare word `ready` — it is a substring of
`not-ready`, so a keyword check written on it reports green while the database
is unreachable. And "any response counts as up" is the same bug in another
place, because readiness answers 503 deliberately.

🚨 **And write down which way round the keyword rule points**, because that field
is the same defect a second time. The alarm has to fire when `"status":"ready"`
is **ABSENT** — never when it is present. Providers spell that polarity opposite
ways and neither wording is guessable: UptimeRobot's `keyword_type` takes an
*exists* / *not exists* value and the intent here is *not exists*; Better Stack's
plain `keyword` type means *up while the keyword is present*, which is the one
you want, while its `keyword_absence` type is the inverse and is wrong here. Read
the field's own wording rather than copying a value out of a document — chosen
the wrong way round it is a check that is green exactly while the app is down.
The skill that sets this up, provider by provider, is `setup-monitoring` (step 4).

`smoke-account` gives smoke a way IN on the deployed app: the development
login does not exist there, so it provisions a member account with a random
password (into your local `.env`) that smoke uses through the real password
sign-in. It runs locally against the production `DATABASE_URL` — the same
procedure as `user-create` above. Once is enough; a re-run rotates the
password.

**Know what a remote smoke run covers, and what it cannot:** it renders the
member-visible pages with a real session — that is most of the app, and it is
the pass that catches the query that only breaks with production data. It does
NOT render owner-only pages (a member's redirect there is the correct answer),
and dynamic `[id]` pages are skipped as always. The log check DOES run remotely
once `DIAGNOSTICS_SECRET` is set (next section) — and where it is not, the
output says the check did not run and names the command, rather than passing in
silence. The output says all of this; read those lines rather than the green
alone, and keep running smoke locally too.

### The errors a 200 hides, from the deployed app

A page that answers 200 can still be broken: next-intl catches a bad date,
writes the error to stderr and renders the raw value. Locally
`node run.mjs errors` reads `.dev/dev.log` — a host has no such file, because
nobody runs `node run.mjs start` there. So every deployed app keeps a **bounded,
redacted window of its own stderr in memory** (500 lines / 64 KB) and answers
one endpoint with what the *same parser* finds in it.

1. Generate a secret:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set it as `DIAGNOSTICS_SECRET` **in the host's secret storage**, and put the
   same value in your local `.env` (as `DIAGNOSTICS_SECRET_PROD` for the
   production host — the plain name is this machine's own environment).
3. Redeploy, then ask:

```
node run.mjs errors --url https://YOUR-DOMAIN
```

**What an empty answer does and does not mean.** It prints the window it looked
at — `✓ No errors in the last 34 line(s), oldest 09:02 … (instance ab12cd, up
since 09:00)` — and never a bare tick, because three things bound it:

- **It empties on every restart.** Every deploy, crash-restart and
  host-initiated recycle resets the ring. An empty window five seconds after a
  redeploy is not health, which is why the boot time is in every answer.
- **It is ONE instance's.** Behind a load balancer the answer comes from
  whichever instance took the request, and calling again may sample another.
  Aggregating across instances is what an APM does.
- **Browser-side errors are not in it.** `[browser] Uncaught …` blocks in a dev
  log are the dev server forwarding what the BROWSER said; a production build
  has no such channel, so the remote answer covers server-side output only.

The exit codes are the point: **1** means it found something, **2** means it
could not look (unreachable, 404, rate-limited, an answer that was not this
app's). A 404 has exactly two causes and they are indistinguishable from
outside on purpose — either that host has no `DIAGNOSTICS_SECRET`, or yours
does not match it. Nothing on the *could not look* path ever prints a `✓`.

**No payload ever leaves the app.** Redaction runs at capture time
(`lib/diagnostics/redact.mjs`), so the process never retains an address, a
token or a connection string — see `docs/data-protection.md` §4a. The host's own
log still has the full text for whoever has shell access there, which is the
right way round. `DIAGNOSTICS_CAPTURE=off` removes the collector entirely.

**The same secret opens one more read, and only reads.**
`GET /api/diagnostics/health` answers the two questions nothing outside the app
can: does the media store answer, and when did the last payment notification
arrive. It is what `node run.mjs health` asks for its `media` and `ipn` probes,
it is behind the same guard and the same bodiless 404, and it holds and stores
nothing. 🚨 This credential never gains a surface that WRITES — anything that
changes a row is `/api/setup`, with its own database-backed key, its two-act
confirmation and its audit row.

Then by hand, because no script can: sign in, buy something (test purchase), and
check that the order arrived and the access was unlocked. `docs/environments.md`
explains the environment split — every environment has its own Digistore24
product set and IPN connection — and the skill `go-live` walks the whole
sequence.

## Where the secrets live

At the host, in its own secret storage, and nowhere else. Not in the repo, not
in `.env` on a server, not in an app spec that is committed, not in a chat
message. The hosting **token** — `RAILWAY_TOKEN`, `FLY_API_TOKEN`, the
DigitalOcean PAT — is the sharpest of them: it is not one app's secret, it is
the account. It belongs in the shell of whoever is deploying, for as long as the
deploy takes, and it is revocable at the host the moment it has been somewhere
it should not be.
