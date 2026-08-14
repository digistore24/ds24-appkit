// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { appEnv, isRealEnvironment, checkEnvironment } from "./env-guard";

describe("appEnv", () => {
  it("recognizes development (including empty/unknown-local)", () => {
    for (const v of ["development", "dev", "local", "", undefined, "  DEV  "]) {
      expect(appEnv(v)).toBe("development");
    }
  });

  it("recognizes staging", () => {
    expect(appEnv("staging")).toBe("staging");
    expect(appEnv("test")).toBe("staging");
  });

  it("classifies anything unknown as production (strict when in doubt)", () => {
    for (const v of ["production", "prod", "developmnt", "live", "whatever"]) {
      expect(appEnv(v)).toBe("production");
    }
  });
});

describe("isRealEnvironment", () => {
  it("separates DEV from STAGING/PROD", () => {
    expect(isRealEnvironment("development")).toBe(false);
    expect(isRealEnvironment("staging")).toBe(true);
    expect(isRealEnvironment("production")).toBe(true);
  });
});

describe("checkEnvironment", () => {
  // "Everything a real environment needs". It grows whenever a new start
  // condition is added, which is the point: a test named "is satisfied when
  // everything is set" has to keep meaning that.
  const complete = {
    APP_ENV: "production",
    AUTH_SECRET: "secret",
    emailConfigured: true,
    APP_URL: "https://example.com",
    emailFrom: "login@example.com",
    MEDIA_DRIVER: "s3",
    mediaBucketConfigured: true,
  };

  it("lets DEV through without mail delivery", () => {
    expect(
      checkEnvironment({ APP_ENV: "development", emailConfigured: false }),
    ).toEqual([]);
  });

  it("requires mail delivery in PROD", () => {
    const p = checkEnvironment({ ...complete, emailConfigured: false });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/email delivery/);
  });

  it("requires mail delivery in STAGING too", () => {
    const p = checkEnvironment({
      ...complete,
      APP_ENV: "staging",
      emailConfigured: false,
    });
    expect(p[0]).toMatch(/email delivery/);
  });

  it("requires AUTH_SECRET in real environments", () => {
    const p = checkEnvironment({ ...complete, AUTH_SECRET: undefined });
    expect(p.some((m) => /AUTH_SECRET/.test(m))).toBe(true);
  });

  it("reports several problems at once", () => {
    // Named rather than counted: somebody deploying a half-configured app
    // should see everything that is wrong in one go, not fix one thing and
    // meet the next on the following attempt.
    const problems = checkEnvironment({
      APP_ENV: "production",
      AUTH_SECRET: undefined,
      emailConfigured: false,
    });
    expect(problems.some((m) => /email delivery/.test(m))).toBe(true);
    expect(problems.some((m) => /AUTH_SECRET/.test(m))).toBe(true);
    expect(problems.some((m) => /MEDIA_DRIVER/.test(m))).toBe(true);
    expect(problems.some((m) => /APP_URL is not set/.test(m))).toBe(true);
    expect(problems).toHaveLength(4);
  });

  it("is satisfied when everything is set", () => {
    expect(checkEnvironment(complete)).toEqual([]);
  });
});

describe("the origin of outgoing links in a real environment", () => {
  // The DigitalOcean failure, as a start condition: with no APP_URL to derive
  // from, Auth.js takes its origin from the request headers — and behind a
  // hosting router those say what the container calls itself. The app stays
  // green in every other way; the only symptom is a customer who cannot sign
  // in. Measured 2026-08-14 on an app whose sign-in mails said
  // "https://localhost:8080/api/auth/callback/email?…".
  const complete = {
    APP_ENV: "production",
    AUTH_SECRET: "secret",
    emailConfigured: true,
    APP_URL: "https://fangfertig.de",
    emailFrom: "login@fangfertig.de",
    MEDIA_DRIVER: "s3",
    mediaBucketConfigured: true,
  };

  it("lets DEV run without an APP_URL at all", () => {
    // Somebody is still setting the machine up, and a local origin derived
    // from the request is the same address anyway.
    expect(
      checkEnvironment({ APP_ENV: "development", emailConfigured: false }),
    ).toEqual([]);
  });

  it("refuses to start without APP_URL", () => {
    const p = checkEnvironment({ ...complete, APP_URL: undefined });
    expect(p.some((m) => /APP_URL is not set/.test(m))).toBe(true);
  });

  it("refuses an APP_URL that is not a URL", () => {
    const p = checkEnvironment({ ...complete, APP_URL: "fangfertig.de" });
    expect(p.some((m) => /is not a URL/.test(m))).toBe(true);
  });

  it("accepts a local APP_URL — the staging rungs run on one", () => {
    expect(
      checkEnvironment({
        ...complete,
        APP_ENV: "staging",
        APP_URL: "http://localhost:41234",
        emailFrom: "login@localhost",
      }),
    ).toEqual([]);
  });

  it("refuses an AUTH_URL that disagrees with APP_URL", () => {
    const p = checkEnvironment({
      ...complete,
      AUTH_URL: "https://localhost:8080",
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/AUTH_URL says this app lives at/);
  });

  it("accepts the value auth.config.ts derives, and one carrying the base path", () => {
    // `applyAuthUrl()` writes APP_URL's origin into AUTH_URL, and the two run
    // in an order nobody controls — so the guard must never fire on its own
    // derivation.
    expect(
      checkEnvironment({ ...complete, AUTH_URL: "https://fangfertig.de" }),
    ).toEqual([]);
    expect(
      checkEnvironment({
        ...complete,
        AUTH_URL: "https://fangfertig.de/api/auth",
      }),
    ).toEqual([]);
  });

  it("sees a disagreeing NEXTAUTH_URL too", () => {
    const p = checkEnvironment({
      ...complete,
      NEXTAUTH_URL: "https://old-domain.de",
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/old-domain\.de/);
  });
});

describe("the sender address in a real environment", () => {
  // The fangfertig.de failure, as a start condition: sign-in mails whose links
  // point at the app but whose From lives on a foreign domain are the exact
  // shape of a phishing mail, and enough recipient reports put the app's
  // domain on Google's Safe Browsing "Dangerous site" list. Green on the day
  // it is configured, expensive weeks later — so it refuses at boot, like the
  // media rule above.
  const complete = {
    AUTH_SECRET: "secret",
    emailConfigured: true,
    APP_URL: "https://fangfertig.de",
    emailFrom: "login@fangfertig.de",
    MEDIA_DRIVER: "s3",
    mediaBucketConfigured: true,
  };

  it("lets DEV send from anywhere", () => {
    expect(
      checkEnvironment({ ...complete, APP_ENV: "development", emailFrom: "login@elsewhere.com" }),
    ).toEqual([]);
  });

  for (const environment of ["staging", "production"]) {
    it(`refuses ${environment} with a sender on a foreign domain`, () => {
      const problems = checkEnvironment({
        ...complete,
        APP_ENV: environment,
        emailFrom: "login@other-agency.com",
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("other-agency.com");
      expect(problems[0]).toContain("Safe Browsing");
      expect(problems[0]).toContain("EMAIL_FROM_FOREIGN_DOMAIN");
    });

    it(`refuses ${environment} with a transport but no sender at all`, () => {
      // SMTP counts as configured with host+user+password alone, so without
      // this the app would quietly send as "login@localhost".
      const problems = checkEnvironment({ ...complete, APP_ENV: environment, emailFrom: null });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("no sender");
    });

    it(`starts ${environment} with a sender on a subdomain of the app`, () => {
      expect(
        checkEnvironment({ ...complete, APP_ENV: environment, emailFrom: "login@mail.fangfertig.de" }),
      ).toEqual([]);
    });

    it(`starts ${environment} on a matching override — the deliberate decision`, () => {
      expect(
        checkEnvironment({
          ...complete,
          APP_ENV: environment,
          emailFrom: "login@other-agency.com",
          emailFromForeignDomain: "other-agency.com",
        }),
      ).toEqual([]);
    });

    it(`still refuses ${environment} on a yes-flag override`, () => {
      // The override must name the domain — "=1" acknowledges nothing in
      // particular and would silence the check for every future sender too.
      const problems = checkEnvironment({
        ...complete,
        APP_ENV: environment,
        emailFrom: "login@other-agency.com",
        emailFromForeignDomain: "1",
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("yes-flag");
    });
  }

  it("does not double-report when no transport is configured at all", () => {
    // "No email delivery" already covers that case; two messages for one
    // missing setup read like two faults.
    const problems = checkEnvironment({
      ...complete,
      APP_ENV: "production",
      emailConfigured: false,
      emailFrom: null,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/email delivery/);
  });

  it("skips the domain comparison behind a local APP_URL, but not the missing sender", () => {
    // A staging instance fronted by an IP or tunnel has no public host to
    // compare against — but a configured transport with no From is a fault
    // everywhere.
    expect(
      checkEnvironment({
        ...complete,
        APP_ENV: "staging",
        APP_URL: "http://localhost:3000",
        emailFrom: "login@anywhere.com",
      }),
    ).toEqual([]);
    const problems = checkEnvironment({
      ...complete,
      APP_ENV: "staging",
      APP_URL: "http://localhost:3000",
      emailFrom: null,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no sender");
  });
});

describe("media storage in a real environment", () => {
  const base = {
    AUTH_SECRET: "s",
    emailConfigured: true,
    APP_URL: "https://example.com",
    emailFrom: "login@example.com",
  };

  it("lets development do whatever it likes", () => {
    // A fresh clone has no bucket and must still start.
    expect(checkEnvironment({ ...base, APP_ENV: "development" })).toEqual([]);
    expect(
      checkEnvironment({ ...base, APP_ENV: "development", MEDIA_DRIVER: "local" }),
    ).toEqual([]);
  });

  for (const environment of ["staging", "production"]) {
    it(`refuses to start ${environment} on the local disk`, () => {
      // The decision a later reader is most likely to soften, because on ONE
      // node the local disk works perfectly. The failure it prevents appears
      // only after the app is successful: the next redeploy loses every file,
      // and a second instance cannot see what the first one wrote.
      const problems = checkEnvironment({
        ...base,
        APP_ENV: environment,
        MEDIA_DRIVER: "local",
        mediaBucketConfigured: false,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("MEDIA_DRIVER");
      expect(problems[0]).toContain("redeploy");
    });

    it(`refuses ${environment} with MEDIA_DRIVER unset at all`, () => {
      // Unset must not be a quieter way of saying "local".
      const problems = checkEnvironment({ ...base, APP_ENV: environment });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("MEDIA_DRIVER");
    });

    it(`refuses ${environment} when s3 is chosen but not configured`, () => {
      // Not "media off" — an app that accepts an upload and fails at the moment
      // it tries to store it, after the customer has waited for the file to
      // travel.
      const problems = checkEnvironment({
        ...base,
        APP_ENV: environment,
        MEDIA_DRIVER: "s3",
        mediaBucketConfigured: false,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("MEDIA_S3_ENDPOINT");
    });

    it(`starts ${environment} with a configured bucket`, () => {
      expect(
        checkEnvironment({
          ...base,
          APP_ENV: environment,
          MEDIA_DRIVER: "s3",
          mediaBucketConfigured: true,
        }),
      ).toEqual([]);
    });

    // ── The exemption, which had no test at all ───────────────────────────
    // It is the one change in this area that LOOSENS a rule `CLAUDE.md` states
    // as absolute ("In STAGING and PROD `MEDIA_DRIVER=local` stops the app from
    // starting"), and an untested exemption to a hard rule is how the rule
    // quietly stops existing. Both directions are asserted here so that
    // widening it takes a deliberate edit to a test that says why.
    it(`starts ${environment} with media switched OFF and no bucket`, () => {
      // An app that accepts no media needs nowhere to put it. Without this,
      // every app generated from 0.7.0 had to book object storage before it
      // could deploy — including the ones that will never take a file.
      expect(
        checkEnvironment({
          ...base,
          APP_ENV: environment,
          MEDIA_DRIVER: "local",
          mediaBucketConfigured: false,
          mediaEnabled: false,
        }),
      ).toEqual([]);
    });

    it(`still refuses ${environment} on the local disk when media is ON`, () => {
      // The exemption reaches exactly as far as `"enabled": false`. An app that
      // uses media gets the original refusal, and `mediaEnabled: undefined` —
      // an older caller that does not pass the field — must behave as ON.
      for (const mediaEnabled of [true, undefined]) {
        const problems = checkEnvironment({
          ...base,
          APP_ENV: environment,
          MEDIA_DRIVER: "local",
          mediaBucketConfigured: false,
          mediaEnabled,
        });
        expect(problems, `mediaEnabled: ${String(mediaEnabled)}`).toHaveLength(1);
        expect(problems[0]).toContain("MEDIA_DRIVER");
      }
    });

    it(`refuses ${environment} on a driver that does not exist`, () => {
      const problems = checkEnvironment({
        ...base,
        APP_ENV: environment,
        MEDIA_DRIVER: "ftp",
        mediaBucketConfigured: true,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("not a driver");
    });
  }
});
