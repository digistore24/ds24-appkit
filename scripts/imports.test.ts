// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every relative import in the command layer points at a file that is there.
//
// ── Why this needs a test of its own ───────────────────────────────────────
// `run.mjs` and everything under `scripts/` is the one part of this app that
// **nothing else imports**. The pages are typechecked, the libraries are covered
// by the suites that use them — but a command is reached by a person typing it,
// so a dangling `import` in one is invisible to `tsc` (they are `.mjs`), invisible
// to `vitest` (no test imports them), and invisible to `next build` (not part of
// the bundle). It surfaces at the moment somebody runs the command, as a raw
// `ERR_MODULE_NOT_FOUND` stack before a single line of the command's own output.
//
// Two live breakages were found by writing this, both from module moves and both
// silent for as long as they existed:
//
//   scripts/dev/smoke.mjs → ./smoke-community.mjs
//     the community's off-state assertion moved into `modules/community/`, and
//     `smoke` — the tool CLAUDE.md tells every customer to run before saying
//     "done" — died before calling one page.
//   scripts/ai/check.mjs → ../../lib/ai/companion-config.mjs
//     the companion module's config reader moved, and `node run.mjs ai-check`
//     died the same way. It had been dead since that move.
//
// Neither was a build error, a red test or a wrong answer — which is the shape
// this repo already knows from the module pilots, and the reason the guard is a
// walk rather than a habit.
//
// ── What it deliberately does NOT check ────────────────────────────────────
// Bare specifiers (`node:fs`, `postgres`) — those are npm's and Node's job, and
// a missing one fails loudly at install time. `@/`-aliased imports — those are
// TypeScript's, and `tsc` already refuses them. Only relative paths, which are
// exactly the ones a file move breaks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
    else if (/\.(mjs|js)$/.test(entry)) yield rel;
  }
}

/**
 * The command layer: everything a person reaches by typing `node run.mjs …`.
 *
 * ⚠️ **`modules/` is in it, and leaving it out made this guard one-sided on the
 * very seam it was written for.** `run.mjs` merges `moduleCommands()`, so a
 * module's scripts ARE commands — `node run.mjs api-check` runs
 * `modules/api/check.mjs`, `node run.mjs community-prune` runs
 * `modules/community/scripts/prune.mjs` — and they carry the exact import shape
 * this file exists for: `modules/api/check.mjs` imports
 * `../../scripts/users/_db.mjs`, a relative path from a module INTO the core's
 * script tree. Move that helper and the command dies with ERR_MODULE_NOT_FOUND
 * before its first line, invisibly, which is the failure described at the top of
 * this file.
 *
 * Also covered by including the tree: `modules/*` smoke, disclosure and privacy
 * files, every one of them reached by a dynamic import from
 * `scripts/modules/inventory.mjs` and by nothing a compiler reads.
 */
const FILES = [...sourceFiles("scripts"), ...sourceFiles("modules"), "run.mjs"];

/**
 * The relative specifiers a file imports — static and dynamic alike.
 *
 * Dynamic ones count because that is how the module seams are written
 * (`runModuleSmoke()` imports `${dir}/${manifest.smoke}`); a TEMPLATED one is
 * skipped by the `\.` anchor, which is correct — its target is a manifest's
 * claim, and `scripts/modules/manifest.test.ts` is what holds that to a file.
 *
 * ⚠️ **A statement, never a string that contains one.** The static forms are
 * anchored to the start of a line and may not cross a quote on their way to
 * `from`, and the dynamic form refuses a quote immediately before it. Both
 * guards are load-bearing rather than tidy: `scripts/modules/generate.mjs`
 * WRITES `'import type { ModuleEntry } from "./types";\n'` into files that land
 * in `lib/modules/`, and a laxer reader resolved those specifiers against the
 * generator's own folder and reported five imports that do not exist.
 */
function relativeImports(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*import\s+(?:[^'";]*?from\s*)?["'](\.[^"']*)["']/gm,
    /^\s*export\s+(?:\*|\{[^'";]*?\})\s+from\s*["'](\.[^"']*)["']/gm,
    /(?<!['"`])\bimport\s*\(\s*(?:\/\*[^*]*\*\/\s*)?["'](\.[^"']*)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

describe("the walk is not empty", () => {
  it("reads the command layer", () => {
    // Without this the assertion below passes on a loop that never runs.
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES).toContain("run.mjs");
    expect(FILES).toContain(join("scripts", "dev", "smoke.mjs"));
    // And the module half, which is the one that was missing.
    expect(FILES).toContain(join("modules", "api", "check.mjs"));
  });

  it("finds imports that are really there", () => {
    const smoke = readFileSync(join(ROOT, "scripts", "dev", "smoke.mjs"), "utf8");
    expect(relativeImports(smoke)).toContain("./log-errors.mjs");
  });
});

describe("every relative import resolves to a file", () => {
  it("has no dangling specifier in run.mjs or scripts/", () => {
    const dangling: string[] = [];
    for (const file of FILES) {
      for (const specifier of relativeImports(readFileSync(join(ROOT, file), "utf8"))) {
        const target = resolve(dirname(join(ROOT, file)), specifier);
        if (!existsSync(target)) {
          dangling.push(`${file.split(/[\\/]/).join("/")} → ${specifier}`);
        }
      }
    }
    expect(
      dangling,
      "these commands import a file that is not there. A `scripts/` file is\n" +
        "reached by a person typing a command, so nothing else would notice — the\n" +
        "command simply dies with ERR_MODULE_NOT_FOUND before printing a line.\n" +
        "Both of the ones this test was written for came from moving a file into a\n" +
        "module and leaving the importer behind:\n" +
        dangling.join("\n"),
    ).toEqual([]);
  });
});
