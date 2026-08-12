// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPAT_PROFILES,
  ToolCallAccumulator,
  buildBody,
  compatAdapter,
  deltaFrom,
  stopReasonFrom,
  textFrom,
  toolCallsFrom,
  usageFrom,
} from "./openai-compat";
import {
  unexplainedTokens,
  type NormalizedRequest,
  type ToolDefinition,
} from "./types";
import { PROVIDERS_REPORTING_COST } from "./ids.mjs";

const REQUEST: NormalizedRequest = {
  model: "some-model",
  system: [
    { text: "You are helpful.", cacheable: true },
    { text: "Today is 2026-07-25." },
  ],
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 256,
  timeoutMs: 1000,
};

afterEach(() => vi.unstubAllGlobals());

describe("buildBody", () => {
  it("puts the system prompt first, with the stable part in front", () => {
    // The ordering is the whole caching mechanism for these three providers —
    // there is nothing to send that asks for a cache.
    const body = buildBody(REQUEST, COMPAT_PROFILES.openai, false);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({
      role: "system",
      content: "You are helpful.\n\nToday is 2026-07-25.",
    });
    expect(messages[0].content.startsWith("You are helpful.")).toBe(true);
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("omits the system message entirely when there is no system prompt", () => {
    const body = buildBody({ ...REQUEST, system: [] }, COMPAT_PROFILES.openai, false);
    expect((body.messages as { role: string }[])[0].role).toBe("user");
  });

  it("refuses a prompt whose cacheable block follows a varying one", () => {
    expect(() =>
      buildBody(
        { ...REQUEST, system: [{ text: "varies" }, { text: "stable", cacheable: true }] },
        COMPAT_PROFILES.openai,
        false,
      ),
    ).toThrow(/cacheable block follows/);
  });

  it("asks for usage on the final streamed chunk", () => {
    // Without it a streamed OpenAI call reports no usage at all — every
    // streamed answer would be un-costable, silently.
    const body = buildBody(REQUEST, COMPAT_PROFILES.openai, true);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("sends no stream fields when not streaming", () => {
    const body = buildBody(REQUEST, COMPAT_PROFILES.openai, false);
    expect(body).not.toHaveProperty("stream");
    expect(body).not.toHaveProperty("stream_options");
  });

  it("asks OpenRouter for its own cost figure, and nobody else", () => {
    expect(buildBody(REQUEST, COMPAT_PROFILES.openrouter, false).usage).toEqual({
      include: true,
    });
    expect(buildBody(REQUEST, COMPAT_PROFILES.openai, false)).not.toHaveProperty("usage");
  });

  it("lets providerOptions override the model and the cap — it is the escape hatch", () => {
    const body = buildBody(
      { ...REQUEST, providerOptions: { max_tokens: 4000, reasoning_effort: "low" } },
      COMPAT_PROFILES.openai,
      false,
    );
    expect(body.max_tokens).toBe(4000);
    expect(body.reasoning_effort).toBe("low");
  });

  it("never sends cacheTtl — that word is ours, not any provider's", () => {
    // The chat ships bound to Anthropic, and the ordinary way to move it to
    // Mistral is to change `provider` and `model` and leave the rest. Without
    // this filter the binding's `cacheTtl` would travel to an API that never
    // defined it, and the customer's first message would come back a 400.
    const body = buildBody(
      { ...REQUEST, providerOptions: { cacheTtl: "1h", reasoning_effort: "low" } },
      COMPAT_PROFILES.mistral,
      false,
    );
    expect(body).not.toHaveProperty("cacheTtl");
    expect(body.reasoning_effort).toBe("low");
  });

  it("does NOT let providerOptions override the transport", () => {
    // Found in review. A binding that set `stream: false` while this adapter is
    // parsing an SSE body would hang the request rather than fail visibly — the
    // caller asked for a stream and must get one. Tuning is negotiable;
    // transport is not.
    const streamed = buildBody(
      { ...REQUEST, providerOptions: { stream: false, stream_options: null } },
      COMPAT_PROFILES.openai,
      true,
    );
    expect(streamed.stream).toBe(true);
    expect(streamed.stream_options).toEqual({ include_usage: true });

    const plain = buildBody(
      { ...REQUEST, providerOptions: { stream: true } },
      COMPAT_PROFILES.openai,
      false,
    );
    expect(plain).not.toHaveProperty("stream");
  });
});

describe("the three profiles", () => {
  it("point at the right hosts and the right environment variables", () => {
    expect(COMPAT_PROFILES.openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(COMPAT_PROFILES.mistral.baseUrl).toBe("https://api.mistral.ai/v1");
    expect(COMPAT_PROFILES.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(COMPAT_PROFILES.openai.envVar).toBe("OPENAI_API_KEY");
    expect(COMPAT_PROFILES.mistral.envVar).toBe("MISTRAL_API_KEY");
    expect(COMPAT_PROFILES.openrouter.envVar).toBe("OPENROUTER_API_KEY");
  });

  it("carry no trailing slash, so the appended path cannot double up", () => {
    for (const profile of Object.values(COMPAT_PROFILES)) {
      expect(profile.baseUrl.endsWith("/")).toBe(false);
    }
  });

  it("agree with the .mjs list about who reports their own cost", () => {
    // Two copies, one truth — the same deal PROVIDER_IDS gets. The flag lives
    // here because the adapter acts on it; the list lives in ids.mjs because
    // `scripts/ai/check.mjs` reads it and does not import TypeScript. Out of
    // step, `ai-check` would demand a price for the one provider that already
    // reports the real figure, or quietly stop asking for one that does not.
    const fromProfiles = Object.values(COMPAT_PROFILES)
      .filter((profile) => profile.usageAccounting)
      .map((profile) => profile.id)
      .sort();
    expect(fromProfiles).toEqual([...PROVIDERS_REPORTING_COST].sort());
  });
});

describe("usageFrom", () => {
  it("reads the breakdown", () => {
    const usage = usageFrom(
      { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      COMPAT_PROFILES.openai,
    )!;
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(unexplainedTokens(usage)).toBe(0);
  });

  it("reads the cached share, which is where most of the saving is", () => {
    const usage = usageFrom(
      { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 900 } },
      COMPAT_PROFILES.openai,
    )!;
    expect(usage.cachedInputTokens).toBe(900);
    // The cached share is INSIDE prompt_tokens, not on top of it.
    expect(usage.inputTokens).toBe(1000);
  });

  it("treats reasoning tokens as a breakdown of output, not an addition to it", () => {
    // The opposite of Gemini, where thinking sits beside the visible output.
    // Adding here would double-count every reasoning call.
    const usage = usageFrom(
      {
        prompt_tokens: 10,
        completion_tokens: 100,
        completion_tokens_details: { reasoning_tokens: 80 },
      },
      COMPAT_PROFILES.openai,
    )!;
    expect(usage.outputTokens).toBe(100);
    expect(usage.thinkingTokens).toBe(80);
  });

  it("flags billed tokens the breakdown does not explain", () => {
    const usage = usageFrom(
      { prompt_tokens: 100, completion_tokens: 20, total_tokens: 200 },
      COMPAT_PROFILES.openai,
    )!;
    expect(unexplainedTokens(usage)).toBe(80);
  });

  it("converts OpenRouter's reported cost to micros and names its currency", () => {
    const usage = usageFrom(
      { prompt_tokens: 1, completion_tokens: 1, cost: 0.00123 },
      COMPAT_PROFILES.openrouter,
    )!;
    expect(usage.reportedCostMicros).toBe(1230);
    expect(usage.reportedCostCurrency).toBe("USD");
  });

  it("reports no cost for providers that quote none", () => {
    const usage = usageFrom(
      { prompt_tokens: 1, completion_tokens: 1 },
      COMPAT_PROFILES.openai,
    )!;
    expect(usage.reportedCostMicros).toBeNull();
    expect(usage.reportedCostCurrency).toBeNull();
  });

  it("returns null when the provider said nothing", () => {
    expect(usageFrom(undefined, COMPAT_PROFILES.openai)).toBeNull();
  });
});

describe("reading the answer", () => {
  it("takes the first choice's message", () => {
    expect(textFrom({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(stopReasonFrom({ choices: [{ finish_reason: "stop" }] })).toBe("stop");
  });

  it("is empty rather than throwing on a malformed answer", () => {
    expect(textFrom({})).toBe("");
    expect(textFrom({ choices: [] })).toBe("");
    expect(deltaFrom({ choices: [{}] })).toBe("");
  });
});

// ── Streaming ───────────────────────────────────────────────────────────────

function sseResponse(...lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

// ── Tools ───────────────────────────────────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    name: "content_search",
    description: "Searches the app's content.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
];

describe("buildBody with tools", () => {
  it("maps tools into the function shape beside the transport flags", () => {
    const body = buildBody({ ...REQUEST, tools: TOOLS }, COMPAT_PROFILES.openai, true);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "content_search",
          description: "Searches the app's content.",
          parameters: TOOLS[0].inputSchema,
        },
      },
    ]);
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty("tool_choice");
  });

  it('sends tool_choice "none" only when asked', () => {
    const body = buildBody(
      { ...REQUEST, tools: TOOLS, toolChoice: "none" },
      COMPAT_PROFILES.openai,
      false,
    );
    expect(body.tool_choice).toBe("none");
  });

  it("sends NEITHER field without tools — OpenAI 400s on tools: []", () => {
    for (const req of [REQUEST, { ...REQUEST, tools: [] }]) {
      const body = buildBody(req, COMPAT_PROFILES.openai, false);
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("tool_choice");
    }
  });

  it("a stale binding key cannot clobber or invent tool wiring", () => {
    const armed = buildBody(
      { ...REQUEST, tools: TOOLS, providerOptions: { tools: "stale" } },
      COMPAT_PROFILES.openai,
      false,
    );
    expect(Array.isArray(armed.tools)).toBe(true);
    const disarmed = buildBody(
      { ...REQUEST, providerOptions: { tools: "stale", tool_choice: "auto" } },
      COMPAT_PROFILES.openai,
      false,
    );
    expect(disarmed).not.toHaveProperty("tools");
    expect(disarmed).not.toHaveProperty("tool_choice");
  });

  it("replays an assistant tool-call turn with arguments as a JSON string", () => {
    const body = buildBody(
      {
        ...REQUEST,
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "content_search", input: { query: "x" } }],
          },
        ],
      },
      COMPAT_PROFILES.openai,
      false,
    );
    const message = (body.messages as Record<string, unknown>[]).at(-1)!;
    expect(message.content).toBeNull();
    expect(message.tool_calls).toEqual([
      {
        id: "c1",
        type: "function",
        function: { name: "content_search", arguments: '{"query":"x"}' },
      },
    ]);
  });

  it("expands one round's results into one role:tool message per result", () => {
    const body = buildBody(
      {
        ...REQUEST,
        messages: [
          {
            role: "tool",
            results: [
              { toolCallId: "c1", name: "a", content: "first" },
              { toolCallId: "c2", name: "b", content: "second" },
            ],
          },
        ],
      },
      COMPAT_PROFILES.openai,
      false,
    );
    const messages = (body.messages as Record<string, unknown>[]).slice(-2);
    expect(messages).toEqual([
      { role: "tool", tool_call_id: "c1", content: "first" },
      { role: "tool", tool_call_id: "c2", content: "second" },
    ]);
  });

  it("serializes byte-identically across two builds — the cache condition", () => {
    const a = JSON.stringify(buildBody({ ...REQUEST, tools: TOOLS }, COMPAT_PROFILES.openai, true));
    const b = JSON.stringify(buildBody({ ...REQUEST, tools: TOOLS }, COMPAT_PROFILES.openai, true));
    expect(a).toBe(b);
  });
});

describe("toolCallsFrom", () => {
  it("reads calls from a non-streamed answer and parses their arguments", () => {
    const calls = toolCallsFrom({
      choices: [
        {
          message: {
            tool_calls: [
              { id: "c1", function: { name: "content_search", arguments: '{"query":"x"}' } },
            ],
          },
        },
      ],
    });
    expect(calls).toEqual([{ id: "c1", name: "content_search", input: { query: "x" } }]);
  });

  it("marks unparseable arguments as parseFailed instead of throwing", () => {
    const calls = toolCallsFrom({
      choices: [
        { message: { tool_calls: [{ id: "c1", function: { name: "a", arguments: "{broken" } }] } },
      ],
    });
    expect(calls[0]).toEqual({ id: "c1", name: "a", input: {}, inputError: "parseFailed" });
  });
});

describe("ToolCallAccumulator", () => {
  it("reassembles two interleaved calls whose arguments arrive in fragments", () => {
    const acc = new ToolCallAccumulator();
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: "" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "get", arguments: '{"r' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'ef":"a"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"knots"}' } }] } }] },
    ];
    for (const chunk of chunks) acc.add(chunk);
    expect(acc.finish()).toEqual([
      { id: "c1", name: "search", input: { query: "knots" } },
      { id: "c2", name: "get", input: { ref: "a" } },
    ]);
  });

  it("marks a call whose reassembled arguments do not parse", () => {
    const acc = new ToolCallAccumulator();
    acc.add({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "a", arguments: "{oops" } }] } }] });
    expect(acc.finish()).toEqual([{ id: "c1", name: "a", input: {}, inputError: "parseFailed" }]);
  });

  it("synthesizes an id when a compat upstream sends none", () => {
    const acc = new ToolCallAccumulator();
    acc.add({ choices: [{ delta: { tool_calls: [{ index: 2, function: { name: "a", arguments: "{}" } }] } }] });
    expect(acc.finish()[0].id).toBe("call_2");
  });

  it("drops nameless fragments and stays empty on text-only chunks", () => {
    const acc = new ToolCallAccumulator();
    acc.add({ choices: [{ delta: { content: "hello" } }] });
    acc.add({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1" }] } }] });
    expect(acc.finish()).toEqual([]);
  });
});

describe("streaming", () => {
  it("yields accumulated tool calls after the stream, before done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          JSON.stringify({ choices: [{ delta: { content: "Let me check." } }] }),
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "c1", function: { name: "content_search", arguments: '{"que' } },
                  ],
                },
              },
            ],
          }),
          JSON.stringify({
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"knots"}' } }] }, finish_reason: "tool_calls" },
            ],
          }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
          "[DONE]",
        ),
      ),
    );

    const adapter = compatAdapter(COMPAT_PROFILES.openai);
    const events = [];
    for await (const event of adapter.stream({ ...REQUEST, tools: TOOLS }, "k")) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual(["delta", "tool_call", "done"]);
    const call = events[1] as { call: { name: string; input: unknown } };
    expect(call.call).toEqual({ id: "c1", name: "content_search", input: { query: "knots" } });
    const done = events.at(-1) as { usage: { inputTokens: number }; stopReason: string };
    expect(done.usage.inputTokens).toBe(12);
    expect(done.stopReason).toBe("tool_calls");
  });

  it("emits deltas and takes usage from the final chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
          JSON.stringify({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }),
          "[DONE]",
        ),
      ),
    );

    const adapter = compatAdapter(COMPAT_PROFILES.openai);
    const events = [];
    for await (const event of adapter.stream(REQUEST, "k")) events.push(event);

    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text))
      .toEqual(["Hel", "lo"]);

    const done = events.at(-1) as { usage: { inputTokens: number }; stopReason: string };
    expect(done.usage.inputTokens).toBe(9);
    expect(done.stopReason).toBe("stop");
  });

  it("reports no usage as null rather than as zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(JSON.stringify({ choices: [{ delta: { content: "x" } }] }), "[DONE]")),
    );
    const adapter = compatAdapter(COMPAT_PROFILES.openai);
    const events = [];
    for await (const event of adapter.stream(REQUEST, "k")) events.push(event);
    expect((events.at(-1) as { usage: unknown }).usage).toBeNull();
  });
});

describe("failure", () => {
  it("maps statuses to typed outcomes", async () => {
    const adapter = compatAdapter(COMPAT_PROFILES.mistral);

    for (const [status, code] of [
      [401, "noCredential"],
      [404, "unknownModel"],
      [413, "requestTooLarge"],
      [429, "providerRefused"],
      [503, "providerRefused"],
      [500, "providerFailed"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status })));
      await expect(adapter.complete(REQUEST, "k")).rejects.toMatchObject({
        code,
        provider: "mistral",
      });
    }
  });

  it("does not put the provider's error body in front of a Member", async () => {
    // A provider's error text can quote the prompt back, and the prompt is the
    // Member's. It goes in the log line, never in the thrown code.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("your prompt was: SECRET", { status: 400 })));
    const adapter = compatAdapter(COMPAT_PROFILES.openai);
    await expect(adapter.complete(REQUEST, "k")).rejects.toMatchObject({
      code: "providerFailed",
    });
  });
});

describe("the streaming timeout measures silence, not duration", () => {
  it("does not cut off an answer that is merely long", async () => {
    // Found in review. `AbortSignal.timeout` covers the whole request including
    // the body, so a long reply would have been aborted mid-sentence with the
    // Member watching — and reported as `providerUnreachable`, which sends
    // whoever reads the log looking at the network. What the budget is for is a
    // provider that has gone quiet.
    const encoder = new TextEncoder();
    const chunks = [
      JSON.stringify({ choices: [{ delta: { content: "one " } }] }),
      JSON.stringify({ choices: [{ delta: { content: "two " } }] }),
      JSON.stringify({ choices: [{ delta: { content: "three" } }] }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              // Each gap is under the window, but the TOTAL is well over it.
              await new Promise((r) => setTimeout(r, 40));
              if (init.signal?.aborted) {
                controller.error(new Error("aborted"));
                return;
              }
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            }
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const adapter = compatAdapter(COMPAT_PROFILES.openai);
    const text: string[] = [];
    // 60ms of silence is the budget; the answer takes ~120ms in total.
    for await (const event of adapter.stream({ ...REQUEST, timeoutMs: 60 }, "k")) {
      if (event.type === "delta") text.push(event.text);
    }

    expect(text.join("")).toBe("one two three");
  });
});
