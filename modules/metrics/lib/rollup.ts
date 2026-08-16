// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Turning milestones into days — the step that lets the personal half be
// deleted while the curve survives.
//
// The query itself lives in `./queries.mjs`, because the command
// `node run.mjs metrics-report` is bare Node and needs the same one. What is
// here is the window: how far back a run recomputes, and why.
//
// ── Why the last few days and not only yesterday ───────────────────────────
// A day is recomputed, never accumulated, so re-running is free and correcting
// is automatic: a row that arrived late, a run skipped while the app was down, a
// redeploy in the middle of the night. `ROLLUP_WINDOW_DAYS` is how far back that
// self-correction reaches.
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { rollupQuery } from "./queries.mjs";

/** How many days back each run recomputes. Cheap, and it repairs itself. */
export const ROLLUP_WINDOW_DAYS = 3;

/**
 * Recompute the last `days` days of `metrics_daily` from `metrics_events`.
 *
 * @returns how many day/event/variant rows were written or refreshed.
 */
export async function rollup(now: Date, days: number = ROLLUP_WINDOW_DAYS): Promise<number> {
  // Calendar days back from the start of today in UTC — not `n * 86_400_000`
  // from now, which would leave a partial first bucket and drift by an hour
  // twice a year.
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - Math.max(0, days - 1)),
  );

  const result = await db.execute(rollupQuery(sql, from.toISOString().slice(0, 10)));

  // postgres.js reports affected rows as `count` on the result list — not
  // `rowCount`, which is node-postgres' name for the same thing. For an
  // INSERT … ON CONFLICT it is rows inserted plus rows updated.
  return typeof result?.count === "number" ? result.count : 0;
}
