// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The four standard content tools, exercised against the shipped handbook
// source — no database, no store. `tools.test.ts`'s registry invariants cover
// their shapes automatically; this file covers their behaviour.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { findTool, type ToolContext } from "./tools";
import { createLinkLedger, type LinkLedger } from "./content-links";
import { loadKnowledge } from "./knowledge";
import { notChecked } from "@/lib/test-not-checked";

/**
 * A context whose ledger can be inspected afterwards. The default `ctx` below
 * gets a real ledger rather than a stub, so "what would the assistant have
 * been allowed to link to" is a question these tests can actually ask.
 */
function contextWith(links: LinkLedger): ToolContext {
  return {
    memberId: "member-1",
    spend: vi.fn(async () => 0),
    offerLink: (url, anchor, label) => links.offer(url, anchor, label),
  };
}

/**
 * A query built from the handbook THIS app has.
 *
 * 🚨 It was the literal `"account password"`, with a comment naming the file it
 * came from — `content/knowledge/10-reference/account.md`, one of the six
 * examples the skill `ai-chat-knowledge` tells the user to REPLACE. So five
 * tests in this file went red in every app that used the feature they test, two
 * of them by dereferencing `hits[0]` of an empty array. A test that names
 * shipped example data is a test with an expiry date.
 *
 * The most frequent long word in the handbook is a query that hits whatever
 * that handbook is about, in any language, without knowing anything about it.
 */
const HANDBOOK_QUERY = (() => {
  const counts = new Map<string, number>();
  for (const doc of loadKnowledge().docs) {
    for (const word of `${doc.title} ${doc.body}`.toLowerCase().match(/\p{L}{5,}/gu) ?? []) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return best?.[0] ?? null;
})();

/** The reason the handbook tests print when there is nothing to search. */
const NO_HANDBOOK =
  "content/knowledge/ holds no document with a searchable word in it — this " +
  "app has emptied the handbook (or has not written one yet), so what these " +
  "tools return for a real query cannot be measured here. `node run.mjs " +
  "kb-check` is where an empty handbook is a finding.";

let ledger = createLinkLedger();
let ctx: ToolContext = contextWith(ledger);

const search = findTool("content_search")!;
const get = findTool("content_get")!;
const list = findTool("content_list")!;
const media = findTool("content_media")!;

function dataOf(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  delete process.env.APP_URL;
  ledger = createLinkLedger();
  ctx = contextWith(ledger);
});
afterEach(() => {
  delete process.env.APP_URL;
});

describe("content_search", () => {
  it("re-validates the query — the schema is a hint, not a check", async () => {
    for (const bad of [{}, { query: "" }, { query: "x" }, { query: 42 }]) {
      const result = await search.run(bad as Record<string, unknown>, ctx);
      expect(result.isError).toBe(true);
    }
  });

  it("finds the shipped handbook and reports truncation honestly", async (t) => {
    if (!HANDBOOK_QUERY) return notChecked(t, NO_HANDBOOK);
    const result = await search.run({ query: HANDBOOK_QUERY }, ctx);
    expect(result.isError).not.toBe(true);
    const data = dataOf(result);
    const hits = data.hits as { sourceId: string; url: string | null }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sourceId).toBe("handbook");
    expect(data.returned).toBe(hits.length);
    expect(typeof data.truncated).toBe("boolean");
  });

  it("absolutizes urls only when APP_URL is set — and never invents one", async (t) => {
    if (!HANDBOOK_QUERY) return notChecked(t, NO_HANDBOOK);
    process.env.APP_URL = "https://app.example.com";
    const result = await search.run({ query: HANDBOOK_QUERY }, ctx);
    const hits = dataOf(result).hits as { url: string | null }[];
    for (const hit of hits) {
      // Handbook hits have no page; a null url must survive absolutization.
      expect(hit.url).toBeNull();
    }
  });
});

describe("content_get", () => {
  it("round-trips a ref from content_search", async (t) => {
    if (!HANDBOOK_QUERY) return notChecked(t, NO_HANDBOOK);
    const found = await search.run({ query: HANDBOOK_QUERY }, ctx);
    const hits = dataOf(found).hits as { ref: string }[];
    const result = await get.run({ source: "handbook", ref: hits[0].ref }, ctx);
    expect(result.isError).not.toBe(true);
    const doc = dataOf(result);
    expect(typeof doc.body).toBe("string");
    expect(Array.isArray(doc.sections)).toBe(true);
  });

  it("names content_list for an unknown source", async () => {
    const result = await get.run({ source: "nope", ref: "whatever" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("content_list");
  });

  it("answers a missing ref as a failure naming content_list, not a throw", async () => {
    const result = await get.run({ source: "handbook", ref: "no-such.md" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("content_list");
  });

  it("requires both arguments", async () => {
    const result = await get.run({ source: "handbook" }, ctx);
    expect(result.isError).toBe(true);
  });
});

describe("content_list", () => {
  it("lists the handbook source with its label and entries", async () => {
    const result = await list.run({}, ctx);
    expect(result.isError).not.toBe(true);
    const sources = dataOf(result).sources as {
      sourceId: string;
      label: string;
      entries: unknown[];
    }[];
    const handbook = sources.find((s) => s.sourceId === "handbook");
    expect(handbook).toBeDefined();
    expect(handbook!.label.length).toBeGreaterThan(0);
    expect(handbook!.entries.length).toBeGreaterThan(0);
  });

  it("an unknown source filter answers well-formed and empty", async () => {
    const result = await list.run({ source: "nope" }, ctx);
    expect(result.isError).not.toBe(true);
    expect(dataOf(result).sources).toEqual([]);
  });
});

describe("content_media", () => {
  it("answers well-formed when the handbook carries no media", async () => {
    const result = await media.run({}, ctx);
    expect(result.isError).not.toBe(true);
    const data = dataOf(result);
    expect(Array.isArray(data.hits)).toBe(true);
    expect(data.returned).toBe((data.hits as unknown[]).length);
  });
});

describe("the shipped template offers no links at all", () => {
  // THE property that makes this feature inert on a fresh app with no switch
  // to set: the handbook has no served page, so every hit is `url: null`,
  // nothing is offered, the ledger stays empty, and the parser's empty set
  // denies every marker the model could invent. There is deliberately no
  // `config/content-links.json` — this "off" is a consequence of the content.
  it("no search hit carries a link field", async (t) => {
    if (!HANDBOOK_QUERY) return notChecked(t, NO_HANDBOOK);
    const result = await search.run({ query: HANDBOOK_QUERY }, ctx);
    const hits = dataOf(result).hits as Record<string, unknown>[];
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.url).toBeNull();
      // Absent, never `link: null` — a null field on every result is one more
      // thing for the model to read and dismiss.
      expect("link" in hit).toBe(false);
    }
    expect(ledger.markers()).toEqual([]);
  });

  it("no table-of-contents entry carries a link field", async () => {
    const result = await list.run({}, ctx);
    const sources = dataOf(result).sources as { entries: Record<string, unknown>[] }[];
    for (const source of sources) {
      for (const entry of source.entries) {
        expect("link" in entry).toBe(false);
      }
    }
    expect(ledger.markers()).toEqual([]);
  });

  it("a fetched document and its sections carry no link field", async (t) => {
    if (!HANDBOOK_QUERY) return notChecked(t, NO_HANDBOOK);
    const found = await search.run({ query: HANDBOOK_QUERY }, ctx);
    const hits = dataOf(found).hits as { ref: string }[];
    const result = await get.run({ source: "handbook", ref: hits[0].ref }, ctx);
    const doc = dataOf(result);
    expect("link" in doc).toBe(false);
    for (const section of doc.sections as Record<string, unknown>[]) {
      expect("link" in section).toBe(false);
    }
    expect(ledger.markers()).toEqual([]);
  });

  it("an invented ref fails and offers nothing", async () => {
    const result = await get.run({ source: "handbook", ref: "erfunden/gibt-es-nicht" }, ctx);
    expect(result.isError).toBe(true);
    expect(ledger.markers()).toEqual([]);
  });
});
