// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The setup surface's multipart door — the only one that carries bytes.
//
// 🚨 Why a second route at all, rather than a base64 field on the first:
// AD-85. A file put into a tool argument travels through the model's context
// and the transcript, costs the operator money for nothing, and puts a
// customer's material in front of an API that never needed to see it. So the
// agent names a PATH, `scripts/mcp/server.mjs` reads that file, and the bytes
// arrive here as a form part.
//
// Everything else — the guard, the confirmation, the audit row — is the same
// sequence the JSON door runs, through `runSetupCall()`, so the two cannot
// drift apart.

import { setupError } from "@/lib/setup/rules";
import { runSetupCall, surfaceOffResponse } from "@/lib/setup/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The form carries the same call the JSON door would take, plus the file.
 *
 * `input` travels as a JSON string rather than as loose form fields, and that
 * is load-bearing: the confirmation token is bound to the canonical hash of the
 * validated input, so a plan and its apply have to hash the *same* object.
 * Loose fields would arrive as strings — `"1"` instead of `1` — and a plan made
 * here could never be applied here.
 *
 * 🚨 **And the token is bound to the BYTES as well, at this door only** (A79).
 * The two halves of that sentence are one decision: the input a tool declares
 * names what will happen everywhere else in this surface, and here it does not
 * — `media_upload`'s `path` is an identifier for a file on the operator's own
 * machine, never opened by this app, while the act is the payload arriving
 * beside it. Measured before it was closed: the same token, the same `input`
 * JSON and a different file stored the different file, `200 created: 1`.
 *
 * ⚠️ One consequence, and it is the honest one: a token minted here is no
 * longer accepted at the JSON door. It used to be — accepted, SPENT, and then
 * refused `badRequest` for the bytes that door cannot carry, which cost the
 * operator a plan on a call that could never succeed. The canonical hash still
 * travels between the doors and is still one helper (`canonicalCallHash()`); it
 * now covers a property of the CALL, and a call with no payload is not the call
 * this token was minted for.
 */
export async function POST(request: Request): Promise<Response> {
  // First line, before the body is touched. See surfaceOffResponse(): parsing
  // ahead of the switch is how a 404 stops meaning "there is nothing here".
  const off = surfaceOffResponse();
  if (off) return off;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return setupError("badRequest", "Body must be multipart/form-data.");
  }

  const part = form.get("file");
  if (!(part instanceof File)) {
    return setupError("badRequest", 'Attach the file as the form field "file".');
  }

  let input: unknown = {};
  const rawInput = form.get("input");
  if (typeof rawInput === "string" && rawInput !== "") {
    try {
      input = JSON.parse(rawInput);
    } catch {
      return setupError("badRequest", '"input" must be a JSON object.');
    }
  }

  const body = {
    tool: typeof form.get("tool") === "string" ? String(form.get("tool")) : undefined,
    env: typeof form.get("env") === "string" ? String(form.get("env")) : undefined,
    mode: typeof form.get("mode") === "string" ? String(form.get("mode")) : undefined,
    confirmation:
      typeof form.get("confirmation") === "string"
        ? String(form.get("confirmation"))
        : undefined,
    input,
  };

  // Read once, here, so the tool is handed plain bytes and never a stream it
  // could forget to drain. The size ceiling is `acceptUpload()`'s, per kind —
  // this door does not invent a second one.
  const bytes = new Uint8Array(await part.arrayBuffer());

  return runSetupCall({
    request,
    body,
    file: {
      bytes,
      // What the request CLAIMED. `acceptUpload()` decides what the file
      // actually is from its first bytes and refuses a disagreement — a
      // Content-Type in a multipart part is written by whoever sent it.
      claimedMime: part.type || null,
      filename: part.name || null,
    },
  });
}
