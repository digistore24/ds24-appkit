// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_API_CONFIG, apiConfigProblems } from "./config";

/**
 * The reader, loaded fresh against a file of our own.
 *
 * Same shape as `lib/notify/config.test.ts` and for the same reason: the cases
 * below need files this repo does not ship, and asserting what the module does
 * with a FILE is the thing that breaks. It also keeps this suite honest inside
 * a customer's app — it never reads their `config/api.json`, so a customer who
 * legitimately switches something on does not turn these tests red.
 */
async function readerFor(file: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("@/config/api.json", () => ({ default: file }));
  return import("./config");
}

afterEach(() => {
  vi.doUnmock("@/config/api.json");
  vi.resetModules();
});

// ⚠️ This file ships INSIDE the customer's app and runs on every
// `node run.mjs test` — so it may only assert what stays true after the
// customer legitimately configures the feature. "The API is off" is NOT such
// a claim: switching it on is exactly what the `mobile-companion` skill does.
// The shipped-off state is a FACTORY invariant, and it is proven where the
// factory gates run — the deploy test asserts a real boot answers 404 on
// /api/v1. (Measured: a field-test session had to rewrite this file after
// enabling the API; that edit is the bug this comment prevents.)
describe("config/api.json", () => {
  it("is coherent — with the customer's own values as much as the shipped ones", () => {
    // An unknown or token-package `requiresPlan` is caught here, at build
    // time, whatever the customer set — never by hasPlan() throwing against
    // their first request.
    expect(apiConfigProblems()).toEqual([]);
  });

  it("falls back to OFF when the file is unreadable", () => {
    // The default is the safety net behind every parse problem: the failure
    // mode of this switch is an open endpoint, so the fallback must be
    // closed. This asserts the CONSTANT, not the file — the file is the
    // customer's to flip.
    expect(DEFAULT_API_CONFIG.enabled).toBe(false);
  });

  // Self-service is the second, milder switch: an app may offer the API to one
  // companion without putting a credential-minting card in front of every
  // customer. Same assertion style as `enabled` — the CONSTANT, never the
  // customer's file.
  it("hands out no card unless somebody asked for one", () => {
    expect(DEFAULT_API_CONFIG.selfService).toBe(false);
  });
});

describe('"selfService"', () => {
  it("is absent from most files and takes its default there", async () => {
    const { apiConfig, apiConfigProblems } = await readerFor({
      enabled: true,
      requiresPlan: null,
    });
    expect(apiConfig().selfService).toBe(false);
    expect(apiConfigProblems()).toEqual([]);
  });

  it("is true only when the file says true, never when it says something like it", async () => {
    for (const value of ["true", 1, "yes", {}]) {
      const { apiConfig } = await readerFor({ enabled: true, selfService: value });
      expect(apiConfig().selfService).toBe(false);
    }
  });

  it("takes the whole API down when it is present and not a boolean", async () => {
    // The same direction every doubt falls in this file: a config nobody can
    // read must not leave an endpoint open. So a typo in the milder switch is
    // not quietly ignored — it is a problem, and a problem is `off`.
    const { apiConfigProblems, isApiEnabled, apiOffReason } = await readerFor({
      enabled: true,
      requiresPlan: null,
      selfService: "ja",
    });
    expect(apiConfigProblems()).toEqual(['"selfService" must be true or false']);
    expect(isApiEnabled()).toBe(false);
    expect(apiOffReason()).toBe("brokenConfig");
  });
});
