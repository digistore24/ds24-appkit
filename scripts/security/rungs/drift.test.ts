// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The drift rung's comparison, minus the public repo.
//
// ⚠️ **This file is pure on purpose, and that is a rule rather than a taste.**
// `vitest.config.ts` includes `**/*.test.ts`, so anything placed beside the code
// runs inside every `npm run test` — and `security-check` must never become a
// gate (CLAUDE.md, and check.mjs's own header). Nothing below fetches, spawns or
// reads a file. What the rung does against `raw.githubusercontent.com` is proven
// by running the command; what lives here is what it DECIDES about two
// already-parsed `package.json` objects:
//
//   1. what lower bound a range even HAS (`rangeFloor`) — a refusal, never a guess,
//   2. which of two versions is older (`isBehind`), including the prerelease rule
//      this app really depends on,
//   3. what the whole comparison comes to (`driftBetween`, `driftFinding`) — ONE
//      ℹ️ LOW finding, never one per package.
//
// 🚨 All three can answer "nothing", and a rung that has quietly started
// answering nothing for everything passes a suite written around emptiness in
// full. So a planted behind package MUST come through and be NAMED with BOTH
// versions — the needle at the bottom of each block.
//
// Nothing here asserts how many dependencies this app has or how far behind it
// is. Those are facts about today; the shapes are the truth.
import { describe, expect, it } from "vitest";

import {
  drift,
  driftBetween,
  driftFinding,
  isBehind,
  rangeFloor,
  templatePackageUrl,
} from "./drift.mjs";

// ── what a range even admits ────────────────────────────────────────────────

describe("the lower bound of a range", () => {
  it("reads the four spellings this app's package.json actually uses", () => {
    expect(rangeFloor("^16.2.11")).toBe("16.2.11");
    expect(rangeFloor("~1.2.3")).toBe("1.2.3");
    expect(rangeFloor(">=0.25.12")).toBe("0.25.12");
    expect(rangeFloor(">= 0.25.12")).toBe("0.25.12");
    expect(rangeFloor("19.0.0")).toBe("19.0.0");
    // next-auth ships as a prerelease in this template, so this is not academic.
    expect(rangeFloor("5.0.0-beta.32")).toBe("5.0.0-beta.32");
  });

  it("🚨 refuses what it cannot state a bound for, rather than guessing one", () => {
    // Each of these would be silently treated as EQUAL by a forgiving reader,
    // and the rung would then report "nothing behind" about a package it never
    // compared. They come back null and land in the evidence line as unread.
    for (const range of ["^7 || ^8", "1.2.3 - 2.0.0", "*", "latest", "npm:other@^1", "", "x"]) {
      expect(rangeFloor(range), range).toBeNull();
    }
    expect(rangeFloor("github:owner/repo#main")).toBeNull();
    expect(rangeFloor(undefined)).toBeNull();
  });
});

// ── which of two is older ───────────────────────────────────────────────────

describe("which version is behind", () => {
  it("compares the triple, not the string", () => {
    expect(isBehind("1.2.3", "1.2.4")).toBe(true);
    expect(isBehind("1.9.0", "1.10.0")).toBe(true); // the one a string compare gets wrong
    expect(isBehind("2.0.0", "1.9.9")).toBe(false);
    expect(isBehind("1.2.3", "1.2.3")).toBe(false);
  });

  it("knows a release outranks every prerelease of the same triple", () => {
    expect(isBehind("5.0.0-beta.32", "5.0.0")).toBe(true);
    expect(isBehind("5.0.0", "5.0.0-beta.32")).toBe(false);
    expect(isBehind("5.0.0-beta.2", "5.0.0-beta.32")).toBe(true);
    expect(isBehind("5.0.0-beta.32", "5.0.0-beta.2")).toBe(false);
    // Fewer identifiers is the lower precedence when the shared ones are equal.
    expect(isBehind("1.0.0-alpha", "1.0.0-alpha.1")).toBe(true);
  });

  it("answers false where it could not compare — a missed comparison is not a finding", () => {
    expect(isBehind(null, "1.0.0")).toBe(false);
    expect(isBehind("1.0.0", null)).toBe(false);
    expect(isBehind("not-a-version", "1.0.0")).toBe(false);
  });
});

// ── the comparison, and the one finding it comes to ─────────────────────────

const MINE = {
  version: "0.19.0",
  dependencies: { next: "^16.0.0", react: "19.0.0", "next-auth": "5.0.0-beta.30" },
  devDependencies: { vitest: "^4.1.10", eslint: "^7 || ^8" },
};

const THEIRS = {
  version: "0.23.0",
  dependencies: { next: "^16.2.11", react: "19.0.0", "next-auth": "5.0.0-beta.32" },
  devDependencies: { vitest: "^4.1.10", eslint: "^9.17.0", "brand-new": "^1.0.0" },
};

describe("the drift between two package.json files", () => {
  it("🚨 NEEDLE — a planted behind package really lands in the comparison, with BOTH versions", () => {
    const { behind } = driftBetween(MINE, THEIRS);
    const names = behind.map((entry) => entry.name);

    expect(names).toContain("next");
    expect(behind.find((entry) => entry.name === "next")).toEqual({
      name: "next",
      mine: "16.0.0",
      theirs: "16.2.11",
    });
    // The prerelease rule, exercised on a real dependency of this template.
    expect(names).toContain("next-auth");
    // Level ones must NOT be dragged in — that half is what makes it a needle.
    expect(names).not.toContain("react");
    expect(names).not.toContain("vitest");
    // A package the template has and this app does not is a CHOICE somebody
    // made, and this rung has no way to tell which way round. Never drift.
    expect(names).not.toContain("brand-new");
  });

  it("🚨 a range nobody can read is reported as unread, never silently equal", () => {
    const { behind, unread } = driftBetween(MINE, THEIRS);
    expect(behind.map((entry) => entry.name)).not.toContain("eslint");
    expect(unread.join(" ")).toContain("eslint");
  });

  it("finds nothing between an app and itself", () => {
    const { behind, unread } = driftBetween(THEIRS, THEIRS);
    expect(behind).toEqual([]);
    // `^7 || ^8` is gone from THEIRS, so nothing is unread either.
    expect(unread).toEqual([]);
  });

  it("🚨 is ONE ℹ️ LOW finding for the whole drift, never one per package", () => {
    const { behind } = driftBetween(MINE, THEIRS);
    const finding = driftFinding(behind, { templateVersion: THEIRS.version });

    expect(finding).not.toBeNull();
    expect(finding?.severity).toBe("low");
    expect(finding?.source).toBe("template");
    // Every field the renderer prints is there — a finding missing one renders
    // as a blank line under a label, which reads like nothing being wrong.
    for (const field of ["title", "where", "why", "fix", "evidence", "source"] as const) {
      expect(String(finding?.[field] ?? ""), field).not.toBe("");
    }
    // No advisory id: nothing here is acceptable by exemption.
    expect(finding?.id).toBeUndefined();
    // Both versions travel, and they travel in the evidence rather than the
    // Where: line, which has one line to work with.
    expect(finding?.evidence).toContain("16.0.0");
    expect(finding?.evidence).toContain("16.2.11");
    expect(finding?.where).toContain("next");
    // 🚨 `node run.mjs update` carries text and never code — the Fix has to say so.
    expect(finding?.fix).toContain("node run.mjs update");
    expect(finding?.fix).toContain("docs/updates.md");
  });

  it("names a few in Where: and counts the rest, so the line stays one line", () => {
    const behind = ["a", "b", "c", "d", "e", "f"].map((name) => ({
      name,
      mine: "1.0.0",
      theirs: "2.0.0",
    }));
    expect(driftFinding(behind)?.where).toBe("a, b, c, d and 2 more");
  });

  it("is nothing at all when nothing is behind", () => {
    expect(driftFinding([])).toBeNull();
  });
});

// ── the address ─────────────────────────────────────────────────────────────

describe("the URL it fetches", () => {
  it("joins the stamp's base with exactly one slash, whichever way it was written", () => {
    expect(templatePackageUrl("https://example.test/main/")).toBe(
      "https://example.test/main/package.json",
    );
    expect(templatePackageUrl("https://example.test/main")).toBe(
      "https://example.test/main/package.json",
    );
  });
});

// ── the rung's own declaration ──────────────────────────────────────────────

describe("the rung declares itself the way the aggregator reads it", () => {
  it("is tier 1 and carries all five fields", () => {
    expect(drift.id).toBe("drift");
    expect(drift.tier).toBe(1);
    expect(String(drift.label).length).toBeGreaterThan(0);
    expect(typeof drift.run).toBe("function");
  });

  it("says what it would have covered, in words that are not its own name", () => {
    expect(drift.covers).toBe(
      "how far this app's direct dependencies have drifted from the template's current ones",
    );
    expect(drift.covers).not.toBe(drift.label);
    expect(drift.covers).not.toBe(drift.id);
  });
});
