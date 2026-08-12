// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  buildMessages,
  buildParams,
  buildSystem,
  textFrom,
  toolCallsFrom,
  usageFrom,
} from "./anthropic";
import {
  unexplainedTokens,
  type NormalizedRequest,
  type ToolDefinition,
} from "./types";

const REQUEST: NormalizedRequest = {
  model: "claude-sonnet-5",
  system: [
    { text: "persona", cacheable: true },
    { text: "handbook", cacheable: true },
    { text: "today is 2026-07-25" },
  ],
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 4000,
  timeoutMs: 1000,
};

describe("buildSystem", () => {
  it("puts exactly ONE breakpoint, on the last cacheable block", () => {
    // One and not several: the API allows four, and every extra breakpoint is
    // another prefix to write and pay for. What this layer models is a single
    // boundary — stable before it, varying after.
    const system = buildSystem(REQUEST);
    expect(system.map((b) => Boolean(b.cache_control))).toEqual([false, true, false]);
  });

  it("defaults the cache window to an hour", () => {
    expect(buildSystem(REQUEST)[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("honours a cacheTtl from the binding", () => {
    const system = buildSystem({ ...REQUEST, providerOptions: { cacheTtl: "5m" } });
    expect(system[1].cache_control?.ttl).toBe("5m");
  });

  it("ignores a cacheTtl that is not one of the two Anthropic offers", () => {
    const system = buildSystem({ ...REQUEST, providerOptions: { cacheTtl: "3 weeks" } });
    expect(system[1].cache_control?.ttl).toBe("1h");
  });

  it("sets NO breakpoint when nothing is cacheable", () => {
    // Marking a varying prefix cacheable pays the write premium on every
    // request and never reads it back.
    const system = buildSystem({ ...REQUEST, system: [{ text: "varies" }] });
    expect(system.every((b) => b.cache_control === undefined)).toBe(true);
  });

  it("refuses a prompt whose cacheable block follows a varying one", () => {
    expect(() =>
      buildSystem({
        ...REQUEST,
        system: [{ text: "varies" }, { text: "stable", cacheable: true }],
      }),
    ).toThrow(/cacheable block follows/);
  });

  it("drops empty blocks so an empty one cannot become the breakpoint", () => {
    const system = buildSystem({
      ...REQUEST,
      system: [{ text: "a", cacheable: true }, { text: "" }, { text: "b" }],
    });
    expect(system).toHaveLength(2);
    expect(system[0].text).toBe("a");
  });
});

describe("buildParams", () => {
  it("passes the model, the cap and the conversation through", () => {
    const params = buildParams(REQUEST);
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.max_tokens).toBe(4000);
    expect(params.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("forwards providerOptions but consumes cacheTtl, which is ours", () => {
    const params = buildParams({
      ...REQUEST,
      providerOptions: { cacheTtl: "5m", thinking: { type: "adaptive" } },
    });
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params).not.toHaveProperty("cacheTtl");
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

describe("buildParams with tools", () => {
  it("maps tools into Anthropic's shape and omits tool_choice by default", () => {
    const params = buildParams({ ...REQUEST, tools: TOOLS });
    expect(params.tools).toEqual([
      {
        name: "content_search",
        description: "Searches the app's content.",
        input_schema: TOOLS[0].inputSchema,
      },
    ]);
    expect(params).not.toHaveProperty("tool_choice");
  });

  it('sends tool_choice none only when asked — the loop\'s last round', () => {
    const params = buildParams({ ...REQUEST, tools: TOOLS, toolChoice: "none" });
    expect(params.tool_choice).toEqual({ type: "none" });
  });

  it("sends NEITHER field without tools — the pre-tools request is byte-identical", () => {
    const params = buildParams(REQUEST);
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("tool_choice");
    const empty = buildParams({ ...REQUEST, tools: [] });
    expect(empty).not.toHaveProperty("tools");
  });

  it("a stale binding key cannot clobber the tool wiring", () => {
    // Tool wiring comes AFTER the passthrough spread on purpose: a `tools`
    // left in a binding must not silently disarm the loop.
    const params = buildParams({
      ...REQUEST,
      tools: TOOLS,
      providerOptions: { tools: "stale", tool_choice: "stale" },
    });
    expect(Array.isArray(params.tools)).toBe(true);
    expect(params).not.toHaveProperty("tool_choice");
  });

  it("keeps the cache breakpoint on the last cacheable system block with tools present", () => {
    const params = buildParams({ ...REQUEST, tools: TOOLS });
    const system = params.system as { cache_control?: unknown }[];
    expect(system.map((b) => Boolean(b.cache_control))).toEqual([false, true, false]);
  });

  it("serializes byte-identically across two builds — the cache condition", () => {
    const a = JSON.stringify(buildParams({ ...REQUEST, tools: TOOLS }));
    const b = JSON.stringify(buildParams({ ...REQUEST, tools: TOOLS }));
    expect(a).toBe(b);
  });
});

describe("buildMessages", () => {
  it("replays an assistant tool-call turn as tool_use blocks after its narration", () => {
    const messages = buildMessages([
      {
        role: "assistant",
        content: "Let me look.",
        toolCalls: [{ id: "tu_1", name: "content_search", input: { query: "knots" } }],
      },
    ]);
    expect(messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "tu_1", name: "content_search", input: { query: "knots" } },
      ],
    });
  });

  it("omits the empty text block on a calls-only turn", () => {
    const messages = buildMessages([
      { role: "assistant", content: "", toolCalls: [{ id: "tu_1", name: "x", input: {} }] },
    ]);
    expect((messages[0].content as unknown[])[0]).toMatchObject({ type: "tool_use" });
  });

  it("batches one round's results into ONE user turn, is_error only when set", () => {
    const messages = buildMessages([
      {
        role: "tool",
        results: [
          { toolCallId: "tu_1", name: "a", content: "found it" },
          { toolCallId: "tu_2", name: "b", content: "toolFailed", isError: true },
        ],
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const blocks = messages[0].content as Record<string, unknown>[];
    expect(blocks[0]).toEqual({ type: "tool_result", tool_use_id: "tu_1", content: "found it" });
    expect(blocks[1]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_2",
      content: "toolFailed",
      is_error: true,
    });
  });
});

describe("toolCallsFrom", () => {
  it("reads tool_use blocks out of a mixed content array", () => {
    const calls = toolCallsFrom([
      { type: "text", text: "Looking…" },
      { type: "tool_use", id: "tu_1", name: "content_search", input: { query: "x" } },
    ]);
    expect(calls).toEqual([{ id: "tu_1", name: "content_search", input: { query: "x" } }]);
  });

  it("normalizes a missing input to an empty object and skips malformed blocks", () => {
    const calls = toolCallsFrom([
      { type: "tool_use", id: "tu_1", name: "a" },
      { type: "tool_use", name: "no-id" },
    ]);
    expect(calls).toEqual([{ id: "tu_1", name: "a", input: {} }]);
  });

  it("answers empty for a text-only answer", () => {
    expect(toolCallsFrom([{ type: "text", text: "hi" }])).toEqual([]);
  });
});

describe("usageFrom", () => {
  it("adds the cache figures into input, because Anthropic reports them apart", () => {
    // THE Anthropic-specific trap. `input_tokens` here EXCLUDES cache reads and
    // writes, unlike every other provider in this directory where the input
    // figure is the total. Missing this under-reports input on every cached
    // call — which is to say, on every assistant answer.
    const usage = usageFrom({
      input_tokens: 12,
      output_tokens: 40,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 88,
    })!;
    expect(usage.inputTokens).toBe(1000);
    expect(usage.cachedInputTokens).toBe(900);
    expect(usage.cacheWriteTokens).toBe(88);
    expect(usage.outputTokens).toBe(40);
  });

  it("reports no total, so the reconciliation has nothing to flag", () => {
    // Correct rather than a gap: the three input figures plus output are the
    // whole bill, so there is nothing left over to be unexplained.
    const usage = usageFrom({ input_tokens: 10, output_tokens: 5 })!;
    expect(usage.reportedTotalTokens).toBeNull();
    expect(unexplainedTokens(usage)).toBe(0);
  });

  it("carries no thinking figure, because thinking is inside output here", () => {
    expect(usageFrom({ input_tokens: 1, output_tokens: 1 })!.thinkingTokens).toBe(0);
  });

  it("returns null when the provider said nothing", () => {
    expect(usageFrom(undefined)).toBeNull();
  });

  it("treats a missing cache figure as zero, not as absent usage", () => {
    const usage = usageFrom({ input_tokens: 10, output_tokens: 5 })!;
    expect(usage.cachedInputTokens).toBe(0);
    expect(usage.inputTokens).toBe(10);
  });
});

describe("textFrom", () => {
  it("joins the text blocks and ignores the rest", () => {
    expect(
      textFrom([
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });

  it("is empty rather than throwing on an unexpected shape", () => {
    expect(textFrom(undefined)).toBe("");
    expect(textFrom([])).toBe("");
  });
});
