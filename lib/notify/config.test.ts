// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two claims, and they point in opposite directions on purpose.
//
//   1. the SHIPPED file is coherent and ON — a fresh app may write to its owner
//   2. any BROKEN file is off, whole, whatever it says
//
// The second half needs files this repo does not ship, so the JSON module is
// replaced per case (`vi.doMock` + `vi.resetModules()`, then a fresh import).
// Reading the reader's own logic through an exported pure function would have
// been the other way; this one asserts what the module actually does with a
// file, which is the thing that breaks.
import { afterEach, describe, expect, it, vi } from "vitest";

import raw from "@/config/notifications.json";

import {
  DEFAULT_NOTIFY_CONFIG,
  isOperatorNotifyEnabled,
  notifyConfig,
  notifyConfigProblems,
  notifyOffReason,
  operatorLocale,
} from "./config";

/** The reader, loaded fresh against a file of our own. */
async function readerFor(file: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("@/config/notifications.json", () => ({ default: file }));
  return import("./config");
}

afterEach(() => {
  vi.doUnmock("@/config/notifications.json");
  vi.resetModules();
});

describe("the shipped config", () => {
  // 🚨 The one switch in this template that ships ON, and the assertion is here
  // so that flipping it is a decision rather than a slip. The argument is in
  // lib/notify/config.ts's header: every sender through this channel is a job
  // that ships off by itself, and two off states in series make a channel
  // nobody finds.
  it("ships ON — unlike every other switch here, and deliberately", () => {
    expect(isOperatorNotifyEnabled()).toBe(true);
    expect(notifyConfig().enabled).toBe(true);
  });

  it("🚨 while the CODE default is off — an unreadable file means silence", () => {
    expect(DEFAULT_NOTIFY_CONFIG.enabled).toBe(false);
  });

  it("is coherent, and names a language this app has", () => {
    expect(notifyConfigProblems()).toEqual([]);
    expect(["de", "en"]).toContain(operatorLocale());
  });

  it("carries its explanation in underscore keys, which are ignored", () => {
    const keys = Object.keys(raw as Record<string, unknown>);
    expect(keys.some((k) => k.startsWith("_"))).toBe(true);
    expect(notifyConfigProblems()).toEqual([]);
  });

  it("says nothing is wrong while it is on", () => {
    expect(notifyOffReason()).toBeNull();
  });
});

describe("a file that cannot be trusted", () => {
  it("an unknown key names the key and switches the channel off", async () => {
    const mod = await readerFor({ enabled: true, locale: "de", notifyEveryone: true });
    expect(mod.notifyConfigProblems()).toHaveLength(1);
    expect(mod.notifyConfigProblems()[0]).toContain("notifyEveryone");
    expect(mod.isOperatorNotifyEnabled()).toBe(false);
  });

  it("a wrong type is a named problem, not a coercion", async () => {
    const mod = await readerFor({ enabled: "yes", locale: "de" });
    expect(mod.notifyConfigProblems()).toHaveLength(1);
    expect(mod.notifyConfigProblems()[0]).toContain("enabled");
    expect(mod.isOperatorNotifyEnabled()).toBe(false);
  });

  it("a language this app has no messages file for is a problem, not a fallback", async () => {
    // The failure it prevents is specific: `createTranslator` on a catalogue
    // that was never loaded renders every sentence as its own key, in a mail
    // nobody proof-reads.
    const mod = await readerFor({ enabled: true, locale: "fr" });
    expect(mod.notifyConfigProblems()).toHaveLength(1);
    expect(mod.notifyConfigProblems()[0]).toContain("locale");
    expect(mod.isOperatorNotifyEnabled()).toBe(false);
  });

  it("falls back as a WHOLE, never field by field", async () => {
    // `locale` here is perfectly good, and it is discarded with the rest.
    const mod = await readerFor({ enabled: true, locale: "en", typo: 1 });
    expect(mod.notifyConfig()).toEqual(mod.DEFAULT_NOTIFY_CONFIG);
    expect(mod.operatorLocale()).toBe("de");
  });

  it("reports the problem rather than 'enabled is false'", async () => {
    const mod = await readerFor({ enabled: true, locale: "fr" });
    expect(mod.notifyOffReason()).toContain("locale");
  });

  it("an explicit off says so plainly", async () => {
    const mod = await readerFor({ enabled: false, locale: "de" });
    expect(mod.notifyConfigProblems()).toEqual([]);
    expect(mod.notifyOffReason()).toContain("enabled");
  });
});
