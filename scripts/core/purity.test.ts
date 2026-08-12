// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The shared core's admission test.
//
// `config/core-export.json` lists the files `node run.mjs export-core` copies
// into a companion repo (docs/mobile.md). A file in that list runs OUTSIDE
// this app — no Next.js, no database, no Node builtins, no `.env` — so this
// test holds the one property the whole feature stands on: everything in the
// manifest, and everything it imports, is pure TypeScript/JavaScript.
//
// This is the drift guard review cannot be: somebody adds an `fs` read to a
// rules module, and the manifest is not in the diff — nothing ELSE would go
// red. Same source-scan idiom as `portability.test.ts`; same non-vacuity
// stance as `use-server-exports.test.ts` (a broken parser must not go green
// by finding nothing).
//
// ⚠️ Never "make it green" by exempting a file (`core-pure-ok`) — the marker
// exists for a line that only LOOKS impure, never for one that is. The honest
// fixes are: cut the import, extract the pure part, or drop the file from the
// manifest.
//
// ⚠️ The `@/` resolution below lives in `scripts/lib/import-graph.mjs` as
// `resolveImport()` and is imported, not re-typed. This file had the only
// correct copy of it — the two other transitive walkers stopped at the first
// alias while claiming to be transitive — so the rule moved out rather than
// being copied a fourth time; `scripts/lib/import-graph.test.ts` refuses one.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { availableModules, readModule } from "../modules/registry.mjs";
import { isOwnSpecifier, resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments as stripComments } from "@/scripts/lib/source-text.mjs";

const ROOT = path.resolve(__dirname, "..", "..");

/** Marks a line a human has judged pure despite the pattern. Sparingly. */
const EXEMPT = "core-pure-ok";

const MANIFEST_PATH = path.join(ROOT, "config", "core-export.json");

const coreManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  files: string[];
};

/**
 * The core's list PLUS what every module in the tree contributes.
 *
 * 🚨 **`availableModules`, not `installedModules` — the purity rule is about
 * the TREE, not about this app.** A module's `coreExport` file is copied into a
 * companion repo the moment somebody installs the module, so it has to pass
 * every check here before that, not after. Reading the installed list would
 * make this suite green in the shipped state (nothing installed) and only start
 * asking once it was too late to answer cheaply.
 *
 * ⚠️ `modules/api/keys/rules.ts` was hand-typed into `config/core-export.json`
 * until the `coreExport` seam existed, which had two consequences: an app
 * without the api module exported a file for a feature it does not have, and
 * this test's "names only files that exist" passed only because `modules/` is
 * on disk whether or not anything is installed.
 */
const manifest = {
  files: [...coreManifest.files, ...moduleCoreExportsOf(availableModules(ROOT))].sort(),
};

/** Every module's declared `coreExport`, app-root-relative. */
function moduleCoreExportsOf(ids: string[]): string[] {
  return ids.flatMap((id) => {
    const record = readModule(id, ROOT) as {
      dir: string;
      manifest: { coreExport?: string[] };
    };
    return (record.manifest.coreExport ?? []).map((file) => `${record.dir}/${file}`);
  });
}

/** The manifest's code files (JSON entries carry no imports to scan). */
const codeFiles = manifest.files.filter((f) => !f.endsWith(".json"));

/** Every static import/export-from specifier in one file. */
function specifiersOf(file: string): string[] {
  const source = stripComments(readFileSync(path.join(ROOT, file), "utf8"));
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\s)(?:import|export)\b[^;'"]*?\bfrom\s+["']([^"']+)["']/gm)) {
    found.push(match[1]);
  }
  // Side-effect imports: `import "./x"`.
  for (const match of source.matchAll(/(?:^|\s)import\s+["']([^"']+)["']/gm)) {
    found.push(match[1]);
  }
  return found;
}

/**
 * A template-relative path for a specifier, or null for a bare one.
 *
 * The call-site adapter over `resolveImport()`: the shared helper answers with
 * an ABSOLUTE path, and what this file compares against is `manifest.files` —
 * template-relative and forward-slashed. ⚠️ `path.relative()` returns backslashes
 * on Windows, which is what the final `split`/`join` is for; it is not tidiness.
 *
 * 🚨 An unresolvable path of OURS still comes back by name, because
 * `resolveImport` answers `{ exists: false }` there rather than the `null` it
 * gives a bare specifier. Dropping it to null would make `imports only manifest
 * files` pass silently on an import that resolves to nothing — which is the
 * whole reason the helper has three answers instead of two.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const target = resolveImport(path.join(ROOT, fromFile), specifier, { root: ROOT });
  if (target === null) return null;
  return path.relative(ROOT, target.path).split(path.sep).join("/");
}

describe("the manifest itself", () => {
  it("exists, parses, and is not empty", () => {
    // Non-vacuity: every check below iterates this list, so an accidentally
    // emptied manifest would turn the whole file green while guarding nothing.
    expect(manifest.files.length).toBeGreaterThan(10);
  });

  it("names only files that exist", () => {
    const missing = manifest.files.filter((f) => !existsSync(path.join(ROOT, f)));
    expect(
      missing,
      "a manifest entry vanished — renaming or deleting a core file is a breaking change for every exported copy (docs/mobile.md)",
    ).toEqual([]);
  });

  it("is sorted, unique, and free of test files", () => {
    // Sorted so a diff shows WHAT changed, not a reshuffle around it.
    expect(manifest.files).toEqual([...manifest.files].sort());
    expect(new Set(manifest.files).size).toBe(manifest.files.length);
    expect(manifest.files.filter((f) => /\.test\.(ts|tsx|mjs)$/.test(f))).toEqual([]);
  });
});

describe("the import closure stays inside the manifest", () => {
  // A manifest file importing something NOT in the manifest would export a
  // file whose imports do not resolve in the consumer — a typecheck error on
  // somebody else's machine. Type-only imports count: the consumer's
  // typechecker needs those files too.
  for (const file of codeFiles) {
    it(`${file} imports only manifest files`, () => {
      const escaped = specifiersOf(file)
        .map((spec) => resolveSpecifier(file, spec))
        .filter((resolved): resolved is string => resolved !== null)
        .filter((resolved) => !manifest.files.includes(resolved));
      expect(
        escaped,
        `add these to config/core-export.json (if pure) or cut the import`,
      ).toEqual([]);
    });
  }
});

describe("no forbidden dependency anywhere in the core", () => {
  // Start closed: the pure core has no legitimate bare npm import at all
  // today. If one ever becomes necessary, THIS list is where the decision is
  // recorded — never an exemption marker on the import line.
  const ALLOWED_BARE: string[] = [];

  for (const file of codeFiles) {
    it(`${file} imports no framework, no database, no Node builtin, no package`, () => {
      // `isOwnSpecifier()` rather than a three-way `startsWith` chain: the same
      // question `resolveSpecifier()` above asks, answered in one place. Written
      // out here it was a second spelling of the rule, free to drift from the
      // resolver that has to agree with it — and `@scope/pkg` is the case where
      // a careless spelling gets it wrong in both directions at once.
      const bare = specifiersOf(file)
        .filter((spec) => !isOwnSpecifier(spec))
        .filter((spec) => !ALLOWED_BARE.includes(spec));
      expect(
        bare,
        "the shared core runs in a repo that has none of this — react, next, drizzle, node builtins and npm packages are all off limits",
      ).toEqual([]);
    });
  }

  for (const file of codeFiles) {
    it(`${file} reads no environment and loads nothing dynamically`, () => {
      const original = readFileSync(path.join(ROOT, file), "utf8").split("\n");
      const code = stripComments(original.join("\n")).split("\n");
      const findings: string[] = [];

      code.forEach((line, index) => {
        if (original[index]?.includes(EXEMPT)) return;
        // `process.env` is machine state the consumer repo does not share;
        // `require(` and dynamic `import(` defeat the static closure scan
        // above, so they are refused outright rather than resolved.
        for (const pattern of [/\bprocess\.env\b/, /\brequire\s*\(/, /\bimport\s*\(/]) {
          if (pattern.test(line)) {
            findings.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        }
      });

      expect(findings).toEqual([]);
    });
  }
});
