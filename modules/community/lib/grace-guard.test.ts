// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The grace as the WRITE PATH meets it — the half `grace.test.ts` cannot see.
//
// 🚨 **The split between these two files is where the defects live.** The pure
// rule takes `memberHours` and `paidGrants` as arguments and is therefore green
// no matter what the shell puts in them. Three plausible one-line mistakes are
// invisible over there and visible here, each measured by planting it:
//
//   N1  the hours computed in the wrong unit. Typechecks — every candidate is a
//       `number` — and either freezes every young account inside the grace for
//       ever or lets everybody straight out of it. Measured in BOTH directions;
//       see the note above the pair of cases that catch them.
//   N2  the buyer exemption lost between the shell and the rule
//       (`paidGrants: 0` where `writer.paidGrants` belongs). Typecheck clean,
//       373 of 374 files green, and exactly one test red: the buyer one. It is
//       the only assertion anywhere for the promise that lets this brake ship
//       switched ON.
//   N3  `countLinks()` replaced by a `split("http")` count.
//
// ⚠️ **What this file CANNOT see, said plainly: the SQL.** The fake resolves a
// query by table name and never executes anything, so a wrong WHERE clause
// inside `paidGrantsFragment()` — an ended grant counted as live, say — reads
// here exactly like a correct one. Measured: replacing the whole fragment with a
// literal `0` leaves all 374 files green. That question belongs to a running
// database, and the honest place for it is `make deploy-test-modules`, which
// this module's own smoke pass reaches.
//
// ⚠️ **Every case plants a SURVIVOR beside the subject.** A member who must be
// refused proves nothing on its own: a guard that refuses unconditionally
// passes it. So each block also drives somebody who must get through, and it is
// the pair that is the assertion — the A76/A77 lesson from `deploy-cron.mjs`,
// one layer down.
//
// ── What is faked ──────────────────────────────────────────────────────────
// The database, and nothing else. The rule, the derivation, the guard order and
// the error codes are all real. Every case uses its OWN member id, because the
// shell functions are `cache()`d per request and a shared id would let one
// case's answer leak into the next.
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { users } from "@/db/schema";
import {
  communityMemberStanding,
  communityPosts,
  communitySpamReports,
} from "../schema";

const fake = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const select = () => {
    let table = "";
    const chain: Record<string, unknown> = {
      from(value: unknown) {
        table = getTableName(value as Parameters<typeof getTableName>[0]);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (reason: unknown) => unknown) =>
        Promise.resolve(rows[table] ?? []).then(ok, fail),
    };
    return chain;
  };
  return { rows, db: { select } };
});

vi.mock("@/db", () => ({ db: fake.db }));

const { guardSendBlock, guardGraceLinks, graceFor } = await import("./_blocks");
const { CommunityError } = await import("./rules");
const { DEFAULT_COMMUNITY_CONFIG } = await import("./config");

const USERS = getTableName(users);
const STANDING = getTableName(communityMemberStanding);
const REPORTS = getTableName(communitySpamReports);
const POSTS = getTableName(communityPosts);

const SHIPPED = DEFAULT_COMMUNITY_CONFIG.newMember;
const HOUR = 60 * 60 * 1000;

/**
 * Put one account in the fake database.
 *
 * `createdAt` is a real `Date` offset from now, not an hour count — the point
 * of this file is that the shell has to do that arithmetic, so handing it the
 * answer would be measuring nothing.
 */
function account(options: {
  hoursOld: number;
  paidGrants?: number;
  role?: string;
  protectedMember?: boolean;
  postsInLast24h?: number;
}) {
  fake.rows[USERS] = [
    {
      role: options.role ?? "member",
      createdAt: new Date(Date.now() - options.hoursOld * HOUR),
      paidGrants: options.paidGrants ?? 0,
    },
  ];
  fake.rows[STANDING] = options.protectedMember
    ? [{ protectedAt: new Date(), writeBlockedAt: null, reportsIgnoredAt: null }]
    : [];
  // No unconsumed reports, so the send-block never fires and what refuses can
  // only be the grace.
  fake.rows[REPORTS] = [];
  fake.rows[POSTS] = [{ n: options.postsInLast24h ?? 0 }];
}

/** The code a refusal carried, or null if it did not refuse. */
async function refusalOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof CommunityError) return error.code;
    throw error;
  }
}

let id = 0;
/** A fresh member id per case — the shell is `cache()`d and keys on it. */
function nextId(): string {
  id += 1;
  return `member-${id}`;
}

beforeEach(() => {
  for (const key of Object.keys(fake.rows)) delete fake.rows[key];
});

describe("the daily post count", () => {
  it("refuses a two-hour-old account that has written its allowance", async () => {
    const member = nextId();
    account({ hoursOld: 2, postsInLast24h: SHIPPED.maxPostsPerDay });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBe(
      "communityNewMemberPostLimit",
    );
  });

  it("lets the same account write its LAST allowed post", async () => {
    const member = nextId();
    account({ hoursOld: 2, postsInLast24h: SHIPPED.maxPostsPerDay - 1 });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBeNull();
  });

  it("lets an OLD unpaid account write freely — the survivor", async () => {
    const member = nextId();
    account({ hoursOld: 400 * 24, postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBeNull();
  });

  // 🚨 **The two cases below are N1, and it takes BOTH of them — measured.**
  // The unit the shell divides by can be wrong in two directions, and each
  // direction is caught by the opposite case:
  //
  //   too COARSE (hours computed as days): every young account stays inside the
  //     grace for ever. The 47-hour case is still refused and stays GREEN; the
  //     49-hour case is refused when it should not be, and goes red. Planted for
  //     real: typecheck clean, 373 of 374 files green, exactly one test red —
  //     that one.
  //   too FINE (hours computed as minutes): 47 hours reads as 2820, everybody is
  //     out of the grace immediately, and the 47-hour case goes red instead.
  //
  // Either alone would have been a green suite over a floor that does not exist.
  it("binds an account one hour SHORT of the end of the grace", async () => {
    const member = nextId();
    account({ hoursOld: SHIPPED.graceHours - 1, postsInLast24h: SHIPPED.maxPostsPerDay });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBe(
      "communityNewMemberPostLimit",
    );
  });

  it("lets an account one hour PAST the grace write freely", async () => {
    const member = nextId();
    account({ hoursOld: SHIPPED.graceHours + 1, postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBeNull();
  });

  it("does not count posts against a DM", async () => {
    // The DM is braked by the ten-minute bucket in `messages.ts`, not by a
    // daily count. A guard that asked the post question of every act would
    // refuse a reply somebody typed to a person who wrote to them first.
    const member = nextId();
    account({ hoursOld: 2, postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(member, "dm"))).toBeNull();
  });
});

describe("who the shell exempts", () => {
  it("lets a BUYER through in their first hour, with the count exhausted", async () => {
    // 🚨 **This is N2, and it is the sharpest case in the file.** Drop
    // `paidGrants` from the select in `writerFactsFor()` and this is the only
    // assertion anywhere that notices — the pure rule is handed `paidGrants`
    // directly and stays green, and the whole reason this brake may ship ON is
    // that an app selling access to its community never meets it.
    const member = nextId();
    account({ hoursOld: 1, paidGrants: 1, postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBeNull();
    expect(await graceFor(member)).toBeNull();
  });

  it("lets an operator and a moderator through", async () => {
    const owner = nextId();
    account({ hoursOld: 1, role: "owner", postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(owner, "post"))).toBeNull();

    const moderator = nextId();
    account({ hoursOld: 1, role: "moderator", postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(moderator, "post"))).toBeNull();
  });

  it("lets a protected member through — the operator's own override", async () => {
    const member = nextId();
    account({ hoursOld: 1, protectedMember: true, postsInLast24h: 9999 });
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBeNull();
  });
});

describe("links in a post", () => {
  it("refuses a link from a new account and names its own code", async () => {
    const member = nextId();
    account({ hoursOld: 2 });
    expect(await refusalOf(() => guardGraceLinks(member, "see https://example.com"))).toBe(
      "communityNewMemberNoLinks",
    );
  });

  it("counts an address with a closing bracket ONCE — the renderer's count", async () => {
    // 🚨 **N3.** A `split("http")` counter reports 1 here too, so this case
    // alone would not catch it. The pair below is what does: `javascript:` must
    // NOT count, and prose mentioning http must not either.
    const member = nextId();
    account({ hoursOld: 2 });
    expect(
      await refusalOf(() =>
        guardGraceLinks(member, "https://en.wikipedia.org/wiki/Ruby_(programming_language)"),
      ),
    ).toBe("communityNewMemberNoLinks");
  });

  it("does not treat a refused scheme as a link", async () => {
    const member = nextId();
    account({ hoursOld: 2 });
    expect(await refusalOf(() => guardGraceLinks(member, "javascript:alert(1)"))).toBeNull();
  });

  it("does not treat the word http in prose as a link", async () => {
    const member = nextId();
    account({ hoursOld: 2 });
    expect(
      await refusalOf(() => guardGraceLinks(member, "we should talk about http headers")),
    ).toBeNull();
  });

  it("lets an OLD unpaid account post as many links as it likes — the survivor", async () => {
    const member = nextId();
    account({ hoursOld: 400 * 24 });
    expect(
      await refusalOf(() =>
        guardGraceLinks(member, "https://a.example https://b.example https://c.example"),
      ),
    ).toBeNull();
  });
});

describe("the counter-proof", () => {
  it("binds nobody when the operator switched the block off", async () => {
    // The whole mechanism, off. A guard that refused unconditionally would pass
    // every "must refuse" case above and fail here.
    vi.resetModules();
    vi.doMock("@/config/community.json", () => ({
      default: { enabled: true, newMember: { enabled: false } },
    }));
    const blocks = await import("./_blocks");

    const member = nextId();
    account({ hoursOld: 1, postsInLast24h: 9999 });
    await expect(blocks.guardSendBlock(member, "post")).resolves.toBeUndefined();
    await expect(
      blocks.guardGraceLinks(member, "https://example.com"),
    ).resolves.toBeUndefined();

    vi.doUnmock("@/config/community.json");
    vi.resetModules();
  });

  it("still refuses a member the OPERATOR silenced by hand", async () => {
    // The grace is the newest of three refusals on this path and must not have
    // displaced either older one. `communityWriteBlocked` is checked first, and
    // its sentence sends somebody to moderation rather than to a clock.
    const member = nextId();
    account({ hoursOld: 400 * 24 });
    fake.rows[STANDING] = [
      { protectedAt: null, writeBlockedAt: new Date(), reportsIgnoredAt: null },
    ];
    expect(await refusalOf(() => guardSendBlock(member, "post"))).toBe(
      "communityWriteBlocked",
    );
  });
});
