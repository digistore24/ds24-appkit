// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The commands a module adds to `node run.mjs`.
//
// Two properties, and the second is the one with teeth: a module command must
// never replace a core one. `db-migrate` quietly becoming a module's script is
// the kind of failure that is invisible until a deploy.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { moduleCommands } from "./tasks.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const roots: string[] = [];

function app(installed: string[], modules: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "ds24-tasks-"));
  roots.push(root);
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "modules.json"), JSON.stringify({ installed }));
  for (const [id, manifest] of Object.entries(modules)) {
    mkdirSync(join(root, "modules", id), { recursive: true });
    writeFileSync(join(root, "modules", id, "module.json"), JSON.stringify(manifest));
  }
  return root;
}

/** Every fixture needs one; what it says is never what the test is about. */
const SUMMARY = "a fixture module, present only so this test has something to read";

const mod = (id: string, commands: Record<string, { script: string; help: string }>) => ({
  id,
  version: "1.0.0",
  title: { de: id, en: id },
  summary: SUMMARY,
  docs: "docs/modules.md",
  commands,
});

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("what a module contributes", () => {
  it("brings nothing when nothing is installed", () => {
    expect(moduleCommands(app([], {}))).toEqual([]);
  });

  it("resolves a command to its script inside the module", () => {
    const root = app(["community"], {
      community: mod("community", {
        "community-prune": { script: "scripts/prune.mjs", help: "Delete old private messages" },
      }),
    });
    expect(moduleCommands(root)).toEqual([
      {
        name: "community-prune",
        help: "Delete old private messages",
        file: "modules/community/scripts/prune.mjs",
        module: "community",
      },
    ]);
  });

  it("sorts by name, so `run.mjs help` does not reshuffle between runs", () => {
    const root = app(["b", "a"], {
      a: mod("a", { "a-two": { script: "s.mjs", help: "the second one" } }),
      b: mod("b", { "b-one": { script: "s.mjs", help: "the first one" } }),
    });
    expect(moduleCommands(root).map((c) => c.name)).toEqual(["a-two", "b-one"]);
  });
});

describe("a broken arrangement does not take run.mjs down with it", () => {
  it("returns nothing rather than throwing", () => {
    // This runs while BUILDING the command table. A throw here would make
    // `node run.mjs` itself unusable — including `node run.mjs module check`,
    // which is the one command that explains what is wrong.
    const root = app(["gone"], {});
    expect(() => moduleCommands(root)).not.toThrow();
    expect(moduleCommands(root)).toEqual([]);
  });
});

describe("run.mjs really merges them, and guards the core", () => {
  const source = readFileSync(join(ROOT, "run.mjs"), "utf8");

  it("merges module commands into TASKS", () => {
    expect(source).toContain("moduleCommands()");
    expect(source).toMatch(/TASKS\[command\.name\] = \{/);
  });

  it("refuses a module command that would replace a core one", () => {
    // The manifest already demands the module id as a prefix. This is the
    // second lock, and it is the one that would catch a core command renamed
    // later into a module's territory.
    expect(source).toMatch(/Object\.hasOwn\(TASKS, command\.name\)/);
    expect(source).toMatch(/may not replace a core command/);
  });

  it("merges them AFTER the TASKS literal", () => {
    // scripts/docs-coverage.test.ts reads `const TASKS = {` as text and insists
    // every command it finds is documented in the CORE's guidance. A module
    // command is documented by its module — so it must not appear to that
    // parser. Merging before the literal closed would put it there.
    const literalEnd = source.indexOf("\n};", source.indexOf("const TASKS = {"));
    expect(literalEnd).toBeGreaterThan(0);
    expect(source.indexOf("moduleCommands()")).toBeGreaterThan(literalEnd);
  });
});
