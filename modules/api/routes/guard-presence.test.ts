// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every v1 handler guards itself — enforced structurally, not by review.
//
// `proxy.ts` matches `/dashboard` only, so everything under `app/api/` is
// PUBLIC until it protects itself. On the v1 surface that protection is
// `guardApi()` as the first thing a handler does, and THIS test is what makes
// the rule survive handler #7, added a year from now by somebody who never
// read the docs: a handler here that does not import and call `guardApi` fails
// the build, with the file named.
//
// 🚨 **And there is no second net behind it.** `app/route-protection.test.ts`
// skips `app/api/v1` on purpose and says so in its own header — "it does not
// check `app/api/v1/**` (guard-presence.test.ts does, better)". The two walks
// do not overlap, they abut. Whatever this file fails to look at is looked at
// by nothing at all.
//
// ⚠️ **What it walks changed when the API became a module, and the change is
// the kind that goes quietly wrong.** The handlers used to be
// `app/api/v1/**/route.ts` and this file matched that name exactly. They are
// now flat files in THIS folder, with the thin `route.api.ts` declarations left
// under `app/` where Next insists (`scripts/modules/page-extensions.mjs`). A
// walk still looking for `route.ts` would find NOTHING and every assertion
// below would pass on an empty loop — which is why each block opens with a
// non-vacuity floor that names something it must have found.
//
// 🚨 **The same shape bit twice on 2026-08-12, both times at a MODULE's
// contribution**, which is why the second block below derives rather than
// lists: `scripts/deploy-test.mjs` kept the module commands by hand and
// silently skipped `courses-check` and `courses-diff` for as long as they
// existed, and `scripts/lib/env.test.ts` walked `scripts/` and therefore missed
// all four module commands. A folder walk anchored on ONE module's directory is
// the third instance waiting to happen: the v1 surface is contributed to by
// every module declaring an `api/v1` subtree, and a walk that knows only about
// `modules/api/` would go green over another module's unguarded handler.
//
// So there are two blocks, and they ask different questions:
//
//   1. **the folder** — every handler file in this module's `routes/` guards
//      itself, declared or not. Catches a handler written but not yet wired.
//   2. **the surface** — every route DECLARATION under `app/api/v1/**`, for
//      every module in the tree, resolves to a handler that guards itself.
//      Catches a declaration pointing at something unguarded, wherever it
//      lives. This is the one that covers a module's contribution.
//
// The one exception is named, not patterned: `auth/token` has no key to
// guard with — a key is what it exists to hand out. Its protection is the
// password check plus the mint meter, asserted in its own colocated test. It is
// named ONCE, as a path from the app root, so the two blocks cannot drift into
// exempting different things.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { availableModules, readModule } from "@/scripts/modules/registry.mjs";

const V1 = __dirname;
/** `modules/api/routes` → the app root. */
const ROOT = path.resolve(__dirname, "..", "..", "..");
const APP_V1 = path.join(ROOT, "app", "api", "v1");

/** App-root-relative, forward slashes — the one spelling both blocks compare on. */
const rel = (full: string) => path.relative(ROOT, full).split(path.sep).join("/");

/**
 * The token endpoint — the sign-in door, guarded differently on purpose.
 *
 * A HANDLER path rather than a route path: the folder block sees files and the
 * surface block resolves declarations to files, so the file is the one thing
 * both of them hold.
 */
const EXEMPT = ["modules/api/routes/auth-token.ts"];

/** Does this handler's source import `guardApi` and call it? */
function guards(file: string): { imports: boolean; calls: boolean } {
  const source = readFileSync(file, "utf8");
  return {
    imports: source.includes('from "@/modules/api/api/guard"'),
    calls: /await\s+guardApi\s*\(/.test(source),
  };
}

// ── 1. the folder ───────────────────────────────────────────────────────────

/**
 * Every handler in this folder.
 *
 * Inverted from the old rule: it used to name the one file that IS a handler
 * (`route.ts`); it now names the two kinds that are not (a test, and this file).
 * That direction is deliberate — a handler added under a name nobody predicted
 * is caught, where an allowlist of handler names would silently skip it.
 */
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.includes(".test."))
    .map((entry) => path.join(dir, entry.name));
}

const routes = routeFiles(V1).map((full) => ({ full, relative: rel(full) }));

describe("every handler in modules/api/routes calls guardApi", () => {
  it("actually finds the routes, so an empty sweep means something", () => {
    // Non-vacuity: a broken walk must not go green by checking nothing.
    expect(routes.length).toBeGreaterThanOrEqual(9);
    expect(routes.some((r) => r.relative === "modules/api/routes/me.ts")).toBe(true);
  });

  for (const route of routes) {
    if (EXEMPT.includes(route.relative)) continue;

    it(`${route.relative} imports guardApi and calls it`, () => {
      const state = guards(route.full);
      expect(
        state.imports,
        `${route.relative} does not import guardApi — every v1 handler guards itself (docs/api.md)`,
      ).toBe(true);
      expect(state.calls, `${route.relative} imports guardApi but never calls it`).toBe(true);
    });
  }

  it("keeps the exemption list honest — only files that exist", () => {
    for (const exempt of EXEMPT) {
      expect(
        routes.some((r) => r.relative === exempt),
        `guard-presence exemption "${exempt}" names no existing handler`,
      ).toBe(true);
    }
  });
});

// ── 2. the surface ──────────────────────────────────────────────────────────

/**
 * The modules that contribute to `/api/v1`, read off their manifests.
 *
 * Derived, never listed — see the header. `availableModules()` is the TREE and
 * not this app: a module's files are on disk whether or not it is installed, so
 * the claim this block makes is about what the template ships rather than about
 * one customer's `config/modules.json`. That is the same argument
 * `scripts/core/purity.test.ts` makes for reading `coreExport` the same way.
 */
function contributingModules(): string[] {
  return availableModules(ROOT).filter((id) => {
    const { manifest } = readModule(id, ROOT) as { manifest: { app?: string[] } };
    return (manifest.app ?? []).some((entry) => entry === "api/v1" || entry.startsWith("api/v1/"));
  });
}

const CONTRIBUTORS = contributingModules();

/**
 * Which file names under `app/api/v1` are route declarations.
 *
 * Built from the module ids in the tree rather than from a pattern, so
 * `route.<something>.ts` for a word that is not a module cannot quietly count
 * as a declaration — `page-extensions.mjs` gives a route exactly one module id,
 * and this is the same set seen from the other side.
 */
const DECLARATION_NAMES = new Set([
  "route.ts",
  ...availableModules(ROOT).flatMap((id) => [`route.${id}.ts`, `route.${id}.tsx`]),
]);

/** Every route declaration under `app/api/v1`, recursively. */
function declarationsIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...declarationsIn(full));
    else if (DECLARATION_NAMES.has(entry.name)) found.push(full);
  }
  return found;
}

/** The `@/…` specifier a declaration re-exports its handler from. */
function handlerSpecifier(file: string): string | null {
  const source = readFileSync(file, "utf8");
  const match = source.match(/\bexport\s*\{[^}]*\}\s*from\s+["']([^"']+)["']/);
  return match ? match[1] : null;
}

const declarations = declarationsIn(APP_V1).map((full) => ({ full, relative: rel(full) }));

describe("every /api/v1 declaration points at a handler that guards itself", () => {
  it("finds the declarations, and one per contributing module", () => {
    expect(declarations.length).toBeGreaterThanOrEqual(10);

    // The floor that makes a module's contribution non-optional: a module that
    // says in its manifest that it serves `api/v1` must have at least one
    // declaration named for it. Without this, a module could declare the
    // subtree, ship handlers, and be walked by nothing.
    expect(CONTRIBUTORS.length).toBeGreaterThanOrEqual(1);
    for (const id of CONTRIBUTORS) {
      expect(
        declarations.some((d) => d.relative.endsWith(`/route.${id}.ts`)),
        `"${id}" declares an api/v1 subtree in its manifest but has no route.${id}.ts under app/api/v1`,
      ).toBe(true);
    }
  });

  for (const declaration of declarations) {
    it(`${declaration.relative} resolves to a guarded handler`, () => {
      const specifier = handlerSpecifier(declaration.full);
      expect(
        specifier,
        `${declaration.relative} re-exports nothing — a declaration delegates to its module's handler`,
      ).not.toBeNull();

      // 🚨 `resolveImport()` and never a second `@/` branch — CLAUDE.md → Rules.
      // It answers three states, and "I could not look" must not read as "there
      // is nothing there".
      const resolved = resolveImport(declaration.full, specifier as string, { root: ROOT });
      expect(
        resolved !== null && resolved.exists,
        `${declaration.relative} re-exports "${specifier}", which resolves to no file`,
      ).toBe(true);

      const handler = rel((resolved as { path: string }).path);
      if (EXEMPT.includes(handler)) return;

      const state = guards((resolved as { path: string }).path);
      expect(
        state.imports,
        `${handler} serves ${declaration.relative} and does not import guardApi — ` +
          `every v1 handler guards itself, whichever module it belongs to (docs/api.md)`,
      ).toBe(true);
      expect(
        state.calls,
        `${handler} serves ${declaration.relative}, imports guardApi and never calls it`,
      ).toBe(true);
    });
  }
});
