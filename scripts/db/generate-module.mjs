#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs db-generate --module <id>` — a migration for ONE module.
//
// The golden path in CLAUDE.md is "change the schema, run `db-generate`". This
// keeps that sentence true for a module: it changes `modules/<id>/schema.ts` and
// gets a migration in `modules/<id>/drizzle/`, with the module's own journal.
// A module whose migrations had to be hand-written SQL would fork the one
// instruction the whole guide is built around.
//
// ── Why this needs no `tablesFilter` ───────────────────────────────────────
// Measured before this was built: drizzle-kit registers the `pgTable` objects
// the ENTRY FILE exports, and a module's `schema.ts` imports `users` and
// `media` for its foreign keys without re-exporting them. So pointing the
// config at the module's schema is the whole filter — the generated SQL creates
// the module's tables and references the core's without touching them.
//
// The rule that keeps it true is in `modules/boundary.test.ts`: a module's
// schema must not re-export a core table.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readModule } from "../modules/registry.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--module");
const id = at === -1 ? null : args[at + 1];

if (!id) {
  console.error("Usage: node run.mjs db-generate --module <id>\n");
  console.error("  Without --module, `db-generate` works on the core schema (db/schema.ts).");
  process.exit(2);
}

let record;
try {
  record = readModule(id);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

const { manifest, dir } = record;
if (typeof manifest.schema !== "string" || typeof manifest.migrations !== "string") {
  console.error(
    `✗ "${id}" declares no schema or no migrations folder, so there is nothing to generate.\n` +
      `  A module with tables declares both — see docs/modules.md.`,
  );
  process.exit(1);
}

// The config is written to a throwaway file rather than kept in the repo: it is
// a function of the manifest, and a checked-in copy is one more thing that can
// disagree with it.
//
// ⚠️ Inside `.dev/` and NOT the operating system's temp folder. A config in
// /tmp cannot resolve `drizzle-kit` — Node looks for `node_modules` upwards
// from the FILE, and there is none above /tmp. Found by running it; the failure
// is a bare "Cannot find module 'drizzle-kit'" that says nothing about why.
// `.dev/` is gitignored and already this project's scratch folder.
mkdirSync(".dev", { recursive: true });
const tmp = mkdtempSync(join(".dev", `drizzle-${id}-`));
const configPath = join(tmp, "drizzle.config.mjs");
writeFileSync(
  configPath,
  `import { defineConfig } from "drizzle-kit";\n` +
    `export default defineConfig({\n` +
    `  dialect: "postgresql",\n` +
    `  schema: "./${dir}/${manifest.schema}",\n` +
    `  out: "./${dir}/${manifest.migrations}",\n` +
    `  migrations: { table: ${JSON.stringify(manifest.migrationsTable)} },\n` +
    `  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x" },\n` +
    `});\n`,
);

try {
  const result = spawnSync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "generate", `--config=${configPath}`],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log(
    `\n✓ Written to ${dir}/${manifest.migrations}/.\n` +
      `  Read the SQL before applying it, then \`node run.mjs db-migrate\` — that runs the\n` +
      `  core chain first and every module chain after it, each with its own journal.`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
