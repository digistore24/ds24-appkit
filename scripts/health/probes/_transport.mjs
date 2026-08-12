// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How the six probes talk to a deployed app — not a probe itself.
//
// `_` because the registry in `../check.mjs` imports the six files beside this
// one by name and this is the only other thing in the folder; the same signal
// `scripts/ds24/_approval.mjs` carries.
//
// Two rules hold every request in this whole command, and both are asserted on
// the SOURCE by `scripts/portability.test.ts` and the tests beside it:
//
//   * `redirect: "manual"`. A followed 307 hands back somebody else's 200 —
//     and carries the bearer token there. Story 32.2 shipped that once.
//   * `AbortSignal.timeout(…)`. A hung request inside a command nobody is
//     watching the network for is indistinguishable from a hung command;
//     somebody reaches for Ctrl-C, and the check they interrupted is the check
//     they stop running.
//
// `fetch()` and nothing else — `curl` and `wget` are forbidden here, and Node
// has fetch built in.

/**
 * How long any one request may take.
 *
 * Ten seconds, the same bound `rungs/live.mjs`, `rungs/registry.mjs` and
 * `rungs/drift.mjs` use, so this project does not have four opinions about
 * patience.
 */
export const TIMEOUT_MS = 10_000;

/**
 * One GET, with the two rules above and a duration.
 *
 * Never throws: a transport failure is `{ ok: false, reason }`, because every
 * caller has to decide for itself whether that is a finding (`liveness`: the
 * app is down) or a skip (`jobs`: nobody could look). The transport does not
 * get to make that call.
 *
 * @param {string} url
 * @param {{ secret?: string }} [options]
 * @returns {Promise<{ ok: true, response: Response, ms: number }
 *                 | { ok: false, reason: string, ms: number, timedOut: boolean }>}
 */
export async function ask(url, { secret } = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}),
    });
    return { ok: true, response, ms: Date.now() - started };
  } catch (error) {
    // The transport's own sentence is "TypeError: fetch failed" — it names no
    // host, and the first thing anybody wants to know is WHICH one. So the
    // address goes in front and the transport's words stay behind it.
    const name = String(error?.name ?? "") || "the request failed";
    const detail = String(error?.message ?? "").trim() || "no further detail";
    return {
      ok: false,
      reason: `${url} did not answer (${name}: ${detail})`,
      ms: Date.now() - started,
      timedOut: name === "TimeoutError" || name === "AbortError",
    };
  }
}

/** The endpoint `media` and `ipn` share. */
export const OPS_HEALTH_PATH = "/api/diagnostics/health";

/**
 * The sentence a 404 earns, and why it names three causes at once.
 *
 * 🚨 From outside, "this host has no `DIAGNOSTICS_SECRET`", "the one in your
 * `.env` is a different value" and "this app was deployed before the endpoint
 * existed" are the same bodiless 404 — deliberately, because the alternative is
 * an endpoint that tells a stranger a diagnostics surface is here. So the skip
 * names all three rather than guessing one, and says that they look the same on
 * purpose.
 */
export const OPS_HEALTH_404 =
  "the app answered 404. Either that host has no DIAGNOSTICS_SECRET set, the one in your " +
  ".env does not match it, or that app was built before template 0.24.0 and has no such " +
  "endpoint at all; from outside those look the same on purpose. Set the secret in the " +
  "host's secrets, redeploy, and put the same value in your .env";

/**
 * `GET /api/diagnostics/health`, ONCE, for both probes that read it.
 *
 * Cached on the run's own context object rather than in a module variable: a
 * module-level cache would survive between two runs inside one process (a test,
 * a future watchdog calling this twice) and answer the second run with the
 * first one's facts.
 *
 * @param {{ url: string, secret: string, shared?: Map<string, unknown> }} ctx
 * @returns {Promise<{ ok: true, body: object } | { ok: false, reason: string }>}
 */
export async function readOpsHealth(ctx) {
  const cache = ctx.shared;
  if (cache?.has(OPS_HEALTH_PATH)) return cache.get(OPS_HEALTH_PATH);

  const answer = await readOpsHealthUncached(ctx);
  cache?.set(OPS_HEALTH_PATH, answer);
  return answer;
}

async function readOpsHealthUncached({ url, secret }) {
  const target = `${String(url).replace(/\/$/, "")}${OPS_HEALTH_PATH}`;
  const attempt = await ask(target, { secret });
  if (!attempt.ok) return { ok: false, reason: attempt.reason };

  const { response } = attempt;
  if (response.status === 404) return { ok: false, reason: OPS_HEALTH_404 };
  if (response.status === 429) {
    return { ok: false, reason: "the app answered 429 — rate limited; wait and ask again" };
  }
  if (response.status !== 200) {
    return { ok: false, reason: `the app answered ${response.status}, not 200` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      reason:
        "the answer was not JSON — something in front of the app (a proxy, a login wall, " +
        "a CDN error page) replied instead of the app itself",
    };
  }
  if (!body?.media || !body?.ipn) {
    return { ok: false, reason: "the answer carried no media/ipn state — not this endpoint" };
  }
  return { ok: true, body };
}
