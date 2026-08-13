// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The closing line of `db-migrate` says how many module chains ran, and this is
// where that number comes from.
//
// It is answerable without a database on purpose: which modules bring a chain is
// a property of the manifests, so the tree itself can be asked. What a database
// would add — that the chains really applied — is `scripts/deploy-test.mjs`'s
// module profile, one rung further out.
import { describe, expect, it } from "vitest";
import { chainSummary, migrationChains } from "./migration-plan.mjs";
import { availableModules, loadModules } from "../modules/registry.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;

describe("which of this tree's modules bring a migration chain", () => {
  // Every module in the tree, not the installed list: `config/modules.json`
  // ships EMPTY, so asking the app's own arrangement would ask nothing at all.
  // `loadModules(root, ids)` is the second parameter's documented purpose.
  const records = loadModules(ROOT, availableModules(ROOT));
  const chainIds = migrationChains(records).map((record) => record.id);

  it("found modules to judge", () => {
    // Non-vacuity: an empty read makes every assertion below pass by silence.
    expect(records.length).toBeGreaterThan(0);
  });

  it("🚨 a chain is exactly a module that holds tables of its own", () => {
    // Not a list of ids — the DERIVATION. `manifest.mjs` refuses `tables`
    // without `migrations`, so the two questions are one question, and a module
    // that grows tables later joins this set without anybody editing a test.
    for (const record of records) {
      const tables = record.manifest.tables;
      const holdsTables = Array.isArray(tables) && tables.length > 0;
      expect(chainIds.includes(record.id), `${record.id} declares tables: ${holdsTables}`).toBe(
        holdsTables,
      );
    }
  });

  it("the tree still holds a module WITHOUT a chain — otherwise this asks nothing", () => {
    // The probe. While every module carries a chain, counting the modules and
    // counting the chains give the same number, and the defect this file exists
    // for is invisible either way. Today `companion` is the one: it declares no
    // table, so it is announced by no `>> Migrating module` line.
    //
    // If this ever goes red because the last chainless module gained tables,
    // the answer is not to delete it: it is that the real tree can no longer
    // tell the two counts apart, and the fixtures below are then the only
    // measurement left.
    expect(records.length - chainIds.length).toBeGreaterThan(0);
  });
});

describe("the closing line counts chains, not modules", () => {
  const record = (id: string, migrations?: string) => ({
    id,
    dir: `modules/${id}`,
    manifest: migrations === undefined ? {} : { migrations },
  });

  it("leaves out a module that brings no chain", () => {
    const chains = migrationChains([record("with-tables", "drizzle"), record("no-tables")]);
    expect(chains.map((r) => r.id)).toEqual(["with-tables"]);
  });

  it("keeps every module that DOES bring one, in order", () => {
    // The counter-test. A filter that went too far would satisfy the assertion
    // above just as well by returning nothing at all.
    const chains = migrationChains([
      record("a", "drizzle"),
      record("no-tables"),
      record("b", "drizzle"),
    ]);
    expect(chains.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("says what actually ran", () => {
    expect(chainSummary(4)).toBe("✓ Database is up to date (core + 4 module chain(s)).");
    expect(chainSummary(1)).toBe("✓ Database is up to date (core + 1 module chain(s)).");
  });

  it("an app whose modules bring no chain gets the core-only line", () => {
    // Honest rather than tidy: only the core chain was applied, so the sentence
    // is the one a core-only app prints.
    expect(chainSummary(0)).toBe("✓ Database is up to date.");
  });
});
