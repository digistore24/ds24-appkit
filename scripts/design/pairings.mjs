// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The pairing table of `.claude/skills/design/references/tokens.md`, read as
// DATA — so that a row offering something npm cannot deliver is a red run
// rather than a sentence somebody believed.
//
// ── Why this file exists at all ───────────────────────────────────────────────
// That table is a list of five type pairings, and every row makes a structural
// claim: this npm package exists, it lives in THIS namespace, and this file
// inside it is the one `next/font/local` points at. Until now the whole thing
// was prose. A document asserting its own completeness while the tree does not
// have what it lists is a FALSE ASSERTION rather than a gap — Epic 36 cleaned
// exactly that defect out of three shipped documents, and this table has the
// same shape: five rows, and a sentence saying why it is five.
//
// The sentences AROUND the table stay prose and nothing greps them. What is
// parseable, comparable and falsifiable is a package name in a cell, and that
// is all this module reads.
//
// ── Why the parser is here and not in either test ────────────────────────────
// There are two halves to the check and they ask different questions:
//
//   * `scripts/design-pairings.test.ts` (here, in `make check`, no network) —
//     does every row still SAY what a deliverable row has to say.
//   * `scripts/design-pairings.test.mjs` in the FACTORY (release-gated, network)
//     — does npm really answer for the package that row names.
//
// Both need the same rows out of the same file, and a second markdown parser is
// the way the two halves start disagreeing about what a row even is. So the
// reading lives once, here, and both halves import it. `section()` is not
// re-implemented either: it comes from `./dials.mjs`, which already had to
// slice a `##` section for the same document family.
//
// Plain Node, no dependency, no side effect, and every function takes TEXT
// rather than a path — which is what lets the tests run a doctored table
// through it with no filesystem at all. That matters: a parser that matches
// nothing would otherwise pass every assertion by finding nothing.

import { section } from "./dials.mjs";

/** The `##` section of `tokens.md` the table lives under. */
export const PAIRINGS_SECTION = "Typography";

/**
 * How many rows the table has. The number is the table's own claim about its
 * size, and a claim is what this module exists to hold.
 *
 * 🚨 This is a COUNT and it is deliberately the only one here. It is legitimate
 * because the document says "five" in words two paragraphs above the table — so
 * the two would disagree silently — where "how many packages resolve" or "how
 * many advisories are accepted" are the shapes that rot and are asserted
 * nowhere.
 */
export const PAIRINGS_EXPECTED_ROWS = 5;

/** Every `@fontsource…` name in a string, in order. */
const PACKAGE_RE = /@fontsource(?:-variable)?\/[a-z0-9-]+/g;

/** A concrete file inside the package — never a placeholder. */
const FILE_RE = /\bfiles\/[a-z0-9._-]+\.woff2\b/;

/** The elevation word, which is one of exactly two. */
const ELEVATION_RE = /^`(flat|lifted)`$/;

/**
 * The columns the table must have, by a keyword its heading must contain.
 *
 * Matched on a keyword rather than on the full heading text, because the
 * headings are prose ("The file `next/font/local` points at") and a test pinned
 * to prose is a test somebody deletes the next time they improve a word. The
 * keyword is the part that cannot change without the column becoming a
 * different column.
 */
const COLUMNS = {
  pairing: "pairing",
  elevation: "elevation",
  pkg: "package",
  file: "file",
};

/**
 * The cells of one markdown table row, outer pipes dropped and each trimmed.
 *
 * @param {string} line
 * @returns {string[]}
 */
function cellsOf(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/**
 * @typedef {object} PairingRow
 * @property {number} line      1-based line number in the WHOLE document
 * @property {string} pairing   the first cell, as written
 * @property {string} elevation `flat`, `lifted`, or "" when the cell is neither
 * @property {string[]} packages every `@fontsource…` name the row names
 * @property {string} file      the `files/….woff2` the row points at, or ""
 * @property {"variable"|"fixed"|"none"|"both"} claim what the row says it ships
 * @property {string} raw       the whole line
 */

/**
 * @typedef {object} PairingTable
 * @property {boolean} found    whether a table was located under the heading
 * @property {string[]} columns the header cells, as written
 * @property {number} headerLine 1-based line of the header row, or 0
 * @property {PairingRow[]} rows
 */

/**
 * Read the pairing table out of the document.
 *
 * By HEADING, never by line number: a table pinned to `:50` breaks on the next
 * paragraph somebody adds and teaches people that these tests are noise. The
 * cost of that choice is that a renamed heading makes the table vanish — which
 * is why `found` is a field rather than an empty array, and why the test asserts
 * it separately. Silently reducing the suite to zero rows is the one failure
 * mode a checker like this has.
 *
 * @param {string} md the whole of `tokens.md`
 * @returns {PairingTable}
 */
export function parsePairings(md) {
  const empty = { found: false, columns: [], headerLine: 0, rows: [] };
  const body = section(md, PAIRINGS_SECTION);
  if (body === "") return empty;

  // The section body is a slice, and a finding has to name a line in the FILE —
  // so the slice's own offset is recovered from where its heading sits. Taken
  // from the heading rather than by searching for the body's first line, which
  // is usually blank and would match the document's first blank line instead.
  const all = md.split(/\r?\n/);
  const headingIdx = all.findIndex((l) => l.trim() === `## ${PAIRINGS_SECTION}`);
  if (headingIdx === -1) return empty;
  const offset = headingIdx + 1;

  const lines = body.split(/\r?\n/);
  const headerIdx = lines.findIndex(
    (l) => l.trim().startsWith("|") && /\bpairing\b/i.test(l),
  );
  if (headerIdx === -1) return empty;

  const columns = cellsOf(lines[headerIdx]);
  /** @type {PairingRow[]} */
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = cellsOf(line);
    const at = (key) => {
      const idx = columns.findIndex((c) => c.toLowerCase().includes(COLUMNS[key]));
      return idx === -1 ? "" : (cells[idx] ?? "");
    };
    const packages = [...line.matchAll(PACKAGE_RE)].map((m) => m[0]);
    const rest = `${at("file")} ${at("pkg")}`;
    const variable = /one variable file/i.test(rest);
    const fixed = /fixed weights/i.test(rest);
    const elevation = ELEVATION_RE.exec(at("elevation"));
    rows.push({
      line: offset + i + 1,
      pairing: at("pairing"),
      elevation: elevation ? elevation[1] : "",
      packages,
      file: FILE_RE.exec(at("file"))?.[0] ?? "",
      claim: variable && fixed ? "both" : variable ? "variable" : fixed ? "fixed" : "none",
      raw: line,
    });
  }

  return { found: true, columns, headerLine: offset + headerIdx + 1, rows };
}

/**
 * Everything wrong with the table, each as one sentence naming the row.
 *
 * An empty array is the pass. The problems are RETURNED rather than thrown so
 * that a run reports all of them at once — a table with two broken rows should
 * cost one edit, not two runs — and so that the doctored fixtures in the tests
 * can assert on the text rather than on an exception type.
 *
 * @param {string} md the whole of `tokens.md`
 * @param {Record<string, string>} dependencies `package.json`'s `dependencies`
 * @returns {string[]}
 */
export function pairingProblems(md, dependencies) {
  const table = parsePairings(md);
  if (!table.found) {
    return [
      `no pairing table found under "## ${PAIRINGS_SECTION}" — a renamed heading ` +
        `must fail here rather than silently leave nothing to check`,
    ];
  }

  /** @type {string[]} */
  const problems = [];

  for (const key of Object.keys(COLUMNS)) {
    if (!table.columns.some((c) => c.toLowerCase().includes(COLUMNS[key]))) {
      problems.push(`the table has no "${COLUMNS[key]}" column`);
    }
  }

  if (table.rows.length !== PAIRINGS_EXPECTED_ROWS) {
    problems.push(
      `the table has ${table.rows.length} rows and the prose above it says ` +
        `${PAIRINGS_EXPECTED_ROWS}`,
    );
  }

  for (const row of table.rows) {
    const who = `row "${row.pairing}" (line ${row.line})`;

    if (row.packages.length !== 1) {
      problems.push(
        `${who} names ${row.packages.length} @fontsource packages and a row costs ` +
          `exactly one — a pairing whose second family already ships says so in ` +
          `words instead`,
      );
    }

    for (const pkg of row.packages) {
      if (!/^@fontsource(-variable)?\/[a-z0-9-]+$/.test(pkg)) {
        problems.push(`${who} names "${pkg}", which is not a Fontsource package name`);
      }
    }

    if (row.claim === "none" || row.claim === "both") {
      problems.push(
        `${who} says neither "one variable file" nor "fixed weights" (or says ` +
          `both) — the namespace it may use follows from that claim, so the row ` +
          `has to make it`,
      );
    }

    const pkg = row.packages[0] ?? "";
    const isVariableNamespace = pkg.startsWith("@fontsource-variable/");
    if (row.claim === "variable" && pkg !== "" && !isVariableNamespace) {
      problems.push(
        `${who} claims one variable file but names "${pkg}" — a variable file ` +
          `lives under @fontsource-variable/…, so next/font/local would point at ` +
          `a file that is not in the package`,
      );
    }
    if (row.claim === "fixed" && pkg !== "" && isVariableNamespace) {
      problems.push(
        `${who} declares fixed weights but names "${pkg}" — Fontsource splits the ` +
          `two namespaces, and fixed weights live under @fontsource/…`,
      );
    }

    if (row.file === "") {
      problems.push(
        `${who} names no concrete file — the wiring cell has to carry the real ` +
          `files/….woff2, because the names differ per family and a guessed one ` +
          `is a build error in the customer's app`,
      );
    }

    if (row.elevation === "") {
      problems.push(
        `${who} carries no elevation word — every row says flat or lifted, which ` +
          `is how the fourth dial stays one word inside a row instead of becoming ` +
          `a menu of its own`,
      );
    }

    if (/\(shipped\)/i.test(row.pairing) && pkg !== "" && !(pkg in dependencies)) {
      problems.push(
        `${who} is the shipped row and names "${pkg}", which package.json does ` +
          `not depend on — this is the one row that can be proved against the tree`,
      );
    }
  }

  return problems;
}
