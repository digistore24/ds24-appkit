// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The four dials, as DATA — and the three sentences of `docs/design-system.md`
// §8 that a machine can hold the document to.
//
// ── Why this file exists at all ───────────────────────────────────────────────
// §8 says the design system has four configurable slots and that **the list is
// closed**. That sentence is the only thing standing between this template and a
// third, fourth and fifth "just one more variable", and until now it was prose.
// Prose does not break loudly: somebody adds a fifth bullet, every gate stays
// green, and six months later "the kit opened up" is what the document appears
// to say.
//
// So the list lives here, and `dials.test.ts` holds the document to it from BOTH
// sides — a fifth bullet in the doc that is not in `DIALS` fails, and a fifth
// entry in `DIALS` that is not in the doc fails too.
//
// ── What this file deliberately does NOT do ───────────────────────────────────
// It does not judge whether a fifth dial would be a good idea. That is taste,
// and a test pretending to make that judgement would pass on any prose that
// satisfied its letter. What a machine can be sure about is a NUMBER and a file
// AGREEING WITH ITSELF, and that is all this is.
//
// It is also not a second opinion about what `ux-check` counts. `scripts/ux/
// rules.mjs` → `DIAL_BYPASSES` is the list of ways past a dial, measured against
// source files; this is the list of dials, measured against the document. The
// two meet in §8 and nowhere in code — deliberately, because one importing the
// other would make a single edit able to move both sides of the comparison.
//
// Plain Node, no dependency, no side effect: it is imported by a test and by
// nothing that runs in the app.

/**
 * @typedef {object} Dial
 * @property {string} id       the lowercase word §8 uses as the bullet's subject
 * @property {string} where    the file(s) the slot is filled in
 * @property {string} why      what turning it changes, in one line
 */

/**
 * The four dials, in the order §8 lists them.
 *
 * 🚨 The ORDER is part of the comparison. A document that renamed nothing but
 * reordered the list would still be describing the same four slots — but the
 * cheapest way for the list to grow is for somebody to append a bullet, and a
 * set comparison cannot tell an append from a rename plus an append. Holding the
 * order costs a reordering nobody wants to do and buys the append.
 *
 * @type {Dial[]}
 */
export const DIALS = [
  {
    id: "accent",
    where: "app/globals.css",
    // 🚨 DERIVED, never chosen from a set: `node run.mjs brand colors` takes any
    // colour the operator already owns and moves its LIGHTNESS until both roles
    // of --primary (a surface, and a word) are readable in both modes. Any
    // definition of "dial" phrased as "a choice from a fixed set of values"
    // would exclude this one, which is why the definition below is phrased as a
    // SLOT instead.
    why: "--primary / --primary-foreground / --ring, in both blocks.",
  },
  {
    id: "radius",
    where: "app/globals.css",
    // A free number, not an enumeration — and the one token with a legitimate
    // single-block answer (`MODE_SINGLE_TOKENS` in scripts/ux/rules.mjs), because
    // a corner does not change with the mode.
    why: "--radius, one number; every rounded-* in the app is calculated from it.",
  },
  {
    id: "type",
    where: "app/layout.tsx + app/globals.css",
    // The only dial that lives in two files: the faces are loaded in
    // app/layout.tsx and consumed through --font-sans / --font-heading in
    // app/globals.css. A definition naming one file would exclude half of it.
    why: "--font-app-sans / --font-app-heading, the two role variables.",
  },
  {
    id: "elevation",
    where: "app/globals.css",
    // Two steps and only two. A third, weaker value for `shadow-xs` was
    // considered while 43.1 was written and refused for exactly the reason this
    // file exists: it would have been a fifth dial arriving as a tweak.
    why: "--elevation-raised / --elevation-overlay, in both blocks.",
  },
];

/**
 * The definition §8 gives, verbatim.
 *
 * It is quoted rather than paraphrased because it was written against all four
 * subjects above: a slot (not a choice from a set, or the accent falls out),
 * two possible files (or the type dial falls out), and **when an app turns it**
 * (or it is false of every app as delivered — `docs/design.md` does not exist in
 * the shipped state; the skill `design` writes it).
 */
export const DIAL_DEFINITION =
  "A **dial** is a named slot whose value is set once in `app/globals.css` or " +
  "`app/layout.tsx`, is recorded in `docs/design.md` when an app turns it, and " +
  "never appears as a class on a page.";

/** The sentence that closes the list, verbatim — emphasis included. */
export const CLOSED_SENTENCE =
  "**The list is closed. Opening a fifth slot is a change made in the TEMPLATE, " +
  "once for every app — never a decision an app makes about itself.**";

/**
 * The shell-geometry refusal, byte for byte.
 *
 * §8 gained a dial list; it lost none of its refusals, and this is the one whose
 * wording somebody would be most tempted to "tidy" while rewriting around it.
 * Held as bytes rather than as a sentence, so a re-wrap is a red run and a
 * decision rather than a silent softening.
 */
export const SHELL_GEOMETRY =
  "- **The shell geometry** — the 14-unit header, the 60-unit sidebar, the content\n" +
  "  measure. A page that renegotiates them stops looking like the same product.";

/**
 * The body of one `##` section of a markdown document, heading line excluded.
 *
 * Pure: it takes the text, not a path — so the doctored cases in dials.test.ts
 * need no filesystem. Sub-headings (`###`) stay INSIDE the slice, which is what
 * lets §8 group its dials under one and its refusals under another.
 *
 * @param {string} md the whole document
 * @param {string} heading the heading's text, without the leading `## `
 * @returns {string} the section body, or `""` when there is no such heading
 */
export function section(md, heading) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## (?!#)/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/**
 * The dial ids a section names, in the order it names them.
 *
 * The shape is `- **<id>** — …` with a LOWERCASE id, which is what separates a
 * dial bullet from a refusal bullet: §8's refusals are written
 * `- **The component set.**` and `- **The shell geometry** — …`, both starting
 * on a capital. That is a real distinction in the document rather than a trick —
 * a dial is named by its own word, a refusal by a noun phrase — but it is worth
 * knowing before writing a fifth bullet of either kind.
 *
 * @param {string} sectionText
 * @returns {string[]}
 */
export function dialIdsIn(sectionText) {
  const ids = [];
  for (const line of sectionText.split(/\r?\n/)) {
    const m = /^- \*\*([a-z][a-z0-9-]*)\*\* — /.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * Markdown flattened enough that a sentence wrapped over three lines and quoted
 * as a blockquote still compares equal to the sentence itself.
 *
 * Only two things happen: a leading `>` (with its space) comes off every line,
 * and every run of whitespace becomes one space. Nothing about the emphasis or
 * the punctuation is touched, so `CLOSED_SENTENCE` and `DIAL_DEFINITION` are
 * still compared as the words somebody wrote.
 *
 * @param {string} md
 * @returns {string}
 */
export function flatten(md) {
  return md
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*> ?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
