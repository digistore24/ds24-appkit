// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The job ids, and nothing else.
//
// ── Why this is a file of its own ─────────────────────────────────────────
// `lib/cron/jobs.ts` holds the job BODIES, so it imports `@/db`, the entitlement
// layer, the mail transport — whatever the jobs need. Anything that imports it
// inherits all of that.
//
// Two callers need only the NAMES:
//
//  • `lib/cron/config.ts`, to say which configured job does not exist. It is
//    read by `instrumentation.ts` to decide whether to start a timer at all,
//    and that hook is built for the edge runtime too — dragging the database
//    into it is the same trap `instrumentation.ts` already documents about
//    `lib/email`.
//  • `scripts/cron/run.mjs`, plain Node, which does not import TypeScript.
//
// So the names live here and `lib/cron/rules.test.ts` asserts the registry
// matches — the same deal `lib/ai/providers/ids.mjs` makes for the providers
// and `task-rules.mjs` for the AI tasks. Adding a job means adding it in two
// places, and forgetting the second is a failing test rather than a job that
// silently cannot be configured.
// The module half, generated from each installed manifest's `cronJobs`.
//
// ⚠️ The ONE import this file may have, and only because the file behind it is a
// plain array of strings with no imports of its own. This file is reached by
// `lib/cron/config.ts`, which `instrumentation.ts` reads to decide whether to
// start a timer at all, and that hook is built for the edge runtime too — the
// same reason this file exists apart from `jobs.ts` in the first place. Whatever
// `generate.mjs` writes into `cron-ids.mjs` is bound by it.
import { MODULE_JOB_IDS } from "../modules/cron-ids.mjs";

/** The core's own. Every app has these. */
const CORE_JOB_IDS = [
  "prune-ai-usage",
  "prune-ipn-log",
  "close-impersonations",
  "prune-impersonations",
  "prune-setup-audit",
  "check-stuck-reloads",
  "prune-abandoned-uploads",
  "check-advisories",
  "ops-watchdog",
];

/**
 * Every job id this app knows — the core's, then every installed module's.
 *
 * Appended rather than merged: a module's ids must start with its own id
 * (`manifest.mjs`), and `loadModules()` refuses two modules claiming one, so
 * nothing here can shadow a core job. Empty module half in a fresh app.
 */
export const JOB_IDS = [...CORE_JOB_IDS, ...MODULE_JOB_IDS];
