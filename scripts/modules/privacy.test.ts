// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A module's Art. 15 answer, and the clamp on its two halves.
//
// A module with tables owes an answer in BOTH exports — the member's own
// download and the operator's command — and they are two files because the
// command is bare Node with no bundler and no TypeScript. Two files answering
// one question is exactly the shape that drifts.
//
// It has drifted here before. The core's two exports once gated the community
// sections on different predicates (`isCommunityEnabled()` against a local
// `.enabled === true`), and a single typo in a config file made a member's own
// download claim the app held no community data while the operator's command
// returned every row: two answers to one Art. 15 request, with every gate
// green. `lib/privacy/export.test.ts` carries that account in full.
//
// So the manifest declares the sections once, both halves declare them again,
// and this compares all three.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadModules } from "./registry.mjs";
import { installedModules } from "./installed.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const records = installedModules(ROOT).length > 0 ? loadModules(ROOT) : [];
const withPrivacy = records.filter((r) => r.manifest.privacy);

describe("🚨 both halves declare exactly what the manifest declares", () => {
  it(`checks the ${withPrivacy.length} module(s) that answer Art. 15`, async () => {
    for (const { id, dir, manifest } of withPrivacy) {
      const declared = [...(manifest.privacy as { sections: string[] }).sections].sort();
      const privacy = manifest.privacy as { ts: string; mjs: string };

      const app = await import(/* @vite-ignore */ `@/${dir}/${privacy.ts}`);
      const cli = await import(/* @vite-ignore */ `@/${dir}/${privacy.mjs}`);

      expect(
        [...(app.default?.sections ?? app.sections ?? [])].sort(),
        `${dir}/${privacy.ts} declares different sections from its manifest`,
      ).toEqual(declared);
      expect(
        [...(cli.sections ?? [])].sort(),
        `${dir}/${privacy.mjs} declares different sections from its manifest — the operator's ` +
          `command and the member's own download would answer one request differently`,
      ).toEqual(declared);
    }
  });
});

describe("🚨 neither half consults whether the module is switched on", () => {
  // The rule the core learned the hard way, applied to every module: switching
  // a module off DELETES nothing, so an export must not be a function of a
  // switch. The only thing that may make a section absent is the module being
  // ABSENT — and `module remove` refuses while its tables hold rows, so absent
  // code and absent data stay the same statement.
  it("names no enablement check in either contributor", () => {
    for (const { id, dir, manifest } of withPrivacy) {
      const privacy = manifest.privacy as { ts: string; mjs: string };
      for (const file of [privacy.ts, privacy.mjs]) {
        // Comments stripped: a contributor may EXPLAIN this rule while obeying
        // it, and a test that cannot tell a call from the sentence about it
        // makes the explanation impossible to write.
        const code = blankComments(read(join(dir, file)));
        expect(
          code,
          `${dir}/${file} consults enablement. An export says what the app HOLDS; a section ` +
            `that appears and vanishes with a config flag describes the PRODUCT instead.`,
        ).not.toMatch(/isEnabled|\.enabled\b|configProblems/);
      }
    }
  });
});

describe("both exports do the merge, and from one source", () => {
  it("the member's own download merges module sections", () => {
    const source = read("lib/privacy/export.ts");
    expect(source).toContain("...moduleSections");
    expect(source).toMatch(/for \(const mod of MODULES\)/);
  });

  it("the operator's command merges the same ones", () => {
    const source = read("scripts/privacy/export-data.mjs");
    expect(source).toMatch(/\.\.\.\(await moduleExportSections\(sql, memberId\)\)/);
  });

  it("neither keeps its own list of module sections", () => {
    // The whole reason a module cannot be in one export and missing from the
    // other: they do not each maintain a list, they read the manifests.
    const inventory = read("scripts/modules/inventory.mjs");
    expect(inventory).toContain("export function moduleDeclaredSections");
    expect(read("lib/privacy/export.test.ts")).toContain("moduleDeclaredSections()");
  });

  it("asks the modules BEFORE assembling the file", () => {
    // An Art. 15 answer is whole or it is an error, never partial — a module
    // that throws must do so before half a file exists.
    const source = read("lib/privacy/export.ts");
    const ask = source.indexOf("await mod.privacy.build(memberId)");
    const assemble = source.indexOf("return {");
    expect(ask).toBeGreaterThan(0);
    expect(assemble).toBeGreaterThan(ask);
  });

  it("🚨 fails loudly on a module whose contributor is broken", () => {
    // A subject access request answered with a section missing is worse than
    // one that failed: the first looks complete.
    expect(read("scripts/modules/inventory.mjs")).toContain(
      "with a section missing looks complete and is not",
    );
  });
});
