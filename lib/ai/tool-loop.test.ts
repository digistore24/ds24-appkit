// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./run", () => ({
  streamTask: vi.fn(),
}));

import { streamTask, type TaskInput } from "./run";
import type { StreamEvent, ToolCall, Usage } from "./providers/types";
import {
  MAX_TOOL_ROUNDS,
  ToolError,
  streamTaskWithTools,
  type ServerTool,
  type ToolLoopEvent,
} from "./tool-loop";

const usage = (n: number): Usage => ({
  inputTokens: n,
  outputTokens: 1,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  images: 0,
  thinkingTokens: 0,
  reportedTotalTokens: null,
  reportedCostMicros: null,
  reportedCostCurrency: null,
});

function round(events: StreamEvent[]): () => AsyncGenerator<StreamEvent> {
  return async function* () {
    for (const event of events) yield event;
  };
}

function call(id: string, name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id, name, input };
}

const INPUT: TaskInput = {
  system: [{ text: "persona", cacheable: true }],
  messages: [{ role: "user", content: "where is the knot video?" }],
  memberId: "m-1",
};

function searchTool(execute?: ServerTool["execute"]): ServerTool {
  return {
    definition: {
      name: "content_search",
      description: "Searches the app's content.",
      inputSchema: { type: "object" },
    },
    execute: execute ?? (async () => '{"hits":[]}'),
  };
}

async function collect(gen: AsyncGenerator<ToolLoopEvent>): Promise<ToolLoopEvent[]> {
  const events: ToolLoopEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const mockStream = vi.mocked(streamTask);

beforeEach(() => {
  mockStream.mockReset();
});

describe("streamTaskWithTools", () => {
  it("passes a tool-less call through as one round, without a tools field", async () => {
    mockStream.mockImplementationOnce(
      round([
        { type: "delta", text: "Hello" },
        { type: "done", usage: usage(1), stopReason: "stop" },
      ]),
    );

    const events = await collect(streamTaskWithTools("chat", INPUT, []));

    expect(events).toEqual([
      { type: "delta", text: "Hello" },
      { type: "done", usage: usage(1), stopReason: "stop" },
    ]);
    expect(mockStream).toHaveBeenCalledTimes(1);
    const sent = mockStream.mock.calls[0][1];
    expect(sent).not.toHaveProperty("tools");
    expect(sent).not.toHaveProperty("toolChoice");
  });

  it("executes a round's calls and feeds the results into the next round", async () => {
    const execute = vi.fn(async () => '{"hits":[{"title":"Knoten"}]}');
    mockStream
      .mockImplementationOnce(
        round([
          { type: "delta", text: "Let me look. " },
          { type: "tool_call", call: call("c1", "content_search", { query: "knot" }) },
          { type: "done", usage: usage(1), stopReason: "tool_use" },
        ]),
      )
      .mockImplementationOnce(
        round([
          { type: "delta", text: "Found it." },
          { type: "done", usage: usage(2), stopReason: "stop" },
        ]),
      );

    const events = await collect(streamTaskWithTools("chat", INPUT, [searchTool(execute)]));

    expect(events).toEqual([
      { type: "delta", text: "Let me look. " },
      { type: "tool", name: "content_search" },
      { type: "delta", text: "Found it." },
      { type: "done", usage: usage(2), stopReason: "stop" },
    ]);
    expect(execute).toHaveBeenCalledWith({ query: "knot" });

    // The second round's history: original + assistant tool turn + results.
    const secondInput = mockStream.mock.calls[1][1];
    expect(secondInput.messages).toEqual([
      INPUT.messages[0],
      {
        role: "assistant",
        content: "Let me look. ",
        toolCalls: [call("c1", "content_search", { query: "knot" })],
      },
      {
        role: "tool",
        results: [
          { toolCallId: "c1", name: "content_search", content: '{"hits":[{"title":"Knoten"}]}' },
        ],
      },
    ]);
    // The identical system and tools arrays travel every round (cache discipline).
    expect(secondInput.system).toBe(INPUT.system);
    expect(secondInput.tools).toEqual(mockStream.mock.calls[0][1].tools);
  });

  it("forces a text answer on the last round and never executes calls it returns anyway", async () => {
    const execute = vi.fn(async () => "x");
    mockStream.mockImplementation(
      round([
        { type: "tool_call", call: call("c1", "content_search") },
        { type: "done", usage: usage(9), stopReason: "tool_use" },
      ]),
    );

    const events = await collect(streamTaskWithTools("chat", INPUT, [searchTool(execute)]));

    expect(mockStream).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    for (let i = 0; i < MAX_TOOL_ROUNDS; i += 1) {
      const sent = mockStream.mock.calls[i][1];
      expect(sent.toolChoice).toBe(i === MAX_TOOL_ROUNDS - 1 ? "none" : "auto");
    }
    // Rounds 1..N-1 executed; the defiant final round did not.
    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS - 1);
    // Exactly one done, at the very end.
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "done", usage: usage(9), stopReason: "tool_use" });
  });

  it("turns executor failures into isError results with codes, and continues", async () => {
    mockStream
      .mockImplementationOnce(
        round([
          { type: "tool_call", call: call("c1", "content_search") },
          { type: "tool_call", call: call("c2", "not_registered") },
          {
            type: "tool_call",
            call: { id: "c3", name: "content_search", input: {}, inputError: "parseFailed" },
          },
          { type: "done", usage: usage(1), stopReason: "tool_use" },
        ]),
      )
      .mockImplementationOnce(
        round([{ type: "done", usage: usage(2), stopReason: "stop" }]),
      );

    const tool = searchTool(async () => {
      throw new ToolError("contentUnavailable");
    });
    await collect(streamTaskWithTools("chat", INPUT, [tool]));

    const results = (
      mockStream.mock.calls[1][1].messages.at(-1) as {
        results: { toolCallId: string; content: string; isError?: boolean }[];
      }
    ).results;
    expect(results).toEqual([
      { toolCallId: "c1", name: "content_search", content: "contentUnavailable", isError: true },
      { toolCallId: "c2", name: "not_registered", content: "unknownTool", isError: true },
      { toolCallId: "c3", name: "content_search", content: "invalidArguments", isError: true },
    ]);
  });

  it("maps a generic executor throw to toolFailed without leaking the message", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStream
      .mockImplementationOnce(
        round([
          { type: "tool_call", call: call("c1", "content_search") },
          { type: "done", usage: usage(1), stopReason: "tool_use" },
        ]),
      )
      .mockImplementationOnce(
        round([{ type: "done", usage: usage(2), stopReason: "stop" }]),
      );

    const tool = searchTool(async () => {
      throw new Error("connection string postgres://secret");
    });
    await collect(streamTaskWithTools("chat", INPUT, [tool]));

    const results = (
      mockStream.mock.calls[1][1].messages.at(-1) as { results: { content: string }[] }
    ).results;
    expect(results[0].content).toBe("toolFailed");
    expect(results[0].content).not.toContain("postgres");
    consoleSpy.mockRestore();
  });

  it("records one streamTask call per round — the billing invariant", async () => {
    mockStream
      .mockImplementationOnce(
        round([
          { type: "tool_call", call: call("c1", "content_search") },
          { type: "done", usage: usage(1), stopReason: "tool_use" },
        ]),
      )
      .mockImplementationOnce(
        round([
          { type: "tool_call", call: call("c2", "content_search") },
          { type: "done", usage: usage(2), stopReason: "tool_use" },
        ]),
      )
      .mockImplementationOnce(
        round([{ type: "delta", text: "Done." }, { type: "done", usage: usage(3), stopReason: "stop" }]),
      );

    const events = await collect(streamTaskWithTools("chat", INPUT, [searchTool()]));

    // Three rounds ⇒ three streamTask generators ⇒ three ai_usage rows,
    // written by streamTask itself; the loop's done carries the final round's.
    expect(mockStream).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toEqual({ type: "done", usage: usage(3), stopReason: "stop" });
  });

  it("propagates a provider error exactly as streamTask throws it", async () => {
    mockStream.mockImplementationOnce(async function* () {
      yield { type: "delta", text: "par" } as StreamEvent;
      throw new Error("providerUnreachable");
    });

    await expect(collect(streamTaskWithTools("chat", INPUT, [searchTool()]))).rejects.toThrow(
      "providerUnreachable",
    );
  });
});
