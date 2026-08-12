// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The link whitelist on the wire — the half of Epic 25 that is about ORDER.
//
// Two properties are asserted here and nowhere else, because both are
// invisible in a diff and both look correct while being wrong:
//
//  1. Every `{"type":"link"}` line is written BEFORE the `delta` that carries
//     its marker. Get it backwards and the customer watches raw bracket text
//     sit in the answer and become a link a second later.
//  2. The turn is stored with the markers the answer USED, not with everything
//     the model was offered — and a marker never offered never reaches the
//     wire at all.
//
// The content-source registry is mocked into the shape an app has once it has
// built a course; everything else on the pipeline is stubbed down to the two
// questions above.
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ContentHit } from "@/lib/content-source/types";

const UNIT: ContentHit = {
  sourceId: "kurs",
  ref: "knoten-basics",
  kind: "section",
  title: "Lektion 3: Knoten binden",
  snippet: "Der Palstek …",
  url: "/dashboard/kurs/knoten-basics",
  anchor: "uebung-2",
};

const MARKER = "[link:/dashboard/kurs/knoten-basics#uebung-2|Lektion 3: Knoten binden]";

vi.mock("@/lib/content-source/query", () => ({
  searchAllSources: vi.fn(async () => [UNIT]),
  getFromSource: vi.fn(async () => null),
  listSources: vi.fn(async () => []),
  findMediaAcrossSources: vi.fn(async () => []),
}));

vi.mock("@/lib/ai/chat-config", () => ({
  isChatEnabled: () => true,
  chatConfig: () => ({
    name: "Lia",
    avatar: "/share/chat.png",
    requiresPlan: null,
    maxHistoryTurns: 12,
    maxMessagesPer10Min: 20,
  }),
}));

vi.mock("@/lib/ai/knowledge", () => ({
  loadKnowledge: () => ({
    docs: [
      {
        path: "10-reference/kurs.md",
        section: "reference",
        title: "Der Kurs",
        summary: "Was der Kurs enthält.",
        updated: null,
        body: "Alles über Knoten.",
      },
    ],
    problems: [],
  }),
}));

vi.mock("@/lib/entitlements/manage", () => ({ hasPlan: vi.fn(async () => true) }));
vi.mock("@/lib/rate-limit", () => ({ isLimited: () => false, record: () => {} }));
vi.mock("@/lib/tokens/spend", () => ({ spendTokens: vi.fn(async () => 0) }));
vi.mock("@/lib/ai/conversation", () => ({
  appendTurn: vi.fn(async () => "turn-1"),
  listConversation: vi.fn(async () => []),
}));
vi.mock("@/lib/ai/tool-loop", () => ({ streamTaskWithTools: vi.fn() }));

import { appendTurn, listConversation } from "@/lib/ai/conversation";
import { streamTaskWithTools, type ServerTool } from "@/lib/ai/tool-loop";
import { runChatRequest } from "@/lib/ai/chat-endpoint";

/**
 * Plays one answer: the model calls `content_search` (which is what puts a
 * marker in the ledger), then writes a sentence carrying that marker.
 */
/**
 * ⚠️ The order INSIDE this fixture is load-bearing, and it was wrong once.
 *
 * It used to `execute()` first and yield the `tool` event afterwards. That is
 * the reverse of `lib/ai/tool-loop.ts`, which announces the call and runs it
 * when the round's stream is exhausted — and the difference is the whole
 * discriminating power of the ordering test below. With an event sitting
 * between the offer and the first delta, a drain at the BOTTOM of the loop in
 * `chat-endpoint.ts` still emitted the `link` line during that intervening
 * event's iteration, so the assertion passed either way and pinned nothing.
 *
 * Yielded in the real order, the marker-carrying delta is the very next event
 * after the offer, and a bottom drain puts the delta on the wire first — which
 * is precisely the visible race (AC 4) the design exists to prevent.
 */
function answerUsingLookup(text: string) {
  return (_task: string, _input: unknown, tools: ServerTool[]) =>
    (async function* () {
      const search = tools.find((tool) => tool.definition.name === "content_search")!;
      yield { type: "tool" as const, name: "content_search" };
      await search.execute({ query: "knoten" });
      for (const piece of text.split(" ")) {
        yield { type: "delta" as const, text: `${piece} ` };
      }
    })();
}

async function ask(message = "Wo lerne ich Knoten?"): Promise<string> {
  const response = await runChatRequest({
    memberId: "member-1",
    request: new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
    locale: "de",
  });
  return await response.text();
}

function lines(body: string): { type?: string; text?: string; marker?: string }[] {
  return body
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listConversation).mockResolvedValue([]);
  vi.mocked(appendTurn).mockResolvedValue("turn-1");
});

describe("the link lines", () => {
  it("reach the client BEFORE the delta that uses the marker", async () => {
    vi.mocked(streamTaskWithTools).mockImplementation(
      answerUsingLookup(`Das Thema wird in ${MARKER} erklärt.`) as never,
    );

    const events = lines(await ask());
    const linkAt = events.findIndex(
      (event) => event.type === "link" && event.marker === MARKER,
    );
    const firstDeltaWithMarker = events.findIndex(
      (event) => event.type === "delta" && event.text?.includes("[link:"),
    );

    expect(linkAt).toBeGreaterThanOrEqual(0);
    expect(firstDeltaWithMarker).toBeGreaterThanOrEqual(0);
    expect(linkAt).toBeLessThan(firstDeltaWithMarker);
  });

  // 🚨 THE regression test for where the drain sits, and the only one of these
  // that can tell. The case above splits its sentence on spaces, so the
  // marker's delta arrives several events after the offer and a drain at the
  // BOTTOM of the loop still gets the `link` line out in time — measured, by
  // moving it. The invariant only bites when the marker is in the FIRST event
  // after `execute()` returns, which is exactly the shape a model produces when
  // it opens its answer with the link.
  it("reach the client before a marker carried by the very first delta", async () => {
    vi.mocked(streamTaskWithTools).mockImplementation(
      ((_task: string, _input: unknown, tools: ServerTool[]) =>
        (async function* () {
          const search = tools.find((tool) => tool.definition.name === "content_search")!;
          yield { type: "tool" as const, name: "content_search" };
          await search.execute({ query: "knoten" });
          // One delta, marker included, immediately after the offer.
          yield { type: "delta" as const, text: `${MARKER} erklärt das.` };
        })()) as never,
    );

    const events = lines(await ask());
    const linkAt = events.findIndex(
      (event) => event.type === "link" && event.marker === MARKER,
    );
    const deltaAt = events.findIndex(
      (event) => event.type === "delta" && event.text?.includes("[link:"),
    );

    expect(linkAt).toBeGreaterThanOrEqual(0);
    expect(deltaAt).toBeGreaterThanOrEqual(0);
    expect(linkAt).toBeLessThan(deltaAt);
  });

  it("carry nothing that was never offered", async () => {
    // The model inventing a marker mid-answer must not put it on the wire —
    // only the ledger writes these lines.
    const invented = "[link:/dashboard/kurs/lektion-42|Lektion 42]";
    vi.mocked(streamTaskWithTools).mockImplementation(
      answerUsingLookup(`Siehe ${invented} und ${MARKER}.`) as never,
    );

    const markers = lines(await ask())
      .filter((event) => event.type === "link")
      .map((event) => event.marker);
    expect(markers).toEqual([MARKER]);
    expect(markers).not.toContain(invented);
  });
});

describe("what is stored with the turn", () => {
  it("is what the answer used, not what she was offered", async () => {
    vi.mocked(streamTaskWithTools).mockImplementation(
      answerUsingLookup(`Das Thema wird in ${MARKER} erklärt.`) as never,
    );
    await ask();

    const stored = vi.mocked(appendTurn).mock.calls.map(([args]) => args);
    const answer = stored.find((turn) => turn.role === "assistant")!;
    expect(answer.links).toEqual([MARKER]);
  });

  it("stores nothing when the answer pointed at nothing", async () => {
    // A lookup happened and a marker was offered — she just did not use it.
    vi.mocked(streamTaskWithTools).mockImplementation(
      answerUsingLookup("Dazu weiß ich leider nichts.") as never,
    );
    await ask();

    const answer = vi
      .mocked(appendTurn)
      .mock.calls.map(([args]) => args)
      .find((turn) => turn.role === "assistant")!;
    expect(answer.links).toEqual([]);
  });
});

describe("a marker repeated from an earlier answer", () => {
  it("is still allowed, because the ledger is seeded from the history", async () => {
    // The model SEES its own earlier answers and will repeat a marker without
    // calling a tool again. Without the seed that repeat renders as bracket
    // text, which looks like the feature breaking at random.
    vi.mocked(listConversation).mockResolvedValue([
      {
        id: "t1",
        role: "assistant",
        content: `Siehe ${MARKER}.`,
        links: [MARKER],
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
    ]);
    // This answer makes NO lookup at all — the marker can only come from the seed.
    vi.mocked(streamTaskWithTools).mockImplementation(
      (() =>
        (async function* () {
          yield { type: "delta" as const, text: `Wie gesagt: ${MARKER}` };
        })()) as never,
    );

    const events = lines(await ask());
    expect(
      events.some((event) => event.type === "link" && event.marker === MARKER),
    ).toBe(true);
  });
});
