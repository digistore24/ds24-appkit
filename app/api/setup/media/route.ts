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
import { ROUTE_HANDLER_BODY_LIMIT_BYTES } from "@/lib/media/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── The cap, and why the door that carries bytes needed it most ────────────
//
// Finding M-7 of the 2026-08-18 scan. The order used to read: the on/off switch
// (`surfaceOffResponse()`), then `await request.formData()` — the whole body,
// parsed and in memory — then `part.arrayBuffer()`, and only THEN
// `runSetupCall()` → `guardSetup()`, which is where a credential is first
// looked at. So with the surface switched on, an unauthenticated stranger could
// have the app buffer a multi-gigabyte POST and then be answered 401. Repeat it
// and the process dies. Nothing in front of this route was bounding it:
// `proxy.ts` matches `/dashboard` only, and
// `experimental.serverActions.bodySizeLimit` (next.config.ts) binds Server
// Actions rather than Route Handlers.
//
// The FILE ceiling is `ROUTE_HANDLER_BODY_LIMIT_BYTES` — the number this app
// already declares for "what a route handler lets through the process", and the
// same one the HTTP API's upload door quotes. Taken from there rather than
// spelled again, because two numbers that agree today are how a door quietly
// ends up with a different limit from its twin.
//
// ⚠️ What that takes away, stated plainly: `refuseUpload()` measures a file
// against its kind's raw `maxBytes`, and `video` is 2 GB for the
// direct-to-bucket path — so in principle this door used to accept a 2 GB video
// and buffer all of it. `ROUTE_HANDLER_BODY_LIMIT_BYTES`' own docstring is the
// argument that this was never a capability but an outage waiting for its
// first user: "quoting a gigabyte at this door promises an outage". Anything
// larger is what the direct-to-bucket path is for (docs/visuals.md).
//
// 🚨 And `docs/setup-mcp.md` was already TELLING the operator this number —
// *"the multipart door buffers the whole part against a 50 MB route ceiling,
// which a lesson recording does not fit through"* — as the reason product media
// goes through the applier route instead. Nothing enforced it. The doc was not
// wrong about what should happen; it was describing a ceiling that was not
// there, which is the worst kind of true sentence. This line is what makes it
// one.
//
// The ENVELOPE gets a megabyte on top, because a multipart body is the file
// plus its framing: the boundary lines, one set of part headers per field, and
// the `input` JSON travelling beside the bytes. Without the slack a file
// exactly at the ceiling would be refused for its own packaging.
const MAX_SETUP_MEDIA_FILE_BYTES = ROUTE_HANDLER_BODY_LIMIT_BYTES;
const MAX_SETUP_MEDIA_BODY_BYTES = ROUTE_HANDLER_BODY_LIMIT_BYTES + 1024 * 1024;

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

  // 🚨 The announced length SECOND, before `formData()` pulls anything into
  // memory. Same shape as `/api/ipn`: `content-length` first, then a
  // measurement of what really arrived. A check placed after the parse has
  // already paid the cost it exists to avoid.
  //
  // ⚠️ It answers `badRequest`, which is the answer this door ALREADY gives a
  // body it cannot use ("Body must be multipart/form-data."). That is
  // deliberate and it is why no new status code is invented here: a refusal a
  // stranger can tell apart from the ordinary one is an oracle, and a body they
  // chose the size of is the cheapest way to interrogate it. The switched-off
  // 404 above and the 401 an unauthenticated ordinary call gets are untouched.
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_SETUP_MEDIA_BODY_BYTES) {
    return setupError("badRequest", "Body too large.");
  }

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

  // And again on what actually arrived. A `content-length` is a claim by the
  // caller and a chunked request makes none at all, so the announced check
  // above is the cheap half and this is the one that holds. It reads the FILE
  // ceiling rather than the envelope one — the megabyte of slack is for
  // multipart framing, not for the payload.
  if (bytes.byteLength > MAX_SETUP_MEDIA_FILE_BYTES) {
    return setupError("badRequest", "Body too large.");
  }

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
