// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Who may WRITE to `setup_audit`, and the list is closed.
//
// The table's own comment used to say "there is no update path and no delete
// path in this application", and the admin page said it again — while two such
// paths existed and were both legitimate. An absolute claim a reader can
// disprove with one `grep` does not merely mislead: it teaches them that the
// prose in this area is decorative, which is expensive in a file whose subject
// is a compensating control.
//
// Story 38.3 asked for this test in so many words ("a test asserts no `update`
// or `delete` against it outside the schema file") and it was never written. So
// the rule here is the honest version of that sentence: the two writers are
// named, each with its reason, and a THIRD is a finding.
//
// Read as text through `blankComments()` — a file that explains this boundary
// must not become its own first finding (CLAUDE.md → *Rules*).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Everything a customer's app is built from. */
const SCANNED = ["app", "lib", "components", "hooks", "db", "i18n", "scripts", "modules"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

/**
 * The two writers that are not `recordAct()`, each with the reason it exists.
 *
 * **An entry here is a reviewed decision.** Neither of them rewrites an act:
 * one ages rows out, the other removes prose about a person who asked to be
 * erased. Anything that CHANGES what an act says belongs nowhere.
 */
const ALLOWED: Record<string, string> = {
  "lib/setup/manage.ts":
    "the writer itself (`recordAct`) and the retention sweep (`prune-setup-audit`), " +
    "which DELETES rows past the bound. Ageing out is not rewriting history.",
  "lib/users/manage.ts":
    "erasure: nulls `reason` when the member an act is ABOUT deletes their account " +
    "(docs/data-protection.md §14g). The act stays, the free text about a person goes.",
};

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) yield rel;
  }
}

const isTest = (file: string) => /\.test\.(ts|tsx|mjs)$/.test(file);

const files = [...SCANNED.flatMap((dir) => [...sourceFiles(dir)])].map((p) =>
  p.split(sep).join("/"),
);

/** `db.update(setupAudit)` / `db.delete(setupAudit)`, and the `tx.` forms of both. */
const MUTATES = /\.(update|delete)\(\s*setupAudit\s*\)/;

const writers = files
  .filter((file) => !isTest(file))
  .filter((file) => MUTATES.test(blankComments(readFileSync(join(ROOT, file), "utf8"))))
  .sort();

describe("🚨 setup_audit: who may rewrite an act (Story 38.3)", () => {
  it("the walk is not empty, and it really finds a writer", () => {
    // Non-vacuity, twice. A walk that read nothing, or a pattern that matches
    // nothing, would make the rule below pass over every file there is — and
    // this is precisely the shape of guard that has gone silent in this repo
    // before.
    expect(files.length).toBeGreaterThan(100);
    expect(writers.length).toBeGreaterThan(0);
    expect(writers).toContain("lib/setup/manage.ts");
  });

  it("nothing outside the two named writers updates or deletes an act", () => {
    const strangers = writers.filter((file) => !ALLOWED[file]);
    expect(
      strangers,
      "a third writer to `setup_audit`. The table is the compensating control " +
        "for a surface that takes ids, and its whole value is that an act, once " +
        "written, is what happened. The two legitimate writers are named in " +
        "ALLOWED above with their reasons — add yours there only if it neither " +
        "rewrites nor hides an act, and correct the comment in db/schema-setup.ts " +
        "in the same commit.",
    ).toEqual([]);
  });

  it("every named writer still exists — an allowlist entry for nothing is a lie", () => {
    // The other direction. An entry that stopped matching would quietly widen
    // the rule while reading as caution.
    for (const file of Object.keys(ALLOWED)) {
      expect(writers, `${file} is allowlisted and no longer writes — remove the entry`).toContain(
        file,
      );
    }
  });
});
