// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The registry rung, minus the two hosts.
//
// ⚠️ **This file is pure on purpose, and that is a rule rather than a taste.**
// `vitest.config.ts` includes `**/*.test.ts`, so anything placed beside the code
// runs inside every `npm run test` — and `security-check` must never become a
// gate (CLAUDE.md, and check.mjs's own header). Nothing below touches the
// network, spawns a process or reads a file. What the rung does against
// registry.npmjs.org and api.deps.dev is proven by running the command; what
// lives here is the five decisions it makes about answers it has been handed:
//
//   1. WHICH package versions are in scope at all (`directEntries`, `allEntries`),
//   2. what `--young-days` was allowed to be (`parseYoungDays`) — a refusal, never
//      a silent seven,
//   3-5. the three facts, each of which has to read as a fact and not a verdict
//      (`youngFinding`, `deprecatedFinding`, `publisherFinding`).
//
// 🚨 All five can return nothing, and a rung that has quietly started returning
// nothing for everything passes a suite written around emptiness in full. So one
// planted young package MUST come through and be NAMED — the needle at the
// bottom.
//
// Nothing here asserts how many packages this tree has, how many findings appear,
// or how many advisories are accepted. Those are facts about today; the shapes
// are the truth.

import { describe, expect, it } from "vitest";

import {
  ALL_FLAG,
  DEFAULT_YOUNG_DAYS,
  allEntries,
  deprecatedFinding,
  directEntries,
  parseYoungDays,
  publisherFinding,
  reasonOf,
  registry,
  wantsAll,
  youngFinding,
} from "./registry.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

/** `lockfileVersion: 3` is what npm 9+ writes and what this app ships. */
const LOCK = {
  lockfileVersion: 3,
  packages: {
    // the root project — this app, not a dependency
    "": { name: "ds24-appkit", version: "0.0.0" },
    "node_modules/next": { version: "16.2.11" },
    // a scoped name survives whole
    "node_modules/@auth/drizzle-adapter": { version: "1.7.4" },
    // a dev dependency is a direct dependency too: a compromised build tool is
    // every bit as much this app's problem as a compromised library
    "node_modules/vitest": { version: "4.1.10", dev: true },
    // a transitive one — in the lockfile, not in package.json
    "node_modules/tinyrainbow": { version: "3.0.0", dev: true },
    // the same NAME nested at another version: not this app's own resolution
    "node_modules/some-tool/node_modules/next": { version: "9.0.0" },
    // a workspace symlink: its version lives on the real entry
    "node_modules/my-workspace": { resolved: "packages/thing", link: true },
    // the workspace package itself — a path, not a package name either host knows
    "packages/thing": { version: "1.0.0" },
    // nothing resolved, so there is nothing to ask about
    "node_modules/no-version": { resolved: "https://example.invalid/x.tgz" },
  },
};

const PKG = {
  dependencies: { next: "^16.2.11", "@auth/drizzle-adapter": "^1.7.4", "never-installed": "^1.0.0" },
  devDependencies: { vitest: "^4.1.10" },
};

const ENTRY = { name: "left-pad", version: "1.3.0" };

/** 2026-08-10T12:00:00Z — the instant every age below is measured against. */
const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

// ── what is in scope ────────────────────────────────────────────────────────

describe("directEntries is this app's OWN dependencies, at the versions it resolved", () => {
  const entries = directEntries(PKG, LOCK);
  const keys = entries.map((entry) => `${entry.name}@${entry.version}`);

  it("takes dependencies and devDependencies alike", () => {
    expect(keys).toContain("next@16.2.11");
    expect(keys).toContain("vitest@4.1.10");
  });

  it("keeps a scoped name whole", () => {
    expect(keys).toContain("@auth/drizzle-adapter@1.7.4");
  });

  it("drops a declared dependency the lockfile does not resolve", () => {
    // There is no version to ask about, and asking about the RANGE would be
    // asking about a package this app may not be running.
    expect(keys.some((key) => key.startsWith("never-installed@"))).toBe(false);
  });

  it("takes the top-level resolution, never a nested copy of the same name", () => {
    expect(keys).not.toContain("next@9.0.0");
  });

  it("leaves the transitive tree out — that is what the flag is for", () => {
    expect(keys.some((key) => key.startsWith("tinyrainbow@"))).toBe(false);
    expect(allEntries(LOCK).map((entry) => entry.name)).toContain("tinyrainbow");
  });
});

describe("allEntries is every distinct name@version the lockfile pinned", () => {
  const keys = allEntries(LOCK).map((entry) => `${entry.name}@${entry.version}`);

  it("includes a nested resolution as its own question", () => {
    expect(keys).toContain("next@9.0.0");
    expect(keys).toContain("next@16.2.11");
  });

  it("drops the root, a link, a versionless entry and a workspace path", () => {
    expect(keys).not.toContain("ds24-appkit@0.0.0");
    expect(keys.some((key) => key.startsWith("my-workspace@"))).toBe(false);
    expect(keys.some((key) => key.startsWith("no-version@"))).toBe(false);
    expect(keys.some((key) => key.includes("packages/thing"))).toBe(false);
  });

  it("answers an empty list rather than throwing on nothing at all", () => {
    expect(allEntries({})).toEqual([]);
    expect(allEntries(null)).toEqual([]);
    expect(directEntries(null, null)).toEqual([]);
  });
});

describe("wantsAll reads the widening flag and nothing else", () => {
  it("recognises it, and does not invent it", () => {
    expect(wantsAll([ALL_FLAG])).toBe(true);
    expect(wantsAll(["--json"])).toBe(false);
    expect(wantsAll([])).toBe(false);
    expect(wantsAll(undefined as never)).toBe(false);
  });
});

// ── the window a person types ───────────────────────────────────────────────

describe("parseYoungDays refuses a value nobody could have meant", () => {
  it("is seven days when nobody said otherwise", () => {
    expect(parseYoungDays([])).toEqual({ days: DEFAULT_YOUNG_DAYS, error: "" });
  });

  it("reads both spellings, so neither is a silent default", () => {
    expect(parseYoungDays(["--young-days", "14"]).days).toBe(14);
    expect(parseYoungDays(["--young-days=14"]).days).toBe(14);
  });

  it("takes zero — switching the question off is an answer", () => {
    const parsed = parseYoungDays(["--young-days", "0"]);
    expect(parsed.days).toBe(0);
    expect(parsed.error).toBe("");
  });

  it("refuses a word, a fraction, a negative and a missing value", () => {
    // 🚨 `Number(null)` is 0 and `Number("")` is 0 — a number nobody checked is
    // the bug (the configuredNumber() doctrine). Every one of these is a
    // refusal that names the flag, never a quiet fall back to seven.
    for (const argv of [["--young-days", "abc"], ["--young-days", "7.5"], ["--young-days", "-1"], ["--young-days"]]) {
      const parsed = parseYoungDays(argv);
      expect(parsed.error).toContain("--young-days");
      expect(parsed.error.length).toBeGreaterThan(20);
    }
  });

  it("names the value it was given back to whoever typed it", () => {
    expect(parseYoungDays(["--young-days", "3O"]).error).toContain("3O");
  });
});

// ── the three facts ─────────────────────────────────────────────────────────

describe("youngFinding is a fact about a release, never an accusation", () => {
  const twoDaysAgo = new Date(NOW - 2 * DAY).toISOString();

  it("reports a version published inside the window, with the day in words", () => {
    const finding = youngFinding(ENTRY, twoDaysAgo, NOW, 7);
    expect(finding?.severity).toBe("medium");
    expect(finding?.title).toContain("2 days");
    expect(finding?.title).toContain("2026-08-08");
    expect(finding?.where).toBe("left-pad@1.3.0");
  });

  it("says nothing at all about a version older than the window", () => {
    expect(youngFinding(ENTRY, new Date(NOW - 30 * DAY).toISOString(), NOW, 7)).toBeNull();
  });

  it("decides the edge one way and states it: exactly the window counts as young", () => {
    // A boundary that flips with the second it is read at is a boundary nobody
    // can act on, and the safe direction is the one that reports.
    expect(youngFinding(ENTRY, new Date(NOW - 7 * DAY).toISOString(), NOW, 7)).not.toBeNull();
    expect(youngFinding(ENTRY, new Date(NOW - 7 * DAY - 1).toISOString(), NOW, 7)).toBeNull();
  });

  it("says nothing when there is no date to judge — a fact nobody has is not one", () => {
    // deps.dev not answering is the PARTIAL case, and the rung says so in its
    // evidence. It must never become a finding, and never a silent clean.
    expect(youngFinding(ENTRY, "", NOW, 7)).toBeNull();
    expect(youngFinding(ENTRY, "not a date", NOW, 7)).toBeNull();
    expect(youngFinding(ENTRY, null as never, NOW, 7)).toBeNull();
  });

  it("never calls it malicious, and never rates it above MEDIUM", () => {
    const finding = youngFinding(ENTRY, twoDaysAgo, NOW, 7);
    const words = `${finding?.title} ${finding?.why} ${finding?.fix}`.toLowerCase();
    for (const accusation of ["malicious", "compromised package", "attack", "backdoor"]) {
      expect(words).not.toContain(accusation);
    }
    expect(finding?.severity).toBe("medium");
  });
});

describe("deprecatedFinding quotes the publisher rather than judging for them", () => {
  it("reports the publisher's own sentence", () => {
    const finding = deprecatedFinding(ENTRY, "request has been deprecated, see …/issues/3142");
    expect(finding?.severity).toBe("medium");
    expect(finding?.evidence).toContain("request has been deprecated");
  });

  it("bounds the length, because that string is somebody else's prose", () => {
    const finding = deprecatedFinding(ENTRY, "x".repeat(5000));
    expect(finding?.evidence.length).toBeLessThan(400);
    expect(finding?.evidence).toContain("…");
  });

  it("says nothing when the package is not deprecated", () => {
    expect(deprecatedFinding(ENTRY, undefined)).toBeNull();
    expect(deprecatedFinding(ENTRY, "")).toBeNull();
    expect(deprecatedFinding(ENTRY, "   ")).toBeNull();
    // `true` is not a sentence, and quoting "true" at somebody helps nobody.
    expect(deprecatedFinding(ENTRY, true as never)).toBeNull();
  });
});

describe("publisherFinding compares two lists and says so", () => {
  const maintainers = [{ name: "alice" }, { name: "bob" }];

  it("reports an account that is not among the maintainers today", () => {
    const finding = publisherFinding(ENTRY, { name: "mallory" }, maintainers);
    expect(finding?.severity).toBe("medium");
    expect(finding?.title).toContain("mallory");
    expect(finding?.evidence).toContain("alice, bob");
  });

  it("says nothing when the publisher is one of them", () => {
    expect(publisherFinding(ENTRY, { name: "alice" }, maintainers)).toBeNull();
  });

  it("takes a bare string as readily as npm's { name, email }", () => {
    expect(publisherFinding(ENTRY, "mallory", ["alice"])?.title).toContain("mallory");
    expect(publisherFinding(ENTRY, "alice", ["alice"])).toBeNull();
  });

  it("says nothing when there is nothing to compare, or nothing to compare against", () => {
    // "Not among an empty list" is true of everybody, and a fact that could not
    // be established is not reported as one.
    expect(publisherFinding(ENTRY, undefined, maintainers)).toBeNull();
    expect(publisherFinding(ENTRY, { name: "mallory" }, [])).toBeNull();
    expect(publisherFinding(ENTRY, { name: "mallory" }, undefined as never)).toBeNull();
  });

  it("frames it as two lists rather than as an accusation", () => {
    const finding = publisherFinding(ENTRY, "mallory", ["alice"]);
    expect(finding?.why).toContain("handover");
    expect(`${finding?.title} ${finding?.why}`.toLowerCase()).not.toContain("malicious");
  });

  // 🚨 Trusted publishing, measured 2026-08-10 against the real registry. npm's
  // OIDC flow puts the CI identity in `_npmUser`, and that identity is by
  // construction never in `maintainers` — so the plain comparison fires on the
  // packages published the MOST secure way there is. On this tree that was
  // next, vitest, tailwindcss and postcss, every run, for ever.
  const CI = {
    name: "GitHub Actions",
    email: "npm-oidc-no-reply@github.com",
    trustedPublisher: { id: "github", oidcConfigId: "oidc:1f286ab6" },
  };

  it("says nothing about a CI release the maintainers configured", () => {
    expect(publisherFinding(ENTRY, CI, maintainers)).toBeNull();
  });

  it("compares the APPROVER, not the CI identity, where npm names one", () => {
    // A maintainer authorised the release: that is the ordinary case and silent.
    expect(publisherFinding(ENTRY, { ...CI, approver: { name: "alice" } }, maintainers)).toBeNull();
  });

  it("still reports an approver who is not among the maintainers — that IS the shape", () => {
    const finding = publisherFinding(ENTRY, { ...CI, approver: { name: "mallory" } }, maintainers);
    expect(finding?.title).toContain("mallory");
    // and it says how it was published, so the reader is not left thinking a
    // human typed `npm publish`
    expect(finding?.evidence).toContain("trusted publishing");
    expect(finding?.evidence).toContain("GitHub Actions");
  });
});

// ── the sentence a skip carries ─────────────────────────────────────────────

describe("reasonOf names a host, in one line", () => {
  it("keeps the transport's own name and message", () => {
    const error = Object.assign(new Error("fetch failed"), { name: "TypeError" });
    expect(reasonOf(error)).toBe("TypeError: fetch failed");
  });

  it("uses this file's own sentence for a refusal, so the host is named", () => {
    // "Error: HTTP 429" names nothing, and a 429 has to read AS a 429: an
    // operator waits that one out, where an unreachable host is something they
    // go and look at.
    const limited = Object.assign(new Error("x"), {
      transport: "registry.npmjs.org rate-limited this run (HTTP 429)",
    });
    expect(reasonOf(limited)).toContain("429");
    expect(reasonOf(limited)).toContain("registry.npmjs.org");
  });

  it("never answers with nothing at all — a blank reason is a crash by design", () => {
    // `aggregate()` throws on a skip whose reason is blank, whitespace included.
    expect(reasonOf(null).trim().length).toBeGreaterThan(0);
    expect(reasonOf({}).trim().length).toBeGreaterThan(0);
  });
});

// ── 🚨 the needle ───────────────────────────────────────────────────────────

describe("🚨 a planted young package really comes through, and is named", () => {
  // Every function above can legitimately return nothing, which makes a suite
  // written around emptiness pass in full while the rung reports clean for ever.
  // So: one lockfile, one package.json, one publish date — and a finding that
  // names the package by name at the far end.
  const lock = {
    packages: {
      "": { name: "app", version: "0.0.0" },
      "node_modules/fresh-thing": { version: "2.0.1" },
    },
  };
  const pkg = { dependencies: { "fresh-thing": "^2.0.0" } };

  it("is in scope, is inside the window, and arrives as a named ⚠️ MEDIUM", () => {
    const entries = directEntries(pkg, lock);
    expect(entries).toEqual([{ name: "fresh-thing", version: "2.0.1" }]);

    const finding = youngFinding(entries[0], new Date(NOW - DAY).toISOString(), NOW, 7);
    expect(finding).not.toBeNull();
    expect(finding?.where).toBe("fresh-thing@2.0.1");
    expect(finding?.severity).toBe("medium");
    // Every field the renderer prints is there — a finding missing one renders
    // as a blank line under a label, which reads like nothing being wrong.
    for (const field of ["title", "where", "why", "fix", "evidence", "source"] as const) {
      expect(String(finding?.[field] ?? "")).not.toBe("");
    }
    // No advisory id, so `accepted.mjs` can never swallow it: that set is for
    // advisories, and this rung has none.
    expect(finding?.id).toBeUndefined();
  });

  it("and the same package falls out of scope once the window is narrowed", () => {
    // The other half of the needle: a `youngFinding` that reported everything
    // would make the assertion above just as vacuous as one that reported
    // nothing.
    const entries = directEntries(pkg, lock);
    expect(youngFinding(entries[0], new Date(NOW - 30 * DAY).toISOString(), NOW, 7)).toBeNull();
  });
});

// ── the rung's own declaration ──────────────────────────────────────────────

describe("the rung declares itself the way the aggregator reads it", () => {
  it("is tier 1 — fetch() is Node's own and both hosts answer unauthenticated", () => {
    expect(registry.tier).toBe(1);
    expect(registry.id).toBe("registry");
  });

  it("says what it would have covered, in words, not by repeating its name", () => {
    expect(registry.covers.length).toBeGreaterThan(20);
    expect(registry.covers).not.toBe(registry.label);
  });
});
