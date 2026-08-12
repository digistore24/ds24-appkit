// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The active navigation entry is rendered TWICE and written once.
//
// `NavLinks` is instantiated in two places in components/app-shell.tsx — the
// sidebar that is fixed from `lg` up, and the sheet that replaces it below that
// width. Both render the same className, so "the current page looks chosen" is
// one edit. The failure this file exists for is the second edit: somebody
// strengthens the sheet's copy alone, or copies the active treatment into a
// second className "just for mobile", and the two drift. Nothing else in this
// repository could see that — there is no DOM, no rendering and no screenshot
// anywhere (`vitest.config.ts` is `environment: "node"`), and both variants
// answer 200.
//
// So the assertion is structural: TWO renderers, ONE treatment.
//
// 🚨 Through `blankComments()`, never a regex of its own — components/app-shell
// .tsx explains its own active className at length, and a checker that counted
// the prose would count the explanation as a second treatment. That is the
// measured failure in scripts/lib/source-text.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();
const FILE = "components/app-shell.tsx";

const source = blankComments(readFileSync(join(ROOT, FILE), "utf8"));

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("🚨 the needles can be found at all", () => {
  it("counts a second treatment when there is one", () => {
    const one = `active && "bg-primary/15 font-semibold"`;
    expect(count(one, "active &&")).toBe(1);
    expect(count(`${one}\n${one}`, "active &&")).toBe(2);
  });

  it("would not survive the file being blanked", () => {
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("function NavLinks(");
  });
});

describe("the active entry is written once and rendered twice", () => {
  it("has exactly one active-entry className", () => {
    expect(count(source, "active &&")).toBe(1);
  });

  it("renders NavLinks in both the sidebar and the sheet", () => {
    // If this ever drops to one, the sheet stopped using the shared component
    // and the assertion above became vacuous — one treatment, one renderer, and
    // the mobile menu built somewhere else entirely.
    expect(count(source, "<NavLinks")).toBe(2);
  });

  it("keeps the assistive answer, whatever the visual one becomes", () => {
    // `aria-current="page"` is the answer a screen reader gets, and it was
    // already correct before anything here was strengthened. A visual treatment
    // is an ADDITION to it, never a replacement.
    expect(source).toContain('aria-current={active ? "page" : undefined}');
  });

  it("adds a second channel beside the colour", () => {
    // 🚨 WCAG 1.4.1: state carried by colour alone. The tint measures 1.16
    // against the sidebar in light mode — visible, but it is a hue difference
    // and nothing else. The weight step is what somebody who cannot see the hue
    // has. If this assertion is ever removed, read that sentence first.
    expect(source).toMatch(/active &&\s*\n?\s*"[^"]*font-semibold/);
  });

  it("leaves the shell geometry alone — it is a closed list", () => {
    // docs/design-system.md §8. These four are the shell's geometry and the
    // epic keeps them word for word; a strengthening that moved one of them
    // would be a layout change wearing a colour change's clothes.
    for (const dimension of ["w-60", "h-14", "lg:pl-60", "max-w-5xl"]) {
      expect(source).toContain(dimension);
    }
  });
});
