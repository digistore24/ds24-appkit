#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The remote half of `node run.mjs errors`: read a DEPLOYED app's own error
// window over `GET /api/diagnostics/errors`.
//
//   node run.mjs errors --url https://app.example.com
//   node run.mjs errors --url https://app.example.com --env prod
//
// It prints what the local run prints, because both call the same
// `renderFindings()` — the format is structural rather than two format strings
// that agree today (`lib/diagnostics/parse.mjs`).
//
// 🚨 **The exit codes are the point.** 1 is "I found something", 2 is "I could
// not look", and keeping those apart is the whole reason this command exists:
// "green because it checked" and "green because it skipped" are the same
// colour. A 404, a timeout, a 429 or an answer that is not JSON exits 2 and
// never prints a `✓`.
//
// `fetch()` and nothing else — `curl` and `wget` are forbidden by
// `scripts/portability.test.ts`, and Node has fetch built in.
import "../lib/env.mjs";

import { renderFindings } from "../../lib/diagnostics/parse.mjs";
import { hostOf, isLocalHost, matchHostScope, notAUsableUrl } from "../lib/host-env.mjs";
// The ONE bound, imported rather than restated — a second constant is a second
// thing that can be right here and wrong there.
import { TIMEOUT_MS } from "../health/probes/_transport.mjs";

/**
 * Which `.env` names hold the address and the secret for each environment.
 *
 * The same shape as `scripts/setup/check.mjs` and for the same reason: the
 * variables a script READS are the variables `.env.example` DOCUMENTS, and a
 * derived name (`DIAGNOSTICS_SECRET_${name.toUpperCase()}`) would tell an
 * operator to set `…_PRODUCTION` while the code reads `…_PROD`. They would set
 * it, nothing would happen, and nothing would say why.
 */
export const ENVIRONMENTS = {
  development: { urlVar: "APP_URL", keyVar: "DIAGNOSTICS_SECRET" },
  staging: { urlVar: "APP_URL_STAGING", keyVar: "DIAGNOSTICS_SECRET_STAGING" },
  production: { urlVar: "APP_URL_PROD", keyVar: "DIAGNOSTICS_SECRET_PROD" },
};

/** `dev` / `prod` are accepted spellings; anything else is refused, not guessed. */
export function resolveEnvName(asked) {
  if (!asked) return null;
  if (asked === "dev") return "development";
  if (asked === "prod") return "production";
  return Object.hasOwn(ENVIRONMENTS, asked) ? asked : undefined;
}

/**
 * The three scopes above as a LIST, in the order they are tried.
 *
 * `matchHostScope()` walks an array because two of its four callers keep one;
 * this table is an object because `--env prod` looks a scope up by name. The
 * order `Object.entries()` produces is the order this loop always had —
 * development, staging, production — and it is not load-bearing: a URL matches
 * at most one configured host, and a lookalike matches none.
 */
const SCOPE_LIST = Object.entries(ENVIRONMENTS).map(([envName, scope]) => ({ envName, ...scope }));

/**
 * Which environment a `--url` belongs to, and the secret configured for it.
 *
 * Pure, so the refusal is tested instead of hoped for — the shape of
 * `smokeCredentials()` in `sign-in.mjs`, which returns `{ reason }` rather than
 * guessing. 🚨 **Never a "probably meant" fallback.** A secret provisioned for
 * one host must not travel to a lookalike domain because a URL was mistyped,
 * and sending it there is exactly what a fallback would do.
 *
 * ONE resolver, shared with `smoke.mjs` — two that agree today is the drift this
 * story refuses everywhere else. Since 0.24.0 the LOOP under it is shared too
 * (`scripts/lib/host-env.mjs`); what stays here is this table, the `--env`
 * override and the sentence naming the key.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} baseUrl
 * @param {string | null} [asked] the `--env` flag, if one was given
 * @returns {{ envName: string, secret: string, keyVar: string } | { reason: string }}
 */
export function diagnosticsCredentials(env, baseUrl, asked = null) {
  const target = hostOf(baseUrl);
  if (!target) return { reason: notAUsableUrl(baseUrl) };

  const named = resolveEnvName(asked);
  if (named === undefined) {
    return {
      reason: `unknown environment "${asked}" — development, staging or production`,
    };
  }

  if (named) {
    const { keyVar } = ENVIRONMENTS[named];
    const secret = env[keyVar];
    if (!secret) {
      return {
        reason:
          `no ${keyVar} in the .env — that is the secret set on the ${named} host. ` +
          `Generate one, set it in the host's secrets, redeploy, and put the same value here`,
      };
    }
    return { envName: named, secret, keyVar };
  }

  // No --env: the environment is the one whose configured hostname matches.
  const matched = matchHostScope(env, baseUrl, SCOPE_LIST, {
    hostsLabel: "configured hosts",
    neverClause: "the secret is never sent to a host it was not configured for",
    nothingConfigured: (host) =>
      "no APP_URL, APP_URL_STAGING or APP_URL_PROD is set, so there is nothing to match " +
      `${host} against — name the environment yourself with --env prod, or fill the .env`,
  });
  if ("reason" in matched) return matched;

  const { envName, urlVar, keyVar } = matched.scope;
  const secret = env[keyVar];
  if (!secret) {
    return {
      reason:
        `${target} is the ${envName} app (${urlVar}) and no ${keyVar} is set in the .env — ` +
        `that is the secret configured on that host`,
    };
  }
  return { envName, secret, keyVar };
}

/**
 * Ask the deployed app what it has in its window.
 *
 * Exported because `smoke.mjs` needs the same reader — it takes a `seq` before
 * its sweep and asks with `after=<seq>` afterwards, the remote twin of
 * `markLog()`.
 *
 * @param {{ baseUrl: string, secret: string, after?: number }} options
 * @returns {Promise<{ ok: true, seq: number, since: string, instance: string,
 *   retainedLines: number, oldest: string | null, droppedLines: number,
 *   findings: object[] } | { ok: false, reason: string }>}
 */
export async function readRemoteFindings({ baseUrl, secret, after }) {
  const base = String(baseUrl).replace(/\/$/, "");
  const url =
    `${base}/api/diagnostics/errors` + (typeof after === "number" ? `?after=${after}` : "");

  let answer;
  try {
    answer = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      redirect: "manual",
      // 🚨 The bound `scripts/health/probes/_transport.mjs` promises for "every
      // request in this whole command" — this one is the exception it did not
      // know about, because the source assertion that guards it walks
      // `scripts/health/**` and this file is not there. A host that accepts the
      // connection and never answers otherwise hangs `health --url`,
      // `errors --url` and the remote half of `smoke` for ever, and the check
      // somebody then abandons is the one they do not run again.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: `${base} did not answer — ${error.message}` };
  }

  if (answer.status === 404) {
    return {
      ok: false,
      reason:
        "the app answered 404. Either that host has no DIAGNOSTICS_SECRET set, or the one " +
        "in your .env does not match it; from outside those look the same on purpose. Set " +
        "it in the host's secrets and redeploy.",
    };
  }
  if (answer.status === 429) {
    return { ok: false, reason: "the app answered 429 — rate limited; wait and ask again" };
  }
  if (answer.status !== 200) {
    return { ok: false, reason: `the app answered ${answer.status}, not 200` };
  }

  let body;
  try {
    body = await answer.json();
  } catch {
    return {
      ok: false,
      reason:
        "the answer was not JSON — something in front of the app (a proxy, a login wall, " +
        "a CDN error page) replied instead of the app itself",
    };
  }
  if (!Array.isArray(body?.findings)) {
    return { ok: false, reason: "the answer carried no findings list — not this endpoint" };
  }

  return { ok: true, ...body };
}

/**
 * How the window is named in the output — never a bare `✓`.
 *
 * AC6 in one function: an empty answer has to read as *"nothing in the last N
 * lines since 14:02"*, never as *"your app is fine"*. The ring empties on every
 * restart, so a redeploy five seconds ago is an empty window and not health.
 */
export function describeWindow(body) {
  const lines = `${body.retainedLines} line(s)`;
  const oldest = body.oldest ? `, oldest ${body.oldest}` : "";
  const dropped = body.droppedLines > 0 ? `, ${body.droppedLines} dropped` : "";
  return `in the last ${lines}${oldest}${dropped} of the deployed app's log (instance ${body.instance}, up since ${body.since})`;
}

const MULTI_INSTANCE =
  "·  the window is this ONE instance's, in memory, and it empties on every restart.\n" +
  "   Behind a load balancer another call may reach another instance.";

const isLocal = (url) => isLocalHost(hostOf(url) ?? "");

/**
 * `node run.mjs errors --url …` — returns the process exit code.
 *
 * 0 nothing found · 1 findings · 2 could not look. Nothing here ever prints a
 * `✓` on the path that returns 2.
 */
export async function runRemote({ url, env, argv = process.argv.slice(2) }) {
  const at = argv.indexOf("--env");
  const asked = at === -1 ? null : (argv[at + 1] ?? null);

  const credentials = diagnosticsCredentials(env, url, asked);
  if (credentials.reason) {
    console.error(`✗ Could not look — ${credentials.reason}`);
    return 2;
  }

  const body = await readRemoteFindings({ baseUrl: url, secret: credentials.secret });
  if (!body.ok) {
    console.error(`✗ Could not look — ${body.reason}`);
    return 2;
  }

  const source = describeWindow(body);
  if (body.findings.length === 0) {
    console.log(`✓ No errors ${source}.`);
    if (!isLocal(url)) console.log(MULTI_INSTANCE);
    return 0;
  }

  const { head, body: lines, tail } = renderFindings(body.findings, {
    source,
    logHint:
      "The full context, with stack traces, is in the HOST's own log — this app keeps only\n" +
      "a bounded, redacted window of it and cannot read the host's.",
  });
  for (const line of [...head, ...lines, ...tail]) console.error(line);
  if (!isLocal(url)) console.error(MULTI_INSTANCE);
  return 1;
}
