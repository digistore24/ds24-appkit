// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { LOCALES } from "@/i18n/config";
import de from "@/messages/de.json";

import { MODULE_NAV } from "@/lib/modules/nav-registry";
import { MODULE_GATES } from "@/lib/modules/gate-registry";
import type { ModuleNav } from "@/lib/modules/nav";
import type { ModuleGate, ModuleState } from "@/lib/modules/gate";

import {
  MEMBER_NAV_KEYS,
  moduleMemberNavKeys,
  navMenus,
  visibleMemberNavKeys,
} from "./nav-labels";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The `labelKey`s of `NAVIGATION`, in order, paired with whether the entry is
 * owner-only — read off the source, the way `components/app-shell.test.ts`
 * does it. Importing the module would drag React and lucide into a node test
 * for the sake of five strings.
 */
const NAVIGATION_KEYS = (() => {
  const shell = readFileSync(join(ROOT, "components", "app-shell.tsx"), "utf8");
  const start = shell.indexOf("export const NAVIGATION");
  const end = shell.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("cannot find NAVIGATION in app-shell.tsx");
  const list = shell.slice(start, end);

  // One entry per `{ … }`; `ownerOnly` sits inside the same braces as its key.
  return [...list.matchAll(/\{[^{}]*\}/g)]
    .map((match) => match[0])
    .map((entry) => ({
      key: /labelKey:\s*"([^"]+)"/.exec(entry)?.[1],
      ownerOnly: entry.includes("ownerOnly"),
    }))
    .filter((entry): entry is { key: string; ownerOnly: boolean } => Boolean(entry.key));
})();

describe("the menu Lia is allowed to name", () => {
  it("found NAVIGATION at all", () => {
    // Non-vacuity: a failed slice would make the comparison below pass by
    // comparing two empty lists.
    expect(NAVIGATION_KEYS.length).toBeGreaterThan(5);
  });

  it("is every entry a member actually sees, in the order they see them", () => {
    // THE guard on this file. An entry added to the sidebar, renamed or moved
    // is one Lia would otherwise keep describing as it used to be — and she
    // has no other way of finding out.
    expect(MEMBER_NAV_KEYS).toEqual(
      NAVIGATION_KEYS.filter((entry) => !entry.ownerOnly).map((entry) => entry.key),
    );
  });

  it("leaves the operator's entries out", () => {
    // She answers customers. Sending one to "Admin" is a dead end for them and
    // a support ticket for the operator.
    for (const entry of NAVIGATION_KEYS.filter((item) => item.ownerOnly)) {
      expect(MEMBER_NAV_KEYS as readonly string[]).not.toContain(entry.key);
    }
  });
});

describe("the labels handed to the model", () => {
  it("covers every language the app speaks", () => {
    expect(navMenus().map((menu) => menu.locale)).toEqual([...LOCALES]);
  });

  it("names each entry as the sidebar names it", () => {
    // The regression this file was written for: the shipped handbook said
    // "Account", the sidebar says "Mein Konto", and Lia repeated the handbook.
    const german = navMenus().find((menu) => menu.locale === "de");
    expect(german?.labels).toContain(de.nav.account);
    expect(german?.labels).toContain("Mein Konto");
  });

  it("carries a real label for every entry in every language", () => {
    // Against the VISIBLE list, not the pinned one: a feature-keyed entry
    // whose feature is off is deliberately withheld from the model, and this
    // assertion must stay true after the customer legitimately flips the
    // switch — so it compares against the same filter, never a literal count.
    for (const menu of navMenus()) {
      expect(menu.labels).toHaveLength(visibleMemberNavKeys().length);
      for (const label of menu.labels) expect(label.trim()).not.toBe("");
    }
  });

  it("withholds exactly the feature-gated entries, and nothing else", () => {
    // ⚠️ The assertion above is nearly vacuous on its own, and that is the
    // finding this test answers: `navMenus()` BUILDS its labels from
    // `visibleMemberNavKeys()`, so comparing the two lengths compares a value
    // with itself. Before the community filter landed, the same line compared
    // against the pinned `MEMBER_NAV_KEYS` and was a real guard; the comment
    // above correctly explains why it could not stay that way, but nothing
    // replaced what it used to catch.
    //
    // What went uncaught: a WRONG FILTER PREDICATE. A filter that also dropped
    // "billing" — one mistyped condition — leaves every test in this file green
    // while Lia silently stops naming the billing page, and she has no other
    // way of finding out. So the filter is pinned to its one documented job:
    // it may withhold feature-gated entries and nothing else.
    //
    // 🚨 **And that pin was itself vacuous for as long as it existed, because
    // the filter it describes had MOVED.** When it was written, `"community"`
    // was a member key in `MEMBER_NAV_KEYS` and `visibleMemberNavKeys()` was
    // `MEMBER_NAV_KEYS.filter(k => k !== "community" || isCommunityEnabled())`
    // — so a withheld key was a real thing to find. The community then became a
    // MODULE: the key left the core list, the core filter went with it, and
    // `visibleMemberNavKeys()` became a concatenation that withholds no core key
    // ever. `withheld` was therefore EMPTY by construction, the loop below ran
    // zero times, and the last line quietly degenerated into `visible ===
    // MEMBER_NAV_KEYS` — which is how it came to fail in every app that
    // installed a module (reported 2026-08-12) while catching nothing here.
    //
    // The withholding is real; it just happens one layer out, in
    // `moduleMemberNavKeys()`, which has TWO predicates — the gate must say
    // `"on"` exactly, and `ownerOnly` entries never travel. So the candidate set
    // is everything that could be named BEFORE any gate, and every key missing
    // from `visible` has to name which of the three reasons withheld it.
    const visible = visibleMemberNavKeys();
    const moduleItems = MODULE_NAV.flatMap((mod) =>
      mod.NAVIGATION.map((item) => ({ mod, item })),
    );
    const candidates = [...MEMBER_NAV_KEYS, ...moduleItems.map(({ item }) => item.labelKey)];
    const withheld = candidates.filter((key) => !visible.includes(key));
    const notOn = new Set(
      MODULE_GATES.filter((gate) => gate.state() !== "on").map((gate) => gate.id),
    );

    const shell = readFileSync(join(ROOT, "components", "app-shell.tsx"), "utf8");
    for (const key of withheld) {
      const owned = moduleItems.find(({ item }) => item.labelKey === key);
      if (owned) {
        // A module's entry: withheld only because its module is not switched on,
        // or because the entry is the operator's.
        expect(
          owned.item.ownerOnly === true || notOn.has(owned.mod.id),
          `"${key}" is withheld from Lia although ${owned.mod.id} is ON and the entry ` +
            `is not ownerOnly — she has stopped naming a page the member can see`,
        ).toBe(true);
        continue;
      }
      // A core entry: withheld only if the shell itself marks it with a
      // featureKey. This is the half that catches the mistyped condition —
      // `/dashboard/billing` carries no featureKey, so a filter that swallowed
      // "billing" lands here rather than passing.
      const entry = [...shell.matchAll(/\{[^{}]*\}/g)]
        .map((match) => match[0])
        .find((text) => text.includes(`labelKey: "${key}"`));
      expect(entry, `"${key}" is withheld but has no NAVIGATION entry`).toBeDefined();
      expect(entry, `"${key}" is withheld from Lia but carries no featureKey`).toMatch(
        /featureKey:/,
      );
    }

    // And the order of what survives is the sidebar's order, unchanged — the
    // core's entries first, then each module's in menu order.
    expect(visible).toEqual(candidates.filter((key) => !withheld.includes(key)));
  });

  it("is byte-identical across two calls", () => {
    // It sits in the CACHED half of the prompt. A value that differed between
    // two requests would cost roughly a tenfold input bill and break nothing.
    expect(JSON.stringify(navMenus())).toBe(JSON.stringify(navMenus()));
  });
});

describe("🚨 the module half of that filter, against an app this tree is not", () => {
  // Everything above reads the REAL registries, and both are generated from
  // `config/modules.json`, which ships `{ "installed": [] }`. So `MODULE_NAV`
  // and `MODULE_GATES` are empty here, and the two predicates inside
  // `moduleMemberNavKeys()` — gate says `"on"` exactly, `ownerOnly` never
  // travels — are unreachable in the factory: they were measured for the first
  // time by a customer, as a red suite (2026-08-12).
  //
  // These pass the registries in instead. It is the same function the app calls
  // with the same defaults, so this is the shipped predicate rather than a
  // restatement of it.
  // `covers` is required by the interface and is irrelevant here — it answers
  // the proxy's "is this path behind the gate", never the menu's "may she name
  // it". Written out rather than cast away, so a real change to `ModuleGate`
  // reaches these fixtures through the typechecker.
  const gate = (id: string, state: ModuleState): ModuleGate => ({
    id,
    state: () => state,
    covers: () => false,
  });
  const nav: readonly ModuleNav[] = [
    {
      id: "community",
      NAVIGATION: [
        { href: "/dashboard/community", labelKey: "community" },
        { href: "/dashboard/admin/community", labelKey: "communityAdmin", ownerOnly: true },
      ],
    },
    { id: "courses", NAVIGATION: [{ href: "/dashboard/courses", labelKey: "courses" }] },
  ] as unknown as readonly ModuleNav[];

  it("names a switched-on module's member entries, in menu order", () => {
    expect(moduleMemberNavKeys(nav, [gate("community", "on"), gate("courses", "on")])).toEqual([
      "community",
      "courses",
    ]);
  });

  it("never names an ownerOnly entry, however switched on the module is", () => {
    // She answers customers; sending one to an admin page is a dead end for
    // them and a support ticket for the operator.
    expect(
      moduleMemberNavKeys(nav, [gate("community", "on")]),
      "communityAdmin reached the model",
    ).toEqual(["community"]);
  });

  it("names nothing from a module that is switched off", () => {
    expect(moduleMemberNavKeys(nav, [gate("community", "off"), gate("courses", "on")])).toEqual([
      "courses",
    ]);
  });

  it('🚨 names nothing from a module that is "broken" either — `"on"` exactly', () => {
    // Not "anything but off". A module whose config is switched on but
    // malformed still hides its menu entries and still answers not-found on its
    // routes; only the operator's diagnosis page stays reachable, and Lia is not
    // talking to the operator. Reading this as `!== "off"` is one character and
    // sends every member to a door that answers not-found.
    expect(moduleMemberNavKeys(nav, [gate("community", "broken")])).toEqual([]);
  });

  it("names nothing from a module with no gate at all", () => {
    // A nav entry whose module contributed no gate is not "on by default": the
    // set is built from the gates, so an absent one withholds.
    expect(moduleMemberNavKeys(nav, [])).toEqual([]);
  });

  // ⚠️ **There is deliberately no assertion here that `MODULE_NAV` is empty.**
  // It is empty in this tree and in a fresh app, and writing that down would be
  // the exact defect this whole file is a repair of: a test that passes because
  // of what the template SHIPS, and that turns red in the customer's app the
  // moment they do the documented thing. The fixtures above hold everywhere, and
  // in an app that has installed a module the suite before them measures the
  // real registries as well.
});
