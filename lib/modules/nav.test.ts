// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where a module's menu entries land in the core's menu.
//
// `mergeModuleNav()` is pure and it is the reason the merge lives here rather
// than in the component — but nothing exercised it. `lib/modules/` is twenty
// files of registry spine with one test (`installed.test.ts`), and the reason
// the gap survived is the one this repo keeps meeting: `MODULE_NAV` is
// GENERATED and ships EMPTY, so in the tree a customer clones this function is
// called with `[]` and returns the core's list unchanged. Every claim about it
// is vacuously true there.
//
// Three things are asserted, and the second is the one that was a real defect:
//
//   1. placement — an entry goes directly after the href it names
//   2. two entries naming ONE anchor keep their order (they came out reversed)
//   3. a dangling `after` THROWS rather than landing at the end of the list
//
// Measured: `anchorOf` taken back out — the exact shape the first draft had —
// leaves `npm run typecheck` clean and turns **2 of 37** tests in this
// directory red.
import { describe, expect, it } from "vitest";

import { Home } from "lucide-react";

import { mergeModuleNav, type ModuleNav, type NavItemBase } from "./nav";

// `icon` is required on every entry — a real lucide icon rather than a cast, so
// this file keeps typechecking if the field's type ever narrows.
const ICON = Home;

const CORE: NavItemBase[] = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: ICON },
  { href: "/dashboard/chat", labelKey: "nav.chat", icon: ICON },
  { href: "/dashboard/billing", labelKey: "nav.billing", icon: ICON },
  { href: "/dashboard/admin/purchases", labelKey: "nav.purchases", icon: ICON },
];

function mod(id: string, items: ModuleNav["NAVIGATION"]): ModuleNav {
  return { id, NAVIGATION: items, features: [] };
}

const hrefs = (items: readonly NavItemBase[]) => items.map((i) => i.href);

describe("mergeModuleNav", () => {
  it("leaves the core's menu exactly as it was when nothing is installed", () => {
    // The shipped state, and the reason every other claim here needed a test:
    // this is what the function is asked in a fresh app, and it proves nothing
    // about the rest.
    expect(mergeModuleNav(CORE, [])).toEqual(CORE);
  });

  it("puts an entry directly after the href it names", () => {
    const merged = mergeModuleNav(CORE, [
      mod("courses", [
        { href: "/dashboard/course", labelKey: "nav.coursesCourse", icon: ICON, after: "/dashboard/chat" },
      ]),
    ]);

    expect(hrefs(merged)).toEqual([
      "/dashboard",
      "/dashboard/chat",
      "/dashboard/course",
      "/dashboard/billing",
      "/dashboard/admin/purchases",
    ]);
  });

  it("appends an entry that names no anchor", () => {
    // Documented as "almost never where a member-facing page belongs" — but it
    // is the accepted answer for one that really does belong at the end.
    const merged = mergeModuleNav(CORE, [
      mod("api", [{ href: "/dashboard/api-keys", labelKey: "nav.apiKeys", icon: ICON }]),
    ]);

    expect(hrefs(merged).at(-1)).toBe("/dashboard/api-keys");
  });

  it("🚨 keeps the order of two entries that name the SAME anchor", () => {
    // The defect the `anchorOf` map exists for: both entries resolve to one
    // index, so the second lands in FRONT of the first and the module's menu
    // reads backwards. The first draft's comment claimed the opposite; the
    // test found it.
    const merged = mergeModuleNav(CORE, [
      mod("community", [
        { href: "/dashboard/community", labelKey: "a", icon: ICON, after: "/dashboard/chat" },
        { href: "/dashboard/community/feed", labelKey: "b", icon: ICON, after: "/dashboard/chat" },
      ]),
    ]);

    expect(hrefs(merged)).toEqual([
      "/dashboard",
      "/dashboard/chat",
      "/dashboard/community",
      "/dashboard/community/feed",
      "/dashboard/billing",
      "/dashboard/admin/purchases",
    ]);
  });

  it("…and across two modules naming the same anchor, in install order", () => {
    const merged = mergeModuleNav(CORE, [
      mod("courses", [{ href: "/dashboard/course", labelKey: "a", icon: ICON, after: "/dashboard/chat" }]),
      mod("community", [{ href: "/dashboard/community", labelKey: "b", icon: ICON, after: "/dashboard/chat" }]),
    ]);

    expect(hrefs(merged).slice(1, 4)).toEqual([
      "/dashboard/chat",
      "/dashboard/course",
      "/dashboard/community",
    ]);
  });

  it("lets a module anchor to an entry ANOTHER module just added", () => {
    // Follows from the same map, and it is the shape `courses` + `community`
    // would take if one sat under the other.
    const merged = mergeModuleNav(CORE, [
      mod("courses", [{ href: "/dashboard/course", labelKey: "a", icon: ICON, after: "/dashboard/chat" }]),
      mod("activity", [{ href: "/dashboard/practice", labelKey: "b", icon: ICON, after: "/dashboard/course" }]),
    ]);

    expect(hrefs(merged).slice(1, 4)).toEqual([
      "/dashboard/chat",
      "/dashboard/course",
      "/dashboard/practice",
    ]);
  });

  it("🚨 throws on an `after` that names no entry — never appends quietly", () => {
    // A dangling anchor means the module describes a menu this app does not
    // have. Appending would put the page below the admin section, where a
    // member never looks — a feature that shipped and cannot be found.
    expect(() =>
      mergeModuleNav(CORE, [
        mod("courses", [
          { href: "/dashboard/course", labelKey: "a", icon: ICON, after: "/dashboard/nonexistent" },
        ]),
      ]),
    ).toThrow(/is in no menu/);
  });

  it("names the module, the entry and the bad anchor in that error", () => {
    // The message is the whole diagnosis — this throws during a build, where
    // there is no stack anybody wants to read.
    expect(() =>
      mergeModuleNav(CORE, [
        mod("courses", [{ href: "/dashboard/course", labelKey: "a", icon: ICON, after: "/dashboard/gone" }]),
      ]),
    ).toThrow(/courses.*\/dashboard\/course.*\/dashboard\/gone/s);
  });

  it("does not mutate the core list it was given", () => {
    // It is module scope in the app shell — a mutation would accumulate entries
    // across renders.
    const core = [...CORE];
    mergeModuleNav(core, [
      mod("courses", [{ href: "/dashboard/course", labelKey: "a", icon: ICON, after: "/dashboard/chat" }]),
    ]);
    expect(core).toEqual(CORE);
  });
});
