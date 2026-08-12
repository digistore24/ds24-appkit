// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `config/cron.json`, read through one function.
//
// The same shape `lib/billing-mode.ts` and `lib/ai/chat-config.ts` use: a JSON
// file that is the product's decision, read here and nowhere else, with
// everything wrong with it reported BY NAME rather than ignored.
//
// ── A broken config leaves the scheduler ON ────────────────────────────────
// The opposite direction from the assistant, and for the opposite reason.
// There, a malformed config means an unintended bill, so it fails to OFF. Here
// it means an unbounded table and personal data kept past its window, so it
// fails to ON with the defaults — the safe direction is the one where the
// cleanup still happens. What it does NOT do is guess: `cronConfigProblems()`
// names every fault, `node run.mjs cron --list` prints them, and
// `lib/cron/rules.test.ts` fails the build if the shipped file has any.
import raw from "@/config/cron.json";

import { configProblems, normalizeJob } from "./rules.mjs";
// The IDS, deliberately — not `./jobs`. That module pulls in the database and
// every job's dependencies, and `instrumentation.ts` reads this file to decide
// whether to start a timer at all. See lib/cron/ids.mjs.
import { JOB_IDS } from "./ids.mjs";

export interface JobSettings {
  enabled: boolean;
  everyMinutes: number;
  /** Whatever else the job's entry carries — `retentionMonths` and friends. */
  [key: string]: unknown;
}

const config = raw as { enabled?: boolean; jobs?: Record<string, unknown> };

/**
 * Is the IN-APP scheduler running?
 *
 * `false` does not mean "nothing runs" — it means nothing runs *by itself*.
 * `/api/cron` and `node run.mjs cron` still work, which is exactly the setup
 * for an Operator whose host has its own scheduler and wants it to decide the
 * hour. `docs/cron.md` calls that the second path and spells it out.
 */
export function schedulerEnabled(): boolean {
  return config.enabled !== false;
}

/**
 * One job's settings: the file's entry over the defaults.
 *
 * `enabledByDefault` is passed by the caller that has the job in hand — see
 * `normalizeJob()` for why a job may ship off. This file cannot look it up
 * itself: it must stay free of the job BODIES (`instrumentation.ts` reads it and
 * is built for the edge runtime too), which is the whole reason `ids.mjs` exists
 * apart from `jobs.ts`.
 */
export function jobSettings(id: string, enabledByDefault = true): JobSettings {
  return normalizeJob(config.jobs?.[id], enabledByDefault) as JobSettings;
}

/** Everything wrong with the file — empty when it is coherent. */
export function cronConfigProblems(): string[] {
  return configProblems(config, [...JOB_IDS]);
}
