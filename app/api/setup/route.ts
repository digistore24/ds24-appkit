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

// ── The cap, and why this small door needs one too ─────────────────────────
//
// Finding M-7 of the 2026-08-18 scan, and the half that is easy to leave
// behind: the multipart door next to this one is the obvious offender, but the
// order here is the same and so is the class. `runSetupCall()` → `guardSetup()`
// is where a credential is first looked at, and `await request.json()` runs
// BEFORE it — so while the surface is switched on, an unauthenticated stranger
// could have the app buffer an arbitrary number of bytes and then be told 401.
// Repeat that and the app runs out of memory. `proxy.ts` matches `/dashboard`
// only and `experimental.serverActions.bodySizeLimit` (next.config.ts) binds
// Server Actions, not Route Handlers, so nothing in front of this line was
// bounding it.
//
// 256 KiB is measured rather than guessed. The largest input any tool on this
// surface declares is `path` at 1024 characters (`lib/setup/tools.ts`), and the
// widest whole call — tool name, env, mode, a confirmation token and the
// biggest declared input across the core and both shipped modules — is on the
// order of a kilobyte. This is roughly 250 times that, so it is a ceiling
// against abuse and never a limit a real call meets.
const MAX_SETUP_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  // First line, before anything is read. A parse error answered ahead of the
  // switch tells a stranger this route exists — see surfaceOffResponse().
  const off = surfaceOffResponse();
  if (off) return off;

  // 🚨 The announced length SECOND, before the body is pulled into memory. Same
  // shape as `/api/ipn`: `content-length` first, then a measurement of what
  // really arrived. A check placed after the read has already paid the cost it
  // exists to avoid.
  //
  // ⚠️ It answers `badRequest`, which is the answer this door ALREADY gives a
  // malformed body ("Body must be JSON."). That is deliberate and it is the
  // whole reason no new status code is invented here: a refusal a stranger can
  // tell apart from the ordinary one is an oracle, and a body they chose the
  // size of is the cheapest way to interrogate it. The switched-off 404 above
  // and the 401 an unauthenticated ordinary call gets are both untouched.
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_SETUP_BODY_BYTES) {
    return setupError("badRequest", "Body too large.");
  }

  // Read as TEXT so the size can be measured on the bytes that actually
  // arrived — a `content-length` is a claim by the caller, and a chunked
  // request makes none at all. `Buffer.byteLength`, not `raw.length`: that
  // counts UTF-16 units, so a multi-byte body would slip through at roughly
  // three times the cap.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return setupError("badRequest", "Body must be JSON.");
  }
  if (Buffer.byteLength(raw) > MAX_SETUP_BODY_BYTES) {
    return setupError("badRequest", "Body too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
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
