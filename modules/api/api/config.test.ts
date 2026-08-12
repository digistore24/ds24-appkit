// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { DEFAULT_API_CONFIG, apiConfigProblems } from "./config";

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
});
