// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The community's shell is a DAG, and one import puts it back.
//
// This module was one file of 5,902 lines — eleven domains, 18 helpers reaching
// across their boundaries and three circular pairs among them. It is now one
// file per domain plus five `_`-prefixed helper files, each of which exists to
// dissolve a cycle or to give a helper with four consumers a home.
//
// ⚠️ **Nothing about that survives on its own.** A cycle between two shell
// files does not fail `npm run typecheck` and does not fail a test: ES modules
// hoist function declarations, so `a → b → a` runs. It shows up later, as an
// `undefined` during initialisation on the one import order a bundler picks, or
// as a module that cannot be reasoned about. So it is asserted here.
//
// Measured while building the split, and the reason this file is not optional:
// the first generated version had FIVE cycles. Four of them were not real —
// the generator computed sibling imports over source that still had its
// comments, so `_access.ts` imported `groupsFor` because its own doc comment
// names it. Blanking the comments left one real cycle (`_post-images ↔ talk`,
// over `POST_IMAGE_SLOT`, which was in the wrong file), and moving that
// constant closed it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { shellFiles } from "./_shell-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Which shell file imports which other, read off the real `import` lines. */
function edges(): Map<string, Set<string>> {
  const own = new Set(shellFiles().map(([path]) => path.split("/").pop()!.replace(/\.ts$/, "")));
  const out = new Map<string, Set<string>>();
  for (const [path] of shellFiles()) {
    const name = path.split("/").pop()!.replace(/\.ts$/, "");
    const text = readFileSync(join(HERE, `${name}.ts`), "utf8");
    const to = new Set<string>();
    for (const m of text.matchAll(/from "\.\/([\w-]+)(?:\.mjs)?"/g)) {
      if (own.has(m[1]) && m[1] !== name) to.add(m[1]);
    }
    out.set(name, to);
  }
  return out;
}

/** Every cycle reachable in that graph, as a readable path. */
function cyclesIn(g: Map<string, Set<string>>): string[] {
  const state = new Map<string, "open" | "closed">();
  const found: string[] = [];
  const walk = (n: string, path: string[]) => {
    if (state.get(n) === "closed") return;
    if (state.get(n) === "open") {
      found.push([...path.slice(path.indexOf(n)), n].join(" → "));
      return;
    }
    state.set(n, "open");
    for (const next of g.get(n) ?? []) walk(next, [...path, n]);
    state.set(n, "closed");
  };
  for (const n of g.keys()) walk(n, []);
  return found;
}

describe("the community's shell files form a layering", () => {
  it("has files to check", () => {
    // The count guard. A rename that emptied `shellFiles()` would make every
    // assertion below pass by describing nothing — which is the failure this
    // module's own guard tests were written against, turned on itself.
    expect(shellFiles().length, "no shell files found").toBeGreaterThan(8);
  });

  it("🚨 has no import cycle", () => {
    expect(
      cyclesIn(edges()),
      "two shell files import each other. This does not fail typecheck and does " +
        "not fail a test — ES modules hoist function declarations, so it runs. " +
        "Move whatever they share into a file below both; the five `_`-prefixed " +
        "files are each the answer to exactly this question.",
    ).toEqual([]);
  });

  it("🚨 the walk can SEE a cycle", () => {
    // The needle. "This list is empty" is also what a graph that parsed nothing
    // produces, and that is how a guard quietly stops guarding.
    const fake = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
      ["c", new Set<string>()],
    ]);
    expect(cyclesIn(fake)).toEqual(["a → b → a"]);
    expect(cyclesIn(new Map([["a", new Set(["c"])], ["c", new Set<string>()]]))).toEqual([]);
  });

  it("reads real edges — the graph is not empty either", () => {
    const g = edges();
    const total = [...g.values()].reduce((n, s) => n + s.size, 0);
    expect(total, "no import between shell files found — did the parse break?").toBeGreaterThan(10);
  });

  it("keeps `manage.ts` a barrel — no logic came back into it", () => {
    // The split's other half. A function added here instead of to a domain file
    // is how 5,902 lines happened the first time.
    const barrel = readFileSync(join(HERE, "manage.ts"), "utf8");
    const code = barrel.split("\n").filter((l) => !l.startsWith("//") && l.trim());
    expect(
      code.every((l) => l.startsWith("export ")),
      "manage.ts has a line that is not a re-export — it is a barrel",
    ).toBe(true);
  });
});
