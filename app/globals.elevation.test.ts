// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Elevation, measured — because "you can see it in dark mode" cannot be.
//
// This suite runs `environment: "node"` (vitest.config.ts): there is no DOM, no
// rendering and no screenshot regression anywhere in this repo, so the claim
// this story makes about dark mode is not one a test can look at. What a test
// CAN do is refuse the three shapes the mistake actually takes — a token
// defined in one block only, a dark value copied from the light one, and a dark
// value nudged back towards Tailwind's default alpha, which on a near-black
// page is arithmetically nothing. The eyes stay the judge; this is the floor
// under them.
//
// It reads the real app/globals.css through `parseTokens()` from
// scripts/ux/rules.mjs — never a second parser, so this file and `ux-check` can
// never hold different opinions about where `:root` ends.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blockRange, parseTokens } from "@/scripts/ux/rules.mjs";

const GLOBALS_CSS = fileURLToPath(new URL("./globals.css", import.meta.url));
const css = readFileSync(GLOBALS_CSS, "utf8");

/** The two elevation steps. Role names: above the page, and over it. */
const ELEVATION_TOKENS = ["elevation-raised", "elevation-overlay"] as const;

/**
 * The floor every alpha inside a `.dark` elevation value has to clear.
 *
 * Tailwind's default shadow colour is `rgb(0 0 0 / 0.1)`, and `--background` in
 * dark mode is `hsl(30 8% 6%)` — roughly `rgb(17 15 14)`. Ten per cent of black
 * over that moves one or two values per channel: below the threshold of a
 * screen, which is exactly the defect this story fixes. A floor at TWICE the
 * default is therefore not a quality bar, it is a refusal of one specific
 * non-fix — the copy-with-a-nudge, where somebody raises 0.1 to 0.12 and calls
 * the dark mode handled. What the value should actually BE is settled by
 * looking at it on a Card and on an Input; no number here can do that.
 */
const ALPHA_FLOOR = 0.2;

// ── Reading a shadow value ───────────────────────────────────────────────────

const LENGTH = String.raw`-?\d+(?:\.\d+)?(?:px|rem|em)?`;
/**
 * The one colour form this file uses, alpha required.
 *
 * Same choice `parseHsl()` documents at scripts/ux/rules.mjs:88-93 and
 * `checkContrast()` makes at scripts/ux/check.mjs:190-197: only the
 * space-separated `hsl(H S% L% / A)` form is accepted, and anything else is
 * reported rather than skipped. A token nothing can parse is a token nothing
 * checks.
 */
const HSLA = String.raw`hsl\(\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%\s*\/\s*(\d*\.\d+|\d+)\s*\)`;
const LAYER = new RegExp(`^(?:${LENGTH}\\s+){2,4}${HSLA}$`);

/** `a, b(c, d), e` → `["a", "b(c, d)", "e"]` — commas inside `hsl(…)` are not separators. */
function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/** The layer's alpha, or `null` when this cannot read the layer at all. */
function alphaOf(layer: string): number | null {
  const m = LAYER.exec(layer.replace(/\s+/g, " ").trim());
  return m ? Number(m[1]) : null;
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

// ── The four assertions, as one pure helper over a string ────────────────────

/**
 * Everything wrong with the elevation tokens in `css`, one sentence each.
 *
 * A helper over a STRING rather than over the file, so the doctored cases in
 * the needle probe below need no filesystem. Every finding names the token, so
 * the probe can assert that the RIGHT thing fired rather than that something
 * did.
 */
function elevationProblems(source: string): string[] {
  const { light, dark } = parseTokens(source);
  const problems: string[] = [];

  for (const token of ELEVATION_TOKENS) {
    const inLight = light[token];
    const inDark = dark[token];

    // 1 · Parity. Story 43.3 turns this into a `ux-check` rule over every
    //     token; here it is measured a story early, for these two.
    if (!inLight) problems.push(`--${token} is missing from the :root block`);
    if (!inDark) problems.push(`--${token} is missing from the .dark block`);
    if (!inLight || !inDark) continue;

    // 2 · Not a copy. A near-black shadow on a near-black page is invisible
    //     however far the alpha is pushed, so the dark value is its own value
    //     or it is nothing.
    if (squash(inLight) === squash(inDark)) {
      problems.push(
        `--${token} has the same value in :root and .dark — the dark mode needs its own value, not the light one`,
      );
    }

    for (const layer of splitLayers(inDark)) {
      const alpha = alphaOf(layer);
      // 4 · A value it cannot read is a FAILURE, never a skip (NFR-60).
      if (alpha === null) {
        problems.push(
          `--${token} (.dark) has a part nothing is checking: "${layer}" — expected ` +
            `<lengths> hsl(H S% L% / A), as the rest of app/globals.css uses`,
        );
        continue;
      }
      // 3 · The alpha floor.
      if (alpha < ALPHA_FLOOR) {
        problems.push(
          `--${token} (.dark) carries an alpha of ${alpha} in "${layer}" — at least ` +
            `${ALPHA_FLOOR} is needed to be visible on hsl(30 8% 6%)`,
        );
      }
    }
  }

  return problems;
}

// ── The shipped file ─────────────────────────────────────────────────────────

describe("app/globals.css — elevation", () => {
  const tokens = parseTokens(css);

  it("defines both steps in both blocks", () => {
    // Non-vacuity: an empty problem list below must mean "checked and fine",
    // never "there was nothing there to check".
    for (const token of ELEVATION_TOKENS) {
      expect(tokens.light[token], `--${token} in :root`).toBeTruthy();
      expect(tokens.dark[token], `--${token} in .dark`).toBeTruthy();
    }
  });

  it("has no elevation problem at all", () => {
    expect(elevationProblems(css)).toEqual([]);
  });

  it("maps all seven Tailwind shadow sizes onto the two tokens", () => {
    // AC1's other half: the tokens exist AND the utilities resolve to them.
    // `blockRange()` again rather than a second opinion about where a block
    // ends — a mapping written outside `@theme inline` would resolve once on
    // `:root` and inherit the light value into dark mode.
    const range = blockRange(css, "@theme inline");
    expect(range, "@theme inline block").not.toBeNull();
    const body = css.slice(range!.start, range!.end);

    const expected: Record<string, string> = {
      "2xs": "raised",
      xs: "raised",
      sm: "raised",
      md: "overlay",
      lg: "overlay",
      xl: "overlay",
      "2xl": "overlay",
    };
    for (const [size, step] of Object.entries(expected)) {
      expect(body, `--shadow-${size}`).toContain(
        `--shadow-${size}: var(--elevation-${step});`,
      );
    }
  });

  it("keeps the 'lifted' package unreadable as a token", () => {
    // AC5's trap, measured rather than trusted. `parseTokens()` strips no CSS
    // comments — its matcher is `^\s*--name: value;` over a block's raw body —
    // so a commented-out token written the obvious way inside `:root` would be
    // read as a LIVE token, by `ux-check`'s contrast pass, by the assertions
    // above and by Story 43.3's parity check. Two rules keep that impossible,
    // and both are checked here rather than described.

    // The second set is really in the file, and every one of its value lines
    // starts with `*` instead of `--`.
    expect(css).toContain("*  --elevation-raised:");
    expect(css).toContain("*  --elevation-overlay:");

    // And a line that DOES begin with `--elevation-…` occurs exactly four
    // times: twice in `:root`, twice in `.dark`, nowhere else.
    const declarations = [...css.matchAll(/^[ \t]*--elevation-[a-z-]+:/gm)];
    expect(declarations).toHaveLength(4);

    const root = blockRange(css, ":root");
    const dark = blockRange(css, ".dark");
    expect(root).not.toBeNull();
    expect(dark).not.toBeNull();
    const inside = (at: number) =>
      (at > root!.start && at < root!.end) || (at > dark!.start && at < dark!.end);
    for (const m of declarations) {
      expect(inside(m.index!), `declaration at index ${m.index} is inside a token block`).toBe(true);
    }
  });
});

// ── The needle probe ─────────────────────────────────────────────────────────

describe("🚨 elevationProblems can fire", () => {
  // This repo's own doctrine (scripts/lib/source-text.test.ts:188): "A guard
  // whose probe cannot fire is worse than no guard: it reports success." A
  // helper returning `[]` for every input passes every assertion above, so each
  // of the four findings is produced here on purpose, from a doctored string,
  // and the token's name is asserted in it.

  const LIGHT: Record<string, string> = {
    "elevation-raised": "0 1px 2px 0 hsl(30 15% 12% / 0.06)",
    "elevation-overlay": "0 10px 24px -6px hsl(30 15% 12% / 0.18)",
  };
  const DARK: Record<string, string> = {
    "elevation-raised": "0 1px 2px 0 hsl(0 0% 0% / 0.55)",
    "elevation-overlay": "0 16px 40px -10px hsl(0 0% 0% / 0.8)",
  };

  const cssFrom = (light: Record<string, string>, dark: Record<string, string>) => {
    const block = (selector: string, set: Record<string, string>) =>
      `${selector} {\n${Object.entries(set)
        .map(([name, value]) => `  --${name}: ${value};`)
        .join("\n")}\n}\n`;
    return `${block(":root", light)}\n${block(".dark", dark)}`;
  };

  it("says nothing about a healthy pair — so each finding below is attributable", () => {
    expect(elevationProblems(cssFrom(LIGHT, DARK))).toEqual([]);
  });

  it("1 · fires on a token defined in one block only", () => {
    const { "elevation-overlay": _gone, ...missing } = DARK;
    const problems = elevationProblems(cssFrom(LIGHT, missing));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--elevation-overlay");
    expect(problems[0]).toContain(".dark");
  });

  it("2 · fires on the light value copied across", () => {
    const copied = { ...DARK, "elevation-raised": LIGHT["elevation-raised"] };
    const problems = elevationProblems(cssFrom(LIGHT, copied));
    // The copy itself, plus the alpha it brought with it — both about that one
    // token, and both true.
    expect(problems.join(" | ")).toContain("--elevation-raised");
    expect(problems.some((p) => p.includes("same value in :root and .dark"))).toBe(true);
    expect(problems.every((p) => p.includes("--elevation-raised"))).toBe(true);
  });

  it("3 · fires on a dark value at Tailwind's default alpha", () => {
    const nudged = { ...DARK, "elevation-overlay": "0 16px 40px -10px hsl(0 0% 0% / 0.1)" };
    const problems = elevationProblems(cssFrom(LIGHT, nudged));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--elevation-overlay");
    expect(problems[0]).toContain("0.1");
  });

  it("4 · fires on a dark value it cannot read — never a skip", () => {
    const unreadable = { ...DARK, "elevation-raised": "0 1px 2px 0 rgb(0 0 0 / 0.55)" };
    const problems = elevationProblems(cssFrom(LIGHT, unreadable));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--elevation-raised");
    expect(problems[0]).toContain("nothing is checking");
  });

  it("4b · a second unreadable form, to prove the reader is strict rather than lucky", () => {
    // A value that LOOKS right and has no alpha at all: `hsl(0 0% 0%)` would be
    // an opaque black shadow, and an alpha reader that returned 1 for it would
    // wave through the one value that cannot possibly be what was meant.
    const noAlpha = { ...DARK, "elevation-overlay": "0 16px 40px -10px hsl(0 0% 0%)" };
    const problems = elevationProblems(cssFrom(LIGHT, noAlpha));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--elevation-overlay");
    expect(problems[0]).toContain("nothing is checking");
  });
});
