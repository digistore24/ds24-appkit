// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The offline half of "every pairing it offers ships as a package".**
//
// `.claude/skills/design/references/tokens.md` offers five type pairings and
// says, of each, that one npm package carries it and that one file inside that
// package is what `next/font/local` points at. Before this file existed, all of
// that was prose: a row could name a package that does not exist, or name the
// `-variable` namespace for a family that only ships fixed weights, and every
// gate in this repository stayed green. The customer finds out at
// `npm run build`, in their app, on their deploy host.
//
// A document promising what does not exist is the defect Epic 36 cleaned out of
// three shipped documents, and an omission inside a completeness claim is a
// FALSE ASSERTION rather than a gap. 36.3 deliberately added no test and said
// why — prose has no unit test. This table is not prose: a package name in a
// cell is structural, parseable and falsifiable, which is the whole reason it
// gets one where the sentences around it do not.
//
// ── Two halves, and neither replaces the other ───────────────────────────────
//
//   * THIS file — does every row still SAY what a deliverable row has to say.
//     Deterministic, milliseconds, no network, and therefore correctly inside
//     `make check`: any `*.test.ts` under `template/` is in it by construction
//     (`vitest.config.ts` → `include: ["**/*.test.ts"]`), whether anybody
//     intended it or not. So this file is PURE — no `fetch`, no `spawn`, no
//     process, nothing that could make `make check` depend on a network.
//   * `scripts/design-pairings.test.mjs` in the FACTORY — does npm really
//     answer for the name that row gives. It needs the network, its answer
//     moves without this repository changing, and it gates the RELEASE, for the
//     reason the root Makefile already writes above `deploy-local-check`.
//
// This one cannot ask whether a name exists in the registry. That one cannot
// tell you the row contradicts itself. Both are wanted.
//
// ── The needle ───────────────────────────────────────────────────────────────
// Two of the assertions below carry one, the doctrine
// `scripts/lib/source-text.test.ts` states in as many words: *a guard whose
// probe cannot fire is worse than no guard — it reports success.* A parser that
// matched nothing would pass every assertion here by finding nothing, and a
// renamed heading is the cheapest way to get there. So the table is proved to
// have been FOUND, and the comparison is proved to really compare by running it
// against doctored tables that a correct parser must reject.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PAIRINGS_EXPECTED_ROWS,
  PAIRINGS_SECTION,
  pairingProblems,
  parsePairings,
} from "./design/pairings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = join(".claude", "skills", "design", "references", "tokens.md");

const md = readFileSync(join(ROOT, TOKENS), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

// A table with one row of each shape, used only by the needle probes below.
// Written here rather than read off disk so the probes need no filesystem and
// cannot drift with the real document.
const FIXTURE = [
  `## ${PAIRINGS_SECTION}`,
  "",
  "| Pairing | Carries | Elevation | The one package it adds | The file it points at |",
  "|---|---|---|---|---|",
  "| **Alpha** | a mood | `flat` | `@fontsource-variable/alpha` | one variable file, `files/alpha-latin-wght-normal.woff2` |",
  "",
  "## Something else",
  "",
].join("\n");

const row = (cells: string) => FIXTURE.replace(/\| \*\*Alpha\*\*.*\|/, cells);

describe("the design skill's pairing table", () => {
  it(`🚨 was found at all, under "## ${PAIRINGS_SECTION}"`, () => {
    // Non-vacuity. Everything below reads `table.rows`, so a heading rename
    // would leave every other assertion here passing over an empty array —
    // "green because it checked" and "green because it skipped" are the same
    // colour, which is the confusion this whole repository is built against.
    const table = parsePairings(md);
    expect(table.found, `no table under "## ${PAIRINGS_SECTION}" in ${TOKENS}`).toBe(true);
    expect(table.rows.length).toBe(PAIRINGS_EXPECTED_ROWS);
    expect(table.rows.every((r) => r.line > 0)).toBe(true);
  });

  it("has nothing wrong with it", () => {
    const problems = pairingProblems(md, pkg.dependencies);
    expect(
      problems,
      `${TOKENS} offers a pairing it cannot deliver:\n  · ${problems.join("\n  · ")}`,
    ).toEqual([]);
  });

  it("never reaches for a font CDN at build time", () => {
    // The property the whole table exists to protect, and the one that is
    // invisible until it fails on somebody else's deploy host: the loader that
    // downloads a face at BUILD time puts an outbound request into the
    // customer's release chain. `app/layout.tsx` carries the same rule as a
    // comment; this is the half a machine can hold.
    expect(md).not.toContain("next/font/google");
    expect(md).toContain("next/font/local");
  });

  it("names, on the shipped row, a package this app really depends on", () => {
    const shipped = parsePairings(md).rows.filter((r) => /\(shipped\)/i.test(r.pairing));
    expect(shipped.length, "exactly one row is the shipped one").toBe(1);
    expect(pkg.dependencies).toHaveProperty(shipped[0].packages[0]);
  });
});

describe("🚨 the parser really turns red — the needle probes", () => {
  it("finds nothing wrong with a correct fixture", () => {
    // The needle's own control. Without it, a `pairingProblems` that reported a
    // problem about EVERY table would make the four probes below pass while
    // testing nothing at all.
    expect(pairingProblems(FIXTURE, { "@fontsource-variable/alpha": "^5.0.0" })).toEqual([
      `the table has 1 rows and the prose above it says ${PAIRINGS_EXPECTED_ROWS}`,
    ]);
  });

  it("rejects a row whose namespace contradicts its own file claim", () => {
    // The failure that actually ships is never "the package vanished" — it is
    // somebody writing `@fontsource-variable/x` for a family that has only
    // fixed weights, and then `next/font/local` points at a file that is not in
    // the package. This is the one thing no registry lookup can catch: the name
    // resolves perfectly.
    const doctored = row(
      "| **Alpha** | a mood | `flat` | `@fontsource-variable/alpha` | fixed weights, `files/alpha-latin-400-normal.woff2` |",
    );
    expect(pairingProblems(doctored, {}).join(" ")).toContain("declares fixed weights");
  });

  it("rejects a row that names no package, and one that names two", () => {
    const none = row("| **Alpha** | a mood | `flat` | a nice font | one variable file, `files/a.woff2` |");
    expect(pairingProblems(none, {}).join(" ")).toContain("names 0 @fontsource packages");

    const two = row(
      "| **Alpha** | a mood | `flat` | `@fontsource-variable/alpha` and `@fontsource-variable/beta` | one variable file, `files/a.woff2` |",
    );
    expect(pairingProblems(two, {}).join(" ")).toContain("names 2 @fontsource packages");
  });

  it("rejects a placeholder where a file has to be, and a missing elevation word", () => {
    const vague = row(
      "| **Alpha** | a mood | `flat` | `@fontsource-variable/alpha` | one variable file, the usual one |",
    );
    expect(pairingProblems(vague, {}).join(" ")).toContain("names no concrete file");

    const mute = row(
      "| **Alpha** | a mood | — | `@fontsource-variable/alpha` | one variable file, `files/a.woff2` |",
    );
    expect(pairingProblems(mute, {}).join(" ")).toContain("carries no elevation word");
  });

  it("refuses to pass a table it could not find", () => {
    // The silent failure this file's first assertion exists for, proved rather
    // than asserted: a renamed heading must be a finding, never zero rows and a
    // green run.
    const renamed = FIXTURE.replace(`## ${PAIRINGS_SECTION}`, "## Type");
    expect(pairingProblems(renamed, {}).join(" ")).toContain("no pairing table found");
  });
});
