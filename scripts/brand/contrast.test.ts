// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The test that matters most in this folder.
//
// `node run.mjs brand` writes a colour into `app/globals.css`. If it writes one
// that cannot be read, it has produced an app that fails `ux-check` on the first
// run — which is a polite way of saying an app somebody with weak eyesight
// cannot use. So every case below is a brand colour that is genuinely unusable
// as shipped, and the assertion is not "it returned something" but "every pair
// the real gate measures now passes".
//
// The ratios are computed with `contrastRatio` imported from
// `scripts/ux/rules.mjs` — the same function `ux-check` uses, never a copy. A
// second implementation here could agree with itself and disagree with the gate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RING_PAIRS,
  TEXT_PAIRS,
  contrastRatio,
  parseHsl,
  parseTokens,
  pairsTouching,
} from "@/scripts/ux/rules.mjs";
import { adjustAccent } from "./contrast.mjs";
import { toHslToken } from "./colors.mjs";

const GLOBALS = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
const tokens = parseTokens(readFileSync(GLOBALS, "utf8"));

/** Deliberately unusable brands, plus two controls. */
const BRANDS: [string, { h: number; s: number; l: number }][] = [
  ["a light mint", { h: 150, s: 0.6, l: 0.85 }],
  ["a brand yellow", { h: 52, s: 0.95, l: 0.6 }],
  ["a near-black navy", { h: 220, s: 0.8, l: 0.12 }],
  ["pure red", { h: 0, s: 1, l: 0.5 }],
  ["a pale grey-blue", { h: 210, s: 0.18, l: 0.9 }],
  ["the shipped petrol (control)", { h: 190, s: 0.9, l: 0.26 }],
  ["a real site's blue (control)", { h: 219, s: 0.58, l: 0.43 }],
];

describe.each(BRANDS)("%s", (_name, brand) => {
  for (const mode of ["light", "dark"] as const) {
    describe(mode, () => {
      const result = adjustAccent(brand, mode, tokens[mode]);

      it("comes back usable", () => {
        expect(result.ok, result.ok ? "" : `refused: ${result.reason}`).toBe(true);
      });

      it("🚨 satisfies every pair the real gate measures", () => {
        if (!result.ok) return;
        const map: Record<string, string> = {
          ...tokens[mode],
          primary: toHslToken(result.primary),
          "primary-foreground": toHslToken(result.foreground),
          ring: toHslToken(result.ring),
        };
        const relevant = [
          ...new Map(
            ["primary", "primary-foreground", "ring"]
              .flatMap((t) => pairsTouching(t))
              .map((p) => [`${p.fg}/${p.bg}`, p]),
          ).values(),
        ];
        expect(relevant.length).toBeGreaterThan(0);
        for (const { fg, bg, min } of relevant) {
          const ratio = contrastRatio(parseHsl(map[fg]), parseHsl(map[bg]));
          expect(ratio, `${fg} on ${bg} in ${mode}`).toBeGreaterThanOrEqual(min);
        }
      });

      it("never moves the hue", () => {
        if (!result.ok) return;
        // The whole promise of the report: "we made your colour readable", not
        // "we changed your colour". A moved hue is a different brand.
        expect(Math.round(result.primary.h)).toBe(Math.round(brand.h));
      });

      it("reports a saturation change only when it made one", () => {
        if (!result.ok) return;
        if (result.saturationFrom === result.saturationTo) {
          expect(Math.round(result.primary.s * 100)).toBe(Math.round(brand.s * 100));
        } else {
          expect(result.saturationTo).toBeLessThan(result.saturationFrom);
        }
      });

      it("reports the size of the concession honestly", () => {
        if (!result.ok) return;
        // `shift` is what stops the report calling a 54-point move a nudge.
        const shift = result.lightnessShift;
        const expected =
          shift === 0
            ? "unchanged"
            : shift <= 10
              ? "nudged"
              : shift <= 25
                ? "moved"
                : "far";
        expect(result.shift).toBe(expected);
        expect(result.lightnessTo).toBe(Math.round(result.primary.l * 100));
      });
    });
  }
});

describe("the gate is derived from ux-check's own lists", () => {
  it("🚨 knows about every shipped pair that mentions the accent", () => {
    // Non-vacuity, and the anti-drift claim made checkable: if somebody adds a
    // pair involving `primary` to TEXT_PAIRS, `pairsTouching` returns it and the
    // command starts enforcing it — in the same commit.
    const declared = [...TEXT_PAIRS, ...RING_PAIRS].filter(
      ([fg, bg]) => fg === "primary" || bg === "primary" || fg === "ring" || bg === "ring",
    );
    const known = ["primary", "primary-foreground", "ring"].flatMap((t) => pairsTouching(t));
    expect(declared.length).toBeGreaterThan(0);
    for (const [fg, bg] of declared) {
      expect(known.some((p) => p.fg === fg && p.bg === bg)).toBe(true);
    }
  });
});

describe("a colour that cannot work is refused, not written", () => {
  it("names the pair it could not satisfy", () => {
    // A zero-saturation "brand" pinned to the background's own lightness has no
    // readable form at any lightness the search may use, because the search may
    // not change the hue and there is none.
    const result = adjustAccent({ h: 0, s: 0, l: 1 }, "light", {
      ...tokens.light,
      background: "hsl(0 0% 100%)",
      card: "hsl(0 0% 100%)",
    });
    if (!result.ok) {
      expect(result.reason).toMatch(/cannot reach|satisf/i);
    } else {
      // If it DID find something, that something must still pass — a pass is
      // never wrong here, only a silent failure would be.
      expect(result.ratios.every((r) => r.ratio >= r.min)).toBe(true);
    }
  });
});
