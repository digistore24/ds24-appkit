#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A signed-in session for `smoke`, from a script — so it can call the pages
// behind the sign-in instead of collecting redirects.
//
// The hole it closes: every page under /dashboard answers an anonymous request
// with a 307 to /login, which is the correct answer and says nothing about the
// page. So exactly the pages with the real queries in them — the operator's, the
// member's, the ones touching money and roles — were only ever exercised when a
// person opened them by hand. See CLAUDE.md → "Never ship a broken page".
//
// Two doors, chosen by where the app runs:
//
//  - **Local app** → the development login, as the OWNER
//    (`signInAsOwner`). DEV-only by construction: that provider does not
//    exist outside development (lib/auth/dev-login.ts).
//  - **Deployed app** → the real password sign-in, as the smoke MEMBER
//    (`signInAsSmokeMember`). The account and its password come from
//    `node run.mjs smoke-account` (scripts/users/smoke-account.mjs, which
//    also carries the member-not-owner reasoning); the credentials live in
//    the local `.env` and are scoped to the host they were provisioned for —
//    `smokeCredentials()` refuses to hand them to any other URL.
//
// Three rules held this file to `fetch` and nothing else:
//
//  1. **Never hardcode a cookie name.** In DEV the names carry a fingerprint of
//     AUTH_SECRET (lib/auth/cookie-names.ts), so two apps on one machine do not
//     overwrite each other's session. The jar below therefore stores whatever
//     `Set-Cookie` arrives and hands it back — it never needs to know a name.
//  2. **Never re-derive whether a sign-in is allowed.** The dev login's four
//     conditions are security-critical and live in ONE place
//     (lib/auth/dev-login.ts → isDevLoginAllowed); a copy of them here would be
//     a copy that drifts. So we ask the app instead: /api/auth/providers lists
//     what is actually configured — for the password door exactly as for the
//     development one. Ask the thing, not the config.
//  3. **Skipping is said out loud, never assumed silently.** Every way out of
//     here returns a reason, and smoke prints it. A sweep that quietly stopped
//     being signed in would report green while checking nothing.
import postgres from "postgres";
import "../lib/env.mjs";

import { matchHostScope } from "../lib/host-env.mjs";

/**
 * A cookie jar that knows no cookie names.
 *
 * Deliberately crude — it keeps the last value per name and never looks at Path,
 * Domain or Expires. Everything here talks to one origin inside one second,
 * so the parts of the spec it ignores cannot come up. What it must get right is
 * the one thing it does: give back exactly what the app set.
 */
export function cookieJar() {
  const jar = new Map();
  return {
    take(response) {
      // getSetCookie() keeps multiple Set-Cookie headers apart; a plain get()
      // joins them with a comma and Expires dates contain commas.
      const headers = response.headers.getSetCookie?.() ?? [];
      for (const header of headers) {
        const [pair] = header.split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    get header() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    get size() {
      return jar.size;
    },
  };
}

/** Is this provider among the ones the app actually offers? */
async function providerOffered(baseUrl, id) {
  const answer = await fetch(`${baseUrl}/api/auth/providers`, { redirect: "manual" });
  if (!answer.ok) return false;
  const providers = await answer.json();
  return Boolean(providers?.[id]);
}

/**
 * The Auth.js sign-in dance both doors share: fetch the CSRF pair, POST the
 * credentials to the provider's callback, read the verdict.
 *
 * @returns {Promise<{cookie: string} | {refused: true} | {skipped: true, reason: string}>}
 */
async function callbackSignIn(baseUrl, providerId, fields) {
  const jar = cookieJar();

  // Auth.js pairs a CSRF cookie with a token in the body; both have to travel.
  const csrfAnswer = await fetch(`${baseUrl}/api/auth/csrf`, { redirect: "manual" });
  jar.take(csrfAnswer);
  const { csrfToken } = await csrfAnswer.json().catch(() => ({}));
  if (!csrfToken) return { skipped: true, reason: "no CSRF token from /api/auth/csrf" };

  // `json=true` asks Auth.js for a JSON answer instead of a redirect, which is
  // the shape a script can read. The session cookie rides on the response either
  // way — that is what we are here for.
  const login = await fetch(`${baseUrl}/api/auth/callback/${providerId}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header },
    body: new URLSearchParams({ csrfToken, ...fields, json: "true" }).toString(),
  });
  jar.take(login);

  // A refused sign-in still answers 200 with a URL carrying ?error= — so the
  // status code is not the test. Whether we hold more cookies than the CSRF one
  // we arrived with is.
  const location = login.headers.get("location") ?? "";
  const body = await login.text().catch(() => "");
  if (/[?&]error=/.test(location) || /[?&]error=/.test(body)) return { refused: true };
  if (jar.size < 2) return { refused: true };

  return { cookie: jar.header };
}

/**
 * The oldest owner's address — the account the operator made for themselves.
 *
 * The same order as demoLoginSuggestion() in lib/auth/dev-login.ts, and for the
 * same reason. Owners only: signing in as a member would collect a legitimate
 * redirect on every admin page and prove nothing about it.
 *
 * No account is created here. An app with no owner yet gets a named skip and a
 * command to fix it — inventing a user would put a row somebody did not ask for
 * into their database, on a command they ran to look at pages.
 */
async function oldestOwner() {
  if (!process.env.DATABASE_URL) return { error: "DATABASE_URL is not set" };
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 2, connect_timeout: 5 });
  try {
    // The column names are quoted because db/schema.ts declares them camelCase
    // ("createdAt", not created_at) — unquoted, Postgres would fold them to
    // lower case and not find them.
    const rows = await sql`
      select email from users
      where role = 'owner' and "blockedAt" is null
      order by "createdAt" asc
      limit 1
    `;
    if (rows.length === 0) {
      return { error: "no owner account yet — create one: node run.mjs user-create --email … --role owner --apply" };
    }
    return { email: rows[0].email };
  } catch (error) {
    return { error: `the database did not answer (${error.message.split("\n")[0]})` };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

/**
 * Sign in as the app's owner and return the cookies that prove it.
 *
 * DEV-only by construction: without the development login there is no way in
 * from a script here, and that provider does not exist outside development.
 *
 * @returns {Promise<{cookie: string, as: string, role: string} | {skipped: true, reason: string}>}
 */
export async function signInAsOwner(baseUrl) {
  const skip = (reason) => ({ skipped: true, reason });

  try {
    if (!(await providerOffered(baseUrl, "dev-login"))) {
      return skip(
        "the development login is not active — mail delivery is configured, APP_URL is not local, " +
          "or DEV_LOGIN=off (lib/auth/dev-login.ts)",
      );
    }
  } catch (error) {
    return skip(`the app did not answer on /api/auth/providers (${error.message})`);
  }

  const owner = await oldestOwner();
  if (owner.error) return skip(owner.error);

  const result = await callbackSignIn(baseUrl, "dev-login", { email: owner.email });
  if (result.skipped) return result;
  if (result.refused) return skip(`the development login refused ${owner.email}`);

  return { cookie: result.cookie, as: owner.email, role: "owner" };
}

/**
 * Which smoke credentials belong to this URL — or the reason none do.
 *
 * The scoping is the security property of this function, not a convenience:
 * the password in `SMOKE_PROD_PASSWORD` was provisioned for the host in
 * `APP_URL_PROD` and must never be POSTed anywhere else. A typo'd `--url`,
 * a lookalike domain, a staging URL against prod credentials — all land in
 * the refusal, never in a "probably meant" fallback.
 *
 * Pure, so the refusal is tested instead of hoped for. The loop under it is
 * `matchHostScope()` (`scripts/lib/host-env.mjs`) since 0.24.0 — one host rule
 * for all four commands that point at a deployed app. What is still HERE is the
 * part that is genuinely this caller's: two scopes, a PAIR of values rather than
 * one secret, and the fix sentence that names `smoke-account`.
 *
 * ⚠️ **The two variable names are derived from `suffix` and that is a shipped
 * exception, not a licence.** `SMOKE_<SUFFIX>_EMAIL`/`_PASSWORD` are documented
 * in `.env.example` exactly as spelled, and they are this file's own pair; the
 * shared helper grows no such convenience, because `_PROD` vs `_PRODUCTION` is
 * how an operator ends up setting a key nothing reads.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} baseUrl the URL smoke is about to sweep
 * @returns {{ email: string, password: string, envName: "prod" | "staging" } | { reason: string }}
 */
export function smokeCredentials(env, baseUrl) {
  const scopes = [
    { envName: "prod", urlVar: "APP_URL_PROD", suffix: "PROD" },
    { envName: "staging", urlVar: "APP_URL_STAGING", suffix: "STAGING" },
  ];

  const matched = matchHostScope(env, baseUrl, scopes, {
    hostsLabel: "deployed hosts",
    neverClause:
      "smoke credentials are never sent to a host they were not provisioned for",
    nothingConfigured: () =>
      "APP_URL_PROD is not set — the smoke credentials are scoped to the deployed " +
      "domain, and without it there is nothing to scope them to (.env, see .env.example)",
  });
  if ("reason" in matched) return matched;

  const { scope, host } = matched;
  const email = env[`SMOKE_${scope.suffix}_EMAIL`];
  const password = env[`SMOKE_${scope.suffix}_PASSWORD`];
  if (!email || !password) {
    const envFlag = scope.envName === "staging" ? " --env staging" : "";
    return {
      reason:
        `no smoke account configured for ${host} — create one: ` +
        `DATABASE_URL="postgres://…" node run.mjs smoke-account${envFlag} --apply`,
    };
  }
  return { email, password, envName: scope.envName };
}

/**
 * Sign in as the smoke member on a DEPLOYED app and return the cookies that
 * prove it.
 *
 * Uses the real password door (lib/auth/password-login.ts) exactly as a
 * browser would — nothing is bypassed, so this run also proves the sign-in
 * path itself. One attempt per run: the password sign-in rate-limits at ten
 * per quarter hour per address, so only repeatedly failing runs could ever
 * hit the limit — and the skip below names rotation as the fix rather than
 * inviting a retry.
 *
 * @returns {Promise<{cookie: string, as: string, role: string} | {skipped: true, reason: string}>}
 */
export async function signInAsSmokeMember(baseUrl) {
  const skip = (reason) => ({ skipped: true, reason });

  const creds = smokeCredentials(process.env, baseUrl);
  if (creds.reason) return skip(creds.reason);

  try {
    if (!(await providerOffered(baseUrl, "password"))) {
      return skip("the app does not offer the password sign-in on /api/auth/providers");
    }
  } catch (error) {
    return skip(`the app did not answer on /api/auth/providers (${error.message})`);
  }

  const result = await callbackSignIn(baseUrl, "password", {
    email: creds.email,
    password: creds.password,
  });
  if (result.skipped) return result;
  if (result.refused) {
    return skip(
      `the password sign-in refused ${creds.email} — rotate the account: ` +
        `DATABASE_URL="postgres://…" node run.mjs smoke-account` +
        (creds.envName === "staging" ? " --env staging" : "") +
        " --apply",
    );
  }

  return { cookie: result.cookie, as: creds.email, role: "member" };
}
