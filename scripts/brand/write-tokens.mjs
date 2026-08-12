// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rewriting three token lines in `app/globals.css`, in place, without touching
// anything else.
//
// That file is mostly load-bearing PROSE: the header explains why the accent
// inverts between modes, why `--primary` is a surface and a text colour at
// once, why the `*` rule sits inside `@layer base`. A writer that reformats it,
// or appends a second `--primary`, is a writer that costs more than it saves.
//
// So: the anchor is STRUCTURAL, not textual (`blockRange()` from
// `scripts/ux/rules.mjs` — the same function `parseTokens()` uses, so reader
// and writer can never disagree about where `:root` ends), only the VALUE of a
// matched line changes, a name that is not found is a refusal rather than an
// append, and nothing is written until the result has been parsed back and
// compared token by token.

import { blockRange, parseTokens } from "../ux/rules.mjs";

/**
 * The only token names this command may write.
 *
 * 🚨 `background`, `card` and `foreground` are absent on purpose.
 * `lib/pwa/manifest.test.ts` holds `PWA_BACKGROUND_COLOR` and the share card's
 * colours against `--background` and `--foreground`; a brand command able to
 * move them could turn a customer's suite red from a colour choice, in a file
 * they never opened.
 */
export const WRITABLE = ["primary", "primary-foreground", "ring"];

const SELECTOR = { light: ":root", dark: ".dark" };

/**
 * @param {string} css
 * @param {{ light?: Record<string,string>, dark?: Record<string,string> }} blocks
 * @returns {{ css: string|null, replaced: string[], error: string|null }}
 */
export function replaceTokens(css, blocks) {
  // LF on the way in and on the way out. `.gitattributes` says the tree is LF
  // and `scripts/portability.test.ts` fails on a CRLF in any shipped file — a
  // Windows checkout must not turn a recolour into a whole-file diff.
  let out = css.replace(/\r\n?/g, "\n");
  const replaced = [];

  for (const [mode, tokens] of Object.entries(blocks)) {
    if (!tokens) continue;
    for (const [name, value] of Object.entries(tokens)) {
      if (!WRITABLE.includes(name)) {
        return { css: null, replaced, error: `refusing to write --${name}: not one of ${WRITABLE.join(", ")}` };
      }

      const range = blockRange(out, SELECTOR[mode]);
      if (!range) {
        return { css: null, replaced, error: `no ${SELECTOR[mode]} block in app/globals.css` };
      }

      const body = out.slice(range.start, range.end);
      // Only group 2 — the value — is replaced. Indentation, the `;` and any
      // trailing comment on that line survive byte for byte.
      const line = new RegExp(`^([ \\t]*--${name}:[ \\t]*)([^;]+)(;.*)$`, "m");
      if (!line.test(body)) {
        // Deliberately NOT appended. An app whose `:root` no longer declares
        // `--primary` has been restructured by somebody, and a second
        // declaration whose winner depends on source order is worse than doing
        // nothing at all.
        return {
          css: null,
          replaced,
          error: `--${name} is not declared in ${SELECTOR[mode]} — refusing to add a second one`,
        };
      }

      out =
        out.slice(0, range.start) +
        body.replace(line, `$1${value}$3`) +
        out.slice(range.end);
      replaced.push(`${mode}/--${name}`);
    }
  }

  // 🚨 Round-trip before anybody writes this to disk: parse the NEW string with
  // the same reader `ux-check` uses, and assert both halves — the values landed
  // as intended, AND every other token in both blocks is byte-identical. That
  // turns "careful in-place editing" from a claim into a check.
  const before = parseTokens(css.replace(/\r\n?/g, "\n"));
  const after = parseTokens(out);
  for (const mode of ["light", "dark"]) {
    const intended = blocks[mode] ?? {};
    for (const [name, value] of Object.entries(after[mode])) {
      const want = name in intended ? intended[name] : before[mode][name];
      if (value !== want) {
        return {
          css: null,
          replaced,
          error: `round-trip failed: ${SELECTOR[mode]} --${name} is "${value}", expected "${want}"`,
        };
      }
    }
    if (Object.keys(after[mode]).length !== Object.keys(before[mode]).length) {
      return { css: null, replaced, error: `round-trip failed: ${SELECTOR[mode]} gained or lost a token` };
    }
  }

  return { css: out, replaced, error: null };
}
