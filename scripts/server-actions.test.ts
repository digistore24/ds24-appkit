// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 One line of TypeScript that turns EVERY Server Action in a file into a 500.
//
// In a `"use server"` file, Turbopack's transform collects the module's exports
// into a runtime list — `ensureServerEntryExports([…])` — and then registers
// each one as a Server Action. A type-only re-export of a LOCAL binding:
//
//     import type { ActionState } from "@/lib/action-state";
//     export type { ActionState };          // ← this
//
// survives that collection as a bare identifier. The emitted chunk contains
// `ensureServerEntryExports([i, j, ActionState])`, nothing in it defines
// `ActionState`, and the first POST to ANY action in the file dies with
// `ReferenceError: ActionState is not defined`.
//
// ── Why nothing else can see it ────────────────────────────────────────────
// `npm run typecheck` is clean — the TypeScript is correct. The whole vitest
// suite is green — no test evaluates a built chunk. `node run.mjs smoke` only
// makes GETs, and a Server Action is a POST. It reaches a customer as "every
// button in the app is broken", and it reached one: measured in this template's
// own production build on 2026-08-14, in six files, one of them
// `app/dashboard/chat/actions.ts` — which hangs in the dashboard LAYOUT, so it
// broke every action on every page under it.
//
// ── What is and is not refused, measured rather than assumed ───────────────
// Both forms were built and the emitted chunks read:
//
//   export type { X };                    → `X` in the entry list.  REFUSED
//   export type { X } from "@/…";         → erased entirely.        fine
//   export type X = …;                    → erased entirely.        fine
//
// So the rule is narrow and has a fix that costs one clause: give the re-export
// its `from`. Widening it to "no type re-export at all" would forbid a form
// that provably works.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { blankComments } from "./lib/source-text.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const SCANNED_DIRS = ["app", "lib", "components", "hooks", "modules"];
const SKIP = new Set(["node_modules", ".next", ".dev", "dist", "out"]);

/** Every `.ts`/`.tsx` file under the scanned trees, tests included. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * A type-only re-export with NO `from` clause.
 *
 * Both spellings, because they compile to the same thing:
 *   `export type { A, B };`   and   `export { type A, type B };`
 * A `from` anywhere before the statement's semicolon takes it out of scope.
 */
const LOCAL_TYPE_REEXPORT = /^\s*export\s+(?:type\s*\{[^}]*\}|\{[^}]*\btype\s+[^}]*\})\s*;/gm;

describe('🚨 "use server" files and type re-exports', () => {
  const files = SCANNED_DIRS.flatMap((dir) => {
    const full = path.join(ROOT, dir);
    return statSync(full).isDirectory() ? sourceFiles(full) : [];
  });

  // The walk is allowed to find nothing only if the tree really has nothing —
  // a scan that silently stopped matching would be a green test measuring air.
  it("really looked at the tree", () => {
    expect(files.length).toBeGreaterThan(200);
    const serverFiles = files.filter((file) =>
      /^\s*(?:"use server"|'use server')\s*;/m.test(
        blankComments(readFileSync(file, "utf8")),
      ),
    );
    expect(
      serverFiles.length,
      'no "use server" file found — the directive test has stopped matching',
    ).toBeGreaterThan(5);
  });

  it("re-exports a type only WITH a `from` clause", () => {
    const offenders: string[] = [];

    for (const file of files) {
      // Comments blanked first: this file's own header shows the forbidden
      // form, and a checker that punishes a file for explaining itself gets
      // switched off.
      const source = blankComments(readFileSync(file, "utf8"));
      if (!/^\s*(?:"use server"|'use server')\s*;/m.test(source)) continue;

      for (const match of source.matchAll(LOCAL_TYPE_REEXPORT)) {
        offenders.push(
          `${path.relative(ROOT, file)}: ${match[0].trim().replace(/\s+/g, " ")}`,
        );
      }
    }

    expect(
      offenders,
      'a "use server" file re-exports a type without a `from` clause. ' +
        "Turbopack puts the bare identifier in the module's Server Action " +
        "list, and the first POST to ANY action in that file answers 500 with " +
        "`ReferenceError: <name> is not defined`. Nothing else in this repo " +
        "sees it: typecheck is clean, the suite is green and `smoke` only " +
        'makes GETs. Write it as `export type { X } from "@/…";` instead.',
    ).toEqual([]);
  });
});
