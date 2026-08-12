// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The initials of the words in a string — one letter per word, at most two.
//
// Two callers, one rule. `components/brand-mark.tsx` derives the app's monogram
// from `APP_NAME`; `components/app-shell.tsx` derives a person's avatar letters
// from their name or the local part of their address. The word rule is the same
// rule and lives here once; what stays with the avatar is its FALLBACK, for a
// name made of nothing but separators.
//
// 🚨 Never index a string to get its first character. Both `"X"[0]` and
// `"X".slice(0, 1)` return a lone high surrogate when the first character sits
// outside the basic plane, and a lone surrogate renders as the replacement
// character — an app name is whatever somebody typed into
// `NEXT_PUBLIC_APP_NAME`, and mathematical letterforms and emoji in product
// names are ordinary. Iterate code points instead.
//
// `toUpperCase()` and never `toLocaleUpperCase()`: the locale-aware one turns a
// Turkish `i` into a dotted capital, so the mark would read differently
// depending on the machine's locale — and this template runs on three systems.
// Uppercasing can also GROW a string (`"ß"` becomes `"SS"`), which is why the
// first code point of the UPPERCASED letter is taken rather than the uppercased
// first code point: a word contributes exactly one character, always.

/** Words are separated by whitespace, a dot, an underscore or a hyphen. */
const SEPARATORS = /[\s._-]+/;

/** The first character of `word`, uppercased — exactly one code point, or "". */
function initialOf(word: string): string {
  const first = [...word][0];
  if (first === undefined) return "";
  return [...first.toUpperCase()][0] ?? "";
}

/**
 * The initials of the first two words in `source`, uppercased.
 *
 * `"Kraft Werk"` → `"KW"`, `"Kraftwerk"` → `"K"`, `"anna.mueller"` → `"AM"`,
 * `""` → `""`.
 *
 * One letter per WORD is what a monogram is. Two letters out of ONE word is an
 * abbreviation — `"Kraftwerk"` as `"KR"` reads like a ticker symbol rather than
 * a mark — so a single-word name gets a single letter and stops there.
 */
export function initialsFrom(source: string): string {
  return source
    .split(SEPARATORS)
    .filter(Boolean)
    .slice(0, 2)
    .map(initialOf)
    .join("");
}
