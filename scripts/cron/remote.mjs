// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which `CRON_SECRET` belongs to which host — pure, and it runs nothing on
// import.
//
//   node run.mjs cron --list --url https://app.example.com
//
// `scripts/cron/run.mjs` does its work at import time, so nothing exported from
// there can be reached by a test. That is why this is its own file rather than
// three more functions in the command: the refusals below are the security half
// of `--url`, and a refusal nothing asserts is a refusal that quietly stops
// refusing (the shape `scripts/dev/sign-in.mjs` and `scripts/dev/errors-remote.mjs`
// already have).
//
// ── The scoping IS the security property ────────────────────────────────────
// The paragraph above `smokeCredentials()` in `scripts/dev/sign-in.mjs` is
// about a password and is exactly as true of this bearer token — arguably more
// so, because `POST /api/cron` triggers jobs that DELETE customer data. A
// typo'd `--url`, a lookalike domain, a staging address against production
// credentials: all of them land in a refusal, never in a "probably meant"
// fallback. A secret is never sent to a host it was not provisioned for.
//
// ── Why this is its own resolver and not a call into one of the others ──────
// `smokeCredentials()` resolves an email + password pair for prod/staging;
// `diagnosticsCredentials()` resolves one secret across three environments and
// takes an `--env` override. This one needs something neither has: a LOCAL
// branch. `node run.mjs cron` is first and foremost the local command, and a
// `--url http://localhost:3000` must take the existing generate-into-`.env`
// path rather than look for a scoped key that was never meant to exist.
//
// 🚨 What the four share is the RULE, and since 0.24.0 the rule is one file
// rather than four copies of it: `scripts/lib/host-env.mjs`. The loop, the
// `known` list, the normalisation and the two terminal refusals live there; the
// scope table, the credential shape and the local branch stay here, because
// those are what genuinely differ. `hostOf()` and `isLocalHost()` moved with it
// and are re-exported below, so no caller of the old names breaks.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.
import { hostOf, isLocalHost, matchHostScope } from "../lib/host-env.mjs";

// Re-exported rather than redefined: these two were the most complete pair in
// the tree (they strip IPv6 brackets and trailing dots), so they became the
// shared ones. `scripts/cron/remote.test.ts` imports them from HERE and passes
// unmodified, which is the proof the move changed nothing.
export { hostOf, isLocalHost };

/**
 * The deployed environments a `--url` can be matched against.
 *
 * Named rather than derived (`CRON_SECRET_${envName.toUpperCase()}`) for the
 * reason `scripts/dev/errors-remote.mjs` gives: the variables a script READS
 * must be the variables `.env.example` DOCUMENTS, and a derived name is how an
 * operator ends up setting a key nothing ever reads.
 *
 * `APP_URL` is deliberately not in here. It is the LOCAL address by contract
 * (CLAUDE.md → *Plans & Digistore products*: "Leave `APP_URL` alone"), so a URL
 * that matches it is a local URL and is answered by the local branch below.
 */
export const CRON_SCOPES = Object.freeze([
  Object.freeze({ envName: "prod", urlVar: "APP_URL_PROD", keyVar: "CRON_SECRET_PROD" }),
  Object.freeze({ envName: "staging", urlVar: "APP_URL_STAGING", keyVar: "CRON_SECRET_STAGING" }),
]);

/**
 * Which secret may be sent to `baseUrl` — or the reason none may.
 *
 * Three shapes of answer, and they are different on purpose:
 *
 *   { envName: "local" }                 → the caller takes the existing
 *                                          generate-into-`.env` path
 *   { envName, secret, keyVar }          → send that value, to that host
 *   { reason }                           → send nothing, print this
 *
 * 🚨 **A remote run never mints a secret.** `cronSecret()` in the command
 * writes a random value into `.env` when none is set — right for a developer's
 * own app, and three wrong statements in a row about somebody else's host: it
 * would invent a value the deployed app has never heard of, send it, collect
 * the inevitable 401, and then blame the `.env` it had just written. So the
 * local branch is the only one that returns without a secret.
 *
 * @param {Record<string, string | undefined>} env  usually `process.env`
 * @param {string} baseUrl the address the operator typed
 * @returns {{ envName: "local" }
 *          | { envName: string, secret: string, keyVar: string }
 *          | { reason: string }}
 */
export function cronSecretFor(env, baseUrl) {
  const target = hostOf(baseUrl);
  if (!target) return { reason: `not a usable URL: ${baseUrl}` };
  if (isLocalHost(target)) return { envName: "local" };

  const matched = matchHostScope(env, baseUrl, CRON_SCOPES, {
    hostsLabel: "deployed hosts",
    neverClause: "a CRON_SECRET is never sent to a host it was not provisioned for",
    nothingConfigured: (host) =>
      "no APP_URL_PROD or APP_URL_STAGING is set, so there is nothing to match " +
      `${host} against — the CRON_SECRET is scoped to a deployed host and is never ` +
      "sent to one it was not provisioned for (.env.example)",
  });
  if ("reason" in matched) return matched;

  const { scope } = matched;
  const secret = env[scope.keyVar];
  if (!secret) {
    return {
      reason:
        `${target} is the ${scope.envName} app (${scope.urlVar}) and no ${scope.keyVar} is ` +
        `set in this .env. That value is not generated here — it is the one in the host's ` +
        `secret storage; copy it in, or set one on both sides (docs/DEPLOY.md, .env.example)`,
    };
  }
  return { envName: scope.envName, secret, keyVar: scope.keyVar };
}
