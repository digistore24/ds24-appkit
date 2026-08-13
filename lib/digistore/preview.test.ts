// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isPlansPreviewAllowed,
  wantsPlansPreview,
  plansRenderMode,
  PLANS_PREVIEW_PARAM,
  PLANS_PREVIEW_VALUE,
  type PlansPreviewEnv,
} from "./preview";

// The preview changes what a PUBLIC route renders. These tests are the guard in
// front of it, and they ask two separate questions: may it exist here at all
// (the allowlist), and — the one that keeps it from becoming a mock checkout —
// does it ever cause a Digistore24 call or an invented URL.

const allowed: PlansPreviewEnv = {
  NODE_ENV: "development",
  APP_ENV: "development",
  APP_URL: "http://localhost:3000",
};

describe("isPlansPreviewAllowed", () => {
  it("allows it only in local development", () => {
    expect(isPlansPreviewAllowed(allowed)).toBe(true);
  });

  it("refuses under NODE_ENV=production", () => {
    expect(isPlansPreviewAllowed({ ...allowed, NODE_ENV: "production" })).toBe(
      false,
    );
  });

  it("refuses under APP_ENV=production and APP_ENV=staging", () => {
    expect(isPlansPreviewAllowed({ ...allowed, APP_ENV: "production" })).toBe(
      false,
    );
    // Staging is a public address: a preview there would show buy forms to
    // real visitors that lead nowhere.
    expect(isPlansPreviewAllowed({ ...allowed, APP_ENV: "staging" })).toBe(false);
  });

  it("refuses an unknown or typo'd APP_ENV (allowlist, not blocklist)", () => {
    // appEnv() puts anything unknown on "production".
    expect(isPlansPreviewAllowed({ ...allowed, APP_ENV: "developmnet" })).toBe(
      false,
    );
    expect(isPlansPreviewAllowed({ ...allowed, APP_ENV: "prod" })).toBe(false);
  });

  it("refuses a non-local APP_URL", () => {
    expect(
      isPlansPreviewAllowed({ ...allowed, APP_URL: "https://app.example.com" }),
    ).toBe(false);
    // Unparseable counts as non-local — when in doubt, refuse.
    expect(isPlansPreviewAllowed({ ...allowed, APP_URL: "not a url" })).toBe(
      false,
    );
  });

  it("accepts the local aliases and an unset APP_URL", () => {
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      undefined,
    ]) {
      expect(isPlansPreviewAllowed({ ...allowed, APP_URL: url })).toBe(true);
    }
  });

  it("can be switched off hard on one machine", () => {
    expect(
      isPlansPreviewAllowed({ ...allowed, DS24_PLANS_PREVIEW: "off" }),
    ).toBe(false);
  });
});

describe("wantsPlansPreview", () => {
  it("accepts only the exact value", () => {
    expect(wantsPlansPreview(PLANS_PREVIEW_VALUE)).toBe(true);
    expect(wantsPlansPreview("Checkout")).toBe(false);
    expect(wantsPlansPreview("1")).toBe(false);
    expect(wantsPlansPreview("")).toBe(false);
    expect(wantsPlansPreview(undefined)).toBe(false);
  });

  it("refuses a repeated parameter (Next hands that over as an array)", () => {
    expect(wantsPlansPreview([PLANS_PREVIEW_VALUE])).toBe(false);
    expect(
      wantsPlansPreview([PLANS_PREVIEW_VALUE, PLANS_PREVIEW_VALUE]),
    ).toBe(false);
  });
});

describe("plansRenderMode", () => {
  // The property the whole fixture rests on. Stated once, exhaustively, over
  // all four combinations — a preview must never reach the branch that talks
  // to Digistore24, whether or not somebody is signed in.
  it("NEVER asks Digistore24 while previewing", () => {
    for (const signedIn of [true, false]) {
      const mode = plansRenderMode({ signedIn, previewing: true });
      expect(mode.askDigistore).toBe(false);
      expect(mode.askBlockers).toBe(false);
      expect(mode.asForm).toBe(true);
      expect(mode.ignoreBlockers).toBe(true);
    }
  });

  it("signed in, no preview: local blockers only, no call, and blockers still bite", () => {
    const mode = plansRenderMode({ signedIn: true, previewing: false });
    expect(mode).toEqual({
      askDigistore: false,
      askBlockers: true,
      asForm: true,
      ignoreBlockers: false,
    });
  });

  it("signed out, no preview: the shared cached link — the only branch that calls", () => {
    const mode = plansRenderMode({ signedIn: false, previewing: false });
    expect(mode).toEqual({
      askDigistore: true,
      askBlockers: false,
      asForm: false,
      ignoreBlockers: false,
    });
  });

  it("ignoreBlockers is true in the preview and nowhere else", () => {
    const cases = [
      { signedIn: true, previewing: false },
      { signedIn: false, previewing: false },
    ];
    for (const c of cases) {
      expect(plansRenderMode(c).ignoreBlockers).toBe(false);
    }
  });
});

// The page is a server component; nothing here can render it. What CAN be
// asserted is that it goes through this module instead of re-deriving the
// decision — the same shape as plan-sections.test.ts's binding of the page to
// planSections(). Without this, the pure function above could stay green while
// the page grew its own copy of the rule.
describe("app/plans/page.tsx is wired to this module", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/plans/page.tsx"),
    "utf8",
  );

  it("takes the render decision from plansRenderMode()", () => {
    expect(source).toContain("plansRenderMode(");
  });

  // NOT `source.toContain("isPlansPreviewActive()")`: measured, that stays
  // green with the gate deleted, because the SECOND call site (the offer line)
  // still holds the name. The assertion has to be about the one expression
  // that decides, so it reads that expression and nothing else — without the
  // gate, `?preview=checkout` would show buy forms on a deployed app.
  it("gates the preview on the environment, not on the parameter alone", () => {
    const decision = source.match(/const previewing =[\s\S]*?;/)?.[0] ?? "";
    expect(decision).not.toBe("");
    expect(decision).toContain("wantsPlansPreview(");
    expect(decision).toContain("isPlansPreviewActive()");
  });

  it("reads the parameter through the exported name", () => {
    expect(source).toContain("PLANS_PREVIEW_PARAM");
    expect(PLANS_PREVIEW_PARAM).toBe("preview");
  });

  // The money assertion, at the one place a unit test can reach it: the ONLY
  // branch that talks to Digistore24 must sit behind the mode, not beside it.
  // Without this, `plansRenderMode` could stay green while the page called
  // checkoutLinksFor unconditionally and the preview quietly went to the API.
  it("reaches checkoutLinksFor only through mode.askDigistore", () => {
    const call = source.indexOf("checkoutLinksFor(defs");
    expect(call).toBeGreaterThan(-1);
    expect(source.slice(0, call)).toContain("mode.askDigistore");
  });

  it("resolves a previewed card without a blocker and without a URL", () => {
    expect(source).toContain("mode.ignoreBlockers");
    const guard = source.indexOf("mode.ignoreBlockers) return");
    const links = source.indexOf("links?.get(def.key)");
    expect(guard).toBeGreaterThan(-1);
    // The preview must be answered BEFORE the branch that hands out a URL.
    expect(guard).toBeLessThan(links);
  });
});
