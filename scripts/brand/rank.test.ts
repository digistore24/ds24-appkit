// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Picking the BRAND out of a stylesheet full of colours.
//
// The fixtures are the two shapes a real site actually comes in: one somebody
// wrote by hand, and one a build tool emitted. They rank by opposite rules, and
// the second is the one that silently produces nonsense if nobody notices it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { darkTwinOf, extractBrandColors } from "./rank.mjs";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}.css`, import.meta.url)), "utf8");

const hex = ([r, g, b]: number[]) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

describe("a hand-written site sheet", () => {
  const result = extractBrandColors(fixture("handwritten"));

  it("picks the colour NAMED like a brand over the one used most", () => {
    // The grey appears far more often — it is body text, not a brand.
    expect(hex(result.accents[0].rgb)).toBe("#2e5aac");
    expect(result.accents[0].names).toContain("--brand-blue");
  });

  it("reports the second accent rather than hiding it", () => {
    // A site with a blue and a "CTA orange" has two, and which is the brand is
    // a question for the person, not for a heuristic.
    expect(hex(result.accents[1].rgb)).toBe("#f26430");
  });

  it("never lets a grey win", () => {
    for (const neutral of result.neutrals) {
      expect(result.accents).not.toContain(neutral);
    }
    expect(result.neutrals.some((c) => hex(c.rgb) === "#6b7280")).toBe(true);
  });

  it("🚨 finds the site's own dark twin, not its dark background", () => {
    // The bug this pins: the nearest hue match inside a dark block is routinely
    // the page background (#111827 here, hue 221 — twelve degrees from the
    // accent). Writing that into --primary produces an invisible button.
    const twin = darkTwinOf(result.accents[0], [...result.accents, ...result.neutrals]);
    expect(twin).not.toBeNull();
    expect(hex(twin!.rgb)).toBe("#7aa5f0");
  });
});

describe("a minified sheet", () => {
  const result = extractBrandColors(fixture("minified"));

  it("🚨 still finds the brand colour", () => {
    // The whole reason `blankCssComments` exists — see css-text.test.ts.
    expect(hex(result.accents[0].rgb)).toBe("#2e5aac");
  });
});

describe("a compiled utility sheet", () => {
  // Tailwind or Bootstrap output: every palette colour appears exactly once, so
  // frequency carries no signal at all. Silently ranking by it would produce a
  // confident, arbitrary answer — the worst kind.
  const css = `:root{--tw-ring-color:#000}${Array.from(
    { length: 600 },
    (_, i) => `.text-c${i}{color:#${(i * 7919).toString(16).padStart(6, "0").slice(0, 6)}}`,
  ).join("")}.btn{background:#2e5aac}`;
  const result = extractBrandColors(css);

  it("says so rather than pretending", () => {
    expect(result.compiled).toBe(true);
  });
});

describe("what it cannot read is counted, never guessed", () => {
  const result = extractBrandColors(
    ":root{--a:color-mix(in srgb,red,blue);--b:currentColor;--c:lab(50% 40 59)}",
  );

  it("reports each unread value with its count", () => {
    expect(result.unread.length).toBeGreaterThan(0);
    expect(result.unread.map((u) => u.value).join(" ")).toMatch(/color-mix|currentcolor|lab/);
  });
});

describe("nonsense in, nothing out — never a throw", () => {
  it.each([[""], ["not css at all"], ["\u0000\u0001\u0002"], ["{{{{"], ["/* unterminated"]])(
    "survives %j",
    (css) => {
      expect(() => extractBrandColors(css)).not.toThrow();
      expect(extractBrandColors(css).accents).toEqual([]);
    },
  );
});
