// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What stands between uninstalling a module and losing the ability to answer
// for its data.
//
// The module system can make a feature absent. It cannot make the ROWS absent:
// a module that ran for a year and is then uninstalled leaves its tables behind
// with everything members wrote in them, and the app can no longer name them in
// a subject access request. That is a worse position than the hand-edited
// version this whole system replaces.
//
// There is no code-level fix for it, only a product decision, and this file is
// that decision:
//
//   **A module is chosen before the first row is written, never after.**
//
// So `module remove` looks in the database first. Empty is the only state in
// which uninstalling is a decision about CODE; anything else makes it a
// decision about DATA, and those are taken deliberately or not at all.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { connectUtc } from "../lib/pg-utc.mjs";

/**
 * How many rows each of a module's tables holds.
 *
 * @param {string} url DATABASE_URL
 * @param {readonly string[]} tables
 * @returns {Promise<{ counts: Record<string, number>, total: number }>}
 */
export async function countModuleRows(url, tables) {
  // `max: 1` and a short timeout: this runs in front of a destructive command
  // and must not sit on a connection.
  const sql = connectUtc(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    const counts = {};
    let total = 0;
    for (const table of tables) {
      // The table may legitimately not exist — a module installed but never
      // migrated. That is zero rows, not an error.
      const [{ exists }] = await sql`
        select exists (
          select from information_schema.tables
          where table_schema = 'public' and table_name = ${table}
        ) as exists
      `;
      if (!exists) {
        counts[table] = 0;
        continue;
      }
      const [row] = await sql`select count(*)::int as n from ${sql(table)}`;
      counts[table] = Number(row.n ?? 0);
      total += counts[table];
    }
    return { counts, total };
  } finally {
    await sql.end();
  }
}

/**
 * Drop a module's tables and its migration journal.
 *
 * The journal goes too, and that is not tidiness: without it a module
 * re-installed later would have its own `0000` considered "already applied",
 * and its tables would never come back — silently, which is the failure mode
 * this whole design is built around.
 *
 * @param {string} url
 * @param {readonly string[]} tables
 * @param {string} journal
 */
export async function dropModuleTables(url, tables, journal, types = []) {
  const sql = connectUtc(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    // One transaction: half-dropped is a state nobody can reason about.
    await sql.begin(async (tx) => {
      for (const table of tables) {
        await tx`drop table if exists ${tx(table)} cascade`;
      }
      // 🚨 The TYPES too, and this was missing until the first module with an
      // enum column existed. A `CREATE TYPE` is not undone by dropping the
      // table that used it, so the type survived the uninstall — and the next
      // `module add` + `db-migrate` failed on `CREATE TYPE ... AS ENUM`, with a
      // Postgres error and no hint that an uninstall had left it behind.
      //
      // ⚠️ NOT `cascade`, deliberately. A plain `drop type` refuses while any
      // column still uses it, which is exactly the safety wanted here: if
      // something outside this module adopted the type, the uninstall must fail
      // loudly rather than quietly take a column with it. `if exists` covers
      // the ordinary case of a module whose chain never ran.
      for (const type of types) {
        await tx`drop type if exists ${tx(type)}`;
      }
      if (journal) {
        // drizzle keeps its journal in the `drizzle` schema.
        await tx`drop table if exists drizzle.${tx(journal)}`;
      }
    });
  } finally {
    await sql.end();
  }
}

/**
 * The enum types a module's own migrations create.
 *
 * Read out of its SQL rather than declared in the manifest, and that is the
 * point: the manifest would be a second place to keep in step, and the one that
 * goes stale is always the one a human maintains. The chain is generated from
 * the schema, so this reads the same truth the database was built from.
 *
 * @param {string} dir the module's migrations folder
 * @returns {string[]}
 */
export function moduleTypes(dir) {
  const found = new Set();
  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  } catch {
    return [];
  }
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/CREATE TYPE "public"\."([^"]+)"/gi)) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * Tables in the database whose prefix belongs to a module that is NOT
 * installed — data the app is holding and can no longer answer for.
 *
 * The backstop for the case the gate above cannot cover: somebody removed a
 * module by editing `config/modules.json` by hand, or restored an old copy of
 * it. Reported by `node run.mjs module check`, so it is an alarm rather than a
 * silence.
 *
 * @param {string} url
 * @param {readonly string[]} installedPrefixes prefixes of INSTALLED modules
 * @param {readonly string[]} knownPrefixes prefixes of every module present in the tree
 * @returns {Promise<string[]>}
 */
export async function orphanTables(url, installedPrefixes, knownPrefixes) {
  const dormant = knownPrefixes.filter((p) => !installedPrefixes.includes(p));
  if (dormant.length === 0) return [];

  const sql = connectUtc(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    const rows = await sql`
      select table_name from information_schema.tables where table_schema = 'public'
    `;
    return rows
      .map((r) => r.table_name)
      .filter((name) => dormant.some((prefix) => name.startsWith(prefix)))
      .sort();
  } finally {
    await sql.end();
  }
}
