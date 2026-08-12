// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `security-gateway` §9 tells the reader to read two shipped commands for
// EXACT strings, because the two questions it asks cannot be answered any other
// way:
//
//   * `node run.mjs smoke` prints its success line whether or not it managed to
//     sign in — the discriminator is the clause `, N of them signed in`, and a
//     run that could not sign in says `N protected page(s) NOT checked` and
//     still exits 0. So the pass reads a CLAUSE, not an exit code.
//   * `node run.mjs errors` separates "I found something" (exit 1) from "I could
//     not look" (exit 2). Collapsing the two is exactly the confusion the fix
//     pass exists to prevent.
//
// Quoted strings rot. A rename in `smoke.mjs` leaves the skill telling an agent
// to look for a clause nothing prints any more — and the agent then reads its
// absence as the refusal it is documented to be, which turns a green run into a
// permanent "not proven". Nothing else in this repo compares the two.
//
// ⚠️ **This file is pure on purpose.** `vitest.config.ts` includes
// `**/*.test.ts`, so anything here runs inside every `npm run test` — and
// nothing about `security-check` or this pass may become a gate. Nothing below
// touches the network or spawns a process; it reads four files and compares
// text.
//
// 🚨 The code side is read through `blankComments()`. A marker that survives
// only in a comment is not the behaviour the pass tells the reader to look for,
// and the needle at the bottom of this file proves that blanking really happens
// rather than merely being called.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "../lib/source-text.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** The two shipped scripts, with their comments blanked — behaviour only. */
const SMOKE = blankComments(readFileSync(join(ROOT, "scripts/dev/smoke.mjs"), "utf8"));
const ERRORS = blankComments(readFileSync(join(ROOT, "scripts/dev/log-errors.mjs"), "utf8"));

/**
 * The skill's fix-pass text: §9 of SKILL.md plus the reference file that holds
 * its mechanics. Either may carry a marker — what matters is that a reader
 * following the pass meets it.
 */
const SKILL = readFileSync(
  join(ROOT, ".claude/skills/security-gateway/SKILL.md"),
  "utf8",
);
const FIX_PASS = readFileSync(
  join(ROOT, ".claude/skills/security-gateway/references/fix-pass.md"),
  "utf8",
);
const SECTION_9 = SKILL.slice(SKILL.indexOf("## 9 · `fix`"), SKILL.indexOf("## 10 · `since`"));
const PASS_TEXT = `${SECTION_9}\n${FIX_PASS}`;

/** The whole comparison, in one place, so the needle below can use it too. */
const occurs = (haystack: string, needle: string) => haystack.includes(needle);

// The clause `smoke` prints only when the second pass really ran.
const SIGNED_IN = "of them signed in";
// The line it prints instead when it could not sign in — exit 0, and not a pass.
const NOT_CHECKED = "protected page(s) NOT checked";

describe("the fix pass quotes strings the shipped commands really print", () => {
  it("found all four files at all", () => {
    // Non-vacuity: a moved file or a renamed heading would otherwise make every
    // assertion below pass against an empty string.
    expect(SMOKE.length).toBeGreaterThan(1000);
    expect(ERRORS.length).toBeGreaterThan(1000);
    expect(SECTION_9.length).toBeGreaterThan(500);
    expect(FIX_PASS.length).toBeGreaterThan(1000);
    expect(SECTION_9).toContain("`fix` — fixing what was found");
  });

  it("🚨 smoke still prints the clause the pass reads as its proof", () => {
    expect(
      occurs(SMOKE, SIGNED_IN),
      `scripts/dev/smoke.mjs no longer prints "${SIGNED_IN}" — security-gateway §9 ` +
        `tells the agent that clause IS the proof the second pass ran, so its ` +
        `absence would be read as a refusal for ever`,
    ).toBe(true);
  });

  it("🚨 smoke still prints the refusal the pass reads as 'could not look'", () => {
    expect(
      occurs(SMOKE, NOT_CHECKED),
      `scripts/dev/smoke.mjs no longer prints "${NOT_CHECKED}" — that line is how ` +
        `an operator learns the protected pages were never rendered`,
    ).toBe(true);
  });

  it("🚨 errors still distinguishes exit 1 from exit 2", () => {
    // 1 is "I found something", 2 is "I could not look". The fix pass rules that
    // a 2 is never a pass, so both have to exist as behaviour, not as prose.
    expect(occurs(ERRORS, "process.exitCode = 1")).toBe(true);
    expect(
      occurs(ERRORS, "process.exitCode = 2"),
      "scripts/dev/log-errors.mjs no longer exits 2 — 'I found something' and " +
        "'I could not look' would have become the same answer",
    ).toBe(true);
    expect(occurs(ERRORS, "Could not look")).toBe(true);
  });

  it("🚨 the pass quotes both smoke markers verbatim", () => {
    for (const marker of [SIGNED_IN, NOT_CHECKED]) {
      expect(
        occurs(PASS_TEXT, marker),
        `security-gateway §9 / references/fix-pass.md no longer quotes ` +
          `"${marker}" — the pass would be telling the reader to judge smoke by ` +
          `something it does not name`,
      ).toBe(true);
    }
  });

  it("🚨 the pass names both exit codes of `errors`", () => {
    expect(occurs(PASS_TEXT, "exit 1")).toBe(true);
    expect(
      occurs(PASS_TEXT, "exit 2"),
      "the fix pass no longer names exit 2 — 'could not look' is the outcome " +
        "this whole check exists to keep apart from a pass",
    ).toBe(true);
  });
});

// ── the needles ─────────────────────────────────────────────────────────────
//
// Every assertion above is a `.includes()` over text. Two ways for this file to
// go quietly vacuous, and both have happened elsewhere in this repo:
// the comparison stops comparing (then it finds everything), or `blankComments()`
// stops blanking (then a marker surviving only in a comment satisfies a
// presence assertion about BEHAVIOUR).
//
// A guard whose probe cannot fire is worse than no guard: it reports success.

describe("🚨 the clamp can fail", () => {
  it("does not find a string that is deliberately in none of the four files", () => {
    const ABSENT = "of them signed in on a Tuesday";
    for (const [name, text] of [
      ["smoke.mjs", SMOKE],
      ["log-errors.mjs", ERRORS],
      ["the fix pass", PASS_TEXT],
    ] as const) {
      expect(occurs(text, ABSENT), `${name} matched a fixture that cannot be there`).toBe(false);
    }
  });

  it("🚨 reads the code with its comments blanked, and proves it", () => {
    const source = readFileSync(join(ROOT, "scripts/dev/smoke.mjs"), "utf8");
    // This string occurs in `smoke.mjs` exactly once, inside the comment
    // explaining the dangling import that once killed the whole sweep. It is
    // therefore the probe: raw source has it, blanked source must not — and if
    // it ever moves into real code, this assertion says so rather than rotting.
    const COMMENT_ONLY = "ERR_MODULE_NOT_FOUND";
    expect(
      occurs(source, COMMENT_ONLY),
      `"${COMMENT_ONLY}" is no longer in scripts/dev/smoke.mjs at all — pick ` +
        `another comment-only probe, do not delete this test`,
    ).toBe(true);
    expect(
      occurs(SMOKE, COMMENT_ONLY),
      "blankComments() did not blank a comment — every presence assertion above " +
        "would now be satisfiable by prose instead of by behaviour",
    ).toBe(false);
  });
});
