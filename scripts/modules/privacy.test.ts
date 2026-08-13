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

import { availableModules } from "./registry.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// 🚨 AVAILABLE, not installed — and of everything in this file that matters,
// this line matters most.
//
// It read `installedModules(ROOT).length > 0 ? loadModules(ROOT) : []`, and
// `config/modules.json` ships EMPTY. So the clamp around the module system's
// sharpest claim — that a member's own download and the operator's Art. 15
// command answer the same request the same way — checked ZERO modules in the
// tree a customer clones and in every `make test` here. It said so out loud in
// its own test name ("checks the 0 module(s) that answer Art. 15") and that read
// as a pass.
//
// Whether the two halves of a module's export agree is a property of the two
// FILES. It does not become true or false by installing anything, and there is
// a regulator on the other end of the question.
const records = availableModules(ROOT).map((id) => {
  const dir = join("modules", id);
  return { id, dir, manifest: JSON.parse(read(join(dir, "module.json"))) };
});
const withPrivacy = records.filter((r) => r.manifest.privacy);

describe("🚨 both halves declare exactly what the manifest declares", () => {
  // 🚨 The count guard, and it is not decoration here — it is the exact failure
  // this file spent its life in. A `describe` whose name says "the 0 module(s)"
  // and whose loop never runs is green, and reads as green in a report.
  it("has modules to check at all", () => {
    expect(records.length, "no modules found in the tree").toBeGreaterThan(1);
    expect(
      withPrivacy.length,
      "no module declares `privacy` — either the manifests changed shape or " +
        "this walk stopped reading them; both are failures, not clean trees",
    ).toBeGreaterThan(1);
  });

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
