// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where `config/modules.json` and the manifests meet — and every way that can
// go wrong.
//
// No module has moved into `modules/` yet, so this builds real ones in a
// throwaway folder instead of walking the tree. That is the only way to
// exercise the cross-module collisions, which are invisible inside a single
// manifest and fatal across two.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  availableModules,
  dependantsOf,
  loadModules,
  missingRequires,
  readModule,
  templateTooOld,
} from "./registry.mjs";

let root: string;
const roots: string[] = [];

/** A throwaway app root with a `config/modules.json` and the given modules. */
function app(installed: string[], modules: Record<string, unknown> = {}) {
  root = mkdtempSync(join(tmpdir(), "ds24-modules-"));
  roots.push(root);
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "modules.json"), JSON.stringify({ installed }));
  for (const [id, manifest] of Object.entries(modules)) {
    mkdirSync(join(root, "modules", id), { recursive: true });
    if (manifest !== null) {
      writeFileSync(join(root, "modules", id, "module.json"), JSON.stringify(manifest));
    }
  }
  return root;
}

/** Every fixture needs one; what it says is never what the test is about. */
const SUMMARY = "a fixture module, present only so this test has something to read";

/** The smallest legal manifest. */
const tiny = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  version: "1.0.0",
  title: { de: id, en: id },
  summary: SUMMARY,
  docs: "docs/modules.md",
  ...extra,
});

/** One that owns tables, so the GDPR wiring is present and can be collided. */
const withTables = (id: string, tables: string[]) =>
  tiny(id, {
    schema: "schema.ts",
    tables,
    tablePrefix: `${id}_`,
    migrations: "drizzle",
    migrationsTable: `__drizzle_migrations_${id}`,
    privacy: { sections: [`${id}Rows`], ts: "privacy/sections.ts", mjs: "privacy/sections.mjs" },
    erase: true,
  });

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("reading what is there", () => {
  it("returns nothing for an app with no modules", () => {
    expect(loadModules(app([]))).toEqual([]);
    expect(availableModules(app([]))).toEqual([]);
  });

  it("loads an installed module", () => {
    const dir = app(["forum"], { forum: tiny("forum") });
    const [record] = loadModules(dir);
    expect(record.id).toBe("forum");
    expect(record.dir).toBe("modules/forum");
    expect(record.manifest.version).toBe("1.0.0");
  });

  it("keeps the order config/modules.json gives", () => {
    // Not cosmetic: the generated registry's import order is this order, and a
    // list that reshuffles itself between runs makes the generated file churn.
    const dir = app(["community", "forum"], { forum: tiny("forum"), community: tiny("community") });
    expect(loadModules(dir).map((m) => m.id)).toEqual(["community", "forum"]);
  });

  it("lists what is present but not installed", () => {
    // `module list` has to tell "here and switched off" from "not here at all".
    const dir = app([], { forum: tiny("forum"), community: tiny("community") });
    expect(availableModules(dir)).toEqual(["community", "forum"]);
    expect(loadModules(dir)).toEqual([]);
  });
});

describe("an app that claims what it does not carry", () => {
  it("refuses an installed module with no folder", () => {
    // The failure this exists for: a registry with a hole in it, and every gate
    // green because the hole is simply absent.
    expect(() => loadModules(app(["community"]))).toThrow(/There is no module "community"/);
  });

  it("refuses a folder with no manifest", () => {
    expect(() => loadModules(app(["forum"], { forum: null }))).toThrow(/no module\.json/);
  });

  it("refuses a manifest that does not parse", () => {
    const dir = app(["forum"], { forum: tiny("forum") });
    writeFileSync(join(dir, "modules", "forum", "module.json"), "{ nope");
    expect(() => loadModules(dir)).toThrow(/not valid JSON/);
  });

  it("refuses a manifest whose id disagrees with its folder", () => {
    // The folder is the address every generated import uses.
    const dir = app(["forum"], { forum: tiny("community") });
    expect(() => loadModules(dir)).toThrow(/the folder name is the id/);
  });

  it("passes an incoherent manifest straight through with its reasons", () => {
    const dir = app(["forum"], { forum: { id: "forum", version: "nope", title: {} } });
    expect(() => loadModules(dir)).toThrow(/problem\(s\) in modules\/forum\/module\.json/);
  });
});

describe("🚨 two modules cannot own the same thing", () => {
  // Each of these is invisible inside a single manifest. They are the reason
  // this check lives above the manifest rather than inside it.
  it("refuses two modules claiming one table", () => {
    const dir = app(["a", "b"], {
      a: withTables("a", ["a_rows"]),
      // b declares a's table — a prefix mismatch inside b, and a collision across.
      b: { ...withTables("b", ["b_rows"]), tables: ["b_rows", "a_rows"], tablePrefix: "" },
    });
    expect(() => loadModules(dir)).toThrow();
  });

  it("refuses two modules claiming one route subtree", () => {
    const dir = app(["a", "b"], {
      a: tiny("a", { app: ["dashboard/shared"] }),
      b: tiny("b", { app: ["dashboard/shared"] }),
    });
    expect(() => loadModules(dir)).toThrow(/route subtree "dashboard\/shared"/);
  });

  it("refuses two modules claiming one nav feature key", () => {
    const dir = app(["a", "b"], {
      a: tiny("a", { features: ["shared"] }),
      b: tiny("b", { features: ["shared"] }),
    });
    expect(() => loadModules(dir)).toThrow(/nav feature key "shared"/);
  });

  // ⚠️ The two below need ids where one is a PREFIX of the other, and that is
  // the whole point. The per-manifest rules ("a namespace starts with the
  // module id", "a command starts with the module id") already stop the obvious
  // collision — so the only way two legal manifests can still collide is when
  // "abx" is a legal name for module `ab` and also for module `abx`. A first
  // draft of these tests used ids that collided in neither direction and passed
  // for the wrong reason.
  it("refuses two modules claiming one message namespace", () => {
    // A collision here would have one module's texts silently overwrite the
    // other's at merge time.
    const dir = app(["ab", "abx"], {
      ab: tiny("ab", { messages: { namespaces: ["abx"], dir: "messages" } }),
      abx: tiny("abx", { messages: { namespaces: ["abx"], dir: "messages" } }),
    });
    expect(() => loadModules(dir)).toThrow(/message namespace "abx"/);
  });

  it("refuses two modules claiming one command", () => {
    const dir = app(["ab", "ab-x"], {
      ab: tiny("ab", { commands: { "ab-x": { script: "s.mjs", help: "does a thing" } } }),
      "ab-x": tiny("ab-x", { commands: { "ab-x": { script: "s.mjs", help: "does a thing" } } }),
    });
    expect(() => loadModules(dir)).toThrow(/command "ab-x"/);
  });

  it("names both modules in the message", () => {
    // Whoever hits this has two folders open and needs to know which two.
    const dir = app(["a", "b"], {
      a: tiny("a", { app: ["dashboard/x"] }),
      b: tiny("b", { app: ["dashboard/x"] }),
    });
    expect(() => loadModules(dir)).toThrow(/"a".*"b"|"b".*"a"/);
  });
});

describe("a declared dependency must actually be installed", () => {
  it("refuses a requirement that is not there", () => {
    // Otherwise the module runs against a half of itself it cannot see.
    const dir = app(["b"], { b: tiny("b", { requires: ["a"] }), a: tiny("a") });
    expect(() => loadModules(dir)).toThrow(/requires "a", which is not installed/);
  });

  it("accepts one that is", () => {
    const dir = app(["a", "b"], { a: tiny("a"), b: tiny("b", { requires: ["a"] }) });
    expect(loadModules(dir).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("readModule on its own", () => {
  it("reads a module that is present but not installed", () => {
    // `module add` needs this: it validates a module BEFORE putting it in the list.
    const dir = app([], { forum: tiny("forum") });
    expect(readModule("forum", dir).id).toBe("forum");
  });
});

// ── the two decisions `module add` / `module remove` make BEFORE writing ─────
//
// 🚨 Extracted from `cli.mjs` because the command used to make the first one
// too late. `add()` wrote `config/modules.json` and only then reached
// `writeGenerated()`, where `loadModules()`'s refusal lives — so it printed an
// error, exited 1, and left the module IN the list with no generated file
// rewritten; `module list` reported it as installed. Measured on 2026-08-12,
// the day `courses` first declared `requires`. Pure functions here, so the
// refusal can be checked one case at a time instead of by spawning a CLI.

describe("missingRequires", () => {
  it("is empty for a module that declares nothing", () => {
    expect(missingRequires(tiny("a"), [])).toEqual([]);
  });

  it("is empty once the dependency is installed", () => {
    expect(missingRequires(tiny("b", { requires: ["a"] }), ["a"])).toEqual([]);
  });

  it("names what is missing, in the manifest's order", () => {
    expect(missingRequires(tiny("c", { requires: ["a", "b"] }), ["b"])).toEqual(["a"]);
    expect(missingRequires(tiny("c", { requires: ["a", "b"] }), [])).toEqual(["a", "b"]);
  });

  it("treats a malformed `requires` as none rather than throwing", () => {
    // The manifest validator already refuses this shape; a reader reached with
    // it anyway must not take the command down on its way to saying so.
    expect(missingRequires(tiny("d", { requires: "a" }), [])).toEqual([]);
  });
});

describe("templateTooOld", () => {
  /** A throwaway root whose package.json says `version`. */
  const at = (version: string) => {
    const dir = app([], { a: tiny("a") });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
    return dir;
  };

  it("says nothing when the module declares no floor", () => {
    // The key is optional, and a module without one runs anywhere. Answering
    // with a sentence here would refuse every module written before the key
    // existed.
    expect(templateTooOld(tiny("a"), at("0.28.0"))).toBeNull();
  });

  it("says nothing when the app is new enough — including exactly on the floor", () => {
    expect(templateTooOld(tiny("a", { requiresTemplate: "0.19.0" }), at("0.28.0"))).toBeNull();
    expect(templateTooOld(tiny("a", { requiresTemplate: "0.28.0" }), at("0.28.0"))).toBeNull();
  });

  it("names both numbers when the app is too old", () => {
    expect(templateTooOld(tiny("a", { requiresTemplate: "0.60.0" }), at("0.28.0"))).toBe(
      "needs template 0.60.0, this app is 0.28.0",
    );
  });

  it("compares numerically rather than as strings", () => {
    // The trap `versionAtLeast()` exists for: "0.9.0" > "0.10.0" as text, and a
    // string comparison would refuse a module on an app that is newer than it
    // asked for — the direction nobody would think to check.
    expect(templateTooOld(tiny("a", { requiresTemplate: "0.9.0" }), at("0.10.0"))).toBeNull();
    expect(templateTooOld(tiny("a", { requiresTemplate: "0.10.0" }), at("0.9.0"))).toBe(
      "needs template 0.10.0, this app is 0.9.0",
    );
  });

  it("ignores a malformed floor rather than throwing", () => {
    // manifestProblems() already refuses a `requiresTemplate` that is not a
    // version. A reader reached with one anyway must not take the command down
    // on its way to saying so — same rule as missingRequires above.
    expect(templateTooOld(tiny("a", { requiresTemplate: 19 }), at("0.28.0"))).toBeNull();
  });
});

describe("dependantsOf", () => {
  it("is empty when nobody depends on it", () => {
    const dir = app(["a", "b"], { a: tiny("a"), b: tiny("b") });
    expect(dependantsOf("a", ["a", "b"], dir)).toEqual([]);
  });

  it("names the installed module that would break", () => {
    const dir = app(["a", "b"], { a: tiny("a"), b: tiny("b", { requires: ["a"] }) });
    expect(dependantsOf("a", ["a", "b"], dir)).toEqual(["b"]);
  });

  it("ignores a dependant that is NOT installed", () => {
    // Present in the tree and not part of this app: removing `a` breaks nothing
    // that is running, and refusing on it would make a module impossible to
    // remove because of one somebody never installed.
    const dir = app(["a"], { a: tiny("a"), b: tiny("b", { requires: ["a"] }) });
    expect(dependantsOf("a", ["a"], dir)).toEqual([]);
  });

  it("never reports the module as its own dependant", () => {
    const dir = app(["a"], { a: tiny("a", { requires: ["a"] }) });
    expect(dependantsOf("a", ["a"], dir)).toEqual([]);
  });

  it("🚨 counts a manifest it cannot READ as a dependant", () => {
    // "I could not look" and "it does not depend on this" must not be the same
    // answer. Of the two ways to be wrong, refusing to remove is the one that
    // can be undone.
    const dir = app(["a", "broken"], { a: tiny("a"), broken: null });
    expect(dependantsOf("a", ["a", "broken"], dir)).toEqual(["broken"]);
  });
});
