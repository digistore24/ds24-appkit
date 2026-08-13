// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// The rooms this member may enter — the room list, for their own program.
//
// One function, `groupsFor()`, which is the same one the sidebar asks. Access is
// DERIVED at read time from the plans held right now and stored nowhere
// (`docs/community.md`) — so a room that closed because a payment was missed is
// simply absent from the next answer, with no cleanup job and no cached boolean
// to go stale.
//
// ⚠️ **A room the viewer cannot enter contributes NOTHING** — it is not in the
// list, not as a locked entry, not as a count. Presence in a plan-gated room is
// purchase information, and a list that named the rooms somebody has NOT bought
// would be exactly the roster this module refuses to have.
import { guardApi } from "@/modules/api/api/guard";
import { apiError, apiJson } from "@/modules/api/api/rules";

import { isCommunityEnabled } from "@/modules/community/lib/config";
import { groupsFor } from "@/modules/community/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  if (!isCommunityEnabled()) {
    return apiError("notFound", "This app has no community.");
  }

  const groups = await groupsFor({ memberId: g.memberId, role: g.role });

  return apiJson({
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      position: group.position,
      // `planKeys` and `accessLevel` are deliberately absent. They answer "what
      // would this room have cost" for a room the viewer is already in — no
      // client needs it, and it is the same product information the list is
      // careful not to publish about rooms they are not in.
      createdAt: group.createdAt.toISOString(),
    })),
  });
}
