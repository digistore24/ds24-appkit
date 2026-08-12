// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The OSV rung, minus the network.
//
// ⚠️ **This file is pure on purpose, and that is a rule rather than a taste.**
// `vitest.config.ts` includes `**/*.test.ts`, so anything placed beside the code
// runs inside every `npm run test` — and `security-check` must never become a
// gate (CLAUDE.md, and check.mjs's own header). Nothing below touches the
// network, spawns a process or reads a file. What the rung does against the real
// API is proven by running the command; what lives here is the four decisions
// the rung makes about an answer it has already been handed.
//
// The four:
//
//   1. which package versions get asked about at all (`lockfileQueries`),
//   2. how the answer is rated (`rateOsv`) — the CONDITION, never the vendor's
//      adjective,
//   3. what npm already reported and therefore is not reported twice
//      (`excluded`), on the id OR any alias,
//   4. that a failed detail lookup loses nothing.
//
// 🚨 And one needle. Three of those four are FILTERS, and a filter that has
// quietly started excluding everything passes a test suite built around emptiness
// without a word. So one fixture advisory MUST come through as a ❌ HIGH finding,
// and if it stops doing so this file goes red — which is the whole reason it is
// worth having.
//
// Nothing here asserts how many entries are in the accepted set, how many
// packages are in this app's lockfile, or how many findings this tree has. Those
// are facts about today (`accepted.mjs`'s own warning); the sets are the truth.

import { describe, expect, it } from "vitest";

import { chunk, excluded, fixedVersions, lockfileQueries, rateOsv, reasonOf } from "./osv.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * A lockfile with one of each thing that has to be handled, and nothing else.
 * `lockfileVersion: 3` is what npm 9+ writes and what this app ships.
 */
const LOCK = {
  lockfileVersion: 3,
  packages: {
    // the root project — this app, not a dependency
    "": { name: "ds24-appkit", version: "0.0.0" },
    "node_modules/lodash": { version: "4.17.11" },
    // a scope survives: the name is everything after the LAST node_modules/
    "node_modules/@scope/thing": { version: "2.0.0" },
    // the same name@version reached a second way — one query, not two
    "node_modules/some-tool/node_modules/lodash": { version: "4.17.11" },
    // dev-only, and it stays that way
    "node_modules/minimist": { version: "1.2.0", dev: true },
    // "dev here, possibly production elsewhere" — the safe direction is production
    "node_modules/semver": { version: "5.0.0", devOptional: true },
    // a workspace symlink: its version lives on the real entry
    "node_modules/my-workspace": { resolved: "packages/thing", link: true },
    // the workspace package itself — a path, not a package name OSV knows
    "packages/thing": { version: "1.0.0" },
    // nothing resolved, so there is nothing to ask about
    "node_modules/no-version": { resolved: "https://example.invalid/x.tgz" },
  },
};

/** GHSA-jf85-cpcp-j695, as OSV really answers it (measured 2026-08-10). */
const LODASH_CRITICAL = {
  id: "GHSA-jf85-cpcp-j695",
  summary: "Prototype Pollution in lodash",
  aliases: ["CVE-2019-10744"],
  database_specific: { severity: "CRITICAL" },
  affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.12" }] }] }],
};

/** The same shape without a critical rating — the ordinary case. */
const PLAIN = {
  id: "GHSA-p6mc-m468-83gw",
  summary: "Prototype pollution in lodash",
  aliases: [],
  database_specific: { severity: "High" },
  affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
};

// ── which versions get asked about ──────────────────────────────────────────

describe("lockfileQueries reads the lockfile, never the install", () => {
  const queries = lockfileQueries(LOCK);
  const keys = queries.map((entry) => `${entry.name}@${entry.version}`);

  it("takes the name from the last node_modules/ segment, scope included", () => {
    expect(keys).toContain("@scope/thing@2.0.0");
    expect(keys).toContain("lodash@4.17.11");
  });

  it("asks about a name@version once however many ways it is reached", () => {
    expect(keys.filter((key) => key === "lodash@4.17.11")).toEqual(["lodash@4.17.11"]);
  });

  it("drops the root, a link, a versionless entry and a workspace path", () => {
    expect(keys).not.toContain("ds24-appkit@0.0.0");
    expect(keys.some((key) => key.startsWith("my-workspace@"))).toBe(false);
    expect(keys.some((key) => key.startsWith("no-version@"))).toBe(false);
    // `packages/thing` has no node_modules/ segment, so it has no package name
    // to take — a path is not something OSV has anything under.
    expect(keys.some((key) => key.includes("packages/thing"))).toBe(false);
  });

  it("carries the dev/production split the lockfile already made", () => {
    const by = new Map(queries.map((entry) => [`${entry.name}@${entry.version}`, entry.dev]));
    expect(by.get("minimist@1.2.0")).toBe(true);
    expect(by.get("lodash@4.17.11")).toBe(false);
    // devOptional may be installed in a production tree elsewhere: the safe
    // direction is production, where no allowance applies at all.
    expect(by.get("semver@5.0.0")).toBe(false);
  });

  it("answers an empty list rather than throwing on a lockfile with nothing in it", () => {
    expect(lockfileQueries({})).toEqual([]);
    expect(lockfileQueries(null)).toEqual([]);
  });
});

describe("chunk", () => {
  it("keeps every element, in order, in pieces of at most the size given", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 500)).toEqual([[1, 2]]);
    expect(chunk([], 500)).toEqual([]);
  });

  it("never produces a step of zero — that loop would not terminate", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

// ── how an answer is rated ──────────────────────────────────────────────────

describe("rateOsv rates the condition, not the vendor's adjective", () => {
  const packages = ["lodash@4.17.11"];

  it("is ❌ HIGH in the production tree whatever OSV calls it", () => {
    expect(rateOsv(PLAIN, { dev: false, packages }).severity).toBe("high");
  });

  it("is 🚨 CRITICAL in the production tree only where OSV says CRITICAL", () => {
    expect(rateOsv(LODASH_CRITICAL, { dev: false, packages }).severity).toBe("critical");
  });

  it("reads that word case-insensitively", () => {
    const lower = { ...LODASH_CRITICAL, database_specific: { severity: "critical" } };
    expect(rateOsv(lower, { dev: false, packages }).severity).toBe("critical");
  });

  it("is ⚠️ MEDIUM when it is dev-only — including when OSV says CRITICAL", () => {
    expect(rateOsv(PLAIN, { dev: true, packages }).severity).toBe("medium");
    // It does not ship. A dev-only advisory rated like a hole in the request
    // path teaches an operator to ignore the whole report.
    expect(rateOsv(LODASH_CRITICAL, { dev: true, packages }).severity).toBe("medium");
  });

  it("carries OSV's own id and names OSV as the source", () => {
    const finding = rateOsv(LODASH_CRITICAL, { dev: false, packages });
    expect(finding.id).toBe("GHSA-jf85-cpcp-j695");
    expect(finding.source).toBe("OSV.dev");
  });

  it("names the fixed version where OSV gives one, and says so where it does not", () => {
    expect(fixedVersions(LODASH_CRITICAL)).toEqual(["4.17.12"]);
    expect(rateOsv(LODASH_CRITICAL, { dev: false, packages }).fix).toContain("4.17.12");
    const unfixed = { ...LODASH_CRITICAL, affected: [] };
    expect(fixedVersions(unfixed)).toEqual([]);
    expect(rateOsv(unfixed, { dev: false, packages }).fix).toContain("no fixed version");
  });

  it("names the packages it reaches in this tree, four then a count", () => {
    const many = ["a@1", "b@1", "c@1", "d@1", "e@1", "f@1"];
    const where = rateOsv(PLAIN, { dev: false, packages: many }).where;
    expect(where).toContain("a@1, b@1, c@1, d@1");
    expect(where).toContain("and 2 more");
    expect(where).toContain(PLAIN.id);
  });

  it("only claims npm did not report it when npm actually answered", () => {
    // This rung reports what npm did NOT report. That sentence is true exactly
    // while npm was reachable — so when it was not, the finding is still
    // reported and the claim is withdrawn rather than asserted. A claim nobody
    // checked is never made, in the `Why:` line any more than in the evidence.
    const packages = ["lodash@4.17.11"];
    expect(rateOsv(PLAIN, { dev: false, packages }).why).toContain(
      "npm's own audit did not report it",
    );
    const unverified = rateOsv(PLAIN, { dev: false, packages, npmAnswered: false }).why;
    expect(unverified).not.toContain("did not report it");
    expect(unverified).toContain("unknown");
    // and the same in the dev-only half, which is a second sentence
    const devUnverified = rateOsv(PLAIN, { dev: true, packages, npmAnswered: false }).why;
    expect(devUnverified).not.toContain("did not report it");
    expect(devUnverified).toContain("unknown");
  });

  it("keeps a finding whose detail lookup failed, and says so in its evidence", () => {
    // Only the id came back from the batch — no severity, no summary. Losing the
    // finding because the SECOND request failed is the one failure this whole
    // command exists to prevent.
    const finding = rateOsv({ id: "GHSA-only-the-id" }, { dev: false, packages, detailFetched: false });
    expect(finding.severity).toBe("high");
    expect(finding.id).toBe("GHSA-only-the-id");
    expect(finding.title).toContain("GHSA-only-the-id");
    expect(finding.evidence).toContain("did not answer");
  });
});

// ── what npm already reported ───────────────────────────────────────────────

describe("excluded matches on the id or any alias, and on nothing else", () => {
  it("matches on the advisory's own id", () => {
    expect(excluded(LODASH_CRITICAL, new Set(["GHSA-jf85-cpcp-j695"]))).toBe(true);
  });

  it("matches on an alias, because npm keys on GHSA and OSV may answer CVE", () => {
    expect(excluded(LODASH_CRITICAL, new Set(["CVE-2019-10744"]))).toBe(true);
  });

  it("does not match on a package name, or on an unrelated id", () => {
    expect(excluded(LODASH_CRITICAL, new Set(["lodash"]))).toBe(false);
    expect(excluded(LODASH_CRITICAL, new Set(["GHSA-something-else"]))).toBe(false);
  });

  it("excludes nothing when npm reported nothing", () => {
    // An empty set is a real answer — npm looked and found nothing. Whether npm
    // could answer AT ALL is a separate value the rung holds; this must never
    // become the same thing.
    expect(excluded(LODASH_CRITICAL, new Set())).toBe(false);
  });

  it("takes a plain array as readily as a Set", () => {
    expect(excluded(LODASH_CRITICAL, ["CVE-2019-10744"])).toBe(true);
  });
});

// ── 🚨 the needle ───────────────────────────────────────────────────────────

describe("🚨 an advisory npm did not report comes through as a finding", () => {
  // Three of the four decisions above are FILTERS — `lockfileQueries` drops
  // entries, `excluded` drops advisories, `rateOsv` decides how loud one is. A
  // filter that has quietly started excluding EVERYTHING makes every assertion
  // written around emptiness pass. So this is the planted needle: one advisory
  // that must survive the whole pure path and arrive as ❌ HIGH.
  const npmKnows = new Set(["GHSA-something-npm-reported"]);

  it("survives the exclusion and is rated HIGH in the production tree", () => {
    expect(excluded(PLAIN, npmKnows)).toBe(false);
    const finding = rateOsv(PLAIN, { dev: false, packages: ["lodash@4.17.11"] });
    expect(finding.severity).toBe("high");
    expect(finding.where).toContain("lodash@4.17.11");
    expect(finding.source).toBe("OSV.dev");
    expect(finding.title).toBe("Prototype pollution in lodash");
    // Every field the renderer prints is there — a finding missing one renders
    // as a blank line under a label, which reads like nothing being wrong.
    for (const field of ["title", "where", "why", "fix", "evidence", "source", "id"] as const) {
      expect(String(finding[field] ?? "")).not.toBe("");
    }
  });

  it("is still asked about at all — the lockfile fixture really produces it", () => {
    // The other half of the same needle: a `lockfileQueries` that dropped
    // everything would make the exclusion test above vacuous.
    expect(lockfileQueries(LOCK).map((entry) => entry.name)).toContain("lodash");
  });
});

// ── the sentence a skip carries ─────────────────────────────────────────────

describe("reasonOf names a tool or an endpoint, in one line", () => {
  it("keeps the transport's own name and message", () => {
    const error = Object.assign(new Error("fetch failed"), { name: "TypeError" });
    expect(reasonOf(error)).toBe("TypeError: fetch failed");
  });

  it("uses this file's own sentence for a refusal, so the endpoint is named", () => {
    // "Error: HTTP 503" names nothing. `api.osv.dev answered HTTP 503` does.
    const refused = Object.assign(new Error("x"), { transport: "api.osv.dev answered HTTP 503" });
    expect(reasonOf(refused)).toBe("api.osv.dev answered HTTP 503");
  });

  it("never answers with nothing at all — a blank reason is a crash by design", () => {
    // `aggregate()` throws on a skip whose reason is blank, whitespace included.
    expect(reasonOf(null).trim().length).toBeGreaterThan(0);
    expect(reasonOf({}).trim().length).toBeGreaterThan(0);
  });
});
