// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// GENERATED — do not edit. Run `node run.mjs module sync`.
//
// Every installed module's scheduled jobs, in the order they were installed.
// Its content is a function of config/modules.json and the manifests under
// modules/. `scripts/modules/generated.test.ts` fails the build when this
// file and those stop agreeing.

import type { CronJob } from "@/lib/cron/types";

export const MODULE_CRON_JOBS: readonly CronJob[] = [];
