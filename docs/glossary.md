<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The words you will meet — and what they mean here

This file is for **you, the person building the app**, and for the agent that
builds it with you. You do not have to read it in advance: it is here so that a
word you meet in a conversation has one plain meaning you can look up. The
agent reads it for the same reason — when a word from this list is the right
word, it puts the meaning from here into the same sentence, in your language,
once, rather than sending you to this file.

Each entry answers three things where they matter: what it is, whether it
touches only your computer or the outside world, and whether it can be undone.

## The tools

- **Terminal (command line)** — a window where programs are started by typing
  their name instead of clicking an icon. Your AI program runs in one. You
  almost never type into it yourself: the agent runs the commands and tells
  you what came back. When it does ask you to type something, it says why, and
  the output lands in the conversation.
- **Coding agent / AI program** — Claude Code, Codex, Antigravity or OpenCode:
  the program you talk to. It can read and change the files of this project
  and run commands on your computer. It cannot see your screen and does not
  know what you did outside the conversation.
- **Skill** — a written playbook for one stage of the project (building the
  app, connecting Digistore24, going live). The agent reads it when the stage
  begins. `node run.mjs journey` says which stage you are in.
- **Node.js and npm** — the program the app runs on, and the tool that fetches
  the building blocks it is made of. Installed once, on your computer only.
- **Docker** — a way to run the database in a sealed box on your computer.
  Optional: without it the database comes from a package instead, and nothing
  else changes.
- **git · repository (repo) · commit** — git keeps the history of the project.
  The repository is the folder with that history; a commit is one saved state
  with a date and a sentence. **Every finished step is a commit, so every
  earlier state is still there** — anything the agent changed can be taken
  back to any saved step. Nothing you say in the conversation deletes one.
- **Branch · pull request** — a branch is a separate line of the project, so
  work can happen without touching what is there; a pull request is the
  proposal to merge it back. Only some setups use them; if yours does, the
  agent says so and nothing is overwritten while you look.
- **Checkpoint / rewind** — in Claude Code, every message you send is a point
  the conversation can go back to. A stage hand-back is such a point on
  purpose.

## Your project

- **`.env` — the settings file** — a text file next to `run.mjs` that holds
  the values that are yours alone: keys, passwords, addresses. It stays on
  your computer and is never published, never committed. A key belongs in
  this file and nowhere else — **never in the conversation**.
- **Environment variable** — one line of that file: a name, an equals sign,
  a value. `APP_URL=https://…` is one.
- **Secret · API key · token** — a password for a program instead of a person.
  Whoever holds it can act on your behalf at that service, so it goes into
  `.env` (locally) or the host's secret store (live), and if one has ever
  landed in a chat, a screenshot or a commit, it is replaced at the service
  that issued it.
- **Token (the other meaning)** — a prepaid unit a customer of YOUR app buys
  and uses up, if your app sells that way. Also the unit AI companies bill
  by. The sentence around it says which one is meant.
- **Database · Postgres** — where the app keeps what people enter: accounts,
  orders, content. Postgres is the kind of database. Locally it is a copy on
  your computer; live it is one the host runs for you.
- **Migration** — a recorded change to the shape of the database (a new
  table, a new column). It is a file in the project, applied once, and it is
  how a change made here reaches the live database later.
- **Port** — a number after a computer's address, like a door number: the
  app on your machine answers at `http://localhost:3000`, and 3000 is the port.
- **Test · smoke test** — a test checks one rule of the app automatically;
  the smoke test opens every page once and reports the ones that error.
  **Green tests mean the rules were counted, not that the app is right** —
  the proof you can judge is the page the agent asks you to open.
- **Module** — a larger part an app has whole or not at all: a course, a
  community, an interface for a phone app. `node run.mjs module list` says
  which ones this app has.
- **Design system** — the finished set of buttons, forms, colours and spacing
  every page is built from, so nothing has to be designed page by page.

## Where the app runs

- **localhost / local** — only on your computer. `http://localhost:3000` is
  your app, reachable from your machine and from nowhere else. Nobody can
  buy anything there; purchases are test purchases.
- **Tunnel** — a temporary public address that leads to the app on your
  computer, opened so Digistore24 can send a test purchase to it. **While it
  runs, anyone with that address reaches your app — the app, nothing else on
  your machine.** `node run.mjs stop` closes it; `node run.mjs status` shows
  whether one is open.
- **DEV · STAGING · PROD** — the three environments. DEV is your computer.
  PROD is the live app your customers pay for. STAGING is an optional live
  copy for trying things out with test purchases. Products and the database
  are separate in each.
- **Deploy** — copying the current state of the project to the server so the
  live app changes. Nothing reaches your customers until a deploy.
- **Host · hosting · server** — the company whose computer runs your live
  app, for a monthly price (Railway, Render, Fly.io or DigitalOcean here).
  The skill `setup-hosting` says the price before anything is booked.
- **Domain** — the address people type, `yourapp.com`. Bought from a
  registrar, pointed at the host.
- **Mail delivery (Postmark, SMTP)** — the service that sends the app's own
  mails, sign-in links first of all. Live, the app refuses to start without
  one.

## Money

- **Digistore24 vendor account** — your seller account. Digistore24 runs the
  checkout, takes the payment, handles VAT and refunds, and charges a fee per
  sale (the current rate is on their site). Your app never touches card data.
- **Product · plan · Product Key** — a product is what Digistore24 sells; a
  plan is one way to pay for it (monthly, yearly, once); the Product Key is
  the short name inside the app that a purchase unlocks.
- **Checkout link** — the address a buy button opens. In DEV every one of
  them is a test purchase automatically.
- **IPN (webhook)** — the message Digistore24 sends your app the moment
  somebody pays, refunds or misses a payment. The app checks its signature
  and grants or ends access on it. "Paid, but nothing happened" is almost
  always an IPN that did not arrive.
- **Entitlement · grant** — the app's record that a member may use
  something, and since when. A purchase creates one; a refund ends it.
- **Owner · moderator · member** — the three roles. You are the owner; a
  member is a paying customer; a moderator keeps a community tidy and has no
  admin rights.
- **Test purchase** — a purchase in Digistore24's test mode: the whole path
  runs, no money moves.

## The checks before the launch

- **Gateway (ux, security, performance) and compliance-check** — four
  inspections the app has to pass before it goes live. **A gateway is an
  acceptance test, not a limit**: it measures the app against a target and
  says pass or not; nothing in the app is capped by the number it tests
  against.
- **Load test · "100 users"** — the performance gateway sends the app 100
  visitors at once for twenty seconds and watches for errors and slow pages.
  100 is the **default target**, used when nobody has said what the launch
  expects. It is not a ceiling: an app that passes carries more, and an app
  expecting more (a launch mail to a large list, a webinar that sends
  everyone at once) is tested at that number instead — the agent asks once,
  before the test, and the report says which number was used.
- **Finding · severity** — one thing a check found, graded 🚨 critical,
  ❌ high, ⚠️ medium or ℹ️ low. Critical and high are fixed before the launch;
  the rest is decided with you and written down.
- **Report** — every check writes a dated file under `docs/reports/`, so
  "did we already do that?" has an answer next month.

## What is final, and what is not

Almost everything is reversible: a page, a text, a colour, a table, a setting
— all of it is in the project history and can be taken back. The short list of
acts that **cannot be undone from here** — the agent names each one as such
and waits for your yes:

- creating or changing products in your **live** Digistore24 account;
- a **real** purchase, and any mail actually sent to a real person;
- revoking access that was granted by hand;
- deleting an account or its data;
- replacing a key at a service (the old one stops working everywhere).

## Where things live, in your words

| You mean | It is here |
|---|---|
| what my app is, and what was decided against | `docs/app.md`, and the plan it was built from in `docs/plan.md` |
| my prices and what I sell | `config/digistore-products.json` |
| the texts my customers read, per language | `messages/<language>.json` |
| my logo and colours | `public/brand/`, decided in `docs/design.md` |
| my sales page | the home page, `app/page.tsx` |
| my legal pages | `content/legal/` |
| my keys and settings | `.env` (yours alone) |
| what the checks found | `docs/reports/` |
| which stage I am in | `node run.mjs journey` |
| whether the app is running, and where | `node run.mjs status` |
