// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The assistant's endpoint — the browser's door to the chat pipeline.
//
// ── It guards itself, and it has to ────────────────────────────────────────
// `proxy.ts` matches `/dashboard/:path*` and nothing else, so everything under
// `app/api/` is PUBLIC until it protects itself. This route's whole job is the
// who-question: prove the session cookie, then hand the member to the shared
// pipeline in `lib/ai/chat-endpoint.ts` — which `app/api/v1/chat/messages`
// enters too, with a bearer key instead of a cookie. The checks and the
// NDJSON stream live THERE, once.
import { getUserLocale } from "@/i18n/locale";
import { currentActiveUser } from "@/lib/authz";
import { runChatRequest } from "@/lib/ai/chat-endpoint";

// The knowledge base is read from the filesystem and the SDK is a Node client —
// neither works on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Who is asking. Both "not signed in" and "blocked" answer 401: a caller
  // without a session has no business learning which of the two they are.
  const current = await currentActiveUser();
  if (current.state !== "active") {
    return Response.json({ type: "error", code: "chatUnavailable" }, { status: 401 });
  }
  const memberId = current.session.user.id;
  if (!memberId) {
    return Response.json({ type: "error", code: "chatUnavailable" }, { status: 401 });
  }

  return runChatRequest({
    memberId,
    request,
    locale: await getUserLocale(),
    // The session knows; nothing downstream re-derives it. See runChatRequest.
    impersonating: Boolean(current.session.user.impersonation),
  });
}
