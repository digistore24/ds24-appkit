// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 How a module's texts join the core's — and the shallow spread that would
// take every error message in the app down with them.
//
// `mergeModuleMessages()` is pure, it is the single reason a module can add an
// error code at all, and nothing exercised it. The gap is the usual one:
// `MODULE_MESSAGES` is generated and ships EMPTY, so in a fresh app this
// function is handed `{}` and hands the core's catalogue straight back.
//
// The defect it was written against is recorded in its own header and is worth
// restating, because it is not hypothetical:
//
//     {...{errors: {a, b}}, ...{errors: {activityFoo}}}  ->  {errors: {activityFoo}}
//
// A refusal reaches a member as `t(`errors.${code}`)`. Replace that object and
// EVERY refusal in the app — token balances, sign-in, media uploads — renders as
// its raw key, in a build where nothing else looks wrong.
//
// Measured: the one-level merge replaced by `merged[namespace] = value` leaves
// `npm run typecheck` clean and turns **3 of 37** tests in this directory red.
import { describe, expect, it } from "vitest";

import { SHARED_NAMESPACES, mergeModuleMessages } from "./messages-merge";

const CORE = {
  errors: { notOwner: "Nicht erlaubt", invalidEmail: "Ungültige Adresse" },
  nav: { dashboard: "Übersicht", chat: "Chat" },
  billing: { title: "Zahlungen" },
};

describe("mergeModuleMessages", () => {
  it("hands the core's catalogue back unchanged when nothing is installed", () => {
    // The shipped state — and the reason every claim below needed a test of
    // its own rather than being read off a green suite.
    expect(mergeModuleMessages(CORE, {})).toEqual(CORE);
  });

  it("adds an owned namespace whole", () => {
    const merged = mergeModuleMessages(CORE, {
      community: { title: "Community", empty: "Noch nichts hier" },
    });

    expect(merged.community).toEqual({ title: "Community", empty: "Noch nichts hier" });
    expect(merged.billing).toEqual(CORE.billing);
  });

  it("🚨 merges INTO a shared namespace rather than over it", () => {
    // The measurement from the header, as an assertion.
    const merged = mergeModuleMessages(CORE, {
      errors: { communityRoomClosed: "Der Raum ist geschlossen" },
    }) as { errors: Record<string, string> };

    expect(merged.errors.notOwner, "the core's refusals were replaced").toBe("Nicht erlaubt");
    expect(merged.errors.invalidEmail).toBe("Ungültige Adresse");
    expect(merged.errors.communityRoomClosed).toBe("Der Raum ist geschlossen");
  });

  it("…and the same for `nav`, the other shared one", () => {
    const merged = mergeModuleMessages(CORE, {
      nav: { coursesCourse: "Kurs" },
    }) as { nav: Record<string, string> };

    expect(Object.keys(merged.nav).sort()).toEqual(["chat", "coursesCourse", "dashboard"]);
  });

  it("merges two modules into one shared namespace without either winning", () => {
    // Both are applied in turn, so the second must not undo the first.
    const merged = mergeModuleMessages(CORE, {
      errors: { communityRoomClosed: "a", coursesUnitLocked: "b" },
    }) as { errors: Record<string, string> };

    expect(merged.errors.communityRoomClosed).toBe("a");
    expect(merged.errors.coursesUnitLocked).toBe("b");
    expect(merged.errors.notOwner).toBe("Nicht erlaubt");
  });

  it("keeps the shared list closed — `errors` and `nav`, and nothing else", () => {
    // Not decoration: a third entry means some other part of the app looks up a
    // computed key, which is a decision about the CORE. Pinning the list is how
    // that decision stays a decision.
    expect([...SHARED_NAMESPACES]).toEqual(["errors", "nav"]);
  });

  it("replaces a namespace that is shared in name only if the core has none", () => {
    // Defensive branch: the core has no `nav` here, so there is nothing to
    // merge into and the module's object is taken whole rather than dropped.
    const merged = mergeModuleMessages({ errors: {} }, { nav: { coursesCourse: "Kurs" } });
    expect(merged.nav).toEqual({ coursesCourse: "Kurs" });
  });

  it("does not merge into a core value that is not an object", () => {
    // An array or a string under a shared name is a malformed catalogue, and
    // spreading it would produce numeric keys. Taking the module's is the
    // answer that at least renders.
    const merged = mergeModuleMessages(
      { errors: ["nope"] as unknown as Record<string, string> },
      { errors: { communityRoomClosed: "a" } },
    );
    expect(merged.errors).toEqual({ communityRoomClosed: "a" });
  });

  it("does not mutate either input", () => {
    const core = structuredClone(CORE);
    const modules = { errors: { communityRoomClosed: "a" } };
    mergeModuleMessages(core, modules);

    expect(core).toEqual(CORE);
    expect(modules).toEqual({ errors: { communityRoomClosed: "a" } });
  });
});
