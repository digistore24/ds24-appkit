// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where this app last stood, in numbers — `.dev/security-check.json`.
//
// One small file, on the same pattern as `scripts/dev/setup-stamp.mjs`: a
// producer that swallows its own errors and a reader that answers `null` to
// everything it does not fully understand. It exists so that "has anybody
// checked this app, and when?" has an answer without running the whole ladder
// again — and so that a later reader (a greeting line, a scheduled job) has one
// datum to read rather than a second opinion to invent.
//
// It carries NUMBERS AND RUNG STATES ONLY. What goes in it and why is argued in
// `recordFrom()` over in ./rules.mjs; this file is the disk half and nothing
// else. No formatting, no sentences: whoever prints a line from this record
// writes that line themselves.
//
// `.dev/` is gitignored, is not copied into a new git worktree, and is exactly
// the right place for this: a fresh worktree has never been checked, and "never
// checked" is the honest answer there.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RECORD_VERSION, recordIsStale } from "./rules.mjs";

// Resolved from this file, never from the cwd. `scripts/ds24/_approval.mjs`
// records what the cwd-relative form cost there: a script run from another
// folder wrote and then deleted a cache that was never where it was looking.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const VERDICT_PATH = join(PROJECT_ROOT, ".dev", "security-check.json");

/**
 * Note what was measured.
 *
 * Swallows its own errors — a read-only `.dev/`, a full disk. Failing the
 * security check over a note ABOUT the security check would take away the thing
 * that worked in order to protect the record of it. Nothing here writes
 * atomically; the answer to a torn write is on the read side, and
 * `readVerdict()` returning null for unparseable JSON is that answer.
 */
export function writeVerdict(record) {
  try {
    mkdirSync(dirname(VERDICT_PATH), { recursive: true });
    writeFileSync(VERDICT_PATH, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    /* then the next run simply measures again */
  }
  return record;
}

/**
 * The record, or null.
 *
 * Null for every one of: no file, no `.dev/`, half-written JSON, a `version`
 * this code does not know, and a record older than the staleness bound. The
 * same "null on anything" contract `readStamp()` and `readApprovalCache()`
 * keep — this is read by things that run in front of somebody's session, where
 * "I do not know" has to be a normal answer rather than a stack trace.
 */
export function readVerdict(now = Date.now()) {
  try {
    const record = JSON.parse(readFileSync(VERDICT_PATH, "utf8"));
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

/**
 * The same file, read as a STATE rather than as a record.
 *
 * `readVerdict()` above answers `null` to four different situations — no file,
 * a file that cannot be parsed, a `version` this code does not know, and a
 * record past `MAX_RECORD_AGE`. That is the right contract for a caller asking
 * *"what were the numbers"*: "I do not know" is one answer and needs one shape.
 *
 * 🚨 It is the wrong contract for a caller whose whole job is to tell those
 * situations apart — the session greeting's operational line
 * (`scripts/dev/operations.mjs`). "Nobody has ever run this here" and "somebody
 * ran it nine days ago" lead to the same command but to very different
 * confidence, and flattening them is precisely the silence this record exists to
 * end. So this is ADDITIVE and `readVerdict()` is left exactly as it is: it is
 * shipped, and its "null on anything" contract is what later readers rely on.
 *
 * Four states, and the boundary between the first two is the one that matters:
 *
 *   missing     an `ENOENT` — no file, or no `.dev/` at all. The ONLY state
 *               that is evidence nobody has looked.
 *   unreadable  anything else: unparseable JSON, a non-object, a `version` this
 *               code does not know, a directory where a file should be, a
 *               permission error. **An unreadable record is not evidence that
 *               nobody looked** — somebody may have looked and the note got
 *               damaged, and reporting that as "never checked" would be the
 *               same flattening one level down.
 *   stale       parsed, understood, and older than `recordIsStale()` allows.
 *               The bound is imported from `rules.mjs`, never restated here.
 *   ok          parsed, understood, fresh. `record` carries it.
 *
 * `record` is the parsed object for `stale` and `ok`, and `null` otherwise —
 * there is nothing trustworthy to hand on in the other two.
 *
 * Never throws, exactly like its neighbour: this runs in front of somebody's
 * session, where an exception is printed instead of a greeting.
 *
 * @param {number} [now]
 * @returns {{ state: "missing" | "unreadable" | "stale" | "ok",
 *             record: Record<string, unknown> | null }}
 */
export function readVerdictState(now = Date.now()) {
  let text;
  try {
    text = readFileSync(VERDICT_PATH, "utf8");
  } catch (error) {
    // `ENOENT` is the file (or `.dev/`) not being there. Everything else — a
    // directory in its place, a permission error, an I/O fault — is a note we
    // could not read, which is a different fact about the world.
    return {
      state: /** @type {any} */ (error)?.code === "ENOENT" ? "missing" : "unreadable",
      record: null,
    };
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return { state: "unreadable", record: null };
  }
  if (!record || typeof record !== "object") return { state: "unreadable", record: null };
  if (record.version !== RECORD_VERSION) return { state: "unreadable", record: null };
  if (recordIsStale(record, now)) return { state: "stale", record };
  return { state: "ok", record };
}
