// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A module's off-state, and the comparison that decides what it covers.
//
// The history this file exists for: the community's hand-written route test
// covered `/dashboard/community` and missed `/dashboard/admin/community`. The
// operator's tree fell through to its own in-page `notFound()` — the
// layout-wrapped document the whole mechanism exists to avoid — and that page's
// `notFound()` runs BEFORE its `requireOwner()`, so any signed-in member could
// read the difference. Nothing compared the admin path; `CLAUDE.md` claimed the
// property while one of two routes enforced it.
//
// `coversSubtrees()` is that class of fault closed: the set of routes a module
// BUILDS and the set it GUARDS come from one declaration.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { coversSubtrees, guardableSubtrees } from "@/lib/modules/gate";
import { MODULE_GATES } from "@/lib/modules/gate-registry";
import { installedModules } from "./installed.mjs";
import { readModule } from "./registry.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("what a gate covers", () => {
  const covers = coversSubtrees(["dashboard/community", "dashboard/admin/community"]);

  it("covers a declared subtree and everything under it", () => {
    expect(covers("/dashboard/community")).toBe(true);
    expect(covers("/dashboard/community/groups/7")).toBe(true);
  });

  it("🚨 covers EVERY declared subtree, not just the first", () => {
    // The exact miss that shipped once.
    expect(covers("/dashboard/admin/community")).toBe(true);
    expect(covers("/dashboard/admin/community/rooms")).toBe(true);
  });

  it("does not cover a path that merely starts with the same letters", () => {
    // `/dashboard/communityXYZ` is somebody else's route, and swallowing it
    // would 404 a page that has nothing to do with the module.
    expect(covers("/dashboard/communityXYZ")).toBe(false);
    expect(covers("/dashboard/community-notes")).toBe(false);
  });

  it("covers nothing else", () => {
    for (const path of ["/dashboard", "/dashboard/account", "/", "/login"]) {
      expect(covers(path), path).toBe(false);
    }
  });

  it("accepts a subtree written with or without a leading slash", () => {
    expect(coversSubtrees(["/dashboard/x"])("/dashboard/x")).toBe(true);
    expect(coversSubtrees(["dashboard/x"])("/dashboard/x")).toBe(true);
  });

  it("covers nothing when a module declares no routes", () => {
    expect(coversSubtrees([])("/dashboard/anything")).toBe(false);
  });
});

describe("the proxy loops over the gates", () => {
  const proxy = readFileSync(join(ROOT, "proxy.ts"), "utf8");

  it("asks every installed module's gate", () => {
    expect(proxy).toContain("for (const gate of MODULE_GATES)");
    expect(proxy).toMatch(/gate\.state\(\) === "off"/);
    expect(proxy).toMatch(/gate\.covers\(decodedPathname\)/);
  });

  it('🚨 rewrites ONLY the "off" state, never a negated boolean', () => {
    // A gate has three states and the rewrite belongs to one of them. While
    // this was `!gate.enabled()`, "switched off" and "on but malformed" were
    // the same answer, so the operator's diagnosis page — promised four lines
    // above the loop, and by name in `docs/community.md` — was rewritten away
    // with the kill switch. `ModuleState` in `lib/modules/gate.ts` carries the
    // table; this holds the proxy to the row.
    const loop = proxy.slice(proxy.indexOf("for (const gate of MODULE_GATES)"));
    expect(loop).not.toMatch(/!\s*gate\.(enabled|state)\(\)/);
    expect(loop).not.toMatch(/gate\.state\(\) !== "on"/);
  });

  it("compares the DECODED path", () => {
    // `/dashboard/%63ommunity` reaches the community page. A literal compare
    // would let it slip past the rewrite into the page's own `notFound()` —
    // the distinguishable document, one percent-escape away.
    expect(proxy).toMatch(/gate\.covers\(decodedPathname\)/);
    expect(proxy).not.toMatch(/gate\.covers\(pathname\)/);
  });

  it("🚨 lets a redirect win", () => {
    // An anonymous visitor must get the same 307 either way; refusing first
    // would tell them the path exists.
    const loop = proxy.slice(proxy.indexOf("for (const gate of MODULE_GATES)"));
    expect(loop).toContain('!response.headers.get("location")');
  });

  it("carries the Set-Cookie through one shared helper", () => {
    // 🚨 A second copy of the rewrite is where the cookie carry-over goes
    // missing, and its absence is invisible until somebody compares HEADERS —
    // which the smoke check deliberately does not. So there is one helper, and
    // exactly one place that appends them.
    expect(proxy).toContain("const answerAsNeverBuilt =");
    expect(proxy.match(/rewritten\.headers\.append\("set-cookie"/g) ?? []).toHaveLength(1);
    expect(proxy.match(/NextResponse\.rewrite\(/g) ?? []).toHaveLength(1);
  });
});

describe("🚨 every installed gate guards everything its module builds", () => {
  // ⚠️ This used to be `expect(MODULE_GATES).toEqual([])` — the shipped state.
  // True of the template and false of any app that installed the community, so
  // a customer following this template's own instructions got a red suite about
  // a fault that was not one. That claim moved to
  // `scripts/shipped-lists.test.mjs` in the factory, where `template/` is
  // pristine by construction.
  //
  // What stands here instead is the sentence at the top of this file, asked of
  // the REAL manifests rather than a hand-written array: the set of routes a
  // module BUILDS (`app` in its manifest) and the set its gate GUARDS come from
  // one declaration. `coversSubtrees()` is tested above against a fixture, which
  // proves the helper works and says nothing about whether a module's own
  // `gate.ts` used it — and a `gate.ts` that hard-codes one subtree while the
  // manifest declares two is exactly the miss that shipped once.
  //
  // Empty in the shipped state; `scripts/modules/profiles.test.ts` asks the
  // manifest half of it over all four real modules without installing any.
  const installed = installedModules(ROOT);

  it("names only modules this app has", () => {
    for (const gate of MODULE_GATES) {
      expect(
        installed,
        `MODULE_GATES names "${gate.id}", which is not installed`,
      ).toContain(gate.id);
    }
  });

  it("covers every PAGE subtree the manifest declares", () => {
    for (const gate of MODULE_GATES) {
      const { manifest } = readModule(gate.id, ROOT) as { manifest: { app?: string[] } };
      const subtrees = guardableSubtrees(manifest.app ?? []);
      expect(
        subtrees.length,
        `"${gate.id}" has a gate but declares no page subtree — then the gate guards nothing`,
      ).toBeGreaterThan(0);

      for (const subtree of subtrees) {
        const path = `/${subtree}`;
        expect(
          gate.covers(path),
          `"${gate.id}" builds ${path} and its gate does not cover it. Switched off, ` +
            `that route falls through to whatever the page itself does — the ` +
            `layout-wrapped, distinguishable document this whole mechanism exists to ` +
            `avoid, which is the miss that shipped once. A gate's \`covers\` cannot READ ` +
            `the manifest (it runs in front of every request, so no fs), so this test is ` +
            `the only thing holding the hand-written list to it.`,
        ).toBe(true);
      }
    }
  });
});
