// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading a colour out of somebody else's stylesheet.
//
// Every form a real site uses, converted to one form this app can hold:
// `hsl(H S% L%)`, space-separated, which is the ONLY thing `parseHsl()` in
// `scripts/ux/rules.mjs` reads. A value that cannot make that round trip is
// refused rather than proposed — a token nothing can parse is a token nothing
// checks.
//
// 🚨 `oklch()` is not optional here. Tailwind v4 and current shadcn ship oklch
// palettes, so a modern site's stylesheet would otherwise be entirely
// unreadable — the command would report "no colours found" with total
// confidence about the sites most likely to be handed to it.
//
// What deliberately comes back `null`, to be COUNTED and reported rather than
// skipped in silence: `color-mix()`, `currentColor`, `inherit`, `lab()`,
// `lch()`, `oklab()`, `color(display-p3 …)` and `hsl(var(--h) …)`. All of them
// are composed at run time or in a colour space this file does not carry, and
// guessing at one is worse than saying it could not be read.

import { hslToRgb } from "../ux/rules.mjs";

/** The three named colours worth recognising. Everything else is a guess. */
const NAMED = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  transparent: null,
};

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** `deg` | `turn` | `rad` | bare → degrees. */
function toDegrees(raw) {
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return null;
  if (/turn\s*$/.test(raw)) return value * 360;
  if (/rad\s*$/.test(raw)) return (value * 180) / Math.PI;
  return value;
}

/** `50%` → 0.5; `0.5` → 0.5; `128` with `scale` 255 → 0.502. */
function toUnit(raw, scale = 1) {
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return null;
  return /%\s*$/.test(raw) ? value / 100 : value / scale;
}

/** Split `a, b, c` or `a b c` — with an optional `/ alpha` tail dropped. */
function parts(inner) {
  return inner
    .split("/")[0]
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

// ── oklch ────────────────────────────────────────────────────────────────────
//
// The matrices are the CSS Color 4 definition, verified against its own worked
// example: oklch(0.628 0.2577 29.23) is exactly sRGB 255,0,0.

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const gamma = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055;

/**
 * oklch → sRGB, with the chroma reduced until every channel is in gamut.
 *
 * ⚠️ Reduced by binary search rather than clipped per channel, and that is not
 * fussiness: Tailwind v4 uses P3 colours on purpose, so out-of-gamut values are
 * the NORMAL case in the stylesheets this reads. Per-channel clipping shifts
 * the hue — a vivid red clips to a slightly orange red — and the hue is the one
 * thing a brand actually owns.
 */
export function oklchToRgb(L, C, hDeg) {
  const rad = (hDeg * Math.PI) / 180;
  const inGamut = (chroma) => {
    const linear = oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
    return linear.every((c) => c >= -0.0001 && c <= 1.0001);
  };

  let chroma = C;
  if (!inGamut(chroma)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }

  const linear = oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
  return linear.map((c) => Math.round(clamp(gamma(clamp(c, 0, 1)), 0, 1) * 255));
}

/**
 * Any CSS colour literal → `[r, g, b]` 0–255, or `null` when it cannot be read.
 *
 * @param {string} value
 * @returns {[number, number, number] | null}
 */
export function parseColorLiteral(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;

  if (raw in NAMED) return NAMED[raw];

  // #rgb, #rgba, #rrggbb, #rrggbbaa — the alpha is read and discarded.
  const hex = /^#([0-9a-f]{3,8})$/.exec(raw);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b] = [...digits.slice(0, 3)].map((d) => parseInt(d + d, 16));
      return [r, g, b];
    }
    if (digits.length === 6 || digits.length === 8) {
      return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    }
    return null;
  }

  const fn = /^([a-z]+)\((.*)\)$/s.exec(raw);
  if (!fn) return null;
  const [, name, inner] = fn;

  // A `var()` anywhere means the value is composed at run time. Refuse it —
  // resolving it here would need the whole cascade.
  if (inner.includes("var(") || inner.includes("calc(")) return null;

  const p = parts(inner);

  if (name === "rgb" || name === "rgba") {
    if (p.length < 3) return null;
    const channels = p.slice(0, 3).map((c) => toUnit(c, 1));
    if (channels.some((c) => c === null)) return null;
    // `rgb(50% 20% 0%)` arrives as fractions, `rgb(128 51 0)` as 0–255.
    const percent = p.slice(0, 3).every((c) => /%\s*$/.test(c));
    return channels.map((c) =>
      clamp(Math.round(percent ? c * 255 : c), 0, 255),
    );
  }

  if (name === "hsl" || name === "hsla") {
    if (p.length < 3) return null;
    const h = toDegrees(p[0]);
    const s = toUnit(p[1]);
    const l = toUnit(p[2]);
    if (h === null || s === null || l === null) return null;
    return hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
  }

  if (name === "oklch") {
    if (p.length < 3) return null;
    const L = toUnit(p[0]);
    const C = parseFloat(p[1]);
    const h = toDegrees(p[2]);
    if (L === null || Number.isNaN(C) || h === null) return null;
    return oklchToRgb(clamp(L, 0, 1), Math.max(0, C), h);
  }

  // lab, lch, oklab, color(), color-mix, light-dark — deliberately unread.
  return null;
}

/** `[r, g, b]` → `{ h: 0–360, s: 0–1, l: 0–1 }`. */
export function rgbToHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return { h, s, l };
}

/**
 * `{ h, s, l }` → the ONE string form `app/globals.css` accepts.
 *
 * Rounded to whole numbers, which is what the shipped file already uses and
 * what a person editing it afterwards can hold in their head.
 */
export function toHslToken({ h, s, l }) {
  const hue = Math.round(((h % 360) + 360) % 360);
  return `hsl(${hue} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}%)`;
}

/** `[r, g, b]` → the same token form, via HSL. */
export function rgbToHslToken(rgb) {
  return toHslToken(rgbToHsl(rgb));
}
