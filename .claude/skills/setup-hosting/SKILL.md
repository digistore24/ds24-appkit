---
name: setup-hosting
description: Puts the app on a server — picks a host with the user (Railway, Render, Fly.io or DigitalOcean), says what they have to book and what it costs, and sets the whole deploy up including a managed Postgres and a domain. Use this when the user wants to deploy, go online, "put it on a server", asks which host to choose, what hosting costs, mentions Railway/Render/Fly.io/DigitalOcean, an account, a CLI, an API token or the environment variables, or when go-live reaches the hosting step.
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Setting up the hosting

The user has an app that runs on their machine and wants it on the internet.
Most of them have never deployed anything, do not have an account anywhere, and
do not know what a managed Postgres is. **You do the deploy. They make three
decisions and click twice.**

The reference behind this skill is [`docs/DEPLOY.md`](../../../docs/DEPLOY.md) —
what each host costs, what each one traps you with, and the exact commands. Do
not repeat it back to the user; read it and act.

**Before anything else: `git status -sb`.** An `ahead` count means the
customer's repository at GitHub does not hold the app you are about to deploy
— push first; every host below deploys from that repository, not from this
disk. Measured 2026-09-15: seventeen commits ahead at the moment the customer
asked what was left before going live.

## What you do, and what genuinely stays with them

You run every command yourself, through your Bash tool. Do not hand somebody a
command to type — they are not developers, and a command in a chat message is a
command that gets pasted into the wrong window.

**Only three things need a human**, and all three because a browser asks a
person to agree to something:

1. **Creating the accounts** — at the registrar for the domain, at the mail
   service and at the host (and entering a payment method).
2. **The login in the browser** — `railway login`, `flyctl auth login`. You run
   the command, the browser opens, they confirm.
3. **The DNS records** for their domain, at whoever sells it to them — the
   CNAME for the host, and the mail service's DKIM/SPF records.

Everything else — CLI install, project creation, database, environment
variables, migration hook, deploy, verification — is yours. If you catch yourself
writing "now go to the dashboard and…", stop and check whether there is a command
for it. There usually is.

## 1. Before anything: is there anything to deploy?

Three checks, and they take a minute:

```
node run.mjs test          # typecheck + tests, green
node run.mjs build         # the production build, without errors
```

A build that fails locally fails at the host too, only slower and with a worse
log. And settle the domain and the mail service (steps 2 and 3) **now**, not
after the first deploy.

## 2. Look the price up, then say it out loud

**There are no prices in this repository, on purpose** — they change, and a
number somebody budgeted on is worse when it is stale than when it is missing.
So look them up, at the moment you need them.

Before the user books anything, fetch the current pricing pages and give the
**whole** picture, because a test go-live costs the same four things a launch
does:

1. **one small always-on instance plus one small Postgres** at the host — both
   halves; the database is regularly the larger one, and on Fly.io it is
   several times the app;
2. **the domain** — a yearly price at a registrar. Small, and the one line no
   plan of any host removes, which is exactly why it drops out of a plan and
   then blocks the deploy halfway (step 3);
3. **the mail service** (Brevo or Postmark) for the app's sign-in volume;
4. **object storage**, if the app takes files (step 6b) — priced by what is
   stored and sent out.

Two or three sentences are enough:

> "Running this will cost you roughly X a month at <host> — about this much for
> the app and this much for the database — plus about Y a year for the domain
> and Z for the mail service. That holds for the test run too: there is no free
> option I would put even a test on, and without a domain the sign-in cannot
> work at all. I can explain why if you want."

🚨 **Never tell the user a test go-live is free** — not the host, not the mail
service, not the storage, and not "we can skip the domain for the test". Every
one of those sentences has been said, and the last one cost a tester three
accounts and a day.

Two things you may say without looking, because they are about shape and not
about numbers:

- **The four hosts are not in the same bracket.** Fly.io's managed Postgres is
  the outlier. Never quote a figure from one host and then set the user up on
  another.
- **A free tier is not a saving here.** A free app server falls asleep — with it
  the scheduled jobs that delete buyer data — and a free database expires. Both
  surface weeks later and look like a bug in their app; one of them deletes
  their customers.

**Never present a free tier as the starting point**, and never let the cost
arrive as a surprise on a credit card statement. It is their money and their
decision, so if they want the free tier after hearing the risk, do it and say
once what to watch for.

## 3. Pick a host — after the domain and with the mail in mind

**Two things come before the host, in this order.** The order that feels
natural — host, deploy, then mail, then a domain "later" — asks the domain
question with three accounts created and the app refusing to start.

1. **The domain.** Does the user own one for this app? If not, it is bought now
   — not for the app's address, for the sign-in mails' **sender**: STAGING and
   PROD refuse to start unless the From lives on the app's domain
   ([`docs/auth-setup.md`](../../../docs/auth-setup.md) → the sender rule).
   Nobody can send as the host's own `…up.railway.app`, and a public mailbox
   address as the sender is refused by Postmark at sign-up, warned against by
   Brevo, and filed as spam. STAGING then runs on `test.<their-domain>`.
2. **The mail service, chosen by what the host allows.** Railway blocks outbound
   SMTP on everything below Pro — there it is **Brevo** (EU-hosted) or
   **Postmark** (US-hosted, a third-country transfer), never SMTP. On the other
   hosts, look up whether the plan lets SMTP out before choosing it. Without an
   opinion from the user, take Brevo: it works on every host and keeps the
   customers' addresses in the EU.

Then ask **one** question, with a recommendation in it:

> "Do you already have an account at one of these — Railway, Render, Fly.io,
> DigitalOcean? If not, I would take **Railway**: it is the shortest path from
> here to a running app."

| If they say | Take | Because |
|---|---|---|
| nothing / no idea | **Railway** | fewest steps, database included, and the cheap database of the four — mail through Brevo or Postmark, since its cheaper plans block SMTP |
| "you do all of it" | **Fly.io** | every step is a command; the least clicking — but price its database first and say the number, and offer the app-on-Fly-database-elsewhere variant |
| "I already have DigitalOcean" | **DigitalOcean** | an account they already pay for beats a new one |
| "I already have Render" | **Render** | fine — warn about Free, both the service and the database |

Do not run a comparison. They asked for a running app, not a market survey.

## 4. Install the CLI — read the commands, do not know them

```
node run.mjs doctor --deploy --json
```

That names, per host, whether the CLI is installed, whether it is logged in, and
**the install command for the system you are on** (`fix.command` / `fix.url`).
Take it from there — the same rule as `setup-machine`: install commands live in
`scripts/dev/doctor.mjs` and nowhere else, because a copy in a skill is a copy
that is wrong on the two systems nobody here runs.

- `fix.command` without `admin` → run it yourself.
- `fix.admin` (a `sudo`) → you cannot answer a password prompt. Give them the
  one line, say what it does, wait.
- `fix.url` → hand over the link, say what to download.

Render has no CLI. That is not something you failed to find.

## 5. Authenticate — and be careful where the token lands

```
railway login          # browser; then: railway whoami
flyctl auth login      # browser; then: flyctl auth whoami
doctl auth init        # asks for a Personal Access Token
```

Tell the user **before** you run one that a browser is about to open and what
they are agreeing to. Then re-run `node run.mjs doctor --deploy` and show that
it says *logged in* — an assumed login is the thing that fails four steps later,
by which time it looks like a different problem.

**Where no browser can open, none of those three lines works** — the greeting
says `[Machine: no browser here]`, and there the login waits for a window that
never appears. Every one of these hosts has a token path for exactly that, and
[`docs/DEPLOY.md`](../../../docs/DEPLOY.md) has each of them written out:
`RAILWAY_TOKEN` (Account Settings → Tokens), `FLY_API_TOKEN`
(`flyctl tokens create deploy`), DigitalOcean's access token. Render has no CLI
at all and is a dashboard flow either way. The background is
[`docs/machine.md`](../../../docs/machine.md).

**DigitalOcean is the one where a human has to produce a token** (API → Tokens →
Generate New Token, scope *write*). Three rules about it, and they hold for
`RAILWAY_TOKEN` and `FLY_API_TOKEN` just as much:

- **Never into `.env`, never into the repo, never into an app spec you commit.**
  `.env` is for this app's secrets; a hosting token is the whole account.
- **Into the shell for as long as the deploy takes**, and no longer.
- If one has been somewhere it should not be — a chat, a screenshot, a commit —
  say so plainly and revoke it at the host. A revoked token costs two minutes; a
  leaked one costs the account.

Never ask a user to paste a token into the conversation when a browser login
would do the same job — **and note the condition, because it is not always
met.** Where no browser can open, the browser login does not do the same job; it
does no job at all, and the token is then the honest way rather than the lazy
one. Ask for it, use it for the deploy, and keep the three rules above.

## 6. Mail first — it is what breaks the first deploy

**In production this app does not start without a mail transport.**
`lib/env-guard.ts` checks it at startup and aborts, on purpose: the development
login does not exist outside DEV, so without mail nobody could ever sign in —
including the operator.

So before the deploy: `node run.mjs mail-setup` (Brevo, Postmark or SMTP —
the service step 3 settled; `docs/auth-setup.md` for the detail), and the
resulting values go to the host with everything else. If the user has no domain
of their own yet, step 3 was skipped: go back — there is no honest sender
without one.

🚨 **`mail-setup`'s test mail proves the credentials from THIS machine, never the
host's network.** A home connection lets port 587 out where a host may not;
measured 2026-09-16, a test mail arrived while the deployed app on Railway timed
out on every sign-in. For SMTP, `node run.mjs health --url` after the deploy
(step 9) is the check that counts — its `mail` line asks the server.

**The startup refusal covers the sender's domain too**: the From must be an
address on the app's own domain (the one going into `APP_URL`), or
STAGING/PROD abort — a foreign sender is the phishing shape that gets domains
onto Google's Safe Browsing list (`docs/auth-setup.md` → the sender rule;
deliberate exception: `EMAIL_FROM_FOREIGN_DOMAIN`). `node run.mjs doctor
--deploy` previews the verdict from this machine, so set the host's mail
variables to an address on the live domain now, not after the first aborted
boot.

## 6b. A bucket for files — the second thing that stops the app booting

**In production this app does not start on a local disk either.** Same shape as
mail, same file (`lib/env-guard.ts`), and a different reason worth
understanding rather than repeating:

> A local disk works perfectly on one machine. That is the problem. The next
> deploy replaces the machine and takes every uploaded file with it, and the
> moment there are two instances an upload lands on one disk while the next
> request is answered by the other — so a customer's picture is there about
> half the time. None of that appears while anybody is testing, because testing
> happens on one machine. It appears **after** the app is successful.

Because that failure is invisible until it is expensive, the app refuses rather
than warns.

**Book object storage with the database, not after it.** The app signs its own
requests, so there is no SDK and no provider lock — but "S3-compatible" is only
true of the features it uses. **Seven providers are carried:** Amazon S3,
DigitalOcean Spaces, Cloudflare R2, Backblaze B2, Hetzner Object Storage, MinIO
and Wasabi.

🚨 **Google Cloud Storage is NOT one of them — say so before the user books it.**
It is the provider somebody is most likely to already have, and it has an
S3-compatible API that does not fit this driver: a different presign algorithm
value, `x-goog-*` rather than `x-amz-*` copy headers, and undocumented
`response-content-*` overrides. That is a second signer rather than a setting,
and the two headers are the course-video upload and the copy behind it. The three
mismatches and the one measurement that would overturn the answer are in
`docs/visuals.md` → *Google Cloud Storage is NOT carried*. If the user already
has a GCS bucket, the honest answer is "book one of the seven"; do not spend the
session trying to make it sign.

| Host | Closest to hand |
|---|---|
| Railway | Cloudflare R2 or Backblaze B2 (no egress fees on either) |
| Render | Cloudflare R2, or Amazon S3 in the same region |
| Fly.io | Tigris (Fly's own, `fly storage create`) or Cloudflare R2 |
| DigitalOcean | **Spaces** — same account, same panel, one click |

Then five variables go to the host with the rest:
`MEDIA_DRIVER=s3`, `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`,
`MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`.

**And the same values go into the local `.env` once more, under the `_PROD`
suffix** (`MEDIA_S3_ENDPOINT_PROD`, `MEDIA_S3_BUCKET_PROD`, … — see
`.env.example`): reference copies, the same contract as
`DIGISTORE_IPN_PASSPHRASE_PROD`. They are what lets a locally-run
`content-media-sync --env prod` or `kb-media-sync --env prod` fill the
production bucket at go-live without ever editing the plain `MEDIA_*` values —
which keep meaning THIS machine.

Ask for the credentials **scoped to that one bucket**, not an account-wide key.
Every provider above can do it, and the difference matters the day the key
leaks: one bucket, or everything the user has there.

🚨 **And `MEDIA_S3_REGION` is a sixth variable on most of them, not an optional
extra.** It defaults to `auto`, which is exactly what Cloudflare R2 documents and
what MinIO ignores — and **Amazon S3, Backblaze B2 and Wasabi validate the string
and answer 403 without it.** Left unset against one of those, everything looks
fine: the app starts, the deploy succeeds, and the failure arrives on the first
upload a real customer makes, after they picked the file and waited for it to
travel. Set it whenever the provider documents one, and read it off the bucket's
own panel rather than guessing (`fra1`, `eu-central-1`, `eu-central-003`).
`docs/DEPLOY.md` lists it as required for everything except R2.

One that really is optional: `MEDIA_S3_PUBLIC_BASE_URL` — a CDN or a custom
domain on the bucket, which makes product images reach visitors without touching
the app at all.

**Prove it before the deploy, not after:** `node run.mjs media-check` writes a
throwaway object, reads it back, compares the bytes and deletes it. Credentials
that look right and a bucket that does not exist are indistinguishable until
something tries. Reference: [`docs/visuals.md`](../../../docs/visuals.md).

⚠️ **There is one exemption, and it is the reason this is a step here rather
than something the boot guard settles.** An app whose `config/media.json` says
`"enabled": false` accepts no files at all, and `mediaProblem()`
(`lib/env-guard.ts`) lets it start with no bucket — requiring one before such an
app could deploy would be a bill for nothing. The cost of that exemption:
**switching media ON later without a bucket is a state nothing refuses at
startup**, which is why `media-check` and `go-live` say so loudly instead
([`references/preflight.md`](../go-live/references/preflight.md) § 5). So: does
this app take files (`enabled`, and whether anything calls `acceptUpload()`)? If
yes, book the bucket now and prove it — the boot guard will hold you to it. If
no, it may deploy without one, and the day somebody turns media on is the day
this step comes back.

## 7. Deploy

Follow the host's section in [`docs/DEPLOY.md`](../../../docs/DEPLOY.md). Whatever
the host, five things have to be true when you are finished, and it is worth
checking them as five separate questions:

1. **The app builds and runs** — `npm ci && npm run build`, then `npm run start`.
2. **A managed Postgres is attached** and `DATABASE_URL` comes from the host's
   own binding, not from a string you pasted. A pasted one is a string that
   goes stale the day the database is rotated.
3. **Every required environment variable is set** — the table in `docs/DEPLOY.md`.
   Go through it as a list; missing one produces an app that starts and then
   fails at the one thing the user tests first. Mail, the media bucket and
   `APP_URL` are the three that stop it starting at all (steps 6 and 6b, and
   point 5 below).
4. **The migration runs before the new version takes traffic** — the pre-deploy
   command / `release_command` / `PRE_DEPLOY` job, running `npm run db:migrate`.
   Not "I will run it by hand after each deploy": that is the step that gets
   skipped, and it is skipped on the deploy that needed it.
5. **`APP_URL` is the address the app is actually reachable at** — the user's
   own domain, or `test.<their-domain>` for STAGING, put on at the host as a
   CNAME; never the host's own `…up.railway.app`, whose name no sender can
   match. https, no trailing slash — and STAGING/PROD **do not start without it**
   (`lib/env-guard.ts`). 🚨 It is not cosmetic: everything the app MAILS OUT
   takes its origin from it, the sign-in link above all (`AUTH_URL` is derived
   from it at startup, `lib/auth/auth-url.mjs`). `AUTH_TRUST_HOST=true` says
   only which `Host` values are ACCEPTED, and behind a PaaS router that is
   `localhost:8080` — which is how a live app once mailed
   `https://localhost:8080/api/auth/callback/email?…` to every buyer with every
   gate green. Do not set `AUTH_URL` or `NEXTAUTH_URL` at the host at all: one
   naming a different origin than `APP_URL` refuses the start rather than being
   picked between.

## 8. The operator account — before anyone else signs in

A fresh production database is empty, and the "first account becomes owner" rule
is DEV-only on purpose. So the first person to sign in on a live app is whoever
gets there first, and that may be a customer.

Create it yourself, against the production `DATABASE_URL`:

```
node run.mjs user-create --email <the user's address> --role owner --apply
```

Then have them sign in once — through the real mail. If no mail arrives, run
step 9's `node run.mjs health --url` and read its `mail` line before looking
anywhere else: on a host that blocks SMTP the sign-in simply waits.

## 9. Prove it

```
https://YOUR-DOMAIN/api/healthz     → {"status":"ok"}
https://YOUR-DOMAIN/api/readyz      → {"status":"ready"}   (this one asks the
                                      database, and answers 503
                                      {"status":"not-ready"} when it cannot)
DATABASE_URL="postgres://…" node run.mjs smoke-account --apply    # once
node run.mjs smoke --url https://YOUR-DOMAIN
node run.mjs health --url https://YOUR-DOMAIN                    # read the `mail` line
```

**Read `health`'s `mail` line even when everything else is green.** It is the
one probe that asks whether the sign-in mail can leave the server; a HIGH there
means nobody will be able to sign in, while every page still answers 200.

🚨 **`/api/healthz` and `/api/readyz` are also what an uptime checker gets pointed
at later, and the obvious way to configure one is wrong.** Bind such a check to the **status code**,
and where a body match is offered as well, match `"status":"ready"` **with its
quotes and its colon** — never the bare word `ready`, which is a substring of
`not-ready` and therefore matches the failure body too, for ever and in silence.
Say which way round the rule points, too: the alarm fires when `"status":"ready"`
is **ABSENT**, and the providers name that polarity opposite ways (UptimeRobot's
`keyword_type` wants *not exists*; Better Stack's plain `keyword` type is already
right and its `keyword_absence` is the inverse). Setting it up is
`setup-monitoring` step 4, not this skill — copy nothing from memory.

`smoke-account` runs against the production `DATABASE_URL` exactly like
`user-create` in step 8 — it provisions the member account smoke signs in as
on the live app (the development login does not exist there) and writes its
random password into the local `.env`. Without it, smoke can only watch the
protected pages redirect — and it will say so; **read the sign-in line** of
its output, "NOT checked" is not a pass.

No 5xx. Production runs into errors that never appeared locally — a missing
variable, a migration that did not run — and this is where they surface. A
remote run does not read the server log and never renders owner-only pages
(the output says both) — the local `node run.mjs smoke` remains the fuller
half.

🚨 **And no line saying a route *"redirects to `http://localhost:…`, which only
this server can reach"*.** That one is a correct status code on a correct path,
handing a customer an address that exists only inside the container — the shape
this script used to print and tick. It means `APP_URL` at the host is wrong,
never `AUTH_TRUST_HOST`.

Then read the host's log once with your own eyes (`railway logs`, `fly logs`, the
dashboard). `✓ Environment: PRODUCTION` in it means the environment check passed;
its absence means the app is not the one answering.

## 10. Hand back

The app is online. What makes it *sell* is the next thing, and it belongs to
**`go-live`**: `node run.mjs ds24-sync --env prod` (with `APP_URL_PROD` set)
to create the LIVE product set and point its IPN at the real domain — the
`[DEV]` products the user tested with stay local — then product approval, the
IPN secrets copied to the host, and a test purchase played through end to end.
Say that in one sentence and start it.

## The rules

1. **Say the price before they book.** Once, in a sentence, without drama.
2. **Never a free tier without naming what it costs them** — a sleeping app and
   an expiring database, both discovered late.
3. **Install commands come from `doctor --deploy --json`**, never from memory.
4. **A hosting token never touches the repo, `.env`, or the chat.**
5. **The migration belongs in the deploy**, not in your good intentions.
6. **Verify before you report.** healthz, readyz, smoke, `health --url` with its
   `mail` line, and a look at the log.
   "It deployed" is not the same sentence as "it works".
7. **Secrets go to the host, and stay there.** They are not in the commit that
   sets everything else up.
8. **The domain comes before the host, the mail service before the deploy.** A
   test go-live without a domain has no sender, and a mail service chosen before
   the host may be the one the host blocks.
