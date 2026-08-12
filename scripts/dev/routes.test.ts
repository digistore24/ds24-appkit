// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The route walker, asked of THIS app's real `app/` tree.
//
// Pure: it reads the filesystem and nothing else — no network, no spawn, no
// database. That is what lets it sit inside `npm run test`, which
// `vitest.config.ts` runs over every `*.test.ts` in the tree.
//
// ⚠️ **Nothing here asserts HOW MANY routes there are.** A count would break on
// every page anybody adds and would then be "fixed" by raising the number, which
// teaches the next reader that the assertion is decoration. What is asserted is
// the four skip rules and the shape, which is what the walk actually promises —
// and what the `live` rung and `smoke.mjs` both now depend on being one answer.
import { describe, expect, it } from "vitest";

import { collectPageRoutes } from "./routes.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const routes = collectPageRoutes({ cwd: ROOT });

describe("collectPageRoutes", () => {
  it("finds this app's pages at all", () => {
    // Non-vacuity: an empty answer would make every assertion below pass loudly.
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toContain("/");
    expect(routes).toContain("/dashboard");
  });

  it("skips dynamic segments, route groups, api/ and leading underscores", () => {
    for (const route of routes) {
      expect(route, `${route} carries a dynamic segment`).not.toMatch(/\[/);
      expect(route, `${route} carries a route group`).not.toMatch(/\(/);
      expect(route, `${route} is under api/`).not.toMatch(/(^|\/)api(\/|$)/);
      expect(route, `${route} has an underscore segment`).not.toMatch(/(^|\/)_/);
    }
  });

  it("answers URL paths, always rooted, never trailing-slashed", () => {
    for (const route of routes) {
      expect(route.startsWith("/"), route).toBe(true);
      expect(route === "/" || !route.endsWith("/"), route).toBe(true);
    }
  });

  it("answers an empty list rather than throwing where there is no app/ tree", () => {
    // The refusal that goes with this ("start from the project root") is
    // `smoke.mjs`'s behaviour and stayed there deliberately — the walker's own
    // answer to a tree it cannot read is simply nothing.
    expect(collectPageRoutes({ cwd: `${ROOT}/does-not-exist` })).toEqual([]);
  });
});
