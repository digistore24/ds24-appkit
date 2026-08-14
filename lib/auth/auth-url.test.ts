// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The rule that decides what a customer finds in their sign-in mail.
//
// It was measured going wrong on a real deployment: behind DigitalOcean's
// router the container sees itself as `localhost:8080`, Auth.js derived its
// origin from that, and the mail carried
// `https://localhost:8080/api/auth/callback/email?…` while every gate here was
// green. The pure half of the fix lives in auth-url.mjs; that it reaches
// Auth.js at all is `auth.config.test.ts`.
import { describe, it, expect } from "vitest";

import {
  applyAuthUrl,
  authUrlProblem,
  configuredAuthUrl,
  strandedRedirect,
  urlOrigin,
} from "./auth-url.mjs";

describe("urlOrigin", () => {
  it("keeps scheme, host and port", () => {
    expect(urlOrigin("https://fangfertig.de")).toBe("https://fangfertig.de");
    expect(urlOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(urlOrigin("  https://app.example.com  ")).toBe(
      "https://app.example.com",
    );
  });

  it("drops path, query and trailing slash", () => {
    // The reason this function exists: AUTH_URL's PATH becomes Auth.js's
    // basePath, so handing APP_URL over whole would move every auth route.
    expect(urlOrigin("https://example.com/")).toBe("https://example.com");
    expect(urlOrigin("https://example.com/app")).toBe("https://example.com");
    expect(urlOrigin("https://example.com/app?x=1")).toBe("https://example.com");
  });

  it("answers null for anything that is not a URL with an origin", () => {
    for (const v of ["", "   ", "fangfertig.de", "mailto:a@b.de", undefined, null]) {
      expect(urlOrigin(v as string | undefined)).toBeNull();
    }
  });
});

describe("configuredAuthUrl", () => {
  it("reads AUTH_URL, and NEXTAUTH_URL as Auth.js still does", () => {
    expect(configuredAuthUrl({ AUTH_URL: "https://a.de" })).toBe("https://a.de");
    expect(configuredAuthUrl({ NEXTAUTH_URL: "https://b.de" })).toBe(
      "https://b.de",
    );
    // AUTH_URL wins — the same precedence as next-auth/lib/env.js.
    expect(
      configuredAuthUrl({ AUTH_URL: "https://a.de", NEXTAUTH_URL: "https://b.de" }),
    ).toBe("https://a.de");
  });

  it("treats empty and blank as unset", () => {
    expect(configuredAuthUrl({})).toBeNull();
    expect(configuredAuthUrl({ AUTH_URL: "  " })).toBeNull();
  });
});

describe("applyAuthUrl", () => {
  it("sets AUTH_URL to APP_URL's origin", () => {
    const env: Record<string, string | undefined> = {
      APP_URL: "https://fangfertig.de",
    };
    expect(applyAuthUrl(env)).toBe("https://fangfertig.de");
    expect(env.AUTH_URL).toBe("https://fangfertig.de");
  });

  it("uses the ORIGIN, so a path in APP_URL cannot move the auth routes", () => {
    const env: Record<string, string | undefined> = {
      APP_URL: "https://example.com/app/",
    };
    applyAuthUrl(env);
    expect(env.AUTH_URL).toBe("https://example.com");
  });

  it("leaves an operator's own value alone", () => {
    // A deployment that worked around the defect by hand must keep working.
    const env: Record<string, string | undefined> = {
      APP_URL: "https://fangfertig.de",
      AUTH_URL: "https://www.fangfertig.de",
    };
    expect(applyAuthUrl(env)).toBe("https://www.fangfertig.de");
    expect(env.AUTH_URL).toBe("https://www.fangfertig.de");
  });

  it("writes nothing when there is nothing to derive from", () => {
    const env: Record<string, string | undefined> = {};
    expect(applyAuthUrl(env)).toBeNull();
    expect("AUTH_URL" in env).toBe(false);
  });

  it("is idempotent", () => {
    const env: Record<string, string | undefined> = { APP_URL: "https://a.de" };
    applyAuthUrl(env);
    applyAuthUrl(env);
    expect(env.AUTH_URL).toBe("https://a.de");
  });
});

describe("authUrlProblem", () => {
  it("is satisfied by an APP_URL alone", () => {
    expect(authUrlProblem({ APP_URL: "https://fangfertig.de" })).toBeNull();
    expect(authUrlProblem({ APP_URL: "http://localhost:3000" })).toBeNull();
  });

  it("refuses a missing APP_URL — there is nothing to mail out then", () => {
    expect(authUrlProblem({})?.code).toBe("missingAppUrl");
    expect(authUrlProblem({ APP_URL: "  " })?.code).toBe("missingAppUrl");
  });

  it("refuses an APP_URL that is not a URL", () => {
    expect(authUrlProblem({ APP_URL: "fangfertig.de" })?.code).toBe("badAppUrl");
  });

  it("cannot be tripped by the derivation itself", () => {
    // The two run in an order nobody controls (auth.config.ts at import,
    // env-guard at boot). Comparing ORIGINS is what makes that irrelevant.
    const env: Record<string, string | undefined> = {
      APP_URL: "https://fangfertig.de/",
    };
    applyAuthUrl(env);
    expect(authUrlProblem(env)).toBeNull();
  });

  it("accepts an AUTH_URL that only carries the base path", () => {
    expect(
      authUrlProblem({
        APP_URL: "https://fangfertig.de",
        AUTH_URL: "https://fangfertig.de/api/auth",
      }),
    ).toBeNull();
  });

  it("refuses two addresses that disagree", () => {
    const problem = authUrlProblem({
      APP_URL: "https://fangfertig.de",
      AUTH_URL: "https://localhost:8080",
    });
    expect(problem).toMatchObject({
      code: "mismatch",
      authOrigin: "https://localhost:8080",
      appOrigin: "https://fangfertig.de",
    });
  });

  it("sees a disagreeing NEXTAUTH_URL too", () => {
    expect(
      authUrlProblem({
        APP_URL: "https://fangfertig.de",
        NEXTAUTH_URL: "https://old-domain.de",
      })?.code,
    ).toBe("mismatch");
  });

  it("refuses an AUTH_URL that is not a URL", () => {
    expect(
      authUrlProblem({ APP_URL: "https://a.de", AUTH_URL: "a.de" })?.code,
    ).toBe("badAuthUrl");
  });
});

describe("strandedRedirect", () => {
  const live = "https://fangfertig.de/dashboard";

  it("🚨 finds the origin one level down, in the query", () => {
    // The measured line, verbatim: a relative Location that `smoke` printed
    // and ticked, carrying an address only the container can reach.
    const found = strandedRedirect(
      live,
      "/login?callbackUrl=https%3A%2F%2Flocalhost%3A8080%2Fdashboard",
    );
    expect(found?.origin).toBe("https://localhost:8080");
  });

  it("finds an absolute Location too", () => {
    expect(
      strandedRedirect(live, "http://127.0.0.1:3000/login")?.origin,
    ).toBe("http://127.0.0.1:3000");
  });

  it("says nothing about an ordinary redirect on the app's own origin", () => {
    expect(strandedRedirect(live, "/login?callbackUrl=%2Fdashboard")).toBeNull();
    expect(strandedRedirect(live, "/plans")).toBeNull();
    expect(
      strandedRedirect(live, "https://fangfertig.de/login?callbackUrl=https%3A%2F%2Ffangfertig.de%2Fdashboard"),
    ).toBeNull();
  });

  it("says nothing when the app itself is being called locally", () => {
    // The whole of DEV, and every deploy rung that runs on 127.0.0.1.
    expect(
      strandedRedirect(
        "http://localhost:3000/dashboard",
        "/login?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fdashboard",
      ),
    ).toBeNull();
  });

  it("leaves other foreign origins alone — an off-site redirect is not a defect", () => {
    // Deliberate: "stay on this origin" would turn a customer's OAuth start or
    // payment redirect into a failing gate.
    expect(strandedRedirect(live, "https://www.digistore24.com/product/1")).toBeNull();
  });

  it("says nothing about a missing or unparseable Location", () => {
    expect(strandedRedirect(live, "")).toBeNull();
    expect(strandedRedirect(live, undefined)).toBeNull();
    expect(strandedRedirect("not a url", "/login")).toBeNull();
  });
});
