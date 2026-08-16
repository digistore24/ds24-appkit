// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The invisible-character rules, and the two halves a scanner needs.
//
//  1. **Each needle fires.** Every rule is planted and found, with its line
//     number and its severity. 🚨 A scan whose needle cannot occur passes over
//     every file in the tree while reading none of it, and reports success —
//     `source-text.test.ts` records what that cost once already.
//  2. **This template's own tree stays silent.** The walk below reads the real
//     files off disk and asserts zero findings, with a count guard so that a
//     walk which found nothing to read fails instead of passing. That is the
//     half that keeps the rung usable: a rule which fires on a pristine app is
//     one every operator learns to scroll past, and then the real finding
//     scrolls past with it.
//
// ⚠️ **Pure.** `vitest.config.ts` puts every `.test.ts` under `template/` inside
// `make check`, and `security-check` must never become a gate. Nothing here
// spawns, fetches or starts anything: it builds strings and it reads files.
//
// 🚨 Every invisible character below is built with `String.fromCharCode` /
// `fromCodePoint` and never typed as a literal — the same rule the rules file
// keeps, for the same reason. A fixture nobody can see in a diff is a fixture
// nobody can review, and this file would otherwise be found by its own subject.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankCommentsFor } from "../lib/source-text.mjs";
import {
  INVISIBLE_RULES,
  invisibleRuleFor,
  isGuidanceFile,
  isTestFile,
  scanInvisible,
} from "./invisible.mjs";
import { findingFrom, invisible } from "./rungs/invisible.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(HERE, "..", "..");

// ── the characters, built rather than typed ────────────────────────────────

/** Three Unicode tag characters — "ign", invisible. */
const TAG = String.fromCodePoint(0xe0069, 0xe0067, 0xe006e);
/** U+1F3F4, the base a subdivision-flag emoji hangs its tag letters off. */
const FLAG = String.fromCodePoint(0x1f3f4);
const RLO = String.fromCharCode(0x202e); // right-to-left override
const LRI = String.fromCharCode(0x2066); // left-to-right isolate
const ZWSP = String.fromCharCode(0x200b); // zero width space
const ZWJ = String.fromCharCode(0x200d); // zero width joiner
const ZWNJ = String.fromCharCode(0x200c); // zero width non-joiner
const BOM = String.fromCharCode(0xfeff);

/** Scan one string as though it were the file at `at`. */
function scan(text: string, at: string) {
  return scanInvisible(text, blankCommentsFor(at, text), { path: at });
}

// ── 1 · every needle fires ─────────────────────────────────────────────────

describe("🚨 every rule finds its own character", () => {
  it("finds a Unicode tag character in code", () => {
    const rows = scan(`const a = 1;\nconst b = "x${TAG}";\n`, "lib/x.ts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: "tag-chars", line: 2, count: 3, severity: "critical" });
  });

  it("finds a bidirectional override in code", () => {
    const rows = scan(`const host = "a${RLO}b";\n`, "lib/x.ts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: "bidi", line: 1, severity: "high" });
  });

  it("counts an isolate as bidi too — it is the modern form of the same trick", () => {
    expect(scan(`const a = "x${LRI}y";\n`, "lib/x.ts")[0]?.ruleId).toBe("bidi");
  });

  it("finds a run of three zero-width characters", () => {
    const rows = scan(`const a = "${ZWSP}${ZWJ}${ZWNJ}";\n`, "lib/x.ts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: "zero-width-run", count: 3, severity: "high" });
  });

  it("finds a single zero-width space", () => {
    const rows = scan(`const a = "x${ZWSP}y";\n`, "lib/x.ts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ruleId: "zero-width", severity: "medium" });
  });

  it("reports a run ONCE, not once plus once per character", () => {
    // Without the claim the run makes on its own offsets, three zero-width
    // spaces would answer the run rule once and the single rule three times —
    // four findings for one paste, and the reader learns to scroll.
    const rows = scan(`const a = "${ZWSP}${ZWSP}${ZWSP}";\n`, "lib/x.ts");
    expect(rows.map((row) => row.ruleId)).toEqual(["zero-width-run"]);
  });

  it("reports a byte-order mark that is not at the start of the file", () => {
    expect(scan(`const a = 1;\nconst b = "${BOM}";\n`, "lib/x.ts")[0]).toMatchObject({
      ruleId: "zero-width",
      line: 2,
    });
  });

  it("gives every rule a line number that points at the right line", () => {
    const rows = scan(`one\ntwo\nthree${RLO}\nfour\n`, "docs/a.md");
    expect(rows[0]?.line).toBe(3);
  });
});

// ── 2 · what it deliberately leaves alone ──────────────────────────────────

describe("what it leaves alone, and why", () => {
  it("says nothing about a subdivision-flag emoji", () => {
    // U+1F3F4 followed by tag letters IS the flag. Treating the tag block as
    // forbidden outright would report every such emoji in a message file.
    expect(scan(`const flag = "${FLAG}${TAG}";\n`, "lib/x.ts")).toEqual([]);
  });

  it("says nothing about a byte-order mark at offset 0 — that is the encoding", () => {
    expect(scan(`${BOM}const a = 1;\n`, "lib/x.ts")).toEqual([]);
  });

  it("says nothing about a single joiner — that is how an emoji is composed", () => {
    expect(scan(`const a = "x${ZWJ}y";\n`, "lib/x.ts")).toEqual([]);
    expect(scan(`const a = "x${ZWNJ}y";\n`, "lib/x.ts")).toEqual([]);
  });

  it("says nothing about a bidi control inside a code COMMENT", () => {
    // Two files in this template carry one in a comment to illustrate the
    // attack they describe. Reporting a file for explaining itself is the
    // failure `blankComments()` exists to prevent.
    expect(scan(`// renders as a${RLO}b\nconst a = 1;\n`, "lib/x.ts")).toEqual([]);
  });

  it("says nothing about a zero-width character inside a test file", () => {
    // Three test files in this template plant these characters because
    // rejecting them is what they assert.
    expect(scan(`it("x", () => "${ZWSP}");\n`, "lib/x.test.ts")).toEqual([]);
  });

  it("🚨 still reports a TAG character in a comment and in a test", () => {
    // The exclusions above are what keeps the rung quiet; this is what keeps
    // them from being a hole somebody can aim at. Nothing in a source tree has
    // a legitimate reason to carry a tag character.
    const inComment = scan(`// harmless${TAG}\nconst a = 1;\n`, "lib/x.ts");
    expect(inComment).toHaveLength(1);
    expect(inComment[0]).toMatchObject({ ruleId: "tag-chars", inComment: true, severity: "high" });

    const inTest = scan(`it("x", () => "${TAG}");\n`, "lib/x.test.ts");
    expect(inTest.map((row) => row.ruleId)).toEqual(["tag-chars"]);
  });

  it("leaves an ordinary file alone", () => {
    expect(scan("const a = 1;\n// a comment\n", "lib/x.ts")).toEqual([]);
    expect(scan("# A heading\n\nOrdinary prose.\n", "docs/a.md")).toEqual([]);
  });
});

// ── 3 · the surface decides the severity ───────────────────────────────────

describe("a file an agent reads as instruction is rated one step worse", () => {
  it.each([
    ["CLAUDE.md", true],
    ["AGENTS.md", true],
    ["README.md", true],
    ["docs/cron.md", true],
    [".claude/skills/coach/SKILL.md", true],
    [".agents/skills/coach/SKILL.md", true],
    ["content/knowledge/a.md", true],
    ["lib/roles.ts", false],
    ["app/page.tsx", false],
    ["messages/de.json", false],
    ["scripts/x.mjs", false],
  ])("%s → guidance: %s", (file, expected) => {
    expect(isGuidanceFile(file as string)).toBe(expected);
  });

  it("rates a bidi control CRITICAL in guidance and HIGH in code", () => {
    expect(scan(`text a${RLO}b\n`, "docs/a.md")[0]?.severity).toBe("critical");
    expect(scan(`const a = "a${RLO}b";\n`, "lib/x.ts")[0]?.severity).toBe("high");
  });

  it("rates a zero-width character HIGH in guidance and MEDIUM in code", () => {
    expect(scan(`text a${ZWSP}b\n`, "CLAUDE.md")[0]?.severity).toBe("high");
    expect(scan(`const a = "a${ZWSP}b";\n`, "lib/x.ts")[0]?.severity).toBe("medium");
  });

  it("rates a tag character CRITICAL on both — it has no innocent form", () => {
    expect(scan(`text${TAG}\n`, "docs/a.md")[0]?.severity).toBe("critical");
    expect(scan(`const a = "${TAG}";\n`, "lib/x.ts")[0]?.severity).toBe("critical");
  });

  it.each([
    ["x.test.ts", true],
    ["x.test.tsx", true],
    ["x.test.mjs", true],
    ["a/b/x.test.js", true],
    ["x.ts", false],
    ["testing.ts", false],
  ])("%s → test file: %s", (file, expected) => {
    expect(isTestFile(file as string)).toBe(expected);
  });
});

// ── 4 · this template's own tree stays silent ──────────────────────────────

/** Directories a walk of this app has no business entering. */
const OFF_LIMITS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".data",
  ".dev",
  "coverage",
  "dist",
  "build",
]);

/** Every file of the app tree, as repository-relative paths with forward slashes. */
function walk(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (OFF_LIMITS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walk(path.join(dir, entry.name), rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

describe("🚨 the shipped tree answers nothing", () => {
  const files = walk(APP_ROOT);

  it("read enough of the tree for the assertion below to mean anything", () => {
    // Non-vacuity. A walk that found nothing passes an emptiness assertion in
    // full, and would keep passing for ever after somebody moved a folder.
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("CLAUDE.md");
    expect(files).toContain("lib/roles.ts");
    expect(files.some((file) => file.startsWith(".claude/skills/"))).toBe(true);
  });

  it("finds no invisible character in any file this app ships", () => {
    const found: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        if (statSync(path.join(APP_ROOT, file)).size > 512 * 1024) continue;
        const bytes = readFileSync(path.join(APP_ROOT, file));
        if (bytes.subarray(0, 8 * 1024).includes(0)) continue;
        text = bytes.toString("utf8");
      } catch {
        continue;
      }
      for (const row of scanInvisible(text, blankCommentsFor(file, text), { path: file })) {
        found.push(`${file}:${row.line} ${row.ruleId}`);
      }
    }
    expect(
      found,
      "A file this template ships carries a character that renders as nothing. If it is " +
        "deliberate — a test planting what a sanitiser rejects, a comment illustrating the " +
        "attack — it belongs in a file class this rule already leaves alone. If it is not, " +
        "it is the finding.",
    ).toEqual([]);
  });
});

// ── 5 · the finding a person reads ─────────────────────────────────────────

describe("the finding", () => {
  const rows = scan(`a${RLO}b\nc${RLO}d\n`, "lib/x.ts");
  const finding = findingFrom("lib/x.ts", "bidi", rows);

  it("groups one file's answers to one rule into ONE finding", () => {
    expect(rows).toHaveLength(2);
    expect(finding.where).toBe("lib/x.ts:1");
    expect(finding.evidence).toContain("2 character(s)");
    expect(finding.evidence).toContain("line 1, 2");
  });

  it("names the codepoints rather than quoting the line", () => {
    // A quoted line would print as though it were empty — the codepoint is the
    // only part of this a person can act on.
    expect(finding.evidence).toContain("U+202A");
    expect(finding.evidence).toContain("render as");
  });

  it("gives an id that survives an edit moving the line", () => {
    expect(finding.id).toBe("invisible:bidi:lib/x.ts");
    expect(findingFrom("lib/x.ts", "bidi", scan(`\n\na${RLO}b\n`, "lib/x.ts")).id).toBe(finding.id);
  });

  it("takes the worst severity when one file answers on several lines", () => {
    expect(finding.severity).toBe("high");
  });

  it("says in the WHY that a guidance file is acted on rather than displayed", () => {
    const guidance = findingFrom("docs/a.md", "bidi", scan(`a${RLO}b\n`, "docs/a.md"));
    expect(guidance.why).toContain("INSTRUCTION");
    expect(guidance.severity).toBe("critical");
    expect(finding.why).not.toContain("INSTRUCTION");
  });

  it("carries the four lines every finding in this template carries", () => {
    for (const field of ["severity", "title", "where", "why", "fix", "evidence", "source"]) {
      expect(String((finding as Record<string, unknown>)[field] ?? "").trim()).not.toBe("");
    }
  });
});

// ── 6 · the rules table and the rung's declaration ─────────────────────────

describe("the rules table", () => {
  it("gives every rule an id, a label, its codepoints, a why and a fix", () => {
    expect(INVISIBLE_RULES.length).toBeGreaterThanOrEqual(4);
    for (const rule of INVISIBLE_RULES) {
      expect(rule.id.trim()).not.toBe("");
      expect(rule.label.trim()).not.toBe("");
      expect(rule.codepoints).toMatch(/U\+/);
      expect(rule.why.length).toBeGreaterThan(40);
      expect(rule.fix.length).toBeGreaterThan(40);
      expect(["critical", "high", "medium", "low"]).toContain(rule.severity.guidance);
      expect(["critical", "high", "medium", "low"]).toContain(rule.severity.code);
    }
  });

  it("scans comments and tests for exactly one rule — the one with no innocent form", () => {
    expect(INVISIBLE_RULES.filter((rule) => rule.everywhere).map((rule) => rule.id)).toEqual([
      "tag-chars",
    ]);
  });

  it("answers a lookup for an unknown rule with null rather than throwing", () => {
    expect(invisibleRuleFor("nope")).toBeNull();
  });
});

describe("the rung's declaration", () => {
  it("is tier 1 — it installs nothing, needs no account and asks no network", () => {
    expect(invisible.tier).toBe(1);
    expect(invisible.id).toBe("invisible-text");
  });

  it("says what it WOULD have checked, not what it is called", () => {
    expect(invisible.covers.trim().toLowerCase()).not.toBe(invisible.label.trim().toLowerCase());
    // 🚨 The blind spot is named in the sentence a skip prints, not left to be
    // discovered: what a scan of the working tree cannot see is what somebody
    // sends the app at runtime.
    expect(invisible.covers).toContain("runtime");
  });
});
