// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How many rooms this environment holds — for the presence check, and for
// nothing else.
//
// 🚨 **Why this is not a function in `lib/manage.ts`, where every other read of
// `community_groups` lives.** `presence/check.ts` is on the CONTENT PLAN's code
// path: the core composes it into `lib/modules/presence-registry.ts`,
// `lib/content/presence.ts` imports that registry, and
// `lib/content/applier-plan.test.ts` asserts over the whole resulting closure
// that a plan can reach no method which WRITES an object. `manage.ts` is 5900
// lines and imports `@/lib/media/manage`, which calls `store.copy()` and
// `store.remove()` — so importing one counting helper from it put the media
// store's writing half on the plan's path, and every app that installed this
// module had a permanently red `npm run test` (reported 2026-08-12).
//
// The contributor cannot simply query the table itself either: `lib/setup/
// module-boundary.test.ts` (spine AD-81) refuses a `@/db` import in a module's
// declared `presence` file, because a contributor is a THIN CALLER and the
// second implementation is the one nobody looks at. Both rules are right, and
// this file is what satisfies them at once — the module's own lib, owning its
// own table, reaching nothing else.
//
// So the import list below is the point of the file. Keep it at `@/db` and the
// module's own schema; anything else here lands back on the plan's path.
import { db } from "@/db";

import { communityGroups } from "../schema";

export interface RoomCounts {
  /** Rooms a member can actually see. */
  live: number;
  /**
   * Rooms the operator has archived.
   *
   * Counted apart rather than folded in: an environment whose every room is
   * archived looks identical to an empty one from a member's side, and that
   * difference is worth its own line in the report.
   */
  archived: number;
}

/**
 * The two numbers `content-check` reports for this module.
 *
 * One column of one table, and no join. `listGroups()` — the read this used to
 * borrow — also joined `users` and `community_profiles` to attach each room's
 * moderators, every one of which the presence check discarded.
 */
export async function countRooms(): Promise<RoomCounts> {
  const rooms = await db.select({ archivedAt: communityGroups.archivedAt }).from(communityGroups);
  const live = rooms.filter((room) => room.archivedAt === null).length;
  return { live, archived: rooms.length - live };
}
