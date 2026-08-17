// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The leak clause, asked of the numbers that arrived after it.
//
// `unread-leak.test.ts` next door pins NFR-41 for the DOT: a room the viewer
// cannot enter contributes nothing — "no dot, no count, no timing signal".
// `activity.ts` then added a count and a timing signal, which is precisely the
// two things that clause names, so the clause needs asking again rather than
// re-reading. What makes the new numbers lawful is not that they are small: it
// is that they are computed from ids the caller has ALREADY access-checked, and
// that is a property a refactor can drop while every other gate stays green.
//
// Same technique as the file it stands beside: no database in this suite, so
// the seam is substituted and what WOULD have been asked is read back. That the
// SQL then runs is `make deploy-test`'s job.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("the room's activity line and rooms the viewer cannot enter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks nothing at all when there is no reachable room", async () => {
    // The strongest form of the clause: a member who may enter nothing produces
    // no query against anybody's content. The early return is what makes that
    // true, and it is one line somebody could tidy away.
    const { activityByGroup, postCountByDiscussion } = await import("./activity");
    const db = (await import("@/db")).db;
    const select = vi.spyOn(db, "select");

    await expect(activityByGroup([])).resolves.toEqual(new Map());
    await expect(postCountByDiscussion([])).resolves.toEqual(new Map());

    expect(
      select,
      "an empty id list must short-circuit: no aggregate, nothing that could " +
        "time-leak how busy a room nobody may enter is",
    ).not.toHaveBeenCalled();
  });

  it("🚨 counts CONTENT and can never count people", () => {
    // The roster rule, as an import boundary rather than as care. A count of
    // members is the one aggregate `db/schema-community.ts` refuses outright,
    // and the cheapest way for it to appear here is somebody joining `users`
    // to answer "how many are in this room" — which is also the shape a plan
    // check would take. Neither table is reachable from this file.
    const source = blankComments(readFileSync(join(HERE, "activity.ts"), "utf8"));

    for (const forbidden of ["users", "grants", "hasPlan", "communityProfiles"]) {
      expect(
        source,
        `activity.ts must not reach "${forbidden}" — it describes a room's ` +
          "content, never the people in it",
      ).not.toContain(forbidden);
    }
  });

  it("takes the ids the caller already access-checked, and derives none itself", () => {
    // `groupsFor()` is the one place that decides which rooms exist for this
    // viewer. A second derivation here — "the ids are right there in the
    // table" — would be a second access path, and the two would agree until
    // the day one of them was changed.
    const source = blankComments(readFileSync(join(HERE, "activity.ts"), "utf8"));

    expect(source).not.toContain("mayEnterGroup");
    expect(source).not.toContain("accessibleGroupIds");
    expect(source).toContain("inArray");
  });

  it("the room list feeds it the SAME ids it feeds the unread dot", () => {
    // The page is where the two could drift apart: one call scoped to the
    // accessible rooms and one to every room would look identical in review
    // and differ only in what the second one answers.
    const page = blankComments(
      readFileSync(join(HERE, "..", "pages", "page.tsx"), "utf8"),
    );

    const ids = /groups\.map\(\(group\) => group\.id\)/g;
    expect(
      page.match(ids)?.length,
      "both the dot and the activity line must be scoped to `groups`, which is " +
        "`groupsFor()`'s answer and nothing wider",
    ).toBe(2);
    expect(page).toContain("activityByGroup(groups.map((group) => group.id))");
  });

  it("the unread indicator stays existence, never a number", () => {
    // What this story must NOT have changed. "3 new" is pressure aimed at a
    // member; "12 conversations, last one yesterday" describes the room. The
    // dot is the first, and it stays a boolean set.
    const unread = blankComments(readFileSync(join(HERE, "unread.ts"), "utf8"));

    expect(unread).toContain("Promise<Set<string>>");
    expect(unread).not.toContain("count()");
  });
});
