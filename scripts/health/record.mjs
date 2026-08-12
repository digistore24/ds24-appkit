// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where the deployed app last stood, in numbers — `.dev/health-check.json`.
//
// The twin of `scripts/security/verdict.mjs`, and deliberately the same SHAPE:
// Epic 37's "when did the gates last run" reads records and Story 31.3's
// greeting reads records, and one shape for both is why they can. A producer
// that swallows its own errors, and a reader that answers `null` to everything
// it does not fully understand.
//
// 🚨 **Numbers and probe states only. Never an address, a finding's title, a
// path or its evidence.** Not for size: this same shape is what a scheduled job
// would write into `cron_runs.lastDetail`, which `docs/cron.md` restricts to
// *"one line of NUMBERS — no address, no member id, no text anybody typed"*. A
// record carrying `"where": "https://app.example.com"` is a record that cannot
// make that journey. The findings live in the terminal output and in `--json`.
//
// `.dev/` is gitignored and is deliberately not copied into a new git worktree:
// a fresh worktree has never checked anything, and "never checked" is the honest
// answer there.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RECORD_VERSION, recordIsStale } from "../security/rules.mjs";

// Resolved from this file, never from the cwd. `scripts/ds24/_approval.mjs`
// records what the cwd-relative form cost there: a script run from another
// folder wrote and then deleted a cache that was never where it was looking.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const HEALTH_RECORD_PATH = join(PROJECT_ROOT, ".dev", "health-check.json");

/**
 * Note what was measured.
 *
 * Swallows its own errors — a read-only `.dev/`, a full disk. Failing the health
 * check over a note ABOUT the health check would take away the thing that
 * worked in order to protect the record of it. Nothing here writes atomically;
 * the answer to a torn write is on the read side.
 */
export function writeHealthRecord(record) {
  try {
    mkdirSync(dirname(HEALTH_RECORD_PATH), { recursive: true });
    writeFileSync(HEALTH_RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    /* then the next run simply measures again */
  }
  return record;
}

/**
 * The record, or null.
 *
 * Null for every one of: no file, no `.dev/`, half-written JSON, a `version`
 * this code does not know, and a record older than the staleness bound. The same
 * "null on anything" contract `readVerdict()` and `readStamp()` keep — this is
 * read by things that run in front of somebody's session, where "I do not know"
 * has to be a normal answer rather than a stack trace.
 */
export function readHealthRecord(now = Date.now()) {
  try {
    const record = JSON.parse(readFileSync(HEALTH_RECORD_PATH, "utf8"));
    if (!record || typeof record !== "object") return null;
    // An unknown version is refused rather than half-read: a field that moved
    // would otherwise be reported as a zero, and a zero here reads as "clean".
    if (record.version !== RECORD_VERSION) return null;
    if (recordIsStale(record, now)) return null;
    return record;
  } catch {
    return null;
  }
}
