// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Minting an address the browser may write one object to — half one of the
// direct-to-bucket path.
//
// ── It guards itself, and it has to ────────────────────────────────────────
// `proxy.ts` matches `/dashboard/:path*` and nothing else, so everything under
// `app/api/` is PUBLIC until it protects itself. Same shape as
// `app/api/media/route.ts` next door: prove the session, then hand member and
// role to `lib/media/`, where every decision lives.
//
// ── This is the door where the hourly slot is spent ────────────────────────
// `guardUploadEntry()` counts here and `guardUploadConfirm()` deliberately does
// not count on the other half — an address handed out is the thing the ceiling
// protects, whether or not anybody writes to it, and counting both halves would
// silently halve an operator's configured allowance.
//
// ── What comes back carries no key ─────────────────────────────────────────
// `{ ticketId, url, expiresAt }`, and nothing else. The storage key is derived
// from an id this app minted (`lib/media/rules.ts` → `storageKey()`), it is
// inside the signed url where it cannot be edited without breaking the
// signature, and the confirm step takes the TICKET id. A response that also
// spelled the key out would be handing back the one value this layer refuses to
// accept from a request.
import { currentActiveUser } from "@/lib/authz";
import { createUploadTicket } from "@/lib/media/manage";
import { MediaError } from "@/lib/media/rules";
import { UPLOAD_BUCKET, guardUploadEntry } from "@/lib/media/upload-endpoint";
import { forgetOne } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Who is asking. "Not signed in" and "blocked" both answer 401 — a caller
  // with no session has no business learning which of the two they are.
  const current = await currentActiveUser();
  if (current.state !== "active") {
    return Response.json({ error: "notSignedIn" }, { status: 401 });
  }
  const memberId = current.session.user.id;
  if (!memberId) {
    return Response.json({ error: "notSignedIn" }, { status: 401 });
  }

  // Switch, store health, hourly share — before any work, and before the body
  // is read, for the reason `handleUpload()` states.
  try {
    guardUploadEntry(memberId);
  } catch (error) {
    if (error instanceof MediaError) {
      return Response.json(
        { error: error.code },
        { status: error.code === "rateLimited" ? 429 : 503 },
      );
    }
    throw error;
  }

  // A request that turns out to describe no file gets its slot BACK. Counting
  // before the body is read is right — see `handleUpload()` — and it also
  // meters the one case that costs nothing. A form bug or a client retry loop
  // would otherwise lock a member out for an hour without an address having
  // been minted, and there is no way for them to clear it. `forgetOne()` hands
  // back exactly the hit `guardUploadEntry()` recorded; `clearKey()` would turn
  // a broken request into a quota reset.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    forgetOne(UPLOAD_BUCKET, memberId);
    return Response.json({ error: "noFile" }, { status: 400 });
  }
  const fields = (body ?? {}) as Record<string, unknown>;
  const claimedMime = typeof fields.mime === "string" ? fields.mime : "";
  const filename = typeof fields.filename === "string" ? fields.filename : null;
  const declaredBytes = typeof fields.bytes === "number" ? fields.bytes : NaN;
  if (!claimedMime || !Number.isFinite(declaredBytes) || declaredBytes <= 0) {
    forgetOne(UPLOAD_BUCKET, memberId);
    return Response.json({ error: "noFile" }, { status: 400 });
  }

  try {
    const ticket = await createUploadTicket({
      ownerId: memberId,
      role: current.session.user.role ?? "member",
      claimedMime,
      filename,
      declaredBytes,
      // The slot, and it is the same one `handleUpload()` pins for the same
      // reason: this is the generic door, so the object belongs to the core.
      // Read from code and never from the request — a namespace out of a body
      // would let a caller file their upload into a module's key space. It is
      // also what the confirm route has to name to redeem this ticket at all.
      namespace: "core",
      category: "upload",
      // Visibility is deliberately NOT read from the request — the same rule
      // `handleUpload()` states and for the same reason: a customer must not be
      // able to publish their own upload, and certainly not to file one as
      // `entitled` and hand themselves paid content. An app that needs those
      // calls `createUploadTicket()` from a Server Action with an operator
      // check in front of it.
      visibility: "owner",
    });

    return Response.json(
      { ticketId: ticket.ticketId, url: ticket.url, expiresAt: ticket.expiresAt.toISOString() },
      { status: 201, headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof MediaError) {
      const status =
        error.code === "notAllowedForRole"
          ? 403
          : error.code === "tooLarge"
            ? 413
            : error.code === "storeUnavailable"
              ? 503
              : 400;
      return Response.json({ error: error.code }, { status });
    }
    // The provider's own error text belongs in the log and never in the
    // response — it is the difference between "wrong key" and "clock skew".
    console.error("[media] minting an upload address failed:", error);
    return Response.json({ error: "storeUnavailable" }, { status: 502 });
  }
}
