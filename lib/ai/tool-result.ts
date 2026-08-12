// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The shape a tool answers in — the one small contract between the registry
// (lib/ai/tools.ts), the executor (lib/ai/run-tool.ts) and the chat loop that
// reads the result back to the model.

/** One block of a tool result. Text only — these tools return no binaries. */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallResult {
  content: TextContent[];
  /**
   * The tool ran and failed, as opposed to the CALL being wrong.
   *
   * This distinction is the one people get wrong, and it changes what the
   * model does next. "No such tool" or malformed arguments mean the call was
   * invalid and the model should stop. An `isError: true` RESULT means "the
   * tool ran and could not do it", and the model is meant to read the text,
   * adapt and possibly try something else.
   *
   * "You do not have enough tokens" is the second kind. So is "no plan for
   * that". Hiding either behind a hard error starves the model of the reason,
   * and it retries the identical call.
   */
  isError?: boolean;
}

/** A plain prose result — for tools whose answer is a sentence, not data. */
export function toolText(text: string): ToolCallResult {
  return { content: [{ type: "text", text }] };
}

export function toolFailure(text: string): ToolCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** A result carrying structured data, serialised for the model to read. */
export function toolData(data: unknown): ToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
