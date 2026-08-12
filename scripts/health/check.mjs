#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Is my LIVE app healthy? One command, one verdict, one exit code.
//
//   node run.mjs health --url https://app.example.com
//   node run.mjs health --url https://app.example.com --json
//
// SIX probes on the shipped ladder (`scripts/security/rules.mjs`), each
// answering its own question, each reporting `clean` / `found` / `skipped` —
// the same contract Story 30.1 built for the security rungs, imported and never
// re-typed. There is no second severity vocabulary and no second renderer.
//
//   liveness    is the app answering at all            /api/healthz    no credential
//   readiness   does its database answer               /api/readyz     no credential
//   jobs        is anything scheduled failing/stalled  /api/cron?list  CRON_SECRET_<ENV>
//   errors      what is a 200 hiding                   /api/diagnostics/errors
//   media       does the store this app writes to answer  /api/diagnostics/health
//   ipn         when did the last payment notification arrive  (same request)
//
// ── Why the verdict is composed HERE and not in the app ────────────────────
//
// One app-side endpoint answering all six would be one HTTP call with one
// failure mode: when it 404s, SIX answers are missing and the reader sees one
// sentence. Worse, it would run inside the process whose health is the question
// — so "the app is up" would be reported by the thing that has to be up for the
// report to exist. Six probes produce six lines, and `aggregate()` counts what
// nobody asked.
//
// The two facts that genuinely cannot be reached from outside — does the media
// store answer, when did the last IPN arrive — are the ONLY things the app is
// asked about itself (`GET /api/diagnostics/health`, `lib/ops/health.ts`).
//
// ── 🚨 An unreachable app is an ANSWER, not a skip ─────────────────────────
//
// If nothing replies, `liveness` reports one CRITICAL finding and the other five
// report `skipped` with that as their reason — and are **not attempted**. Five
// timeouts and five different network sentences about one fact is not more
// information; it is the same information five times, taking fifty seconds.
//
// ── ⚠️ Not a gate, and it must not become one ──────────────────────────────
//
// Not in `node run.mjs test`, not in a build, not in a commit hook. It asks a
// network and a deployed app, and the answer moves without anything in this
// project changing; a check like that wired into a gate is a brake, and a brake
// is what somebody eventually removes — taking the intent with it. It is run
// because somebody wants to know.
//
// Plain Node, no bundler, no dependency — Linux, macOS and Git Bash on Windows.
// Every request is `fetch()` with `redirect: "manual"` and an
// `AbortSignal.timeout(…)`; no `curl`, no `wget`, no shell, no process spawned.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "../lib/env.mjs";

import { resolveAddress } from "../lib/host-env.mjs";
import { ENVIRONMENTS } from "../dev/errors-remote.mjs";
import { aggregate, outcomeFrom, recordFrom, renderVerdict } from "../security/rules.mjs";
import { VERDICT_TEXTS } from "./rules.mjs";
import { writeHealthRecord } from "./record.mjs";
import { errors } from "./probes/errors.mjs";
import { ipn } from "./probes/ipn.mjs";
import { jobs } from "./probes/jobs.mjs";
import { liveness } from "./probes/liveness.mjs";
import { media } from "./probes/media.mjs";
import { readiness } from "./probes/readiness.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The six, in the order they run.
 *
 * ⚠️ Unlike the security ladder, this order IS load-bearing at exactly one
 * point: `liveness` runs first and every probe after it reads its outcome. That
 * is the whole of the coupling — a seventh probe is one import and one entry
 * here, and nothing else in this file changes.
 */
export const PROBES = [liveness, readiness, jobs, errors, media, ipn];

/** This app's own version, for the record. Never a reason to fail anything. */
function templateVersion() {
  try {
    return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
}

/**
 * Which address to ask.
 *
 * `--url`, then `APP_URL_PROD`, then `APP_URL_STAGING`, then `APP_URL` —
 * production first, because the question is what CUSTOMERS reach.
 *
 * ⚠️ A LOCAL address is allowed here, and that is the one place this differs
 * from `rungs/live.mjs`. That rung asks what a stranger receives and would
 * report a deliberate DEV decision as a defect; "is my app up, and are its jobs
 * running" is a perfectly good question to ask of `node run.mjs start`, and
 * `make deploy-test` asks exactly that.
 *
 * `--env prod` as an ALTERNATIVE to `--url` is deliberately not opened. The seam
 * is here (the resolver takes an order); opening it is a decision somebody makes
 * with the refusal sentences in front of them.
 */
export function resolveHealthTarget(env = {}, argv = []) {
  return resolveAddress(env, argv, {
    order: [
      ENVIRONMENTS.production.urlVar,
      ENVIRONMENTS.staging.urlVar,
      ENVIRONMENTS.development.urlVar,
    ],
    none: (names) =>
      "no address to ask — no --url was given and none of " +
      `${names.join(", ")} is set in the .env`,
  });
}

/**
 * Run every probe and collect its outcome.
 *
 * A probe that throws becomes that probe's `skipped`, carrying the error's
 * message as its reason — the shape `scripts/security/check.mjs` already has,
 * and for the same reason: one check that cannot answer must not take the
 * answers of the others with it. `outcomeFrom()` refuses a probe whose state
 * contradicts its own findings, and a probe whose answer cannot be trusted has,
 * for our purposes, not looked.
 *
 * 🚨 `liveness`'s outcome is handed to every probe after it. That is how the
 * other five know to report `skipped` rather than each discovering the same
 * silence for itself, one ten-second timeout at a time.
 */
export async function runProbes(probes, context) {
  const outcomes = [];
  let livenessOutcome = null;

  for (const probe of probes) {
    try {
      const result = await probe.run({ ...context, liveness: livenessOutcome });
      outcomes.push(outcomeFrom(probe, result));
    } catch (error) {
      outcomes.push(
        outcomeFrom(probe, {
          state: "skipped",
          reason: error?.message ? String(error.message) : String(error),
          findings: [],
        }),
      );
    }
    if (probe.id === "liveness") livenessOutcome = outcomes[outcomes.length - 1];
  }
  return outcomes;
}

/**
 * The whole run as one object — the record's fields, plus the findings per probe.
 *
 * `rungs` is REPLACED rather than joined by a second array: the record's own
 * `rungs` is the states, this is the states with everything else attached, and
 * two arrays describing one thing is how a reader ends up trusting the wrong
 * one. The key keeps the record's name for the same reason. The address is here
 * and deliberately NOT in the record on disk — see `record.mjs`.
 */
function asJson(record, outcomes, target) {
  return {
    ...record,
    address: target.url,
    addressFrom: target.from,
    rungs: outcomes.map((outcome) => ({
      id: outcome.id,
      label: outcome.label,
      covers: outcome.covers,
      state: outcome.state,
      reason: outcome.reason,
      evidence: outcome.evidence,
      findings: outcome.findings,
    })),
  };
}

/**
 * Measure, record, report. Returns the exit code rather than taking it.
 *
 * The three codes mean what they mean for `node run.mjs errors --url`:
 *
 *   0  every probe that ran found nothing at HIGH or above
 *   1  something at ❌ HIGH or 🚨 CRITICAL is open
 *   2  **no address could be resolved at all** — "I could not look", never "it passed"
 *
 * 🚨 A `skipped` probe does NOT raise the exit code. A missing credential is a
 * skip, not a failure, and a command that failed because somebody has not set
 * `CRON_SECRET_PROD` yet is a command people stop running. What a skip does
 * instead is say so, loudly, in the verdict and in `complete: false`.
 */
export async function healthCheck(argv = [], env = process.env) {
  const asData = argv.includes("--json");

  const target = resolveHealthTarget(env, argv);
  if ("reason" in target) {
    // 🚨 stderr, and never a `✓` line — exactly as `errors --url` does. "I could
    // not look" and "nothing found" are the two answers this command exists to
    // keep apart, and printing a tick here would merge them at the very first
    // step.
    console.error(`✗ Could not look — ${target.reason}`);
    return 2;
  }

  const at = argv.indexOf("--env");
  const outcomes = await runProbes(PROBES, {
    url: target.url,
    env,
    argv,
    askedEnv: at === -1 ? null : (argv[at + 1] ?? null),
    now: new Date(),
    // The one request `media` and `ipn` share. A Map on the run rather than a
    // module variable, so two runs in one process cannot answer each other.
    shared: new Map(),
  });

  // Written before anything is printed: the record is the measurement, and a
  // broken renderer must not be able to lose it. It swallows its own errors.
  const record = recordFrom(outcomes, { now: Date.now(), template: templateVersion() });
  writeHealthRecord(record);

  // This story MEASURES and RECORDS. It adds no line to the session greeting and
  // sends no mail — one producer per channel, and neither of those is this file.
  if (asData) console.log(JSON.stringify(asJson(record, outcomes, target), null, 2));
  else {
    console.log(`Asking ${target.url} (${target.from})\n`);
    console.log(renderVerdict(outcomes, VERDICT_TEXTS));
  }

  return aggregate(outcomes).failing ? 1 : 0;
}

// Run only when this file IS the command — compared as a resolved path rather
// than by name, because five other scripts in this project are also called
// check.mjs. Importing it (a test, a later reader) runs nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await healthCheck(process.argv.slice(2)));
}
