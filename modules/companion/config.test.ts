// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The switch, and the arrangement that keeps it having one reader.
//
// ── The A12 test is the point of this file ─────────────────────────────────
// Retro-Action A12: *"any change that can disable a feature at runtime is
// measured against the config an ALREADY-GENERATED app carries, not the shipped
// one."* For this switch the config an already-generated app carries is most
// often **no file at all** — every app built before this story, and every app
// during Story 13.1, which read `config/ai-companion.json` before it existed.
//
// That test is only writable because `companionConfigFrom` takes a foreign
// object rather than reading the file for itself. A reader that fetches its own
// input cannot be handed `undefined`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { companionConfigFrom, isCompanionEnabled } from "./config.mjs";
import { companionProblems } from "./switch";
import { blankComments } from "@/scripts/lib/source-text.mjs";

describe("everything unreadable is OFF", () => {
  // The direction matters and is the opposite of `billingMode()`: a wrong
  // billing mode hides a card, a wrong AI switch spends money on an API for
  // every visitor.
  const off = [
    ["undefined — no such file, which is the commonest case of all", undefined],
    ["null — a parse failure the caller turned into null", null],
    ["an array", []],
    ["a string", "enabled"],
    ["a number", 1],
    ["an object with no enabled key", {}],
    ["a different key entirely", { disabled: false }],
    ['the STRING "true"', { enabled: "true" }],
    ["the number 1", { enabled: 1 }],
    ["an empty array as the value", { enabled: [] }],
    ["an object as the value", { enabled: {} }],
    ["explicitly false", { enabled: false }],
  ] as const;

  for (const [what, raw] of off) {
    it(`is off for ${what}`, () => {
      expect(companionConfigFrom(raw).enabled).toBe(false);
    });
  }

  it("is on only for the literal boolean", () => {
    expect(companionConfigFrom({ enabled: true }).enabled).toBe(true);
    // Extra fields do not change the answer — an operator who left something
    // behind has not switched the feature off by accident.
    expect(companionConfigFrom({ enabled: true, model: "gpt-4" }).enabled).toBe(true);
  });
});

describe("all three halves have to hold", () => {
  const on = { enabled: true };

  it("is live only when the product wants it, the machine can, and the registry is sound", () => {
    expect(isCompanionEnabled(on, true, [])).toBe(true);
  });

  it("is off when the product does not want it", () => {
    expect(isCompanionEnabled({ enabled: false }, true, [])).toBe(false);
  });

  it("is off when there is no key for the provider the task resolves to", () => {
    expect(isCompanionEnabled(on, false, [])).toBe(false);
  });

  it("is off when the registry has a problem", () => {
    expect(isCompanionEnabled(on, true, ["companion \"x\": duplicate id"])).toBe(false);
  });

  it("takes an empty problem list as the default, so a caller cannot forget it", () => {
    expect(isCompanionEnabled(on, true)).toBe(true);
  });
});

describe("the shipped registry is coherent", () => {
  it("has nothing wrong with it", () => {
    // It ships empty, so this is a guard on the day somebody adds the first
    // entry — and on the four defects `companionProblems()` names.
    expect(companionProblems()).toEqual([]);
  });
});

describe("the switch has ONE reader, and the tree says so", () => {
  // "Import the shared module" is advice. A test that reads the tree is not —
  // the same technique `providers/leak-guard.test.ts` and
  // `scripts/portability.test.ts` use for rules nobody can be expected to
  // remember.
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const read = (rel: string) => readFileSync(new URL(rel, new URL("../../", import.meta.url)), "utf8");

  /** Every file that decides whether a companion is switched on. */
  // 🚨 `lib/ai/disclosure.mjs` was missing from this list and a code review found
  // it. It is the third reader of `config/ai-companion.json`, and it is the one
  // that decides whether a legally required notice is demanded — the reader
  // whose drift would be quietest and cost the most.
  //
  // ⚠️ The third reader MOVED with the module: this feature's Art. 50 surface is
  // now declared in `modules/companion/disclosure.mjs` rather than in the core's
  // registry, because a module discloses its own surfaces. The lesson survives
  // the move — that reader is still the one whose drift would be quietest.
  //
  // ⚠️ `scripts/ai/check.mjs` LEFT this list, and its leaving is the point. It
  // was a CORE file importing a module's predicate by path, which worked until
  // the path moved — and then `node run.mjs ai-check` died with
  // ERR_MODULE_NOT_FOUND before printing a line, for as long as nobody typed the
  // command. It now asks `DISCLOSURE_SURFACES` instead, so the answer still comes
  // from `config.mjs` (through `disclosure.mjs`, which IS on this list) and the
  // core has stopped naming this module. A core file back on this list is that
  // coupling returning; the honest way in is a seam, not an import.
  const CONSUMERS = ["modules/companion/switch.ts", "modules/companion/disclosure.mjs"];

  it("names files that exist and are not empty", () => {
    // Non-vacuity first: a wrong path must not make every assertion below pass
    // against an empty string.
    expect(root.length).toBeGreaterThan(0);
    for (const file of CONSUMERS) {
      expect(read(file).length, file).toBeGreaterThan(200);
    }
  });

  it("has every consumer import companion-config.mjs", () => {
    for (const file of CONSUMERS) {
      expect(read(file), file).toMatch(/companion-config\.mjs|\.\/config\.mjs/);
    }
  });

  /**
   * The file with its comments removed.
   *
   * A guard that reads a tree must not fail on prose — the comments in these
   * files legitimately *describe* the comparison they no longer make, and
   * matching them would make this test go red for a correct file. The same
   * reason `lib/privacy/export.test.ts` matches a column reference rather than a
   * bare word.
   */
  const codeOf = (file: string) =>
    blankComments(read(file)).replace(/\s+/g, " ");

  it("has no consumer compare the COMPANION switch itself", () => {
    // The comparison that would drift belongs in exactly one file, and that file
    // is `companion-config.mjs`.
    //
    // Matched narrowly rather than on `enabled === true` alone, because
    // `disclosure.mjs` legitimately carries that comparison for the **chat**
    // switch: `config/ai-chat.json` has no shared `.mjs` reader, and giving it
    // one is a different piece of work. So the rule is: nobody may compare it
    // for a companion.
    for (const file of CONSUMERS) {
      const code = codeOf(file);
      const suspicious = /companion[^;]{0,120}enabled\s*===\s*true|enabled\s*===\s*true[^;]{0,120}companion/i;
      expect(code, file).not.toMatch(suspicious);
      // And anything that reads the companion's config file must go through the
      // shared predicate rather than looking at the JSON itself.
      if (code.includes("ai-companion.json")) {
        expect(code, file).toContain("companionConfigFrom");
      }
    }
  });

  it("🚨 the module's disclosure reads the switch through the shared predicate", () => {
    // The claim moved with the module and got sharper. While this surface was
    // declared in the core's registry it sat beside the assistant's, whose
    // `enabled === true` is a deliberate exception (the assistant has no shared
    // reader). Now that the two are in different files, this one may carry NO
    // such shortcut at all — and `raw?.enabled === true` here is the exact
    // regression the shared reader was created to prevent.
    const code = codeOf("modules/companion/disclosure.mjs");
    expect(code).toContain("companionConfigFrom");
    expect(code, "a raw enabled check is back").not.toMatch(/enabled\s*===\s*true/);
  });

  it("strips comments without stripping the code — the guard's own guard", () => {
    // If `codeOf` ever returned nothing, the assertion above would pass for a
    // file that broke every rule.
    for (const file of CONSUMERS) {
      expect(codeOf(file).length, file).toBeGreaterThan(200);
      expect(codeOf(file), file).toMatch(/companion-config\.mjs|\.\/config\.mjs/);
    }
  });

  it("keeps the comparison in the module that owns it", () => {
    expect(read("modules/companion/config.mjs")).toMatch(/enabled === true/);
  });
});
