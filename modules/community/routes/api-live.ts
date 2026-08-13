// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// The cursor endpoint's BEARER twin — "what is new since X" for a member's own
// program, over an API key instead of a session cookie.
//
// Two doors, ONE `liveAnswerFor()` behind them. `./live.ts` is the browser's
// (session cookie, polled by `use-live-scope.ts`); this is the companion's. The
// duplication is the two lines of authentication and nothing else: a second
// implementation of the answer would be a second opinion about who may read a
// room, which is the one thing this module cannot afford two of.
//
// 🚨 **There is no `conversation` scope here, and its absence is a REFUSAL
// rather than a silence.** On the cookie twin an inaccessible conversation
// answers `unavailable`, deliberately indistinguishable from "no such
// conversation" — because there the question is about one member's
// correspondence and any distinction is an oracle. Here the question is
// different: whether this SURFACE carries private messages at all. That is a
// property of the API, not of anybody's data, so it is answered plainly. A
// silent `unavailable` would leave a client author guessing, and would leave
// the guarantee resting on nobody having written the code — which is exactly
// the kind of promise that gets built by accident later.
//
// The rest follows the cookie twin line for line: enablement first, then the
// caller, then per-scope access re-derived inside `liveAnswerFor()` from the
// plans this member holds RIGHT NOW. It writes nothing.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson } from "@/modules/api/api/rules";

import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  liveAnswerFor,
  type LiveScope,
  type LiveScopeAnswer,
  type PostRow,
} from "@/modules/community/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same bound as the cookie twin, and for the same reason. */
const MAX_SCOPES = 10;

const UNAVAILABLE: LiveScopeAnswer = { state: "unavailable" };

/**
 * The three kinds this surface understands.
 *
 * `conversation` is deliberately not among them and is caught BEFORE this
 * function, so that "we do not do that here" and "that is not a scope" cannot
 * be confused with each other.
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
  if (scope.kind === "feed") {
    return { kind: "feed", cursor };
  }
  return null;
}

/**
 * A post as it crosses the wire — the same fields the cookie twin sends, so a
 * client written against one reads the other.
 *
 * Dates become ISO strings HERE rather than being left to `Response.json()`: a
 * `Date` that has crossed JSON is a string wearing a `Date`'s type.
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
    // Already authorised and already JSON-safe: `postImagesFor()` asked
    // `mayAccess()` and minted the addresses in one function.
    images: post.images,
  };
}

export async function POST(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  // Enablement AFTER the key check on this surface, not before. The cookie twin
  // asks first because it is reached by an anonymous browser; here the caller is
  // already proven, and answering 404 to an unauthenticated request would leak
  // whether this app runs a community to anybody who can reach the domain.
  if (!isCommunityEnabled()) {
    return apiError("notFound", "This app has no community.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("badRequest", 'Send a JSON body: { "scopes": [ … ] }.');
  }

  const raw = (body as { scopes?: unknown } | null)?.scopes;
  if (!Array.isArray(raw)) {
    return apiError("badRequest", '"scopes" must be an array.');
  }
  if (raw.length > MAX_SCOPES) {
    return apiError("rateLimited", `At most ${MAX_SCOPES} scopes per request.`);
  }

  // 🚨 The DM refusal, before anything is read from the database. Named rather
  // than folded into "unknown scope" so a client author learns the fact.
  if (raw.some((value) => (value as { kind?: unknown } | null)?.kind === "conversation")) {
    return apiError(
      "badRequest",
      "The conversation scope is not available on this surface — /api/v1 carries no private messages.",
    );
  }

  const scopes = await Promise.all(
    raw.map(async (value): Promise<LiveScopeAnswer> => {
      const scope = readScope(value);
      if (!scope) return UNAVAILABLE;
      return liveAnswerFor({ memberId: g.memberId, role: g.role }, scope);
    }),
  );

  return apiJson({
    scopes: scopes.map((answer) =>
      answer.state === "ok"
        ? {
            state: "ok" as const,
            // Opaque: store it, echo it, never parse it (AD-70).
            cursor: answer.cursor,
            locked: answer.locked,
            stale: answer.stale,
            posts: answer.posts.map(wirePost),
          }
        : answer,
    ),
  });
}
