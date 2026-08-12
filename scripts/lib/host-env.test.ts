// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one host→scope rule, asserted where it now lives.
//
// Four commands point at a deployed app and each used to carry its own copy of
// this loop. The copies are gone; what is left is one file, and a defect in it
// is a defect in all four at once — which is the trade this extraction made and
// the reason this test exists rather than being left to the callers.
//
// 🚨 **The lookalike-domain needle is the point of the file.** A resolver
// written with `.includes()`, `.endsWith()` or a "probably meant" fallback would
// hand a production secret to a typo'd domain, once, silently, and nothing
// downstream could tell. The needle below plants exactly those hosts; the test
// under it plants the OTHER direction, because a helper that refuses everything
// passes the first one while refusing nothing in particular.
//
// Pure: no network, no filesystem, no `process.env`. The environment is a plain
// object handed in.

import { describe, expect, it } from "vitest";

import {
  hostOf,
  isLocalHost,
  matchHostScope,
  notAUsableUrl,
  resolveAddress,
} from "./host-env.mjs";

const SCOPES = [
  { envName: "prod", urlVar: "APP_URL_PROD", keyVar: "SECRET_PROD" },
  { envName: "staging", urlVar: "APP_URL_STAGING", keyVar: "SECRET_STAGING" },
];

const TEXTS = {
  hostsLabel: "deployed hosts",
  neverClause: "the secret is never sent to a host it was not provisioned for",
  nothingConfigured: (host: string) => `nothing configured to match ${host} against`,
};

const FULL = {
  APP_URL_PROD: "https://app.example.com",
  APP_URL_STAGING: "https://staging.example.com",
};

/**
 * The refusal half of a `{ … } | { reason }` union, narrowed.
 *
 * Both helpers return one shape or the other on purpose — that is what makes
 * "never a probably-meant fallback" a type rather than a habit — so a test
 * reading `.reason` has to say which side it means.
 */
const reasonOf = (answer: object): string => {
  if (!("reason" in answer)) throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  return String((answer as { reason: string }).reason);
};

describe("hostOf", () => {
  it("normalises case, the trailing dot and IPv6 brackets", () => {
    // Each of the three would slip past an exact comparison and hand a secret to
    // a host nobody configured. `URL.hostname` really does return `[::1]`.
    expect(hostOf("https://APP.Example.COM/x")).toBe("app.example.com");
    expect(hostOf("https://app.example.com./x")).toBe("app.example.com");
    expect(hostOf("http://[::1]:3000")).toBe("::1");
  });

  it("is null for something that is not a URL", () => {
    expect(hostOf("app.example.com")).toBeNull();
    expect(hostOf("--list")).toBeNull();
    expect(hostOf("")).toBeNull();
    expect(hostOf(undefined)).toBeNull();
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

describe("notAUsableUrl", () => {
  it("is the one sentence all four callers say", () => {
    // Spelled out rather than derived: this string is asserted verbatim by
    // `scripts/cron/remote.test.ts` and `scripts/dev/errors-remote.test.ts`,
    // which is what makes it the SAME refusal rather than three that agree.
    expect(notAUsableUrl("app.example.com")).toBe("not a usable URL: app.example.com");
  });
});

describe("matchHostScope", () => {
  it("refuses something that is not a URL at all", () => {
    expect(reasonOf(matchHostScope(FULL, "app.example.com", SCOPES, TEXTS))).toBe(
      notAUsableUrl("app.example.com"),
    );
  });

  it("hands the matching scope back untouched", () => {
    // Untouched is the contract: the helper never learns what a credential
    // looks like, so whatever the caller put on its scope comes back.
    expect(matchHostScope(FULL, "https://app.example.com/x", SCOPES, TEXTS)).toEqual({
      scope: SCOPES[0],
      host: "app.example.com",
    });
    expect(matchHostScope(FULL, "https://staging.example.com", SCOPES, TEXTS)).toEqual({
      scope: SCOPES[1],
      host: "staging.example.com",
    });
  });

  it("matches the host however the URL was typed", () => {
    for (const url of [
      "https://APP.example.com",
      "https://app.example.com./",
      "https://app.example.com:443/anything",
    ]) {
      expect(matchHostScope(FULL, url, SCOPES, TEXTS)).toMatchObject({ scope: SCOPES[0] });
    }
  });

  it("says there is nothing to match against when no host is configured", () => {
    expect(reasonOf(matchHostScope({}, "https://app.example.com", SCOPES, TEXTS))).toBe(
      "nothing configured to match app.example.com against",
    );
  });

  it("names the hosts it does know, and only the readable ones", () => {
    // An `APP_URL_*` that is set but unparseable is skipped rather than listed:
    // it is not a host anybody could have meant, and printing it as one would
    // send the reader looking at the wrong variable.
    const reason = reasonOf(
      matchHostScope(
        { ...FULL, APP_URL_PROD: "app.example.com" },
        "https://other.example.com",
        SCOPES,
        TEXTS,
      ),
    );
    expect(reason).toContain("matches none of the deployed hosts");
    expect(reason).toContain("APP_URL_STAGING=staging.example.com");
    expect(reason).not.toContain("APP_URL_PROD");
    expect(reason).toContain(TEXTS.neverClause);
  });

  it("🚨 the needle: a lookalike domain gets a refusal, never the scope", () => {
    // The failure this file exists for, planted. Each is one plausible slip: a
    // homograph, a hyphen for a dot, a host that merely ENDS in the configured
    // one, the configured host as somebody else's subdomain, it appearing in a
    // query string, and userinfo masquerading as a host. A `.endsWith()`
    // fallback in `matchHostScope()` turns this red.
    const lookalikes = [
      "https://app.exampIe.com", // capital I for l
      "https://app-example.com",
      "https://evil-app.example.com.attacker.test",
      "https://notapp.example.com",
      "https://app.example.com.attacker.test",
      "https://attacker.test/?x=app.example.com",
      "https://app.example.com@attacker.test/",
    ];
    for (const url of lookalikes) {
      const answer = matchHostScope(FULL, url, SCOPES, TEXTS);
      expect("scope" in answer, `${url} was matched to a scope`).toBe(false);
      expect(reasonOf(answer)).not.toContain("SECRET_PROD");
    }
  });

  it("🚨 the needle bites the other way too — the configured host IS matched", () => {
    // Without this, the test above passes against a helper that returns
    // `{ reason }` unconditionally — which is the shape a nervous "fix"
    // produces, and it would break all four callers at once while looking safe.
    expect(matchHostScope(FULL, "https://app.example.com", SCOPES, TEXTS)).toMatchObject({
      scope: { keyVar: "SECRET_PROD" },
    });
  });
});

describe("resolveAddress", () => {
  const ORDER = ["APP_URL_PROD", "APP_URL_STAGING", "APP_URL"];
  const none = (names: string[]) => `nothing set: ${names.join(", ")}`;

  it("prefers --url over everything configured", () => {
    expect(
      resolveAddress(FULL, ["--url", "https://given.example.com/"], { order: ORDER, none }),
    ).toEqual({
      url: "https://given.example.com",
      from: "--url",
      host: "given.example.com",
      local: false,
    });
  });

  it("walks the order it was given, and names which variable answered", () => {
    expect(resolveAddress(FULL, [], { order: ORDER, none })).toMatchObject({
      url: "https://app.example.com",
      from: "APP_URL_PROD",
    });
    expect(
      resolveAddress({ APP_URL_STAGING: FULL.APP_URL_STAGING }, [], { order: ORDER, none }),
    ).toMatchObject({ from: "APP_URL_STAGING" });
  });

  it("refuses a variable that is SET but unreadable, rather than moving on", () => {
    // 🚨 The silent fall-through this guards against would report a STAGING host
    // as production because somebody mistyped one character.
    expect(
      reasonOf(resolveAddress({ ...FULL, APP_URL_PROD: "htps:/typo" }, [], { order: ORDER, none })),
    ).toBe("APP_URL_PROD is not a usable URL: htps:/typo");
  });

  it("refuses a --url that is not one, and names the empty case separately", () => {
    expect(reasonOf(resolveAddress(FULL, ["--url", "not-a-url"], { order: ORDER, none }))).toBe(
      notAUsableUrl("not-a-url"),
    );
    expect(reasonOf(resolveAddress(FULL, ["--url"], { order: ORDER, none }))).toContain(
      "nothing after --url",
    );
  });

  it("says so when nothing is set at all", () => {
    expect(reasonOf(resolveAddress({}, [], { order: ORDER, none }))).toBe(
      "nothing set: APP_URL_PROD, APP_URL_STAGING, APP_URL",
    );
  });

  it("ALLOWS a local address by default, and reports it as local", () => {
    // The `health` command's case: "is my app up" is worth asking of
    // `node run.mjs start`, so the default is permissive and the caller is told.
    expect(
      resolveAddress({}, ["--url", "http://localhost:3000"], { order: ORDER, none }),
    ).toMatchObject({ url: "http://localhost:3000", local: true });
    expect(resolveAddress({ APP_URL: "http://127.0.0.1:3000" }, [], { order: ORDER, none })).toMatchObject(
      { from: "APP_URL", local: true },
    );
  });

  it("refuses one where the caller asked it to, with the caller's own sentences", () => {
    // The `live` rung's case, and the two sentences are different because the
    // situations are: one is an address somebody typed, the other is the only
    // one configured.
    const refuseLocal = {
      given: (host: string) => `given local: ${host}`,
      configured: (name: string) => `configured local: ${name}`,
    };
    expect(
      reasonOf(
        resolveAddress({}, ["--url", "http://localhost:3000"], { order: ORDER, none, refuseLocal }),
      ),
    ).toBe("given local: localhost");
    expect(
      reasonOf(
        resolveAddress({ APP_URL: "http://localhost:3000" }, [], { order: ORDER, none, refuseLocal }),
      ),
    ).toBe("configured local: APP_URL");
  });

  it("takes the caller's own idea of local when it has a wider one", () => {
    // `live` counts `0.0.0.0` as this machine; the shared default does not, and
    // widening the default would change what `cronSecretFor()` does with it.
    const isLocal = (host: string) => host === "0.0.0.0";
    expect(
      reasonOf(
        resolveAddress({}, ["--url", "http://0.0.0.0:3000"], {
          order: ORDER,
          none,
          isLocal,
          refuseLocal: { given: (h: string) => `no: ${h}`, configured: (n: string) => n },
        }),
      ),
    ).toBe("no: 0.0.0.0");
  });
});
