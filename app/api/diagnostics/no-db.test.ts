// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The diagnostics endpoint answers when the database does not — proved,
// rather than asserted in a comment.
//
// The first failure `node run.mjs errors` exists to report is
// `ECONNREFUSED`/`ENOTFOUND` against Postgres; it is a `HINTS` entry in
// `lib/diagnostics/parse.mjs`. A route that needs Postgres to tell you Postgres
// is down is the one design guaranteed to be silent at the moment it matters —
// which is also why the credential is an environment variable and not a row in
// `setup_keys`.
//
// A static import is resolved before a single line runs, so "we only touch the
// database in one branch" is not a defence. That is why this walks the
// transitive STATIC closure and not the file.
//
// ⚠️ Two helpers are used rather than reimplemented, and both are rules in
// `CLAUDE.md` rather than preferences:
//
//   · `blankComments()` — this test reads source as TEXT, and without it the
//     file that DOCUMENTS the rule (the header of `lib/diagnostics/guard.ts`
//     names `@/db` in prose) would be reported as breaking it.
//   · `resolveImport()` — the walker's `@/` branch. Written by hand it is the
//     bug this whole test would then have: `scripts/mcp/no-db.test.ts` skipped
//     every non-relative specifier and resolved only `.mjs`, so copied verbatim
//     here — where every import is `@/lib/…` and `.ts` — the walk would collect
//     three strings, follow none of them, and report green while asserting
//     nothing but "route.ts does not literally contain the characters @/db".

import { readFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOwnSpecifier, resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();
const ENTRY = join(ROOT, "app/api/diagnostics/errors/route.ts");

/**
 * Its neighbour, which DOES reach the database — and must.
 *
 * 🚨 The scoping above is a decision, not an oversight. Two routes sit in
 * `app/api/diagnostics/` and they answer opposite questions: "what is my app's
 * log hiding" has to work when Postgres is down, so a driver anywhere in its
 * closure makes it silent at exactly the moment it matters. "When did the last
 * IPN arrive" is a question ABOUT Postgres — it cannot be answered without one,
 * and its honest answer when the database is unreachable is `unchecked`, which
 * is what `operationalState()` returns.
 *
 * So `ENTRY` stays pointed at ONE file, and the assertion below is what stops
 * somebody later "tidying" this into a scan of the folder: doing that would
 * report the health route as a violation, and the cheapest way out of a red
 * build is to delete the rule that went red.
 */
const HEALTH_ENTRY = join(ROOT, "app/api/diagnostics/health/route.ts");

/** Anything that could open a connection, by name. */
const FORBIDDEN = [
  "@/db",
  "@/db/schema",
  "drizzle-orm",
  "drizzle-orm/postgres-js",
  "postgres",
  "pg",
  "mysql2",
  "better-sqlite3",
];

/** Every static `import … from "x"` in a source, comments already blanked. */
function importsIn(source: string): string[] {
  const blanked = blankComments(source);
  const out: string[] = [];
  for (const match of blanked.matchAll(/\bfrom\s+["']([^"']+)["']/g)) out.push(match[1]);
  // A bare side-effect import counts too: `import "@/lib/x";`
  for (const match of blanked.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(match[1]);
  return out;
}

/** Is there something at this path that can be READ as source? */
function isFile(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** Walks the transitive STATIC import graph from one entry point. */
function closure(entry: string): { files: string[]; specifiers: string[] } {
  const seen = new Set<string>();
  const specifiers: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    // ⚠️ `isFile()`, not `existsSync()`. `resolveImport()` answers a DIRECTORY
    // for `@/db` — the bare path is probed before `/index.ts` and the folder is
    // there — and that behaviour is deliberate and pinned by
    // `scripts/lib/import-graph.test.ts` ("a directory that exists is the
    // answer"), because `purity.test.ts` reports such a hit by its own name.
    // Reading one throws EISDIR, so the guard belongs in the caller. The
    // specifier is recorded BEFORE the walk either way, which is what the
    // assertions below read.
    if (seen.has(file) || !isFile(file)) continue;
    seen.add(file);

    for (const specifier of importsIn(readFileSync(file, "utf8"))) {
      // Pushed BEFORE any skip: `FORBIDDEN` names bare packages AND `@/db`, so
      // the assertions below need every specifier the walk SAW, not only the
      // ones it followed.
      specifiers.push(specifier);
      const target = resolveImport(file, specifier, { root: ROOT });
      if (target?.exists) queue.push(target.path);
    }
  }
  return { files: [...seen], specifiers };
}

describe("the diagnostics endpoint reaches no database", () => {
  const { files, specifiers } = closure(ENTRY);

  it("actually walked something, and walked PAST the entry file", () => {
    // The non-vacuity half. A walk that silently found nothing would report
    // green for ever.
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((file) => file.endsWith("route.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith(join("lib", "diagnostics", "guard.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(join("lib", "setup", "rules.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(join("lib", "rate-limit.ts")))).toBe(true);
  });

  // 🚨 The needle probe, and it is TRANSITIVE on purpose. A one-level fixture
  // proves the walk RAN, not that it walks: `resolveImport()` could resolve the
  // first hop and stop, and every assertion below would still be green while
  // covering exactly one file. So A imports B, B imports `@/db`, and the walk
  // has to surface `@/db` starting from A.
  it("would flag a database reached two hops away", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds24-nodb-probe-"));
    try {
      writeFileSync(join(dir, "b.mjs"), 'import { db } from "@/db";\nexport const x = db;\n');
      writeFileSync(join(dir, "a.mjs"), 'import { x } from "./b.mjs";\nexport const y = x;\n');

      const probe = closure(join(dir, "a.mjs"));
      expect(
        probe.files.some((file) => file.endsWith("b.mjs")),
        "the walk stopped at the entry file — it is not transitive",
      ).toBe(true);
      expect(probe.specifiers).toContain("@/db");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the @/ alias rather than skipping it", () => {
    // The other half of the same worry. Every import in this route is aliased,
    // so a walker that treats `@/…` as "an npm package, not ours" follows
    // nothing at all here — and reports green having read one file.
    // ⚠️ `isOwnSpecifier()` and a relative-path exclusion rather than the alias
    // test spelled out here: `scripts/lib/import-graph.test.ts` fails the build
    // on any file that resolves `@/` on its own, and it recognises the second
    // copy by that literal. Consuming the helper is the point.
    const aliased = specifiers.filter(
      (specifier) => isOwnSpecifier(specifier) && !specifier.startsWith("."),
    );
    expect(aliased.length).toBeGreaterThan(2);
    const unresolved = aliased.filter(
      (specifier) => resolveImport(ENTRY, specifier, { root: ROOT })?.exists !== true,
    );
    expect(
      unresolved,
      `these @/ specifiers resolved to nothing — the alias branch is not doing its job`,
    ).toEqual([]);
  });

  // 🚨 The other half of the scoping, and it is an assertion rather than a
  // comment on purpose: without it, "ENTRY names one file" reads as an omission
  // and the obvious tidy-up is a folder scan — which would turn the health
  // route into a violation of a rule it was never under.
  it("🚨 its NEIGHBOUR does reach @/db, and that is the measured decision", () => {
    const health = closure(HEALTH_ENTRY);
    expect(
      health.files.some((file) => file.endsWith(join("lib", "ops", "health.ts"))),
      "the walk from the health route did not reach lib/ops/health.ts",
    ).toBe(true);
    expect(
      health.specifiers,
      "app/api/diagnostics/health/route.ts no longer reaches @/db.\n" +
        "That is not an improvement: it answers 'when did the last IPN arrive',\n" +
        "which cannot be answered without the database. If this route genuinely\n" +
        "stopped needing one, this assertion is what has to be argued away —\n" +
        "and the ENTRY above still stays scoped to the errors route.",
    ).toContain("@/db");
    // And the errors route is still the one under the rule — the two are
    // different files, so widening ENTRY to the folder is never the fix.
    expect(health.files).not.toContain(ENTRY);
  });

  for (const forbidden of FORBIDDEN) {
    it(`never imports ${forbidden}`, () => {
      const hit = specifiers.find(
        (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
      );
      expect(
        hit,
        `app/api/diagnostics/errors/route.ts reaches ${forbidden} through its import graph.\n` +
          `An unreachable database is one of the failures this endpoint exists to REPORT —\n` +
          `a driver in this closure makes it silent at exactly that moment. The credential\n` +
          `is an environment variable for the same reason (lib/diagnostics/guard.ts).`,
      ).toBeUndefined();
    });
  }
});
