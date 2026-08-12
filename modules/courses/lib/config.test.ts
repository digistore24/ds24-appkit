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

const { courseConfigProblems, courseOffReason, isCourseEnabled } = await import("./config");

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
  set({ enabled: true, shape: "self-study", productKey: PLAN.key ?? "" });
});

describe("the course's Product Key has to be one hasPlan() can answer", () => {
  it("is happy with a product this app really sells", (ctx) => {
    // The needle: without it, every refusal below could be a function that
    // refuses everything.
    keysOrSkip(ctx, PLAN);
    expect(courseConfigProblems()).toEqual([]);
    expect(isCourseEnabled()).toBe(true);
  });

  it("🚨 refuses a key no product in the registry holds", () => {
    set({ enabled: true, shape: "self-study", productKey: "kurs_der_nie_existierte" });
    const problems = courseConfigProblems();
    expect(problems.join(" ")).toContain("productKey");
    expect(problems.join(" ")).toContain("kurs_der_nie_existierte");
    // And it makes the course BROKEN rather than merely noted: the operator's
    // admin page is what names the value, and a member gets the same "not
    // found" as a course that was never switched on.
    expect(courseOffReason()).toBe("brokenConfig");
    expect(isCourseEnabled()).toBe(false);
  });

  it("🚨 refuses a token package, which nobody could ever hold as a plan", (ctx) => {
    // A balance is not an entitlement. `hasPlan()` answers false for one for
    // ever, so a course sold under it is a course nobody can open — including
    // the buyer, who paid.
    //
    // ⚠️ It has to be a token package this app REALLY sells: handed a key the
    // registry does not hold, the refusal comes from the branch above instead
    // and this test agrees with the wrong sentence.
    const [token] = keysOrSkip(ctx, TOKEN);
    set({ enabled: true, shape: "self-study", productKey: token });
    expect(courseConfigProblems().join(" ")).toContain("token package");
    expect(isCourseEnabled()).toBe(false);
  });

  it("still says 'missing' rather than 'unusable' when there is no key at all", () => {
    set({ enabled: true, shape: "self-study", productKey: null });
    expect(courseConfigProblems().join(" ")).toContain("missing");
  });

  it("asks nothing of a course that is switched off", () => {
    // An app that has not switched the course on yet is not carrying a fault —
    // that window is the normal state between `module add courses` and the
    // content being written.
    set({ enabled: false, shape: "self-study", productKey: "kurs_der_nie_existierte" });
    expect(courseConfigProblems()).toEqual([]);
    // …and "off" wins over "broken": an operator who parked the file gets
    // "off", not a lint about a value they deliberately left behind.
    expect(courseOffReason()).toBe("disabledInConfig");
  });
});
