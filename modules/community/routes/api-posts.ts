// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// Writing into a room — `addPost()` for a member's own program.
//
// 🚨 **`{ scope: "write" }`**, and every refusal `addPost()` makes is kept: the
// display-name requirement, the locked thread, the rate limit, the derived
// send-block. None of them is re-implemented here — this maps them onto the
// HTTP shapes a program reads, and a code with no mapping is a 500 rather than
// a guessed 400.
//
// ⚠️ **Text only, deliberately.** A post may carry pictures in the browser
// (`posting.imagesMax`), and this surface takes none: the bytes would have to
// travel as multipart through a bearer door, which is a decision with its own
// shape ([`docs/api.md`](../../../docs/api.md) → *Limits, and one caveat worth
// knowing* — the direct-to-bucket path is not on v1 either). A companion that
// needs it gets its own endpoint, not a widened one.
//
// 🚨 **No member id is read from the request.** The author is the key's owner —
// the same guarantee the Server Action gives.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson, type ApiErrorCode } from "@/modules/api/api/rules";

import { isCommunityEnabled } from "@/modules/community/lib/config";
import { addPost } from "@/modules/community/lib/manage";
import { CommunityError } from "@/modules/community/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The refusals a MEMBER writing a post can produce, each as the code and
 * sentence a program reads.
 *
 * The module's own codes are i18n keys a page turns into a sentence for a
 * person; `/api/v1` answers from a closed English vocabulary (`docs/api.md`).
 * The image codes are absent because this door takes no images — if that ever
 * changes, `refuse()` answers `internal` and names the code rather than
 * silently calling it a bad request.
 */
const REFUSALS: Record<string, { code: ApiErrorCode; detail: string }> = {
  notFound: { code: "notFound", detail: "No such discussion." },
  communityProfileIncomplete: {
    code: "forbidden",
    detail: "Choose a display name for the community before writing.",
  },
  communityDiscussionLocked: { code: "forbidden", detail: "This discussion is locked." },
  communitySendBlocked: { code: "forbidden", detail: "Writing is blocked on this account." },
  communityPostEmpty: { code: "badRequest", detail: "The post is empty." },
  communityPostTooLong: { code: "badRequest", detail: "The post is too long." },
  communityPostRateLimited: {
    code: "rateLimited",
    detail: "Too many posts. Try again shortly.",
  },
};

function refuse(code: string): Response {
  const mapped = REFUSALS[code];
  return mapped
    ? apiError(mapped.code, mapped.detail)
    : apiError("internal", `Unmapped community refusal: ${code}`);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  if (!isCommunityEnabled()) {
    return apiError("notFound", "This app has no community.");
  }

  let content: unknown;
  try {
    content = ((await request.json()) as { content?: unknown }).content;
  } catch {
    return apiError("badRequest", 'Send a JSON body: { "content": "…" }.');
  }

  const { id } = await context.params;

  try {
    // `content` travels as `unknown` on purpose — `checkPostContent()` inside
    // `addPost()` is the one judge of what a post may be, and a type assertion
    // here would be a second opinion that agrees today.
    const { postId } = await addPost(id, { memberId: g.memberId, role: g.role }, { content });
    return apiJson({ id: postId }, 201);
  } catch (error) {
    if (error instanceof CommunityError) return refuse(error.code);
    throw error;
  }
}
