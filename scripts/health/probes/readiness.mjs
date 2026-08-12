// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 2 — does the database this app sells from answer?
//
// `/api/readyz` runs `select 1` and answers 200 `{"status":"ready"}` or **503**
// `{"status":"not-ready"}`. Public by design, like `/api/healthz`, and asked
// with no credential for the same reason.
//
// ⚠️ **It is still asked when `readyz` says 503.** An app that is serving but
// cannot reach its database is exactly the app whose jobs, error window and IPN
// log are worth asking about — the four probes after this one carry on. Only a
// `liveness` finding stops the run, because only that one means there is nothing
// to ask.
import { ask } from "./_transport.mjs";
import { finding, notAsked, ranClean, ranFound, UNREACHABLE_REASON } from "../rules.mjs";

const PATH = "/api/readyz";

export const readiness = {
  id: "readiness",
  label: "Its database answers",
  tier: 1,
  covers: "whether the database this app's accounts, purchases and access live in is reachable from the app",

  async run({ url, liveness }) {
    if (liveness?.state === "found") return notAsked(UNREACHABLE_REASON);

    const target = `${url}${PATH}`;
    const attempt = await ask(target);
    if (!attempt.ok) {
      // Not a finding: `liveness` answered, so the app IS up, and this one
      // request failing is something nobody looked through. A skip with the
      // reason — never a second CRITICAL about a fact already reported.
      return notAsked(attempt.reason);
    }

    const { response, ms } = attempt;

    if (response.status === 503) {
      const observed = `HTTP 503 in ${ms} ms — the app's own "select 1" did not come back`;
      return ranFound(
        [
          finding({
            severity: "critical",
            title: "The app is up, and its database does not answer",
            where: target,
            why:
              "Nobody can sign in, no purchase can be recorded and no page that reads anything " +
              "will render. A payment notification arriving now is lost work your customer has " +
              "already paid for.",
            fix:
              "Open your host's dashboard and look at the database add-on: is it running, is it " +
              "out of storage, and did the app's DATABASE_URL change in the last deploy?",
            evidence: observed,
          }),
        ],
        // Every probe that RAN gets its line, findings or not.
        `GET ${target} — ${observed}`,
      );
    }

    if (response.status !== 200) {
      const observed = `HTTP ${response.status} in ${ms} ms, expected 200 or 503`;
      return ranFound(
        [
          finding({
            severity: "high",
            title: `The readiness endpoint answered ${response.status}`,
            where: target,
            why:
              "This endpoint answers 200 or 503 and nothing else, so something other than the app " +
              "replied — which means nothing here knows whether the database is reachable.",
            fix:
              "Check whatever sits in front of the app (a proxy, a CDN, a login wall) and whether " +
              "this address really reaches this app.",
            evidence: observed,
          }),
        ],
        `GET ${target} — ${observed}`,
      );
    }

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (body?.status !== "ready") {
      return notAsked(
        `the app answered 200 but not {"status":"ready"} — that answer did not come from ${PATH}`,
      );
    }

    return ranClean(`GET ${target} — 200 {"status":"ready"} in ${ms} ms (the app ran "select 1")`);
  },
};
