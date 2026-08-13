<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Digistore SAAS App Template

A starter template for **SAAS applications that bill through Digistore24** —
built so that you can extend it **together with an AI coding agent**, even without
programming experience.

**Stack:** Next.js 16 (App Router) · TypeScript · Drizzle ORM + Postgres ·
Auth.js v5 (email token, Google optional) · Tailwind v4 + shadcn/ui.

Wired up and ready to use:
- 🔐 **Sign-in** (email token/magic link via Postmark or SMTP; Google optional)
  — plus an **optional password** each customer may set on themselves, and
  locally you get straight in **without a mail account** (development login)
- 👥 **User management** with three roles (admin / moderator / user) — admins
  manage accounts under `/dashboard/admin/users`; a moderator is a customer who
  keeps the community's rooms clean and has no admin rights
- 🏷️ **Plan page** (`/plans`) with monthly/yearly subscription and token
  packages — hard-coded in `config/digistore-products.json`, to reshape or delete
- 🎚️ **One switch for what you sell** — `"billingMode": "subscriptions"` |
  `"tokens"` | `"both"` in the same file. It takes the surfaces of the model you
  don't use off the pages (no balance stuck at 0, no empty "next payment" card)
- 💳 **Digistore24 billing**: IPN webhook with **SHA512 signature check**,
  checkout link generation (`createBuyUrl`), API key hookup via
  `node run.mjs ds24-connect`, thank-you page that attaches the purchase
- 🗄️ **Database** with an order state machine (paid/refunded/chargeback/…)
- 🩺 Health checks (`/api/healthz`, `/api/readyz`) for easy deployment

## Your path to a finished SaaS

Start your AI program in the project and simply say what you want — the matching
**skills** (in the `.claude/skills/` folder) guide you step by step. Every step
hands over to the next:

<!-- journey:table start -->
**Prerequisite:** `setup-machine` — Installs what is missing — Node, git — and prepares the project.

### 1. Plan — What is being sold, to whom, and what it looks like.

| # | Skill | What happens |
|---|---|---|
| 1.1 | `market-research` *(optional)* | Interviews the operator and researches the market, then writes the product brief. |
| 1.2 | `design` *(optional)* | Turns the four dials once — accent, radius, type, elevation — and writes the choice into docs/design.md. |
| 1.3 | `knowledge-intake` *(optional)* | Distills existing videos, ebooks and recordings into the corpus the handbook is written from. |
| 1.4 | `build-app` | what this app is going to be, written down — each line something the customer will be able to DO |

### 2. Build — The app itself, the checkout, and the four gates in front of it.

| # | Skill | What happens |
|---|---|---|
| 2.1 | `build-app` | The entry point: archetype, data model, the pages the customer will use. |
| 2.2 | `setup-digistore` | Fetches the API key, creates the products and registers the IPN connection. |
| 2.2b | `billing-modes` *(optional)* | Sets up subscriptions, prepaid tokens with auto top-up, and subscription self-service. |
| 2.3a | `visuals` *(optional)* | Decides and builds what the customer actually receives: images, video, files behind a purchase. |
| 2.3b | `content-production` *(optional)* | Produces the media a course still lacks: lesson scripts, video tooling, voiceover, subtitles. |
| 2.3c | `courses` *(optional)* | The course itself: blocks, lessons, progress and the purchase gate. |
| 2.3d | `learning-activities` *(optional)* | What a course's customer DOES — exercises and checks, judged on the server. |
| 2.3e | `community` *(optional)* | A place for members: rooms, discussions under the pages they belong to, private messages. |
| 2.3f | `ai-companion` *(optional)* | The app working alongside its customer while they work, not only delivering to them. |
| 2.3g | `mobile-companion` *(optional)* | Asks first whether a native app is wanted at all, then switches the HTTP API on and ships the companion. |
| 2.3h | `ai-providers` *(optional)* | Picks the AI company, gets the key in, binds tasks to models and sets the prices. |
| 2.3i | `ai-chat-knowledge` *(optional)* | Switches the in-app assistant on, gives her a name and writes her handbook. |
| 2.3j | `user-onboarding` *(optional)* | Designs the END USER's first session on purpose instead of inheriting the blueprint's. |
| 2.4 | `salespage` | Turns the placeholder home page into a page that sells THIS product. |
| 2.5 | `ux-gateway` | Looks at the app the way a paying customer does, fixes what has to be fixed, writes a dated report. |
| 2.6 | `security-gateway` | Scans the app for holes, fixes what has to be fixed and writes a dated report. |
| 2.7 | `performance-gateway` | Measures where the app is slow, fixes it, measures again and writes a dated report. |
| 2.8 | `compliance-check` | Works out which EU rules reach this app, writes the legal pages and the evidence pack. |

### 3. Go live — A server, a domain, one real test purchase.

| # | Skill | What happens |
|---|---|---|
| 3.1 | `setup-hosting` | Picks a host, installs its CLI, creates the app and its managed Postgres, sets every secret. |
| 3.2 | `go-live` | Puts the app online and proves that a real purchase really unlocks access. |
| 3.3 | `setup-environments` *(optional)* | Sets an environment up over the app's own surface — accounts, plans, media, rooms — with no production password in a shell. |
| 3.4 | `setup-monitoring` *(optional)* | Decides what tells the operator it broke, instead of a customer — then wires it up. |

### 4. Run it — The phase that begins the day it is live and does not end.

| # | Skill | What happens |
|---|---|---|
| 4.1 | `operate` | The recurring round: safety, hidden errors, jobs, content, reach — read off the app, written into a dated report. |
| 4.2 | `go-to-market` *(optional)* | Positioning, channels, launch plan, content. |

**Alongside:** `guardrails` — The rules that hold around money, secrets and customer data, whatever else is being built. · `coach` — Works out where the project stands, names the one next step, and routes a symptom to the skill that fixes it.
<!-- journey:table end -->

`node run.mjs journey` prints this same path with your project's own state next
to each step — what is done, what is next, and what it is waiting for.

While the app is being built, **tests are written and run automatically**
(`npm run test`) — locally, on your machine, before anything moves on.

**Lost the thread? Ask the coach.** `coach` is the skill for the two questions
that come up between the steps — *"what is the next step?"* and *"how do I solve
this?"*. It looks at the project itself to work out where you got to, names the
one thing that comes next and starts it; and it takes a symptom (an error page,
a test purchase that never arrived, the assistant answering "I do not know") to
the place that fixes it. You never have to know a skill name:

> **"What's the next step?"**

**You don't have to remember any of this.** Start your AI program in the project
folder and say:

> **"Build my app"**

That is the only door. Claude then asks you whether you already have an idea —
and if not, the two of you find one together (step 1.1). Everything else follows
step by step.

## What you need installed

The template runs on **Linux, macOS and Windows** — all four programs do, so this
does too. **Two things you install yourself**, and to get this far you already
have both:

| | What for |
|---|---|
| **an AI coding program** | the one you build the app with. This template ships wired for four: [Claude Code](https://claude.com/claude-code), [OpenAI Codex CLI](https://developers.openai.com/codex), [Antigravity CLI](https://antigravity.google) and [OpenCode](https://opencode.ai). Take whichever you already use — if you have none, Claude Code is the one the walkthroughs are written against |
| **git** | to fetch this repo — [git-scm.com](https://git-scm.com/downloads); on macOS `xcode-select --install` brings it, on Windows it brings Git Bash |

**Everything else, the agent installs for you.** That includes **Node.js ≥ 20**,
which the app itself runs on — you do not have to sort that out in advance. Say
"get my machine ready" in the project folder and the skill `setup-machine` takes
it from there: it checks what is there, names what is missing, asks before every
install, and does itself whatever does not need your password.

The list it works through is short. Genuinely required are **Node.js and git**.
**Docker** and **cloudflared** are not prerequisites — Docker is used for the
database *if you have it* (see below), and `cloudflared` only if you want to
receive real Digistore24 purchases on your own machine while developing.

**No `make` is needed** — the commands run through `node run.mjs`, which works
in every shell. On **Windows** use **Git Bash** or **WSL2** (not PowerShell);
Git for Windows brings Git Bash with it, and these programs need it there anyway.

**No Homebrew is needed on macOS either.** Where you have it, it gets used;
where you do not, nothing here asks you to install it first.

Want to look for yourself?

```bash
node run.mjs doctor
```

It says what is missing and how to install it on your system — that one command
is where the per-system install commands live, so nothing in this file can go
stale against it.

**No Docker? Then there is nothing to do.** On the first start the app looks at
your machine: if Docker is there and running, the database runs in a container —
if not, Postgres comes from an npm package instead (about 60 MB, downloaded
once). It is the same PostgreSQL 16, and every command behaves identically. The
choice is written into your `.env` as `DB_DRIVER` and then stays put, so your
database does not move around underneath you when Docker Desktop happens not to
start one morning. `node run.mjs doctor` tells you which of the two is in use.

## Quick start

Start your AI program **in this folder** — `claude`, `codex`, `agy` or
`opencode`. Point it at the folder above this one and it finds neither the
guidance nor the skills, and "Build my app" goes nowhere.

It greets you and tells you how things continue. It takes care of setup,
database and starting the app together with you — you don't need to know any of
the commands below by heart.

If no greeting appears, run `node run.mjs greet` — the greeting says whether
this machine is ready, and silence is not the same as "fine".

*Arrived here with nothing installed yet?* [`docs/start.md`](docs/start.md) is
the walkthrough from zero — which program to install, how to get this repo, and
where to start once you have it. `https://ds24-appkit.com/start.md` redirects to
that same file, which is how somebody reaches it before they have a clone.

### For developers: the commands directly

If you prefer to type yourself: `node run.mjs start` does everything in one go —
install dependencies, create `.env` from `.env.example`, start Postgres (in
Docker, or without it — see above), apply migrations, bring the app up
(→ http://localhost:3000).

`AUTH_SECRET` is generated for you on the first start. One thing you enter into
`.env` yourself afterwards: mail delivery for sign-in (Postmark **or** SMTP —
`node run.mjs mail-setup` walks you through it, details in
[`docs/auth-setup.md`](docs/auth-setup.md)).

Then `node run.mjs restart`.

The most important commands at a glance (`node run.mjs` alone shows them all):

| Command | What happens |
|---|---|
| `node run.mjs setup` | get everything ready without starting: `.env`, dependencies, database, migrations |
| `node run.mjs start` | start database + app (including migrations) |
| `node run.mjs stop` | stop app + database |
| `node run.mjs test` | tests (vitest) + TypeScript check |
| `node run.mjs smoke` | call every page once — finds "Internal Server Error" |
| `node run.mjs db-migrate` | apply pending database migrations |
| `node run.mjs db-reset` | wipe the local database, migrate anew, load the seed |
| `node run.mjs mail-setup` | set up mail delivery (Postmark or SMTP) + test mail |
| `node run.mjs ds24-connect` | fetch the Digistore24 API key (browser) and store it in `.env` |
| `node run.mjs logs` | follow the log of the running app |
| `node run.mjs doctor` | check that everything needed is installed |
| `node run.mjs ux-check` | the interface, measured: contrast in both modes, the design system, missing names, pages nothing leads to — see [`docs/ux.md`](docs/ux.md) |
| `node run.mjs update` | fetch improved guidance for the AI agent (`CLAUDE.md`, `docs/`, skills) — your code is never touched, see [`docs/updates.md`](docs/updates.md) |
| `node run.mjs` | show all commands |

Is something already running on port 3000 or 15432 (the database port) on your
machine? Then you don't have to do a thing: `node run.mjs start` takes the next free
port, writes it down and tells you which one it became. It remembers the app
port along the way, so that `node run.mjs stop`, `node run.mjs status` and
`node run.mjs smoke` hit the right one without being told. To force a particular
port: `node run.mjs start --port 3005`.

## Deployment

`npm run build` and `npm run start` — that is the whole contract, and it is what
**Railway, Render, Fly.io and DigitalOcean** all want, each with a managed
Postgres next to it. It costs money — a small server plus a small database, per
month, at every one of them. The free tiers are not suitable for a product that
takes money (a sleeping app server, an expiring database — both explained in the
doc), and what the paid ones cost today is something Claude looks up with you
before you book anything.

**You do not have to do this by hand.** Ask your agent for the skill
**`setup-hosting`**: it picks the host with you, says what it costs before you
book anything, installs the host's CLI, gets itself authenticated, creates app
and database, sets every secret, wires the migration into the deploy and puts a
domain on it. Step by step, and the reasoning behind each step:
[`docs/DEPLOY.md`](docs/DEPLOY.md).

The IPN URL is registered at Digistore24 automatically by
`node run.mjs ds24-sync` as soon as `APP_URL` is the live domain — always
`https://YOUR-DOMAIN/api/ipn`, nothing to enter by hand.

## Project structure

```
app/                Next.js App Router (pages + API routes)
  api/ipn/          Digistore24 IPN webhook (signature check + state machine)
  optin/            public thank-you page after a purchase
  plans/            public plan page (renders the product registry)
  dashboard/admin/  admin area including user management (users/)
config/             product registry (digistore-products.json — plans, source of truth)
db/                 Drizzle schema + connection (incl. subscriptions + token balance)
lib/digistore/      DS24 client, IPN verification, product links, billing on demand,
                    credentials from the environment (settings.ts)
lib/tokens/         prepaid tokens: packages, balance/consumption, auto top-up
lib/users/          user management: rules (rules.ts) + database (manage.ts)
lib/roles.ts        roles without server dependencies (usable in the browser too)
drizzle/            database migrations (checked in, run the same everywhere)
scripts/db/         reset.mjs (rebuild the local DB) + seed.mjs (initial data)
scripts/ds24/       setup: sync products, approval, set up IPN
scripts/users/      create accounts/roles via CLI
scripts/ds24/       tunnel.mjs (Cloudflare Quick Tunnel for local IPNs)
.claude/skills/     guided skills for extending the app (all four programs)
run.mjs             all commands for everyday work (node run.mjs = overview)
```

Database & migrations: see [`docs/database.md`](docs/database.md).
Scheduled jobs (they run by themselves): see [`docs/cron.md`](docs/cron.md).
Environments (DEV/STAGING/PROD) & local webhooks: see [`docs/environments.md`](docs/environments.md).
The Digistore24 integration — API key, IPN, checkout, and the difference between
"I am the only vendor" (the default) and "my users sell through their own
accounts": see [`docs/digistore-integration.md`](docs/digistore-integration.md).

## Security

- The IPN signature check (SHA512) is **mandatory** — never switch it off.
- API keys/secrets belong in `.env` or in your host's secret management,
  **never in the code**.
- Auth protection is **opt-in**: `proxy.ts` guards only the paths in its
  `matcher` (today `/dashboard/*`). A new page holding customer data is public
  until you add it there. Public by design: home, login, `/plans`, opt-in and
  the IPN endpoint.

## License

Code **and** skills in this template are under the **MIT license** —
[`LICENSE`](LICENSE) is the binding text; what follows is only the short version.

- **Use it freely.** Copy it, change it, build your own product on it and sell
  that product — commercially too. No fee, no royalty, nobody to ask.
- **One condition:** the copyright notice and the license text stay with the
  parts of the code you take over. What you build on top of them is yours.
- **No warranty, no liability.** The software is provided **"as is"**. The
  provider gives no warranty of any kind and is **not liable** for any damage
  arising from its use — the app you build, operate and sell is yours to test,
  secure and answer for.

That last point is why steps 2.6 and 2.8 above are part of the path:
`security-gateway` before real money flows, and `compliance-check` before real
customers do.
