// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What an app's OWN page may import from a module, and why it needs a
// registry at all.
//
// `modules/boundary.test.ts` §1 scans `app/` and fails any core file naming
// `@/modules/<installed id>`. A customer's unit page rendering `<ActivityPanel>`
// is exactly such a file — so `docs/learning.md`'s instruction ("render the
// panel on your page") was one no app could follow: doing it turned the
// CUSTOMER's own suite red, about their own page, for a fault that was not
// theirs. It went unnoticed because no field run has had a module installed
// since the four moved under `modules/` on 2026-08-08.
//
// §1's own error message names the way out — everything the core needs from a
// module comes through a generated registry — and `lib/modules/component-registry.ts`
// is it.
//
// ⚠️ **The barrel is CLIENT-SAFE, and that is a property, not a habit.** Every
// file it re-exports carries `"use client"`. A server-side export in here —
// `askCompanion()` is the one that will be proposed — would be dragged into the
// browser graph by any client component importing `useActivity` from the same
// barrel, and `server-only` would turn that into a build failure in an app that
// did nothing wrong. The server half needs its own registry, the way
// `lib/modules/registry.ts` and `lib/modules/nav-registry.ts` are already split.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { expectedGenerated } from "./generate.mjs";
import { availableModules, readModule } from "./registry.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALL: string[] = availableModules(ROOT);

type Manifest = {
  components?: Record<string, string>;
  serverExports?: Record<string, string>;
};

/** Every entry any module offers the app, and which side of the boundary it is on. */
function declared(key: "components" | "serverExports") {
  return ALL.flatMap((id) => {
    const { manifest, dir } = readModule(id, ROOT) as { manifest: Manifest; dir: string };
    return Object.entries(manifest[key] ?? {}).map(([name, file]) => ({
      id,
      name,
      file,
      abs: join(dir, file),
    }));
  });
}

const DECLARED = declared("components");
const SERVER = declared("serverExports");

describe("the components modules offer the app", () => {
  it("found some — otherwise everything below passes on an empty list", () => {
    expect(ALL.length).toBeGreaterThan(1);
    expect(DECLARED.length).toBeGreaterThan(1);
    expect(DECLARED.map((c) => c.name)).toContain("ActivityPanel");
  });

  it("each names a file that is really there", () => {
    // The failure: a module renames its panel and the manifest keeps the old
    // path. The generated barrel then re-exports from nothing, and the first
    // symptom is the customer's page failing to build.
    for (const c of DECLARED) {
      expect(existsSync(c.abs), `${c.id}: "${c.name}" → ${c.file} does not exist`).toBe(true);
    }
  });

  it("each file really exports the name it is declared under", () => {
    for (const c of DECLARED) {
      const source = readFileSync(c.abs, "utf8");
      expect(
        source,
        `${c.id}: ${c.file} does not export "${c.name}" — the generated barrel ` +
          `would re-export a name that is not there`,
      ).toMatch(new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${c.name}\\b`));
    }
  });

  it('🚨 each file is a client component ("use client")', () => {
    // The barrel's client-safety, held as a property. See the file header: a
    // server-side export in here breaks any client component that imports a
    // hook from the same barrel, in an app that did nothing wrong.
    for (const c of DECLARED) {
      // Comments blanked first, then the first statement read — the file's own
      // copyright header sits above the directive, and a regex trying to skip
      // it by hand is the sixteenth copy `scripts/lib/source-text.mjs` exists
      // to prevent.
      const first = blankComments(readFileSync(c.abs, "utf8")).trimStart();
      expect(
        first.slice(0, 13),
        `${c.id}: ${c.file} is offered to the app's pages but does not open with ` +
          `"use client". The barrel is client-safe by construction; a server-side ` +
          `export needs the server-side registry instead.`,
      ).toBe('"use client";');
    }
  });
});

describe("what modules offer the app's SERVER code", () => {
  it("found some — otherwise everything below passes on an empty list", () => {
    expect(SERVER.length).toBeGreaterThan(0);
    expect(SERVER.map((entry) => entry.name)).toContain("askCompanion");
  });

  it("each names a file that really exports that name", () => {
    for (const entry of SERVER) {
      expect(existsSync(entry.abs), `${entry.id}: ${entry.file} does not exist`).toBe(true);
      expect(
        readFileSync(entry.abs, "utf8"),
        `${entry.id}: ${entry.file} does not export "${entry.name}"`,
      ).toMatch(new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${entry.name}\\b`));
    }
  });

  it('🚨 none of them is a client component — that is the whole split', () => {
    // The two barrels exist separately because importing any name from one
    // pulls its whole graph. A `"use client"` file here would be reachable from
    // the server barrel, and worse: a server file in the CLIENT barrel would be
    // dragged into the browser by a component importing a hook beside it.
    for (const entry of SERVER) {
      const first = blankComments(readFileSync(entry.abs, "utf8")).trimStart();
      expect(
        first.slice(0, 13),
        `${entry.id}: ${entry.file} is offered to the app's server code and opens with ` +
          `"use client". It belongs in "components", not "serverExports".`,
      ).not.toBe('"use client";');
    }
  });

  it("🚨 no name is in both barrels", () => {
    // An app importing `Foo` should not have to know which of the two it comes
    // from — and a name in both would generate two exports the bundler resolves
    // by position. `loadModules()` refuses it across modules; this is the same
    // rule inside one.
    const overlap = DECLARED.map((c) => c.name).filter((name) =>
      SERVER.some((s) => s.name === name),
    );
    expect(overlap, `declared on both sides of the client boundary: ${overlap.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("the generated barrel", () => {
  const withAll = expectedGenerated(ROOT, ALL).get("lib/modules/component-registry.ts") ?? "";
  const empty = expectedGenerated(ROOT, []).get("lib/modules/component-registry.ts") ?? "";

  it("re-exports every declared name when every module is installed", () => {
    expect(withAll.length).toBeGreaterThan(0);
    for (const c of DECLARED) {
      expect(withAll).toContain(`export { ${c.name} } from "@/modules/${c.id}/`);
    }
  });

  it("is a valid empty module when nothing is installed", () => {
    // `export {}` rather than nothing at all: a file with no statement is not a
    // module, and importing from it is a different error than importing a name
    // that is not there.
    expect(empty).toContain("export {};");
    expect(empty).not.toMatch(/^export \{ \w/m);
  });
});
