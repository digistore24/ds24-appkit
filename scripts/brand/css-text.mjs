// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading somebody else's stylesheet as text, without a CSS parser.
//
// 🚨 **This does NOT use `blankComments()` from `scripts/lib/source-text.mjs`,
// and that is a measurement rather than a preference.** That function blanks
// `//` to end of line, which is right for JS and TS and catastrophic for CSS:
// a real stylesheet is routinely minified onto ONE line and routinely contains
// `url(//cdn.example.com/…)` and base64 payloads with `//` in them. Measured,
// and pinned as an assertion in `css-text.test.ts`:
//
//   IN : .a{background:url(//cdn.example.com/bg.png)}.btn{background:#2e5aac}
//   OUT: .a{background:url(
//
// — the brand colour gone, and the extractor would report "no colours found"
// with total confidence about most of the sheets it is handed.
//
// `CLAUDE.md` forbids a second comment-blanking REGEX under `scripts/`, and
// `scripts/lib/source-text.test.ts` enforces it. This is an `indexOf` walk with
// no regex at all — a different mechanism for a different language, not a
// seventeenth copy of the same one.

/** CSS block comments blanked to spaces. Same length, same offsets. */
export function blankCssComments(css) {
  let out = css;
  let from = 0;
  for (;;) {
    const start = out.indexOf("/*", from);
    if (start === -1) break;
    const close = out.indexOf("*/", start + 2);
    const end = close === -1 ? out.length : close + 2;
    // Blanked, never removed: every offset after this point has to stay put or
    // `selectorAt()` would report the wrong rule.
    out = out.slice(0, start) + " ".repeat(end - start) + out.slice(end);
    from = end;
  }
  return out;
}

/**
 * The selector text of the rule enclosing `index`, or `""`.
 *
 * Walks back to the nearest unmatched `{`, then back again to the previous
 * `}`, `;` or the start of the file. That is the whole "no CSS parser" trick,
 * and it is enough for RANKING — nested CSS yields `&:hover`, which is exactly
 * the signal wanted.
 */
export function selectorAt(css, index) {
  let depth = 0;
  let open = -1;
  for (let i = index; i >= 0; i--) {
    const ch = css[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open === -1) return "";

  let start = 0;
  for (let i = open - 1; i >= 0; i--) {
    if (css[i] === "}" || css[i] === "{" || css[i] === ";") {
      start = i + 1;
      break;
    }
  }
  return css.slice(start, open).trim().replace(/\s+/g, " ");
}

/** Dark-mode spellings a real stylesheet uses. */
const DARK = [
  "prefers-color-scheme: dark",
  "prefers-color-scheme:dark",
  ".dark",
  "[data-theme='dark']",
  '[data-theme="dark"]',
  "[data-theme=dark]",
  "[data-mode='dark']",
  '[data-mode="dark"]',
];

/**
 * Which mode the rule at `index` belongs to.
 *
 * ⚠️ Worth more than it looks. A site with a dark theme hands us the DARK TWIN
 * of its own brand colour, already chosen by its designer for a dark
 * background — which is a far better starting point for `--primary` in `.dark`
 * than anything this command could derive.
 */
export function modeAt(css, index) {
  const before = css.slice(0, index);
  // The nearest enclosing context wins: search backwards for whichever marker
  // appears last before this point.
  let best = -1;
  for (const marker of DARK) {
    const at = before.lastIndexOf(marker);
    if (at > best) best = at;
  }
  if (best === -1) return "light";

  // Still inside that block? Count braces since the marker.
  //
  // ⚠️ "depth > 0 at the end" is NOT the test, and getting that wrong is the
  // bug this comment exists for: in
  // `@media (…dark){a{color:#000}}b{color:#fff}` the `#fff` sits in a rule of
  // its own, so the depth is 1 again and the naive check calls it dark. What
  // matters is whether the dark block ever CLOSED before we got here.
  const since = css.slice(best, index);
  let depth = 0;
  let opened = false;
  for (const ch of since) {
    if (ch === "{") {
      depth++;
      opened = true;
    } else if (ch === "}") {
      depth--;
      if (opened && depth <= 0) return "light";
    }
  }
  return opened && depth > 0 ? "dark" : "light";
}
