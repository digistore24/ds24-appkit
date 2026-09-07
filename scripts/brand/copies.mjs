// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The literal copies of `--primary` that live OUTSIDE app/globals.css.
//
// An `ImageResponse` and a mail client cannot read a CSS variable, so the share
// card and the mail button each carry the accent as a hex literal — and a test
// holds each to the token (`lib/pwa/manifest.test.ts`, `lib/email.test.ts`).
// `node run.mjs brand colors --apply` rewrites the token and cannot rewrite
// the literals: they are TypeScript, and a regex edit into a source file is a
// merge conflict waiting for the customer's own change to the same line. What
// it can do is SAY which of them now differ — reported from a customer's app
// on 2026-09-07, where every mail kept the shipped colour after a rebrand and
// only the sister constant with a test gave it away.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the copies are, and what each one is for. Read from the FILES, never trusted. */
export const ACCENT_COPIES = [
  { file: "lib/pwa/manifest.ts", name: "OG_ACCENT", role: "the share card" },
  { file: "lib/email.ts", name: "DEFAULT_ACCENT", role: "the button in every mail" },
];

/**
 * The hex literal `export const <name> = "#…"` carries in `source`, or null.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string|null}
 */
export function literalOf(source, name) {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*"(#[0-9a-fA-F]{6})"`).exec(source);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Every copy, with the value it holds right now — or `value: null` when the
 * file or the constant is not where this template put it (a customer may have
 * moved either; that is reported, not skipped).
 *
 * @param {string} root the app's root
 * @param {(file: string) => string} [read]
 */
export function accentCopies(root, read = (file) => readFileSync(join(root, file), "utf8")) {
  return ACCENT_COPIES.map((copy) => {
    let value = null;
    try {
      value = literalOf(read(copy.file), copy.name);
    } catch {
      value = null;
    }
    return { ...copy, value };
  });
}

/**
 * The copies that do NOT carry `hex` — the ones a recolour left behind. A copy
 * that could not be read counts as stale: "I could not look" is not "it matches".
 *
 * @template {{ value: string|null }} T
 * @param {T[]} copies from `accentCopies()`
 * @param {string} hex the accent `app/globals.css` now carries, `#rrggbb`
 * @returns {T[]}
 */
export function staleCopies(copies, hex) {
  const want = hex.toLowerCase();
  return copies.filter((copy) => copy.value !== want);
}
