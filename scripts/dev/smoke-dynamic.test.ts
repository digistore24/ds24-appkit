// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The dynamic half of `smoke`, measured without a server.
//
// What can be settled here is the WALK (which dynamic routes this app has) and
// the JUDGEMENT (what each answer of the pair means). What cannot is whether a
// running app really refuses a stranger — that is the pair itself, and it needs
// the app, which is why `smoke` runs it and `make deploy-test` gates on it.
//
// 🚨 The one thing this file must not become is a second opinion about which
// routes exist. It asks the same walker `smoke` asks; a list of expected routes
// typed out here would go stale in the direction nobody notices — green while
// describing an app that has moved on.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectApiRoutes, collectDynamicApiRoutes } from "./api-routes.mjs";
import { NOT_EXERCISED, PROBED_ROUTE, judgePair } from "./smoke-dynamic.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every module in the tree, installed or not — a manifest is a folder here. */
const ALL_MODULES = readdirSync(`${ROOT}modules`, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("which dynamic API routes this app has", () => {
  it("finds them, and the one the pair is about is among them", () => {
    const routes = collectDynamicApiRoutes({ cwd: ROOT });
    // 🚨 Zero is a broken walk, not an app without routes: every app built on
    // this template has at least the sign-in handler.
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toContain(PROBED_ROUTE);
    // …and the walk really distinguishes: a static route must not be in it.
    expect(collectApiRoutes({ cwd: ROOT })).toContain("/api/healthz");
    expect(routes).not.toContain("/api/healthz");
  });

  it("a module's handler is a route exactly while the module is installed", () => {
    // The same switch a module's PAGES ride on. `app/api/v1/media/[id]` is
    // `route.api.ts`, so it is a route of an app that installed `api` and no
    // route at all in one that did not — which is why the walk reads the module
    // list instead of the folder alone.
    const without = collectDynamicApiRoutes({ cwd: ROOT, installed: [] });
    const with_api = collectDynamicApiRoutes({ cwd: ROOT, installed: ["api"] });
    expect(without).not.toContain("/api/v1/media/[id]");
    expect(with_api).toContain("/api/v1/media/[id]");
  });

  it("🚨 every reason names a route that really exists", () => {
    // A reason for a route that has been renamed or deleted is a sentence about
    // an app nobody has — and it would keep `smoke` printing it for ever. The
    // comparison is against the widest tree there is: every module installed.
    const everything = new Set(collectApiRoutes({ cwd: ROOT, installed: ALL_MODULES }));
    for (const { route, why } of NOT_EXERCISED) {
      expect(everything, `${route} is named in NOT_EXERCISED`).toContain(route);
      expect(why.length, route).toBeGreaterThan(20);
    }
    expect(everything).toContain(PROBED_ROUTE);
    // The probed route is not also excused — one verdict per route.
    expect(NOT_EXERCISED.map((entry) => entry.route)).not.toContain(PROBED_ROUTE);
  });

  it("every dynamic route of a pristine app has a verdict", () => {
    // Not enforced at run time — a customer's own new route must never turn
    // `smoke` red — but it is enforced HERE, for the tree we ship: a route that
    // reached a customer with "nobody has said why" is our omission, not theirs.
    const excused = new Set([PROBED_ROUTE, ...NOT_EXERCISED.map((entry) => entry.route)]);
    const unjudged = collectDynamicApiRoutes({ cwd: ROOT, installed: ALL_MODULES }).filter(
      (route) => !excused.has(route),
    );
    expect(unjudged).toEqual([]);
  });
});

// ── The judgement ───────────────────────────────────────────────────────────

const SHA = "a".repeat(64);
const OWNER_GOT_IT = { status: 200, location: "", sha256: SHA, length: 70 };
const REFUSED = { status: 404, location: "", sha256: "x", length: 9 };
const pair = (entitled: object, stranger: object) =>
  judgePair({ route: PROBED_ROUTE, id: "abc", entitled, stranger, sha256: SHA } as never);

describe("what the pair means", () => {
  it("the owner gets the file, the stranger gets 404 — the only pass", () => {
    const { failures, lines } = pair(OWNER_GOT_IT, REFUSED);
    expect(failures).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("the owner gets the file");
    expect(lines[0]).toContain("no session gets 404");
  });

  it("🚨 the same answer to both is the defect this exists for", () => {
    // The one finding nothing else in this template could produce: a private
    // file reaching somebody with no session. Both shapes of "handed out" —
    // the local driver's bytes and the cloud driver's signed redirect.
    for (const stranger of [
      OWNER_GOT_IT,
      { status: 307, location: "https://bucket.example/obj?sig=…", sha256: "", length: 0 },
    ]) {
      const { failures, lines } = pair(OWNER_GOT_IT, stranger);
      expect(failures).toBe(1);
      expect(lines.join("\n")).toContain("PRIVATE file was handed to a caller with NO session");
    }
  });

  it("a signed redirect for the owner is delivery, not a defect", () => {
    // The cloud driver never streams: `lib/media/deliver.ts` answers 307 to a
    // signed address. Judging that as "not delivered" would report every
    // deployed app as broken.
    const signed = { status: 307, location: "https://bucket.example/obj?sig=…", sha256: "", length: 0 };
    expect(pair(signed, REFUSED).failures).toBe(0);
    expect(pair(signed, REFUSED).lines[0]).toContain("signed redirect");
  });

  it("the owner not getting their own file is a finding", () => {
    expect(pair(REFUSED, REFUSED).failures).toBe(1);
    expect(pair(REFUSED, REFUSED).lines.join("\n")).toContain("did not get it");
  });

  it("the owner sent to /login means the session did not take", () => {
    const toLogin = { status: 307, location: "/login?callbackUrl=%2F", sha256: "", length: 0 };
    const { failures, lines } = pair(toLogin, REFUSED);
    expect(failures).toBe(1);
    expect(lines.join("\n")).toContain("session did not take");
  });

  it("🚨 a 200 carrying the wrong bytes is a finding too", () => {
    // The same sentence `smoke` makes about a page: a status code says the
    // server answered, not that the right thing came back.
    const wrongBytes = { status: 200, location: "", sha256: "b".repeat(64), length: 70 };
    const { failures, lines } = pair(wrongBytes, REFUSED);
    expect(failures).toBe(1);
    expect(lines.join("\n")).toContain("not the file that was uploaded");
  });

  it("an unreachable route is a finding on either side", () => {
    const dead = { status: 0, location: "", sha256: "", length: 0, error: "ECONNREFUSED" };
    expect(pair(dead, REFUSED).failures).toBe(1);
    expect(pair(OWNER_GOT_IT, dead).failures).toBe(1);
  });
});
