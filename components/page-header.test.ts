// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `<PageHeader>` is in every app built on this template, and nothing in this
// repository has ever rendered it: `vitest.config.ts` is `environment: "node"`,
// so there is no DOM, no screenshot and no component test anywhere. That is a
// decision, not a gap — but it means the three things that CAN go wrong here
// silently would go wrong silently for ever. So they are asserted against the
// SOURCE, which is what this repo does instead (components/brand-mark.test.ts,
// app/login/dialog-guard.test.ts, lib/setup/guard-presence.test.ts).
//
// The three:
//
//   1. a sentence written into the component. Every visible word in this app
//      comes from `messages/{de,en}.json` through `t(…)`, and `i18n/messages.
//      test.ts` fails the build on a key that exists in one language only — a
//      literal here escapes that entirely, because there is no key.
//   2. a `font-…` FAMILY class. The heading face is one rule in `@layer base`
//      in app/globals.css; a family named here is a second type system, and
//      Story 43.2's own criterion is that the rule lives in one place.
//   3. an eyebrow that renders an empty element when nobody passed one — which
//      would put a blank line above every heading in the app and is exactly the
//      failure `docs/modules.md` documents for empty slots.
//
// 🚨 Every scan goes through `blankComments()` and never a regex of its own.
// This file and page-header.tsx are both FULL of the things they hunt for: the
// paragraph you are reading contains the words `font-heading` and a sentence in
// quotes. A checker that greps source punishes the file that explains itself —
// `scripts/lib/source-text.mjs` carries the measured post-mortem, and
// `scripts/lib/source-text.test.ts` refuses a seventeenth local copy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();
const FILE = "components/page-header.tsx";

const source = blankComments(readFileSync(join(ROOT, FILE), "utf8"));

// ── The checkers, as pure functions over source text ─────────────────────────

/** Import statements blanked — their specifiers are string literals too. */
function blankImports(text: string): string {
  return text.replace(/^import\b[\s\S]*?;$/gm, (m) => " ".repeat(m.length));
}

/**
 * `className=` and its value blanked, braces balanced.
 *
 * Written as a scanner rather than a regex because the value is
 * `{cn("…", className)}` — a regex stopping at the first `}` would leave half
 * a class list behind and report it as a sentence.
 */
function blankClassNames(text: string): string {
  const out = text.split("");
  let i = 0;
  while ((i = text.indexOf("className=", i)) !== -1) {
    let j = i + "className=".length;
    if (text[j] === '"' || text[j] === "'") {
      const quote = text[j];
      const end = text.indexOf(quote, j + 1);
      if (end === -1) break;
      j = end + 1;
    } else if (text[j] === "{") {
      let depth = 0;
      for (; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}" && --depth === 0) {
          j++;
          break;
        }
      }
    }
    for (let k = i; k < j; k++) if (out[k] !== "\n") out[k] = " ";
    i = j;
  }
  return out.join("");
}

/** Where the JSX starts. Everything above it is types and a signature. */
function jsxOf(text: string): string {
  const start = text.indexOf("return (");
  return start === -1 ? "" : text.slice(start);
}

/**
 * Every string literal that is not a class list.
 *
 * A literal reaching this is either a sentence or a value somebody meant to put
 * in `messages/`; both are findings, and the message says which to look for.
 */
export function strayLiterals(text: string): string[] {
  const stripped = blankClassNames(blankImports(text));
  const found = [...stripped.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)];
  return found.map((m) => m[0]).filter((s) => /[A-Za-zÄÖÜäöüß]/.test(s));
}

/**
 * JSX text — letters sitting directly between a tag and a tag.
 *
 * The character class excludes `{` and `}` on purpose: `>{title}<` is an
 * EXPRESSION and must not match, while `>Users<` must. Only the JSX region is
 * scanned, so a TypeScript generic above it cannot be mistaken for a tag pair.
 */
export function jsxText(text: string): string[] {
  return [...jsxOf(text).matchAll(/>([^<>{}]*[A-Za-zÄÖÜäöüß][^<>{}]*)</g)].map(
    (m) => m[1].trim(),
  );
}

/**
 * Every `font-…` class that names a FAMILY.
 *
 * Weights (`font-medium`, `font-semibold`) are not this dial and are allowed —
 * `scripts/ux/rules.mjs` makes the same distinction and says why.
 */
export function fontFamilyClasses(text: string): string[] {
  return [
    ...text.matchAll(/(?<![\w-])font-(?:sans|mono|serif|heading|\[[^\]\s]*\])/g),
  ].map((m) => m[0]);
}

/** Is the eyebrow behind a guard, so that absent means nothing is rendered? */
export function eyebrowIsGuarded(text: string): boolean {
  const jsx = jsxOf(text);
  const guard = jsx.indexOf("{eyebrow && (");
  const uses = [...jsx.matchAll(/\{eyebrow\}/g)];
  return guard !== -1 && uses.length === 1 && (uses[0].index ?? -1) > guard;
}

// ── The needle probes ────────────────────────────────────────────────────────
//
// Each checker is a `.match()` over text, and a matcher that matches nothing
// passes over every file in the tree by finding nothing. So each one is fired
// at a fixture that DOES carry the defect before it is trusted on the real
// file. `scripts/lib/source-text.test.ts:188` is where this repo learned that
// the hard way: a needle no source text could contain reported success for
// sixteen files.

describe("🚨 the needles can be found at all", () => {
  it("finds a sentence written into a component", () => {
    const needle = `return (\n<div className={cn("mb-8 flex", className)}>\n<p title="Who may do what.">x</p>\n</div>\n);`;
    expect(strayLiterals(needle)).toContain('"Who may do what."');
    // …and the class list it sits beside is NOT reported.
    expect(strayLiterals(needle)).not.toContain('"mb-8 flex"');
  });

  it("finds JSX text, and does not mistake an expression for it", () => {
    expect(jsxText("return (\n<h1>Users</h1>\n);")).toEqual(["Users"]);
    expect(jsxText("return (\n<h1>{title}</h1>\n);")).toEqual([]);
  });

  it("finds a family class, and lets a weight through", () => {
    expect(fontFamilyClasses('"truncate font-heading"')).toEqual([
      "font-heading",
    ]);
    expect(fontFamilyClasses('"font-[Playfair]"')).toEqual(["font-[Playfair]"]);
    expect(fontFamilyClasses('"font-semibold font-medium"')).toEqual([]);
  });

  it("finds an eyebrow that renders whether or not it was given", () => {
    expect(eyebrowIsGuarded("return (\n<p>{eyebrow}</p>\n);")).toBe(false);
    expect(
      eyebrowIsGuarded("return (\n{eyebrow && (\n<p>{eyebrow}</p>\n)}\n);"),
    ).toBe(true);
  });

  it("reads a file with class lists in it — an empty scan is not a pass", () => {
    expect(source.length).toBeGreaterThan(500);
    // The one thing every check below depends on: that `blankComments` left the
    // code standing. If it blanked the file, all four assertions pass on air.
    expect(source).toContain("className");
    expect(source).toContain("<h1");
  });
});

// ── The file itself ──────────────────────────────────────────────────────────

describe("components/page-header.tsx", () => {
  it("carries no sentence — every word in it comes from a prop", () => {
    expect(strayLiterals(source)).toEqual([]);
    expect(jsxText(source)).toEqual([]);
  });

  it("names no font family — the face is app/globals.css's rule", () => {
    expect(fontFamilyClasses(source)).toEqual([]);
  });

  it("renders nothing at all when no eyebrow was given", () => {
    expect(eyebrowIsGuarded(source)).toBe(true);
  });

  it("keeps the two class decisions that have a reason written beside them", () => {
    // `truncate`: a long title must not push the actions off the row.
    expect(source).toContain("truncate");
    // `max-w-2xl text-pretty`: the comment above them in the file explains why,
    // and the pair has been deleted with the line before.
    expect(source).toContain("max-w-2xl");
    expect(source).toContain("text-pretty");
  });

  it("has a baseline and one size step, and every new prop is optional", () => {
    expect(source).toContain("border-b");
    expect(source).toContain("sm:text-3xl");
    // 🚨 This component is in every existing customer app. A required prop is a
    // compile error in code nobody in this repository wrote.
    expect(source).toContain("eyebrow?:");
  });
});
