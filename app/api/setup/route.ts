// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The setup surface's JSON door.
//
// ⚠️ `proxy.ts` matches `/dashboard` and nothing else, so this route is PUBLIC
// until it guards itself — which it does through `runSetupCall()`, whose first
// act is `guardSetup()`. `lib/setup/guard-presence.test.ts` reads this file
// rather than trusting the sentence, and `app/route-protection.test.ts` carries
// its entry.

import { setupError } from "@/lib/setup/rules";
import { runSetupCall, surfaceOffResponse } from "@/lib/setup/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // First line, before anything is read. A parse error answered ahead of the
  // switch tells a stranger this route exists — see surfaceOffResponse().
  const off = surfaceOffResponse();
  if (off) return off;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return setupError("badRequest", "Body must be JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return setupError("badRequest", "Body must be a JSON object.");
  }

  return runSetupCall({ request, body });
}

/** The surface answers nothing else. A GET is not a setup act. */
export async function GET(): Promise<Response> {
  return surfaceOffResponse() ?? setupError("badRequest", "Use POST.");
}
