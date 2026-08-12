// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs security-scope` decides what a recurring security pass looks at.
// Every mistake it can make shrinks that scope — and a smaller scope finds less,
// which reads as a cleaner app. So the failures this file is written against are
// all the same shape: **a wrong answer that looks like a better one.**
//
//   an area that stops widening the scope   → the sharp code is never re-read
//   an empty diff rendered as a zero tally  → the shape of a clean full pass
//   a `notLooked` line that disappears      → nobody learns what went unread
//   a git listing without `-z`              → every non-ASCII path silently gone
//
// ⚠️ **This file is pure on purpose.** `vitest.config.ts` includes
// `**/*.test.ts`, so anything here runs inside every `npm run test` — and
// `security-check` / `security-scope` must never become a gate. Nothing below
// touches the network or spawns a process; three assertions read a file off disk
// (the skill's own text, and this command's own source), which is a fixture.
//
// 🚨 **Two of the assertions carry a NEEDLE**, the doctrine
// `scripts/lib/source-text.test.ts` states: *a guard whose probe cannot fire is
// worse than no guard — it reports success.* `areasFor()` is asserted in BOTH
// directions, because a function that widened everything and a function that
// widened nothing both pass a one-sided test.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "../lib/source-text.mjs";
import {
  ALWAYS_IN_FULL,
  areasFor,
  newestReport,
  normalizePaths,
  reportDate,
  reportSeq,
  scopeSummary,
  uncoveredFiles,
} from "./scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SKILL = join(ROOT, ".claude/skills/security-gateway/SKILL.md");

// ── the report name is the date ─────────────────────────────────────────────

describe("reportDate", () => {
  it("reads the date out of a report's file name", () => {
    expect(reportDate("security-2026-08-01.md")).toBe("2026-08-01");
    expect(reportDate("security-2026-08-01-2.md")).toBe("2026-08-01");
  });

  it("🚨 refuses the two undated files that live in the same folder", () => {
    // Both are real: `security-accepted.md` is this skill's own accepted-risks
    // file, `module-removals.md` is written by `module remove --drop-data`.
    // Either one taken as "the newest report" would put the base commit
    // somewhere arbitrary and the scope with it.
    expect(reportDate("security-accepted.md")).toBeNull();
    expect(reportDate("module-removals.md")).toBeNull();
    expect(reportDate("ux-2026-08-01.md")).toBeNull();
    expect(reportDate("security-2026-13-40.md")).toBeNull();
    expect(reportDate("")).toBeNull();
  });

  it("counts a same-day run by its suffix", () => {
    expect(reportSeq("security-2026-08-01.md")).toBe(1);
    expect(reportSeq("security-2026-08-01-3.md")).toBe(3);
  });
});

describe("newestReport", () => {
  it("takes the newest by date, then by same-day suffix", () => {
    const names = [
      "security-accepted.md",
      "security-2026-07-30.md",
      "security-2026-08-01.md",
      "security-2026-08-01-2.md",
      "module-removals.md",
    ];
    expect(newestReport(names)).toBe("security-2026-08-01-2.md");
  });

  it("answers null where there is nothing dated — never a guess", () => {
    expect(newestReport(["security-accepted.md", "module-removals.md"])).toBeNull();
    expect(newestReport([])).toBeNull();
  });
});

// ── the areas, in both directions ───────────────────────────────────────────

describe("areasFor", () => {
  it("🚨 a planted money file really does pull the money area in", () => {
    const areas = areasFor(["app/dashboard/page.tsx", "lib/tokens/spend.ts"]);
    expect(areas.map((entry) => entry.area)).toEqual(["money"]);
    expect(areas[0].files).toEqual(["lib/tokens/spend.ts"]);
    expect(areas[0].why.length).toBeGreaterThan(0);
  });

  it("🚨 and a file outside every area really does pull none in", () => {
    // The other half of the needle. Without it a function that widened
    // EVERYTHING would pass the assertion above and this whole file with it.
    expect(areasFor(["app/dashboard/page.tsx", "messages/de.json"])).toEqual([]);
  });

  it("names the file that pulled each area in", () => {
    const areas = areasFor(["db/schema.ts", "auth.config.ts", "lib/digistore/ipn.ts"]);
    expect(areas.map((entry) => entry.area)).toEqual(["money", "authentication", "customer data"]);
    expect(areas.map((entry) => entry.files)).toEqual([
      ["lib/digistore/ipn.ts"],
      ["auth.config.ts"],
      ["db/schema.ts"],
    ]);
  });

  it("gives the empty answer for empty input, never the clean one", () => {
    expect(areasFor([])).toEqual([]);
    expect(areasFor(undefined as unknown as string[])).toEqual([]);
  });

  it("treats a trailing slash as a prefix and everything else as one file", () => {
    // `lib/tokens/` is a directory, so anything under it counts.
    expect(areasFor(["lib/tokens/anything-at-all.ts"]).map((e) => e.area)).toEqual(["money"]);
    // `auth.ts` is one file — a longer name that merely starts with it is not it.
    expect(areasFor(["auth.tsx"])).toEqual([]);
  });
});

// ── what nothing reads ──────────────────────────────────────────────────────

describe("uncoveredFiles", () => {
  it("lists the changed files no check reads", () => {
    expect(uncoveredFiles(["messages/de.json", "docs/app.md", "lib/tokens/spend.ts"])).toEqual([
      "docs/app.md",
      "messages/de.json",
    ]);
  });

  it("never calls a file uncovered when it pulled an area in", () => {
    // `docs/` is uncovered, but this one is not a docs file — the area answer
    // outranks the prefix, or a `db/schema.ts` renamed into a doc-shaped path
    // would vanish out of both lists at once.
    expect(uncoveredFiles(["db/schema.ts"])).toEqual([]);
  });
});

describe("normalizePaths", () => {
  it("compares with `/` after normalising, and de-duplicates", () => {
    expect(normalizePaths(["lib\\tokens\\spend.ts", "lib/tokens/spend.ts", "./auth.ts"])).toEqual([
      "auth.ts",
      "lib/tokens/spend.ts",
    ]);
  });
});

// ── the header block ────────────────────────────────────────────────────────

describe("scopeSummary", () => {
  const base = "a1b2c3d4e5f6";

  it("names both numbers, and says it is not a full pass", () => {
    const files = ["lib/tokens/spend.ts", "messages/de.json"];
    const text = scopeSummary({
      report: "security-2026-08-01.md",
      base,
      files,
      areas: areasFor(files),
      total: 826,
    });
    expect(text).toContain("docs/reports/security-2026-08-01.md");
    expect(text).toContain("(base a1b2c3d)");
    expect(text).toContain("2 file(s) changed");
    expect(text).toContain("1 area reviewed in full");
    expect(text).toContain("NOT looked at: 824 of 826 files.");
    expect(text).toContain("This is not a full pass.");
  });

  it("🚨 still prints the line when the scope covers everything", () => {
    // `0 of 826` rather than no line at all. A missing line reads as "the
    // question does not apply here", which is the one thing it never means.
    const files = Array.from({ length: 826 }, (_, index) => `app/file-${index}.ts`);
    const text = scopeSummary({ report: "security-2026-08-01.md", base, files, areas: [], total: 826 });
    expect(text).toContain("NOT looked at: 0 of 826 files.");
  });

  it("🚨 an empty diff is a sentence, never a zero tally", () => {
    const text = scopeSummary({
      report: "security-2026-08-01.md",
      base,
      files: [],
      areas: [],
      total: 826,
    });
    // Word-wrapped, so the assertions run against one line of it — a phrase that
    // happens to straddle a break is still the phrase.
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("nothing has changed since");
    expect(flat).toContain("docs/reports/security-2026-08-01.md");
    expect(flat).toContain("no severity tally of its own");
    expect(flat).toContain("secrets and deps ran in full");
    // The shapes that would make it read as a clean full pass.
    expect(flat).not.toMatch(/\d+ file\(s\) changed/);
    expect(flat).not.toContain("NOT looked at:");
    expect(flat).not.toMatch(/0 · 0/);
    expect(flat).not.toMatch(/🚨\s*0/);
  });
});

// ── the two clamps that read a file ─────────────────────────────────────────

describe("ALWAYS_IN_FULL is the skill's own list", () => {
  const skill = readFileSync(SKILL, "utf8");
  // §2 (`code` and its file list) and §3 (`pay` and the money surfaces) — the
  // two sections ALWAYS_IN_FULL is drawn from, and nowhere else in the file.
  const from = skill.indexOf("## 2 · `code`");
  const to = skill.indexOf("## 4 · `secrets`");
  const sections = skill.slice(from, to);

  it("found the sections at all", () => {
    // Non-vacuity: a renamed heading would otherwise make every assertion below
    // pass against an empty string.
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(sections).toContain("proxy.ts");
    expect(sections).toContain("lib/digistore/");
  });

  it("🚨 names every path of it verbatim, so the two cannot drift", () => {
    const paths = ALWAYS_IN_FULL.flatMap((entry) => entry.paths);
    const missing = paths.filter((path) => !sections.includes(path));
    expect(
      missing,
      `in ALWAYS_IN_FULL and not in security-gateway §2/§3: ${missing.join(", ")} — ` +
        `a rule only one of them knows`,
    ).toEqual([]);
  });

  it("keeps every area non-empty and every path a real shape", () => {
    expect(ALWAYS_IN_FULL.length).toBeGreaterThan(0);
    for (const entry of ALWAYS_IN_FULL) {
      expect(entry.area.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(20);
      expect(entry.paths.length).toBeGreaterThan(0);
      for (const path of entry.paths) expect(path).not.toMatch(/^\/|\\/);
    }
  });
});

describe("every git listing asks for `-z`", () => {
  // 🚨 The one failure mode with no visible symptom: with `core.quotepath` at its
  // default, `git diff --name-only` returns `"lib/kurs-\303\274bung.ts"` for any
  // path outside ASCII — quoted and escaped. Split on newlines it parses, so
  // nothing errors; the file simply is not in the scope. A smaller scope that
  // looks like a cleaner app, which is the whole subject of this file.
  //
  // Read through `blankComments()` (CLAUDE.md → Rules), or this file's own header
  // — which explains the flag at length — would satisfy the guard on its own.
  const source = blankComments(readFileSync(join(HERE, "scope.mjs"), "utf8"));
  const calls = [...source.matchAll(/gitZ\(\s*\[([^\]]*)\]/g)].map((match) => match[1]);

  it("found the listings at all", () => {
    // The needle: a regex that matches nothing passes the assertion below over
    // every file in the tree.
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it("🚨 passes -z to each of them", () => {
    const without = calls.filter((args) => !/["']-z["']/.test(args));
    expect(without, `a git listing with no -z: ${without.join(" | ")}`).toEqual([]);
  });

  it("takes the base from a commit, never from a date range", () => {
    // `--since` and `--before` disagree by a day at the boundary, always towards
    // a later base and a smaller scope.
    expect(source).toContain("rev-list");
    expect(source).not.toContain("--since=");
  });
});
