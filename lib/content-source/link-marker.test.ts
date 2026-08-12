// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The link grammar, and mostly its refusals. Everything here is pure string
// arithmetic — no database, no stream, no model.
import { describe, it, expect } from "vitest";

import {
  CONTENT_LINK_PATTERN,
  MAX_LINK_LABEL_CHARS,
  MAX_LINK_TARGET_CHARS,
  contentLinkMarker,
  isLinkableAppPath,
  parseContentLinkMarker,
} from "./link-marker";
import { slugifyAnchor } from "./anchors";

const LONG = `/${"a".repeat(MAX_LINK_TARGET_CHARS)}`;

/**
 * Targets the grammar must accept. Kept beside the refusals so the agreement
 * test below can walk both lists.
 */
const GOOD = [
  "/dashboard",
  "/dashboard/kurs/knoten-basics",
  "/dashboard/kurs/knoten-basics#uebung-2",
  "/dashboard/Kurs/Lektion_3",
  "/optin/ABC12345",
  `/${"a".repeat(MAX_LINK_TARGET_CHARS - 1)}`,
];

/**
 * Targets it must refuse. Each line is a way a link could leave this app, name
 * a file, or carry an instruction to a page.
 */
const BAD = [
  // 🚨 The one that matters most: a protocol-relative URL is a valid href and
  // it leaves the site. `"//evil.com/x".startsWith("/")` is true.
  "//evil.com/x",
  "///evil.com",
  "https://evil.com",
  "http://evil.com/x",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>",
  "evil.com/x",
  "dashboard/kurs",
  "",
  "/",
  "/x?a=b",
  "/x&y",
  "/x y",
  "/x\\y",
  "/x%2e%2e",
  "/../admin",
  "/dashboard/../admin",
  "/dashboard/kurs.html",
  "/dashboard//kurs",
  "/dashboard/",
  "/x#a#b",
  "/x#Not A Slug",
  "/x#UPPER",
  "/x#",
  "/x<script>",
  '/x"y',
  "/x\ny",
  // The boundary itself, which nothing used to walk: GOOD carries 200 and this
  // list carried 202, so an off-by-one in the `(?![^|\]]{201})` lookahead would
  // have left the suite green. `LONG` is exactly MAX_LINK_TARGET_CHARS + 1 —
  // the first length that must be refused.
  LONG,
  `${LONG}b`,
];

describe("isLinkableAppPath", () => {
  it("accepts an app-relative path, with or without one slug fragment", () => {
    for (const target of GOOD) {
      expect(isLinkableAppPath(target), target).toBe(true);
    }
  });

  it("refuses everything that is not a page of this app", () => {
    for (const target of BAD) {
      expect(isLinkableAppPath(target), target).toBe(false);
    }
  });

  it("refuses a non-string without throwing", () => {
    expect(isLinkableAppPath(null as unknown as string)).toBe(false);
    expect(isLinkableAppPath(undefined as unknown as string)).toBe(false);
  });

  // The whole point of composing `isLinkableAppPath` out of the marker
  // pattern's own target sub-pattern: there is ONE arithmetic. If somebody
  // ever "simplifies" one of the two, this fails.
  it("agrees with CONTENT_LINK_PATTERN on every target, good and bad", () => {
    const marker = new RegExp(`^${CONTENT_LINK_PATTERN}$`);
    for (const target of [...GOOD, ...BAD]) {
      const acceptedByPattern = marker.test(`[link:${target}|L]`);
      expect(acceptedByPattern, target).toBe(isLinkableAppPath(target));
    }
  });
});

describe("contentLinkMarker", () => {
  it("composes the marker a source's hit deserves", () => {
    expect(
      contentLinkMarker("/dashboard/kurs/knoten", "uebung-2", "Lektion 3: Knoten binden"),
    ).toBe("[link:/dashboard/kurs/knoten#uebung-2|Lektion 3: Knoten binden]");
  });

  it("leaves the fragment off when there is no anchor", () => {
    expect(contentLinkMarker("/dashboard/kurs", null, "Der Kurs")).toBe(
      "[link:/dashboard/kurs|Der Kurs]",
    );
    expect(contentLinkMarker("/dashboard/kurs", "", "Der Kurs")).toBe(
      "[link:/dashboard/kurs|Der Kurs]",
    );
  });

  it("round-trips through parseContentLinkMarker", () => {
    const marker = contentLinkMarker("/dashboard/kurs/x", "uebung-2", "Lektion 3");
    expect(parseContentLinkMarker(marker!)).toEqual({
      target: "/dashboard/kurs/x#uebung-2",
      label: "Lektion 3",
    });
  });

  // A hit with no page is the shipped template's every hit — the handbook has
  // no served page. "No marker" has to be the quiet, ordinary answer.
  it("answers null for a hit with no page", () => {
    expect(contentLinkMarker(null, "uebung-2", "Lektion 3")).toBeNull();
    expect(contentLinkMarker("", null, "Lektion 3")).toBeNull();
  });

  it("answers null — never a partial marker — for every refused target", () => {
    for (const target of BAD) {
      expect(contentLinkMarker(target, null, "Label"), target).toBeNull();
    }
  });

  it("refuses an anchor that is not in the project's slug grammar", () => {
    expect(contentLinkMarker("/dashboard/kurs", "Not A Slug", "X")).toBeNull();
    expect(contentLinkMarker("/dashboard/kurs", "a#b", "X")).toBeNull();
    // …and accepts what slugifyAnchor actually produces, which is the pair
    // that has to agree in practice.
    expect(
      contentLinkMarker("/dashboard/kurs", slugifyAnchor("Köder & Führung"), "X"),
    ).toBe("[link:/dashboard/kurs#koeder-fuehrung|X]");
  });

  it("refuses a label that cannot be expressed, rather than mangling it", () => {
    for (const label of ["", "   ", "Knoten | Basics", "Knoten ] Basics", "a\nb", "a\rb"]) {
      expect(contentLinkMarker("/dashboard/kurs", null, label), label).toBeNull();
    }
    expect(contentLinkMarker("/dashboard/kurs", null, null as unknown as string)).toBeNull();
  });

  it("trims a label rather than refusing it for stray whitespace", () => {
    expect(contentLinkMarker("/dashboard/kurs", null, "  Der Kurs  ")).toBe(
      "[link:/dashboard/kurs|Der Kurs]",
    );
  });

  // The target's ceiling bounded only the target. A title comes from a source
  // the customer registered, so in an app with member-authored content it is a
  // string somebody typed — and an unbounded one went onto the wire and into
  // `chat_messages.links` for good.
  it("refuses a label past MAX_LINK_LABEL_CHARS and accepts one exactly on it", () => {
    const onTheLimit = "a".repeat(MAX_LINK_LABEL_CHARS);
    expect(contentLinkMarker("/dashboard/kurs", null, onTheLimit)).toBe(
      `[link:/dashboard/kurs|${onTheLimit}]`,
    );
    expect(contentLinkMarker("/dashboard/kurs", null, `${onTheLimit}b`)).toBeNull();
  });

  // `trim()` does not remove these and JS `\s` does not match them, so the
  // label grammar accepted every one: an invisible link, or link text reading
  // differently from the string that was stored and whitelisted.
  it("refuses a label carrying zero-width, bidi or control characters", () => {
    const hostile = [
      "\u200B", // zero-width space: a link with no visible text at all
      "Lektion\u200B3",
      "Lektion \u202E3", // right-to-left override
      "Lektion \u200F3", // right-to-left mark
      "Lektion\u2060 3", // word joiner
      "Lektion\uFEFF3", // zero-width no-break space
      "Lektion\u00013", // C0 control
      "Lektion\u20283", // line separator
    ];
    for (const label of hostile) {
      expect(contentLinkMarker("/dashboard/kurs", null, label), JSON.stringify(label)).toBeNull();
    }
  });

  it("still accepts the ordinary accented and punctuated titles a course has", () => {
    for (const label of [
      "Lektion 3: Knoten binden",
      "Wehen & Atmung — Grundlagen",
      "Übung 2 (fortgeschritten)",
      "„Der Anfang“",
    ]) {
      expect(contentLinkMarker("/dashboard/kurs", null, label), label).not.toBeNull();
    }
  });
});

describe("parseContentLinkMarker", () => {
  it("answers null for anything that is not a whole, well-formed marker", () => {
    for (const candidate of [
      "[link:/a|L",
      "link:/a|L]",
      "[link:/a]",
      "[link://evil.com/x|L]",
      "[link:https://evil.com|L]",
      "[media:a/b.mp4|L]",
      "x [link:/a|L]",
      "[link:/a|L] x",
      "",
    ]) {
      expect(parseContentLinkMarker(candidate), candidate).toBeNull();
    }
  });
});
