// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading back what actually landed — half two of the direct-to-bucket path.
//
// ── It guards itself, and it has to ────────────────────────────────────────
// `proxy.ts` matches `/dashboard/:path*` and nothing else, so everything under
// `app/api/` is PUBLIC until it protects itself.
//
// ── The one door that uses the guard which does not count ──────────────────
// `guardUploadConfirm()` asks the same two questions as `guardUploadEntry()` —
// is media switched on, is the store usable — and skips the hourly meter,
// because the slot was already spent when the address was minted. Charging it
// twice would halve the operator's configured allowance with nothing anywhere
// saying so. `lib/media/manage.test.ts` records per door which guard it uses,
// so no second caller can adopt this one quietly.
//
// ── Nothing the client says about the file is believed here ────────────────
// The request carries a ticket id and nothing else. What the object weighs
// comes from `head()`, what it IS comes from its own first bytes. That is the
// same stance the through-the-app door takes; only the location of the bytes
// differs.
import { currentActiveUser } from "@/lib/authz";
import { confirmUpload } from "@/lib/media/manage";
import { MediaError } from "@/lib/media/rules";
import { guardUploadConfirm } from "@/lib/media/upload-endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const current = await currentActiveUser();
  if (current.state !== "active") {
    return Response.json({ error: "notSignedIn" }, { status: 401 });
  }
  const memberId = current.session.user.id;
  if (!memberId) {
    return Response.json({ error: "notSignedIn" }, { status: 401 });
  }

  try {
    guardUploadConfirm();
  } catch (error) {
    if (error instanceof MediaError) {
      return Response.json({ error: error.code }, { status: 503 });
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "uploadTicketInvalid" }, { status: 400 });
  }
  const ticketId = (body as Record<string, unknown> | null)?.ticketId;
  if (typeof ticketId !== "string" || ticketId === "") {
    return Response.json({ error: "uploadTicketInvalid" }, { status: 400 });
  }

  try {
    const row = await confirmUpload({
      ticketId,
      memberId,
      role: current.session.user.role ?? "member",
      // The slot this door redeems for, and it must be the one the mint half
      // above recorded on the ticket — a ticket minted anywhere else is
      // `uploadTicketInvalid` here, which is how this door cannot be used to
      // land an object in a module's namespace.
      namespace: "core",
      category: "upload",
    });
    return Response.json(
      { id: row.id, kind: row.kind, mime: row.mime, bytes: row.bytes },
      { status: 201, headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof MediaError) {
      // `uploadTicketInvalid` answers 404 rather than 403: an expired ticket, a
      // made-up one and somebody else's are one answer, and a 403 would tell
      // the third case apart from the first two.
      const status =
        error.code === "uploadTicketInvalid"
          ? 404
          : error.code === "tooLarge"
            ? 413
            : error.code === "notAllowedForRole"
              ? 403
              : error.code === "storeUnavailable"
                ? 503
                : 400;
      return Response.json({ error: error.code }, { status });
    }
    console.error("[media] confirming an upload failed:", error);
    return Response.json({ error: "storeUnavailable" }, { status: 502 });
  }
}
