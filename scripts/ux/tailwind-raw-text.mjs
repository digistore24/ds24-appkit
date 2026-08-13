// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Tailwind reads this whole tree as RAW TEXT — and it does not know what a
// comment is. This file is the rule that catches the two contents which turn
// that into an outage, and the tree walk that applies it.
//
// ── ONE implementation, TWO callers, and that is the whole point ────────────
// `scripts/tailwind-raw-text.test.ts` runs it under `npm run test`, where it
// holds every measurement this rule was built from — which forms take the app
// down, which are harmless, and the proof that the needle below is really the
// incident's form.
// `scripts/ux/check.mjs` runs it under `node run.mjs ux-check`, because that is
// the command a person reaches for AFTER a 500, and this failure's only symptom
// is a 500 on every page.
//
// A second reader of the same question would be a second truth, and this
// project has measured what that costs twice (`blankComments()` had sixteen
// copies, three of them broken). So the rule and the walk live HERE, once, and
// neither caller owns a regex.
//
// ── 🚨 Why this file deliberately does NOT blank comments ──────────────────
// `CLAUDE.md` → **Rules** carries the opposite rule, and it is right: a checker
// that greps source goes through `blankComments()`
// (`scripts/lib/source-text.mjs`), or it punishes a file for explaining itself.
// **This checker is the other direction, and both rules hold at once.** The
// reader whose mistake is being prevented here is not one of ours — it is
// TAILWIND, a foreign tool with no idea that `//` means anything, and the
// needle is in the comment ON PURPOSE. Blanking would remove exactly the text
// this file has to read.
//
// ── There is no exemption marker, and that is the point ────────────────────
// `portability.test.ts` has `portability-ok`, `db/sql-cast.test.ts` has
// `sql-cast-ok`. This has none. There is no way to write these forms safely —
// not in code, not in a comment, not in a doc, not to explain that they are
// wrong. A marker would be a licence to break every page in the app.
//
// ── 🚨 TWO readers, measured, and neither is a subset of the other ──────────
// Every line here was measured by planting one token in a comment in
// `app/login/ui.tsx` and asking the RUNNING app for `/login` — Turbopack, the
// reader that actually decides, with a cache wipe and a restart after every
// failure so no answer could leak into the next. The full log of that
// measurement, form by form, is in `scripts/tailwind-raw-text.test.ts`.
//
//   1. **the CSS parser** — `var()` whose first argument is not a `--` name.
//      `var()` is the one CSS function with closed argument grammar, so a
//      placeholder there is a parse error where the same placeholder inside
//      `calc()` or `rgb()` is merely a value nobody will ever use.
//      → `✗ Parsing CSS source code failed`
//
//   2. **the bundler** — `url()` with a RELATIVE specifier that is not a file.
//      A root-relative path is never resolved at build time, an `https:` or
//      `data:` URL is left alone, an anchor is left alone, and a relative path
//      that EXISTS beside the stylesheet builds fine. Only a relative specifier
//      with nothing behind it fails — which is precisely what a placeholder in
//      prose is.
//      → `✗ Module not found: Can't resolve '…'`
//
// 🚨 **This says what was MEASURED, not what exists.** A third reader could be
// found tomorrow, and both callers word their output that way — "the two
// readers measured" and never "everything Tailwind can break on". Whoever finds
// a third one adds it here, with the running app's own error line beside it, and
// both callers get it in the same commit.
//
// ⚠️ **This file writes no broken token literally.** Every fixture is assembled
// at run time out of escapes, and `needleProbe()` is what proves the assembled
// string is really the incident's form. That is not principle: the first draft
// of the guard's header spelled the list out, its own tree walk found nine of
// them in it, and the app it was written to protect would have gone down on the
// commit that added it.
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md, "Three systems").
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

// ── The rule ────────────────────────────────────────────────────────────────

/**
 * An arbitrary value as Tailwind's scanner sees one: a bracket group with no
 * whitespace in it (Tailwind spells spaces `_`) and no nesting.
 *
 * Measured on the running app: the same token with real spaces inside the
 * brackets builds fine, so a bracket group containing whitespace is not a
 * candidate and must not be reported. That is what keeps ordinary prose and
 * ordinary code out of this scan — a JavaScript array of colour strings in
 * `scripts/brand/colors.test.ts` is not a class.
 */
const BRACKET_GROUP = /\[[^\s[\]]*\]/g;

/**
 * `var(` and its first argument, up to the comma or the closing paren.
 *
 * The fallback after a comma is deliberately not read: a placeholder there
 * builds, because the fallback is where any token list is legal. Only the NAME
 * is closed grammar.
 */
const VAR_CALL = /var\(([^,)]*)/g;

/** `url(` and everything up to its closing paren. */
const URL_CALL = /url\(([^)]*)\)/g;

/**
 * Does the bundler try to RESOLVE this `url()` specifier as a module?
 *
 * Measured, each of these on the running app:
 *
 * | written | what Turbopack does |
 * |---|---|
 * | `https://…`, `data:…` | leaves it alone — builds |
 * | `//host/x.png` | leaves it alone — builds |
 * | a root-relative path, existing or not | never resolved at build; served from `public/` — builds |
 * | an SVG fragment (`#gradient`) | builds |
 * | `icon.png`, `./icon.png` beside the stylesheet | resolves, and the file is there — builds |
 * | `nope.png`, `…`, `...`, `<path>` | resolves, nothing there — **500** |
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isResolvedSpecifier(raw) {
  const spec = raw.replace(/^['"]/, "").replace(/['"]$/, "");
  if (spec === "") return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) return false; // http:, https:, data:
  if (spec.startsWith("//")) return false;
  if (spec.startsWith("/")) return false;
  if (spec.startsWith("#")) return false;
  return true;
}

/**
 * @typedef {object} Finding
 * @property {"parser"|"bundler"} reader `parser` — the stylesheet will not
 *   parse. `bundler` — it will not build.
 * @property {string} token The whole arbitrary value, as it stands in the text.
 * @property {string} argument The argument that does it: a `var()` name or a
 *   `url()` specifier.
 * @property {number} line
 * @property {number} column
 */

/**
 * Read one file's text the way Tailwind reads it: whole, comments included.
 *
 * A bracket group counts as a Tailwind candidate when it is either
 *
 *  · preceded by `-`, which is every utility form (with or without a variant in
 *    front of it), or
 *  · an arbitrary PROPERTY — a property name, a colon, a value, the colon
 *    before any paren — and not glued to a word. Measured on the running app: a
 *    bare bracket group on its own builds fine (so a markdown link is not a
 *    finding), and one glued to the end of a word builds fine too — the scanner
 *    wants a boundary.
 *
 * `resolves` answers whether a relative `url()` specifier is a file that is
 * really there. It is injected rather than looked up here so the rule stays a
 * pure function: the tree walk passes the filesystem, the tests pass an answer.
 *
 * @param {string} source
 * @param {(specifier: string) => boolean} [resolves]
 * @returns {{candidates: string[], findings: Finding[]}}
 */
export function scanSource(source, resolves = () => false) {
  const candidates = [];
  const findings = [];

  for (const match of source.matchAll(BRACKET_GROUP)) {
    const token = match[0];
    const at = match.index;
    const before = at > 0 ? source[at - 1] : "";
    const inner = token.slice(1, -1);

    const utility = before === "-";
    const colon = inner.indexOf(":");
    const paren = inner.indexOf("(");
    const arbitraryProperty =
      colon !== -1 && (paren === -1 || colon < paren) && !/[A-Za-z0-9_]/.test(before);
    if (!utility && !arbitraryProperty) continue;

    candidates.push(token);

    const upTo = source.slice(0, at);
    const lines = upTo.split("\n");
    const where = { line: lines.length, column: lines[lines.length - 1].length + 1 };

    for (const call of inner.matchAll(VAR_CALL)) {
      if (call[1].startsWith("--")) continue;
      findings.push({ reader: "parser", token, argument: call[1], ...where });
    }

    for (const call of inner.matchAll(URL_CALL)) {
      const spec = call[1];
      if (!isResolvedSpecifier(spec)) continue;
      if (resolves(spec.replace(/^['"]/, "").replace(/['"]$/, ""))) continue;
      findings.push({ reader: "bundler", token, argument: spec, ...where });
    }
  }

  return { candidates, findings };
}

/**
 * One finding, said the way somebody who has never met this can act on it.
 *
 * @param {string} file
 * @param {Finding} finding
 * @returns {string}
 */
export function say(file, finding) {
  const why =
    finding.reader === "parser"
      ? `compiles to a CSS declaration reading \`var(${finding.argument})\`. That is ` +
        `not a custom-property name, so the stylesheet does not PARSE`
      : `compiles to a CSS declaration reading \`url(${finding.argument})\`. The bundler ` +
        `resolves a relative url() as a module import, there is no such file, so the ` +
        `stylesheet does not BUILD`;
  const fix =
    finding.reader === "parser"
      ? `describe the form in words, or name a real \`--\` token`
      : `describe the form in words, or make it a root-relative path from public/, ` +
        `an absolute URL, or a file that is really beside the stylesheet`;
  return (
    `${file}:${finding.line}:${finding.column}  ${finding.token}\n` +
    `    Tailwind reads this file as raw text — a comment is text too — and it ${why}. ` +
    `EVERY page in the app then answers 500, while typecheck and tests stay green.\n` +
    `    Fix: ${fix}. There is no exemption marker for this and there will not be one.\n` +
    `    If a page still 500s after the fix: \`rm -rf .next\` — Turbopack caches the ` +
    `broken rule across a restart.`
  );
}

// ── The needle, assembled ───────────────────────────────────────────────────

/*
 * The incident's own tokens, assembled rather than written.
 *
 * The bracket characters are spelled as escapes on purpose: written out, this
 * file would hold a bracket pair for Tailwind to find, and the guard would be
 * the outage. `needleProbe()` reads the code points back, so the escapes cannot
 * quietly stop being the incident's form.
 */
const OPEN = "[";
const CLOSE = "]";
const ELLIPSIS = "…";

/** Story 43.7's own token: the CSS parser refuses it, eight pages answered 500. */
export const PARSER_NEEDLE = `shadow-${OPEN}var(${ELLIPSIS})${CLOSE}`;

/** The other family: valid CSS, and the bundler cannot resolve the specifier. */
export const BUNDLER_NEEDLE = `bg-${OPEN}url(${ELLIPSIS})${CLOSE}`;

/**
 * A form measured as HARMLESS — the counter-probe.
 *
 * The tree ships several of these; a rule that reported them would fire on
 * `CLAUDE.md`, on `docs/ux.md` and on `docs/design-system.md`, and would be
 * switched off within a week, taking the real check with it.
 */
export const HARMLESS_CONTROL = `shadow-${OPEN}var(--elevation-overlay)${CLOSE}`;

/**
 * Did the RULE run, and does it still answer what it was measured to answer?
 *
 * 🚨 The half that is easy to leave out. "Walked 600 files" proves the walk
 * ran; it does not prove the comparison recognised a single token, and a regex
 * that matched nothing at all gives exactly the same green as a clean tree.
 * This asks the rule about its own needle instead of hoping the tree contains
 * one — and about a harmless form too, because a guard that reports everything
 * is as useless as one that reports nothing.
 *
 * @returns {string[]} what is wrong with the rule itself; empty is the pass
 */
export function needleProbe() {
  const problems = [];

  // The assembled string is the incident as recorded in Story 43.7 and in the
  // comment above `<Card>` in `app/login/ui.tsx` — spelled the only way it can
  // be here, by its code points.
  const shaped =
    PARSER_NEEDLE.startsWith("shadow-") &&
    PARSER_NEEDLE.length === "shadow-".length + "var()".length + 3 &&
    PARSER_NEEDLE.codePointAt(7) === 0x5b && // [
    PARSER_NEEDLE.codePointAt(12) === 0x2026 && // …
    PARSER_NEEDLE.codePointAt(14) === 0x5d; // ]
  if (!shaped) {
    problems.push(
      "the needle is no longer the incident's form — the escapes in " +
        "scripts/ux/tailwind-raw-text.mjs were changed, so nothing below measured anything",
    );
  }

  for (const [needle, reader] of [
    [PARSER_NEEDLE, "parser"],
    [BUNDLER_NEEDLE, "bundler"],
  ]) {
    const { findings } = scanSource(`// ${needle}`);
    if (findings.length !== 1 || findings[0].reader !== reader) {
      problems.push(
        `the rule no longer recognises the ${reader} family's own needle ` +
          `(${findings.length} finding(s), expected exactly 1)`,
      );
    }
  }

  const { findings: control } = scanSource(`// ${HARMLESS_CONTROL}`);
  if (control.length !== 0) {
    problems.push(
      "the rule reports a form measured on the running app as harmless — this tree " +
        "ships several of them, so it would fire on files that are correct",
    );
  }

  return problems;
}

// ── The tree ────────────────────────────────────────────────────────────────

/**
 * What Tailwind does not read.
 *
 * `node_modules` and `.next` are ignored by Tailwind itself; `.git`, `.dev` and
 * `.data` hold no source. Everything else is in — `docs/`, `CLAUDE.md`,
 * `messages/*.json` and `drizzle/*.sql` included, because Tailwind scans them
 * and the compiled stylesheet proves it: a bracketed font utility written only
 * in a markdown file is in this app's CSS today.
 */
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".dev", ".data", "dist", "coverage"]);

/** Measured: `.css` is the one text extension Tailwind does not scan. */
const SKIP_EXTENSIONS = [".css"];

function walk(dir, keep, found = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let directory;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      // A dangling symlink. Tailwind cannot read it either; it is not a place a
      // class name can hide.
      continue;
    }
    if (directory) walk(full, keep, found);
    else if (keep(entry)) found.push(full);
  }
  return found;
}

/** A file with a NUL byte is a picture or a font — Tailwind skips it, so do we. */
function textOf(file) {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

/**
 * Every file Tailwind reads in this app, scanned with the rule above.
 *
 * ⚠️ `stylesheetDirs` gets its OWN walk, because the walk above deliberately
 * SKIPS `.css` — the one extension Tailwind does not read. Reusing it left that
 * list empty once, which made the `url()` half stricter than the app and
 * reported a background that works.
 *
 * `resolves` comes back with the result so a caller can ask the same question
 * the scan asked — a second `existsSync` in a test would be a second answer.
 *
 * @param {{root: string}} options
 * @returns {{files: string[], texts: {file: string, text: string}[],
 *            candidates: string[], findings: (Finding & {file: string})[],
 *            stylesheetDirs: string[], resolves: (specifier: string) => boolean}}
 */
export function scanTree({ root }) {
  const files = walk(root, (entry) => !SKIP_EXTENSIONS.some((ext) => entry.endsWith(ext))).map(
    (file) => relative(root, file).split(sep).join("/"),
  );

  // Where a relative `url()` is resolved from: the directory of every
  // stylesheet that pulls Tailwind in. In this template that is
  // `app/globals.css`, so `app/`; an app that adds a second entry stylesheet
  // gets it for free rather than a hard-coded path that stops being true.
  const stylesheetDirs = walk(root, (entry) => entry.endsWith(".css"))
    .filter((file) => readFileSync(file, "utf8").includes('@import "tailwindcss"'))
    .map((file) => dirname(file));
  const resolves = (specifier) =>
    stylesheetDirs.some((dir) => existsSync(join(dir, specifier)));

  const texts = [];
  for (const file of files) {
    const text = textOf(join(root, file));
    if (text !== null) texts.push({ file, text });
  }

  const candidates = [];
  const findings = [];
  for (const { file, text } of texts) {
    const scan = scanSource(text, resolves);
    candidates.push(...scan.candidates);
    for (const finding of scan.findings) findings.push({ file, ...finding });
  }

  return { files, texts, candidates, findings, stylesheetDirs, resolves };
}
