// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **This file is the write gate for a code registry.**
//
// An operator saving a plan-gated ROOM is refused a product key the registry
// cannot answer for — `groupPlanProblems()` runs on the way into the database,
// because `hasPlan()` THROWS on an unknown key and an unvalidated one would
// take down the page that lists the room rather than mean "no access"
// (FR-189).
//
// `modules/community/lib/embeds.ts` has no save. Nobody types a declaration into a
// form; somebody writes it into a file and pushes. So the moment that
// corresponds to "SAVE" is the build, and this test is what happens then — it
// runs **the same function** the group write runs, over every declaration. A
// typo'd or retired key fails `npm run test` on the machine that wrote it,
// which is the earliest anybody can be told.
//
// ⚠️ The shipped registry is EMPTY, so the walk below is trivially green. That
// is the normal state of this file and not a reason to weaken it — the moment
// an app adds its first entry the walk stops being trivial, and the fixtures at
// the bottom are what prove it would have caught something in the meantime.
import { describe, expect, it } from "vitest";

import { planProblem } from "@/lib/media/config";

import { EMBEDS, findEmbed, type EmbedDeclaration } from "./embeds";
import { groupPlanProblems } from "./rules";

describe("the shipped registry", () => {
  it("ships empty — an embed the template declared is a discussion nobody chose", () => {
    expect(EMBEDS).toEqual([]);
  });

  it("declares only product keys an entitlement can ever answer for", () => {
    // ⚠️ `groupPlanProblems` + `planProblem`, not a re-implementation: "the
    // same code path the group configuration write uses" is the acceptance
    // criterion's literal wording, and a second answer to "can this key ever
    // unlock anything" is a second answer that drifts. `planProblem()` also
    // refuses a TOKEN package — a balance is not an entitlement, so
    // `hasPlan()` answers false for it for ever and the room would be a door
    // nobody could ever open.
    const problems = EMBEDS.map((embed) => ({
      subjectKey: embed.subjectKey,
      problem: groupPlanProblems(embed, planProblem),
    })).filter((entry) => entry.problem !== null);

    expect(
      problems,
      "a declaration in lib/community/embeds.ts names a product key " +
        "config/digistore-products.json cannot answer for. hasPlan() THROWS " +
        "on such a key, so this would be a 500 on the page carrying the " +
        "embed, not a refusal.",
    ).toEqual([]);
  });

  it("gives every declaration a non-empty Subject Key", () => {
    const blank = EMBEDS.filter((embed) => embed.subjectKey.trim() === "");
    expect(blank, "a Subject Key is the whole coordinate — it cannot be blank").toEqual([]);
  });

  it("gives every declaration a Subject Key already in its own normal form", () => {
    // ⚠️ **A key that cannot be addressed has to fail HERE, because nothing
    // downstream can tell you.** `findEmbed()` matches with `===`, and its
    // `null` is deliberately the same `null` an unentitled member gets — so a
    // trailing space or a capital letter produces a component that renders
    // nothing, on a page with no error, in a log with no line, with a green
    // test suite. The registry's own rule is that for a contract between two
    // files in one repo the build IS write time; this is that rule applied to
    // the coordinate itself.
    const malformed = EMBEDS.filter(
      (embed) => embed.subjectKey !== embed.subjectKey.trim().toLowerCase(),
    ).map((embed) => JSON.stringify(embed.subjectKey));
    expect(
      malformed,
      "a Subject Key must carry no leading or trailing whitespace and no " +
        "capitals — the page passes a literal, and a key that differs from it " +
        "by either renders exactly what an unentitled member sees: nothing",
    ).toEqual([]);
  });

  it("gives no two declarations the same Subject Key", () => {
    // The database says this too (a unique partial index on `subject_key`), and
    // it says it about ROWS. Two declarations sharing a key would be two access
    // levels for one discussion, decided by whichever `find()` reached first —
    // so it is refused here, where the file is written, rather than discovered
    // at the moment a member is let into the wrong one.
    const seen = new Set<string>();
    const duplicates = EMBEDS.filter((embed) => {
      if (seen.has(embed.subjectKey)) return true;
      seen.add(embed.subjectKey);
      return false;
    });
    expect(duplicates).toEqual([]);
  });
});

describe("findEmbed", () => {
  it("answers null for a key nobody declared", () => {
    expect(findEmbed("course:nothing:unit-0")).toBeNull();
  });
});

// ── Non-vacuity ────────────────────────────────────────────────────────────
// The walks above pass on an empty list, which is exactly the state this
// template ships in — so on its own this file would be a green test that
// asserts nothing. These fixtures run the same validation over declarations
// that SHOULD be refused, so "the gate works" is measured rather than assumed.
describe("the gate itself", () => {
  const decl = (over: Partial<EmbedDeclaration>): EmbedDeclaration => ({
    subjectKey: "course:demo:unit-1",
    accessLevel: "plan",
    planKeys: ["a-product-key-that-does-not-exist"],
    ...over,
  });

  it("refuses a plan declaration naming a product this app does not sell", () => {
    const problem = groupPlanProblems(decl({}), planProblem);
    expect(problem?.code).toBe("communityUnknownPlanKey");
  });

  it("refuses a plan declaration with no keys at all — a door with no key", () => {
    const problem = groupPlanProblems(decl({ planKeys: [] }), planProblem);
    expect(problem?.code).toBe("communityPlanKeysRequired");
  });

  it("asks nothing of an open, moderators or operator declaration", () => {
    // Keys are meaningless for every level except `plan` and are not checked —
    // the same ruling `groupPlanProblems()` makes for a room, so a declaration
    // switched from `plan` to `open` cannot be refused for a leftover key.
    for (const accessLevel of ["open", "moderators", "operator"] as const) {
      expect(groupPlanProblems(decl({ accessLevel }), planProblem)).toBeNull();
    }
  });
});
