// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The module list, and the clamp that keeps its two readers saying the same thing.
//
// There are two on purpose (`lib/modules/installed.ts` explains why: bundled for
// the app, `readFileSync` for bare Node). Two readers of one file is exactly the
// shape that drifts — `lib/privacy/export.test.ts` exists because two readers of
// one question drifted once and answered a subject access request differently.
// So this file measures agreement rather than trusting it.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { installedModules, isModuleInstalled, parseInstalled } from "./installed";
import {
  installedModules as installedFromDisk,
  parseInstalled as parseFromDisk,
} from "@/scripts/modules/installed.mjs";
import { availableModules } from "@/scripts/modules/registry.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("the two readers agree", () => {
  it("returns the same list from the bundle and from the disk", () => {
    expect(installedModules()).toEqual(installedFromDisk());
  });

  it("applies the same rules to the same input", () => {
    // Every case below is fed to BOTH implementations. A rule tightened in one
    // and forgotten in the other is the failure this test exists for.
    const cases: Array<[string, Record<string, unknown>]> = [
      ["an empty list", { installed: [] }],
      ["one module", { installed: ["community"] }],
      ["two modules", { installed: ["chat", "community"] }],
      ["prose alongside", { _comment: "…", installed: ["community"] }],
    ];

    for (const [label, file] of cases) {
      expect(parseInstalled(file, label), label).toEqual(parseFromDisk(file, label));
    }
  });

  it("refuses the same malformed input", () => {
    const refused: Array<[string, unknown]> = [
      ["no installed key", {}],
      ["not an array", { installed: "community" }],
      ["a number in the list", { installed: [1] }],
      ["an id with an upper-case letter", { installed: ["Community"] }],
      ["an id starting with a dash", { installed: ["-community"] }],
      ["an id with a slash", { installed: ["modules/community"] }],
      ["an empty id", { installed: [""] }],
      ["the same module twice", { installed: ["community", "community"] }],
      ["an unknown key", { installed: [], enabled: true }],
    ];

    for (const [label, file] of refused) {
      expect(() => parseInstalled(file as Record<string, unknown>, label), label).toThrow();
      expect(() => parseFromDisk(file as Record<string, unknown>, label), label).toThrow();
    }
  });
});

describe("a malformed list is refused, not guessed", () => {
  // 🚨 The rule that separates this file from every other config reader in the
  // app. `isCommunityEnabled()` answers "should this run" and a doubt falls to
  // OFF. This answers "what is this app made of", and a doubt that falls to
  // "nothing" hides tables the app still holds — which is a subject access
  // request answered with silence. If somebody ever "fixes" this into a
  // fallback, this test is what stops them.
  it("does not fall back to an empty list", () => {
    expect(() => parseInstalled({ installed: "community" }, "x")).toThrow();
    expect(parseInstalled({ installed: [] }, "x")).toEqual([]);
  });

  it("says which file and what was wrong", () => {
    // The person reading this edited the file by hand. A bare "invalid config"
    // sends them looking; the field name and the expected shape do not.
    expect(() => parseInstalled({ installed: [7] }, "config/modules.json")).toThrow(
      /config\/modules\.json.*not a module id/s,
    );
    expect(() => parseInstalled({ nope: 1, installed: [] }, "config/modules.json")).toThrow(
      /unknown key\(s\) "nope"/,
    );
  });
});

describe("isModuleInstalled answers the list, both ways", () => {
  // ⚠️ This describe used to assert two things about the SHIPPED state:
  // `installedModules()` is `[]`, and `isModuleInstalled("community")` is false.
  // Both are true of the template and false of any app that installed a
  // module — so a customer who ran `node run.mjs module add community`, which
  // this template tells them to run, got a red suite reporting a fault that was
  // not one. And the template's own suite could not be run against an installed
  // profile at all, which is what `scripts/modules/profiles.test.ts` needs.
  //
  // The shipped-empty claim did not disappear; it moved to where `template/` is
  // pristine by construction — `scripts/shipped-lists.test.mjs` in the factory,
  // beside the greeting's four inventories, for exactly the reason that file's
  // header spells out. `scripts/deploy-test.mjs` asks it of a really deployed
  // app as well, which is the stronger measurement of the two.
  //
  // What belongs HERE is the function's contract, which holds in every app.
  it("agrees with the list for every module in this tree", () => {
    const installed = installedModules();
    const available = availableModules(ROOT);

    // Non-vacuity: an empty tree would make the loop below assert nothing.
    expect(available.length, "no modules in modules/ at all").toBeGreaterThan(0);

    for (const id of available) {
      expect(isModuleInstalled(id), id).toBe(installed.includes(id));
    }
  });

  it("says no to an id that is not a module in any app", () => {
    // Deliberately not a real module id. The old version asked about
    // "community" and would have been the wrong answer in an app that has it.
    expect(isModuleInstalled("not-a-module-in-any-app")).toBe(false);
  });
});
