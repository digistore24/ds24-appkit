// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Ask the assistant — the API's door to the chat pipeline.
//
// The same NDJSON stream the web chat gets, from the same pipeline
// (`lib/ai/chat-endpoint.ts`); only the who-question differs: a bearer key
// instead of a session cookie. Write scope, because a question writes a
// transcript row and spends the operator's AI budget — a read-only key pasted
// into a model's hands must not be able to run up a bill.
//
// Web and API share ONE rate bucket keyed by member, by construction — see
// the pipeline's header.
import { matchLocale } from "@/i18n/config";
import { guardApi } from "@/modules/api/api/guard";
import { runChatRequest } from "@/lib/ai/chat-endpoint";

// The knowledge base is read from the filesystem and the SDK is a Node client —
// neither works on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  return runChatRequest({
    memberId: g.memberId,
    request,
    // No cookie on this path — the client says what language it speaks, the
    // same negotiation the first web visit does (i18n/config.ts).
    locale: matchLocale(request.headers.get("accept-language")),
  });
}
