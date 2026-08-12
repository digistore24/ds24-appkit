// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One database, several migration chains.
//
// 🚨 The property that makes this work, and the one a "simplification" would
// remove: **each module has its own journal table.** drizzle's migrator applies
// a migration only when it is YOUNGER than the newest one already recorded
// (`pg-core/dialect.cjs`). Sharing one journal would mean a module installed
// into an app whose core chain is already ahead has its own `0000` silently
// skipped — no error, the tables simply never appear.
//
// That is the same mechanic that made the community's tables impossible to
// retrofit into existing apps, measured before any of this was built. Here it
// is designed around rather than fought.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("the migrator runs core first, then one chain per module", () => {
  const migrate = read("scripts/db/migrate.mjs");

  it("applies the core chain", () => {
    expect(migrate).toMatch(/migrationsFolder: "drizzle"/);
  });

  it("applies every installed module's own folder", () => {
    expect(migrate).toContain("for (const mod of modules)");
    expect(migrate).toMatch(/migrationsFolder: `\$\{mod\.dir\}\/\$\{folder\}`/);
  });

  it("🚨 gives each module its own journal table", () => {
    // Without this the chains are not independent and a later install is
    // silently skipped. The manifest already refuses a journal name that is not
    // `__drizzle_migrations_<id>`.
    expect(migrate).toMatch(/migrationsTable: mod\.manifest\.migrationsTable/);
  });

  it("runs the core chain BEFORE any module chain", () => {
    // A module's tables carry foreign keys to `users` and `media`; those must
    // exist before the constraint is created.
    const core = migrate.indexOf('migrationsFolder: "drizzle"');
    const loop = migrate.indexOf("for (const mod of modules)");
    expect(core).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(core);
  });

  it("keeps the deploy contract untouched", () => {
    // `npm run db:migrate` as a pre-deploy hook is "the whole contract" on all
    // four hosts. Modules must not add a step to it.
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["db:migrate"]).toBe("node scripts/db/migrate.mjs");
  });
});

describe("a module generates its migration on the golden path", () => {
  const generate = read("scripts/db/generate-module.mjs");

  it("points drizzle-kit at the module's own schema and folder", () => {
    expect(generate).toMatch(/schema: "\.\/\$\{dir\}\/\$\{manifest\.schema\}"/);
    expect(generate).toMatch(/out: "\.\/\$\{dir\}\/\$\{manifest\.migrations\}"/);
  });

  it("carries the module's journal name into the generated config", () => {
    expect(generate).toMatch(/migrations: \{ table: \$\{JSON\.stringify\(manifest\.migrationsTable\)\} \}/);
  });

  it("writes the config to a throwaway file, not into the repo", () => {
    // A checked-in per-module drizzle config is one more thing that can
    // disagree with the manifest it was derived from.
    expect(generate).toContain("mkdtempSync");
    expect(generate).toMatch(/rmSync\(tmp/);
  });

  it("is reachable as `db-generate --module`", () => {
    // The golden path in CLAUDE.md is one sentence — "change the schema, run
    // db-generate". A module whose migrations had to be hand-written SQL would
    // fork the instruction the whole guide is built around.
    const run = read("run.mjs");
    expect(run).toMatch(/args\.includes\("--module"\)/);
    expect(run).toContain("scripts/db/generate-module.mjs");
  });

  it("needs no tablesFilter, and says why", () => {
    // Measured: drizzle-kit registers the pgTable objects the ENTRY FILE
    // exports, and a module's schema imports `users`/`media` for its foreign
    // keys without re-exporting them. The entry file IS the filter.
    //
    // Comments stripped first — the file EXPLAINS why the option is absent, and
    // a test that cannot tell the code from the sentence about the code makes
    // the explanation impossible to write. (Third time this bit; the idiom is
    // `lib/privacy/export.test.ts`'s.)
    const code = blankComments(generate);
    expect(code, "the generated config sets tablesFilter").not.toContain("tablesFilter");
    expect(generate, "the reason is no longer written down").toMatch(/re-export/i);
  });
});
