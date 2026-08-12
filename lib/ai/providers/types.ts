// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The contract every provider adapter satisfies — and the only file the rest of
// the app is allowed to know about.
//
// ── What this exists for ───────────────────────────────────────────────────
// One call shape for five companies. A feature that wants a model describes
// what it wants in these types; an adapter turns that into one provider's wire
// format and its answer back. No call site names a provider, constructs a
// vendor client, or reads an API key — see `registry.ts` for the one place that
// does.
//
// ── The one thing that must not be simplified ──────────────────────────────
// `system` is a LIST of blocks and not a string. Flattening it would be the
// obvious tidy-up and it would silently multiply the assistant's input bill by
// about ten: prompt caching is a PREFIX match, so the cacheable part has to
// stay separable from the part that varies. `lib/ai/prompt.ts` explains the
// mechanism; this type is what carries it across five providers.
import type { Limit } from "@/lib/rate-limit";

/**
 * The five companies this app can call.
 *
 * The list itself lives in `ids.mjs`, because `scripts/ai/check.mjs` needs it
 * and the scripts in this repo do not import TypeScript (CLAUDE.md → Three
 * systems). Written out again here purely so the union TYPE exists — a plain
 * `.mjs` array cannot produce one, and the type is what stops a typo reaching
 * the registry.
 */
export const PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "mistral",
  "openrouter",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return (PROVIDER_IDS as readonly unknown[]).includes(value);
}

// ── The request ─────────────────────────────────────────────────────────────

/**
 * One piece of the system prompt. **Order is meaningful.**
 *
 * `cacheable` means: stable across every request for this task. An adapter may
 * cache the prefix up to and including the last such block, and on three of the
 * five providers that is worth real money:
 *
 *   Anthropic — an explicit `cache_control` breakpoint. Guaranteed, ~90% off
 *               reads, and the assistant's whole cost structure.
 *   Gemini    — implicit caching, on by default for 2.5+. Triggers on a shared
 *               prefix, up to 90% off. The ORDERING here is the trigger.
 *   OpenAI    — automatic prefix caching. Same ordering argument.
 *   Mistral, OpenRouter — ordering only.
 *
 * So on four of five providers there is nothing to send: the flag buys its
 * discount by making the prefix stable, not by asking for anything. That is why
 * `assertCacheableOrder` (blocks.ts) is worth failing loudly over — a cacheable
 * block placed after a varying one is not a style problem, it is the discount
 * quietly switching off with no error anywhere.
 */
export interface PromptBlock {
  text: string;
  cacheable?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Tools ───────────────────────────────────────────────────────────────────

/**
 * A tool the model may call. `inputSchema` is JSON Schema, sent verbatim.
 *
 * **The list MUST be byte-stable across requests** — a module constant, never
 * rebuilt per request. Tool definitions sit inside the cached prefix on all
 * five providers (Anthropic renders tools BEFORE system, so the existing
 * breakpoint on the last cacheable system block caches both together; the
 * others hash the serialized body prefix). A tools array that varies between
 * requests switches the ~10× discount off with no error anywhere — the same
 * failure mode `assertCacheableOrder` exists for, one field over.
 *
 * All five providers speak function calling, which is why there is no
 * per-provider capability flag for this (unlike images): a capability every
 * provider has discriminates nothing.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One call the model asked for. */
export interface ToolCall {
  /**
   * Provider-issued where one exists (Anthropic, the compat family);
   * synthesized by the Gemini adapter, which has none. Keys the result
   * matching inside the loop; ids never travel back to Gemini.
   */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** The arguments arrived as invalid JSON. A code, not a sentence (AD-10). */
  inputError?: "parseFailed";
}

/** What one call came back with. */
export interface ToolResult {
  toolCallId: string;
  /** Gemini matches results by NAME, not id — both always travel. */
  name: string;
  /** Serialized result, or an error code when `isError`. */
  content: string;
  isError?: boolean;
}

/**
 * The assistant turn that asked for tools — replayed to the provider on the
 * next round exactly as it was received.
 */
export interface AssistantToolCallMessage {
  role: "assistant";
  /** Narration streamed before the calls; "" when there was none. */
  content: string;
  toolCalls: ToolCall[];
}

/**
 * ALL results of one round in ONE message. Splitting them into one message
 * per result trains models out of parallel calls on Anthropic; the compat
 * adapter expands this into its one-message-per-result wire shape itself.
 */
export interface ToolResultMessage {
  role: "tool";
  results: ToolResult[];
}

/**
 * What a request's history may carry. `ChatMessage` is a structural member,
 * so every existing caller compiles unchanged — and the PERSISTED history
 * (`chat_messages`) deliberately stays user/assistant strings only: tool
 * turns live inside one loop invocation and are never written to the table.
 */
export type ModelMessage = ChatMessage | AssistantToolCallMessage | ToolResultMessage;

export interface NormalizedRequest {
  /** The provider's own model id. Never translated between providers. */
  model: string;
  system: PromptBlock[];
  messages: ModelMessage[];
  /**
   * The tools the model may call this round. Undefined or empty means the
   * request goes on the wire WITHOUT a tools field — several providers 400 on
   * `tools: []`, and a tool-less request must stay byte-identical to what
   * this layer sent before tools existed.
   */
  tools?: ToolDefinition[];
  /**
   * "none" forces a text answer (the loop's last round). Only meaningful when
   * `tools` is present; never sent without it.
   */
  toolChoice?: "auto" | "none";
  maxTokens: number;
  /** The layer's own ceiling, independent of any SDK default. */
  timeoutMs: number;
  /**
   * Provider-shaped tuning, passed through verbatim from the task binding.
   * `{ thinking: { type: "adaptive" }, cacheTtl: "1h" }` for Anthropic,
   * `{ reasoning_effort: "low" }` for OpenAI.
   *
   * **The layer never reads this** — except for the handful of keys that are
   * ITS OWN (`RESERVED_OPTION_KEYS` below). Five providers have five
   * vocabularies for tuning, and normalizing them would mean inventing a sixth
   * that maps badly onto all of them (AD-13). The adapter is the only thing
   * that looks inside.
   */
  providerOptions?: Record<string, unknown>;
}

// ── The answer ──────────────────────────────────────────────────────────────

/**
 * What a call consumed, as far as the provider was willing to say.
 *
 * Every field is a count the provider reported. Nothing here is estimated, and
 * nothing here is money — turning these into a cost is `lib/ai/pricing.ts`'s
 * job and needs a price table this layer knows nothing about.
 */
export interface Usage {
  /** TOTAL input, including whatever was served from cache. */
  inputTokens: number;
  outputTokens: number;
  /** Served from cache. 0 when the provider does not report it. */
  cachedInputTokens: number;
  /** Written to cache. Anthropic only; 0 elsewhere. */
  cacheWriteTokens: number;
  /**
   * Images produced. 0 for every text call.
   *
   * A count and not a token, deliberately: image models are billed per picture
   * (or per picture AND per prompt token), and folding that into `outputTokens`
   * would make one number mean two things and quietly mis-price both. The price
   * table has its own `image` rate beside the token rates for the same reason.
   */
  images: number;
  /**
   * Reasoning tokens, where the provider itemises them.
   *
   * Gemini bills these and cannot switch them off on its stronger models,
   * which is the whole reason it has a native adapter rather than going
   * through the OpenAI-compatible shim (AD-12).
   */
  thinkingTokens: number;
  /**
   * The provider's own total, when it gave one.
   *
   * Kept alongside the breakdown rather than recomputed, because the two
   * disagreeing is the signal: a total larger than the parts means the provider
   * billed for tokens it did not itemise. `unexplainedTokens()` below turns
   * that into a number, and FR-43a prices it conservatively.
   */
  reportedTotalTokens: number | null;
  /**
   * What the PROVIDER said the call cost, in micros of `reportedCostCurrency`.
   * Only OpenRouter reports one today. Null everywhere else.
   */
  reportedCostMicros: number | null;
  /** Currency of `reportedCostMicros`. USD for OpenRouter. */
  reportedCostCurrency: string | null;
}

/**
 * Billed tokens the provider's own breakdown does not account for.
 *
 * A standing guard over all five adapters, not a workaround for one of them.
 * With native adapters for Anthropic and Gemini, no shipped provider is
 * expected to return anything but 0 here — which is exactly what makes a
 * non-zero reading worth acting on instead of background noise.
 */
export function unexplainedTokens(usage: Usage): number {
  if (usage.reportedTotalTokens === null) return 0;
  const itemised = usage.inputTokens + usage.outputTokens;
  return Math.max(0, usage.reportedTotalTokens - itemised);
}

/** An all-zero usage, for adapters filling in what a provider left out. */
export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    images: 0,
    thinkingTokens: 0,
    reportedTotalTokens: null,
    reportedCostMicros: null,
    reportedCostCurrency: null,
  };
}

export interface Result {
  text: string;
  /**
   * **Null means the provider reported nothing** — not that it reported zero.
   *
   * The distinction is load-bearing for the cost report: a row with zero tokens
   * is a call that consumed nothing, and a row with no usage at all is a call
   * whose cost is unknown. Recording the second as the first would make an
   * unmeasured call look free.
   */
  usage: Usage | null;
  /** Provider-specific, passed through for the log. Never interpreted. */
  stopReason: string | null;
  /** The tools the model asked for. Empty when it answered in text. */
  toolCalls: ToolCall[];
}

export type StreamEvent =
  | { type: "delta"; text: string }
  /**
   * One COMPLETE, parsed call — never incremental argument fragments. The
   * arguments execute server-side; nothing downstream has a use for half a
   * JSON string. Yielded before the `done` of its round.
   */
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; usage: Usage | null; stopReason: string | null };

// ── Failure ─────────────────────────────────────────────────────────────────

/**
 * The ways a call can fail, as codes rather than sentences (AD-10).
 *
 * Listed as a VALUE so `i18n/messages.test.ts` can walk it: a code with no
 * translation reaches somebody as its own name.
 *
 * `providerFailed` is the catch-all and is deliberately last — an adapter that
 * cannot classify a failure says so rather than guessing, because guessing
 * "provider refused" for what was actually a bad request sends whoever reads
 * the log looking in the wrong place.
 */
export const PROVIDER_ERROR_CODES = [
  "noCredential",
  "unknownModel",
  "providerRefused",
  "providerUnreachable",
  "requestTooLarge",
  "providerFailed",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    /** For the log only. Never shown to a Member. */
    message?: string,
    public readonly provider?: ProviderId,
    /**
     * What the provider had already consumed when this call failed.
     *
     * Only ever set where work was genuinely done and paid for before the
     * failure — the Gemini image adapter draws one picture per HTTP call, so a
     * request for four that fails on the third has two pictures on the invoice
     * and nothing to show for them. Without this the row written by `run.ts`
     * carried `usage: null` and those two appeared nowhere: not in `ai_usage`,
     * not on `/dashboard/admin/ai-costs`, not in the "could not account for"
     * column either. Money spent and invisible is the one state the cost page
     * exists to make impossible.
     *
     * Left undefined by every adapter that consumed nothing.
     */
    public readonly usage?: Usage | null,
  ) {
    super(message ?? code);
    this.name = "ProviderError";
  }
}

/**
 * HTTP status → outcome, shared by every adapter that speaks HTTP.
 *
 * One table rather than five, so "what does a 429 mean" has one answer. The
 * mapping is deliberately coarse: the point is to tell apart the four things a
 * caller would do differently — fix the config, fix the request, back off, or
 * look at the log.
 */
export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return "noCredential";
  if (status === 404) return "unknownModel";
  if (status === 413) return "requestTooLarge";
  if (status === 429) return "providerRefused";
  // 529 is Anthropic's "overloaded"; 502/503/504 are the usual gateway family.
  if (status === 529 || status === 502 || status === 503 || status === 504) {
    return "providerRefused";
  }
  if (status >= 500) return "providerFailed";
  return "providerFailed";
}

// ── The keys in `providerOptions` that are ours ─────────────────────────────

/**
 * Option keys this layer invented, consumed by an adapter and NEVER sent.
 *
 * `cacheTtl` is the whole list: it says how long Anthropic's cached prefix
 * stays warm, and `anthropic.ts` turns it into a `cache_control` field rather
 * than passing it on. No provider has a parameter by that name.
 *
 * Every adapter has to strip these, not just the one that uses them — and that
 * is the point of the list existing. A binding is written for one provider, but
 * the ordinary way to move a task to another company is to change `provider`
 * and `model` and leave the rest. Anything we invented would then travel to an
 * API that never heard of it and come back as a 400 on the customer's first
 * message. Options a person set THEMSELVES are a different matter — those are
 * their business (AD-13), and `bindingProblems()` in `lib/ai/task-rules.mjs`
 * names them at check time instead.
 */
export const RESERVED_OPTION_KEYS = ["cacheTtl"] as const;

/** `providerOptions` minus what belongs to this layer — safe to put on the wire. */
export function passthroughOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options ?? {}).filter(
      ([key]) => !(RESERVED_OPTION_KEYS as readonly string[]).includes(key),
    ),
  );
}

// ── The adapter ─────────────────────────────────────────────────────────────

export interface Adapter {
  readonly id: ProviderId;
  complete(req: NormalizedRequest, key: string): Promise<Result>;
  stream(req: NormalizedRequest, key: string): AsyncIterable<StreamEvent>;
}

// ── Producing a picture ─────────────────────────────────────────────────────

/**
 * What this app asks for when it wants an image.
 *
 * Deliberately smaller than the text request. There is no `system`, no message
 * history and no cache ordering, because none of the image APIs have those —
 * modelling them anyway would be inventing a shape none of the providers can
 * satisfy, which is the mistake `providerOptions` exists to avoid (AD-13).
 */
export interface ImageRequest {
  /** The provider's own model id. Never translated between providers. */
  model: string;
  /** What to draw. Reaches the provider verbatim. */
  prompt: string;
  /** How many. One unless a caller has a reason. */
  n: number;
  /**
   * Provider-shaped, e.g. `"1024x1024"`. Passed through when the provider has
   * such a parameter and ignored where it does not — the sizes on offer differ
   * per model and normalising them would mean maintaining a table of what each
   * vendor currently allows.
   */
  size?: string;
  timeoutMs: number;
  providerOptions?: Record<string, unknown>;
}

/** One picture, as bytes plus what is known about it. */
export interface GeneratedImage {
  bytes: Uint8Array;
  /** From the provider's own answer, never guessed from the model name. */
  mime: string;
  width: number | null;
  height: number | null;
  /**
   * The prompt the provider actually used, where it says so.
   *
   * OpenAI rewrites a prompt before drawing and returns what it used. Worth
   * keeping: it is the difference between "why does this not look like what I
   * asked for" and an answer.
   */
  revisedPrompt: string | null;
}

export interface ImageResult {
  images: GeneratedImage[];
  usage: Usage | null;
}

/**
 * A provider that can draw.
 *
 * Separate from `Adapter` rather than an optional method on it, because the two
 * capabilities are genuinely independent: Anthropic and Mistral write text and
 * draw nothing, and a `complete()` that throws "not supported" would push that
 * fact to call time. Which providers implement this is data on the registry,
 * so `node run.mjs ai-check` can say it before anybody asks for a picture.
 */
export interface ImageAdapter {
  readonly id: ProviderId;
  createImage(req: ImageRequest, key: string): Promise<ImageResult>;
}

/**
 * How long a call may take before the layer gives up on it.
 *
 * Ours, not the SDK's. A default measured in minutes is right for a batch job
 * and wrong for a request a Member is waiting on.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Reserved for the task layer (Story 6.3); exported here so the shape is one place. */
export type TaskRateLimit = Limit;
