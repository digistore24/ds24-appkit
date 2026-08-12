// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import raw from "@/config/setup.json";
import { isSetupEnabled, setupConfig, setupConfigProblems, setupOffReason } from "./config";

describe("the shipped config", () => {
  // The shipped state, asserted rather than assumed. A template that starts
  // with a write endpoint open on every deployed app would be the single worst
  // default in this repo.
  it("ships OFF", () => {
    expect(isSetupEnabled()).toBe(false);
    expect(setupConfig().enabled).toBe(false);
  });

  it("ships with no destructive tool allowed", () => {
    expect(setupConfig().allowDestructive).toEqual([]);
  });

  it("is coherent", () => {
    expect(setupConfigProblems()).toEqual([]);
  });

  it("says why it is off, for the command line", () => {
    expect(setupOffReason()).toContain("enabled");
  });

  // The comment convention the module manifests already use. A config file that
  // cannot explain itself is one whose reasoning lives somewhere else and rots.
  it("carries its explanation in underscore keys, which are ignored", () => {
    const keys = Object.keys(raw as Record<string, unknown>);
    expect(keys.some((k) => k.startsWith("_"))).toBe(true);
    expect(setupConfigProblems()).toEqual([]);
  });
});
