// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The app's half of the config: the JSON, bound to the judgements in
// `./config-rules.mjs`.
//
// EDGE-CLEAN: a JSON import and pure functions. No database, no React, no
// `node:` builtins, so the gate that runs in front of every request can import
// it.
//
// ── Why the judgements are next door and not here ──────────────────────────
// `node run.mjs metrics-report` is bare Node: it cannot import TypeScript and it
// reads the file off disk rather than through a bundler. Only the READING
// differs between the two, so only the reading is duplicated — what the values
// MEAN lives once, in `./config-rules.mjs`. Otherwise the command and the
// dashboard could disagree about whether an experiment is running.
//
// ── It ships OFF ───────────────────────────────────────────────────────────
// Not caution — a shape. Between `module add metrics` and the moment somebody's
// agent has worked out what "activated" means in THIS app, the funnel is a list
// of milestones nothing fires. A dashboard of zeroes reads as a broken product
// rather than an unfinished setup, so the pages answer nothing until the setup
// is done and the switch is thrown.
//
// ── 🚨 Why the file is in the MODULE and not in the core's `config/` ───────
// Every other module the template ships puts its switch in `config/<name>.json`,
// and `modules/boundary.test.ts` §1c allows exactly that — against a hard-coded
// map of switch files, keyed by path, each carrying its reason. This module was
// written to be shipped SEPARATELY from the template, and a file that is not in
// that map is unexplained by construction: it turns the customer's own
// `npm run test` red on an app with no line of their own code in it.
//
// So this module keeps its switch inside itself and declares no `config` in the
// manifest. The trade is real: `node run.mjs module list` no longer prints the
// path, so `docs/metrics.md` has to say where it is.
//
// ⚠️ The module SHIPS in the template now, so the reason above no longer binds:
// `config/metrics.json` plus an entry in §1c's map is open, and costs a one-off
// migration for every app that already holds this file. Left as it is
// deliberately, not by oversight — `docs/metrics.md` states the same trade.
import raw from "../config.json";

import {
  experimentsIn,
  funnelStepsIn,
  isEnabledIn,
  offReasonIn,
  problemsIn,
  retentionDaysIn,
  DEFAULT_RETENTION_DAYS,
} from "./config-rules.mjs";
import type { Experiment } from "../rules.mjs";

export { DEFAULT_RETENTION_DAYS };

/**
 * A split test as this app declares it.
 *
 * 🚨 **Two events, not one, and the reason is arithmetic.** A rate needs a
 * denominator: `exposure` is who was IN the test, `goal` is who then did the
 * thing. If only the goal carried the experiment, everybody who reached it would
 * also be everybody exposed, every variant would read 100%, and the comparison
 * would be between two numbers that cannot differ. So `track()` is called with
 * the experiment at BOTH places — where the member first meets the variant, and
 * where they succeed.
 */
export interface ExperimentConfig extends Experiment {
  /** The event fired where the member first meets their variant. */
  readonly exposure: string;
  /** The event that counts as success. */
  readonly goal: string;
}

export type MetricsOffReason = "disabledInConfig" | "brokenConfig";

/** The funnel, in the order it is read out — a list of event ids. */
export function funnelSteps(): string[] {
  return funnelStepsIn(raw);
}

/** The split tests this app is running. */
export function experiments(): ExperimentConfig[] {
  return experimentsIn(raw) as ExperimentConfig[];
}

/** One experiment by id, or `null`. */
export function experimentById(id: string): ExperimentConfig | null {
  return experiments().find((e) => e.id === id) ?? null;
}

/** How many days a milestone keeps its member link. */
export function retentionDays(): number {
  return retentionDaysIn(raw);
}

/** What is wrong with the file — empty when nothing is. */
export function metricsConfigProblems(): string[] {
  return problemsIn(raw);
}

/** Why this module is not running — `null` when it is. */
export function metricsOffReason(): MetricsOffReason | null {
  return offReasonIn(raw) as MetricsOffReason | null;
}

/** Is this module live on this installation? Every write and every page asks. */
export function isMetricsEnabled(): boolean {
  return metricsOffReason() === null;
}

/**
 * Did the operator switch it ON, whatever else the file says?
 *
 * The narrower question, and it has the same single lawful use as its twin in
 * the courses module: the OPERATOR's diagnosis surface, which has to survive
 * exactly the `brokenConfig` state it exists to explain. Never a guard.
 */
export function isMetricsSwitchedOn(): boolean {
  return isEnabledIn(raw);
}
