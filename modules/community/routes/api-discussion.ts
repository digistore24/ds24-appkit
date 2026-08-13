// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// One thread and its posts — the thread page's answer, for a member's program.
//
// `discussionFor()` answers `null` for an unknown id, an archived room and a
// room behind a plan they do not hold, all three alike, and this hands that
// straight on as one 404. A member trying ids must not be able to tell "there
// is no such thread" from "there is one and you are not in it": the second is
// purchase information about somebody else's product.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson } from "@/modules/api/api/rules";

import { isCommunityEnabled } from "@/modules/community/lib/config";
import { discussionFor, postsFor } from "@/modules/community/lib/manage";
import { wirePost } from "../lib/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  if (!isCommunityEnabled()) {
    return apiError("notFound", "This app has no community.");
  }

  const { id } = await context.params;
  const viewer = { memberId: g.memberId, role: g.role };

  const found = await discussionFor(id, viewer);
  if (!found) return apiError("notFound", "No such discussion.");

  // `last` by default, like the page: a thread opened with no explicit page is
  // opened at its end, which is where a conversation is.
  const asked = new URL(request.url).searchParams.get("page");
  const page = asked === null || asked === "last" ? ("last" as const) : Number(asked);
  if (page !== "last" && (!Number.isInteger(page) || page < 1)) {
    return apiError("badRequest", '"page" must be a positive whole number, or "last".');
  }

  const posts = await postsFor(id, page, viewer);

  return apiJson({
    discussion: {
      id: found.discussion.id,
      title: found.discussion.title,
      locked: found.discussion.lockedAt !== null,
      lastActivityAt: found.discussion.lastActivityAt.toISOString(),
      createdAt: found.discussion.createdAt.toISOString(),
      starterProfileName: found.discussion.starterProfileName,
      starterAccountName: found.discussion.starterAccountName,
    },
    group: { id: found.group.id, name: found.group.name },
    page: posts.page,
    total: posts.total,
    posts: posts.rows.map(wirePost),
  });
}
