// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One adapter, three providers: OpenAI, Mistral and OpenRouter.
//
// All three accept a `POST /chat/completions` in OpenAI's shape and answer in
// OpenAI's shape, including `usage`. So there is one transport here and a
// *profile* per provider carrying what differs — base URL, environment
// variable, extra headers, and the handful of per-provider quirks below.
//
// Anthropic and Gemini are NOT here, and the rule behind that is worth stating
// because it decides where a sixth provider goes: **a native adapter exists
// where a provider bills for something this shape cannot express.** Anthropic
// bills a cache write and needs an explicit breakpoint; Gemini bills thinking
// tokens the OpenAI shape has no field for. Everyone else is a profile.
//
// ── Caching ────────────────────────────────────────────────────────────────
// Nothing is sent on the wire for any of the three. OpenAI caches long prefixes
// automatically and reports the hit in `prompt_tokens_details.cached_tokens`;
// Mistral and OpenRouter do whatever their upstream does. What makes that work
// is the ORDER `flattenBlocks` preserves — stable text first — which is the
// same guarantee the `cacheable` flag makes everywhere else.
import {
  DEFAULT_TIMEOUT_MS,
  ProviderError,
  codeForStatus,
  emptyUsage,
  passthroughOptions,
  type Adapter,
  type NormalizedRequest,
  type ProviderId,
  type ToolCall,
  type Usage,
} from "./types";
import { assertCacheableOrder, flattenBlocks } from "./blocks";
import { parseJson, sseData } from "./sse";
import { IdleTimeout } from "./idle-timeout";

export interface CompatProfile {
  id: ProviderId;
  /** Without a trailing slash. `/chat/completions` is appended. */
  baseUrl: string;
  envVar: string;
  /** Headers beyond `authorization` and `content-type`. */
  extraHeaders?: Record<string, string>;
  /**
   * Ask for `usage` on the final streamed chunk.
   *
   * OpenAI needs `stream_options: { include_usage: true }` or a streamed call
   * reports no usage at all — which would silently make every streamed answer
   * un-costable. Off for providers that reject the field.
   */
  streamUsageOption?: boolean;
  /**
   * Ask for the provider's own cost figure (OpenRouter's usage accounting).
   *
   * ⚠️ Verify the exact spelling against OpenRouter's current docs when this is
   * wired up. Their reported cost is more accurate than any price table can be
   * for a router that picks its upstream per request, so it is worth getting
   * right — but it is also the field most likely to have moved.
   */
  usageAccounting?: boolean;
  /** Currency of a provider-reported cost. OpenRouter quotes USD. */
  reportedCostCurrency?: string;
}

export const COMPAT_PROFILES: Record<string, CompatProfile> = {
  openai: {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    streamUsageOption: true,
  },
  mistral: {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    envVar: "MISTRAL_API_KEY",
    streamUsageOption: true,
  },
  openrouter: {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    streamUsageOption: true,
    usageAccounting: true,
    reportedCostCurrency: "USD",
  },
};

// ── Pure: building the request ──────────────────────────────────────────────

/**
 * The request body. Pure, so what goes on the wire is testable without a
 * network — which is where the caching guarantee is actually verified.
 *
 * `providerOptions` is spread LAST and deliberately: it is the escape hatch
 * (AD-13), and an Operator who sets `reasoning_effort` in their binding means
 * it. It can therefore override anything below it, which is the point.
 */
export function buildBody(
  req: NormalizedRequest,
  profile: CompatProfile,
  stream: boolean,
): Record<string, unknown> {
  assertCacheableOrder(req.system);

  const system = flattenBlocks(req.system);
  const messages: Record<string, unknown>[] = [];
  if (system !== "") messages.push({ role: "system", content: system });
  for (const message of req.messages) {
    if (message.role === "tool") {
      // The wire format has no batched tool message — one message per result,
      // matched by `tool_call_id`. Our `ToolResultMessage` batches a round so
      // Anthropic can keep parallel calls in one turn; here it expands.
      for (const result of message.results) {
        messages.push({
          role: "tool",
          tool_call_id: result.toolCallId,
          content: result.content,
        });
      }
    } else if ("toolCalls" in message) {
      messages.push({
        role: "assistant",
        // `null`, not "" — the shape the API itself answers with when a turn
        // is calls-only, and the one it reliably accepts back.
        content: message.content !== "" ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input) },
        })),
      });
    } else {
      messages.push({ role: message.role, content: message.content });
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: req.maxTokens,
    // The escape hatch, spread here rather than last: it may override the model
    // and the cap, which is the point, but it may NOT override the transport
    // flags below. A binding that set `stream: false` while this adapter is
    // parsing an SSE body would hang the request rather than misbehave
    // visibly — the caller asked for a stream and gets one.
    //
    // `passthroughOptions` and not the raw object: `cacheTtl` is a word this
    // layer invented (types.ts), and none of these three APIs knows it. A task
    // moved here from Anthropic keeps that key in its binding, and sending it
    // would end the customer's first message in a 400 about an unknown field.
    ...passthroughOptions(req.providerOptions),
  };

  if (stream) {
    body.stream = true;
    if (profile.streamUsageOption) body.stream_options = { include_usage: true };
  } else {
    delete body.stream;
    delete body.stream_options;
  }
  if (profile.usageAccounting) body.usage = { include: true };

  // Beside the transport flags and AFTER the spread, for the same anti-clobber
  // reason: tool wiring comes from calling code, never from a binding — both
  // keys are stripped first, so a stale binding value can neither disarm the
  // loop nor arm a tool-less request. No tools ⇒ neither field on the wire —
  // OpenAI 400s on `tools: []`, and a tool-less request must stay
  // byte-identical to the pre-tools shape.
  delete body.tools;
  delete body.tool_choice;
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    if (req.toolChoice === "none") body.tool_choice = "none";
  }

  return body;
}

// ── Pure: reading the answer ────────────────────────────────────────────────

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * `usage` → our shape. Returns null when the provider said nothing.
 *
 * Null and zero are different answers (see `Result.usage`): zero means the call
 * consumed nothing, null means nobody measured it. Recording the second as the
 * first makes an unmeasured call look free on the cost page.
 */
export function usageFrom(raw: unknown, profile: CompatProfile): Usage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as Record<string, unknown>;

  const promptDetails = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>;

  const usage: Usage = {
    ...emptyUsage(),
    inputTokens: num(u.prompt_tokens),
    outputTokens: num(u.completion_tokens),
    cachedInputTokens: num(promptDetails.cached_tokens),
    // OpenAI itemises reasoning tokens here; they are already counted inside
    // `completion_tokens`, so this is a breakdown and must NOT be added on top.
    thinkingTokens: num(completionDetails.reasoning_tokens),
    reportedTotalTokens:
      typeof u.total_tokens === "number" ? u.total_tokens : null,
  };

  // OpenRouter quotes a per-request cost in whole currency units; micros keeps
  // the integer discipline the rest of this app uses for money.
  if (typeof u.cost === "number" && Number.isFinite(u.cost)) {
    usage.reportedCostMicros = Math.round(u.cost * 1_000_000);
    usage.reportedCostCurrency = profile.reportedCostCurrency ?? "USD";
  }

  return usage;
}

/** The text of a non-streamed answer. */
export function textFrom(json: unknown): string {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  return typeof message?.content === "string" ? message.content : "";
}

export function stopReasonFrom(json: unknown): string | null {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const reason = (choices[0] as { finish_reason?: unknown })?.finish_reason;
  return typeof reason === "string" ? reason : null;
}

/** The incremental text of one streamed chunk. Empty for usage-only chunks. */
export function deltaFrom(chunk: unknown): string {
  const choices = (chunk as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const delta = (choices[0] as { delta?: { content?: unknown } })?.delta;
  return typeof delta?.content === "string" ? delta.content : "";
}

/** Arguments arrive as a JSON STRING; a parse failure is a code, not a throw. */
function parseArguments(raw: string): Pick<ToolCall, "input" | "inputError"> {
  if (raw.trim() === "") return { input: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { input: parsed as Record<string, unknown> };
    }
    return { input: {}, inputError: "parseFailed" };
  } catch {
    return { input: {}, inputError: "parseFailed" };
  }
}

/** The tool calls of a non-streamed answer. */
export function toolCallsFrom(json: unknown): ToolCall[] {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const calls = (choices[0] as { message?: { tool_calls?: unknown } })?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];

  const result: ToolCall[] = [];
  for (const raw of calls) {
    const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof call?.id !== "string" || typeof call.function?.name !== "string") continue;
    result.push({
      id: call.id,
      name: call.function.name,
      ...parseArguments(
        typeof call.function.arguments === "string" ? call.function.arguments : "",
      ),
    });
  }
  return result;
}

/**
 * Streamed tool calls arrive as indexed FRAGMENTS: the first fragment of a
 * call carries `id` and `function.name`, and `function.arguments` drips in as
 * string pieces across chunks — keyed by `index`, because two parallel calls
 * interleave. This accumulates them; `finish()` parses.
 */
export class ToolCallAccumulator {
  private readonly parts = new Map<number, { id: string; name: string; args: string }>();

  add(chunk: unknown): void {
    const choices = (chunk as { choices?: unknown })?.choices;
    if (!Array.isArray(choices) || choices.length === 0) return;
    const calls = (choices[0] as { delta?: { tool_calls?: unknown } })?.delta?.tool_calls;
    if (!Array.isArray(calls)) return;

    for (const raw of calls) {
      const fragment = raw as {
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      const index = typeof fragment?.index === "number" ? fragment.index : 0;
      const entry = this.parts.get(index) ?? { id: "", name: "", args: "" };
      if (typeof fragment?.id === "string") entry.id = fragment.id;
      if (typeof fragment?.function?.name === "string") entry.name = fragment.function.name;
      if (typeof fragment?.function?.arguments === "string") {
        entry.args += fragment.function.arguments;
      }
      this.parts.set(index, entry);
    }
  }

  /** The complete calls, in index order. Nameless fragments are dropped. */
  finish(): ToolCall[] {
    return [...this.parts.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, entry]) => entry.name !== "")
      .map(([index, entry]) => ({
        // OpenAI always sends an id; some compat upstreams do not. A synthetic
        // one keeps the loop's result matching intact — it never travels back
        // as anything the provider verifies.
        id: entry.id !== "" ? entry.id : `call_${index}`,
        name: entry.name,
        ...parseArguments(entry.args),
      }));
  }
}

// ── The I/O shell ───────────────────────────────────────────────────────────

async function send(
  req: NormalizedRequest,
  profile: CompatProfile,
  key: string,
  stream: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${profile.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(profile.extraHeaders ?? {}),
      },
      body: JSON.stringify(buildBody(req, profile, stream)),
      signal: signal ?? AbortSignal.timeout(req.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout and a dead socket are the same thing to the caller: the
    // provider did not answer. Distinguishing them would not change what
    // anybody does about it.
    throw new ProviderError(
      "providerUnreachable",
      `${profile.id}: ${(error as Error)?.message ?? "no response"}`,
      profile.id,
    );
  }

  if (!response.ok) {
    // The body is read for the LOG, never for the caller — a provider's error
    // text can quote the prompt back, and the prompt is the Member's.
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      codeForStatus(response.status),
      `${profile.id} answered ${response.status}: ${detail.slice(0, 500)}`,
      profile.id,
    );
  }

  return response;
}

export function compatAdapter(profile: CompatProfile): Adapter {
  return {
    id: profile.id,

    async complete(req, key) {
      const response = await send(req, profile, key, false);
      const json = (await response.json()) as unknown;
      return {
        text: textFrom(json),
        usage: usageFrom((json as { usage?: unknown })?.usage, profile),
        stopReason: stopReasonFrom(json),
        toolCalls: toolCallsFrom(json),
      };
    },

    async *stream(req, key) {
      // ⚠️ An IDLE timeout, not a total one — and the difference is the whole
      // reason this is not a one-liner. `AbortSignal.timeout` covers the entire
      // request including the body, so a long answer that legitimately takes
      // longer than the budget would be cut off mid-sentence, with the Member
      // watching. What the budget is actually for is a provider that has gone
      // quiet, so the clock is reset on every chunk that arrives.
      const idle = new IdleTimeout(req.timeoutMs || DEFAULT_TIMEOUT_MS);

      let usage: Usage | null = null;
      let stopReason: string | null = null;
      const toolCalls = new ToolCallAccumulator();

      try {
        const response = await send(req, profile, key, true, idle.signal);

        for await (const payload of sseData(response.body)) {
          idle.touch();
          if (payload === "[DONE]") break;

          const chunk = parseJson(payload);
          if (chunk === null) continue;

          const text = deltaFrom(chunk);
          if (text !== "") yield { type: "delta", text };

          // Tool-call fragments accumulate silently; the complete calls are
          // yielded after the stream ends, when their argument strings are
          // whole. `finish_reason: "tool_calls"` flows through as stopReason.
          toolCalls.add(chunk);

          const reason = stopReasonFrom(chunk);
          if (reason !== null) stopReason = reason;

          // Usage arrives ONCE, on the final chunk, whose `choices` is empty.
          // Overwriting rather than accumulating is correct here and wrong for
          // Gemini — see gemini.ts, where the same field is cumulative.
          const chunkUsage = usageFrom((chunk as { usage?: unknown })?.usage, profile);
          if (chunkUsage) usage = chunkUsage;
        }
      } finally {
        idle.clear();
      }

      for (const call of toolCalls.finish()) {
        yield { type: "tool_call", call };
      }
      yield { type: "done", usage, stopReason };
    },
  };
}
