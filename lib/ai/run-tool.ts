// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Running one tool, with every refusal in the call path.
//
// The chat's tool executor (lib/ai/chat-endpoint.ts) stands on this — reached
// from the web door and from the HTTP API's chat endpoint alike. The
// enforcement lives HERE — scope, plan gate, argument normalization, the
// TokenError mapping — so a tool an app registers later is refused in the
// call path, never merely hidden from a listing. Nothing in this file may
// import anything request/Response-shaped: it runs in-process, below every
// transport.
//
// Who is acting travels in `ToolRunner`, and the surface binds its own proof
// of authority: the chat binds `spendTokens`, which authenticates the
// session. This function never builds that proof itself — that is the point.
import { hasPlan } from "@/lib/entitlements/manage";
import { TokenError } from "@/lib/tokens/rules";
import { toolFailure, type ToolCallResult } from "./tool-result";
import { findTool, type ChatTool, type ToolContext } from "./tools";

export interface ToolRunner {
  /** The authenticated member — from the session, never from arguments. */
  memberId: string;
  scope: "read" | "write";
  /** Charges THIS member. Bound by the surface that built the runner. */
  spend(amount: number, note: string): Promise<number>;
  /**
   * Records a hit's page in THIS answer's link ledger and returns the marker.
   * Bound by the surface for the same reason `spend` is: the ledger belongs to
   * one request, and a tool must have no way to name another one.
   */
  offerLink(url: string | null, anchor: string | null, label: string): string | null;
}

export type RunToolOutcome =
  /** No such tool — the caller decides how to say so to the model. */
  | { kind: "unknownTool" }
  /** The tool answered — including refusals, which are `isError` RESULTS. */
  | { kind: "result"; tool: ChatTool; result: ToolCallResult };

export async function runTool(
  name: string,
  args: unknown,
  runner: ToolRunner,
): Promise<RunToolOutcome> {
  const tool = findTool(name);
  if (!tool) return { kind: "unknownTool" };

  // THE scope check. In the call path and not merely in the listing: a caller
  // may name any tool it likes, and a filtered list is cosmetics. A read-only
  // runner may run read-only tools and nothing else.
  if (runner.scope === "read" && !tool.readOnly) {
    return {
      kind: "result",
      tool,
      result: toolFailure(
        `This caller is read-only, and "${name}" changes data.`,
      ),
    };
  }

  // The per-tool plan gate, for the same reason: listed or not, the refusal
  // has to be here. `hasPlan` reads `grants`, never a billing table.
  if (tool.requiresPlan && !(await hasPlan(runner.memberId, tool.requiresPlan))) {
    return {
      kind: "result",
      tool,
      result: toolFailure(
        `"${name}" needs a plan this account does not currently hold. ` +
          `The user can see and change that in the app under Plans.`,
      ),
    };
  }

  const toolArgs =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  // The context is built HERE, bound to the authenticated member. A handler
  // gets no way to name a different account — see lib/ai/tools.ts, rule 1.
  const ctx: ToolContext = {
    memberId: runner.memberId,
    spend: runner.spend,
    offerLink: runner.offerLink,
  };

  let result: ToolCallResult;
  try {
    result = await tool.run(toolArgs, ctx);
  } catch (error) {
    // A shortfall is a RESULT the model is meant to read and act on, not a
    // hard error — see the note on `ToolCallResult.isError`. Everything else
    // is the surface's problem and is rethrown.
    if (error instanceof TokenError) {
      result = toolFailure(
        "Not enough tokens on this account for that call. The user can top up in the app under Plans.",
      );
    } else {
      throw error;
    }
  }

  return { kind: "result", tool, result };
}
