#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Delete AI-usage rows older than the retention window (default 365 days).
//
// `ai_usage` is the first table in this template that grows with USAGE rather
// than with customers: one row per model call, for ever. On a busy app that is
// the table that gets large, and nothing prunes it on its own.
//
// ── Why the default is a year, and not sixty days like the IPN log ─────────
// The IPN log holds raw buyer payloads — PII kept only for diagnostics, so the
// shorter the better. This table holds NO content and no personal data beyond
// the member link: it is the Operator's own cost history, and "what did AI cost
// me last November" is a question people genuinely ask. A year keeps a
// year-on-year comparison possible; shorter windows are a `--days` away.
//
// ⚠️ Deleting here deletes COST HISTORY. The AI-costs page can only report what
// is in this table, so a period that has been pruned reads as zero rather than
// as unknown. Prune deliberately, and consider exporting first if the numbers
// matter to your accounting.
//
// Usage:
//   node scripts/db/prune-ai-usage.mjs             # older than 365 days
//   node scripts/db/prune-ai-usage.mjs --days 90   # a different window
//   node scripts/db/prune-ai-usage.mjs --dry-run   # count, delete nothing
//   Via the runner:  node run.mjs db-prune-ai
import "../lib/env.mjs";
import { connectUtc } from "../lib/pg-utc.mjs";

const argv = process.argv.slice(2);
const daysArg = argv.indexOf("--days");
const retentionDays = daysArg >= 0 ? Number(argv[daysArg + 1]) : 365;
const dryRun = argv.includes("--dry-run");

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

// 🚨 The boundary travels as `sql.typed.utcTimestamp(cutoff)`, never as a bare
// `${cutoff}`: a `Date` is typed timestamptz on the wire, `created_at` is
// `timestamp`, and Postgres then casts the COLUMN into the database session's
// zone — which moves this window by the server's offset in whichever direction
// that offset points. `scripts/lib/pg-utc.mjs` has the measurement, and refuses
// the bare form rather than deleting the wrong year of cost history.
const boundary = () => sql.typed.utcTimestamp(cutoff);

try {
  if (dryRun) {
    // A preview says how much history would go AND how much money it
    // represents — "4,812 rows" is a number nobody can weigh, "4,812 rows worth
    // 18.40 USD of recorded spend" is.
    const [row] = await sql`
      select count(*)::int as rows,
             coalesce(sum(cost_micros), 0)::bigint as micros
      from ai_usage
      where created_at < ${boundary()}`;
    const spend = (Number(row.micros) / 1_000_000).toFixed(2);
    console.log(
      `Dry run: ${row.rows} row(s) older than ${retentionDays} days ` +
        `(recorded spend ${spend}, in whatever currencies those rows carry).`,
    );
    console.log("Nothing was deleted. Drop --dry-run to apply.");
  } else {
    const deleted = await sql`
      delete from ai_usage
      where created_at < ${boundary()}
      returning id`;
    console.log(
      `✓ ${deleted.length} AI-usage row(s) older than ${retentionDays} days deleted.`,
    );
  }
} finally {
  await sql.end();
}
