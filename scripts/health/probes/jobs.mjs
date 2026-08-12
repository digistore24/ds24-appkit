// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 3 — is anything scheduled failing, stalled or never run?
//
// `GET /api/cron?list` over `CRON_SECRET`, the same endpoint
// `node run.mjs cron --list --url …` asks. What is IMPORTED from that command is
// its CLASSIFICATION (`readBody()`, `jobsFrom()`) and never its printing:
// `scripts/cron/list-report.mjs`'s line formats are pinned by
// `scripts/deploy-test.mjs`, and a second caller reaching into them is how a
// release gate goes red about a job it can no longer find.
//
// 🚨 Story 42.1's three-way split is inherited whole, and the third arm is the
// one that is easy to get wrong:
//
//   a body that does not parse   → a skip (something else answered)
//   a body with no `jobs` array  → a skip (that was not this endpoint)
//   an EMPTY `jobs` array        → a legitimate state, `clean` with evidence
//
// The credential is scoped by `cronSecretFor()` — the hostname is matched
// against `APP_URL_PROD` / `APP_URL_STAGING` and only that host's secret is
// sent. 🚨 **A remote run never mints one**: `POST /api/cron` triggers jobs that
// DELETE customer data, and generating a value the deployed app has never heard
// of would send it, collect the 401 and then blame the `.env` it had just
// written.
import { cronSecretFor } from "../../cron/remote.mjs";
import { jobsFrom, readBody } from "../../cron/list-report.mjs";
import { jobFindings, overdueJobs } from "../../../lib/cron/rules.mjs";
import { ask } from "./_transport.mjs";
import { jobLadderFindings, notAsked, ranClean, ranFound, UNREACHABLE_REASON } from "../rules.mjs";

const PATH = "/api/cron?list";

/**
 * Which secret to send — including for a local app, where there is no scoped one.
 *
 * `cronSecretFor()` answers `{ envName: "local" }` for the loopback and leaves
 * the minting to `scripts/cron/run.mjs`, which is right for the command a
 * developer runs against their own app. Here it is not: this command must never
 * write to the `.env`, so a local app with no secret is a skip naming the
 * command that does write one.
 */
function secretFor(env, url) {
  const scoped = cronSecretFor(env, url);
  if (scoped.reason) return { reason: scoped.reason };
  if (scoped.envName !== "local") return { secret: scoped.secret };

  const local = env.CRON_SECRET;
  if (!local) {
    return {
      reason:
        "no CRON_SECRET is set in this .env, and this command deliberately does not generate " +
        "one — node run.mjs start does that for a local app. Start it, or set the value",
    };
  }
  return { secret: local };
}

export const jobs = {
  id: "jobs",
  label: "Its scheduled jobs are running",
  tier: 1,
  covers:
    "whether the app's scheduled work — deleting data that has aged out, digests, reconciliation — is running and finishing",

  async run({ url, env, now, liveness }) {
    if (liveness?.state === "found") return notAsked(UNREACHABLE_REASON);

    const credential = secretFor(env, url);
    if (credential.reason) return notAsked(credential.reason);

    const target = `${url}${PATH}`;
    const attempt = await ask(target, { secret: credential.secret });
    if (!attempt.ok) return notAsked(attempt.reason);

    const { response, ms } = attempt;

    // 🚨 Four different reasons, never one. The endpoint answers 503 when the
    // HOST has no CRON_SECRET and 401 when the one sent is wrong, and telling
    // an operator to set a secret that is already set is how a report stops
    // being read.
    if (response.status === 503) {
      return notAsked(
        "the app answered 503 — that host has no CRON_SECRET configured, so its scheduler " +
          "endpoint refuses to run at all. Set it in the host's secrets and redeploy",
      );
    }
    if (response.status === 401) {
      return notAsked(
        "the app answered 401 — the CRON_SECRET in this .env is not the value that host has. " +
          "Copy the host's value in; it is never generated here",
      );
    }
    if (response.status !== 200) {
      return notAsked(`the app answered ${response.status}, not 200, at ${PATH}`);
    }

    // Text first, always: `response.json()` consumes the stream and leaves
    // nothing to quote when a proxy answered HTML.
    const text = await response.text();
    const parsed = readBody({ status: response.status, url: target, text });
    if (!parsed.ok) {
      return notAsked(
        `the answer is not JSON${parsed.sample ? ` — it said: ${parsed.sample}` : " and was empty"}`,
      );
    }

    const list = jobsFrom(parsed.body, { status: response.status, url: target });
    if (!list.ok) {
      return notAsked(
        `the answer carried no job list — that did not come from this app's ${PATH}`,
      );
    }

    const found = [...jobFindings(list.jobs), ...overdueJobs(list.jobs, now)];
    const enabled = list.jobs.filter((job) => job?.enabled === true).length;
    const evidence =
      `GET ${target} — ${list.jobs.length} job(s), ${enabled} enabled, in ${ms} ms`;

    // An EMPTY list is a state, not a fault: the core registers eight jobs, so
    // it does not happen in a shipped app, which is exactly why it is easy to
    // turn into an error by accident.
    if (found.length === 0) return ranClean(evidence);
    return ranFound(jobLadderFindings(found, url), evidence);
  },
};
