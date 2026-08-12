---
name: mobile-companion
description: Sets up a native mobile app on this app's backend — and first asks whether one is needed at all, because the app already installs to a phone's home screen for nothing, which makes a native build a companion and a viewer rather than a sales channel. Then the HTTP API, and an Expo/React Native companion shipped through EAS on the same accounts, entitlements and balances. Use this when the user says "I want an app for my phone", "eine App fürs Handy", "a mobile app for my customers", "a real app, like from the app store", "an icon on the home screen", "publish to the app store", mentions Expo, React Native, EAS, push notifications or signing certificates, or asks how another program can talk to this app on a member's behalf — an API, an interface, an endpoint, a token.
requires: 0.11.0
---
<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The mobile companion — one backend, a second front door

A mobile app for this product is a **separate repo with its own UI**. It is
not this codebase compiled twice, and nothing of the web UI transfers — that
is the design, not a limitation. What the two share is the backend (the HTTP
API, [`docs/api.md`](../../../docs/api.md)) and the **shared core** — the
pure decision layer, exported by `node run.mjs export-core`
([`docs/mobile.md`](../../../docs/mobile.md)).

The two reference docs carry the full story; this skill is the order to do
things in and the questions to ask. Point at the docs, do not restate them.

**You run the commands** — through your Bash tool, reporting what came back.

## Step 0a — an icon, or an app? Ask BEFORE installing anything

🚨 **Do not start building because somebody said "app".** Most people asking for
one want an icon on their home screen that opens without a browser bar, and this
app already does that — nothing to build, nothing to submit, nobody to pay. Say
so in three sentences and let them choose:

1. **The icon exists today.** Android: browser menu → *"App installieren"*.
   iPhone: *Teilen* → *"Zum Home-Bildschirm"*. The app offers it by itself, once
   in the dashboard and permanently in the menu under the user's name.
2. **Selling inside a native app is the hard part.** Apple and Google require
   digital goods sold IN an app to run through their own purchasing — commonly
   15–30 %, worth checking for their case. A Digistore24 checkout opened inside
   the app is exactly what that rule covers. So the native app is a **companion
   and a viewer**: it shows what somebody bought and hands them to the web to buy.
3. **What only a native app can do:** push notifications on iOS, the camera,
   real offline use, a listing in the stores. If none of those is the reason,
   the icon is the answer and this skill stops here.

⚠️ **If they choose the icon, there is nothing for you to build** — check that
`app/manifest.ts` and `public/icons/` exist (an older copy of the template may
predate them) and read [`docs/mobile.md`](../../../docs/mobile.md) →
*First: an icon, or an app?* to them. One thing there is worth saying out loud
even when they did not ask: **on iPhone the installed app has its own sign-in**,
so an app offering only magic links cannot be used from its own icon. That is a
password on `/dashboard/account`, and it is a two-minute fix before the fact
rather than a support ticket after it.

Only when a real reason for a native app survives this question, carry on.

## Step 0 — is the module part of this app?

The backend half is a **module**: `/api/v1` lives in `modules/api/` and a fresh
app does not have it, the same way a fresh app has no community. Nothing below
works until it does.

```bash
node run.mjs module list        # is "api" installed?
node run.mjs module add api
node run.mjs db-migrate         # its own migration chain brings `api_keys`
```

If `module list` shows it under *"present but not installed"*, its code is in
the tree and does nothing: no route (Next sees none — a real 404), no texts, no
**App keys** card on `/dashboard/account`. One command fixes that, and it
belongs at the start of this skill rather than in the middle of step 2 — see
[`docs/modules.md`](../../../docs/modules.md).

**Installed is still not switched on.** `config/api.json` ships
`{ "enabled": false }` and stays the operator's file — step 2 is where that gets
flipped. Two different questions, and both of them answer 404 from outside.

## Step 1 — is a companion wanted, and is there one already?

Ask, in one sentence each, if the answers are not already on disk:

1. **Is a mobile (or other external) app actually planned?** `/api/v1` is for
   the customer's own software — a program they run against their own
   account. If the user wants the app's CONTENT reachable by an AI, that is
   the in-app assistant's content tools (`docs/content-source.md`), not this
   surface.
2. **Does a companion repo already exist?** Look for a `.core-version` file
   in sibling directories the user names. If one exists, this skill's later
   steps UPDATE it (re-export, re-check) rather than create it.

If the app itself is still unbuilt, stop — `build-app` comes first; a
companion needs something to accompany.

## Step 2 — switch the API on and scope it

1. Read [`docs/api.md`](../../../docs/api.md) in full — especially *Every
   route guards itself* and *What this is not*.
2. Set `"enabled": true` in `config/api.json`. Ask ONE question first: is the
   API for every member, or a paid feature? A paid feature sets
   `"requiresPlan"` to a Product Key from `config/digistore-products.json`
   (never a token package).
3. Walk the endpoint table in the doc against what the companion will show.
   The shipped surface mirrors the dashboard (me, entitlements, tokens,
   billing, chat, media). If a screen the user describes needs something that
   is not there, follow *Adding an endpoint* in the doc — logic into
   `lib/<domain>/`, a thin `guardApi()`-first handler in `modules/api/routes/`
   plus its one-line `route.api.ts` declaration under `app/api/v1/`, colocated
   test.
4. `node run.mjs test`, then `node run.mjs start` and
   `node run.mjs api-check --live` — it mints a temporary key, really calls
   `/api/v1/me` and revokes; report its output. Only a green `--live` proves
   the whole path.

## Step 3 — export the shared core

1. Ask where the companion repo lives (or create the folder beside this one:
   `../<app-name>-mobile`). The export target is a `core/` folder INSIDE it.
2. `node run.mjs export-core ../<name>/core` — show the user the plan, then
   run it again with `--apply`.
3. Say the one sentence that prevents later grief: **files edited inside
   `core/` are the companion's own from then on** — re-exports keep them and
   say so (`.core-version`, [`docs/mobile.md`](../../../docs/mobile.md)).

## Step 4 — wire the companion and prove it

1. In the companion repo: tsconfig `"baseUrl": "."`,
   `"paths": { "@/*": ["./core/*"] }`, `"resolveJsonModule": true` (Expo
   SDK 50+ reads it natively; the doc names the Babel fallback for older
   setups). Recommend `* text=auto eol=lf` in its `.gitattributes`.
2. Prove the wiring with one shared module before building screens: a file
   that imports `allProducts()` from `@/lib/digistore/products` and prints
   the plan list must typecheck and run in the companion.
3. Prove the backend the same way: sign in against
   `POST /api/v1/auth/token` (or paste a key from `/dashboard/account` for a
   magic-link account) and call `GET /api/v1/me`. A `404` means one of two
   things and they are indistinguishable from outside: the module is not
   installed (step 0) or the API is still switched off (step 2).
   `node run.mjs module list` tells them apart.
4. From here the companion is ordinary app development in its own repo. What
   this template keeps owning: the API surface, the core's contents
   (`config/core-export.json`), and the re-export whenever the core changes.

## Step 5 — ship it: Expo + EAS

The reasoning and the full path live in
[`docs/mobile.md`](../../../docs/mobile.md) → *Shipping the companion — Expo
and EAS*; read that section before this step. The short of it: EAS does the
signing, the builds (in the cloud — no Mac needed for iOS), the store upload,
OTA updates and push, all as CLI commands you run yourself.

1. Ask ONE question: into the stores now, or develop locally first? Local
   development needs none of this — Expo Go on the owner's phone runs the app
   against the local backend today; come back to this step when the stores
   are wanted.
2. Scaffold the app if step 4 has not already: `npx create-expo-app@latest`
   in the companion repo, then the wiring from step 4 on top.
3. Name the one human step and wait for it: an Apple Developer Program
   membership and a Google Play Console account (both paid — have the user
   check the current fees), each connected to EAS once via `eas credentials`.
   About half an hour, once ever — after it, nobody touches a certificate
   again. Only the account owner can do this part; sit with them through it.
4. Then you run the rest and report what comes back: `npx eas-cli init`,
   `eas build --platform all`, `eas submit --platform all`. Say plainly what
   stays manual: store listing, screenshots, and a first-submission review
   that takes days. Later JS-only changes go out in minutes with
   `eas update` — no review.
5. Push notifications, if wanted: `expo-notifications` on the device; the
   backend needs a push-token endpoint that does not exist yet — build it
   exactly as [`docs/api.md`](../../../docs/api.md) → *Adding an endpoint*
   prescribes (the doc's *Push notifications — the server half* names the
   rules; never accept a member id in the payload).

## When something does not fit

- **"The companion needs a price/rule that lives here"** — add the module to
  the core if it passes the purity test, otherwise expose it through an
  endpoint. [`docs/mobile.md`](../../../docs/mobile.md) → *Adding a file to
  the core* names the admission rules; never weaken the purity test to force
  a file in.
- **"Can the app change the user's email / buy things?"** — no, deliberately:
  email changes ride a mail confirmation, purchases ride Digistore24's
  checkout. The companion links to the web app for both.

End by naming the next step: if the app has not been through the gateways
yet, `ux-gateway` → `security-gateway` for the web app remain the path; the
API surface is covered by `security-gateway`'s route checks the next time it
runs.
