// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The cookie names from lib/auth/cookie-names.ts only help if they actually
// reach Auth.js. They did not for a long time: `devCookies(...)` was computed
// in auth.config.ts and then never handed to the exported config — so locally
// the Auth.js defaults were in force after all, and a leftover
// `authjs.session-token` from another app on localhost produced
// "JWTSessionError: no matching decryption secret" on every page load.
//
// That is why the wiring is tested here and not just the pure function.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { installationFingerprint } from "@/lib/auth/cookie-names";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const SECRET = "0123456789abcdef0123456789abcdef";

/** Loads auth.config.ts freshly with the given env (it reads it at import time). */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return (await import("./auth.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  // Importing auth.config WRITES to process.env (`applyAuthUrl`), and
  // `unstubAllEnvs` only restores what was stubbed — so without this the first
  // load's origin would still be in force for every later one.
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
});

describe("auth.config cookie names", () => {
  it("carries the fingerprinted names locally", async () => {
    const config = await loadConfig({
      APP_ENV: "development",
      APP_URL: "http://localhost:3000",
      AUTH_SECRET: SECRET,
    });

    const fingerprint = installationFingerprint(SECRET);
    expect(config.cookies?.sessionToken?.name).toBe(
      `authjs.session-token.${fingerprint}`,
    );
    expect(config.cookies?.callbackUrl?.name).toBe(
      `authjs.callback-url.${fingerprint}`,
    );
    expect(config.cookies?.csrfToken?.name).toBe(
      `authjs.csrf-token.${fingerprint}`,
    );
  });

  it("leaves the Auth.js defaults alone in a real environment", async () => {
    const config = await loadConfig({
      APP_ENV: "production",
      APP_URL: "https://app.example.com",
      AUTH_SECRET: SECRET,
    });

    expect(config.cookies).toBeUndefined();
  });
});

// 🚨 The origin of everything Auth.js MAILS OUT.
//
// The pure rule is `lib/auth/auth-url.mjs` and is tested there. What is tested
// HERE is that it reaches Auth.js at all — the same argument as the cookie
// names above, and the same failure mode: a value computed and then thrown
// away. Auth.js offers no config field for this, so the only lever is the
// environment (`reqWithEnvURL()` in next-auth/lib/env.js), and importing this
// file is what pulls it.
//
// What it prevents, measured on a real deployment 2026-08-14: behind
// DigitalOcean's router the container sees itself as `localhost:8080`, and the
// sign-in mails carried `https://localhost:8080/api/auth/callback/email?…`
// while typecheck, the whole suite, `smoke` and `errors` were green.
describe("🚨 the origin of outgoing auth links", () => {
  it("comes from APP_URL, not from the request", async () => {
    delete process.env.AUTH_URL;
    await loadConfig({
      APP_ENV: "production",
      APP_URL: "https://fangfertig.de",
      AUTH_SECRET: SECRET,
    });

    expect(process.env.AUTH_URL).toBe("https://fangfertig.de");
  });

  it("is the ORIGIN — a path in APP_URL must not move the auth routes", async () => {
    // AUTH_URL's pathname becomes Auth.js's basePath (next-auth/lib/env.js),
    // so handing APP_URL over whole would put every auth route under /app.
    delete process.env.AUTH_URL;
    await loadConfig({
      APP_ENV: "production",
      APP_URL: "https://example.com/app",
      AUTH_SECRET: SECRET,
    });

    expect(process.env.AUTH_URL).toBe("https://example.com");
  });

  it("leaves an operator's own AUTH_URL alone", async () => {
    // A deployment that already worked around the defect by hand keeps
    // working; `lib/env-guard.ts` refuses the start when the two disagree.
    process.env.AUTH_URL = "https://www.fangfertig.de";
    await loadConfig({
      APP_ENV: "production",
      APP_URL: "https://fangfertig.de",
      AUTH_SECRET: SECRET,
    });

    expect(process.env.AUTH_URL).toBe("https://www.fangfertig.de");
  });

  it("runs before anything in this file can build a URL", () => {
    // Structural, because the ordering is the whole point and an import that
    // was moved below `NextAuth()`'s reach would still typecheck: the call sits
    // at module scope, not inside a callback.
    const source = blankComments(
      readFileSync(new URL("./auth.config.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/^applyAuthUrl\(process\.env\);$/m);
    expect(
      source.indexOf("applyAuthUrl(process.env);"),
      "applyAuthUrl() must run before the config object is built",
    ).toBeLessThan(source.indexOf("export default {"));
  });
});

// 🚨 `id` and `role` are declared REQUIRED on the session (auth.ts), and the
// only thing that makes that true is this callback setting them in every branch
// it can return through.
//
// Nothing pinned that. The declaration used to say `id?: string` and the app
// paid for the doubt at the call sites — 60 `session.user.id as string` and 21
// `role as string`, a quarter of every cast in the tree. Removing them is only
// safe while this holds, and "it holds today" is not a guard: a fourth branch
// added below the third would compile, ship, and hand `undefined` to code whose
// type says string.
//
// So the real callback is driven through all three branches it can reach with a
// user present. The fourth (`if (!session.user) return session`) is not one of
// them — there is no user object to carry the fields.
describe("🚨 the session callback sets id and role in every branch", () => {
  const CLAIM = {
    id: "imp-1",
    operatorId: "operator-1",
    operatorRole: "owner",
    operatorEmail: "chef@example.com",
    memberEmail: "kunde@example.com",
  };

  /** A session as Auth.js hands it in, before the callback touches it. */
  const blank = () => ({ user: { email: "kunde@example.com" }, expires: "" });

  async function runSession(token: Record<string, unknown>) {
    const config = await loadConfig({ APP_ENV: "development", AUTH_SECRET: SECRET });
    const session = config.callbacks?.session;
    expect(session, "auth.config declares no session callback").toBeTypeOf("function");
    // Auth.js hands the callback more than these two; the callback reads two.
    return (await (session as (arg: unknown) => unknown)({
      session: blank(),
      token,
    })) as { user?: { id?: unknown; role?: unknown; impersonation?: unknown } };
  }

  it("the ordinary branch — nobody is impersonating", async () => {
    const result = await runSession({ sub: "member-9", role: "member" });
    expect(result.user?.id).toBe("member-9");
    expect(result.user?.role).toBe("member");
  });

  it("…and falls back to `member` rather than leaving the role unset", async () => {
    // A token minted before roles existed, or one whose claim was dropped.
    // `undefined` here would be a role the type says is a string.
    const result = await runSession({ sub: "member-9" });
    expect(result.user?.role).toBe("member");
  });

  it("the running impersonation — the MEMBER's id and role, deliberately", async () => {
    const result = await runSession({
      sub: "member-9",
      role: "member",
      imp: { ...CLAIM, expiresAt: Date.now() + 60_000 },
    });
    expect(result.user?.id).toBe("member-9");
    expect(result.user?.role).toBe("member");
    expect(result.user?.impersonation).not.toBeNull();
  });

  it("the expired impersonation — the OPERATOR is themselves again", async () => {
    const result = await runSession({
      sub: "member-9",
      role: "member",
      imp: { ...CLAIM, expiresAt: Date.now() - 60_000 },
    });
    expect(result.user?.id).toBe("operator-1");
    expect(result.user?.role).toBe("owner");
    expect(result.user?.impersonation).toBeNull();
  });

  it("🚨 leaves neither field unset in ANY branch it can return through", () => {
    // The structural half, and the one that survives a branch nobody thought to
    // add a case for above. Read as text: every `return session` inside the
    // callback must be preceded by an assignment to both fields, or be the
    // guard that returns because there is no user at all.
    //
    // Comments are blanked first — this very block describes the shape.
    const source = blankComments(
      readFileSync(new URL("./auth.config.ts", import.meta.url), "utf8"),
    );
    const body = source.slice(
      source.indexOf("session({ session, token })"),
      source.indexOf("// PaaS platforms set the Host header"),
    );
    expect(body.length, "the session callback did not parse").toBeGreaterThan(200);

    // ⚠️ Split on the returns and read each BLOCK — never `lastIndexOf` over
    // everything before a return. That was the first shape of this assertion
    // and it is worthless: an assignment in an earlier branch satisfies it for
    // a later one, so a fourth branch returning early passed. Measured, with
    // the needle `if (token.role === "moderator") return session;` inserted
    // above the last branch: typecheck clean and this test green.
    const blocks = body.split("return session;");
    // The last piece is whatever follows the final return — not a branch.
    const branches = blocks.slice(0, -1);
    expect(branches.length, "no `return session` found — did the shape change?")
      .toBeGreaterThan(3);

    branches.forEach((block, at) => {
      // The one legitimate exception: there is no user object to carry fields.
      if (/if \(!session\.user\)\s*$/.test(block.trimEnd())) return;
      expect(
        block,
        `branch ${at + 1} of the session callback returns without setting ` +
          "`session.user.id` — `auth.ts` declares that field required and 80 " +
          "call sites believe it",
      ).toContain("session.user.id =");
      expect(
        block,
        `branch ${at + 1} of the session callback returns without setting ` +
          "`session.user.role`",
      ).toContain("session.user.role =");
    });
  });
});
