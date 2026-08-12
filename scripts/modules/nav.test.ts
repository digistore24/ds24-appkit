// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The navigation a module contributes, and the two guarantees the type used to
// give before a module could add entries.
//
// `featureKey` was `keyof ShellFeatures`, which caught a typo at compile time.
// A module cannot widen an interface in the core, so that check moved here —
// and grew: the type could never tell whether anything RESOLVED a key, only
// whether the key existed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CircleUser } from "lucide-react";

import {
  mergeModuleNav,
  type ModuleNav,
  type ModuleNavItem,
  type NavItemBase,
} from "@/lib/modules/nav";
import { NAVIGATION } from "@/components/app-shell";
import { MODULE_NAV } from "@/lib/modules/nav-registry";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const item = (href: string, extra: Partial<ModuleNavItem> = {}): ModuleNavItem => ({
  href,
  labelKey: href,
  icon: CircleUser,
  ...extra,
});

const mod = (id: string, items: ModuleNavItem[]): ModuleNav => ({
  id,
  NAVIGATION: items,
  features: [],
});

describe("merging a module's entries", () => {
  const core = [item("/dashboard"), item("/dashboard/chat"), item("/dashboard/admin")];

  it("changes nothing when no module contributes", () => {
    expect(mergeModuleNav(core, [])).toEqual(core);
  });

  it("puts an entry directly after the one it names", () => {
    const merged = mergeModuleNav(core, [
      mod("community", [item("/dashboard/community", { after: "/dashboard/chat" })]),
    ]);
    expect(merged.map((i) => i.href)).toEqual([
      "/dashboard",
      "/dashboard/chat",
      "/dashboard/community",
      "/dashboard/admin",
    ]);
  });

  it("appends an entry that names nothing", () => {
    const merged = mergeModuleNav(core, [mod("x", [item("/dashboard/x")])]);
    expect(merged.at(-1)!.href).toBe("/dashboard/x");
  });

  it("keeps two entries of one module in their declared order", () => {
    const merged = mergeModuleNav(core, [
      mod("m", [
        item("/dashboard/one", { after: "/dashboard" }),
        item("/dashboard/two", { after: "/dashboard" }),
      ]),
    ]);
    expect(merged.map((i) => i.href).slice(0, 3)).toEqual([
      "/dashboard",
      "/dashboard/one",
      "/dashboard/two",
    ]);
  });

  it("🚨 refuses an entry that names an href in no menu", () => {
    // Never silently appended: a dangling `after` means the module describes a
    // menu this app does not have, and its page would surface below the admin
    // section where nobody looks for it.
    expect(() =>
      mergeModuleNav(core, [mod("m", [item("/dashboard/m", { after: "/dashboard/gone" })])]),
    ).toThrow(/is in no menu/);
  });

  it("names the module and both hrefs when it refuses", () => {
    expect(() =>
      mergeModuleNav(core, [mod("late", [item("/dashboard/late", { after: "/nope" })])]),
    ).toThrow(/"late".*"\/dashboard\/late".*"\/nope"/);
  });
});

describe("🚨 every featureKey is declared and resolved", () => {
  // What `keyof ShellFeatures` used to guarantee, plus what it never could.
  // ⚠️ CORE keys only. `community` and `communityAdmin` used to be here and are
  // now the community MODULE's — resolved by its `shellState()`, not by the
  // layout. Listing them here would be a core test pinning a feature most apps
  // do not have, and it would go green in an app that never installed one.
  const SHIPPED_FEATURES = ["chat"];

  it("every featureKey in the menu belongs to the core or to a module", () => {
    const declared = new Set([...SHIPPED_FEATURES, ...MODULE_NAV.flatMap((m) => m.features)]);
    const used = NAVIGATION.map((i) => i.featureKey).filter(
      (k): k is string => typeof k === "string",
    );
    const unknown = used.filter((k) => !declared.has(k));
    expect(
      unknown,
      `these nav entries hide behind a feature key nobody declares, so they are invisible ` +
        `for ever: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("every feature a module declares is actually used by one of its entries", () => {
    // The other direction: a declared key nothing hides behind is a promise the
    // layout keeps paying for — `shellState()` resolves it on every request.
    for (const module of MODULE_NAV) {
      const used = new Set(module.NAVIGATION.map((i) => i.featureKey));
      const idle = module.features.filter((f) => !used.has(f));
      expect(idle, `"${module.id}" declares features nothing uses: ${idle.join(", ")}`).toEqual([]);
    }
  });

  it("the layout resolves every key the menu uses", () => {
    // The check the type could never make. A key nobody resolves is `undefined`,
    // and an entry behind it never appears — silently, in every app.
    const layout = readFileSync(join(ROOT, "app/dashboard/layout.tsx"), "utf8");
    for (const key of SHIPPED_FEATURES) {
      expect(layout, `nothing in the layout resolves "${key}"`).toContain(`${key}:`);
    }
  });
});

describe("the layout asks every module, and pays nothing for none", () => {
  const layout = readFileSync(join(ROOT, "app/dashboard/layout.tsx"), "utf8");

  it("resolves module features and badges through shellState()", () => {
    expect(layout).toMatch(/MODULES\.map\(async \(mod\) =>/);
    expect(layout).toContain("mod.shellState");
    expect(layout).toContain("...moduleFeatures");
    // The badges are handed over whole rather than spread: with the community
    // gone from the layout there is no core badge left to merge them with, and
    // `[...moduleBadges]` would be a copy for its own sake. What must not come
    // back is a per-feature boolean — the last assertion in this file.
    expect(layout).toMatch(/badges=\{moduleBadges\}/);
  });

  it("merges module features LAST, so a module cannot answer a core key", () => {
    // The anchor is the core's own remaining key rather than the community's,
    // which moved into a module.
    const coreKey = layout.indexOf("chat: chatNavVisible(");
    const moduleSpread = layout.indexOf("...moduleFeatures");
    expect(coreKey).toBeGreaterThan(0);
    expect(moduleSpread).toBeGreaterThan(coreKey);
  });

  it("🚨 keeps every module's query behind its own enablement guard", () => {
    // The property this whole seam exists to preserve, and the one a refactor
    // is most likely to lose: an app that never enabled a module must issue NO
    // query for it — not one that returns nothing. A feature that ships off has
    // to cost nothing, or "off" is only a word.
    //
    // ⚠️ It used to be measured on the LAYOUT, as
    // `const communityUnread = isCommunityEnabled() ? …`. The guard now belongs
    // to each module's `shellState()`, so it is measured there — on every
    // installed module, so a module added later cannot skip it.
    for (const module of MODULE_NAV) {
      const entry = join(ROOT, "modules", module.id, "module.ts");
      let source: string;
      try {
        source = readFileSync(entry, "utf8");
      } catch {
        // A module with nav but no server entry resolves no features at all,
        // so there is no query to guard.
        continue;
      }
      if (!source.includes("shellState")) continue;
      const body = source.slice(source.indexOf("shellState"));
      expect(
        body.slice(0, 400),
        `modules/${module.id}/module.ts resolves shell state without returning ` +
          `early when the module is switched off — that is a query on every ` +
          `protected page load of an app that never wanted the feature`,
      ).toMatch(/if \(![\w.]+\(\)\) return \{\};/);
    }
  });

  it("hands the shell a list of hrefs, not a per-feature boolean", () => {
    const shell = readFileSync(join(ROOT, "components/app-shell.tsx"), "utf8");
    expect(shell).toMatch(/badges\?: readonly string\[\]/);
    expect(shell).toMatch(/new Set\(badges \?\? \[\]\)/);

    // Comments stripped first — the same idiom `lib/privacy/export.test.ts`
    // uses, and for the same reason: the file EXPLAINS why the old prop went,
    // and a test that cannot tell a call from the sentence describing its
    // removal would make the change undocumentable.
    const code = withoutComments(shell);
    expect(code, "the community-specific prop is still wired up").not.toContain(
      "communityUnread",
    );
  });
});

/** Strip comments — a file may EXPLAIN a rule while not breaking it. */
describe("the menu literal stays readable as text", () => {
  // ⚠️ `navHrefs()` in scripts/ux/rules.mjs and lib/ai/nav-labels.test.ts both
  // read `export const NAVIGATION` as TEXT. `ux-check` uses it to report pages
  // that are in no menu — the one check that notices a page nobody can reach.
  //
  // ⚠️ Read with the COMMENTS STRIPPED, and that is not tidiness. The
  // assertions below are positions in the text, so a comment that merely
  // MENTIONS `mergeModuleNav(` — the header of that same file explains at
  // length why the community's entries are not in the literal — lands before
  // the literal and fails the test about a file that is entirely correct. It
  // cost two rounds of exactly that. The rule this whole block defends is about
  // code; so is what it reads.
  const shell = withoutComments(
    readFileSync(join(ROOT, "components/app-shell.tsx"), "utf8"),
  );

  it("declares NAVIGATION as a plain array literal", () => {
    expect(shell).toContain("export const NAVIGATION: NavItem[] = [");
  });

  it("merges the module entries after the literal, never into it", () => {
    const literalStart = shell.indexOf("export const NAVIGATION: NavItem[] = [");
    const literalEnd = shell.indexOf("\n];", literalStart);
    const literal = shell.slice(literalStart, literalEnd);
    expect(literal, "a spread inside the literal blinds navHrefs()").not.toContain("...");
    expect(shell.indexOf("mergeModuleNav(")).toBeGreaterThan(literalEnd);
  });
});
