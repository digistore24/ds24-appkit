// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A module's setup tools and presence check write only inside their own
// module — and this reads the files rather than trusting the sentence.
//
// The rule (spine AD-81): core tables — `users`, `grants`, `media`, `setup_*` —
// have CORE tools. A module that needs one of them calls the core's function,
// which owns the invariants; it does not reach for the table. Without this,
// two owners of one entity is a matter of somebody's afternoon: a courses
// module and the core both inserting `media` rows, with two ideas of what a
// complete one is, and no downstream test that could tell.
//
// ⚠️ It walks the FILES, not the installed set. A module's tools exist on disk
// whether or not `config/modules.json` names it, and the shipped state names
// none — a test that only looked at installed modules would pass emptily in
// every fresh clone, which is the state this template ships in.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const MODULES = join(process.cwd(), "modules");

/** Every module folder on disk, installed or not. */
function moduleIds(): string[] {
  try {
    return readdirSync(MODULES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function manifestOf(id: string): Record<string, unknown> | null {
  const file = join(MODULES, id, "module.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The declared contributor files this rule covers, per module. */
function contributorFiles(id: string): { label: string; path: string }[] {
  const manifest = manifestOf(id);
  if (!manifest) return [];
  const out: { label: string; path: string }[] = [];
  for (const key of ["setup", "presence"] as const) {
    const declared = manifest[key];
    if (typeof declared !== "string") continue;
    const path = join(MODULES, id, declared);
    if (existsSync(path)) out.push({ label: `${id}/${declared}`, path });
  }
  return out;
}

describe("a module's setup and presence files stay inside their module", () => {
  const ids = moduleIds();
  const all = ids.flatMap((id) => contributorFiles(id).map((file) => ({ id, ...file })));

  // The needle probe. A walk that silently found nothing reports green for
  // ever, and this repo has already paid for that lesson twice.
  it("finds contributor files at all", () => {
    expect(ids.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(0);
  });

  for (const { id, label, path } of all) {
    // Comments blanked FIRST — a checker that greps source punishes the file
    // that explains the rule, and `scripts/lib/source-text.mjs` is the one
    // implementation of that in this tree.
    const source = blankComments(readFileSync(path, "utf8"));

    it(`${label} does not reach the database directly`, () => {
      for (const forbidden of ['from "@/db"', 'from "@/db/schema"', 'from "@/db/']) {
        expect(
          source.includes(forbidden),
          `${label} imports ${forbidden}. A module's contributor is a THIN CALLER: it goes ` +
            `through its own lib/manage.ts, which owns the transactions and the rules. ` +
            `Reaching the tables here is the second implementation, and it is the one ` +
            `nobody looks at.`,
        ).toBe(false);
      }
    });

    it(`${label} names no core table`, () => {
      // The core tables a module might plausibly be tempted by. Named rather
      // than derived: a derived list would grow silently and this is the point
      // where growth should be noticed.
      for (const table of ["users", "grants", "media", "orders", "subscriptions", "setupAudit", "setupKeys"]) {
        expect(
          new RegExp(`\\b${table}\\b`).test(source),
          `${label} names the core table "${table}". A module that needs one calls the ` +
            `core's function — acceptUpload(), grantByHand() — which owns what a complete ` +
            `row is. See the spine's AD-81.`,
        ).toBe(false);
      }
    });

    it(`${label} touches only its own module's tree`, () => {
      // A relative import that climbs out of the module, or an alias into
      // another one, is the same fault wearing a different path.
      const climbs = /from\s+["']\.\.\/\.\.\//.test(source);
      expect(climbs, `${label} imports out of its own module with ../../`).toBe(false);

      for (const other of moduleIds().filter((name) => name !== id)) {
        expect(
          source.includes(`@/modules/${other}`),
          `${label} imports from the "${other}" module. A module that needs another ` +
            `declares "requires" and goes through what that module exports — never ` +
            `straight into its files.`,
        ).toBe(false);
      }
    });
  }
});
