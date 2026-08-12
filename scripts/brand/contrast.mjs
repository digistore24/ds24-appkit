// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// Making somebody's brand colour usable as this app's accent — or refusing to.
//
// A brand colour is chosen to look good on a poster. `--primary` here has to be
// a BUTTON (with text on it) and a WORD (a link, the active menu item) at the
// same time, in light and in dark. A light mint fails white text; a deep navy
// vanishes on the dark background. Writing the extracted value in unchanged
// would produce an app that fails `ux-check` on the first run — which is the
// same as producing an app somebody with weak eyesight cannot read.
//
// So the command adjusts, and the shape of the adjustment is the whole design:
//
//   **Hue and saturation are frozen. Only the lightness moves.**
//
// Moving the hue is "we changed your colour" and no customer accepts it.
// Moving the lightness is "we made your colour readable", which is a sentence
// they do accept — and it is the sentence the report prints. Saturation is
// touched only when no lightness works at all, and then it is reported as a
// second, larger concession rather than folded in quietly.
//
// 🚨 The pairs it has to satisfy are DERIVED from `scripts/ux/rules.mjs`
// (`pairsTouching`), never retyped. The day somebody adds a pair involving
// `primary` to that file, this starts enforcing it in the same commit — instead
// of proposing a colour that `ux-check` then rejects, which is the failure mode
// of every second implementation of one rule.

import { contrastRatio, hslToRgb, pairsTouching, parseHsl } from "../ux/rules.mjs";

/** The tokens a brand colour is allowed to set. Nothing else, ever. */
export const WRITABLE = ["primary", "primary-foreground", "ring"];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** The pairs that mention any writable token, computed once. */
const RELEVANT = [
  ...new Map(
    ["primary", "primary-foreground", "ring"]
      .flatMap((token) => pairsTouching(token))
      .map((pair) => [`${pair.fg}/${pair.bg}/${pair.min}`, pair]),
  ).values(),
];

/**
 * The two candidate values for `--primary-foreground`.
 *
 * That token is OURS, not the brand's — it is what sits ON their colour — so
 * this is free to choose. Both candidates carry the brand hue at reduced
 * saturation rather than being plain white and black: it is what the shipped
 * file already does (`hsl(191 70% 9%)` on the dark accent), and a near-white
 * tinted with the brand reads as considered where `#fff` reads as default.
 */
function foregroundCandidates(h, s) {
  return [
    { h, s: Math.min(s, 0.2), l: 0.97 },
    { h, s: Math.min(s, 0.55), l: 0.13 },
  ];
}

/** Build the token map a candidate implies, on top of the mode's real tokens. */
function withCandidate(tokens, primary, foreground) {
  return {
    ...tokens,
    primary: `hsl(${Math.round(primary.h)} ${Math.round(primary.s * 100)}% ${Math.round(primary.l * 100)}%)`,
    "primary-foreground": `hsl(${Math.round(foreground.h)} ${Math.round(foreground.s * 100)}% ${Math.round(foreground.l * 100)}%)`,
    ring: `hsl(${Math.round(primary.h)} ${Math.round(primary.s * 100)}% ${Math.round(primary.l * 100)}%)`,
  };
}

/** Every relevant pair's real ratio for a candidate token map. */
function measure(map) {
  const out = [];
  for (const { fg, bg, min } of RELEVANT) {
    const a = parseHsl(map[fg] ?? "");
    const b = parseHsl(map[bg] ?? "");
    // A token this mode does not declare (a module's, a typo) is not this
    // command's problem to diagnose — `ux-check` reports it as unreadable.
    if (!a || !b) continue;
    out.push({ fg, bg, min, ratio: contrastRatio(a, b) });
  }
  return out;
}

const passes = (ratios) => ratios.every((r) => r.ratio >= r.min);

/**
 * Lightness offsets to try, smallest change first, ties resolved towards the
 * direction the mode naturally wants.
 *
 * `app/globals.css` prescribes it in its own header: the accent is dark in
 * light mode (light text on it) and light in dark mode. So when +3 and −3 both
 * work, light mode takes the darker one.
 */
function offsets(mode) {
  const out = [0];
  const first = mode === "dark" ? 1 : -1;
  for (let step = 1; step <= 100; step++) {
    out.push(first * step, -first * step);
  }
  return out;
}

/**
 * @typedef {{ h: number, s: number, l: number }} Hsl
 * @typedef {{ fg: string, bg: string, min: number, ratio: number }} Ratio
 *
 * @typedef {{
 *   ok: false,
 *   reason: string,
 *   worst: Ratio | null,
 * }} Refused
 *
 * @typedef {{
 *   ok: true,
 *   mode: "light" | "dark",
 *   shift: "unchanged" | "nudged" | "moved" | "far",
 *   lightnessShift: number,
 *   primary: Hsl,
 *   foreground: Hsl,
 *   ring: Hsl,
 *   lightnessFrom: number,
 *   lightnessTo: number,
 *   saturationFrom: number,
 *   saturationTo: number,
 *   changed: boolean,
 *   ratios: Ratio[],
 *   forcedBy: Ratio | null,
 * }} Adjusted
 */

/**
 * A brand colour, made usable as this mode's accent — or refused.
 *
 * A discriminated union rather than one shape with nulls: every caller has to
 * deal with the refusal, and `if (!result.ok)` is what makes the rest of the
 * fields safe to read. The CLI depends on that, and so does the test.
 *
 * @param {Hsl} brandHsl the extracted colour
 * @param {"light"|"dark"} mode
 * @param {Record<string,string>} tokens that mode's block from `parseTokens()`
 * @returns {Adjusted | Refused}
 */
export function adjustAccent(brandHsl, mode, tokens) {
  const { h } = brandHsl;
  const startL = clamp01(brandHsl.l);

  const attempt = (s) => {
    for (const offset of offsets(mode)) {
      const l = startL + offset / 100;
      if (l < 0.02 || l > 0.98) continue;
      const primary = { h, s, l };
      for (const foreground of foregroundCandidates(h, s)) {
        const map = withCandidate(tokens, primary, foreground);
        const ratios = measure(map);
        if (ratios.length && passes(ratios)) {
          return { primary, foreground, ratios, map };
        }
      }
    }
    return null;
  };

  // 1. Lightness only. This is the answer in almost every real case.
  let saturation = clamp01(brandHsl.s);
  let hit = attempt(saturation);
  let saturationFrom = saturation;

  // 2. Only if nothing worked: relax the saturation, in 5-point steps, never
  //    below a fifth of what they gave us. The real case is a light saturated
  //    yellow, where no lightness makes it readable as a WORD while still
  //    being yellow.
  if (!hit) {
    for (let s = saturation - 0.05; s >= saturation * 0.2; s -= 0.05) {
      hit = attempt(clamp01(s));
      if (hit) {
        saturation = clamp01(s);
        break;
      }
    }
  }

  if (!hit) {
    // 3. Refuse, and name the pair that could not be satisfied — the report
    //    turns this into "keep it for surfaces; the accent needs a colour that
    //    can carry text", which names the next move instead of just saying no.
    const worst = measure(
      withCandidate(
        tokens,
        { h, s: saturation, l: startL },
        foregroundCandidates(h, saturation)[0],
      ),
    )
      .filter((r) => r.ratio < r.min)
      .sort((a, b) => a.ratio - b.ratio)[0];
    return {
      ok: /** @type {false} */ (false),
      reason: worst
        ? `${worst.fg} on ${worst.bg} cannot reach ${worst.min}:1 at this hue`
        : "no candidate satisfied the contrast pairs",
      worst: worst ?? null,
    };
  }

  const before = measure(
    withCandidate(
      tokens,
      { h, s: clamp01(brandHsl.s), l: startL },
      foregroundCandidates(h, clamp01(brandHsl.s))[0],
    ),
  );

  const lightnessShift = Math.abs(
    Math.round(startL * 100) - Math.round(hit.primary.l * 100),
  );

  return {
    ok: /** @type {true} */ (true),
    mode,
    /**
     * How big the concession really was — so the report can be honest about it.
     *
     * 🚨 This exists because the search will always find SOMETHING, and a
     * result presented as "we nudged your colour" when it moved fifty-four
     * points is a lie with a passing contrast check behind it. Measured: a
     * brand mint at 85 % lightness comes out at 31 % — same hue, and nobody
     * would call it the same colour. At `far` the report has to say so and
     * offer the honest alternative (keep the brand tone for surfaces, let the
     * accent be a deeper relative of it), rather than reporting a success.
     */
    shift:
      lightnessShift === 0 ? "unchanged" : lightnessShift <= 10 ? "nudged" : lightnessShift <= 25 ? "moved" : "far",
    lightnessShift,
    primary: hit.primary,
    foreground: hit.foreground,
    ring: hit.primary,
    lightnessFrom: Math.round(startL * 100),
    lightnessTo: Math.round(hit.primary.l * 100),
    saturationFrom: Math.round(saturationFrom * 100),
    saturationTo: Math.round(saturation * 100),
    changed:
      Math.round(startL * 100) !== Math.round(hit.primary.l * 100) ||
      Math.round(saturationFrom * 100) !== Math.round(saturation * 100),
    ratios: hit.ratios,
    /** The tightest pair BEFORE the adjustment — the "why", in one number. */
    forcedBy: before.filter((r) => r.ratio < r.min).sort((a, b) => a.ratio - b.ratio)[0] ?? null,
  };
}

/** `[r,g,b]` for a candidate, for callers that want to print a hex. */
export function candidateRgb({ h, s, l }) {
  return hslToRgb(h, s, l);
}
