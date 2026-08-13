// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A module's presence check is on the CONTENT PLAN's code path, and the plan
// may not be able to write.
//
// `lib/content/applier-plan.test.ts` makes that claim for the core and makes it
// well: it walks the import closure of `lib/content/applier-plan.ts` and
// `lib/content/media-presence.ts` and asserts that nothing in it can call
// `store.put()`, `store.copy()` or `store.remove()`. What it cannot see is the
// half the core does not own. `lib/content/presence.ts` loads
// `@/lib/modules/presence-registry`, that file is GENERATED from
// `config/modules.json`, and this tree ships `{ "installed": [] }` — so in the
// factory the registry is empty and the core's walk reaches no module at all.
// Every module's presence check was therefore outside every measurement in the
// tree, in the exact shape `CLAUDE.md` warns about: a predicate that holds
// because of what the template SHIPS rather than because of what it forbids.
//
// It cost what that costs. `modules/community/presence/check.ts` imported
// `listGroups()` from its own `lib/manage.ts` — 5900 lines, which import
// `@/lib/media/manage`, which calls `store.copy()` and `store.remove()`. The
// module shipped that way, and the first developer to install it had a
// permanently red `npm run test` and a `.githooks/pre-commit` that could not go
// green again (reported 2026-08-12). Nothing here was red; the claim was simply
// never asked of the files that broke it.
//
// So this file asks it of every module in the TREE, installed or not. That is
// the point: an app installs a module long after the module was written, and
// the answer must not depend on which app happens to be running the suite.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The write half of the media store, as `applier-plan.test.ts` spells it. */
const WRITES = /\bstore\s*\.\s*(put|copy|remove)\s*\(/;

/**
 * The one specifier under `lib/media/` a plan may address.
 *
 * The same licence the core gets, and for the same reason: `head()` answers
 * "is the declared file really in the bucket", and it lives on the same object
 * as `put()`. Anything else under `lib/media/` is a second way in.
 */
const LICENSED_MEDIA = "@/lib/media/store";

/**
 * Static, value-carrying imports.
 *
 * ⚠️ `import type` is dropped, and that is not a convenience. A type import is
 * erased before anything runs, so it can reach no writing method — and every
 * module's presence check declares `import type { PresenceContributor } from
 * "@/lib/content/presence"`. Following it would walk back into the CORE's own
 * presence machinery and report `lib/media/store` against every module in the
 * tree: a finding about this file's regex, not about any module.
 */
function valueImports(source: string): string[] {
  const code = blankComments(source);
  const value = new Set<string>();
  // `import … from "x"` and `export … from "x"`, minus the `type` forms. A
  // specifier that is type-only on one line and value-carrying on another is a
  // VALUE import: the value line is the one that emits.
  const withBindings = /\b(?:import|export)\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/g;
  for (const match of code.matchAll(withBindings)) value.add(match[1]);
  // `import "x"` for its side effects — no bindings, and it certainly emits.
  for (const match of code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) value.add(match[1]);
  return [...value];
}

/**
 * ⚠️ `resolveImport()` probes the bare path first, so `@/db` answers with the
 * DIRECTORY, and reading that is an `EISDIR`. The core's walk needs the second
 * probe for the same reason — without it the walk stops at exactly the
 * specifier it most wants to follow.
 */
function fileFor(from: string, specifier: string): string | null {
  const target = resolveImport(from, specifier, { root: ROOT });
  if (target?.exists && !statSync(target.path).isDirectory()) return target.path;
  const indexed = resolveImport(from, specifier, {
    root: ROOT,
    extensions: ["/index.ts", "/index.mjs"],
  });
  return indexed?.exists ? indexed.path : null;
}

function closureOf(entry: string): { files: string[]; specifiers: string[] } {
  const seen = new Set<string>();
  const specifiers: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const specifier of valueImports(readFileSync(file, "utf8"))) {
      specifiers.push(specifier);
      const target = fileFor(file, specifier);
      if (target) queue.push(target);
    }
  }
  return { files: [...seen], specifiers };
}

/** Every module in the TREE — never `config/modules.json`, which ships empty. */
const MODULES = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((id) => existsSync(join(ROOT, "modules", id, "presence", "check.ts")))
  .sort();

describe("🚨 no module's presence check can write to the media store", () => {
  it("found the modules to ask about at all", () => {
    // 🚨 A count guard, not decoration. This whole file is the answer to a
    // measurement that was vacuous because its input was empty; an empty
    // `MODULES` would make every assertion below green having asked nothing.
    // Four modules declare a presence check today (`api`, `courses`,
    // `activity`, `community`); the floor sits below that on purpose, so a
    // fifth module needs no edit here while a renamed directory still fails.
    expect(MODULES.length, "no module presence check was found under modules/").toBeGreaterThan(2);
  });

  it("the forbidden pattern is findable in real source, or it proves nothing", () => {
    // The needle probe for the regex itself. `lib/media/manage.ts` is the file
    // the community's chain actually reached, and it really does call the
    // writing half — so a pattern that matched nothing anywhere would be a
    // green test measuring its own typo.
    expect(
      WRITES.test(blankComments(readFileSync(join(ROOT, "lib/media/manage.ts"), "utf8"))),
      "lib/media/manage.ts no longer calls store.put/copy/remove — this probe needs a new file",
    ).toBe(true);
  });

  describe.each(MODULES)("%s", (id) => {
    const { files, specifiers } = closureOf(join(ROOT, "modules", id, "presence", "check.ts"));

    it("the walk actually left the entry file", () => {
      // Non-vacuity per module: a walk that resolved nothing would satisfy both
      // assertions below having read a single file.
      expect(
        files.map((file) => relative(ROOT, file)),
        `the import walk never got past modules/${id}/presence/check.ts`,
      ).not.toHaveLength(1);
      expect(specifiers.length).toBeGreaterThan(1);
    });

    it("reaches nothing under lib/media/ but the store's front door", () => {
      const hit = [...new Set(specifiers.filter((s) => /(^|\/)lib\/media\//.test(s)))];
      expect(
        hit.filter((s) => s !== LICENSED_MEDIA),
        `modules/${id}/presence/check.ts reaches ${hit.join(", ")}. A presence check ` +
          `COUNTS; it has no business addressing the media store's configuration, its ` +
          `rules, its URLs or its upload doors. Import the one query it needs — or write ` +
          `it — rather than the module's whole lib/manage.ts.`,
      ).toEqual([]);
    });

    it("calls nothing that writes an object, anywhere in that closure", () => {
      const offenders = files
        .filter((file) => WRITES.test(blankComments(readFileSync(file, "utf8"))))
        .map((file) => relative(ROOT, file));
      expect(
        offenders,
        `modules/${id}/presence/check.ts reaches ${offenders.join(", ")}, which write to ` +
          `the media store. The content plan may look and not touch — ` +
          `lib/content/applier-plan.test.ts makes that claim for the core, and an ` +
          `installed module inherits the claim without inheriting the guard.`,
      ).toEqual([]);
    });
  });
});
