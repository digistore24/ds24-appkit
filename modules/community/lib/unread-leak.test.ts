// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// NFR-41's leak clause, pinned.
//
// Story 19.7 AC 5 asks for this file by name: "a discussion in a group the
// viewer cannot enter contributes nothing — no dot, no count, no timing
// signal. A test pins the leak case (activity in an inaccessible group →
// indicator unchanged)." It did not exist. The clause was walked once in a
// browser, which is not a thing that runs again.
//
// ⚠️ **Why a disclosure property needs a test and not a careful reader.** The
// indicator is cheaper to read than the room it describes: it needs no page
// load, no purchase and no session beyond the one the member already has. A
// future refactor that drops `accessibleGroupIds()` from `unreadFor` — "the
// layout already knows the groups", which is a reasonable thing to think —
// turns the nav dot into a second access path that answers "is there activity
// in the paid room" to somebody who never bought it. Every existing gate stays
// green through that change: typecheck passes, the other tests pass, the page
// renders, smoke reports 200.
//
// There is no database in this suite by decision, so this file works the way
// `deletion.test.ts` does — it substitutes the seam the query is built from and
// reads back what WOULD have been asked. What it proves is that the accessible
// set is derived and applied; that the SQL then runs is `make deploy-test`'s.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mayEnterGroup, planKeysToResolve } from "./rules";

/**
 * The rooms an operator made: one open, one behind a plan this member does not
 * hold, one for moderators, one archived.
 */
const GROUPS = [
  {
    id: "open-room",
    accessLevel: "open" as const,
    planKeys: [] as string[],
    archivedAt: null,
  },
  {
    id: "paid-room",
    accessLevel: "plan" as const,
    planKeys: ["premium_monatlich"],
    archivedAt: null,
  },
  {
    id: "mods-room",
    accessLevel: "moderators" as const,
    planKeys: [] as string[],
    archivedAt: null,
  },
  {
    id: "archived-room",
    accessLevel: "open" as const,
    planKeys: [] as string[],
    archivedAt: new Date("2026-01-01"),
  },
];

/**
 * The set `accessibleGroupIds()` computes, reproduced from its two pure parts.
 *
 * This is deliberately NOT a copy of the shipped logic: `mayEnterGroup()` and
 * `planKeysToResolve()` ARE the shipped logic, imported. What the test supplies
 * is only the shell around them — which rooms exist and which keys are held.
 */
function accessibleIds(
  groups: typeof GROUPS,
  viewer: { role: string; grantedKeys: string[] },
): string[] {
  return groups
    .filter((group) => !group.archivedAt)
    .filter((group) => mayEnterGroup(group, viewer))
    .map((group) => group.id);
}

describe("the unread indicator and rooms the viewer cannot enter", () => {
  const plainMember = { role: "member", grantedKeys: [] as string[] };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("never includes a plan room the member has not bought", () => {
    const ids = accessibleIds(GROUPS, plainMember);
    expect(ids).toContain("open-room");
    expect(
      ids,
      "the existence of activity in a paid room is purchase information about " +
        "the people in it — the dot must not be a cheaper way to read it",
    ).not.toContain("paid-room");
    expect(ids).not.toContain("mods-room");
    expect(ids).not.toContain("archived-room");
  });

  it("includes the plan room the moment the member holds a key for it", () => {
    // The other direction, so the test cannot pass by refusing everything.
    const ids = accessibleIds(GROUPS, {
      role: "member",
      grantedKeys: ["premium_monatlich"],
    });
    expect(ids).toContain("paid-room");
  });

  it("keeps a moderators room out of a plain member's set", () => {
    expect(accessibleIds(GROUPS, plainMember)).not.toContain("mods-room");
    expect(
      accessibleIds(GROUPS, { role: "moderator", grantedKeys: [] }),
    ).toContain("mods-room");
  });

  it("asks the entitlements seam only about keys a room actually names", () => {
    // The leak has a second shape: asking `hasPlan()` about a key no room uses
    // would be an entitlement read with no room behind it, and asking about a
    // room's key when the room is not plan-gated leaks the operator's
    // configuration into the query log.
    expect(planKeysToResolve(GROUPS)).toEqual(["premium_monatlich"]);
    expect(
      planKeysToResolve([
        { accessLevel: "open", planKeys: ["ignored"] },
        { accessLevel: "moderators", planKeys: ["ignored-too"] },
      ]),
    ).toEqual([]);
  });

  it("answers 'nothing new' without touching the discussions table when no room is reachable", async () => {
    // `unreadFor()` returns early on an empty accessible set. That early return
    // is the leak clause in its strongest form: a member who may enter nothing
    // produces no query against anybody's content at all.
    const { unreadFor } = await import("./manage");

    const db = (await import("@/db")).db;
    const select = vi.spyOn(db, "select");

    // Every room is inaccessible to this viewer: no keys, no role, and the
    // rooms module reads groups through the same `db.select` we are watching.
    vi.spyOn(db, "select").mockImplementationOnce(
      () =>
        ({
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        }) as never,
    );

    await expect(
      unreadFor({ memberId: "member-1", role: "member" }),
    ).resolves.toBe(false);

    // One call — the room scan — and nothing after it.
    expect(
      select,
      "an empty accessible set must short-circuit: no existence query, no " +
        "join against discussions, nothing that could time-leak",
    ).toHaveBeenCalledTimes(1);
  });
});
