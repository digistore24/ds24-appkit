// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What `config/course.json` has to say before the course runs.
//
// The interesting half is the Product Key, and it is the half that was missing:
// the file only asked whether one was PRESENT. A key naming a product that has
// since been retired — or a token package, which `hasPlan()` answers false for
// for ever — left the course `enabled`, and then two things happened that both
// look like faults rather than refusals: every lesson's media failed with
// `MediaError("noAccess")`, and `courseAccessFor()` THREW, because `hasPlan()`
// throws on a key it does not know. That is the trap `planProblem()` exists for
// (AD-41), and the real one is used here rather than a mock: the question is
// whether the two agree about this app's actual registry.
//
// The config file itself IS mocked, because it is a static import and the
// shipped one is `enabled: false` — which is exactly the state that makes every
// branch below unreachable.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keysOrSkip, planShapedKey, tokenKey } from "@/lib/digistore/test-product-keys";

/** One object, mutated per test — `file()` reads it fresh on every call. */
const CONFIG: Record<string, unknown> = {};
vi.mock("@/config/course.json", () => ({ default: CONFIG }));

const { courseConfig, courseConfigProblems, courseOffReason } = await import("./config");

// 🚨 The Product Key is read out of THIS app's registry, never written in.
// `config/digistore-products.json` ships five EXAMPLES and CLAUDE.md tells the
// operator to delete the ones they do not sell — a literal here turned that
// instruction into a red suite in a module the app had not even installed
// (field test 2026-08-11). Where a shape is genuinely absent the test skips and
// says why: `lib/digistore/test-product-keys.ts`.
const PLAN = planShapedKey();
const TOKEN = tokenKey();

function set(fields: Record<string, unknown>) {
  for (const key of Object.keys(CONFIG)) delete CONFIG[key];
  Object.assign(CONFIG, fields);
}

beforeEach(() => {
  // `?? ""` and not a made-up key: with no plan-shaped product the tests that
  // depend on one skip below, and the ones that do not (a key nothing holds, a
  // missing key, a course switched off) must not silently start asserting
  // against a literal this app does not sell either.
  set({ enabled: true, shape: "self-study", planKeys: PLAN.key ? [PLAN.key] : [] });
});

describe("the switch, which is all this file decides now", () => {
  // 🚨 **`shape` and `planKeys` are NOT tested here any more, and that is the
  // point of this comment.** They moved onto the course row in Story 44.2 and
  // their assertions moved with them, to `./courses.test.ts`. What is left is
  // the question that really is about the INSTALLATION: is the course surface
  // running here at all.

  it("is off unless `enabled` is exactly true", () => {
    for (const value of [false, "true", 1, null, undefined]) {
      set({ enabled: value });
      expect(courseConfig().enabled, JSON.stringify(value)).toBe(false);
      expect(courseOffReason()).toBe("disabledInConfig");
    }
  });

  it("previews are on unless somebody switched them off", () => {
    // Defaults ON: without it an operator cannot look at the last week of their
    // own drip course, because they hold no grant and therefore have no clock.
    set({ enabled: true });
    expect(courseConfig().operatorPreviewsUnlocked).toBe(true);
    set({ enabled: true, operatorPreviewsUnlocked: false });
    expect(courseConfig().operatorPreviewsUnlocked).toBe(false);
  });

  it("🚨 reports a LEFTOVER shape or planKeys as an unknown field", () => {
    // The one thing this file must still say about the two values it lost: a
    // customer's config carries them from before the split, they now decide
    // nothing, and a value nobody reads is one somebody believes they set.
    // Reported rather than obeyed, and rather than ignored.
    set({ enabled: true, shape: "self-study", planKeys: ["basic_monthly"] });
    const problems = courseConfigProblems().join(" ");
    expect(problems).toContain("shape");
    expect(problems).toContain("planKeys");
    expect(courseOffReason()).toBe("brokenConfig");
  });

  it("says nothing about a `_`-prefixed key — those are documentation", () => {
    set({ enabled: true, _comment: "anything" });
    expect(courseConfigProblems()).toEqual([]);
  });

  it("refuses an `enabled` that is not a boolean, and still counts as OFF", () => {
    set({ enabled: "yes" });
    expect(courseConfigProblems().join(" ")).toContain("enabled");
    // Both directions at once: it is a PROBLEM and it is OFF — and "off" wins,
    // because an operator who parked the file gets "off" rather than a lint.
    expect(courseOffReason()).toBe("disabledInConfig");
  });
});
