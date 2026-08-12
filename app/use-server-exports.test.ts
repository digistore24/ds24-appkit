// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a `"use server"` file is allowed to export.
//
// The rule is Next's, not ours: **a `"use server"` file may export async
// functions and nothing else.** Every export in such a file becomes a callable
// server endpoint, so there is nothing sensible for the framework to do with a
// constant — it refuses the file outright:
//
//   A "use server" file can only export async functions, found object.
//
// This test exists because of how that failure behaves. `npm run typecheck` is
// green, `npm run test` is green, and `next dev` serves the page perfectly —
// the only thing that notices is `npm run build`, and the message names the
// PAGE that imported the file rather than the file itself. It shipped on main
// for exactly that reason: an `export const EMPTY_AUTO_RELOAD` in
// `app/dashboard/billing/actions.ts`, added alongside the auto-top-up work,
// with every test still passing.
//
// Asserted on the source text, the way `scripts/portability.test.ts` and
// `components/app-shell.test.ts` are: there is no DOM and no build here, so
// looking at the file is the check.
//
// Failing here? Move the value into the client component that uses it — the
// convention in this repo is a local `const EMPTY = { error: null, ok: null }`
// (see `app/dashboard/account/ui.tsx`). A type export is fine and stays: it is
// erased before the file ever runs.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Directories that can hold server actions.
 *
 * ⚠️ **`modules/` belongs here, and its absence let the whole class back in for
 * module code.** Four modules ship server actions — an `actions.ts` each, plus
 * `modules/community/profile-actions.ts` — and they are bundled into the build
 * the moment their module is installed. The failure this file exists for is
 * green typecheck, green tests, green `next dev`, and `next build` failing with
 * an error that names the PAGE rather than the file; nothing about that gets
 * gentler because the file moved.
 *
 * Scanned whether or not a module is installed: an uninstalled module's
 * `"use server"` file is not built, but it is what somebody installs next.
 */
const SEARCHED = ["app", "lib", "components", "hooks", "modules"];

function sourceFilesIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesIn(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

/** The file with comments removed — several of them discuss this very rule. */
/**
 * Is this a whole-file `"use server"`?
 *
 * Only the directive at the TOP of the file makes every export an endpoint. An
 * inline `"use server"` inside a single function (as in
 * `app/dashboard/layout.tsx`) marks that one function and leaves the module's
 * other exports alone — so those files are deliberately not covered.
 */
function isServerActionFile(code: string): boolean {
  const firstStatement = code.trimStart().split("\n")[0]?.trim() ?? "";
  return firstStatement === '"use server";' || firstStatement === "'use server';";
}

/** Export lines that would become a runtime export. */
function valueExports(code: string): string[] {
  return code.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("export")) return false;
    // Erased before runtime — always fine.
    if (/^export\s+(type|interface)\b/.test(trimmed)) return false;
    // The permitted shape, in both its forms.
    if (/^export\s+async\s+function\b/.test(trimmed)) return false;
    if (/^export\s+default\s+async\s+function\b/.test(trimmed)) return false;
    return true;
  });
}

const files = SEARCHED.flatMap((dir) => sourceFilesIn(join(ROOT, dir)))
  .map((file) => ({ file, code: withoutComments(readFileSync(file, "utf8")) }))
  .filter(({ code }) => isServerActionFile(code));

describe('"use server" files', () => {
  it("were found at all", () => {
    // Non-vacuity. A broken detector would make every assertion below pass by
    // examining nothing — which is the failure mode of a source-level test.
    expect(files.length).toBeGreaterThan(3);
  });

  for (const { file, code } of files) {
    const relative = file.slice(ROOT.length);

    it(`${relative}: exports only async functions`, () => {
      expect(
        valueExports(code),
        `${relative} exports something other than an async function.\n` +
          `A "use server" file may not — npm run build fails with\n` +
          `  A "use server" file can only export async functions, found object.\n` +
          `Move the value into the component that uses it.`,
      ).toEqual([]);
    });
  }
});
