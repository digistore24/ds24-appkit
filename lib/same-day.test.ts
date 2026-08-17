// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The zone is the whole subject here, so every case names one — a test that
// only ever asked in UTC would pass against the `getDate()` implementation this
// function exists to refuse.
import { describe, it, expect } from "vitest";

import { isSameDay } from "./same-day";

describe("isSameDay", () => {
  it("is true for two instants inside one day", () => {
    expect(
      isSameDay(
        new Date("2026-08-16T08:00:00Z"),
        new Date("2026-08-16T21:59:00Z"),
        "Europe/Berlin",
      ),
    ).toBe(true);
  });

  it("is false across midnight", () => {
    expect(
      isSameDay(
        new Date("2026-08-16T21:00:00Z"),
        new Date("2026-08-17T21:00:00Z"),
        "Europe/Berlin",
      ),
    ).toBe(false);
  });

  it("🚨 answers in the ZONE, not in UTC", () => {
    // 22:30 UTC on the 16th is 00:30 on the 17th in Berlin. A comparison made
    // in UTC — which is what `getDate()` does on every host this template
    // deploys to — calls these the same day, and a member in Berlin then reads
    // "yesterday's" message as today's for two hours every night.
    const lateUtc = new Date("2026-08-16T22:30:00Z");
    const nextMorning = new Date("2026-08-17T06:00:00Z");
    expect(isSameDay(lateUtc, nextMorning, "Europe/Berlin")).toBe(true);
    expect(isSameDay(lateUtc, nextMorning, "UTC")).toBe(false);
  });

  it("works east of the date line too", () => {
    // The mirror of the case above: 11:00 UTC is already the next day in
    // Auckland, so a zone that only ever shifts one way would pass the Berlin
    // case and still be wrong here.
    const morningUtc = new Date("2026-08-16T11:00:00Z");
    const eveningUtc = new Date("2026-08-16T20:00:00Z");
    expect(isSameDay(morningUtc, eveningUtc, "UTC")).toBe(true);
    expect(isSameDay(morningUtc, eveningUtc, "Pacific/Auckland")).toBe(false);
  });

  it("survives a daylight-saving boundary", () => {
    // Germany moves the clock at 01:00 UTC on the last Sunday in October. Both
    // instants are the 25th in Berlin, one before the change and one after.
    expect(
      isSameDay(
        new Date("2026-10-25T00:30:00Z"),
        new Date("2026-10-25T12:00:00Z"),
        "Europe/Berlin",
      ),
    ).toBe(true);
  });

  it("is false for an invalid date rather than throwing", () => {
    // Two "Invalid Date"s would otherwise render identically and compare equal.
    const bad = new Date("nonsense");
    expect(isSameDay(bad, bad, "UTC")).toBe(false);
    expect(isSameDay(bad, new Date("2026-08-16T00:00:00Z"), "UTC")).toBe(false);
  });
});
