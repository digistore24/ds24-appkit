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
import { describe, expect, it, vi } from "vitest";
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

// ── /dashboard, executed — the redirect every protected page hangs on ──────
//
// Measured 2026-09-15: nothing in the suite had ever sent an anonymous request
// for a `/dashboard/*` path through `proxy()`. The string test above proves the
// matcher entry and the `startsWith` are in the file; `app/route-protection.test.ts`
// deliberately skips `/dashboard/**` and delegates to that string. So the one
// behaviour the whole sign-in rests on — no session, no page — was a regex.
//
// These run the REAL wiring: `NextAuth(authConfig)` with the real `authorized()`
// callback, a real JWT minted with the same secret and salt the app uses. What
// they cannot prove is that Next's router honours the redirect; `deploy-test`
// makes that GET against a real boot, signed in and out.
describe("/dashboard, executed", () => {
  async function wired() {
    process.env.APP_ENV = "development";
    process.env.APP_URL = "http://localhost:3000";
    process.env.AUTH_SECRET = "proxy-runtime-test-secret";

    const { default: proxy } = await import("./proxy");
    const { NextRequest } = await import("next/server");
    const { devCookies } = await import("./lib/auth/cookie-names");
    const { encode } = await import("next-auth/jwt");
    const own = devCookies({
      APP_ENV: process.env.APP_ENV,
      APP_URL: process.env.APP_URL,
      AUTH_SECRET: process.env.AUTH_SECRET,
    })!;
    const run = (path: string, cookie?: string) =>
      proxy(
        new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined),
        undefined as unknown as NextFetchEvent,
      );
    /** A session the app itself would accept: same secret, salt = cookie name. */
    const session = async (maxAge = 60) =>
      `${own.sessionToken.name}=${await encode({
        token: { sub: "user-1", email: "m@example.com", role: "member" },
        secret: process.env.AUTH_SECRET!,
        salt: own.sessionToken.name,
        maxAge,
      })}`;
    return { run, session, cookieName: own.sessionToken.name };
  }

  it("🚨 anonymous → redirected to /login, for the root and for a nested page", async () => {
    const { run } = await wired();
    for (const path of ["/dashboard", "/dashboard/admin/users", "/dashboard/billing?tab=tokens"]) {
      const response = await run(path);
      expect(response.status, path).toBeGreaterThanOrEqual(300);
      expect(response.status, path).toBeLessThan(400);
      const location = response.headers.get("location") ?? "";
      expect(location, path).toContain("/login");
      expect(decodeURIComponent(location), "the way back is carried").toContain(path.split("?")[0]!);
    }
  });

  it("a forged or expired session cookie is anonymous", async () => {
    const { run, session, cookieName } = await wired();
    // Auth.js reports the undecryptable token through its logger; that line is
    // the expected outcome here, not noise worth reading.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const garbage = await run("/dashboard", `${cookieName}=eyJhbGciOiJkaXIifQ.not.a.real.token`);
      expect(garbage.headers.get("location") ?? "").toContain("/login");

      // Minted by the app's own arithmetic, with a lifetime that is already over.
      const expired = await run("/dashboard", await session(-60));
      expect(expired.headers.get("location") ?? "").toContain("/login");
    } finally {
      quiet.mockRestore();
    }
  });

  it("a real session passes through — the proxy answers next(), not a page of its own", async () => {
    const { run, session } = await wired();
    const response = await run("/dashboard/account", await session());
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("public paths in the matcher are not protected — the sweep is the only reason they are listed", async () => {
    const { run } = await wired();
    for (const path of ["/", "/plans", "/login"]) {
      const response = await run(path);
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});
