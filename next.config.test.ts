// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What every response of this app carries, read as DATA from the real config
// rather than asserted about the source text.
//
// 🚨 The reason this file exists at all: three of these headers were simply
// ABSENT from the running app and nothing in this tree said so. Finding M-8 of
// the 2026-08-18 scan found `Permissions-Policy`, `Cross-Origin-Opener-Policy`
// and a `frame-ancestors` directive missing, and L-5 found `X-Powered-By:
// Next.js` being sent — all four by curling the app, because the header list
// is exactly the kind of thing that is right in the source and wrong on the
// wire, and the kind of thing a merge drops one entry from in silence.
//
// It imports the config the way Next does — through the next-intl plugin, the
// default export — so a plugin that stopped passing an option through would be
// caught here and not on a production response.

import { describe, expect, it } from "vitest";

import config from "@/next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function headerRules(): Promise<HeaderRule[]> {
  const rules = await config.headers!();
  return rules as HeaderRule[];
}

/** The blanket rule — the one that has to match every path. */
async function blanket(): Promise<Map<string, string>> {
  const rule = (await headerRules()).find((r) => r.source === "/:path*");
  expect(rule, "the blanket /:path* rule is gone — every header below it is now unsent").toBeTruthy();
  return new Map(rule!.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("the headers on every response", () => {
  it("sends the four that were already measured as arriving", async () => {
    const headers = await blanket();
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    // Presence is not effect: `max-age=0` is a header that is there and that
    // switches HSTS off, which is the shape `scripts/security/rungs/live.mjs`
    // learned to rate rather than count.
    const hsts = headers.get("strict-transport-security") ?? "";
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)).toBeGreaterThan(0);
  });

  it("🚨 denies the four device capabilities the app never asks for (M-8)", async () => {
    const value = (await blanket()).get("permissions-policy") ?? "";
    // Each one denied by an EMPTY allow-list. `camera=(self)` would be a
    // header that is present and grants exactly what it looks like it forbids.
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(value, `${feature} is not denied`).toContain(`${feature}=()`);
    }
    expect(value).not.toContain("*");
    expect(value).not.toContain("self");
  });

  it("🚨 cuts the window.opener link (M-8)", async () => {
    expect((await blanket()).get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("🚨 refuses to be framed by the CSP directive too, not only X-Frame-Options (M-8)", async () => {
    const csp = (await blanket()).get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    // `frame-ancestors *` is a header that is present and protects nothing —
    // live.mjs rates it as no protection, and so does this.
    expect(csp).not.toMatch(/frame-ancestors[^;]*\*/);
  });

  it("🚨 ships NO script or style policy in that CSP, deliberately", async () => {
    // The paragraph above `securityHeaders` in next.config.ts declines a real
    // page CSP because Next.js emits inline scripts and a nonce-less policy
    // would be a facade. This test is the guard on that decision: the day
    // somebody "completes" the header with `script-src 'unsafe-inline'` they
    // have built exactly that facade, and `cspWeaknesses()` in
    // scripts/security/rungs/live.mjs would then rate the app's own header as
    // weaker than none.
    const csp = (await blanket()).get("content-security-policy") ?? "";
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("default-src");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("🚨 leaves the /brand/* policy standing AFTER the blanket one (M-8)", async () => {
    // Next applies `headers()` entries additively, so `/brand/logo.svg` gets
    // both CSP headers and a browser ANDs them — the strict sandbox policy is
    // tightened by `frame-ancestors 'none'`, never replaced by it. What would
    // break that is ORDER or ABSENCE, so both are pinned here.
    const rules = await headerRules();
    const blanketAt = rules.findIndex((r) => r.source === "/:path*");
    const brandAt = rules.findIndex((r) => r.source === "/brand/:path*");
    expect(brandAt).toBeGreaterThan(blanketAt);

    const brand = new Map(rules[brandAt].headers.map((h) => [h.key.toLowerCase(), h.value]));
    const csp = brand.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
  });
});

describe("what the app does NOT say about itself", () => {
  it("🚨 sends no X-Powered-By (L-5)", () => {
    // Next's default is `true`. Absent-and-default is the state that was
    // measured on the running app, so the assertion is on the explicit false
    // rather than on "not true".
    expect(config.poweredByHeader).toBe(false);
  });
});
