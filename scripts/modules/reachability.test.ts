// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A file inside a module that nothing reaches is either dead code or an
// interface the app is told to import and cannot.
//
// ── The gap this closes, and it had been open twice ─────────────────────────
//
// `modules/boundary.test.ts` §1 is the rule this is the other half of: no core
// file names a module, everything the app needs comes through a generated
// registry. A module therefore has to DECLARE what it lends —
// `components` for the client half, `serverExports` for the server half — and a
// module that forgets is installable and not usable. Its own guidance then
// prescribes the one import the boundary refuses, so following the template's
// instructions turns the CUSTOMER's `npm run test` red about code they wrote
// correctly.
//
// That has now shipped twice:
//
//   · `activity` / `companion` — the client half. `docs/learning.md` and
//     `docs/ai-in-product.md` named the module path, with no registry to import
//     from instead. `components` and `component-registry.ts` are the fix.
//   · `metrics` — the server half, reported from the field 2026-08-16 and
//     reproduced here: `lib/track.ts` is the module's whole app-facing surface,
//     the skill and `docs/metrics.md` prescribed
//     `import { track } from "@/modules/metrics/lib/track"`, and the manifest
//     declared no `serverExports` at all.
//
// 🚨 **Nothing in this repo could have seen either**, and the reason is one
// line: `boundary.test.ts:184` returns early when no module is installed, and
// the template ships `config/modules.json` empty. The appkit checks itself in
// the state it is SHIPPED in, which is the one state the defect is invisible in.
// So this file asks a question that needs no module installed and no core file
// of the customer's: reachability inside the module, off the manifests.
//
// ── What "reachable" means here ────────────────────────────────────────────
//
// Three kinds of root, and all three are DERIVED rather than listed:
//
//  1. **Every string in the manifest that resolves to a code file in the
//     module.** Walked recursively over the parsed JSON rather than key by key,
//     so a manifest key added next year seeds this walk on the day it lands.
//     A hand-kept key list is the rot `boundary.test.ts` documents on its own
//     allowlist, one directory over.
//  2. **The module's route declarations in the core tree** — `app/**/page.<id>.tsx`
//     and friends. Those files are the module's, parked where Next insists
//     (`scripts/modules/page-extensions.mjs`), and they are how `pages/` and
//     `routes/` inside the module are entered.
//  3. **The module's own test files.** Measured below; the alternative is
//     noisier and buys nothing here.
//
// ── The number, measured on the tree of the day (2026-08-16) ───────────────
//
// 196 non-test code files across the six modules. With tests as roots: **1
// unreachable, and it was the defect** — `modules/metrics/lib/track.ts`.
// Without them: 4, of which three are not findings —
// `community/lib/_shell-files.mjs` is a test helper by name,
// `activity/progress.ts` and `community/components/embedded-discussion.tsx` are
// product files only their own test reaches. Arming the stricter form would
// open with three findings a customer can inherit, which is how a check gets
// switched off (root `CLAUDE.md`, on `factory-skills-lint.mjs`). So tests are
// roots, and the price is stated rather than hidden: **a module author who unit-
// tests their app-facing helper before declaring it slips through.** What that
// author still cannot do is ship the helper with no test and no declaration,
// which is exactly what `metrics` did.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { availableModules, readModule } from "@/scripts/modules/registry.mjs";
import { RESERVED_IDS } from "@/scripts/modules/manifest.mjs";
import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Forward slashes on every platform — findings are compared and printed. */
const slash = (p: string) => p.split(sep).join("/");

const CODE = /\.(ts|tsx|mjs|js)$/;
const IS_TEST = /\.(test|spec)\.(ts|tsx|mjs|js)$/;

function* codeFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* codeFiles(full);
    else if (CODE.test(entry)) yield full;
  }
}

/** Every string anywhere in the parsed manifest — the seed source for rule 1. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) stringsIn(item, out);
  return out;
}

/**
 * The module id a core file's NAME declares — the same claim `boundary.test.ts`
 * §1b holds these files to, read from the same `RESERVED_IDS` so the two answers
 * cannot drift apart.
 */
const moduleOfCoreFile = (base: string): string | null => {
  const m = /^(?:page|route|layout|default|loading|error|not-found)\.([a-z0-9-]+)\.(tsx?|mjs|js)$/
    .exec(base);
  return m && !RESERVED_IDS.has(m[1]) ? m[1] : null;
};

/** Route declarations in `app/`, grouped by the module whose routes they are. */
function coreRouteFiles(): Map<string, string[]> {
  const byModule = new Map<string, string[]>();
  for (const file of codeFiles(join(ROOT, "app"))) {
    const id = moduleOfCoreFile(file.split(sep).pop() ?? "");
    if (!id) continue;
    const list = byModule.get(id) ?? [];
    list.push(file);
    byModule.set(id, list);
  }
  return byModule;
}

/** Static import / export-from specifiers, comments blanked first. */
function specifiersOf(file: string): string[] {
  const source = blankComments(readFileSync(file, "utf8"));
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:^|\s)(?:import|export)\b[^;'"]*?\bfrom\s+["']([^"']+)["']/gm,
  )) {
    found.push(match[1]);
  }
  // Side-effect imports: `import "./x"`.
  for (const match of source.matchAll(/(?:^|\s)import\s+["']([^"']+)["']/gm)) {
    found.push(match[1]);
  }
  // A module may enter a file lazily — `scripts/modules/cli.mjs` does exactly
  // that with the data gate, and a walk that missed it would report the target
  // as dead.
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push(match[1]);
  }
  return found;
}

interface ModuleWalk {
  readonly id: string;
  readonly dir: string;
  readonly seeds: string[];
  readonly reached: Set<string>;
  readonly subjects: string[];
}

const ROUTES = coreRouteFiles();

function walkModule(id: string): ModuleWalk {
  const record = readModule(id, ROOT) as { dir: string; manifest: Record<string, unknown> };
  const dir = join(ROOT, record.dir);
  const files = [...codeFiles(dir)];

  const seeds: string[] = [];
  for (const value of stringsIn(record.manifest)) {
    if (!CODE.test(value)) continue;
    const candidate = join(dir, value);
    if (files.includes(candidate)) seeds.push(candidate);
  }
  seeds.push(...(ROUTES.get(id) ?? []));
  seeds.push(...files.filter((file) => IS_TEST.test(file)));

  const reached = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const specifier of specifiersOf(file)) {
      const target = resolveImport(file, specifier, { root: ROOT });
      // Only what lands INSIDE this module is this walk's business. A module
      // importing `@/lib/…` is the core it consumes, and §1d is what holds that.
      if (target?.exists && target.path.startsWith(dir + sep)) queue.push(target.path);
    }
  }

  return { id, dir, seeds, reached, subjects: files.filter((file) => !IS_TEST.test(file)) };
}

const WALKS = availableModules(ROOT).map(walkModule);

/**
 * Files that are unreachable and stay — each with its reason.
 *
 * Empty on 2026-08-16, and it is meant to stay that way: an entry here is a
 * module file nothing enters, which the header argues is either dead code or an
 * undeclared interface. Keyed `<moduleId>/<path inside the module>`.
 */
const ALLOWED: Record<string, string> = {};

describe("the walk is not empty", () => {
  it("found the modules and read their files", () => {
    // Without this, every assertion below passes on a loop that never runs.
    expect(WALKS.length).toBeGreaterThan(0);
    expect(WALKS.reduce((sum, w) => sum + w.subjects.length, 0)).toBeGreaterThan(100);
    for (const walk of WALKS) {
      expect(walk.seeds.length, `${walk.id} declares nothing this walk can start from`)
        .toBeGreaterThan(0);
    }
  });

  it("🚨 really follows imports, rather than counting its own seeds", () => {
    // The probe. Every subject could be "reachable" because it was a seed —
    // the walk would then be an expensive way of reading the manifest back.
    // At least one file has to be reached ONLY through an import chain, and it
    // is named so that a walk which silently stopped following says so.
    const throughImports = WALKS.flatMap((walk) =>
      [...walk.reached]
        .filter((file) => !walk.seeds.includes(file))
        .map((file) => `${walk.id}/${slash(relative(walk.dir, file))}`),
    );
    expect(throughImports.length, "the walker resolves no import at all").toBeGreaterThan(20);
  });
});

describe("every file in a module is reached by something", () => {
  it("names no file that no declaration, route or test enters", () => {
    const orphans: string[] = [];
    for (const walk of WALKS) {
      for (const file of walk.subjects) {
        if (walk.reached.has(file)) continue;
        const key = `${walk.id}/${slash(relative(walk.dir, file))}`;
        if (key in ALLOWED) continue;
        orphans.push(key);
      }
    }
    expect(
      orphans,
      "nothing in this app enters these module files. Either they are dead, or " +
        "they are what the module lends the app and the manifest never said so — " +
        "a `serverExports` / `components` entry is what makes them importable, and " +
        "`modules/boundary.test.ts` §1 refuses the direct path in the customer's " +
        "own app:\n" +
        orphans.join("\n"),
    ).toEqual([]);
  });

  it("keeps no allowance for a file that is gone", () => {
    for (const key of Object.keys(ALLOWED)) {
      const found = WALKS.some((walk) =>
        walk.subjects.some((file) => `${walk.id}/${slash(relative(walk.dir, file))}` === key),
      );
      expect(found, `${key} is on the allowlist but is not in any module`).toBe(true);
    }
  });
});

describe("the two barrels really carry what the manifests declare", () => {
  it("🚨 every declared export names a file that exports it", () => {
    // The declaration is only half the door. `metrics` could have declared
    // `serverExports: { "track": "lib/report.ts" }` and satisfied the manifest
    // validator — it checks the identifier's SHAPE and that the file is inside
    // the module, never that the name is there. The generated barrel would then
    // re-export a name nothing exports, which is a build error in the customer's
    // app and nothing here.
    const missing: string[] = [];
    for (const walk of WALKS) {
      const record = readModule(walk.id, ROOT) as {
        manifest: {
          components?: Record<string, string>;
          serverExports?: Record<string, string>;
        };
      };
      for (const [key, declared] of [
        ["components", record.manifest.components ?? {}],
        ["serverExports", record.manifest.serverExports ?? {}],
      ] as const) {
        for (const [name, file] of Object.entries(declared)) {
          const source = blankComments(readFileSync(join(walk.dir, file), "utf8"));
          const exported =
            new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${name}\\b`)
              .test(source) ||
            new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b`).test(source) ||
            new RegExp(`\\bexport\\s+default\\s+(?:async\\s+)?function\\s+${name}\\b`).test(source);
          if (!exported) missing.push(`${walk.id}: ${key}.${name} → ${file}`);
        }
      }
    }
    expect(
      missing,
      "these declarations name a file that does not export the name:\n" + missing.join("\n"),
    ).toEqual([]);
  });

  it("🚨 the declarations are not an empty set", () => {
    // Non-vacuity for the assertion above: with no module declaring either key
    // it would iterate nothing and pass. Two are shipped today — `companion`'s
    // `askCompanion` and `metrics`' `track` on the server side, `activity`'s
    // panel and hook on the client side.
    const declared = WALKS.flatMap((walk) => {
      const record = readModule(walk.id, ROOT) as {
        manifest: {
          components?: Record<string, string>;
          serverExports?: Record<string, string>;
        };
      };
      return [
        ...Object.keys(record.manifest.components ?? {}),
        ...Object.keys(record.manifest.serverExports ?? {}),
      ];
    });
    expect(declared.length, "no module lends the app anything at all").toBeGreaterThan(2);
  });
});
