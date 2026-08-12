// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which of the colours in a stylesheet is the BRAND?
//
// A real sheet holds dozens. The grey used for body text appears two hundred
// times and is not the brand; the colour on `.btn:hover` appears eleven times
// and is. So frequency is deliberately the weakest signal here and the name of
// a custom property is the strongest — `--brand`, `--primary`, `--cta` survive
// minification, mean what they say, and are what a designer actually wrote.
//
// **What this gets wrong, and the command SAYS so rather than only documenting
// it here:**
//
//  1. A brand that lives only in a background image, an SVG data URI or a
//     gradient stop is invisible. The link blue wins instead.
//  2. A COMPILED utility sheet (Tailwind, Bootstrap output) contains every
//     palette colour exactly once, so frequency means nothing at all. Detected,
//     reported, and the ranking falls back to name signals only.
//  3. `color-mix()`, `currentColor` and `hsl(var(--h) …)` are composed at run
//     time. Counted and reported as unread, never guessed at.
//  4. Two accents (a blue and a "CTA orange") both rank; the report shows both
//     and the skill asks which.

import { blankCssComments, modeAt, selectorAt } from "./css-text.mjs";
import { parseColorLiteral, rgbToHsl } from "./colors.mjs";

/** Properties whose value is a colour worth looking at. */
const COLOR_PROPERTIES =
  /(^|[;{\s])(--[a-z0-9-]+|color|background|background-color|border-color|border|outline-color|fill|stroke|box-shadow|accent-color)\s*:\s*([^;}]+)/gi;

/** A selector somebody clicks. An accent is what you click. */
const INTERACTIVE =
  /(^|[\s,>+~])(a|button)([\s.:,[]|$)|\.btn|\.button|\.cta|:hover|:focus|:focus-visible|\[type=["']?submit|\.primary|\.action/i;

/** Custom-property names that mean "this is the brand". */
const BRAND_NAME = /(^|-)(brand|primary|accent|main|cta|action|theme|highlight)(-|$)/i;

/** Below this saturation a colour is a neutral and can never be the accent. */
const MIN_SATURATION = 0.15;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.92;

/** A sheet with this many single-declaration rules is compiled output. */
const COMPILED_RULE_COUNT = 500;

const key = ([r, g, b]) => `${r},${g},${b}`;

/**
 * Rank the colours in a stylesheet.
 *
 * @param {string} css
 * @param {{ themeColor?: string | null }} [opts]
 */
export function extractBrandColors(css, opts = {}) {
  const text = blankCssComments(css);

  /** @type {Map<string, any>} */
  const groups = new Map();
  /** @type {Map<string, number>} */
  const unread = new Map();
  let declarations = 0;

  for (const m of text.matchAll(COLOR_PROPERTIES)) {
    const property = m[2].toLowerCase();
    const value = m[3].trim();
    declarations++;

    // A declaration can hold several colours (`border: 1px solid #abc`,
    // `box-shadow: 0 0 0 2px #abc`). Take every literal in it.
    const literals = value.match(
      /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|\b(?:white|black|currentColor|transparent|inherit)\b/g,
    );
    if (!literals) continue;

    for (const literal of literals) {
      const rgb = parseColorLiteral(literal);
      if (!rgb) {
        unread.set(literal.toLowerCase(), (unread.get(literal.toLowerCase()) ?? 0) + 1);
        continue;
      }
      const id = key(rgb);
      const selector = selectorAt(text, m.index ?? 0);
      const mode = modeAt(text, m.index ?? 0);
      const group =
        groups.get(id) ??
        { rgb, count: 0, names: new Set(), selectors: new Set(), modes: new Set() };
      group.count++;
      if (property.startsWith("--")) group.names.add(property);
      if (selector) group.selectors.add(selector.slice(0, 80));
      group.modes.add(mode);
      // The property this colour was used AS, which decides its weight.
      group[`as_${property.startsWith("--") ? "var" : property}`] = true;
      group.interactive = group.interactive || INTERACTIVE.test(selector);
      group.print = group.print || /@media\s+print/.test(text.slice(Math.max(0, (m.index ?? 0) - 400), m.index ?? 0));
      groups.set(id, group);
    }
  }

  // Compiled utility sheets: every palette colour appears once, so frequency is
  // noise. Two independent tells, either is enough.
  const compiled =
    text.includes("--tw-") ||
    (text.match(/\{[^{}]{0,60}\}/g) ?? []).length > COMPILED_RULE_COUNT;

  const themeRgb = opts.themeColor ? parseColorLiteral(opts.themeColor) : null;

  const scored = [...groups.values()].map((group) => {
    const hsl = rgbToHsl(group.rgb);
    const neutral =
      hsl.s < MIN_SATURATION || hsl.l < MIN_LIGHTNESS || hsl.l > MAX_LIGHTNESS;

    let score = 0;
    const why = [];
    if ([...group.names].some((n) => BRAND_NAME.test(n))) {
      score += 3;
      why.push("named like a brand colour");
    }
    if (themeRgb && key(themeRgb) === key(group.rgb)) {
      score += 3;
      why.push("the site's own theme-color");
    }
    if (group.interactive && (group.as_background || group.as_background_color)) {
      score += 2;
      why.push("a background on something you click");
    } else if (group.interactive) {
      score += 1;
      why.push("used on something you click");
    }
    if (!compiled) score += Math.log2(1 + group.count) / 2;
    // Body text: something used on nearly everything is not an accent.
    if (declarations > 20 && group.count / declarations > 0.4) {
      score -= 2;
      why.push("used almost everywhere — that is body text, not a brand");
    }
    if (group.print) score -= 2;

    return {
      rgb: group.rgb,
      hsl,
      count: group.count,
      names: [...group.names],
      selectors: [...group.selectors].slice(0, 3),
      modes: [...group.modes],
      neutral,
      score: neutral ? -Infinity : score,
      why,
    };
  });

  const accents = scored
    .filter((c) => !c.neutral)
    .sort((a, b) => b.score - a.score);
  const neutrals = scored.filter((c) => c.neutral).sort((a, b) => b.count - a.count);

  return {
    accents,
    neutrals,
    unread: [...unread.entries()].map(([value, count]) => ({ value, count })),
    compiled,
    declarations,
  };
}

/**
 * The dark twin of an accent, if the sheet declared one.
 *
 * A site with a dark theme has already solved "what does this colour look like
 * on a dark background", and its designer solved it better than an algorithm
 * will. Matching is by hue rather than by value — the twin IS a different
 * value, that is the point — within 12 degrees.
 */
export function darkTwinOf(accent, all) {
  return (
    all
      .filter((c) => c.modes.includes("dark") && !c.neutral)
      .filter((c) => {
        const d = Math.abs(c.hsl.h - accent.hsl.h);
        return Math.min(d, 360 - d) <= 12;
      })
      // 🚨 A dark-mode ACCENT is light — `app/globals.css` says so in its own
      // header ("light accent with dark text on it"), and it is the rule that
      // makes this filter more than a guess. Without it the nearest hue match
      // in a dark block is routinely the dark BACKGROUND: measured on a real
      // fixture, `#2e5aac` picked up `#111827` (hue 220, lightness 11 %) as its
      // twin, which would have written the page's own background into
      // `--primary` and produced an invisible button.
      .filter((c) => c.hsl.l >= 0.35)
      .sort((a, b) => b.score - a.score)[0] ?? null
  );
}
