// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The switch that makes a module's routes exist — and the app that must not
// notice it while no module is installed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

import { availableModules } from "./registry.mjs";
import { CORE_PAGE_EXTENSIONS, modulePageExtensions } from "./page-extensions.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The three source files this test reads as TEXT, read the one sanctioned way.
 *
 * All three are code (`next.config.ts`, `scripts/dev/routes.mjs`,
 * `scripts/dev/smoke.mjs`), so the blind `blankComments()` is right and
 * `blankCommentsFor()` would only ask a question whose answer is already known.
 * It is load-bearing in both directions here: the checks below demand a call
 * (`modulePageExtensions(installedModules())`, `collectPageRoutes()`) and refuse
 * a name (`readdirSync`) — and every one of those three strings is a natural
 * thing for a comment in those files to MENTION. A sentence saying the sweep
 * derives its names would otherwise satisfy the demand, and a sentence saying
 * "this used to walk `app/` with readdirSync" would otherwise fail the refusal.
 */
const readSource = (rel: string) => blankComments(readFileSync(`${ROOT}${rel}`, "utf8"));

describe("the extension list", () => {
  it("is Next's own default when nothing is installed", () => {
    // Why this change was behaviour-neutral: an app with no modules gets
    // exactly the list it had before.
    //
    // ⚠️ Asserted on the FUNCTION, not on `installedModules()`. The second form
    // was here first and turned red the moment a module was installed for
    // testing — which is not a fault in the app, only a test that had confused
    // "what this function does" with "what this app currently has".
    // `lib/modules/installed.test.ts` owns the shipped-state claim.
    expect(modulePageExtensions([])).toEqual(["tsx", "ts"]);
  });

  it("adds one suffix pair per installed module", () => {
    expect(modulePageExtensions(["community"])).toEqual([
      "tsx",
      "ts",
      "community.tsx",
      "community.ts",
    ]);
    expect(modulePageExtensions(["chat", "community"])).toEqual([
      "tsx",
      "ts",
      "chat.tsx",
      "chat.ts",
      "community.tsx",
      "community.ts",
    ]);
  });

  it("keeps the core extensions first", () => {
    // A plain `page.tsx` must keep winning; the module suffixes are additions,
    // never replacements.
    const list = modulePageExtensions(["community"]);
    expect(list.slice(0, CORE_PAGE_EXTENSIONS.length)).toEqual(CORE_PAGE_EXTENSIONS);
  });

  it("never emits a suffix twice", () => {
    const list = modulePageExtensions(["a", "b"]);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("next.config.ts really uses it", () => {
  // A helper nothing calls is the failure this file would otherwise miss: every
  // assertion above would stay green while routes were decided somewhere else.
  const source = readSource("next.config.ts");

  it("computes pageExtensions from the installed modules", () => {
    expect(source).toMatch(/pageExtensions:\s*modulePageExtensions\(installedModules\(\)\)/);
  });

  it("reads the list off the disk, not through the bundler alias", () => {
    // `next.config.ts` is evaluated before a bundler exists, so `@/lib/...`
    // is not available to it — the same split `instrumentation.ts` documents.
    expect(source).toMatch(/from "\.\/scripts\/modules\/installed\.mjs"/);
    expect(source).not.toMatch(/from "@\/lib\/modules\/installed"/);
  });
});

describe("every module-suffixed route file names a module in this tree", () => {
  // ⚠️ Measured against AVAILABLE modules, not installed ones — and that is the
  // design rather than a loosening. `app/api/v1/me/route.api.ts` sits there in
  // every app, and in one that never ran `module add api` it is simply not a
  // route: Next does not have `api.ts` in `pageExtensions`, so it builds
  // nothing and `/api/v1/me` answers a real 404. That file is inert, exactly
  // like the rest of `modules/api/`.
  //
  // What stays a defect is a suffix naming a module that is not in the tree AT
  // ALL — a typo, or a module somebody deleted and whose routes stayed behind.
  // Such a file compiles, is never a route in any app, and nothing else would
  // ever say so.
  it("finds no orphan under app/", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const suffixed: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        // `route.test.ts` has exactly this shape, which is why `test` is a
        // RESERVED module id (scripts/modules/manifest.mjs refuses it): a
        // module called that would make every colocated route test look like
        // one of its routes, and vice versa.
        else if (/^(page|route)\.[a-z0-9-]+\.tsx?$/.test(entry) && !entry.includes(".test."))
          suffixed.push(rel);
      }
    };
    walk("app");

    const available = availableModules(ROOT);
    const orphans = suffixed.filter(
      (file) => !available.some((id) => file.endsWith(`.${id}.tsx`) || file.endsWith(`.${id}.ts`)),
    );
    expect(
      orphans,
      `these route files carry a module suffix no module in this tree claims, so Next ` +
        `can never build a route for them and nothing else would say so: ${orphans.join(", ")}`,
    ).toEqual([]);

    // Non-vacuity: the walk has to be finding the real ones too, or an orphan
    // list is empty for the wrong reason.
    expect(suffixed.length, "the walk found no module route file at all").toBeGreaterThan(0);
  });
});

// ── The sweep has to know the same names Next does ─────────────────────────
//
// 🚨 `next.config.ts` is not the only reader of this rule, and the second one is
// the one that fails QUIETLY. `node run.mjs smoke` finds the pages by walking
// `app/` for a page file, and for one commit it looked for `page.tsx` alone —
// so the community's nine pages, which had been swept every run as ordinary
// `page.tsx` files, left the sweep the moment they were renamed
// `page.community.tsx`. Smoke went on printing "All 16 page(s) answer" about an
// app that had 25, and the missing nine were the ones carrying the new queries.
//
// Nothing else could have said so. `next build` builds them, the pages render,
// every test stays green — the only symptom is a number in a line nobody
// compares against last week's. Hence a test, and hence a test on the DERIVATION
// rather than on the number: an app with a different module list has a different
// count, and a hard-coded 23 would fail on a customer's app for being correct.
//
// ⚠️ **The walk moved.** It lived inside `scripts/dev/smoke.mjs` until the
// security check's `live` rung needed the same list, and it now lives in
// `scripts/dev/routes.mjs` with both callers importing it — see that file's
// header for why a second opinion about what a route is was refused. So this
// test asks TWO things rather than one, and the second is the one that keeps the
// first honest: the walker derives its names properly, AND smoke still uses the
// walker instead of having quietly regrown a literal `page.tsx` of its own.
describe("the smoke sweep finds a module's pages", () => {
  const routes = readSource("scripts/dev/routes.mjs");
  const smoke = readSource("scripts/dev/smoke.mjs");

  it("derives its page names from this module's extension list", () => {
    expect(
      routes,
      "scripts/dev/routes.mjs must build its page names from modulePageExtensions() — " +
        "a literal 'page.tsx' there means every module page is silently unswept",
    ).toContain("modulePageExtensions(installedModules())");
  });

  it("asks the folder for those names rather than a fixed one", () => {
    expect(routes).toMatch(/\.some\(\(name\) => entries\.includes\(name\)\)/);
  });

  it("🚨 and the sweep takes its list from there rather than walking app/ itself", () => {
    expect(
      smoke,
      "scripts/dev/smoke.mjs must call collectPageRoutes() — a second walker there is " +
        "how the sweep and the security check start disagreeing about which pages exist",
    ).toContain("collectPageRoutes()");
    expect(
      smoke.includes("readdirSync"),
      "scripts/dev/smoke.mjs walks app/ again instead of importing the one walker",
    ).toBe(false);
  });
});
