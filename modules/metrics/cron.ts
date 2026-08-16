// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two jobs behind the promise this module makes: the curve outlives the
// personal data it was computed from.
//
// ── Neither of them mails, and neither may ─────────────────────────────────
// 🚨 `ops-watchdog` is the ONLY producer of operational reporting in this app
// (`lib/notify/reporter-guard.test.ts` fails the build on a second caller). A
// claimed send key is spent for ever, so a second reporting job would either
// swallow the watchdog's finding or put two mails on one operator's morning.
// These two count and they return a line of numbers; nothing else.
//
// ── Both start with the switch, before any query ───────────────────────────
// A module that ships off has to COST nothing, or "off" is only a word. And it
// matters more here than usual for the second job: nothing of anybody's is
// deleted until the operator has switched this module on, which is why both
// jobs may otherwise run on the core's defaults (see below).
//
// ── Both ship DISABLED, and the operator has to turn them on ───────────────
// 🚨 A job with no entry in `config/cron.json` inherits `JOB_DEFAULTS` —
// enabled, daily — and a module may not write that file. So a module's job
// declares its own posture, and `scripts/modules/cron-default.test.ts` requires
// `enabledByDefault: false` of every one of them: a module must not start
// running work on somebody's server the moment it is installed.
//
// ⚠️ **That has a consequence this module has to say out loud.** `retentionDays`
// in the config reads like a promise, and it is not kept by anybody until
// `metrics-prune` is switched on. An operator who installs this and never edits
// `config/cron.json` keeps every milestone row for ever — and the rollup never
// runs either, so the curve that is supposed to outlive the personal data is
// never written. `docs.md` puts both lines in the setup list rather than
// leaving them to be discovered.
//
//   "metrics-rollup": { "enabled": true, "everyMinutes": 720 },
//   "metrics-prune":  { "enabled": true, "everyMinutes": 1440 }
//
// Twelve hours for the rollup rather than twenty-four, for the reason
// `docs/cron.md` gives about windowed keys: due-ness is measured from the last
// FINISH, so a daily job drifts later every day and eventually skips a calendar
// day in silence. The rollup recomputes rather than accumulates, so running it
// twice a day costs one query and repairs any drift.
//
// ⚠️ The type comes from `@/lib/cron/types`, never from `@/lib/cron/jobs` —
// that would close a cycle through the generated registry.
import type { CronJob } from "@/lib/cron/types";
import { pruneInBatches, STOPPED_EARLY_NOTE } from "@/lib/cron/prune";

import { metricsEvents } from "./schema";
import { isMetricsSwitchedOn, retentionDays } from "./lib/config";
import { rollup, ROLLUP_WINDOW_DAYS } from "./lib/rollup";

const jobs: readonly CronJob[] = [
  {
    id: "metrics-rollup",
    describe:
      `Recompute the last ${ROLLUP_WINDOW_DAYS} days of metrics_daily from metrics_events. ` +
      "Idempotent — a day is recomputed, never accumulated. " +
      'Ships DISABLED — add "metrics-rollup" to config/cron.json to run it.',

    // See the header: a module may not write config/cron.json, so no entry
    // there would mean enabled-and-daily on somebody else's server.
    enabledByDefault: false,

    async run({ now }) {
      // The narrow question on purpose, the same one `modules/courses/cron.ts`
      // asks and for the same reason: in the `brokenConfig` state the events
      // keep arriving, and a job that fell silent there would stop keeping the
      // history in exactly the state nobody is watching.
      if (!isMetricsSwitchedOn()) return "metrics is switched off — nothing rolled up";

      const rows = await rollup(now);
      return `${rows} day/event/variant row(s) recomputed over ${ROLLUP_WINDOW_DAYS} day(s)`;
    },
  },

  {
    id: "metrics-prune",
    describe:
      "Delete metrics_events rows older than the retention window in the module's config.json " +
      "(default 400 days). The rolled-up days survive — they name nobody. " +
      'Ships DISABLED — until it is in config/cron.json, nothing is ever pruned.',

    // 🚨 Disabled like its twin, and here the cost of forgetting is the sharper
    // one: personal data kept past the window the config announces.
    enabledByDefault: false,

    async run({ now }) {
      if (!isMetricsSwitchedOn()) return "metrics is switched off — nothing pruned";

      const days = retentionDays();
      // Calendar arithmetic in UTC, not `n * 86_400_000`: the second form
      // drifts by an hour twice a year and moves the cutoff with it.
      const cutoff = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days),
      );

      // 🚨 The rollup runs FIRST in a healthy schedule, and this job does not
      // wait for it: `metrics_daily` already holds every day older than the
      // window, because a day is written the day after it happened. If it did
      // not — an app whose rollup has never run — pruning would drop history
      // nobody kept. That is what the two counts in `content-check` are for:
      // events with no rolled-up days is the state to notice.
      const { deleted, stoppedEarly } = await pruneInBatches(
        { table: metricsEvents, id: metricsEvents.id, olderThan: metricsEvents.occurredAt },
        cutoff,
      );

      return (
        `${deleted} event row(s) older than ${days} day(s) deleted` +
        (stoppedEarly ? STOPPED_EARLY_NOTE : "")
      );
    },
  },
];

export default jobs;
