// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's own data download — Art. 15 and Art. 20 GDPR, self-service.
//
// ── It guards itself, and it has to ────────────────────────────────────────
// `proxy.ts` matches `/dashboard/:path*` and nothing else, so everything under
// `app/api/` is PUBLIC until it protects itself. Same rule as
// `app/api/chat/route.ts`.
//
// ── Why a route handler and not a Server Action ────────────────────────────
// The answer is a FILE. A Server Action returns a value into a React tree; it
// cannot set `Content-Disposition`, and building a download out of one means
// stuffing a megabyte of JSON through the RSC payload and re-serialising it in
// the browser. A route handler simply answers with the file.
//
// ── The one property that makes this safe ──────────────────────────────────
// **The member id comes from the session and from nowhere else.** There is no
// query parameter, no body, nothing to tamper with. This endpoint hands over
// everything the app knows about a person, so an id it accepted from the caller
// would be the most damaging IDOR in the app — one request per address until
// somebody's chat transcripts and purchase history come back. Do not add a
// parameter here, not even "for the operator": the Operator already has
// `node run.mjs data-export --email …`, which runs on a machine they control
// and warns them what to redact.
import { currentActiveUser } from "@/lib/authz";
import { isLimited, record } from "@/lib/rate-limit";
import { buildMemberExport } from "@/lib/privacy/export";

// Reads the database and must never be cached — a copy of somebody's personal
// data is the last thing that should sit in a CDN.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "data-export";

/**
 * Three an hour.
 *
 * Not a security control — the caller is already authenticated and is asking
 * for their own data. It is a cost brake: this sweeps a dozen tables, and a
 * held-down button would do it as fast as the database answers. Three is enough
 * for somebody who downloaded the file and wants it again after fixing their
 * spreadsheet.
 *
 * In-memory and per-process, like every limit in this app — behind several
 * instances the effective allowance is multiplied by their number
 * (`lib/rate-limit.ts`).
 */
const LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };

export async function GET(): Promise<Response> {
  const user = await currentActiveUser();
  // A route handler answers 401 rather than redirecting — a redirect to an HTML
  // sign-in page is a nonsensical answer to a `fetch()`, and the caller would
  // report a JSON syntax error instead of "you are signed out". Anonymous and
  // blocked get the same answer on purpose: a signed-out caller has no business
  // learning which of the two they are.
  if (user.state !== "active") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const memberId = user.session.user.id;

  if (isLimited(BUCKET, memberId, LIMIT)) {
    return Response.json({ error: "rateLimited" }, { status: 429 });
  }
  record(BUCKET, memberId, LIMIT);

  const report = await buildMemberExport(memberId);

  // A date in the name, because the answer is a snapshot and somebody keeping
  // two of them should be able to tell which is which.
  const day = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(report, null, 2) + "\n", {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="my-data-${day}.json"`,
      // Belt and braces beside `dynamic = "force-dynamic"`: that governs
      // Next.js's own cache, this one governs everything between here and the
      // browser.
      "cache-control": "no-store, private",
    },
  });
}
