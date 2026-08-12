// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The assistant's transcript — read and clear, over HTTP.
//
// The same two operations the chat page has, on the same functions, with the
// same deliberate default: `conversationId = null` is the assistant's ONE
// conversation, so clearing it never touches companion turns
// (`lib/ai/conversation.ts` says why that scoping is load-bearing).
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";
import { clearConversation, listConversation } from "@/lib/ai/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const turns = await listConversation(g.memberId);
  return apiJson({
    messages: turns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      // Additive, and it belongs with the text: a companion app that renders
      // `[link:…]` markers needs the same per-message whitelist the web
      // window gets, or it either shows bracket text or — far worse — trusts
      // any marker that parses. `null` for a question and for every turn
      // older than the column.
      links: turn.links,
      createdAt: turn.createdAt.toISOString(),
    })),
  });
}

/** Deleting a transcript is destructive — write scope, like the page's button. */
export async function DELETE(request: Request): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  const deleted = await clearConversation(g.memberId);
  return apiJson({ deleted });
}
