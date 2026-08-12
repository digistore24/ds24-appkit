// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The tool loop — a task that may CALL things before it answers.
//
//   for await (const event of streamTaskWithTools("chat", input, CHAT_TOOLS)) …
//
// Each round is one `streamTask` call: the model streams text, may ask for
// tools, the loop executes them IN-PROCESS and feeds the results back as the
// next round's messages. It ends when a round asks for nothing — or at
// MAX_TOOL_ROUNDS, where the final round is issued with `toolChoice: "none"`
// so the model must answer in text instead of asking again.
//
// ── What the accounting looks like ─────────────────────────────────────────
// One `ai_usage` row per ROUND, written by `streamTask`'s own finally — a row
// has always meant one provider round-trip, and this keeps that true. The
// `done` event this loop yields carries the FINAL round's usage only; the
// bill is the table, not the event.
//
// ── Cache discipline ───────────────────────────────────────────────────────
// The identical `system` array and the identical `tools` array go out every
// round; each round's messages extend the previous round's — a prefix
// extension, which is exactly the shape provider caches reward. Tool lists
// are MODULE CONSTANTS (see ToolDefinition in providers/types.ts).
//
// ── Untrusted, both directions ─────────────────────────────────────────────
// A tool's INPUT was written by a model reading text somebody else may have
// authored; the executor re-validates it (the schema is a hint). A tool's
// OUTPUT is content the model reads — never instructions this loop acts on.
// Errors cross the boundary as CODES (AD-10): what a raw `error.message`
// might quote is nobody's business but the log's.
import { streamTask, type TaskInput } from "./run";
import type {
  ModelMessage,
  ToolCall,
  ToolDefinition,
  ToolResult,
  Usage,
} from "./providers/types";

/**
 * A tool refusal with a stable code, thrown by executors. The code — never a
 * sentence — is what the model reads; anything else a throw carries stays in
 * the server log.
 */
export class ToolError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ToolError";
  }
}

/** A tool the loop can execute: its wire definition plus the member-scoped executor. */
export interface ServerTool {
  definition: ToolDefinition;
  /**
   * Runs the call and returns what the model reads. Member scoping happened
   * when this closure was built (see lib/ai/chat-endpoint.ts) — the loop
   * never sees an account.
   */
  execute(input: Record<string, unknown>): Promise<string>;
}

/**
 * The ceiling on provider round-trips per question.
 *
 * Five is deliberate head-room for search → fetch → answer with a retry, not
 * an invitation: each round costs a full prompt (cached, but billed) and up
 * to `timeoutMs` of wall clock — the worst case is MAX_TOOL_ROUNDS × the
 * binding's timeout. The final round forces a text answer rather than cutting
 * the conversation dead.
 */
export const MAX_TOOL_ROUNDS = 5;

export type ToolLoopEvent =
  | { type: "delta"; text: string }
  /** A tool is about to run. The NAME only — input may quote member text. */
  | { type: "tool"; name: string }
  | { type: "done"; usage: Usage | null; stopReason: string | null };

async function executeCall(call: ToolCall, tools: ServerTool[]): Promise<ToolResult> {
  const base = { toolCallId: call.id, name: call.name };
  // Unparseable arguments never reach an executor — the model retried a
  // malformed call often enough when told so; running it on `{}` would run
  // the WRONG call instead.
  if (call.inputError) {
    return { ...base, content: "invalidArguments", isError: true };
  }
  const tool = tools.find((t) => t.definition.name === call.name);
  if (!tool) {
    return { ...base, content: "unknownTool", isError: true };
  }
  try {
    return { ...base, content: await tool.execute(call.input) };
  } catch (error) {
    if (error instanceof ToolError) {
      return { ...base, content: error.code, isError: true };
    }
    // Ours, not the model's: the message may quote internals, so the model
    // gets a code and the log gets the truth.
    console.error(`[tool-loop] ${call.name} failed:`, error);
    return { ...base, content: "toolFailed", isError: true };
  }
}

/**
 * `streamTask`, with the calls executed and fed back.
 *
 * With an empty tool list this degenerates to exactly one round whose request
 * carries no tools field at all — byte-identical to a plain `streamTask`
 * call, which is what keeps the tool-less path unchanged.
 *
 * Exactly ONE `done` is yielded, at the end of the last round. A provider or
 * network error propagates exactly as `streamTask` throws it — completed
 * rounds are already recorded, the failing round records through
 * `streamTask`'s own finally.
 */
export async function* streamTaskWithTools(
  task: Parameters<typeof streamTask>[0],
  input: TaskInput,
  tools: ServerTool[],
): AsyncGenerator<ToolLoopEvent> {
  const definitions = tools.map((tool) => tool.definition);
  const messages: ModelMessage[] = [...input.messages];

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    const calls: ToolCall[] = [];
    let roundText = "";
    let done: { usage: Usage | null; stopReason: string | null } | null = null;

    const roundInput: TaskInput = {
      ...input,
      messages,
      ...(definitions.length > 0
        ? { tools: definitions, toolChoice: lastRound ? "none" : "auto" }
        : {}),
    };

    for await (const event of streamTask(task, roundInput)) {
      if (event.type === "delta") {
        roundText += event.text;
        yield event;
      } else if (event.type === "tool_call") {
        calls.push(event.call);
        yield { type: "tool", name: event.call.name };
      } else {
        done = { usage: event.usage, stopReason: event.stopReason };
      }
    }

    // No calls — or a final round that returned calls anyway, which are NOT
    // executed: the round was sent with toolChoice "none", and a provider
    // that ignores it does not get to overrule the ceiling.
    if (calls.length === 0 || lastRound) {
      yield { type: "done", usage: done?.usage ?? null, stopReason: done?.stopReason ?? null };
      return;
    }

    messages.push({ role: "assistant", content: roundText, toolCalls: calls });

    // Sequentially, in call order — the order is load-bearing for Gemini,
    // which matches results to calls by name and position (see gemini.ts).
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await executeCall(call, tools));
    }
    messages.push({ role: "tool", results });
  }
}
