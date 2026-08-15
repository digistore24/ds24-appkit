// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What is wrong with a course ROW — and what the two lookups do about it.
//
// 🚨 **These assertions were `lib/config.test.ts`'s until Story 44.2.** They
// judged `config/course.json`'s one `shape` and one key list; the values moved
// onto `courses_courses` because an app may hold several courses, and the
// judgements moved with them rather than being written a second time. Whoever
// looks for "the course's Product Key has to be one hasPlan() can answer" in
// the config test will find it here.
//
// The split this file is really about is the one `./courses.ts` argues at
// length: `allCourses()` carries a broken row so the operator's surface can
// NAME it, and `courseBySlug()` collapses it to `null` so a member gets what a
// slug that never existed gets. A test that only exercised one of the two would
// pass with the other deleted.
import { describe, expect, it } from "vitest";

import { keysOrSkip, planShapedKey, tokenKey } from "@/lib/digistore/test-product-keys";

import { courseBlocking, courseProblems, type Course } from "./courses";

const PLAN = planShapedKey();
const TOKEN = tokenKey();

/** A course row that holds — the fixture every case below bends one field of. */
function course(over: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    slug: "kurs",
    title: "Der Kurs",
    summary: null,
    position: 1,
    shape: "self-study",
    planKeys: PLAN.key ? [PLAN.key] : [],
    origin: "content",
    ...over,
  };
}

describe("🚨 a RETIRED key is skipped, not fatal (44.1 AC 5)", () => {
  // The half of that AC that only the media layer kept. `mayAccess()` filters a
  // dead key out of a media row's list in so many words — "an ordinary registry
  // edit must not become a refusal for people who paid" — and the course path
  // dropped the whole course instead.
  //
  // Measured 2026-08-15: a course sold monthly AND yearly, the monthly product
  // removed from `config/digistore-products.json` (a normal registry edit), and
  // the YEARLY buyers got 404 on the list, the overview, every lesson and
  // `/api/v1/courses/<slug>` — while the video in the same lesson was still
  // being served, because one layer skipped the dead key and the other did not.
  it("keeps the course alive while ONE key still sells it", (ctx) => {
    keysOrSkip(ctx, PLAN);
    const mixed = course({ planKeys: ["kurs_der_nie_existierte", PLAN.key!] });

    // The operator is still told — that half must not go quiet.
    expect(courseProblems(mixed).join(" ")).toContain("kurs_der_nie_existierte");
    // …and the member still gets the course.
    expect(courseBlocking(mixed)).toEqual([]);
  });

  it("🚨 …and dies when NOTHING sells it any more", (ctx) => {
    // The counter-proof. Without it the rule above would pass against a
    // function that answers `[]` unconditionally — which reads as tolerance and
    // would open a course nobody can buy.
    keysOrSkip(ctx, PLAN);
    expect(courseBlocking(course({ planKeys: ["kurs_der_nie_existierte"] })).length).toBeGreaterThan(
      0,
    );
    expect(courseBlocking(course({ planKeys: [] })).length).toBeGreaterThan(0);
  });

  it("a problem that is not about a key stays fatal", (ctx) => {
    // Skipping is for a key the registry forgot. An unreadable `shape` is not
    // that: nothing about it becomes right by ignoring it.
    keysOrSkip(ctx, PLAN);
    expect(courseBlocking(course({ shape: null })).length).toBeGreaterThan(0);
  });
});

describe("the course's Product Keys have to be ones hasPlan() can answer", () => {
  it("is happy with a product this app really sells", (ctx) => {
    // The needle: without it, every refusal below could be a function that
    // refuses everything.
    keysOrSkip(ctx, PLAN);
    expect(courseProblems(course())).toEqual([]);
  });

  it("🚨 refuses a key no product in the registry holds", () => {
    const problems = courseProblems(course({ planKeys: ["kurs_der_nie_existierte"] }));
    expect(problems.join(" ")).toContain("planKeys");
    expect(problems.join(" ")).toContain("kurs_der_nie_existierte");
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
    expect(courseProblems(course({ planKeys: [token] })).join(" ")).toContain("token package");
  });

  it("says 'empty' rather than 'unusable' when there is no key at all", () => {
    expect(courseProblems(course({ planKeys: [] })).join(" ")).toContain("empty");
  });

  it("🚨 reports EVERY bad key, not the first", (ctx) => {
    // A list whose second entry is a token package is exactly as broken as one
    // whose first is, and naming only the head sends the operator round the
    // loop once per mistake.
    const [token] = keysOrSkip(ctx, TOKEN);
    const problems = courseProblems(course({ planKeys: ["gibt_es_nicht", token] }));
    expect(problems).toHaveLength(2);
  });

  it("refuses the same key twice — it changes no answer and hides an intention", (ctx) => {
    const [key] = keysOrSkip(ctx, PLAN);
    expect(courseProblems(course({ planKeys: [key, key] })).join(" ")).toContain("twice");
  });

  it("🚨 refuses a shape that is not one of the three, and does NOT default", () => {
    // `self-study` is the most permissive of the three, so a course whose shape
    // fell back to it would open week ten on day one — `docs/courses.md`'s own
    // definition of having failed at the thing it was bought for. `toCourse()`
    // reads an unknown value as `null`, and this is what null costs.
    expect(courseProblems(course({ shape: null })).join(" ")).toContain("shape");
  });

  it("names both faults when a course has both", (ctx) => {
    keysOrSkip(ctx, PLAN);
    expect(courseProblems(course({ shape: null, planKeys: [] }))).toHaveLength(2);
  });
});
