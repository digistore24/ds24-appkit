// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two things are checked here, and the second is the one that decays.
//
//   1. the rule itself — what a name turns into, including the four ways a
//      naive implementation gets it wrong (a lone surrogate, a script with no
//      case, a locale-dependent uppercase, an uppercase that grows)
//   2. that there is still exactly ONE implementation of it in the tree
//
// Nothing renders the mark (`vitest.config.ts` is `environment: "node"`), so
// the second half is what stops a second copy appearing beside the first. A
// rule with two callers is extracted once and a third copy refused by a test —
// otherwise the next reader finds two answers to "what is the mark" and only
// one of them ever gets the fix.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { initialsFrom } from "@/lib/initials";

const ROOT = process.cwd();

describe("initialsFrom", () => {
  it.each([
    ["two words — the monogram case", "Kraft Werk", "KW"],
    ["one word — one letter, never an abbreviation", "Kraftwerk", "K"],
    ["the shipped default app name", "Your App", "YA"],
    ["a dotted address local part", "anna.mueller", "AM"],
    ["an underscore", "kraft_werk", "KW"],
    ["a hyphen", "kraft-werk", "KW"],
    ["three words — the first two", "Deutsch Amerikanische Freundschaft", "DA"],
    ["the empty string", "", ""],
    ["separators only", "  ...  ", ""],
    ["a non-Latin first character", "Ärzte", "Ä"],
    ["a script with no case at all", "日本語", "日"],
  ])("%s: %j -> %j", (_case, input, expected) => {
    expect(initialsFrom(input)).toBe(expected);
  });

  it("🚨 keeps an astral first character whole", () => {
    // "𝕏".slice(0, 1) and "𝕏"[0] are both a lone high surrogate, which renders
    // as U+FFFD. This is the assertion that fails if anybody indexes a string.
    expect(initialsFrom("𝕏Corp")).toBe("𝕏");
    expect(initialsFrom("𝕏 Corp")).toBe("𝕏C");
  });

  it("would catch a return to indexing — the naive answer differs", () => {
    // Non-vacuity for the case above: proves the input really does separate the
    // two implementations rather than agreeing with both.
    expect("𝕏Corp".slice(0, 1).toUpperCase()).not.toBe(initialsFrom("𝕏Corp"));
    expect([..."𝕏Corp".slice(0, 1)]).toHaveLength(1);
    expect("𝕏Corp".slice(0, 1)).not.toBe("𝕏");
  });

  it("gives each word exactly one character, even when uppercasing grows it", () => {
    // "ß".toUpperCase() is "SS" — two characters out of one letter would make a
    // three-character monogram out of a two-word name.
    expect(initialsFrom("ßeta")).toBe("S");
    expect(initialsFrom("ßeta Werk")).toBe("SW");
    expect([...initialsFrom("ßeta Werk")]).toHaveLength(2);
  });

  it("does not depend on the machine's locale", () => {
    // toLocaleUpperCase("tr") turns "i" into "İ". The mark must read the same
    // on all three systems, so the locale-aware form is deliberately not used.
    expect(initialsFrom("istanbul")).toBe("I");
    expect(initialsFrom("istanbul")).not.toBe("i".toLocaleUpperCase("tr"));
  });

  it("never returns more than two characters", () => {
    for (const name of ["a b c d e", "𝕏 𝕏 𝕏", "ß ß ß", "Kraft Werk Gmbh"]) {
      expect([...initialsFrom(name)].length, name).toBeLessThanOrEqual(2);
    }
  });
});

describe("there is one implementation of the rule", () => {
  /** The word split. A second literal of it is a second opinion. */
  const NEEDLE = /\[\\s\._-\]/;

  /** Files that legitimately hold it. */
  const OWNER = "lib/initials.ts";

  const SEARCHED = [
    "components/app-shell.tsx",
    "components/brand-mark.tsx",
    "components/public-header.tsx",
  ];

  it("🚨 is not copied into either caller", () => {
    const hits = SEARCHED.filter((file) =>
      NEEDLE.test(blankComments(readFileSync(join(ROOT, file), "utf8"))),
    );
    expect(
      hits,
      `These files split a name into words themselves:\n` +
        hits.map((f) => `  ${f}`).join("\n") +
        `\nImport initialsFrom() from @/${OWNER} instead — two copies of this ` +
        `rule are two answers to "what is the mark", and only one of them gets ` +
        `fixed the next time somebody meets a surrogate pair.`,
    ).toEqual([]);
  });

  it("would see a copy if there were one", () => {
    // The needle probe: without it, a regex that silently matches nothing would
    // leave the assertion above green for ever.
    expect(NEEDLE.test(blankComments(readFileSync(join(ROOT, OWNER), "utf8")))).toBe(
      true,
    );
  });

  it("does not count a comment that quotes the rule", () => {
    expect(blankComments("// splits on /[\\s._-]+/\nconst x = 1;")).not.toMatch(
      NEEDLE,
    );
  });

  it("🚨 both callers reach for the shared function", () => {
    for (const file of ["components/app-shell.tsx", "components/brand-mark.tsx"]) {
      expect(
        blankComments(readFileSync(join(ROOT, file), "utf8")),
        file,
      ).toContain("initialsFrom");
    }
  });
});
