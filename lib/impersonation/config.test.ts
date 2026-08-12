// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import {
  DEFAULT_IMPERSONATION_CONFIG,
  impersonationConfigProblems,
  isImpersonationEnabled,
} from "./config";

describe("the impersonation switch", () => {
  // The direction it fails in is the whole point. `config/ai-chat.json` fails
  // closed because the failure mode is a bill; this one fails closed because
  // the failure mode is somebody getting into a customer's account.
  it("defaults to OFF when the file cannot be read", () => {
    expect(DEFAULT_IMPERSONATION_CONFIG.enabled).toBe(false);
  });

  it("the shipped config is coherent", () => {
    // The same job `chatConfigProblems()` does: a second source of truth is
    // only safe while something checks it. A shipped config that this module
    // refuses would silently switch the feature off for every new app built on
    // the template.
    expect(impersonationConfigProblems()).toEqual([]);
  });

  it("ships ON, so the feature exists in a fresh app", () => {
    // Deliberately the opposite of `config/api.json`. An enabled API is
    // attack surface nobody decided on; this exposes nothing until an
    // Operator clicks it — and the alternative to having it is the email-swap
    // workaround, which is worse in every way.
    expect(isImpersonationEnabled()).toBe(true);
  });
});
