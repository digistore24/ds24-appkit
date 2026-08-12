// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What `node run.mjs db-migrate` SAYS when it fails — as pure functions, so the
// wording can be measured without a database.
//
// This is the half of `migrate.mjs` that is hard to get right and impossible to
// see: a migration that fails runs in a deploy log somebody reads once, in a
// hurry, without the repository in front of them. If the sentence is wrong there
// is no second chance and no test that would have noticed — which is exactly how
// the failure this file was written for stayed a mystery for an afternoon.
//
// The mechanics live next door in `migrate.mjs`; only the reading of an error
// and the choosing of words are here.

/**
 * The innermost error, and the query that produced it.
 *
 * 🚨 `error.message` on its own is NOT the reason a migration failed. Drizzle
 * wraps the driver's error in a `DrizzleQueryError` whose message is the SQL it
 * tried to run — the sentence a person actually needs (`type … already exists`,
 * `relation … does not exist`, `permission denied`) sits one level down in
 * `.cause`. Printing only the top message is how a deploy log ends up saying
 *
 *     ✗ Migration failed: Failed query: CREATE TYPE "public"."ipn_result" …
 *
 * which names the statement and withholds the diagnosis. Measured on a real
 * first start, and the reason nobody could tell what was wrong.
 */
export function rootCause(error) {
  let current = error;
  let query = null;
  // `cause === current` guards a self-referential chain rather than looping on it.
  while (current) {
    if (typeof current.query === "string") query = current.query;
    if (!current.cause || current.cause === current) break;
    current = current.cause;
  }
  return { error: current, query, code: current?.code ?? null };
}

/**
 * Is this a local database — one a person may wipe without asking anybody?
 *
 * `[::1]` with the brackets, because that is what `URL.hostname` hands back for
 * an IPv6 literal; the bare form is in the list only so a caller that has
 * already stripped them gets the same answer. Anything this cannot parse counts
 * as NOT local: the one thing this decides is whether to offer `db-nuke`, and an
 * unreadable connection string is not grounds for offering to delete a database.
 */
export function isLocal(connection) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(connection).hostname);
  } catch {
    return false;
  }
}

// 42P07 duplicate_table · 42710 duplicate_object (an enum, a constraint) ·
// 42P06 duplicate_schema. All three mean: it is already there.
const DUPLICATE = ["42P07", "42710", "42P06"];

/**
 * The paragraph under the error message — "" when there is nothing honest to
 * add, because a guess dressed up as a diagnosis is worse than the bare error.
 *
 * 🚨 **An empty migration journal is NOT the signal, and assuming it was is how
 * the first version of this got it wrong.** The foreign database that produced
 * this whole feature was itself built from this template: 28 tables AND 38
 * recorded migrations, all of them its own. A stranger's database is routinely a
 * perfectly migrated one — it is only a stranger to THIS chain. So the journal
 * count is printed as evidence and never used as a gate.
 *
 * `applied` may also be null rather than 0, and that is not a failure either:
 * the migrator creates its journal inside the same transaction as the first
 * migration, so a first migration that fails takes the journal table with it and
 * there is nothing left to count.
 *
 * `tables` is the one thing that IS a gate — it is the proof that the survey
 * reached the database at all. Without it, "I could not look" goes out as a
 * finding.
 */
export function diagnose({ code, applied, tables, url }) {
  if (!DUPLICATE.includes(code) || !tables) return "";

  const journal = applied === null ? "no migration journal at all" : `${applied} recorded`;
  return (
    `\n  Creating that object is what the migration above is FOR, and it is already\n` +
    `  there — so what is in this database did not come out of the chain in\n` +
    `  drizzle/. (${tables} table(s) in it, ${journal}.)\n\n` +
    `  Usually the database belongs to another app. Two ways in, and the first\n` +
    `  one reaches production too:\n\n` +
    `    · DATABASE_URL points at it. Check the line in .env — every app from\n` +
    `      this template uses the credentials app/app/app, so they fit each other.\n` +
    `    · The local Docker volume was inherited from an older project in a\n` +
    `      folder of the same name. See docs/troubleshooting.md →\n` +
    `      "The database that belonged to another app".\n\n` +
    (isLocal(url)
      ? `  If this IS your own local database and holds nothing you want to keep:\n` +
        `     node run.mjs db-nuke && node run.mjs start\n`
      : `  This is not a local database — never wipe it on a hunch. If it really is\n` +
        `  this app's own and the chain was regenerated after it had been applied,\n` +
        `  the answer is a new, correcting migration (docs/database.md).\n`)
  );
}
