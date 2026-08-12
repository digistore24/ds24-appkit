// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import { MEDIA_SEGMENT_PATTERN } from "@/lib/knowledge-media/rules.mjs";

import {
  headingAnchors,
  headingSections,
  mediaAnchor,
  slugifyAnchor,
} from "./anchors";

// The project's ONE slug grammar — imported, never re-typed, so this test
// fails the moment anchors and media segments stop reading the same.
const SEGMENT_RE = new RegExp(`^${MEDIA_SEGMENT_PATTERN}$`);

describe("slugifyAnchor", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyAnchor("Der erste Wurf")).toBe("der-erste-wurf");
  });

  it("transliterates German umlauts and ß", () => {
    expect(slugifyAnchor("Köder & Führung, größte Übung")).toBe(
      "koeder-fuehrung-groesste-uebung",
    );
  });

  it("collapses punctuation runs and trims the edges", () => {
    expect(slugifyAnchor("  -- Hello,   World! --  ")).toBe("hello-world");
  });

  it("answers empty for input with no usable characters", () => {
    expect(slugifyAnchor("!!!")).toBe("");
    expect(slugifyAnchor("")).toBe("");
  });

  it("emits the media segment grammar — one slug standard in the project", () => {
    for (const input of ["Köder-Wahl", "Übung 3: der Knoten", "a.b/c", "UPPER"]) {
      const slug = slugifyAnchor(input);
      expect(slug).toMatch(SEGMENT_RE);
    }
  });
});

describe("mediaAnchor", () => {
  it("folds path separators and the extension dot into the slug", () => {
    expect(mediaAnchor("koeder/knoten.mp4")).toBe("media-koeder-knoten-mp4");
  });

  it("is prefixed so it cannot collide with a heading anchor", () => {
    expect(mediaAnchor("intro.mp4").startsWith("media-")).toBe(true);
  });

  it("answers empty for unusable input rather than a bare prefix", () => {
    expect(mediaAnchor("")).toBe("");
  });
});

describe("headingSections", () => {
  const markdown = [
    "Intro before any heading.",
    "",
    "## Erste Übung",
    "",
    "Text of the first section.",
    "",
    "### Detail",
    "",
    "Nested text belongs to the parent section.",
    "",
    "## Zweite Übung",
    "",
    "Second section.",
  ].join("\n");

  it("slices each section from its heading to the next of same or higher level", () => {
    const sections = headingSections(markdown);
    expect(sections.map((s) => s.anchor)).toEqual([
      "erste-uebung",
      "detail",
      "zweite-uebung",
    ]);
    // The ## section keeps its nested ### content…
    expect(sections[0].body).toContain("Nested text");
    // …and stops at the next ##.
    expect(sections[0].body).not.toContain("Second section");
    expect(sections[1].body).toBe("Nested text belongs to the parent section.");
  });

  it("ignores a heading inside a fenced code block", () => {
    const withCode = "## Real\n\n```\n## Fake\n```\n\nAfter.";
    const sections = headingSections(withCode);
    expect(sections.map((s) => s.anchor)).toEqual(["real"]);
    // The fence is not a heading, but it IS part of the section's content.
    expect(sections[0].body).toContain("## Fake");
  });

  it("suffixes duplicate anchors so both stay addressable", () => {
    const sections = headingSections("## Übung\n\na\n\n## Übung\n\nb");
    expect(sections.map((s) => s.anchor)).toEqual(["uebung", "uebung-2"]);
  });

  it("skips headings that slugify to nothing", () => {
    expect(headingSections("## !!!\n\ntext")).toEqual([]);
  });

  it("levels 5 and deeper are not addressable", () => {
    expect(headingSections("##### Too deep\n\ntext")).toEqual([]);
  });
});

describe("headingAnchors", () => {
  it("is the headings of headingSections, nothing else", () => {
    const markdown = "## Eins\n\na\n\n### Zwei\n\nb";
    expect(headingAnchors(markdown)).toEqual(
      headingSections(markdown).map(({ anchor, title }) => ({ anchor, title })),
    );
  });

  it("every anchor obeys the segment grammar", () => {
    for (const { anchor } of headingAnchors("## Größte Übung\n\n## Zweite: Wahl\n")) {
      expect(anchor).toMatch(SEGMENT_RE);
    }
  });
});
