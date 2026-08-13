#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Delete IPN-log rows older than the retention window (default 60 days).
//
// The IPN log (ipn_events) keeps the full raw payload for diagnostics, which is
// buyer PII — so it is not kept forever. This is the offline twin of the cron
// endpoint (/api/cron/prune-ipn-log): same deletion, but straight against the
// database, so it works from a system crontab or a one-off `node run.mjs db-prune-ipn`
// without the app running.
//
// Usage:
//   node scripts/db/prune-ipn-log.mjs            # delete rows older than 60 days
//   node scripts/db/prune-ipn-log.mjs --days 30  # a different window
//   Via the runner:  node run.mjs db-prune-ipn   (or: … db-prune-ipn --days 30)
import "../lib/env.mjs";
import { connectUtc } from "../lib/pg-utc.mjs";

const argv = process.argv.slice(2);
const daysArg = argv.indexOf("--days");
const retentionDays =
  daysArg >= 0 ? Number(argv[daysArg + 1]) : 60;
if (!Number.isFinite(retentionDays) || retentionDays < 0) {
  console.error("ERROR: --days must be a non-negative number.");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set (see .env).");
  process.exit(2);
}

const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

const sql = connectUtc(url, { max: 1 });
try {
  // 🚨 `sql.typed.utcTimestamp(...)` and never a bare `${cutoff}`. A `Date` is
  // typed timestamptz on the wire, `received_at` is `timestamp`, and Postgres
  // resolves that comparison by casting the COLUMN into the database session's
  // zone — measured against a Postgres at `timezone='Europe/Berlin'`, this
  // delete took rows 30 and 90 minutes INSIDE the window with it.
  // `scripts/lib/pg-utc.mjs` carries the measurement and refuses the bare form.
  const deleted = await sql`
    delete from ipn_events
    where received_at < ${sql.typed.utcTimestamp(cutoff)}
    returning id`;
  console.log(
    `✓ Pruned ${deleted.length} IPN-log entr${deleted.length === 1 ? "y" : "ies"} older than ${retentionDays} days (before ${cutoff.toISOString()}).`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
