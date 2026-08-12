// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a scheduled job IS — the contract, apart from the registry.
//
// Same division as `lib/modules/types.ts` beside the generated
// `lib/modules/registry.ts`: the generator produces the LIST, a hand-written
// file produces the shape. Here it is not a generator that needs the split but a
// cycle: `lib/cron/jobs.ts` holds the core's jobs AND folds in every installed
// module's, so it imports `lib/modules/cron-registry.ts`, which imports a
// module's `cron.ts`, which needs to say what a job looks like. A module
// importing that from `jobs.ts` would close the loop.
//
// The interfaces are re-exported from `jobs.ts`, so nothing that already imports
// them there has to change.
//
// The four rules a job lives by are in `jobs.ts`, where the jobs are — this file
// is only the shape.

export interface CronContext {
  /** The clock the whole tick reasons about — never `new Date()` inside a job. */
  now: Date;
  /** This job's entry from `config/cron.json`, over the defaults. */
  settings: Record<string, unknown>;
}

export interface CronJob {
  id: string;
  /** One line for `node run.mjs cron --list`. Not translated — Operator tooling. */
  describe: string;

  /**
   * Does this job run when `config/cron.json` says nothing about it? Omit for
   * `true`, which is what every core job wants.
   *
   * 🚨 It exists because leaving a job OUT of that file is not "off" — a job with
   * no entry inherits `JOB_DEFAULTS`, which is enabled and daily. So a job that
   * must not start running the day it arrives has to say so somewhere, and a
   * MODULE cannot say it in `config/cron.json`: that file belongs to the core, and
   * an entry there would name a job that every app without the module does not
   * have. `modules/community/cron.ts` is the shipped example — it deletes members'
   * correspondence and their moderation trail, so it arrives off and the
   * operator's `"enabled": true` is a decision rather than a default.
   *
   * The operator's file wins in both directions; only its silence consults this.
   */
  enabledByDefault?: boolean;

  /** Returns one line of numbers for `cron_runs.lastDetail`. Throws on failure. */
  run(ctx: CronContext): Promise<string>;
}
