// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The Postgres client every bare-Node script opens — with this app's own
// meaning of a `timestamp` on it.
//
// ── What this is for ──────────────────────────────────────────────────────
// Every date column in this app is `timestamp` (OID 1114) — **no time zone
// anywhere in the tree**, and the value in it is UTC. Inside the app drizzle
// converts at the column and both directions are right. A bare postgres.js
// client has no column to convert at, and its defaults are wrong here in BOTH
// directions:
//
//   reading   the driver hands `"2026-08-11 09:13:47.14"` to `new Date(...)`,
//             which V8 reads in the PROCESS's zone. On a host at UTC+2 every
//             timestamp a script reads is two hours early.
//
//   writing   `inferType()` types a `Date` as OID **1184** (timestamptz), so
//             `where received_at < ${cutoff}` becomes `timestamp < timestamptz`
//             — and Postgres resolves that by casting the COLUMN into the
//             DATABASE SESSION's zone. Measured on Postgres 16 with the
//             database at `timezone='Europe/Berlin'`: `node run.mjs db-prune-ipn
//             --days 1` deleted 4 of 4 seeded rows where 2 were outside the
//             window — the two inside it were 30 and 90 minutes young and died
//             with the rest. Under a zone WEST of UTC the same boundary spares
//             rows that should have gone. Neither depends on the process's TZ,
//             which is why running the script under four different `TZ` values
//             showed nothing at all (2026-08-12, story A76).
//
// ── The two types below ───────────────────────────────────────────────────
//   `utcTimestamp`      OID 1114, both directions. Registered on every client,
//                       so READING is correct with no call site knowing.
//                       WRITING is `sql.typed.utcTimestamp(date)` — postgres.js
//                       has no hook that could type a bare `${date}` as 1114
//                       (`inferType` is a module constant), so the boundary has
//                       to say it.
//   `timestamptzRefused` OID 1184, serialize only: it THROWS. There is no
//                       `timestamptz` column in this tree — not in `db/*.ts`,
//                       not in any migration — so a 1184 parameter is always a
//                       mistake here, and this turns the silent wrong deletion
//                       above into a refusal that names its own fix. That is
//                       the safe direction for commands whose mistake cannot be
//                       undone.
//
// ⚠️ The refusal is the guard that a source scanner cannot be: what is dangerous
// is the TYPE of an interpolated value, and source text has none (the reasoning
// is in `db/sql-date-param.test.ts`). Here the type exists — at bind time — so
// the question is asked where it can be answered exactly.
//
// Bare Node, like everything else under `scripts/`: no TypeScript, no bundler.
import postgres from "postgres";

/** `2026-08-11T09:13:47.140Z` → `2026-08-11 09:13:47.140`, the wire form of a UTC `timestamp`. */
export function utcTimestampWire(date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/** `2026-08-11 09:13:47.14` → the instant it means, read as UTC and never as local. */
export function utcTimestampFromWire(text) {
  return new Date(text.replace(" ", "T") + "Z");
}

/**
 * The message the refusal carries. Exported so the guard can assert the fix is
 * NAMED rather than merely that something threw — an error nobody can act on is
 * a second puzzle, not a guard.
 */
export const TIMESTAMPTZ_REFUSAL =
  "A Date bound into raw SQL is typed as timestamptz (OID 1184), and every date " +
  "column in this app is `timestamp` — Postgres would then convert the COLUMN in " +
  "the database session's zone, which moves the boundary by the server's offset. " +
  "Bind it as sql.typed.utcTimestamp(value) instead. See scripts/lib/pg-utc.mjs.";

/** The `types` option every client in this tree carries. */
export const UTC_TYPES = {
  utcTimestamp: {
    to: 1114,
    from: [1114],
    serialize: (value) =>
      value instanceof Date ? utcTimestampWire(value) : String(value),
    parse: (value) => utcTimestampFromWire(value),
  },
  timestamptzRefused: {
    // No `from`: the READ side of 1184 keeps postgres.js's own parser, which is
    // right — a timestamptz on the wire carries its offset. Only the write side
    // is a mistake, and only the write side is refused.
    to: 1184,
    serialize: () => {
      throw new TypeError(TIMESTAMPTZ_REFUSAL);
    },
  },
};

/**
 * Open a Postgres client for a script.
 *
 * The same signature as `postgres()` — pass whatever options the caller needs;
 * `types` is merged, so a caller may add one without losing these.
 */
export function connectUtc(url, options = {}) {
  return postgres(url, {
    ...options,
    types: { ...UTC_TYPES, ...(options.types ?? {}) },
  });
}
