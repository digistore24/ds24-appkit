// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The four traps of Gemini's native API, each asserted.
//
// Every one of them fails silently or plausibly rather than loudly, which is
// why they are tested rather than merely commented.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GEMINI_BASE_URL,
  buildBody,
  endpointFor,
  geminiAdapter,
  idSequence,
  stopReasonFrom,
  textFrom,
  toolCallsFrom,
  usageFrom,
} from "./gemini";
import {
  unexplainedTokens,
  type NormalizedRequest,
  type ToolDefinition,
} from "./types";

const REQUEST: NormalizedRequest = {
  model: "gemini-2.5-pro",
  system: [
    { text: "You are a helpful assistant.", cacheable: true },
    { text: "Today is 2026-07-25." },
  ],
  messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "again" },
  ],
  maxTokens: 512,
  timeoutMs: 1000,
};

afterEach(() => vi.unstubAllGlobals());

describe("buildBody", () => {
  it("puts the system prompt in systemInstruction, not in contents", () => {
    // Trap 2. Sent as a turn it becomes part of the conversation the model can
    // be talked out of.
    const body = buildBody(REQUEST);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "You are a helpful assistant.\n\nToday is 2026-07-25." }],
    });
    const contents = body.contents as { role: string }[];
    expect(contents.every((c) => c.role !== "system")).toBe(true);
  });

  it("calls the assistant 'model', not 'assistant'", () => {
    // Trap 1. Gemini rejects `assistant`, so a single-turn call works and a
    // multi-turn one fails — the worst way to find out.
    const contents = buildBody(REQUEST).contents as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("keeps the cacheable prefix first, because ordering IS the cache trigger", () => {
    const stable = "You are a helpful assistant.";
    const system = (buildBody(REQUEST).systemInstruction as { parts: { text: string }[] })
      .parts[0].text;
    expect(system.startsWith(stable)).toBe(true);
  });

  it("refuses a prompt whose cacheable block follows a varying one", () => {
    expect(() =>
      buildBody({
        ...REQUEST,
        system: [{ text: "varies" }, { text: "stable", cacheable: true }],
      }),
    ).toThrow(/cacheable block follows/);
  });

  it("merges generationConfig rather than replacing it", () => {
    // An Operator setting thinkingConfig must not lose maxOutputTokens.
    const body = buildBody({
      ...REQUEST,
      providerOptions: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } },
    });
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it("passes other providerOptions through verbatim", () => {
    const body = buildBody({ ...REQUEST, providerOptions: { safetySettings: [] } });
    expect(body.safetySettings).toEqual([]);
  });

  it("never sends cacheTtl — implicit caching is earned by the block order", () => {
    // Same trap as in openai-compat.test.ts: a task moved here from Anthropic
    // keeps that key in its binding, and Google would refuse a request naming
    // a field it never defined.
    const body = buildBody({ ...REQUEST, providerOptions: { cacheTtl: "1h" } });
    expect(body).not.toHaveProperty("cacheTtl");
  });

  it("omits systemInstruction entirely when there is no system prompt", () => {
    expect(buildBody({ ...REQUEST, system: [] })).not.toHaveProperty("systemInstruction");
  });
});

// ── Tools ───────────────────────────────────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "content_search",
    description: "Searches the app's content.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
];

describe("buildBody with tools", () => {
  it("declares tools as functionDeclarations and omits toolConfig by default", () => {
    const body = buildBody({ ...REQUEST, tools: TOOLS });
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "content_search",
            description: "Searches the app's content.",
            parameters: TOOLS[0].inputSchema,
          },
        ],
      },
    ]);
    expect(body).not.toHaveProperty("toolConfig");
  });

  it("forces a text answer with mode NONE when asked", () => {
    const body = buildBody({ ...REQUEST, tools: TOOLS, toolChoice: "none" });
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: "NONE" } });
  });

  it("sends NEITHER field without tools", () => {
    for (const req of [REQUEST, { ...REQUEST, tools: [] }]) {
      const body = buildBody(req);
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("toolConfig");
    }
  });

  it("a stale binding key cannot clobber the tool wiring", () => {
    const body = buildBody({
      ...REQUEST,
      tools: TOOLS,
      providerOptions: { tools: "stale", toolConfig: "stale" },
    });
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body).not.toHaveProperty("toolConfig");
  });

  it("replays a model turn with functionCall parts after its narration", () => {
    const body = buildBody({
      ...REQUEST,
      messages: [
        {
          role: "assistant",
          content: "Looking.",
          toolCalls: [{ id: "call_1", name: "content_search", input: { query: "x" } }],
        },
      ],
    });
    expect((body.contents as unknown[])[0]).toEqual({
      role: "model",
      parts: [
        { text: "Looking." },
        { functionCall: { name: "content_search", args: { query: "x" } } },
      ],
    });
  });

  it("sends a round's results as functionResponse parts on ONE user turn, matched by name", () => {
    const body = buildBody({
      ...REQUEST,
      messages: [
        {
          role: "tool",
          results: [
            { toolCallId: "call_1", name: "search", content: "found" },
            { toolCallId: "call_2", name: "get", content: "toolFailed", isError: true },
          ],
        },
      ],
    });
    expect((body.contents as unknown[])[0]).toEqual({
      role: "user",
      parts: [
        { functionResponse: { name: "search", response: { result: "found" } } },
        { functionResponse: { name: "get", response: { error: "toolFailed" } } },
      ],
    });
  });
});

describe("toolCallsFrom", () => {
  it("reads functionCall parts beside text and synthesizes ids in order", () => {
    const calls = toolCallsFrom(
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "Let me see." },
                { functionCall: { name: "search", args: { query: "x" } } },
                { functionCall: { name: "get", args: { ref: "a" } } },
              ],
            },
          },
        ],
      },
      idSequence(),
    );
    expect(calls).toEqual([
      { id: "call_1", name: "search", input: { query: "x" } },
      { id: "call_2", name: "get", input: { ref: "a" } },
    ]);
  });

  it("normalizes missing args to an empty object", () => {
    const calls = toolCallsFrom(
      { candidates: [{ content: { parts: [{ functionCall: { name: "a" } }] } }] },
      idSequence(),
    );
    expect(calls).toEqual([{ id: "call_1", name: "a", input: {} }]);
  });

  it("answers empty for a text-only candidate", () => {
    expect(
      toolCallsFrom({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }, idSequence()),
    ).toEqual([]);
  });
});

describe("endpointFor", () => {
  it("asks for SSE when streaming", () => {
    // Trap 3. Without alt=sse the endpoint answers with one JSON array — a call
    // that looks like it worked and delivers nothing incrementally.
    expect(endpointFor("gemini-2.5-pro", true)).toBe(
      `${GEMINI_BASE_URL}/models/gemini-2.5-pro:streamGenerateContent?alt=sse`,
    );
  });

  it("uses generateContent without it when not streaming", () => {
    expect(endpointFor("gemini-2.5-pro", false)).toBe(
      `${GEMINI_BASE_URL}/models/gemini-2.5-pro:generateContent`,
    );
  });

  it("accepts a model that already carries the models/ prefix", () => {
    expect(endpointFor("models/gemini-2.5-pro", false)).toBe(
      `${GEMINI_BASE_URL}/models/gemini-2.5-pro:generateContent`,
    );
  });
});

describe("usageFrom", () => {
  it("adds thinking tokens to output, because Google reports them alongside", () => {
    // The reason this adapter exists at all. `candidatesTokenCount` is the
    // VISIBLE output; thinking is billed too and sits beside it, unlike
    // OpenAI's reasoning_tokens which are already inside completion_tokens.
    const usage = usageFrom({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      thoughtsTokenCount: 60,
      totalTokenCount: 200,
    })!;
    expect(usage.outputTokens).toBe(100);
    expect(usage.thinkingTokens).toBe(60);
  });

  it("leaves nothing unexplained once thinking is counted", () => {
    const usage = usageFrom({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      thoughtsTokenCount: 60,
      totalTokenCount: 200,
    })!;
    expect(unexplainedTokens(usage)).toBe(0);
  });

  it("shows up in the reconciliation if the thinking field is ever renamed", () => {
    // The guard behind the guard: a rename makes thinking read zero, and the
    // reported total then exceeds the parts. That is a signal, not silence.
    const usage = usageFrom({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      totalTokenCount: 200,
    })!;
    expect(usage.thinkingTokens).toBe(0);
    expect(unexplainedTokens(usage)).toBe(60);
  });

  it("reads cached input, which is what implicit caching reports", () => {
    const usage = usageFrom({
      promptTokenCount: 1000,
      cachedContentTokenCount: 900,
      candidatesTokenCount: 10,
    })!;
    expect(usage.cachedInputTokens).toBe(900);
    expect(usage.inputTokens).toBe(1000);
  });

  it("returns null when the provider reported nothing", () => {
    // Null is not zero: zero is a call that consumed nothing, null is a call
    // nobody measured.
    expect(usageFrom(undefined)).toBeNull();
    expect(usageFrom(null)).toBeNull();
  });
});

describe("textFrom / stopReasonFrom", () => {
  it("joins every text part of the first candidate", () => {
    expect(
      textFrom({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }),
    ).toBe("ab");
  });

  it("is empty rather than throwing on an answer with no candidates", () => {
    expect(textFrom({})).toBe("");
    expect(textFrom({ candidates: [] })).toBe("");
    expect(stopReasonFrom({})).toBeNull();
  });
});

// ── The streaming trap, end to end ──────────────────────────────────────────

function sseResponse(...events: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe("streaming", () => {
  it("takes the LAST usageMetadata and never sums, because it is cumulative", async () => {
    // Trap 4, and the most dangerous of the four: summing produces a plausible
    // number several times too large — the kind of wrong that survives review
    // because it is the right order of magnitude.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          {
            candidates: [{ content: { parts: [{ text: "Hel" }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1, totalTokenCount: 101 },
          },
          {
            candidates: [{ content: { parts: [{ text: "lo" }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2, totalTokenCount: 102 },
          },
          {
            candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 3, totalTokenCount: 103 },
          },
        ),
      ),
    );

    const events = [];
    for await (const event of geminiAdapter.stream(REQUEST, "test-key")) events.push(event);

    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text))
      .toEqual(["Hel", "lo"]);

    const done = events.at(-1) as { type: "done"; usage: { inputTokens: number; outputTokens: number } };
    expect(done.type).toBe("done");
    // 100, not 300. 3, not 6.
    expect(done.usage.inputTokens).toBe(100);
    expect(done.usage.outputTokens).toBe(3);
  });

  it("sends the key as a header, never in the query string", async () => {
    // A `?key=` lands in every access log, proxy log and browser history it
    // passes through.
    const fetchMock = vi.fn(async () => sseResponse({ candidates: [] }));
    vi.stubGlobal("fetch", fetchMock);

    // Drained rather than inspected — this test is about the request, not the answer.
    for await (const event of geminiAdapter.stream(REQUEST, "secret-key")) void event;

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  });

  it("reports no usage as null rather than as zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse({ candidates: [] })));

    const events = [];
    for await (const event of geminiAdapter.stream(REQUEST, "k")) events.push(event);

    expect((events.at(-1) as { usage: unknown }).usage).toBeNull();
  });

  it("yields functionCall parts as complete tool_call events, ids distinct across chunks", async () => {
    // Parts are new per chunk (never resent), so calls stream out as they
    // appear — unlike the compat adapter, which must accumulate fragments.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          {
            candidates: [
              {
                content: {
                  parts: [
                    { text: "Checking." },
                    { functionCall: { name: "content_search", args: { query: "knots" } } },
                  ],
                },
              },
            ],
          },
          {
            candidates: [
              { content: { parts: [{ functionCall: { name: "content_get", args: { ref: "a" } } }] } },
            ],
          },
        ),
      ),
    );

    const events = [];
    for await (const event of geminiAdapter.stream({ ...REQUEST, tools: TOOLS }, "k")) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual(["delta", "tool_call", "tool_call", "done"]);
    const calls = events
      .filter((e) => e.type === "tool_call")
      .map((e) => (e as { call: { id: string; name: string } }).call);
    expect(calls.map((c) => c.id)).toEqual(["call_1", "call_2"]);
    expect(calls.map((c) => c.name)).toEqual(["content_search", "content_get"]);
  });
});

describe("failure", () => {
  it("maps an HTTP status to a typed outcome", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
    await expect(geminiAdapter.complete(REQUEST, "k")).rejects.toMatchObject({
      code: "providerRefused",
      provider: "gemini",
    });
  });

  it("treats a missing key as noCredential rather than a server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(geminiAdapter.complete(REQUEST, "k")).rejects.toMatchObject({
      code: "noCredential",
    });
  });

  it("reports a dead socket as unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(geminiAdapter.complete(REQUEST, "k")).rejects.toMatchObject({
      code: "providerUnreachable",
    });
  });
});
