// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  isTestpayAllowed,
  isTestpayFresh,
  decorateCheckoutUrl,
  withTestpayParam,
  resetTestpayForTests,
  type TestpayEnv,
  type TestpayState,
} from "./testpay";

// The testpay parameter is an unlock for free "purchases". These tests are the
// guard in front of it: each individual condition must be able to switch it
// off on its own, and no failure may ever break a checkout link.

const allowed: TestpayEnv = {
  NODE_ENV: "development",
  APP_ENV: "development",
  APP_URL: "http://localhost:3000",
};

describe("isTestpayAllowed", () => {
  it("allows it only in local development", () => {
    expect(isTestpayAllowed(allowed)).toBe(true);
  });

  it("refuses under NODE_ENV=production", () => {
    expect(isTestpayAllowed({ ...allowed, NODE_ENV: "production" })).toBe(false);
  });

  it("refuses under APP_ENV=production and APP_ENV=staging", () => {
    expect(isTestpayAllowed({ ...allowed, APP_ENV: "production" })).toBe(false);
    // Staging keeps the manual test-purchase cookie on purpose: a staging URL
    // is public, and a decorated link there is one copy-paste from a customer.
    expect(isTestpayAllowed({ ...allowed, APP_ENV: "staging" })).toBe(false);
  });

  it("refuses an unknown or typo'd APP_ENV (allowlist)", () => {
    // appEnv() classifies anything unknown as "production" — a typo must never
    // hand customers free purchases.
    for (const value of ["prod", "developmnt", "live", "x", "Production"]) {
      expect(isTestpayAllowed({ ...allowed, APP_ENV: value })).toBe(false);
    }
  });

  it("refuses a non-local APP_URL", () => {
    for (const url of [
      "https://my-app.example",
      "http://192.168.1.10:3000",
      "https://staging.my-app.example",
    ]) {
      expect(isTestpayAllowed({ ...allowed, APP_URL: url })).toBe(false);
    }
  });

  it("can be switched off hard with DS24_TESTPAY=off", () => {
    expect(isTestpayAllowed({ ...allowed, DS24_TESTPAY: "off" })).toBe(false);
  });

  it("stays refused when several conditions are violated at once", () => {
    expect(
      isTestpayAllowed({
        ...allowed,
        NODE_ENV: "production",
        APP_URL: "https://my-app.example",
      }),
    ).toBe(false);
  });
});

function state(overrides: Partial<TestpayState> = {}): TestpayState {
  return {
    userId: "12345",
    testpayKey: "abcdef123456",
    paramName: "testpay_4711",
    expiresAt: "2026-08-28 12:00:00",
    fetchedAt: "2026-07-28T09:00:00.000Z",
    ...overrides,
  };
}

describe("isTestpayFresh", () => {
  it("is fresh comfortably inside expires_at", () => {
    expect(isTestpayFresh(state(), new Date("2026-08-01T00:00:00Z"))).toBe(true);
  });

  it("goes stale 6h BEFORE expires_at (margin for the zone-less timestamp)", () => {
    // expires_at is DS24 server time with no zone marker; the margin has to
    // swallow the unknown offset plus clock skew.
    expect(isTestpayFresh(state(), new Date("2026-08-28T07:00:00Z"))).toBe(false);
    expect(isTestpayFresh(state(), new Date("2026-08-28T05:59:00Z"))).toBe(true);
  });

  it("treats an unparseable or missing expires_at as stale", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    expect(isTestpayFresh(state({ expiresAt: "soon" }), now)).toBe(false);
    expect(isTestpayFresh(state({ expiresAt: "" }), now)).toBe(false);
  });

  it("treats missing key or param name as stale", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    expect(isTestpayFresh(state({ testpayKey: "" }), now)).toBe(false);
    expect(isTestpayFresh(state({ paramName: "" }), now)).toBe(false);
    expect(isTestpayFresh(null, now)).toBe(false);
  });
});

describe("decorateCheckoutUrl", () => {
  it("appends the parameter and keeps existing query parameters", () => {
    const url = "https://www.digistore24.com/product/12345?aff=partner&cam=x";
    const out = decorateCheckoutUrl(url, "testpay_4711", "abc");
    const u = new URL(out);
    expect(u.searchParams.get("testpay_4711")).toBe("abc");
    expect(u.searchParams.get("aff")).toBe("partner");
    expect(u.searchParams.get("cam")).toBe("x");
  });

  it("takes the parameter NAME from the state — nothing is hardcoded", () => {
    const out = decorateCheckoutUrl(
      "https://www.digistore24.com/product/1",
      "some_other_name",
      "k",
    );
    expect(out).toContain("some_other_name=k");
  });

  it("never puts the key onto a foreign host", () => {
    for (const url of [
      "https://example.com/product/1",
      "https://digistore24.com.evil.example/product/1",
      "https://notdigistore24.com/product/1",
    ]) {
      expect(decorateCheckoutUrl(url, "p", "k")).toBe(url);
    }
  });

  it("accepts digistore24.com and its subdomains", () => {
    expect(
      decorateCheckoutUrl("https://digistore24.com/product/1", "p", "k"),
    ).toContain("p=k");
    expect(
      decorateCheckoutUrl("https://checkout.digistore24.com/product/1", "p", "k"),
    ).toContain("p=k");
  });

  it("returns an unparseable URL untouched", () => {
    expect(decorateCheckoutUrl("not a url", "p", "k")).toBe("not a url");
  });
});

describe("withTestpayParam", () => {
  const savedEnv = { ...process.env };
  let dir: string;
  let stateFile: string;
  const URL_IN = "https://www.digistore24.com/product/12345";
  const NOW = new Date("2026-08-01T00:00:00Z");

  beforeEach(async () => {
    resetTestpayForTests();
    process.env.APP_ENV = "development";
    delete process.env.APP_URL;
    delete process.env.DS24_TESTPAY;
    dir = await mkdtemp(path.join(tmpdir(), "testpay-"));
    stateFile = path.join(dir, "testpay.json");
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    resetTestpayForTests();
  });

  it("returns the URL byte-identical outside DEV, without any fetch", async () => {
    process.env.APP_ENV = "production";
    let called = 0;
    const out = await withTestpayParam(URL_IN, {
      fetcher: async () => ((called += 1), state()),
      now: NOW,
      stateFile,
    });
    expect(out).toBe(URL_IN);
    expect(called).toBe(0);
  });

  it("fetches, stores and decorates in DEV", async () => {
    const out = await withTestpayParam(URL_IN, {
      fetcher: async () => state(),
      now: NOW,
      stateFile,
    });
    expect(new URL(out).searchParams.get("testpay_4711")).toBe("abcdef123456");
    // The CLI and the app share this file — the shape on disk is the contract.
    const onDisk = JSON.parse(await readFile(stateFile, "utf8"));
    expect(onDisk.paramName).toBe("testpay_4711");
    expect(onDisk.expiresAt).toBe("2026-08-28 12:00:00");
  });

  it("uses a fresh state file without fetching", async () => {
    await writeFile(stateFile, JSON.stringify(state()), "utf8");
    let called = 0;
    const out = await withTestpayParam(URL_IN, {
      fetcher: async () => ((called += 1), state()),
      now: NOW,
      stateFile,
    });
    expect(called).toBe(0);
    expect(out).toContain("testpay_4711=");
  });

  it("re-fetches when the stored key is stale", async () => {
    await writeFile(
      stateFile,
      JSON.stringify(state({ expiresAt: "2026-07-01 00:00:00" })),
      "utf8",
    );
    let called = 0;
    const out = await withTestpayParam(URL_IN, {
      fetcher: async () => ((called += 1), state()),
      now: NOW,
      stateFile,
    });
    expect(called).toBe(1);
    expect(out).toContain("testpay_4711=");
  });

  it("returns the URL unchanged on a failed fetch — and memoizes the failure", async () => {
    // The `console.warn` below is the behaviour under test, not an accident — this
    // test PROVOKES the failure. Silenced so an UNEXPECTED error stays visible in
    // the run's output instead of drowning in expected noise.
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    let called = 0;
    const failing = {
      fetcher: async (): Promise<TestpayState> => {
        called += 1;
        throw new Error("DS24 down");
      },
      now: NOW,
      stateFile,
    };
    expect(await withTestpayParam(URL_IN, failing)).toBe(URL_IN);
    // Second call inside the failure window: no new fetch. Without this memo a
    // broken API key costs one 10s timeout per plan card per render.
    expect(await withTestpayParam(URL_IN, failing)).toBe(URL_IN);
    expect(called).toBe(1);
  });

  it("makes ONE fetch for parallel callers (single-flight)", async () => {
    let called = 0;
    const opts = {
      fetcher: async () => {
        called += 1;
        await new Promise((r) => setTimeout(r, 10));
        return state();
      },
      now: NOW,
      stateFile,
    };
    const outs = await Promise.all([
      withTestpayParam(URL_IN, opts),
      withTestpayParam(URL_IN, opts),
      withTestpayParam(URL_IN, opts),
    ]);
    expect(called).toBe(1);
    for (const out of outs) expect(out).toContain("testpay_4711=");
  });

  it("survives an unwritable state file (in-memory degradation)", async () => {
    // A directory where the file should be makes the write fail.
    await mkdir(stateFile, { recursive: true });
    const out = await withTestpayParam(URL_IN, {
      fetcher: async () => state(),
      now: NOW,
      stateFile,
    });
    expect(out).toContain("testpay_4711=");
    // And the next call runs on memory, still without a throw.
    const again = await withTestpayParam(URL_IN, {
      fetcher: async () => state(),
      now: NOW,
      stateFile,
    });
    expect(again).toContain("testpay_4711=");
  });

  it("ignores a corrupt state file and fetches instead", async () => {
    await writeFile(stateFile, "{not json", "utf8");
    let called = 0;
    const out = await withTestpayParam(URL_IN, {
      fetcher: async () => ((called += 1), state()),
      now: NOW,
      stateFile,
    });
    expect(called).toBe(1);
    expect(out).toContain("testpay_4711=");
  });
});
