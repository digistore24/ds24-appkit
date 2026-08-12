// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { LOCALES } from "@/i18n/config";
import de from "@/messages/de.json";

import { MEMBER_NAV_KEYS, navMenus, visibleMemberNavKeys } from "./nav-labels";

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
    const visible = visibleMemberNavKeys();
    const withheld = MEMBER_NAV_KEYS.filter((key) => !visible.includes(key));

    // Every withheld key is one the shell itself marks with a featureKey.
    const shell = readFileSync(join(ROOT, "components", "app-shell.tsx"), "utf8");
    for (const key of withheld) {
      const entry = [...shell.matchAll(/\{[^{}]*\}/g)]
        .map((match) => match[0])
        .find((text) => text.includes(`labelKey: "${key}"`));
      expect(entry, `"${key}" is withheld but has no NAVIGATION entry`).toBeDefined();
      expect(entry, `"${key}" is withheld from Lia but carries no featureKey`).toMatch(
        /featureKey:/,
      );
    }

    // And the order of what survives is the sidebar's order, unchanged.
    expect(visible).toEqual(MEMBER_NAV_KEYS.filter((key) => !withheld.includes(key)));
  });

  it("is byte-identical across two calls", () => {
    // It sits in the CACHED half of the prompt. A value that differed between
    // two requests would cost roughly a tenfold input bill and break nothing.
    expect(JSON.stringify(navMenus())).toBe(JSON.stringify(navMenus()));
  });
});
