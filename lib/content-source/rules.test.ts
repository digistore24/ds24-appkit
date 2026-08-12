// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import {
  MAX_SEARCH_TERMS,
  SNIPPET_MAX_CHARS,
  rankRecords,
  scoreRecord,
  searchTerms,
  snippetFor,
  type SearchableRecord,
} from "./rules";

function record(ref: string, title: string, body: string): SearchableRecord {
  return { ref, title, body };
}

describe("searchTerms", () => {
  it("lowercases and splits on anything that is not a letter or digit", () => {
    expect(searchTerms("Köder-Wahl und Führung!")).toEqual([
      "köder",
      "wahl",
      "und",
      "führung",
    ]);
  });

  it("keeps umlauts — the split is unicode-aware", () => {
    expect(searchTerms("Übung")).toEqual(["übung"]);
  });

  it("drops terms under two characters and deduplicates", () => {
    expect(searchTerms("a b knoten x knoten")).toEqual(["knoten"]);
  });

  it("caps the term count so a pasted paragraph cannot become a scan", () => {
    const query = Array.from({ length: 20 }, (_, i) => `term${i}`).join(" ");
    expect(searchTerms(query)).toHaveLength(MAX_SEARCH_TERMS);
  });

  it("answers an empty list for junk input", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("! ? .")).toEqual([]);
  });
});

describe("scoreRecord", () => {
  it("scores a title hit above any capped amount of body hits", () => {
    const inTitle = scoreRecord(record("a", "Knoten binden", "nothing here"), ["knoten"]);
    const inBody = scoreRecord(
      record("b", "Other", "knoten ".repeat(50)),
      ["knoten"],
    );
    expect(inTitle).toBeGreaterThan(inBody);
  });

  it("caps body frequency — frequency is a signal, not the verdict", () => {
    const five = scoreRecord(record("a", "x", "knoten ".repeat(5)), ["knoten"]);
    const fifty = scoreRecord(record("a", "x", "knoten ".repeat(50)), ["knoten"]);
    expect(fifty).toBe(five);
  });

  it("answers zero when no term matches", () => {
    expect(scoreRecord(record("a", "Title", "body"), ["missing"])).toBe(0);
    expect(scoreRecord(record("a", "Title", "body"), [])).toBe(0);
  });
});

describe("rankRecords", () => {
  const records = [
    record("body-hit", "Nothing", "the knoten shows up once"),
    record("title-hit", "Knoten binden", "unrelated"),
    record("no-hit", "Other", "unrelated"),
  ];

  it("orders title hits before body hits and drops non-matches", () => {
    const ranked = rankRecords(records, "knoten", 10);
    expect(ranked.map((r) => r.ref)).toEqual(["title-hit", "body-hit"]);
  });

  it("keeps the input order as the tie-break", () => {
    const tied = [
      record("first", "x", "knoten"),
      record("second", "y", "knoten"),
    ];
    expect(rankRecords(tied, "knoten", 10).map((r) => r.ref)).toEqual([
      "first",
      "second",
    ]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => record(`r${i}`, "knoten", ""));
    expect(rankRecords(many, "knoten", 7)).toHaveLength(7);
  });

  it("answers nothing for a query with no usable terms", () => {
    expect(rankRecords(records, "!", 10)).toEqual([]);
  });
});

describe("snippetFor", () => {
  it("returns a short body whole", () => {
    expect(snippetFor("A short body.", ["short"])).toBe("A short body.");
  });

  it("collapses newlines and runs of whitespace to single spaces", () => {
    expect(snippetFor("line one\n\nline   two", ["line"])).toBe("line one line two");
  });

  it("centers the window on the first matching term with ellipses", () => {
    const body = `${"start ".repeat(100)}NEEDLE${" end".repeat(100)}`;
    const snippet = snippetFor(body, ["needle"]);
    expect(snippet).toContain("NEEDLE");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2);
  });

  it("falls back to the head of the body when no term occurs", () => {
    const body = "word ".repeat(200);
    const snippet = snippetFor(body, ["missing"]);
    expect(snippet.startsWith("word")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("cuts on word boundaries, not through a word", () => {
    const body = `${"alpha ".repeat(80)}omega`;
    const snippet = snippetFor(body, ["missing"]);
    // The cut must land after a complete "alpha", never inside one.
    expect(snippet.replace("…", "").trim().split(" ").every((w) => w === "alpha")).toBe(
      true,
    );
  });

  it("handles an empty body", () => {
    expect(snippetFor("", ["x"])).toBe("");
  });
});
