// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The signed-in member, as their own program sees them.
//
// Guarded by `guardApi()` on the first line — `proxy.ts` protects `/dashboard`
// only, so every route here is public until it protects itself. The account
// read and written is ALWAYS the key's owner: no handler under `/api/v1` ever
// takes a member id from the request (the IDOR invariant, asserted in the
// colocated test).
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson } from "@/modules/api/api/rules";
import { findUser, setOwnName } from "@/lib/users/manage";
import { checkDisplayName } from "@/lib/users/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The profile, serialized by hand: every `Date` becomes an ISO string HERE —
 * a Date that crossed JSON is a string despite its type, so the boundary is
 * explicit. `blockedAt` is omitted, not hidden: a blocked member cannot
 * authenticate at all (`authenticate()` refuses the key), so the field would
 * be constant `null` and a lie waiting to happen.
 */
async function profile(memberId: string): Promise<Response> {
  const user = await findUser(memberId);
  // The key authenticated a moment ago, so the row exists; a vanished row is
  // a deleted account racing this request, and 404 is the honest answer.
  if (!user) return apiError("notFound", "No such account.");
  return apiJson({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  });
}

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;
  return profile(g.memberId);
}

/**
 * Rename yourself — the one write on this route.
 *
 * Email deliberately has NO endpoint: a member changes their address by
 * proving they can read mail at the new one (`lib/email-change/`), and that
 * confirmation flow cannot ride a bearer key. The mobile app sends its user
 * to the web app for that, like for everything else account-critical.
 */
export async function PATCH(request: Request): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return apiError("badRequest", "Body must be a JSON object.");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return apiError("badRequest", "Body is not valid JSON.");
  }

  if (!("name" in body)) {
    return apiError("badRequest", 'Nothing to change — this endpoint accepts "name".');
  }
  const checked = checkDisplayName(body.name);
  if (!checked.ok) {
    return apiError("badRequest", '"name" must be a string of at most 120 characters, or null.');
  }

  await setOwnName(g.memberId, checked.name);
  return profile(g.memberId);
}
