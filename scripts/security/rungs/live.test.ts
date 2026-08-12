// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The `live` rung's decisions, planted and read back.
//
// 🚨 **Pure. No network, no spawn, no app.** `vitest.config.ts` includes every
// `**/*.test.ts` under `template/`, so a test here is already inside
// `npm run test` and therefore inside `make check` — and the rung itself must
// never be. A test that reached a deployed app would drag the network into the
// gate through the back door, which is exactly what NFR-64 refuses. So the
// rung's decisions are written as exported pure functions taking already-fetched
// values (a `Headers`, an array of `Set-Cookie` lines, a status and a
// `location`), and those are what this file exercises.
//
// ── Needle probes, not shape assertions ────────────────────────────────────
//
// Three findings are PLANTED and followed all the way to the verdict, because a
// test that only checks a function returns an object with a `severity` field
// passes just as happily when the severity is wrong. The three are the ones
// whose failure would be silent:
//
//   · a 200 on /dashboard/admin/users really produces a 🚨 CRITICAL, and that
//     finding really turns `failsVerdict()` red through the real aggregator.
//   · a Set-Cookie without Secure really produces a ❌ HIGH.
//   · a response with NO Set-Cookie at all really produces the sentence saying
//     nobody looked, and produces no clean cookie result of any kind.
//
// ⚠️ Nothing here asserts a COUNT of routes, headers or cookies — see
// `scripts/security/accepted.mjs` for why this project does not do that.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blankComments } from "../../lib/source-text.mjs";
import { aggregate, outcomeFrom } from "../rules.mjs";
import {
  HTTPONLY_EXEMPT,
  cookieFindings,
  cspWeaknesses,
  headerEvidence,
  headerFindings,
  isLocalAddress,
  isPlainHttp,
  live,
  publicPageFinding,
  resolveTarget,
  routeFinding,
  whereOf,
} from "./live.mjs";

const headers = (entries: Record<string, string>) => new Headers(entries);

const FULL = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const severities = (findings: { severity: string }[]) => findings.map((f) => f.severity);

// ── AC1 — it sends nothing, and it never follows a redirect ─────────────────

describe("the requests this rung makes", () => {
  const source = blankComments(readFileSync(new URL("./live.mjs", import.meta.url), "utf8"));
  /** The `fetch(…)` call itself — from the name to the `});` that closes it. */
  const callBlocks = [...source.matchAll(/fetch\(/g)].map((match) => {
    const from = match.index ?? 0;
    const rest = source.slice(from);
    const end = rest.indexOf("});");
    return end === -1 ? rest.slice(0, 400) : rest.slice(0, end + 3);
  });

  it("makes requests at all", () => {
    expect(callBlocks.length).toBeGreaterThan(0);
  });

  it("🚨 never follows a redirect, and bounds every request", () => {
    // `redirect: "follow"` turns a 307-to-/login into a 200 from the login page,
    // and this rung would then report every correctly protected route as
    // reachable by anybody. It is the single most likely way to build this rung
    // wrong, so it is asserted on the source rather than reasoned about.
    for (const block of callBlocks) {
      expect(block, "a fetch without redirect: manual").toContain('redirect: "manual"');
      expect(block, "a fetch without a timeout").toContain("AbortSignal.timeout");
    }
  });

  it("🚨 sends no cookie, no authorization and no credential", () => {
    for (const block of callBlocks) {
      // The request's own option object — what comes back OFF the response
      // (`setCookie`) is what this rung exists to read and is not in here.
      expect(block.toLowerCase()).not.toContain("headers:");
      expect(block.toLowerCase()).not.toContain("cookie:");
      expect(block.toLowerCase()).not.toContain("authorization");
      expect(block.toLowerCase()).not.toContain("bearer");
    }
    expect(source).not.toContain("DIAGNOSTICS_SECRET");
    expect(source).not.toContain("CRON_SECRET");
    // The credential resolver next door resolves a URL *and* a secret. Importing
    // it into a rung whose whole claim is "sends nothing" is the shape that
    // grows a credential three stories later.
    expect(source).not.toContain("diagnosticsCredentials");
  });

  it("declares itself as a tier-1 rung with a covers sentence that is not its own name", () => {
    expect(live.id).toBe("live");
    expect(live.tier).toBe(1);
    expect(live.covers).toContain("cookie flags");
    expect(live.covers).not.toMatch(/\blive rung\b/i);
  });
});

// ── AC2 — which address, and the refusal to guess one ──────────────────────

describe("isLocalAddress", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
    "http://[::1]:3000",
  ])("refuses %s", (url) => {
    expect(isLocalAddress(url)).toBe(true);
  });

  it("does NOT refuse a private LAN address", () => {
    // It may genuinely be somebody's deployed app behind a VPN, and refusing it
    // would be refusing an app that really runs.
    expect(isLocalAddress("https://192.168.1.40")).toBe(false);
    expect(isLocalAddress("https://10.0.0.5:8080")).toBe(false);
    expect(isLocalAddress("https://app.example.com")).toBe(false);
  });

  it("does not throw on something that is not a URL", () => {
    expect(isLocalAddress("not a url")).toBe(false);
    expect(isPlainHttp("not a url")).toBe(false);
    expect(isPlainHttp("http://app.example.com")).toBe(true);
    expect(isPlainHttp("https://app.example.com")).toBe(false);
  });
});

describe("resolveTarget", () => {
  /** The refusal half of the union — `undefined` when it resolved an address. */
  const reasonOf = (answer: ReturnType<typeof resolveTarget>) =>
    "reason" in answer ? answer.reason : undefined;

  const env = {
    APP_URL_PROD: "https://prod.example.com",
    APP_URL_STAGING: "https://staging.example.com",
    APP_URL: "https://dev.example.com",
  };

  it("prefers --url over everything configured", () => {
    expect(resolveTarget(env, ["--url", "https://given.example.com/"])).toEqual({
      url: "https://given.example.com",
      from: "--url",
    });
  });

  it("then PROD, then STAGING, then APP_URL", () => {
    expect(resolveTarget(env, [])).toMatchObject({ url: "https://prod.example.com" });
    expect(resolveTarget({ ...env, APP_URL_PROD: "" }, [])).toMatchObject({
      url: "https://staging.example.com",
    });
    expect(resolveTarget({ APP_URL: "https://dev.example.com" }, [])).toMatchObject({
      url: "https://dev.example.com",
      from: "APP_URL",
    });
  });

  it("returns the skip reason rather than a guess when nothing is set", () => {
    const answer = resolveTarget({}, []);
    expect(answer).not.toHaveProperty("url");
    expect(reasonOf(answer)).toContain("no deployed address to check");
    expect(reasonOf(answer)).toContain("APP_URL_PROD");
    expect(reasonOf(answer)).toContain("APP_URL_STAGING");
  });

  it("🚨 says the AC3 sentence when the only address is local", () => {
    expect(reasonOf(resolveTarget({ APP_URL: "http://localhost:3000" }, []))).toBe(
      "no deployed address to check — APP_URL is local and no --url was given",
    );
  });

  it("refuses an unusable --url with its own reason", () => {
    expect(reasonOf(resolveTarget(env, ["--url", "not-a-url"]))).toBe(
      "not a usable URL: not-a-url",
    );
    expect(reasonOf(resolveTarget(env, ["--url"]))).toContain("nothing after --url");
  });

  it("refuses a local --url, and says why a local run would lie", () => {
    const answer = resolveTarget(env, ["--url", "http://localhost:3000"]);
    expect(answer).not.toHaveProperty("url");
    expect(reasonOf(answer)).toContain("local");
    expect(reasonOf(answer)).toContain("Secure");
  });

  it("🚨 never falls through from a configured value it cannot read", () => {
    // A typo in APP_URL_PROD that quietly reported the STAGING host as
    // production would be a check lying about which app it looked at.
    const answer = resolveTarget({ ...env, APP_URL_PROD: "htps:/typo" }, []);
    expect(answer).not.toHaveProperty("url");
    expect(reasonOf(answer)).toContain("APP_URL_PROD");
  });
});

// ── AC4 / AC5 — the headers, and the CSP that is reported and not rated ─────

describe("headerFindings", () => {
  it("rates nothing when all four defences arrive over https", () => {
    expect(headerFindings(headers(FULL), "https://app.example.com")).toEqual([]);
  });

  it("rates each missing header MEDIUM, and never higher", () => {
    expect(severities(headerFindings(headers({ ...FULL, "strict-transport-security": "" }), "https://a.example.com"))).toEqual(["medium"]);
    expect(severities(headerFindings(headers({ ...FULL, "x-content-type-options": "" }), "https://a.example.com"))).toEqual(["medium"]);
    expect(severities(headerFindings(headers({ ...FULL, "x-frame-options": "" }), "https://a.example.com"))).toEqual(["medium"]);
  });

  it("accepts a CSP frame-ancestors in place of X-Frame-Options", () => {
    const withCsp = headerFindings(
      headers({
        ...FULL,
        "x-frame-options": "",
        "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      }),
      "https://app.example.com",
    );
    expect(withCsp).toEqual([]);
  });

  it("❌ rates plain http HIGH", () => {
    const findings = headerFindings(headers(FULL), "http://app.example.com");
    expect(severities(findings)).toContain("high");
    expect(findings.every((f) => f.source === "live")).toBe(true);
  });

  it("🚨 does NOT rate a missing CSP — it is a documented decision", () => {
    // Rating it would turn every app's first live check red for ever, and the
    // fix its reader would reach for is the pasted `unsafe-inline` policy this
    // template refuses (next.config.ts). Reporting is the evidence line's job.
    const findings = headerFindings(headers(FULL), "https://app.example.com");
    expect(findings).toEqual([]);
    expect(headerEvidence(headers(FULL))).toContain("Content-Security-Policy: (absent)");
  });

  it("reports what IS set, whether or not it is a finding", () => {
    const evidence = headerEvidence(headers(FULL));
    expect(evidence).toContain("Strict-Transport-Security: max-age=31536000");
    expect(evidence).toContain("X-Content-Type-Options: nosniff");
    expect(evidence).toContain("X-Frame-Options: DENY");
  });
});

describe("cspWeaknesses", () => {
  it("says nothing about an absent policy", () => {
    expect(cspWeaknesses("")).toEqual([]);
    expect(cspWeaknesses(undefined as unknown as string)).toEqual([]);
  });

  it("says nothing about a strict one", () => {
    expect(cspWeaknesses("default-src 'self'; script-src 'self'; frame-ancestors 'none'")).toEqual([]);
  });

  it("ℹ️ names a policy that is weaker than none", () => {
    expect(cspWeaknesses("script-src 'self' 'unsafe-inline'")).toContain(
      "script-src allows 'unsafe-inline'",
    );
    expect(cspWeaknesses("script-src 'unsafe-eval'")).toContain("script-src allows 'unsafe-eval'");
    expect(cspWeaknesses("default-src *")).toContain("default-src is *");
  });

  it("falls back to default-src where there is no script-src, as a browser does", () => {
    expect(cspWeaknesses("default-src 'self' 'unsafe-inline'")).toContain(
      "script-src allows 'unsafe-inline'",
    );
  });

  it("rates a weak policy LOW and no higher", () => {
    const findings = headerFindings(
      headers({ ...FULL, "content-security-policy": "script-src 'unsafe-inline'" }),
      "https://app.example.com",
    );
    expect(severities(findings)).toEqual(["low"]);
    expect(findings[0].fix).toContain("Never");
  });
});

// ── AC6 — cookie flags, and the silence that must not read as a pass ────────

describe("cookieFindings", () => {
  it("🚨 NEEDLE: no Set-Cookie at all says nobody looked, and prints no clean result", () => {
    const answer = cookieFindings([], "the home page");
    expect(answer.note).toBe("the home page set no cookies, so no cookie flag was inspected");
    // Nothing that could be read as "the cookies were fine".
    expect(answer.findings).toEqual([]);
    expect(answer.accepted).toEqual([]);
    expect(answer.note).not.toMatch(/cookie\(s\):/);
    expect(answer.note).not.toMatch(/\bclean\b|\bok\b|✓/i);
  });

  it("🚨 NEEDLE: a cookie without Secure is HIGH", () => {
    const answer = cookieFindings(
      ["session=abc; Path=/; HttpOnly; SameSite=Lax"],
      "the home page",
    );
    const secure = answer.findings.filter((f) => /without Secure/.test(f.title));
    expect(severities(secure)).toEqual(["high"]);
    expect(secure[0].where).toBe("Set-Cookie on the home page: session");
    expect(secure[0].source).toBe("live");
    expect(secure[0]).not.toHaveProperty("id");
  });

  it("rates a missing SameSite and a missing HttpOnly MEDIUM", () => {
    const answer = cookieFindings(["session=abc; Path=/; Secure"], "/login");
    expect(severities(answer.findings).sort()).toEqual(["medium", "medium"]);
    expect(answer.findings.map((f) => f.title).join(" ")).toMatch(/SameSite/);
    expect(answer.findings.map((f) => f.title).join(" ")).toMatch(/HttpOnly/);
  });

  it("says nothing about a fully declared cookie, and names it in the note", () => {
    const answer = cookieFindings(
      ["__Secure-authjs.session-token=x; Path=/; Secure; HttpOnly; SameSite=Lax"],
      "/login",
    );
    expect(answer.findings).toEqual([]);
    expect(answer.note).toContain("__Secure-authjs.session-token");
  });

  it("⚠️ does not report a __Secure- / __Host- prefix a second time", () => {
    // The prefix is a guarantee the BROWSER enforces. A missing Secure attribute
    // is already the one finding; a second one about the name would be the same
    // defect counted twice.
    const answer = cookieFindings(
      ["__Host-thing=x; Path=/; HttpOnly; SameSite=Lax"],
      "the home page",
    );
    expect(answer.findings.map((f) => f.title)).toEqual([
      "The cookie __Host-thing is set without Secure",
    ]);
  });

  it("accepts the named HttpOnly exemption with its reason, and never counts it", () => {
    const answer = cookieFindings(["NEXT_LOCALE=de; Path=/; Secure; SameSite=Lax"], "/login");
    expect(answer.findings).toEqual([]);
    expect(answer.accepted.map((f) => f.title)).toEqual([
      "The cookie NEXT_LOCALE is readable from script (no HttpOnly)",
    ]);
    expect(answer.accepted[0].why).toBe(HTTPONLY_EXEMPT.NEXT_LOCALE.reason);
  });

  it("the exempt set carries a written reason per entry, never a count", () => {
    for (const [name, entry] of Object.entries(HTTPONLY_EXEMPT)) {
      expect(entry.reason.length, name).toBeGreaterThan(40);
    }
  });
});

// ── AC7 — every protected route, probed once with no session ───────────────

describe("routeFinding", () => {
  it("🚨 NEEDLE: a 200 on /dashboard/admin/users is CRITICAL", () => {
    const finding = routeFinding("/dashboard/admin/users", 200, "");
    expect(finding?.severity).toBe("critical");
    expect(finding?.where).toBe("/dashboard/admin/users");
    expect(finding?.source).toBe("live");
    expect(finding).not.toHaveProperty("id");
    // The Fix: names the three places CLAUDE.md requires, plus the structural half.
    expect(finding?.fix).toContain("proxy.ts");
    expect(finding?.fix).toContain("authorized()");
    expect(finding?.fix).toContain("route-protection.test.ts");
    // The Why: says in plain words what somebody GETS out of it.
    expect(finding?.why).toMatch(/no account|no sign-in/);
  });

  it("🚨 NEEDLE: that CRITICAL really turns the verdict red", () => {
    // Through the real aggregator, not a re-implementation of its arithmetic.
    const outcome = outcomeFrom(live, {
      state: "found",
      findings: [routeFinding("/dashboard/admin/users", 200, "")!],
    });
    const summary = aggregate([outcome]);
    expect(summary.counts.critical).toBeGreaterThan(0);
    expect(summary.failing).toBe(true);
  });

  it("treats a 3xx to /login as correct, in smoke's own vocabulary", () => {
    expect(routeFinding("/dashboard", 307, "/login")).toBeNull();
    expect(routeFinding("/dashboard", 302, "/login?callbackUrl=%2Fdashboard")).toBeNull();
    expect(routeFinding("/dashboard", 307, "https://app.example.com/login")).toBeNull();
  });

  it("⚠️ rates a 3xx to anywhere else MEDIUM", () => {
    const finding = routeFinding("/dashboard/billing", 307, "/plans");
    expect(finding?.severity).toBe("medium");
    expect(finding?.evidence).toContain("/plans");
  });

  it("records a 404 and rates it nothing — an uninstalled module answers one", () => {
    expect(routeFinding("/dashboard/community", 404, "")).toBeNull();
    expect(routeFinding("/dashboard/community", 403, "")).toBeNull();
  });

  it("❌ rates a 5xx HIGH", () => {
    expect(routeFinding("/dashboard", 503, "")?.severity).toBe("high");
  });
});

describe("publicPageFinding", () => {
  it("says nothing about the answers a public page is supposed to give", () => {
    expect(publicPageFinding("/", 200)).toBeNull();
    expect(publicPageFinding("/login", 307)).toBeNull();
    // …which is the whole point of the pair: the same 200 that is correct here
    // is the CRITICAL above.
    expect(routeFinding("/dashboard", 200, "")?.severity).toBe("critical");
  });

  it("❌ rates a 5xx on a public page HIGH", () => {
    const finding = publicPageFinding("/", 503);
    expect(finding?.severity).toBe("high");
    expect(finding?.evidence).toContain("503");
  });
});

describe("whereOf", () => {
  it("names a few and counts the rest", () => {
    expect(whereOf(["/a", "/b"])).toBe("/a, /b");
    expect(whereOf(["/a", "/b", "/c", "/d", "/e", "/f"])).toBe("/a, /b, /c, /d and 2 more");
  });
});
