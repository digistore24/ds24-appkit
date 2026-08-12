// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The community's one cursor endpoint** — "what is new since X, for viewer
// Y". Every surface that breathes asks here: the section's thread page and the
// embed today, direct messages and the feed later.
//
// ── It guards itself, and it has to ────────────────────────────────────────
// `proxy.ts` matches `/dashboard/:path*` and nothing else, so everything under
// `app/api/` is PUBLIC until it protects itself. The order is the same one
// every community surface signs, per request, with nothing cached between them:
//
//   1. **Enablement.** Off answers 404 — the same floor a route that never
//      existed answers, for everyone (AD-67). Before anything else is read, so
//      an app with the module switched off pays nothing for this endpoint
//      (SM-16's other half).
//   2. **`currentActiveUser()`, never `requireActiveUser()`.** A `redirect()`
//      inside a route handler answers a `fetch()` with an HTML sign-in page,
//      and the caller parses HTML as JSON. Anonymous and blocked both answer
//      401 with ONE body: a caller without a session has no business learning
//      which of the two they are. `app/api/chat/route.ts` is the model.
//   3. **Per-scope access**, re-derived inside `liveAnswerFor()` from the plans
//      this member holds RIGHT NOW — with the same functions the full read
//      uses (NFR-36, AD-60). Polling makes that trivially true: every answer is
//      a fresh request through the whole guard stack, which is the hard part a
//      guarded *stream* would have to solve mid-life. That is why the transport
//      is polling (AD-61, closing OQ-1) and why "let us upgrade to SSE while we
//      are here" re-opens a decided question.
//
// ── It writes NOTHING ──────────────────────────────────────────────────────
// No read marker (that is 19.7's one explicit-acknowledgment path — a channel
// that marked things read because it delivered them would empty the inbox of a
// tab left open overnight), no discussion row (that is 20.1's one creator,
// inside the post-write transaction), no table at all. `route.test.ts` beside
// this file asserts it by handing the answer path a database that throws on
// every write.
//
// ── The cursor ─────────────────────────────────────────────────────────────
// AD-70: one opaque token per scope, encoding `(createdAt, id)` of the last row
// delivered. Clients store and echo it and never construct or interpret one. It
// is not signed and does not need to be — the server re-checks access on every
// answer, so a forged cursor buys nothing but a different window into rows the
// viewer may already read (`cursorToken()` in `lib/community/rules.ts` carries
// the argument; do not add crypto here).
import { currentActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { dmActorFrom } from "@/modules/community/lib/dm-actor";
import {
  liveAnswerFor,
  type LiveScope,
  type LiveScopeAnswer,
  type PostRow,
} from "@/modules/community/lib/manage";

// Sessions, the database and the entitlements seam — none of it runs on the
// edge, and every answer is per-viewer by construction.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many scopes one request may subscribe to.
 *
 * A page carries a handful: one thread, or one embed, or a couple of embeds on
 * a long lesson. The bound is what stops a caller asking for ten thousand and
 * turning one request into ten thousand access checks — a read amplification an
 * ordinary signed-in account should not be able to buy.
 */
const MAX_SCOPES = 10;

/** The one shape every refusal takes. See `LiveScopeAnswer`. */
const UNAVAILABLE: LiveScopeAnswer = { state: "unavailable" };

/**
 * Read one scope out of whatever arrived, or `null` if it is not one.
 *
 * ⚠️ **A malformed scope is not an error, it is an unavailable scope.** Telling
 * a caller "that kind does not exist" would make this endpoint a probe for
 * which kinds a build understands — which for the conversation kind would be a
 * probe for whether direct messages are switched on here.
 */
function readScope(value: unknown): LiveScope | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  const cursor = typeof scope.cursor === "string" ? scope.cursor : undefined;

  if (scope.kind === "discussion" && typeof scope.discussionId === "string") {
    return { kind: "discussion", discussionId: scope.discussionId, cursor };
  }
  if (scope.kind === "subject" && typeof scope.subjectKey === "string") {
    return { kind: "subject", subjectKey: scope.subjectKey, cursor };
  }
  // A private conversation. Nothing here decides whether this caller is in it:
  // `liveAnswerFor()` re-derives participant-ship against the row on every
  // answer, and a conversation somebody is not in gives the same
  // `unavailable` an id that names nothing gives.
  if (scope.kind === "conversation" && typeof scope.conversationId === "string") {
    return { kind: "conversation", conversationId: scope.conversationId, cursor };
  }
  // The feed. No coordinate: the scope is the viewer, and who that is comes
  // from the session. There is deliberately nothing here a caller could put a
  // member id into.
  if (scope.kind === "feed") {
    return { kind: "feed", cursor };
  }
  return null;
}

/**
 * A post as it crosses the wire.
 *
 * Dates become ISO strings HERE, deliberately, rather than being left to
 * `Response.json()`'s own serialisation: a `Date` that has crossed JSON is a
 * string wearing a `Date`'s type, and this template's rule is to convert on
 * arrival rather than to pretend. The client's `PostView` reads exactly these
 * fields, so the two shapes are one shape.
 */
function wirePost(post: PostRow) {
  return {
    id: post.id,
    authorId: post.authorId,
    content: post.content,
    createdAt: post.createdAt.toISOString(),
    editedAt: post.editedAt?.toISOString() ?? null,
    deletedAt: post.deletedAt?.toISOString() ?? null,
    deletedBy: post.deletedBy,
    authorProfileName: post.authorProfileName,
    authorAccountName: post.authorAccountName,
    // Already JSON-safe and already authorised: `postImagesFor()` asked
    // `mayAccess()` and minted the addresses in one function, and a post that is
    // not visible arrives with an empty list rather than with blanked fields —
    // there is nothing here to serialise differently or to forget to strip.
    images: post.images,
  };
}

export async function POST(request: Request): Promise<Response> {
  // 1. Enablement, before anything is read.
  if (!isCommunityEnabled()) return new Response(null, { status: 404 });

  // 2. The session. One 401 for anonymous and blocked alike.
  const current = await currentActiveUser();
  if (current.state !== "active") {
    return Response.json({ error: "notSignedIn" }, { status: 401 });
  }
  const memberId = current.session.user.id;
  if (!memberId) {
    return Response.json({ error: "notSignedIn" }, { status: 401 });
  }
  const viewer = { memberId, role: current.session.user.role as string };

  // 2b. The direct-message carve-out (FR-209), from the ONE seam — over the
  //     session already read, so a poll every five seconds does not pay for a
  //     second session lookup. Discussion and subject scopes are unaffected:
  //     under an impersonation, group surfaces act as the member, and only the
  //     private channel disappears.
  const dmActor = dmActorFrom(current.session);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "badRequest" }, { status: 400 });
  }

  const raw = (body as { scopes?: unknown } | null)?.scopes;
  if (!Array.isArray(raw)) {
    return Response.json({ error: "badRequest" }, { status: 400 });
  }
  if (raw.length > MAX_SCOPES) {
    // 429, not 400: the body has always said `tooManyRequests` and the status
    // used to say "malformed request", which is a different fault and points a
    // caller at the wrong fix.
    return Response.json({ error: "tooManyRequests" }, { status: 429 });
  }

  // 3. Per scope, in parallel — each one re-checking access for itself. A
  //    malformed or unknown scope answers the same `unavailable` an
  //    inaccessible one does, and never reaches the database.
  const scopes = await Promise.all(
    raw.map(async (value): Promise<LiveScopeAnswer> => {
      const scope = readScope(value);
      if (!scope) return UNAVAILABLE;
      // ⚠️ The SAME `unavailable` an inaccessible conversation gets. An
      // impersonated session cannot tell "carved out" from "not yours" from
      // "no such conversation" — which is the point: the operator learns
      // nothing about whether this member has any correspondence.
      if (scope.kind === "conversation" && dmActor.state !== "actor") {
        return UNAVAILABLE;
      }
      return liveAnswerFor(viewer, scope);
    }),
  );

  return Response.json({
    scopes: scopes.map((answer) =>
      answer.state === "ok"
        ? {
            state: "ok" as const,
            cursor: answer.cursor,
            locked: answer.locked,
            stale: answer.stale,
            posts: answer.posts.map(wirePost),
          }
        : answer,
    ),
  });
}
