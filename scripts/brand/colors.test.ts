// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every colour form a real stylesheet uses, and the one form this app can hold.
import { describe, expect, it } from "vitest";

import { parseHsl } from "@/scripts/ux/rules.mjs";
import { oklchToRgb, parseColorLiteral, rgbToHsl, rgbToHslToken, toHslToken } from "./colors.mjs";

describe("parseColorLiteral", () => {
  it.each([
    ["#fff", [255, 255, 255]],
    ["#FFF", [255, 255, 255]],
    ["#2e5aac", [46, 90, 172]],
    ["#2E5AACFF", [46, 90, 172]],
    ["#f00c", [255, 0, 0]],
    ["rgb(46, 90, 172)", [46, 90, 172]],
    ["rgb(46 90 172)", [46, 90, 172]],
    ["rgba(46, 90, 172, 0.5)", [46, 90, 172]],
    ["rgb(100% 0% 0%)", [255, 0, 0]],
    ["hsl(219, 58%, 43%)", [46, 90, 173]],
    ["hsl(219 58% 43%)", [46, 90, 173]],
    ["hsl(0.608turn 58% 43%)", [46, 90, 173]],
    ["white", [255, 255, 255]],
    ["black", [0, 0, 0]],
  ])("reads %s", (input, expected) => {
    const rgb = parseColorLiteral(input);
    expect(rgb).not.toBeNull();
    for (const [i, channel] of expected.entries()) {
      expect(Math.abs((rgb as number[])[i] - channel)).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    ["color-mix(in srgb, red 50%, blue)"],
    ["currentColor"],
    ["inherit"],
    ["lab(50% 40 59)"],
    ["oklab(0.4 0.1 0.1)"],
    ["color(display-p3 1 0 0)"],
    ["hsl(var(--h) 50% 50%)"],
    ["transparent"],
    ["not-a-colour"],
  ])("refuses %s rather than guessing", (input) => {
    expect(parseColorLiteral(input)).toBeNull();
  });
});

describe("oklch", () => {
  it("matches the CSS Color 4 worked example for red", () => {
    // oklch(0.628 0.2577 29.23) is defined to be sRGB red.
    const [r, g, b] = oklchToRgb(0.628, 0.2577, 29.23);
    expect(r).toBe(255);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("reads the form Tailwind v4 and shadcn actually ship", () => {
    const rgb = parseColorLiteral("oklch(0.51 0.23 277)");
    expect(rgb).not.toBeNull();
    // An indigo: blue clearly dominant.
    expect((rgb as number[])[2]).toBeGreaterThan((rgb as number[])[0]);
  });

  it("reduces chroma instead of clipping a channel", () => {
    // Out of gamut on purpose (P3 territory). Clipping per channel would shift
    // the hue; reduction keeps it. Measured by comparing the hue back.
    const rgb = parseColorLiteral("oklch(0.7 0.4 150)") as number[];
    expect(rgb).not.toBeNull();
    expect(rgb.every((c) => c >= 0 && c <= 255)).toBe(true);
    const { h } = rgbToHsl(rgb as [number, number, number]);
    expect(Math.abs(h - 145)).toBeLessThan(25);
  });
});

describe("the round trip that keeps a token checkable", () => {
  it("🚨 every colour it reads comes back out in the one form parseHsl accepts", () => {
    // A token `parseHsl` cannot read is a token `ux-check` reports as
    // "cannot be read" — so a value that does not survive this trip must never
    // be proposed. Checked over a spread rather than a handful.
    for (let r = 0; r < 256; r += 37) {
      for (let g = 0; g < 256; g += 43) {
        for (let b = 0; b < 256; b += 53) {
          const token = rgbToHslToken([r, g, b]);
          const back = parseHsl(token);
          expect(back, token).not.toBeNull();
          for (const [i, channel] of [r, g, b].entries()) {
            // Rounding to whole degrees and percents costs a couple of levels.
            expect(Math.abs((back as number[])[i] - channel), token).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it("writes the space-separated form and nothing else", () => {
    expect(toHslToken({ h: 190, s: 0.9, l: 0.26 })).toBe("hsl(190 90% 26%)");
    expect(toHslToken({ h: -10, s: 2, l: -1 })).toBe("hsl(350 100% 0%)");
  });
});
