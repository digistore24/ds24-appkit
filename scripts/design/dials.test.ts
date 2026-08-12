// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The clamp behind "the list is closed".**
//
// `docs/design-system.md` §8 names four dials — accent, radius, type, elevation
// — and says the list is closed. Everything else in this repository that guards
// that boundary guards it from the SOURCE side: `scripts/ux/rules.mjs` counts
// values written past a dial in files under `app/`, `components/` and
// `modules/`. Nothing held the DOCUMENT, and the document is where the boundary
// is declared. A fifth bullet added to §8 was, until this file, a change that
// broke nothing.
//
// So the four live as data in `./dials.mjs` and this file holds the two against
// each other in both directions. What it can honestly assert is a NUMBER and a
// file AGREEING WITH ITSELF; whether a fifth slot would be justified is taste,
// and a test pretending to judge that would pass on any prose satisfying its
// letter — the argument `scripts/docs-coverage.test.ts` already makes about
// CLAUDE.md's block shape.
//
// ⚠️ **Two of the assertions carry a NEEDLE**, the doctrine
// `scripts/lib/source-text.test.ts` states in as many words: *a guard whose
// probe cannot fire is worse than no guard — it reports success.* A heading
// rename would make `section()` return `""`, and every assertion below would
// then pass over an empty string. So the extraction is proved non-vacuous, and
// the comparison is proved to really compare by running it against a DOCTORED
// §8 with one dial bullet taken out.
//
// Pure by construction: three `readFileSync` calls at the top, and every helper
// under test takes a string.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLOSED_SENTENCE,
  DIALS,
  DIAL_DEFINITION,
  SHELL_GEOMETRY,
  dialIdsIn,
  flatten,
  section,
} from "./dials.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const DESIGN_SYSTEM = readFileSync(join(ROOT, "docs/design-system.md"), "utf8");
const CLAUDE_MD = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");

const EIGHT = "8. The four dials, and what is deliberately NOT configurable";
const SECTION_8 = section(DESIGN_SYSTEM, EIGHT);
const UI = section(CLAUDE_MD, "UI");

// ── the needles, first, because everything below rests on them ───────────────

describe("🚨 the probes can fire at all", () => {
  it("extracted a real §8 rather than an empty string", () => {
    // A heading rename — a renumbering, a reworded title — makes `section()`
    // answer `""`, and `"".includes(x)` is false while `dialIdsIn("")` is `[]`.
    // One of those would fail loudly and the other would not, so the section is
    // measured before it is used: it has to be long, and it has to contain a
    // sentence nobody would keep while gutting the section.
    expect(SECTION_8.length).toBeGreaterThan(1500);
    expect(SECTION_8).toContain("What a dial IS");
    expect(SECTION_8).toContain("thirteen");
  });

  it("extracted CLAUDE.md's § UI rather than an empty string", () => {
    expect(UI.length).toBeGreaterThan(1500);
    expect(UI).toContain("The construction kit");
  });

  it("🚨 the comparison really compares — a missing dial is NAMED", () => {
    // Proving the walk ran is not proving the comparison did. `dialIdsIn` is run
    // against a §8 with the `radius` bullet cut out; if the parser were matching
    // nothing (a changed bullet shape, a stricter anchor) the doctored and the
    // real answer would be the same empty list and the assertion above it would
    // still be green.
    const doctored = SECTION_8.split("\n")
      .filter((l) => !/^- \*\*radius\*\* — /.test(l))
      .join("\n");

    const found = dialIdsIn(doctored);
    const missing = DIALS.map((d) => d.id).filter((id) => !found.includes(id));

    expect(found).not.toEqual(dialIdsIn(SECTION_8));
    expect(missing).toEqual(["radius"]);
  });

  it("🚨 the comparison really compares — an extra dial is NAMED", () => {
    // The other direction, and the one that is actually going to happen: a fifth
    // bullet appears in the document and nobody touches `DIALS`.
    const doctored = `${SECTION_8}\n- **spacing** — a fifth slot nobody agreed to.`;

    const found = dialIdsIn(doctored);
    const extra = found.filter((id) => !DIALS.some((d) => d.id === id));

    expect(extra).toEqual(["spacing"]);
  });
});

// ── the clamp itself ─────────────────────────────────────────────────────────

describe("docs/design-system.md §8 and the DIALS list agree", () => {
  it("names exactly these four, in this order", () => {
    // Both directions in one assertion: a bullet in the doc that is not in
    // DIALS fails, and an entry in DIALS that is not in the doc fails.
    expect(dialIdsIn(SECTION_8)).toEqual(DIALS.map((d) => d.id));
  });

  it("🚨 has FOUR dials", () => {
    // 🚨 A fifth dial is a decision made in the template, and this line is where
    // it gets made. The failure is the conversation. Bumping the number without
    // rewriting §8 defeats the clamp, and it is a thing somebody does on purpose
    // rather than by accident.
    expect(DIALS).toHaveLength(4);
  });

  it("carries the definition, verbatim", () => {
    expect(flatten(SECTION_8)).toContain(flatten(DIAL_DEFINITION));
  });

  it("carries the closing sentence, verbatim", () => {
    expect(flatten(SECTION_8)).toContain(flatten(CLOSED_SENTENCE));
  });

  it("keeps the shell-geometry refusal byte for byte", () => {
    // AC3's "word for word", measured rather than promised — and the reason it
    // is measured on RAW text rather than through `flatten()`: a re-wrap is
    // exactly the kind of tidying that happens while rewriting the section
    // around it, and it is a decision somebody should make deliberately.
    expect(SECTION_8).toContain(SHELL_GEOMETRY);
  });

  it("says where each dial's slot is", () => {
    // The `where` column is not decoration: two of the four are the facts that
    // would break a careless definition (the type dial lives in two files, the
    // accent is derived rather than picked). §8 has to name the file.
    for (const dial of DIALS) {
      for (const file of dial.where.split(" + ")) {
        expect(SECTION_8, `§8 never says where the ${dial.id} dial lives`).toContain(file);
      }
    }
  });
});

describe("CLAUDE.md § UI is a condensate of the same four", () => {
  it("names every dial id", () => {
    // The condensate and its source cannot be allowed to drift apart on the one
    // fact the whole section is about. `make condensate-check` notices that
    // docs/design-system.md MOVED; it cannot notice that § UI now describes
    // three dials. This can.
    for (const dial of DIALS) {
      expect(UI, `CLAUDE.md § UI never names the ${dial.id} dial`).toContain(
        `**${dial.id}**`,
      );
    }
  });

  it("says a dial is a value and never a class", () => {
    expect(flatten(UI)).toContain("**value, never a class**");
  });

  it("says the list is closed", () => {
    expect(flatten(UI)).toContain("four dials and the list is closed");
  });
});
