// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Resolving an import specifier the way a WALKER needs it: one answer that
// keeps "not our path" and "our path, nothing there" apart.
//
// Three tests in this tree assert something about a file's transitive static
// import graph, and each one walked that graph itself:
//
//   · `scripts/mcp/no-db.test.ts`         — the MCP server opens no database
//   · `scripts/modules/data-gate.test.ts` — a module command reaches no npm package
//   · `scripts/core/purity.test.ts`       — the shared core imports nothing impure
//
// ── Why this file exists: a guarantee narrower than its own claim ──────────
// Two of the three stopped at the first non-relative specifier —
// `if (!specifier.startsWith(".")) continue;`, with the comment "npm package or
// alias — not walked". So an `@/`-aliased import ENDED the walk, and everything
// reachable only through it sat outside a guarantee that says "transitively".
// `no-db.test.ts` names `@/db` and `@/db/schema` in its own forbidden list, so
// the file already expected the alias to turn up — through a walk that could not
// have followed it.
//
// Measured on this tree before the fix, and written down because a zero has to
// be a result rather than an assumption: no `.mjs` file under `scripts/` carries
// a real `@/` import, so neither `.mjs` walk grew by a single file. That is
// Node, not style — `@/` is a `tsconfig.json` path mapping and a
// `vitest.config.ts` alias, and neither exists at Node's ESM runtime, so such an
// import would fail loudly at the first invocation. The widening is therefore
// prophylactic there and a consolidation in `purity.test.ts`, which had the only
// correct copy.
//
// ── Three answers, never two ──────────────────────────────────────────────
// `null` is "not our path at all" — npm's and Node's business. `{ exists: false }`
// is "our path, and nothing is on disk". Collapsing those two is the same
// mistake the module gate is built against: *"I could not look"* and *"there is
// nothing there"* must not be the same answer. `purity.test.ts` reports the
// second by name so its failure says what it could not find; the two `.mjs`
// walkers skip it rather than throwing an `ENOENT` in place of a finding.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The suffixes probed after the bare path, in order.
 *
 * The ordered union of what the three callers probed separately —
 * `["", ".mjs", ".js", "/index.mjs"]` in `no-db.test.ts` and
 * `["", ".ts", ".tsx", ".mjs", ".json", "/index.ts"]` in `purity.test.ts`.
 * `""` IS the bare path, which is why it leads: a specifier that names its own
 * suffix must never be shadowed by a sibling that only guesses one.
 *
 * Order matters only where two files share a stem, and in this tree they do not
 * — `.mjs` and `.ts` never do, by convention. A caller that needs a narrower
 * list passes `extensions`.
 */
export const DEFAULT_IMPORT_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".json",
  "/index.ts",
  "/index.mjs",
];

/**
 * Is this specifier one of OURS — an alias or a relative path?
 *
 * `false` for `node:fs`, `postgres` and `@scope/pkg` alike. ⚠️ `@/` and
 * `@scope/` both start with `@`, which is why the alias test carries the slash.
 *
 * The relative half is `startsWith(".")` rather than a `./` + `../` pair: it is
 * what the two `.mjs` walkers already asked, and it is the only form that also
 * answers for `.` and `..`. Nothing in this tree imports either, and no other
 * specifier may legally begin with a dot in either toolchain — so the two
 * spellings are the same set here, and this is the wider of them.
 *
 * @param {string} specifier
 * @returns {boolean}
 */
export function isOwnSpecifier(specifier) {
  return specifier.startsWith("@/") || specifier.startsWith(".");
}

/**
 * Where an import specifier points, and whether anything is there.
 *
 * @param {string} fromFile absolute path of the importing file
 * @param {string} specifier the specifier as written
 * @param {{ root: string, extensions?: string[] }} options `root` is the app
 *   root the `@/` alias resolves against, and it is always passed — three
 *   callers derive it three different ways, so a helper that guessed would be
 *   right in one of them.
 * @returns {{ path: string, exists: boolean } | null} `null` when the specifier
 *   is not ours. Otherwise an ABSOLUTE path: the file that was found, or — when
 *   nothing was — the bare attempt, so a caller can name it.
 */
export function resolveImport(fromFile, specifier, { root, extensions } = {}) {
  if (!root) throw new Error("resolveImport needs a root — see scripts/lib/import-graph.mjs");

  let base;
  if (specifier.startsWith("@/")) {
    base = join(root, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }

  for (const suffix of extensions ?? DEFAULT_IMPORT_EXTENSIONS) {
    // `resolve()` around the concatenation, not for tidiness: the `/index.…`
    // suffixes carry a forward slash, and on Windows `base` carries backslashes.
    // Node tolerates the mixture when it OPENS a path; a caller that later
    // splits the answer on `path.sep` does not.
    const candidate = resolve(base + suffix);
    if (existsSync(candidate)) return { path: candidate, exists: true };
  }
  return { path: base, exists: false };
}
