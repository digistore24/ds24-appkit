#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Applies the pending migrations from drizzle/ to the database in DATABASE_URL.
//
// Usage:  npm run db:migrate      (or: node run.mjs db-migrate)
//
// WHY THIS IS NOT `drizzle-kit migrate`. It used to be, and it works on a
// developer machine — where `node_modules` holds everything. It stops working
// at the one moment it matters most: the first deploy. `drizzle-kit` is a
// devDependency, and the hosts this template targets throw those away between
// the build and the running container (Fly's generated Dockerfile runs
// `npm prune --omit=dev`, Railway and Render build the same way). The command
// this project's own DEPLOY.md tells you to run in production would then answer
// `drizzle-kit: not found` — and the app comes up against a database with no
// tables in it.
//
// The migrator underneath is the same one drizzle-kit calls, and it lives in
// `drizzle-orm`, which IS a runtime dependency: same journal table
// (`drizzle.__drizzle_migrations`), same hashes, same files. So this is not a
// second way to migrate — it is the same way, reachable from a production
// image. A database migrated by either can be migrated by the other.
//
// It stays deliberately dumb: no schema comparison, no generation, no push. It
// reads drizzle/ and applies what has not run yet. Creating migrations remains
// `node run.mjs db-generate` (drizzle-kit, developer machine, never here).
import "../lib/env.mjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectUtc } from "../lib/pg-utc.mjs";

import { diagnose, rootCause } from "./migrate-report.mjs";
import { chainSummary, migrationChains } from "./migration-plan.mjs";
import { loadModules } from "../modules/registry.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "ERROR: DATABASE_URL is not set.\n" +
      "  Locally it comes from .env (node run.mjs setup writes one).\n" +
      "  At a host it is the connection string of the managed Postgres —\n" +
      "  see docs/DEPLOY.md.",
  );
  process.exit(2);
}

// `max: 1` because a migration is a sequence, not a workload: several
// connections would let two statements of the same migration land in different
// sessions. It is also the polite thing to do against a small managed Postgres,
// where the pool this app normally opens (10) may be a noticeable share of the
// plan's connection limit while a release command runs alongside the old
// version of the app.
const sql = connectUtc(url, { max: 1, onnotice: () => {} });

/**
 * What the database looked like when the migration hit the wall.
 *
 * Two numbers, handed to `diagnose()` as evidence — that file carries the
 * reasoning about what they may and may not be read to mean. Both queries
 * swallow their own error on purpose: this runs on a connection that has just
 * failed, and a survey that throws would replace the real error with its own.
 */
async function survey() {
  const count = async (query) => {
    try {
      const [row] = await query;
      return Number(row.n);
    } catch {
      return null;
    }
  };
  return {
    applied: await count(sql`select count(*)::int as n from drizzle.__drizzle_migrations`),
    tables: await count(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    ),
  };
}

try {
  const target = (() => {
    try {
      const { hostname, pathname } = new URL(url);
      return `${hostname}${pathname}`;
    } catch {
      return "(unreadable DATABASE_URL)";
    }
  })();
  console.log(`>> Migrating ${target}`);
  const db = drizzle(sql);

  // The core chain first, always.
  await migrate(db, { migrationsFolder: "drizzle" });

  // ── Then one chain per installed module ───────────────────────────────────
  //
  // Each module carries its own migration folder AND its own journal table, so
  // the chains are independent: a module can be installed into an app whose
  // core chain is already far ahead, and its own `0000` still runs.
  //
  // 🚨 That independence is the whole reason for a second journal. drizzle's
  // migrator applies a migration only when it is YOUNGER than the newest one
  // already recorded (`pg-core/dialect.cjs`). Sharing one journal would mean a
  // module installed later has its migrations silently skipped for ever —
  // there is no error, the tables simply never appear.
  //
  // Core first is not cosmetic either: a module's tables carry foreign keys to
  // `users` and `media`, and those must exist before the constraint is created.
  //
  // ⚠️ Not every installed module brings a chain — only one that declares
  // `migrations`, which `scripts/modules/manifest.mjs` ties to having tables of
  // its own. So the list is narrowed ONCE, here, and the closing line counts
  // the same array the loop walked; counting `loadModules()` instead reported
  // five chains over four `>> Migrating module` lines. See `migration-plan.mjs`.
  const chains = migrationChains(loadModules());
  for (const mod of chains) {
    console.log(`>> Migrating module "${mod.id}"`);
    await migrate(db, {
      migrationsFolder: `${mod.dir}/${mod.manifest.migrations}`,
      migrationsTable: mod.manifest.migrationsTable,
    });
  }

  console.log(chainSummary(chains.length));
} catch (error) {
  // The message matters more than the stack here: this runs in a deploy log
  // that somebody reads once, in a hurry, without the repository in front of
  // them. So: the REASON first, then the statement it happened on, then — where
  // the state of the database says something the error cannot — why.
  const { error: cause, query, code } = rootCause(error);
  console.error(`✗ Migration failed: ${cause?.message ?? error.message}`);
  if (query) console.error(`  While running: ${query.split("\n")[0].trim()}`);
  const why = diagnose({ code, url, ...(await survey()) });
  if (why) console.error(why);
  process.exit(1);
} finally {
  await sql.end();
}
