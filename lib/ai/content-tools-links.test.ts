// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The delivery layer's link composition, against a source that HAS pages.
//
// The shipped registry holds only the handbook, whose every hit is `url: null`
// — `content-tools.test.ts` pins exactly that, and it is why a fresh template
// offers no links at all. This file is the other half: the content-source
// registry is mocked into the shape an app has once it builds a course, and
// everything here is what a customer's app will actually see.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ContentDocument, ContentHit, ContentTocEntry } from "@/lib/content-source/types";

const UNIT: ContentHit = {
  sourceId: "kurs",
  ref: "knoten-basics",
  kind: "section",
  title: "Lektion 3: Knoten binden",
  snippet: "Der Palstek ist der wichtigste Knoten …",
  url: "/dashboard/kurs/knoten-basics",
  anchor: "uebung-2",
};

const VIDEO: ContentHit = {
  sourceId: "kurs",
  ref: "knoten-basics#video",
  kind: "media",
  title: "Das Video zu Lektion 3",
  snippet: "Sechs Minuten, mit Untertiteln",
  url: "/dashboard/kurs/knoten-basics",
  anchor: "media-knoten-palstek-mp4",
  media: { path: "knoten/palstek.mp4", kind: "video", alt: null },
};

const DOC: ContentDocument = {
  sourceId: "kurs",
  ref: "knoten-basics",
  title: "Knoten-Basics",
  url: "/dashboard/kurs/knoten-basics",
  body: "…",
  sections: [
    { anchor: "einfuehrung", title: "Einführung" },
    { anchor: "uebung-2", title: "Übung 2" },
  ],
  media: [],
};

const TOC: ContentTocEntry = {
  sourceId: "kurs",
  ref: "knoten-basics",
  title: "Knoten-Basics",
  summary: null,
  url: "/dashboard/kurs/knoten-basics",
};

vi.mock("@/lib/content-source/query", () => ({
  searchAllSources: vi.fn(async () => [UNIT]),
  getFromSource: vi.fn(async () => DOC),
  listSources: vi.fn(async () => [
    { sourceId: "kurs", label: "Der Kurs", entries: [TOC] },
  ]),
  findMediaAcrossSources: vi.fn(async () => [VIDEO]),
}));

import { findTool, type ToolContext } from "./tools";
import { createLinkLedger, type LinkLedger } from "./content-links";

const search = findTool("content_search")!;
const get = findTool("content_get")!;
const list = findTool("content_list")!;
const media = findTool("content_media")!;

function dataOf(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

let ledger: LinkLedger;
let ctx: ToolContext;

beforeEach(() => {
  delete process.env.APP_URL;
  ledger = createLinkLedger();
  ctx = {
    memberId: "member-1",
    spend: vi.fn(async () => 0),
    offerLink: (url, anchor, label) => ledger.offer(url, anchor, label),
  };
});
afterEach(() => {
  delete process.env.APP_URL;
});

describe("content_search", () => {
  it("gives a hit that has a page a ready-made marker", async () => {
    const hits = dataOf(await search.run({ query: "knoten" }, ctx)).hits as Record<
      string,
      unknown
    >[];
    expect(hits[0].link).toBe(
      "[link:/dashboard/kurs/knoten-basics#uebung-2|Lektion 3: Knoten binden]",
    );
    expect(ledger.markers()).toEqual([hits[0].link]);
  });

  // 🚨 The ordering bug this whole seam is arranged to avoid. An absolute
  // marker would put APP_URL into an href and into the stored transcript for
  // ever, and a move to a new domain would freeze every old link on the old one.
  it("composes the marker from the RELATIVE url, before absolutizing", async () => {
    process.env.APP_URL = "https://app.example.com";
    const hits = dataOf(await search.run({ query: "knoten" }, ctx)).hits as Record<
      string,
      unknown
    >[];
    expect(hits[0].url).toBe("https://app.example.com/dashboard/kurs/knoten-basics");
    expect(hits[0].link).toBe(
      "[link:/dashboard/kurs/knoten-basics#uebung-2|Lektion 3: Knoten binden]",
    );
    expect(String(hits[0].link)).not.toContain("app.example.com");
  });
});

describe("content_get", () => {
  it("offers the document AND one marker per section", async () => {
    // The difference between "in Lektion 3" and "in Lektion 3, ab der zweiten
    // Übung" — the reason sections carry their own.
    const doc = dataOf(await get.run({ source: "kurs", ref: "knoten-basics" }, ctx));
    expect(doc.link).toBe("[link:/dashboard/kurs/knoten-basics|Knoten-Basics]");
    const sections = doc.sections as Record<string, unknown>[];
    expect(sections.map((section) => section.link)).toEqual([
      "[link:/dashboard/kurs/knoten-basics#einfuehrung|Knoten-Basics — Einführung]",
      "[link:/dashboard/kurs/knoten-basics#uebung-2|Knoten-Basics — Übung 2]",
    ]);
    expect(ledger.markers()).toHaveLength(3);
  });
});

describe("content_list", () => {
  it("gives every table-of-contents entry its marker", async () => {
    const sources = dataOf(await list.run({}, ctx)).sources as {
      entries: Record<string, unknown>[];
    }[];
    expect(sources[0].entries[0].link).toBe(
      "[link:/dashboard/kurs/knoten-basics|Knoten-Basics]",
    );
  });
});

describe("content_media", () => {
  it("links the PAGE that shows the medium, at the medium's anchor", async () => {
    // Never the bytes: a signed URL expires and bypasses mayAccess().
    const hits = dataOf(await media.run({}, ctx)).hits as Record<string, unknown>[];
    expect(hits[0].link).toBe(
      "[link:/dashboard/kurs/knoten-basics#media-knoten-palstek-mp4|Das Video zu Lektion 3]",
    );
  });
});

describe("across one answer", () => {
  it("does not offer the same page twice when two tools find it", async () => {
    await search.run({ query: "knoten" }, ctx);
    await search.run({ query: "palstek" }, ctx);
    expect(ledger.markers()).toHaveLength(1);
  });
});
