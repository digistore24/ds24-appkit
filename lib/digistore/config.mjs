// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The fixed facts about Digistore24 — the ones that are the same for every
// installation of this app.
//
// They live here, in code, and NOT in the `.env`. The `.env` is where the
// things belong that differ from machine to machine: your API key, your IPN
// passphrase, your app URL. An address that is identical for everybody is not
// configuration — putting it there only means every developer reads four more
// lines before finding the one value they actually have to fill in, and a typo
// in any of them breaks the connection in a way that looks like a Digistore24
// outage.
//
// `.mjs` on purpose: the app (TypeScript) and the setup scripts (plain Node)
// both read these values, and this way there is one copy rather than two that
// drift apart. Same deal as `lib/ai/providers/ids.mjs`.

/** API base of Digistore24. */
export const DIGISTORE_API_URL = "https://www.digistore24.com";

/**
 * The domains a Digistore24 CHECKOUT can live on — NOT the API base above.
 *
 * These two answer different questions and are easy to confuse. The API base is
 * where this app TALKS to Digistore24; a checkout URL is what `createBuyUrl`
 * hands BACK, and it does not come from us at all. Today Digistore24 answers
 * with `https://www.checkout-ds24.com/...` — a different registrable domain
 * from `digistore24.com`, which is precisely why this list exists rather than
 * one `endsWith("digistore24.com")` somewhere in the code.
 *
 * What it is FOR: `decorateCheckoutUrl()` in `lib/digistore/testpay.ts` appends
 * the account-level test-payment key, and that key must never travel to a host
 * we did not fetch it for. So this is an **allowlist** — a host that is not on
 * it gets the URL back undecorated. Matching is the exact host or a
 * dot-boundary subdomain of it; `notdigistore24.com` and
 * `digistore24.com.evil.example` are neither, and there is a test for each.
 *
 * If Digistore24 ever serves the checkout from a third domain, this list is the
 * one line to change — and `lib/digistore/testpay.test.ts` derives its cases
 * from it, so the new domain is measured on the day it is added.
 */
export const DIGISTORE_CHECKOUT_HOSTS = [
  "digistore24.com",
  "checkout-ds24.com",
];

/**
 * The developer key this template ships with.
 *
 * A developer key carries no account permissions, it only identifies the
 * calling application — the role of an OAuth client ID. Not a secret, which is
 * why it sits openly in the code and is deliberately not obfuscated. The
 * permission-bearing API key only comes into being once the merchant approves
 * the access in the browser, and afterwards lives solely in that merchant's
 * local `.env`.
 */
export const DIGISTORE_DEVELOPER_KEY =
  "1706550-aASzoSnqcChueKmMDBvcwqUWvOqnfhXTncfkTN6X"; // gitleaks:allow trufflehog:ignore pragma: allowlist secret NOSONAR nosemgrep

/**
 * Permissions requested for the API key that `node run.mjs ds24-connect`
 * fetches. `writable` is the only value that works here: the app creates
 * products and generates checkout links, and both need write access.
 */
export const DIGISTORE_REQUESTED_PERMISSIONS = "writable";

/**
 * The public redirect page every localhost URL travels through — Digistore24
 * accepts public https addresses only. Reached ONLY while the app runs on
 * localhost; an app on its own domain hands out its own URLs directly
 * (`publicUrlFor()` in `public-url.ts`).
 *
 * The page behind it is a handful of static files; it never sees an API key or
 * any purchase data — all it does is send a browser onwards to a hard-wired
 * localhost.
 */
export const DIGISTORE_REDIR_URL = "https://ds24-appkit.com/redir/";
