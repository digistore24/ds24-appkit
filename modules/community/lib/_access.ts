// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { cache } from "react";
import { and, count, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { communityGroups } from "../schema";
import { hasPlan } from "@/lib/entitlements/manage";
import { planProblem } from "@/lib/media/config";
import { mayAccess } from "@/lib/media/manage";
import { mayEnterGroup, planKeysToResolve } from "./rules";

export async function grantedKeysFor(
  memberId: string,
  keys: readonly string[],
): Promise<string[]> {
  const askable = keys.filter((key) => {
    const problem = planProblem(key);
    if (problem) {
      if (!complainedPlanKeys.has(key)) {
        complainedPlanKeys.add(key);
        // "cannot unlock", not "is no longer a product": `planProblem()` also
        // answers non-null for a key that IS a product of `kind === "token"`,
        // and telling the operator to "restore the product" would send them
        // looking for something that is already there. The reason itself says
        // which of the two it is.
        console.error(
          `[community] group plan key "${key}" cannot unlock anything — access ` +
            `refused for everybody until the group or the registry changes. (${problem})`,
        );
      }
      return false;
    }
    return true;
  });

  const held = await Promise.all(
    askable.map(async (key) => ((await heldKey(memberId, key)) ? key : null)),
  );
  return held.filter((key): key is string => key !== null);
}

/**
 * Which of these groups can this viewer enter — the set every unread read
 * starts from.
 *
 * ⚠️ **NFR-41's leak clause lives here.** A discussion in a room the viewer
 * may not enter contributes nothing: no dot, no count, no timing signal. An
 * indicator that lit up because a paid room moved would be a second access
 * path — cheaper to read than the room itself, and readable by somebody who
 * never bought anything.
 */
export const accessibleGroupIds = cache(async function accessibleGroupIds(
  memberId: string,
  role: string,
): Promise<string[]> {
  // Four columns, not `SELECT *`. `mayEnterGroup()` reads three of them and
  // the caller wants the id; every other column was being carried across the
  // wire for every room on every protected page render.
  const groups = await db
    .select({
      id: communityGroups.id,
      accessLevel: communityGroups.accessLevel,
      planKeys: communityGroups.planKeys,
      archivedAt: communityGroups.archivedAt,
    })
    .from(communityGroups)
    .where(isNull(communityGroups.archivedAt));

  const grantedKeys = await grantedKeysFor(memberId, planKeysToResolve(groups));
  return groups
    .filter((group) => mayEnterGroup(group, { role, grantedKeys }))
    .map((group) => group.id);
});

/**
 * Which of these product keys does this member hold RIGHT NOW.
 *
 * One indexed query per DISTINCT key, run together — never per group. A list
 * of twelve rooms sharing two keys costs two queries, and that is the whole
 * cost envelope of the member-facing list.
 *
 * ⚠️ **The retired-key guard, mirrored from `mayAccess()`.** Keys are
 * validated when a group is SAVED, but a registry edit afterwards is outside
 * that promise — an operator who removes a product from
 * `config/digistore-products.json` leaves rooms pointing at a key `hasPlan()`
 * throws on. Asking anyway would answer 500 on the community page rather than
 * "you are not in that room". So a key the registry can no longer answer for is
 * logged and simply never granted: `mayEnterGroup()` finds it missing and
 * refuses, which is the right answer — a plan nobody can hold is a plan nobody
 * holds. (`lib/media/manage.ts` reached this exact branch first.)
 */
/**
 * Keys already complained about, so the complaint is made once per process.
 *
 * ⚠️ **Without this the log line below is emitted once per key PER MEMBER PER
 * PROTECTED PAGE RENDER**, because `grantedKeysFor()` is reached from
 * `accessibleGroupIds()` → `unreadFor()`, which the dashboard layout runs for
 * every page under it. One operator retiring a product while a room still
 * names its key then turns `node run.mjs errors` permanently red and buries
 * the real faults that command exists to surface. The condition is a stable,
 * operator-scoped fact about configuration — it wants saying once, not on a
 * timer and not per request.
 *
 * Process-scoped on purpose: a restart is the moment somebody is looking, and
 * a fixed config stops producing the line at exactly the same moment.
 */
const complainedPlanKeys = new Set<string>();

/**
 * Does this member hold this one key — asked at most once per key per request.
 *
 * ⚠️ **`cache()` on the SINGLE key, not on the list.** React's `cache()` keys
 * on argument identity, and every caller builds a fresh key array, so
 * memoising `grantedKeysFor` would never hit. Two scalars do, which is what
 * makes the layout's `unreadFor()` and the community page's `groupsFor()`
 * share one entitlement round trip per key instead of taking two each — the
 * same fan-out, run twice, in one render.
 */
const heldKey = cache(async function heldKey(
  memberId: string,
  key: string,
): Promise<boolean> {
  return hasPlan(memberId, key);
});
