// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which host may be sent the `CRON_SECRET`, and — the half that matters —
// which may not.
//
// `POST /api/cron` triggers jobs that DELETE customer data, so the bearer token
// that opens it is at least as sensitive as the password `smokeCredentials()`
// guards. A resolver that quietly falls back to "probably meant" would send it
// to a lookalike domain on a typo, once, silently, and nothing downstream could
// tell. So every branch here is asserted — including the ones that must return
// no secret at all.
//
// Pure: no network, no filesystem, no `process.env`. The environment is a plain
// object handed in, which is what makes the refusals testable rather than hoped
// for.

import { describe, expect, it } from "vitest";

import { CRON_SCOPES, cronSecretFor, hostOf, isLocalHost } from "./remote.mjs";

const PROD_SECRET = "prod-secret-0123456789abcdef";
const STAGING_SECRET = "staging-secret-0123456789abcdef";

/** A fully configured `.env`, as `.env.example` documents it. */
const FULL = {
  APP_URL: "http://localhost:3000",
  APP_URL_PROD: "https://app.example.com",
  APP_URL_STAGING: "https://staging.example.com",
  CRON_SECRET: "the-local-one",
  CRON_SECRET_PROD: PROD_SECRET,
  CRON_SECRET_STAGING: STAGING_SECRET,
};

/** Narrowing helper — the union has three shapes and TS cannot guess which. */
function reasonOf(result: ReturnType<typeof cronSecretFor>): string {
  if (!("reason" in result)) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return result.reason;
}

function secretOf(result: ReturnType<typeof cronSecretFor>): string {
  if (!("secret" in result)) throw new Error(`expected a secret, got ${JSON.stringify(result)}`);
  return result.secret;
}

describe("hostOf", () => {
  it("normalises case, the trailing dot and IPv6 brackets", () => {
    // Each of the three would slip past an exact string comparison and hand a
    // secret to a host the operator never configured — `EXAMPLE.com.` is the
    // same host as `example.com`, and `URL.hostname` really does return `[::1]`.
    expect(hostOf("https://APP.Example.COM/x")).toBe("app.example.com");
    expect(hostOf("https://app.example.com./x")).toBe("app.example.com");
    expect(hostOf("http://[::1]:3000")).toBe("::1");
  });

  it("is null for something that is not a URL", () => {
    expect(hostOf("app.example.com")).toBeNull();
    expect(hostOf("--list")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("isLocalHost", () => {
  it("knows the three spellings of this machine and nothing else", () => {
    for (const host of ["localhost", "127.0.0.1", "::1"]) expect(isLocalHost(host)).toBe(true);
    for (const host of ["localhost.example.com", "127.0.0.1.example.com", "app.example.com"]) {
      expect(isLocalHost(host)).toBe(false);
    }
  });
});

describe("cronSecretFor", () => {
  it("refuses something that is not a URL at all", () => {
    expect(reasonOf(cronSecretFor(FULL, "app.example.com"))).toContain("not a usable URL");
  });

  it.each(["http://localhost:3011", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "sends %s down the LOCAL branch, with no secret of its own",
    (url) => {
      const result = cronSecretFor(FULL, url);
      expect(result).toEqual({ envName: "local" });
      // 🚨 The point of the shape: the caller has to reach for `cronSecret()`
      // itself, which is the only place a value is ever generated into `.env`.
      expect("secret" in result).toBe(false);
    },
  );

  it("resolves the production host to CRON_SECRET_PROD", () => {
    const result = cronSecretFor(FULL, "https://app.example.com");
    expect(result).toEqual({ envName: "prod", secret: PROD_SECRET, keyVar: "CRON_SECRET_PROD" });
  });

  it("resolves the staging host to CRON_SECRET_STAGING", () => {
    const result = cronSecretFor(FULL, "https://staging.example.com/api/cron?list");
    expect(result).toEqual({
      envName: "staging",
      secret: STAGING_SECRET,
      keyVar: "CRON_SECRET_STAGING",
    });
  });

  it("matches the host however the URL was typed", () => {
    for (const url of [
      "https://APP.example.com",
      "https://app.example.com./",
      "https://app.example.com:443/anything",
    ]) {
      expect(secretOf(cronSecretFor(FULL, url))).toBe(PROD_SECRET);
    }
  });

  it("names the exact key, and where its value comes from, when it is missing", () => {
    const { CRON_SECRET_PROD: _dropped, ...withoutKey } = FULL;
    const reason = reasonOf(cronSecretFor(withoutKey, "https://app.example.com"));
    expect(reason).toContain("CRON_SECRET_PROD");
    expect(reason).toContain("APP_URL_PROD");
    // The sentence that stops somebody generating one here and wondering why
    // the deployed app keeps answering 401.
    expect(reason).toContain("not generated here");
    expect(reason).toContain("docs/DEPLOY.md");
  });

  it("says there is nothing to scope to when no deployed host is configured", () => {
    const reason = reasonOf(
      cronSecretFor({ CRON_SECRET_PROD: PROD_SECRET }, "https://app.example.com"),
    );
    expect(reason).toContain("APP_URL_PROD");
    expect(reason).toContain("APP_URL_STAGING");
    expect(reason).toContain("never");
  });

  it("ignores an APP_URL_* that is not a URL rather than matching on it", () => {
    const reason = reasonOf(
      cronSecretFor({ ...FULL, APP_URL_PROD: "app.example.com" }, "https://app.example.com"),
    );
    expect(reason).toContain("matches none of the deployed hosts");
    expect(reason).toContain("APP_URL_STAGING=staging.example.com");
  });

  it("🚨 the needle: a lookalike domain gets a refusal, never the secret", () => {
    // The failure this function exists for, planted. Each of these is one
    // plausible slip: a typo, an attacker's homograph-ish neighbour, a host
    // that merely ENDS in the configured one, and the configured host as a
    // SUBDOMAIN of somebody else's. A resolver written with `.includes()`,
    // `.endsWith()` or a "probably meant" fallback would hand `PROD_SECRET` to
    // at least one of them — and this is the assertion that would go red.
    const lookalikes = [
      "https://app.exampIe.com", // capital I for l
      "https://app-example.com",
      "https://evil-app.example.com.attacker.test",
      "https://notapp.example.com",
      "https://app.example.com.attacker.test",
      "https://attacker.test/?x=app.example.com",
      "https://app.example.com@attacker.test/", // userinfo, not a host
    ];
    for (const url of lookalikes) {
      const result = cronSecretFor(FULL, url);
      expect("secret" in result, `${url} was handed a secret`).toBe(false);
      const reason = reasonOf(result);
      expect(reason).not.toContain(PROD_SECRET);
      expect(reason).not.toContain(STAGING_SECRET);
      expect(reason).toMatch(/never sent to a host it was not provisioned for/);
    }
  });

  it("🚨 the needle bites the other way too — the configured host IS matched", () => {
    // A refusal for everything is a resolver that refuses nothing in
    // particular. Without this the test above would pass on a function that
    // returned `{ reason }` unconditionally, which is the shape a nervous
    // "fix" produces.
    expect(secretOf(cronSecretFor(FULL, "https://app.example.com"))).toBe(PROD_SECRET);
    expect(secretOf(cronSecretFor(FULL, "https://staging.example.com"))).toBe(STAGING_SECRET);
  });

  it("never falls back to the plain CRON_SECRET for a deployed host", () => {
    // The plain key is THIS machine's, and the local app is the only thing it
    // opens. Sending it to a deployed host is the "probably meant" fallback in
    // its most tempting form: the value is right there in the .env.
    const { CRON_SECRET_PROD: _dropped, ...withoutKey } = FULL;
    const result = cronSecretFor(withoutKey, "https://app.example.com");
    expect("secret" in result).toBe(false);
    expect(reasonOf(result)).not.toContain(FULL.CRON_SECRET);
  });

  it("declares the two scopes .env.example documents, by name", () => {
    // Derived key names (`CRON_SECRET_${env.toUpperCase()}`) are how an
    // operator ends up setting `CRON_SECRET_PRODUCTION` while the code reads
    // `CRON_SECRET_PROD`, and nothing says why nothing happened.
    expect(CRON_SCOPES.map((scope) => scope.keyVar)).toEqual([
      "CRON_SECRET_PROD",
      "CRON_SECRET_STAGING",
    ]);
    expect(CRON_SCOPES.map((scope) => scope.urlVar)).toEqual(["APP_URL_PROD", "APP_URL_STAGING"]);
  });
});
