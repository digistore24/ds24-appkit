// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The parts of the smoke sign-in that decide things, pinned.
//
// Most of sign-in.mjs is network choreography a unit test cannot hold still —
// but two pieces are pure decisions, and both have a failure mode that would
// not announce itself:
//
//  - cookieJar() must hand back exactly what the app set. Session cookie names
//    are deliberately unknown to it (they carry an AUTH_SECRET fingerprint in
//    DEV), and multiple Set-Cookie headers must not be fused — a jar that
//    mangles them makes smoke's signed-in pass silently anonymous.
//  - smokeCredentials() scopes a real production password to the host it was
//    provisioned for. The refusal for every other host is a SECURITY property:
//    `smoke --url https://lookalike.example` must never POST the prod
//    password there. If the "matches none of the deployed hosts" assertions
//    below start failing, that property was traded away, not tidied up.
//  - noOwnerHint() tells the operator how an app gets its first owner, and
//    the two answers must not be swapped: in DEV the first sign-in becomes the
//    owner (lib/users/bootstrap.ts) and no command is needed; outside DEV that
//    door is shut and `user-create` is the only way. The DEV sentence on a
//    deployed app would tell somebody to hand user management to whoever
//    signs in first.
import { describe, it, expect } from "vitest";
import { cookieJar, noOwnerHint, smokeCredentials } from "./sign-in.mjs";

/** A Response stand-in carrying only what the jar reads. */
function withSetCookies(headers: string[]) {
  return { headers: { getSetCookie: () => headers } } as unknown as Response;
}

describe("cookieJar", () => {
  it("stores every Set-Cookie header separately and replays name=value", () => {
    const jar = cookieJar();
    jar.take(
      withSetCookies([
        "csrf=abc; Path=/; HttpOnly",
        "session=xyz; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly",
      ]),
    );
    expect(jar.size).toBe(2);
    expect(jar.header).toBe("csrf=abc; session=xyz");
  });

  it("keeps the last value per name — a re-issued session replaces the old one", () => {
    const jar = cookieJar();
    jar.take(withSetCookies(["session=first; Path=/"]));
    jar.take(withSetCookies(["session=second; Path=/"]));
    expect(jar.size).toBe(1);
    expect(jar.header).toBe("session=second");
  });

  it("survives a response with no Set-Cookie at all", () => {
    const jar = cookieJar();
    jar.take({ headers: {} } as unknown as Response);
    expect(jar.size).toBe(0);
    expect(jar.header).toBe("");
  });
});

describe("smokeCredentials", () => {
  const env = {
    APP_URL_PROD: "https://app.example.de",
    SMOKE_PROD_EMAIL: "smoke@app.example.de",
    SMOKE_PROD_PASSWORD: "prod-secret",
    APP_URL_STAGING: "https://staging.example.de",
    SMOKE_STAGING_EMAIL: "smoke@staging.example.de",
    SMOKE_STAGING_PASSWORD: "staging-secret",
  };

  it("hands the prod credentials to the prod host — path and port do not distract it", () => {
    expect(smokeCredentials(env, "https://app.example.de")).toEqual({
      email: "smoke@app.example.de",
      password: "prod-secret",
      envName: "prod",
    });
    expect(smokeCredentials(env, "https://app.example.de:443/dashboard")).toMatchObject({
      envName: "prod",
    });
  });

  it("hands the staging credentials to the staging host", () => {
    expect(smokeCredentials(env, "https://staging.example.de")).toMatchObject({
      email: "smoke@staging.example.de",
      envName: "staging",
    });
  });

  it("refuses every host it was not provisioned for — the scoping invariant", () => {
    const verdict = smokeCredentials(env, "https://lookalike.example.de");
    expect(verdict).toHaveProperty("reason");
    expect((verdict as { reason: string }).reason).toContain("matches none of the deployed hosts");
    expect((verdict as { reason: string }).reason).toContain("app.example.de");
  });

  it("names the smoke-account command when the host is known but no account exists", () => {
    const bare = { APP_URL_PROD: "https://app.example.de" };
    const verdict = smokeCredentials(bare, "https://app.example.de");
    expect((verdict as { reason: string }).reason).toContain("node run.mjs smoke-account --apply");

    const bareStaging = { APP_URL_STAGING: "https://staging.example.de" };
    const staging = smokeCredentials(bareStaging, "https://staging.example.de");
    expect((staging as { reason: string }).reason).toContain("--env staging");
  });

  it("says that APP_URL_PROD is missing when no deployed host is configured at all", () => {
    const verdict = smokeCredentials({}, "https://app.example.de");
    expect((verdict as { reason: string }).reason).toContain("APP_URL_PROD is not set");
  });

  it("refuses an unusable URL instead of guessing", () => {
    expect(smokeCredentials(env, "not a url")).toHaveProperty("reason");
  });
});

describe("noOwnerHint", () => {
  it("in DEV names the sign-in page instead of a command — the first account makes itself", () => {
    // The reader is an operator who builds by talking to an AI program; a
    // `user-create --email … --role owner --apply` sent them looking for a
    // command the app does not need locally (measured 2026-09-10).
    const hint = noOwnerHint({ APP_ENV: "development" }, "http://localhost:3007");
    expect(hint).toContain("no owner account yet");
    expect(hint).toContain("http://localhost:3007/login");
    expect(hint).toContain("any address");
    expect(hint).toContain("first account becomes the owner");
    expect(hint).not.toContain("user-create");
  });

  it("uses the same allowlist as lib/users/bootstrap.ts — dev, local and unset all count as DEV", () => {
    for (const APP_ENV of ["dev", "local", "", undefined]) {
      expect(noOwnerHint({ APP_ENV }, "http://localhost:3000"), `APP_ENV=${APP_ENV}`).toContain("/login");
    }
  });

  it("outside DEV keeps the user-create command — the first sign-in there may be a customer", () => {
    // The needle for the case above: a hint that always named /login would
    // pass every DEV assertion and describe an account takeover on a live app.
    for (const APP_ENV of ["staging", "production", "prod", "typo"]) {
      const hint = noOwnerHint({ APP_ENV }, "https://app.example.de");
      expect(hint, `APP_ENV=${APP_ENV}`).toContain("node run.mjs user-create --email … --role owner --apply");
      expect(hint, `APP_ENV=${APP_ENV}`).not.toContain("/login");
    }
  });
});
