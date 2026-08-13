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

import { availableModules } from "../modules/registry.mjs";
import { blankComments } from "./source-text.mjs";
import {
  DEFAULT_IMPORT_EXTENSIONS,
  isOwnSpecifier,
  resolveImport,
} from "./import-graph.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// ── the tree, walked once for the two rules below ───────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);
const SCANNED = ["app", "lib", "components", "hooks", "db", "scripts", "i18n", "modules"];

/**
 * `.js` is in the set although the tree has none today: it is one of the
 * suffixes `DEFAULT_IMPORT_EXTENSIONS` probes, so a `.js` beside a `.ts` would
 * be exactly the collision the stem rule below is about, and a walk that could
 * not see it would report zero and look like a pass.
 */
const SOURCE_SUFFIX = /\.(ts|tsx|mjs|js)$/;

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
    else if (SOURCE_SUFFIX.test(entry)) yield rel;
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
    (entry) => SOURCE_SUFFIX.test(entry) && !statSync(join(ROOT, entry)).isDirectory(),
  );

const ALL = [...SCANNED.flatMap((dir) => [...sourceFiles(dir)]), ...rootFiles()];

/** A path as it is written in a message, on every platform. */
const posix = (file: string) => file.split(/[\\/]/).join("/");

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
    // `.ts` before `.mjs`, so a stem carrying both answers `.ts`.
    //
    // 🚨 This comment used to go on: "Nothing in this tree has one — `.mjs` and
    // `.ts` never share a stem". That was false while six pairs sat in the
    // tree, and `docs/conventions.md` never claimed otherwise — it PERMITS the
    // arrangement in two named forms. A claim about the whole tree, in the file
    // that walks the tree, is where a reader is least likely to check it
    // (action point A16), so the claim is not restated in prose here: the
    // describe at the foot of this file derives the pairs from the tree and
    // measures this order against every one of them.
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

// ── the stems this tree really shares ───────────────────────────────────────

/**
 * 🚨 What replaced a sentence that was false.
 *
 * `DEFAULT_IMPORT_EXTENSIONS` probes `.ts` before `.mjs`, and the comment above
 * it said that decided nothing here because no stem carried both. Six did.
 * `docs/conventions.md` → *A `.mjs` beside a `.ts`* never forbade the
 * arrangement; it permits it in exactly two forms and forbids a third:
 *
 *   the DOOR   — one implementation in `.mjs`, a `.ts` of the same stem that
 *                re-exports it or puts shapes on it. `lib/credentials/hash`,
 *                `lib/media/sigv4`.
 *   the TWINS  — two spellings of one query, a manifest declaring both and a
 *                test comparing them. `modules/*​/privacy/sections`, held by
 *                `scripts/modules/privacy.test.ts`.
 *   forbidden  — "a second copy nothing compares", in that rule's own words.
 *
 * So the repair is not a better sentence. A sentence that said "six" would be
 * wrong at the seventh (action point A33: name the DERIVATION, never the list),
 * and a sentence is what nobody checks. Both facts are derived from the tree
 * here instead: which stems are shared, and whether each one is one of the two
 * forms — the `.ts` naming its own `.mjs` sibling through `resolveImport()`,
 * or a `modules/*​/module.json` declaring the pair. A seventh, unsanctioned
 * stem fails this file on the day it lands.
 *
 * ⚠️ Measured and deliberately NOT asserted: "nobody imports a shared stem
 * without its extension" — eight importers do today and all eight are correct,
 * because for both permitted forms the `.ts` IS the half a TypeScript caller
 * wants. The rule in `conventions.md` is that every import of the `.mjs` names
 * it, which is Node's requirement anyway and not a thing this walk can add to.
 */
describe("🚨 a .ts and a .mjs under one stem", () => {
  const stems = new Map<string, string[]>();
  for (const file of ALL) {
    const suffix = SOURCE_SUFFIX.exec(file);
    if (!suffix) continue;
    const stem = file.slice(0, -suffix[0].length);
    stems.set(stem, [...(stems.get(stem) ?? []), suffix[0]]);
  }
  const shared = [...stems]
    .filter(([, suffixes]) => suffixes.length > 1)
    .map(([stem, suffixes]) => ({ stem, suffixes: [...suffixes].sort() }))
    .sort((a, b) => a.stem.localeCompare(b.stem));

  /**
   * Every static import/export-from specifier of one file, comments blanked
   * first — a `.ts` may DISCUSS its `.mjs` half, and both of the doors do.
   * (`blankComments()` from `source-text.mjs`, never a private regex; the
   * resolution below is `resolveImport()`, never a private `@/` branch.)
   */
  const specifiersOf = (file: string): string[] =>
    [
      ...blankComments(readFileSync(join(ROOT, file), "utf8")).matchAll(
        /\bfrom\s+["']([^"']+)["']|^[ \t]*import\s+["']([^"']+)["']/gm,
      ),
    ].map((m) => m[1] ?? m[2]);

  /**
   * The TWINS, read off the manifests rather than off a list kept here — a
   * fifth module is covered the day it lands. `availableModules()` is every
   * module IN THE TREE, installed or not: `config/modules.json` ships empty, so
   * a reader that asked what is installed would find nothing and pass.
   *
   * A manifest that does not parse is `scripts/modules/registry.test.ts`'s
   * finding, not this file's — here it simply contributes no pair, and its
   * stem then shows up below as unsanctioned, which is loud rather than silent.
   */
  const twins = new Set<string>();
  for (const id of availableModules(ROOT)) {
    let manifest: { privacy?: { ts?: string; mjs?: string } };
    try {
      manifest = JSON.parse(readFileSync(join(ROOT, "modules", id, "module.json"), "utf8"));
    } catch {
      continue;
    }
    const declared = manifest.privacy;
    if (!declared?.ts || !declared?.mjs) continue;
    const stem = declared.ts.replace(SOURCE_SUFFIX, "");
    if (declared.mjs.replace(SOURCE_SUFFIX, "") !== stem) continue;
    twins.add(posix(join("modules", id, stem)));
  }

  it("walked the tree and found stems that are shared", () => {
    // 🚨 The count guard. Zero shared stems is what a broken walk and a tidy
    // tree look like alike, and this file has already shipped the assumption
    // that the number is zero — so zero is a FAILURE here, not a pass. It
    // becomes a legitimate one on the day somebody removes the last pair, and
    // then this line is the place where that gets decided rather than
    // discovered.
    expect(ALL.length).toBeGreaterThan(200);
    expect(shared.length).toBeGreaterThan(0);
    // …and both halves of at least one pair really are on disk, which is the
    // needle for the split itself: a suffix regex that matched nothing would
    // give every file the same stem and report a wall, not a zero.
    expect(shared.map((s) => s.suffixes.join("+"))).toContain(".mjs+.ts");
  });

  it("the probe answers the .ts for every shared stem — measured, not assumed", () => {
    const answers = shared.map(({ stem }) => {
      const answer = resolveImport(join(ROOT, "importer.ts"), `@/${posix(stem)}`, { root: ROOT });
      return `${posix(stem)} -> ${answer ? posix(relative(ROOT, answer.path)) : "null"}`;
    });
    // The consequence of `DEFAULT_IMPORT_EXTENSIONS`'s order on the REAL tree
    // rather than on a fixture: an extensionless specifier reaches the typed
    // half. That is what the door is for — and it is also why every import of
    // the `.mjs` half has to name it.
    expect(answers).toEqual(shared.map(({ stem }) => `${posix(stem)} -> ${posix(stem)}.ts`));
  });

  it("🚨 every shared stem is one of the two forms conventions.md permits", () => {
    const unsanctioned: string[] = [];

    for (const { stem, suffixes } of shared) {
      if (!suffixes.includes(".mjs") || !suffixes.includes(".ts")) {
        // A pair of any OTHER two suffixes — `.js` beside a `.ts`, say — is not
        // one of the permitted forms at all, and the doc names neither.
        unsanctioned.push(`${posix(stem)}{${suffixes.join(",")}} — not a .ts/.mjs pair`);
        continue;
      }
      if (twins.has(posix(stem))) continue;

      const tsFile = `${stem}.ts`;
      const mjsFile = join(ROOT, `${stem}.mjs`);
      const isDoor = specifiersOf(tsFile).some(
        (specifier) => resolveImport(join(ROOT, tsFile), specifier, { root: ROOT })?.path === mjsFile,
      );
      if (!isDoor) unsanctioned.push(`${posix(stem)}{.mjs,.ts} — neither a door nor a declared pair`);
    }

    expect(
      unsanctioned,
      "these stems carry a .ts and a .mjs that nothing holds together:\n" +
        unsanctioned.map((s) => `  ${s}`).join("\n") +
        "\n\ndocs/conventions.md → `A .mjs beside a .ts` allows exactly two shapes: a typed " +
        "DOOR (the .ts imports or re-exports its own .mjs sibling, as lib/credentials/hash.ts " +
        "and lib/media/sigv4.ts do), or TWO SPELLINGS of one query declared as `privacy.ts` " +
        "and `privacy.mjs` in a module manifest and compared by scripts/modules/privacy.test.ts. " +
        "Anything else is 'a second copy nothing compares' — and because the probe order puts " +
        ".ts before .mjs, the app and its plain-Node scripts then answer out of different files " +
        "under one name with npm run typecheck green.",
    ).toEqual([]);
  });
});
