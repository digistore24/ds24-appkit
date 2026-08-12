// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import type { KnowledgeBase, KnowledgeDoc } from "@/lib/ai/knowledge";

import { HANDBOOK_SOURCE_ID, handbookSourceFor, knowledgeSource } from "./knowledge-source";

const VIEWER = { memberId: "m-1", role: "member" };

function base(docs: KnowledgeDoc[]): KnowledgeBase {
  return { docs, problems: [], chars: docs.reduce((n, d) => n + d.body.length, 0) };
}

const DOCS: KnowledgeDoc[] = [
  {
    path: "10-reference/knoten.md",
    section: "reference",
    title: "Knoten und Montagen",
    summary: "Which knots the course teaches.",
    updated: null,
    body: [
      "The overview paragraph about knots.",
      "",
      "## Der Clinch-Knoten",
      "",
      "Step by step, with the video: [media:knoten/clinch.mp4|Clinch-Knoten Schritt für Schritt]",
      "",
      "## Der Schlaufenknoten",
      "",
      "A different technique entirely, about loops.",
    ].join("\n"),
  },
  {
    path: "20-howto/kaufen.md",
    section: "howto",
    title: "Den Kurs kaufen",
    summary: "How to buy.",
    updated: null,
    body: "Go to the plans page and buy.",
  },
];

const source = handbookSourceFor(() => base(DOCS));

describe("the handbook source", () => {
  it("finds a doc by a term in a section and returns section hits", async () => {
    const hits = await source.search("Schlaufenknoten", VIEWER, 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sourceId).toBe(HANDBOOK_SOURCE_ID);
    // The section hit is addressable via its ref suffix…
    const sectionHit = hits.find((h) => h.kind === "section");
    expect(sectionHit?.ref).toBe("10-reference/knoten.md#der-schlaufenknoten");
    // …and every handbook hit is honest about having no page.
    for (const hit of hits) {
      expect(hit.url).toBeNull();
      expect(hit.anchor).toBeNull();
    }
  });

  it("round-trips a search hit's ref through get()", async () => {
    const hits = await source.search("Schlaufenknoten", VIEWER, 10);
    const doc = await source.get(hits[0].ref, VIEWER);
    expect(doc).not.toBeNull();
    expect(doc?.body).toContain("loops");
  });

  it("returns the whole doc with its section anchors", async () => {
    const doc = await source.get("10-reference/knoten.md", VIEWER);
    expect(doc?.sections.map((s) => s.anchor)).toEqual([
      "der-clinch-knoten",
      "der-schlaufenknoten",
    ]);
    expect(doc?.media).toEqual([
      {
        path: "knoten/clinch.mp4",
        kind: "video",
        alt: "Clinch-Knoten Schritt für Schritt",
        anchor: null,
      },
    ]);
  });

  it("answers null for a missing ref and a missing section alike", async () => {
    expect(await source.get("nope.md", VIEWER)).toBeNull();
    expect(await source.get("10-reference/knoten.md#missing", VIEWER)).toBeNull();
  });

  it("lists the table of contents in doc order", async () => {
    const toc = await source.list!(VIEWER);
    expect(toc.map((e) => e.ref)).toEqual([
      "10-reference/knoten.md",
      "20-howto/kaufen.md",
    ]);
    expect(toc[0].summary).toBe("Which knots the course teaches.");
  });

  it("finds media by label terms, never returning a byte URL", async () => {
    const hits = await source.findMedia!("clinch", VIEWER, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("media");
    expect(hits[0].media?.path).toBe("knoten/clinch.mp4");
    expect(hits[0].url).toBeNull();
  });

  it("lists all media when the query is empty", async () => {
    const hits = await source.findMedia!("", VIEWER, 10);
    expect(hits).toHaveLength(1);
  });

  it("the shipped source is this source over loadKnowledge", () => {
    expect(knowledgeSource.id).toBe(HANDBOOK_SOURCE_ID);
    expect(typeof knowledgeSource.search).toBe("function");
  });
});
