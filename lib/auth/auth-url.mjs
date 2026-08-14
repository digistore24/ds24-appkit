// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where the app says it lives — for the links it MAILS OUT.
//
// ── The failure this file exists to prevent ────────────────────────────────
// `trustHost: true` (auth.config.ts) lets Auth.js derive its own origin from
// the request headers. Behind a PaaS router that is often not the address the
// customer typed: on DigitalOcean App Platform the container sees itself as
// `localhost:8080` and no `x-forwarded-host` with the public domain arrives.
// Everything still works — the app answers, pages render, the purchase goes
// through — and the sign-in mail carries
// `https://localhost:8080/api/auth/callback/email?…`. A freshly deployed
// customer cannot get into their own account, and nothing anywhere is red.
// Measured on a real app, 2026-08-14 (`docs/troubleshooting.md`).
//
// The app KNOWS its address: `APP_URL`. The same mail already uses it for the
// Impressum links in its footer (`legalFooterLinks()`, lib/email.ts) — only
// not for the one link the mail exists for. So the origin of everything Auth.js
// mails or redirects to is taken from `APP_URL` here, by setting `AUTH_URL`
// from it (`applyAuthUrl`, called at the top of auth.config.ts). Auth.js reads
// `AUTH_URL` in `reqWithEnvURL()` and rewrites the request's origin with it
// before it builds a single URL, so the magic link, the `callbackUrl` of a
// redirect and the OAuth return address all come out on the app's own domain.
//
// 🚨 `trustHost` stays ON and this does not replace it — it solves a different
// problem (Auth.js refusing an unknown Host outright). What is deliberate is
// the DIRECTION: for something that gets mailed out, the request is never the
// authority. For the PWA manifest the opposite is right and stays that way
// (`lib/pwa/manifest.ts` → `originFrom()`): the browser compares that value
// against the origin of the page it is standing on, so it must come from the
// request.
//
// It is `.mjs` with zero imports — the same pattern as `lib/email-from.mjs`,
// and for the same reason: two very different callers need one rule.
// `auth.config.ts` sits in front of every matched request and is bundled for
// the edge too, and `lib/env-guard.ts` runs before the app accepts one.

/**
 * The origin of a URL — scheme, host, port, and nothing else.
 *
 * Deliberately the ORIGIN and not the value as written: `AUTH_URL` with a path
 * becomes Auth.js's `basePath` (`setEnvDefaults()` in next-auth/lib/env.js), so
 * an `APP_URL` of `https://example.com/app` handed over whole would move every
 * auth route to `/app` and break sign-in in a way nobody would connect to this
 * line. A trailing slash is dropped by the same step.
 *
 * @param {string | null | undefined} value
 * @returns {string | null} null when the value is missing or not a URL with an origin
 */
export function urlOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const { origin } = new URL(value.trim());
    // `new URL("mailto:a@b.de").origin` is the STRING "null" — a non-http
    // scheme has no origin, and letting that through would set AUTH_URL to
    // four characters that parse as nothing.
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * What the operator set themselves, if anything. `NEXTAUTH_URL` counts because
 * Auth.js still honours it (`AUTH_URL ?? NEXTAUTH_URL`) — a rule that ignored
 * it would be a rule Auth.js does not follow.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function configuredAuthUrl(env) {
  const raw = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (typeof raw !== "string") return null;
  return raw.trim() || null;
}

/**
 * Sets `AUTH_URL` from `APP_URL` unless the operator has set one.
 *
 * Mutating the environment is the whole point: `AUTH_URL` is the only lever
 * Auth.js offers here — there is no config field for it, and `reqWithEnvURL()`
 * reads `process.env` at request time. Doing it from `auth.config.ts` rather
 * than from `instrumentation.ts` is deliberate: every entry point that can
 * build an auth URL (`proxy.ts` and `auth.ts`) imports that file, so ESM
 * guarantees this has run before `NextAuth()` sees anything. The hook only runs
 * in the Node runtime and only at boot.
 *
 * ⚠️ An operator's own value WINS rather than being overwritten — the one shape
 * this must not break is a deployment that had already worked around the defect
 * by setting `AUTH_URL` by hand. When it disagrees with `APP_URL`,
 * `authUrlProblem()` below refuses the start instead of quietly picking one.
 *
 * @param {Record<string, string | undefined>} env  usually `process.env`
 * @returns {string | null} the value in force afterwards, or null when there was nothing to derive from
 */
export function applyAuthUrl(env) {
  const configured = configuredAuthUrl(env);
  if (configured) return configured;

  const origin = urlOrigin(env.APP_URL);
  if (!origin) return null;

  env.AUTH_URL = origin;
  return origin;
}

/**
 * @typedef {{ code: "missingAppUrl" }
 *   | { code: "badAppUrl", appUrl: string }
 *   | { code: "badAuthUrl", authUrl: string, appOrigin: string }
 *   | { code: "mismatch", authUrl: string, authOrigin: string, appOrigin: string }} AuthUrlProblem
 */

/**
 * The verdict on the origin outgoing links will carry. `null` = fine.
 *
 * The caller decides when it matters — `lib/env-guard.ts` asks it in STAGING
 * and PROD only, because in DEV a request-derived origin is the same address
 * anyway and `APP_URL` is allowed to be missing while somebody is still setting
 * the machine up.
 *
 * Both halves are start conditions for the same reason the sender-domain rule
 * is one (`lib/email-from.mjs`): the fault is invisible on the day it is made.
 * Nothing throws, no page 500s, the log is clean — the only symptom is a
 * customer who cannot sign in, told to us by them.
 *
 * @param {{ APP_URL?: string, AUTH_URL?: string, NEXTAUTH_URL?: string }} env
 * @returns {AuthUrlProblem | null}
 */
export function authUrlProblem(env) {
  const declared = typeof env.APP_URL === "string" ? env.APP_URL.trim() : "";
  if (!declared) return { code: "missingAppUrl" };

  const appOrigin = urlOrigin(declared);
  if (!appOrigin) return { code: "badAppUrl", appUrl: declared };

  const configured = configuredAuthUrl(env);
  if (!configured) return null;

  const authOrigin = urlOrigin(configured);
  if (!authOrigin) return { code: "badAuthUrl", authUrl: configured, appOrigin };

  // Compared as ORIGINS, so an `AUTH_URL` carrying Auth.js's base path
  // (`https://example.com/api/auth`) is not a mismatch — and so `applyAuthUrl()`
  // above can never trip this rule over its own derivation, whichever of the two
  // ran first.
  if (authOrigin !== appOrigin) {
    return { code: "mismatch", authUrl: configured, authOrigin, appOrigin };
  }
  return null;
}

// Addresses that exist only inside the machine answering the request. A
// customer's browser resolves them to itself, so one of these in something the
// app hands OUT is never a configuration taste — it is a dead end.
const LOOPBACK = /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i;

/**
 * All the absolute addresses one `Location` header hands the browser: the
 * header itself when it is absolute, plus any absolute URL sitting in its query.
 *
 * 🚨 The second half is the whole point and is easy to leave out. The measured
 * failure did NOT have a foreign `Location` — it read
 * `location: /login?callbackUrl=https%3A%2F%2Flocalhost%3A8080%2Fdashboard`, a
 * perfectly relative redirect carrying the wrong origin one level down, which
 * `smoke` printed and ticked. One level of nesting is enough: that is where
 * Auth.js puts it.
 *
 * @param {string} location  the Location header, absolute or relative
 * @param {string} base      the URL it was received on, to resolve against
 * @returns {URL[]}
 */
function addressesIn(location, base) {
  const found = [];
  let resolved;
  try {
    resolved = new URL(location, base);
  } catch {
    return found;
  }
  // Only when the header was absolute — a relative one resolves to `base` by
  // definition and would report the app's own origin as a finding.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location.trim())) found.push(resolved);
  for (const value of resolved.searchParams.values()) {
    try {
      const nested = new URL(value);
      if (nested.origin && nested.origin !== "null") found.push(nested);
    } catch {
      // Not a URL — most query values are not.
    }
  }
  return found;
}

/**
 * A redirect that sends the caller somewhere only the server can reach.
 *
 * This is the cheap, outside-in half of the same question `authUrlProblem()`
 * asks from the inside, and it is the one that works on an app whose code is
 * older than this file: `node run.mjs smoke --url https://…` already HAD the
 * wrong origin on screen and ticked it (`✓ 307 /dashboard`).
 *
 * ⚠️ Deliberately narrow: only a LOOPBACK origin is a finding, and only while
 * the app is being called on a public host. "Every redirect must stay on this
 * origin" is the rule one would write first, and it turns a customer's own
 * off-site redirect — an OAuth start, a payment provider — into a failing gate,
 * which is how a gate gets switched off. Nothing legitimate ever tells a
 * customer's browser to go to `localhost`; other foreign origins are printed
 * next to the route instead, so they are visible without being fatal.
 *
 * @param {string} calledUrl  the URL that was requested
 * @param {string | null | undefined} location  its Location header
 * @returns {{ origin: string, url: string } | null}
 */
export function strandedRedirect(calledUrl, location) {
  if (typeof location !== "string" || !location.trim()) return null;

  let called;
  try {
    called = new URL(calledUrl);
  } catch {
    return null;
  }
  // A local app redirecting locally is the normal DEV case and says nothing.
  if (LOOPBACK.test(called.hostname)) return null;

  for (const address of addressesIn(location, called.origin)) {
    if (LOOPBACK.test(address.hostname)) {
      return { origin: address.origin, url: address.toString() };
    }
  }
  return null;
}
