// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The import resolver, and the rule that keeps there being ONE of it.
//
// `scripts/lib/import-graph.mjs` explains what it does and why it exists. This
// file measures the two things prose cannot: that a bare specifier and an
// unresolvable one really are different answers, and that nobody has quietly
// written a fourth private copy of the `@/` rule.
//
// The count is not rhetoric. Three walkers had one copy each, in three
// behaviours: one resolved the alias, one skipped it, one skipped it AND threw
// an ENOENT on anything it could not find — so a walk that was supposed to
// report a finding ended the whole suite instead.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { blankComments } from "./source-text.mjs";
import {
  DEFAULT_IMPORT_EXTENSIONS,
  isOwnSpecifier,
  resolveImport,
} from "./import-graph.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("isOwnSpecifier", () => {
  it("says yes to an alias and to a relative path", () => {
    expect(isOwnSpecifier("@/lib/roles")).toBe(true);
    expect(isOwnSpecifier("./x.mjs")).toBe(true);
    expect(isOwnSpecifier("../lib/env.mjs")).toBe(true);
  });

  it("says no to a package, a builtin and a SCOPED package", () => {
    expect(isOwnSpecifier("postgres")).toBe(false);
    expect(isOwnSpecifier("node:fs")).toBe(false);
    // ⚠️ The one that is easy to get wrong: `@/` and `@scope/` both start with
    // `@`, and a check written `startsWith("@")` would send the walk after
    // `<root>/scope/pkg` and report "our path, nothing there" about npm's.
    expect(isOwnSpecifier("@scope/pkg")).toBe(false);
    expect(isOwnSpecifier("drizzle-orm/postgres-js")).toBe(false);
  });
});

describe("resolveImport answers three states, never two", () => {
  const HERE = join(ROOT, "scripts", "lib", "import-graph.test.ts");

  it("not ours — a bare specifier is null", () => {
    for (const spec of ["postgres", "node:fs", "@scope/pkg", "drizzle-orm"]) {
      expect(resolveImport(HERE, spec, { root: ROOT }), spec).toBeNull();
    }
  });

  it("ours, found — an alias resolves against the ROOT, not the importing file", () => {
    const answer = resolveImport(HERE, "@/scripts/lib/source-text.mjs", { root: ROOT });
    expect(answer?.exists).toBe(true);
    expect(answer?.path).toBe(join(ROOT, "scripts", "lib", "source-text.mjs"));
  });

  it("ours, found — a relative path resolves against the importing file", () => {
    const answer = resolveImport(HERE, "./source-text.mjs", { root: ROOT });
    expect(answer?.exists).toBe(true);
    expect(answer?.path).toBe(join(ROOT, "scripts", "lib", "source-text.mjs"));
  });

  it("🚨 ours, NOT found — `{ exists: false }` and never null", () => {
    // The assertion that keeps NFR-60 inside the resolver rather than in a
    // comment beside it. "I could not look" (nothing on disk) and "there is
    // nothing there" (not our path at all) are the same colour, and a caller
    // that gets one `null` for both cannot report the first by name — which is
    // exactly what `purity.test.ts`'s "imports only manifest files" failure
    // does with it.
    const answer = resolveImport(HERE, "./nope.mjs", { root: ROOT });
    expect(answer).not.toBeNull();
    expect(answer?.exists).toBe(false);
    expect(answer?.path).toBe(join(ROOT, "scripts", "lib", "nope.mjs"));

    const aliased = resolveImport(HERE, "@/lib/nowhere-at-all", { root: ROOT });
    expect(aliased).not.toBeNull();
    expect(aliased?.exists).toBe(false);
  });

  it("refuses to guess a root", () => {
    // Three callers derive their root three different ways — `process.cwd()`,
    // `import.meta.url`, `__dirname` — so a helper that read one of them would
    // be right in one caller and silently wrong in two. An empty root is the
    // shape that would arrive from a caller whose own derivation returned
    // nothing, and it throws rather than resolving everything against `/`.
    expect(() => resolveImport(HERE, "./x.mjs", { root: "" })).toThrow(/root/);
  });
});

describe("the extension probe, measured on a fixture", () => {
  // Order asserted against real files rather than read off the constant: the
  // constant is the claim, the files are the measurement.
  const dir = mkdtempSync(join(tmpdir(), "ds24-import-graph-"));
  const from = join(dir, "importer.mjs");

  writeFileSync(from, "// importer\n");
  writeFileSync(join(dir, "both.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "both.mjs"), "export const a = 1;\n");
  writeFileSync(join(dir, "only.mjs"), "export const a = 1;\n");
  writeFileSync(join(dir, "exact"), "not a module, but it is on disk\n");
  writeFileSync(join(dir, "exact.ts"), "export const a = 1;\n");
  mkdirSync(join(dir, "folder"));
  writeFileSync(join(dir, "folder", "index.ts"), "export const a = 1;\n");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds a .ts and finds a .mjs", () => {
    expect(resolveImport(from, "./only", { root: dir })?.path).toBe(join(dir, "only.mjs"));
    expect(resolveImport(from, "./both", { root: dir })?.path).toBe(join(dir, "both.ts"));
  });

  it("probes in the order the constant declares", () => {
    // `.ts` before `.mjs`, so a stem carrying both answers `.ts`. Nothing in
    // this tree has one — `.mjs` and `.ts` never share a stem — which is why
    // the order is asserted here rather than left to be discovered by the file
    // that eventually breaks the convention.
    expect(DEFAULT_IMPORT_EXTENSIONS.indexOf(".ts")).toBeLessThan(
      DEFAULT_IMPORT_EXTENSIONS.indexOf(".mjs"),
    );
    expect(DEFAULT_IMPORT_EXTENSIONS[0]).toBe("");
  });

  it("the bare path wins — a specifier that names its own suffix is never shadowed", () => {
    expect(resolveImport(from, "./exact", { root: dir })?.path).toBe(join(dir, "exact"));
  });

  it("a directory that exists is the answer, and its index file is not reached", () => {
    // ⚠️ Not a design choice made here — it is what all three callers already
    // did, and it is preserved rather than improved. `""` matches a DIRECTORY
    // as readily as a file, so the `/index.…` entries almost never fire. In
    // `purity.test.ts` that is what makes a directory import show up as an
    // escaped path by its own name, which is the useful failure.
    expect(resolveImport(from, "./folder", { root: dir })?.path).toBe(join(dir, "folder"));
  });

  it("honours a caller's narrower list", () => {
    expect(resolveImport(from, "./both", { root: dir, extensions: [".mjs"] })?.path).toBe(
      join(dir, "both.mjs"),
    );
  });
});

// ── the rule that keeps it one copy ─────────────────────────────────────────

describe("🚨 nothing resolves @/ on its own", () => {
  const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);
  const SCANNED = ["app", "lib", "components", "hooks", "db", "scripts", "i18n", "modules"];

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

  /**
   * The FLAT files at the app root as well — `proxy.test.ts`, `auth.config.ts`,
   * `instrumentation.ts`, `run.mjs`.
   *
   * ⚠️ The same reason `source-text.test.ts` carries this: `SCANNED` is a list
   * of DIRECTORIES, and the file that broke that rule last time lived beside
   * them rather than in one. A list of places to look is only as good as the
   * place nobody thought to name.
   */
  const rootFiles = (): string[] =>
    readdirSync(ROOT).filter(
      (entry) => /\.(ts|tsx|mjs)$/.test(entry) && !statSync(join(ROOT, entry)).isDirectory(),
    );

  const ALL = [...SCANNED.flatMap((dir) => [...sourceFiles(dir)]), ...rootFiles()];

  /** The one file allowed to contain the implementation. */
  const HOME = join("scripts", "lib", "import-graph.mjs");
  const SELF = join("scripts", "lib", "import-graph.test.ts");

  // The needle: the alias test, with its closing quote and paren.
  //
  // ⚠️ Both of those characters are load-bearing. Without them the needle also
  // matches `app/login/dialog-guard.test.ts`, which asks
  // `startsWith("@/lib/credentials")` — a question about ONE module's imports,
  // not a second resolver. A guard that reports an innocent file is a guard
  // somebody widens until it reports nothing.
  const NEEDLE = 'startsWith("@/")';

  it("walked the tree", () => {
    // Non-vacuity, the same probe every walk in this repo carries.
    expect(ALL.length).toBeGreaterThan(200);
    expect(ALL.map((f) => relative("", f))).toContain(HOME);
    // …and the root, which is not one of `SCANNED`'s directories.
    expect(ALL).toContain("proxy.test.ts");
  });

  it("🚨 the needle can be found at all", () => {
    // 🚨 The assertion below is a `.includes()` over source text, so a needle
    // that no source text can contain makes it pass over every file in the
    // tree. `scripts/lib/source-text.test.ts` records what that costs: its own
    // needle shipped in a form that never lined up with one character of the
    // tree, and "sixteen copies were removed while the guard that was supposed
    // to keep them gone could not see a single one."
    //
    // So the needle is measured against the one file that legitimately has it,
    // through `blankComments()` — the same treatment the offenders get, or a
    // needle that only survives in prose would prove nothing about the scan.
    expect(blankComments(readFileSync(join(ROOT, HOME), "utf8"))).toContain(NEEDLE);
  });

  it("has no second implementation anywhere", () => {
    const offenders: string[] = [];

    for (const file of ALL) {
      if (file === HOME || file === SELF) continue;
      const source = readFileSync(join(ROOT, file), "utf8");
      // Its own comments blanked first — a file may DISCUSS the rule, and
      // several do. Which is the neighbouring rule (`blankComments()` from
      // `source-text.mjs`, never a private regex) applied to this one.
      if (blankComments(source).includes(NEEDLE)) {
        offenders.push(file.split(/[\\/]/).join("/"));
      }
    }

    expect(
      offenders,
      "these files resolve the `@/` alias themselves:\n" +
        offenders.map((f) => `  ${f}`).join("\n") +
        "\n\nImport `resolveImport()` (or `isOwnSpecifier()`) from " +
        "scripts/lib/import-graph.mjs instead. This consolidates the three " +
        "transitive-import walkers — scripts/mcp/no-db.test.ts, " +
        "scripts/modules/data-gate.test.ts and scripts/core/purity.test.ts — " +
        "of which two claimed to follow imports transitively while stopping at " +
        "the first alias, and one threw an ENOENT where it should have reported " +
        "a finding.",
    ).toEqual([]);
  });
});
