// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two kinds of guard over proxy.ts, and the split is the point.
//
// The STRING tests are in the shape of lib/ai/providers/leak-guard.test.ts and
// db/sql-cast.test.ts: what they check cannot be checked by calling the code,
// because the failures they forbid compile, typecheck and serve pages.
//
// The RUNTIME test executes the actual wiring for the one path that needs no
// Auth.js session machinery — the cookie sweep on a public page — because a
// string can prove a call exists but not that a Set-Cookie deletion comes out.
import { readFileSync } from "node:fs";
import type { NextFetchEvent } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");

/**
 * The file without its comments — used by EVERY assertion here. The shapes the
 * tests forbid are named in the comments explaining why they are forbidden, and
 * an assertion over raw text would fail on its own documentation; conversely, a
 * `toContain` over raw text would stay green on a commented-out matcher line.
 */
const code = blankComments(source);

describe("proxy.ts", () => {
  it("still protects /dashboard", () => {
    // The matcher has entries that are matched only for the cookie sweep.
    // Whoever tidies that list must not take these two with it — every page
    // behind the sign-in hangs on them, and nothing else in the suite goes red.
    expect(code).toContain('"/dashboard/:path*"');
    expect(code).toMatch(/startsWith\("\/dashboard"\)/);
  });

  it("never calls auth() directly — every shape of that call drops the protection", () => {
    // `auth(async (req) => …)`, `auth(handler)` and `auth(function (req) {…})`
    // all route handleAuth() into the branch that runs the handler INSTEAD of
    // the redirect for unauthorized requests — authorized() is evaluated and
    // its answer discarded. proxy.ts calls `guarded`/`protect` and nothing
    // else, so ANY direct call is the bug, whatever the argument looks like.
    // The whole reasoning is at the `guarded` cast in proxy.ts.
    expect(code).not.toMatch(/\bauth\s*\(/);
  });
});

describe("the cookie sweep, executed", () => {
  it("a GET of /login deletes foreign fingerprints and spares its own", async () => {
    // Environment BEFORE the dynamic import: auth.config.ts computes the
    // cookie names at module load from exactly these values.
    process.env.APP_ENV = "development";
    process.env.APP_URL = "http://localhost:3000";
    process.env.AUTH_SECRET = "proxy-runtime-test-secret";

    const { default: proxy } = await import("./proxy");
    const { NextRequest } = await import("next/server");
    const { devCookies } = await import("./lib/auth/cookie-names");

    const own = devCookies({
      APP_ENV: process.env.APP_ENV,
      APP_URL: process.env.APP_URL,
      AUTH_SECRET: process.env.AUTH_SECRET,
    })!;

    // Thirteen foreign installations plus our own session — comfortably past
    // the threshold, the shape of the field failure this file exists for.
    const foreign = Array.from(
      { length: 13 },
      (_, i) => `authjs.session-token.${(0x10000000 + i).toString(16)}`,
    );
    const jar = [...foreign.map((name) => `${name}=${"x".repeat(499)}`), `${own.sessionToken.name}=mine`].join(
      "; ",
    );

    const request = new NextRequest("http://localhost:3000/login", {
      headers: { cookie: jar },
    });
    const response = await proxy(request, undefined as unknown as NextFetchEvent);
    const deletions = response.headers.getSetCookie();

    // Every foreign fingerprint is deleted (a deletion serialises the name
    // with an empty value), the app's own session is not touched.
    for (const name of foreign) {
      expect(deletions.some((cookie) => cookie.startsWith(`${name}=;`))).toBe(true);
    }
    expect(deletions.some((cookie) => cookie.startsWith(`${own.sessionToken.name}=`))).toBe(false);
  });
});

// ── The community's off-state, executed ────────────────────────────────────
//
// This is the enforcement point of FR-180 — "off" must be indistinguishable
// from "never built" — and until the code review of Epic 19 it had no unit test
// at all: `smoke` fetches the literal path once against a real boot, and that
// was the whole of it. Three of the branches below had never been executed by
// anything.
//
// Reaching them needs Auth.js stubbed, which is why the sweep test above stops
// at a public path: `/dashboard/*` goes through `protect()` first. Stubbing
// `next-auth` is the smallest thing that makes the REST of the function real —
// the config read, the decode, the location guard, the cookie carry and the
// rewrite target are all the shipped code.
//
// What this cannot prove, stated so nobody reads more into it than is here:
// that Next's ROUTER resolves `/dashboard/%63ommunity` to the community page.
// That claim belongs to the framework and is measured by the smoke assertion
// against a real boot. What is proven here is our half — that the proxy treats
// the escaped form as the community path rather than letting it through.
// ⚠️ The community's off-state used to be executed HERE, against a mock of
// `@/lib/community/config` and the rewrite target
// `/dashboard/__community-is-not-built__`. That block is gone with the feature:
// the community is a module now, and `proxy.ts` runs one generic loop over
// `MODULE_GATES` instead of a hand-written comparison per feature.
//
// The property did not go with it. `scripts/modules/gate.test.ts` executes the
// same refusal for any installed module — including the Set-Cookie carry-over,
// which is the half that would go missing in a second copy — and
// `modules/community/gate.ts` is what supplies the paths, read from the `app`
// list in the manifest rather than typed out a second time. That is what fixed
// the original defect: the hand-written version covered `/dashboard/community`
// and missed `/dashboard/admin/community`.
