// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Anthropic, through the SDK that is already a dependency.
//
// ── Why native, when three providers share one HTTP adapter ────────────────
// Because of the cache breakpoint. Anthropic's prompt caching is EXPLICIT:
// `cache_control` marks where the cacheable prefix ends, and the OpenAI shape
// has nowhere to put that. The assistant's entire cost structure is that
// breakpoint — the whole handbook goes out on every question and is billed at
// roughly a tenth on a hit — so the one provider whose caching is a request
// field is the one provider that needs its own adapter.
//
// The SDK is already in `package.json` for the chat, so this costs nothing in
// dependencies and brings the streaming helper with it.
import Anthropic from "@anthropic-ai/sdk";

import {
  DEFAULT_TIMEOUT_MS,
  ProviderError,
  codeForStatus,
  emptyUsage,
  passthroughOptions,
  type Adapter,
  type ModelMessage,
  type NormalizedRequest,
  type ToolCall,
  type Usage,
} from "./types";
import { assertCacheableOrder, lastCacheableIndex } from "./blocks";
import { finiteNumber } from "@/lib/finite";

export const ANTHROPIC_ENV_VAR = "ANTHROPIC_API_KEY";

/** How long a cached prefix stays warm. Anthropic's two options. */
const CACHE_TTLS = ["5m", "1h"] as const;
type CacheTtl = (typeof CACHE_TTLS)[number];

function cacheTtlFrom(options: Record<string, unknown> | undefined): CacheTtl {
  const value = options?.cacheTtl;
  return (CACHE_TTLS as readonly unknown[]).includes(value) ? (value as CacheTtl) : "1h";
}

// ── Pure: building the request ──────────────────────────────────────────────

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl: CacheTtl };
}

/**
 * The `system` array, with ONE breakpoint on the last cacheable block.
 *
 * One and not several, deliberately: the API allows up to four, and every extra
 * breakpoint is another prefix to write and pay for. What this layer models is
 * a single boundary — stable before it, varying after — which is what
 * `PromptBlock.cacheable` means and what `lib/ai/prompt.ts` was built around.
 *
 * A prompt with no cacheable block gets no breakpoint at all, which is correct:
 * marking a varying prefix as cacheable pays the write premium on every request
 * and never reads it back.
 */
export function buildSystem(
  req: NormalizedRequest,
): AnthropicSystemBlock[] {
  assertCacheableOrder(req.system);

  // The breakpoint is an INDEX, so it has to be computed against the array that
  // is actually indexed. It was taken from `req.system` and applied to the
  // filtered copy below: one empty block ahead of the last cacheable one shifted
  // `cache_control` a block early — and if the last cacheable block was final,
  // onto no block at all, which is the whole discount switched off with no error
  // anywhere. `lib/ai/prompt.ts` no longer emits empty blocks; this makes the
  // arithmetic safe whoever calls it.
  const sent = req.system.filter((block) => block.text !== "");
  const breakpoint = lastCacheableIndex(sent);
  const ttl = cacheTtlFrom(req.providerOptions);

  return sent.map((block, index) => {
    const entry: AnthropicSystemBlock = { type: "text", text: block.text };
    if (index === breakpoint) {
      entry.cache_control = { type: "ephemeral", ttl };
    }
    return entry;
  });
}

/**
 * The message array, tool turns included — pure for the tests.
 *
 * A plain `ChatMessage` goes through as a string body. The two tool shapes
 * become content-block arrays: the assistant turn replays its `tool_use`
 * blocks (narration first, when there was any), and a round's results ride
 * ONE user turn as `tool_result` blocks — Anthropic matches by `tool_use_id`,
 * and splitting results across turns trains the model out of parallel calls.
 */
export function buildMessages(messages: readonly ModelMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result",
          tool_use_id: result.toolCallId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    }
    if ("toolCalls" in message) {
      return {
        role: "assistant",
        content: [
          ...(message.content !== "" ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.input,
          })),
        ],
      };
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * The full request parameters.
 *
 * `providerOptions` is spread last so a binding can set `thinking`,
 * `output_config` or anything else the SDK accepts — except `cacheTtl`, which
 * is ours and is consumed by `buildSystem` above rather than sent.
 */
export function buildParams(req: NormalizedRequest): Record<string, unknown> {
  // `cacheTtl` is OURS — consumed by buildSystem above rather than sent. Every
  // other key is the binding's business and goes through untouched (AD-13).
  const passthrough = passthroughOptions(req.providerOptions);

  const params: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: buildSystem(req),
    messages: buildMessages(req.messages),
    ...passthrough,
  };

  // AFTER the spread, deliberately: tool wiring comes from calling code, never
  // from a binding — the same anti-clobber rule the compat adapter applies to
  // its transport flags. Both keys are stripped first, so a stale `tools` or
  // `tool_choice` in a binding can neither disarm the loop nor arm a tool-less
  // request. When there are no tools, NEITHER field is sent: `tool_choice`
  // without `tools` is a 400, and a tool-less request must stay byte-identical
  // to what this adapter sent before tools existed.
  //
  // Caching: Anthropic renders tools → system → messages, so the existing
  // single breakpoint on the last cacheable system block caches tools and
  // system together. Nothing to add here — but the tools array must be
  // byte-stable across requests (see ToolDefinition).
  delete params.tools;
  delete params.tool_choice;
  if (req.tools && req.tools.length > 0) {
    params.tools = req.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    if (req.toolChoice === "none") {
      params.tool_choice = { type: "none" };
    }
  }

  return params;
}

// ── Pure: reading the answer ────────────────────────────────────────────────

/**
 * Anthropic's `usage` → our shape.
 *
 * `input_tokens` here EXCLUDES what was read from or written to cache, unlike
 * every other provider in this directory, where the input figure is the total.
 * So the three are added up to produce our `inputTokens`, and the cached part
 * is kept separately for pricing. Getting this wrong under-reports input on
 * every cached call — which is to say, on every assistant answer.
 */
export function usageFrom(raw: unknown): Usage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as Record<string, unknown>;

  const uncached = finiteNumber(u.input_tokens);
  const cacheRead = finiteNumber(u.cache_read_input_tokens);
  const cacheWrite = finiteNumber(u.cache_creation_input_tokens);

  return {
    ...emptyUsage(),
    inputTokens: uncached + cacheRead + cacheWrite,
    outputTokens: finiteNumber(u.output_tokens),
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    // Thinking tokens are billed as output and are already inside
    // `output_tokens`; Anthropic does not itemise them, so there is nothing
    // to carry and nothing to add.
    thinkingTokens: 0,
    // No total is reported, so there is nothing for the reconciliation to
    // compare against — and nothing missing either, because the three input
    // figures and the output figure are the whole bill.
    reportedTotalTokens: null,
  };
}

export function textFrom(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => (block as { type?: unknown })?.type === "text")
    .map((block) => (block as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

/**
 * The `tool_use` blocks of an answer, as our shape. The SDK hands `input`
 * back already parsed, so there is no `parseFailed` path on this provider.
 */
export function toolCallsFrom(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return [];
  const calls: ToolCall[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (b?.type !== "tool_use") continue;
    if (typeof b.id !== "string" || typeof b.name !== "string") continue;
    calls.push({
      id: b.id,
      name: b.name,
      input:
        typeof b.input === "object" && b.input !== null && !Array.isArray(b.input)
          ? (b.input as Record<string, unknown>)
          : {},
    });
  }
  return calls;
}

// ── The I/O shell ───────────────────────────────────────────────────────────

function client(key: string, timeoutMs: number): Anthropic {
  return new Anthropic({ apiKey: key, timeout: timeoutMs || DEFAULT_TIMEOUT_MS });
}

/** SDK error → our typed outcome. */
function translate(error: unknown): ProviderError {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    return new ProviderError(
      codeForStatus(status),
      `anthropic answered ${status}: ${(error as Error)?.message ?? ""}`.slice(0, 500),
      "anthropic",
    );
  }
  return new ProviderError(
    "providerUnreachable",
    `anthropic: ${(error as Error)?.message ?? "no response"}`,
    "anthropic",
  );
}

export const anthropicAdapter: Adapter = {
  id: "anthropic",

  async complete(req, key) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message: any = await client(key, req.timeoutMs).messages.create(
        buildParams(req) as never,
      );
      return {
        text: textFrom(message?.content),
        usage: usageFrom(message?.usage),
        stopReason: typeof message?.stop_reason === "string" ? message.stop_reason : null,
        toolCalls: toolCallsFrom(message?.content),
      };
    } catch (error) {
      throw translate(error);
    }
  },

  async *stream(req, key) {
    // The SDK's own stream helper: it accumulates the final message for us,
    // which is where the usage lives. Rebuilding that by hand would mean
    // tracking `message_delta` events for a number the helper already has.
    let iterator;
    try {
      iterator = client(key, req.timeoutMs).messages.stream(buildParams(req) as never);
    } catch (error) {
      throw translate(error);
    }

    try {
      for await (const event of iterator) {
        // `input_json_delta` events (partial tool arguments) flow past this
        // filter on purpose — the SDK's stream helper accumulates them, and
        // the complete, parsed calls are read off the final message below.
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "delta", text: event.delta.text };
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const final: any = await iterator.finalMessage();
      for (const call of toolCallsFrom(final?.content)) {
        yield { type: "tool_call", call };
      }
      yield {
        type: "done",
        usage: usageFrom(final?.usage),
        stopReason: typeof final?.stop_reason === "string" ? final.stop_reason : null,
      };
    } catch (error) {
      throw translate(error);
    }
  },
};
