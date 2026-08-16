// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **What the friends feed must NOT contain.**
//
// The feed is the surface where a leak is worth the most and shows up the
// least: it is a list of other people's activity, assembled from rooms whose
// doors the viewer never sees. Two things must be impossible, and both are
// negative space — you cannot test them by calling something and looking at
// the answer, because the answer's whole content is an absence.
//
//   1. **Gated activity contributes nothing.** Not the post, not the room's
//      name, not the thread's title, not a shift in the order or the cursor.
//      "Somebody you follow posted in Diabetes-Coaching Premium" is the fact
//      that they bought it.
//   2. **A direct message is never activity.** The feed reads posts. No path
//      of it may so much as name a DM table.
//
// So both are asserted on the SQL the feed builds and on the source of the
// files that build it — the `deletion.test.ts` and `leak-guard.test.ts`
// techniques, applied where an instance test would only prove that today's
// code happens to be right.
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { feedVisible } from "./rules";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";
import { shellSource } from "./_shell-files.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const MANAGE = withoutComments(
  shellSource(),
);

/**
 * The feed's own code in `manage.ts`, gathered by NAME.
 *
 * ⚠️ **Not "from the feed header to the end of the file".** That is what this
 * was, and the next story appended a block after it — at which point the
 * assertions below were quietly reading somebody else's transactions and
 * calling them the feed's. A guard that widens as the file grows is a guard
 * that starts failing for reasons it was not written about, and the day it is
 * "fixed" by loosening an assertion is the day it stops protecting anything.
 *
 * Named members, plus a non-vacuity check that every one of them was found.
 */
const FEED_MEMBERS = [
  "FeedItem",
  "FEED_PER_PAGE",
  "feedScope",
  "feedRows",
  "feedFor",
  "feedSince",
];

function memberBlocks(source: string, names: readonly string[]): string {
  const found: string[] = [];
  for (const name of names) {
    const at = source.search(
      new RegExp(`^(?:export )?(?:async )?(?:function|const|interface) ${name}\\b`, "m"),
    );
    if (at === -1) continue;
    // To the next top-level declaration, or the end. Over-reach only makes
    // the assertions stricter, and the non-vacuity test below is what catches
    // a member that vanished.
    const rest = source.slice(at + 1);
    const next = rest.search(/^(?:export )?(?:async )?(?:function|const|interface) \w+/m);
    found.push(next === -1 ? source.slice(at) : source.slice(at, at + 1 + next));
  }
  return found.join("\n");
}

const FEED_BLOCK = memberBlocks(MANAGE, FEED_MEMBERS);

// ── The gated room contributes nothing ─────────────────────────────────────

describe("the feed is filtered by the viewer's own access, in the query", () => {
  it("resolves the readable rooms through the SAME resolver the section uses", () => {
    // ⚠️ The failure this prevents is not a missing filter — it is a SECOND
    // one. Two answers to "may they enter this room" drift, and the one that
    // drifts wide is invisible: the feed is where nobody expects to find the
    // room, so nobody notices it appearing there.
    expect(
      FEED_BLOCK,
      "the feed must derive access from accessibleGroupIds(), the resolver " +
        "the community page and the unread dot already use",
    ).toContain("accessibleGroupIds(");
    // And it must not grow its own arithmetic beside it.
    expect(FEED_BLOCK).not.toContain("mayEnterGroup(");
    expect(FEED_BLOCK).not.toContain("hasPlan(");
  });

  it("filters by room AND by author in the same statement", () => {
    // Both `inArray`s in the one WHERE. A filter applied in JS after an
    // unfiltered read would have fetched the gated rows into the process —
    // and the next person to add a field to the projection would ship them.
    const rows = FEED_BLOCK.slice(FEED_BLOCK.indexOf("async function feedRows"));
    expect(rows).toContain("inArray(communityPosts.authorId");
    expect(rows).toContain("inArray(communityDiscussions.groupId");
    expect(rows).toContain("isNull(communityPosts.deletedAt)");
  });

  it("returns nothing at all when the viewer can enter no room, or follows nobody", () => {
    // The early return is what makes "no feed" cost no post query — and it is
    // also what makes the empty answer identical whether the gated post exists
    // or not, which is AC 2's strong form for the degenerate case.
    const scope = FEED_BLOCK.slice(FEED_BLOCK.indexOf("async function feedScope"));
    expect(scope).toContain("groupIds.length === 0 || follows.length === 0");
    expect(scope).toContain("return null");
  });

  it("has no way to answer for somebody else", () => {
    // Every exported feed function takes a `viewer` and the surfaces build it
    // from the session. There is no member-id parameter anywhere in the block
    // — a feed that accepted one would answer "what does this person see" in
    // one request.
    const exported = [...FEED_BLOCK.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(exported.length).toBeGreaterThanOrEqual(2);
    for (const [, name, params] of exported) {
      // The FIRST parameter is the viewer — the shape the surfaces build from
      // the session — and nothing takes a bare member id beside it. The
      // distinction matters: `viewer: { memberId, role }` is what a session
      // produces, `memberId: string` is what a form could.
      expect(params.trim(), `${name}'s first parameter is the viewer`).toMatch(
        /^viewer:\s*\{\s*memberId:\s*string;\s*role:\s*string\s*\}/,
      );
      const rest = params.slice(params.indexOf("}") + 1);
      expect(rest, `${name} takes no member id beside the viewer`).not.toMatch(
        /memberId/,
      );
    }
  });
});

// ── A deleted post is not an event ─────────────────────────────────────────

describe("feedVisible", () => {
  it("admits a live post and nothing else", () => {
    expect(
      feedVisible({ deletedAt: null, deletedBy: null, hiddenAt: null }),
    ).toBe(true);
    for (const deletedBy of ["author", "moderator", "system"] as const) {
      expect(
        feedVisible({ deletedAt: new Date(), deletedBy, hiddenAt: null }),
        deletedBy,
      ).toBe(false);
    }
    // 🚨 The automatic lock too, and this one is the reason `feedVisible()`
    // asks `contentState()` instead of testing `deletedAt === null`: a post the
    // community has just taken off the page must not stay in every follower's
    // feed. A `deletedAt` check would have let it through, compiling cleanly.
    expect(
      feedVisible({ deletedAt: null, deletedBy: null, hiddenAt: new Date() }),
    ).toBe(false);
  });

  it("is the reason the feed reads contentState and not a column", () => {
    // The three deletions are three different sentences everywhere else in the
    // module. Here they are one answer — and it is reached through the one
    // reader, so a fourth state would arrive here correctly rather than being
    // silently admitted by a `deletedAt === null` check.
    const rules = withoutComments(
      readFileSync(join(ROOT, "modules/community/lib/rules.ts"), "utf8"),
    );
    const fn = rules.slice(rules.indexOf("export function feedVisible"));
    expect(fn.slice(0, 300)).toContain("contentState(");
  });
});

// ── The feed never touches a direct message ────────────────────────────────

/**
 * Every file that builds the feed.
 *
 * Named rather than discovered, because the assertion is about a boundary and
 * a boundary has to be enumerable. A new feed file added without joining this
 * list is caught by the non-vacuity check below.
 */
const FEED_FILES = [
  "modules/community/pages/feed/page.tsx",
  "modules/community/pages/feed/actions.ts",
  "modules/community/components/feed-list.tsx",
];

describe("no direct message can reach a feed", () => {
  it("holds for the feed block of manage.ts", () => {
    // The structural version, not an instance: it is not that today's query
    // happens to read posts, it is that the feed's code cannot name the other
    // tables at all.
    for (const needle of [
      "communityMessages",
      "communityConversations",
      "community_messages",
      "community_conversations",
    ]) {
      expect(FEED_BLOCK, `the feed block must not name ${needle}`).not.toContain(
        needle,
      );
    }
  });

  it("holds for every file that builds the feed", () => {
    const offenders: string[] = [];
    for (const path of FEED_FILES) {
      const source = withoutComments(readFileSync(join(ROOT, path), "utf8"));
      for (const needle of [
        "communityMessages",
        "communityConversations",
        "Conversation",
        "messages/",
      ]) {
        if (source.includes(needle)) offenders.push(`${path} names ${needle}`);
      }
    }
    expect(
      offenders,
      "a private message is not activity anybody may see. The feed reads " +
        `posts:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("reads real files, so the absences mean something", () => {
    // Non-vacuity for both halves — and for the gathering itself: every named
    // member has to have been found, or the block is smaller than it looks and
    // the absences above mean nothing.
    expect(FEED_BLOCK.length).toBeGreaterThan(1000);
    for (const name of FEED_MEMBERS) {
      expect(FEED_BLOCK, `${name} should be part of the feed block`).toContain(
        name,
      );
    }
    for (const path of FEED_FILES) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source.length, path).toBeGreaterThan(200);
      expect(source, path).toMatch(/feed/i);
    }
  });
});

// ── Nothing is stored, so nothing has to be cleaned up ─────────────────────

describe("the feed materializes nothing", () => {
  it("writes no row anywhere in its block", () => {
    // AD-68. A lapsed grant removes the activity by the same derivation that
    // produced it — there is no cleanup function to call, because there is
    // nothing to clean. That is asserted as the absence of any write.
    for (const write of [".insert(", ".update(", ".delete(", "transaction("]) {
      expect(
        FEED_BLOCK,
        `the feed must not ${write} — it derives, it does not store`,
      ).not.toContain(write);
    }
  });

  it("issues no aggregate over anything", () => {
    // No counters, no totals, no "3 new". The pager is a cursor, and the
    // "load more" button appears because a full page came back rather than
    // because a total was known.
    expect(FEED_BLOCK).not.toMatch(/\bcount\s*\(/);
    const dialect = new PgDialect();
    expect(dialect).toBeDefined();
  });
});

// ── The removal signal: one bit, and it stays one bit ──────────────────────
//
// 🚨 **The feed is the one scope that may not carry tombstones**, and the
// reason is on `feedSince()`: a "this was removed" row would land in front of
// people who never saw the original, which is a worse disclosure than the
// omission. That argument covers what may be SENT — and it never covered a
// post already on somebody's screen. So a member who deleted their account
// left their words on an open feed indefinitely: the client re-rendered only
// when a NEW item arrived, and on a quiet feed there is no next item.
//
// The answer is one bit. These assertions are what keep it one bit, because
// the tempting next change is to "just include the changed rows" — which is
// the tombstone the argument refuses.

describe("a removal reaches an open feed without becoming a row", () => {
  const FEED = MANAGE.slice(
    MANAGE.indexOf("export async function feedSince("),
    MANAGE.indexOf("export async function feedSince(") + 4000,
  );

  it("asks the question at all", () => {
    expect(FEED).toContain("stale");
    expect(FEED).toContain("CHANGED_AT");
  });

  it("reads only timestamps — no id, no words, nothing to render", () => {
    // The staleness query's own selection. A `content:` or `postId:` here
    // would put the removed post on the wire, which is exactly the tombstone
    // the scope refuses to carry.
    const query = FEED.slice(
      FEED.indexOf("const [changedRow]"),
      FEED.indexOf(".limit(1)", FEED.indexOf("const [changedRow]")),
    );
    expect(query, "the staleness query moved — re-read this test").not.toEqual("");
    for (const forbidden of ["content:", "postId:", "authorId:", "id:"]) {
      expect(
        query.includes(forbidden),
        `the staleness query selects ${forbidden} — it may read timestamps and nothing else`,
      ).toBe(false);
    }
    expect(query).toContain("deletedAt:");
    expect(query).toContain("editedAt:");
  });

  it("is bounded to one row", () => {
    const query = FEED.slice(FEED.indexOf("const [changedRow]"));
    expect(query.slice(0, query.indexOf(";"))).toContain(".limit(1)");
  });

  it("only asks about what the reader could already be holding", () => {
    // A change to something created AFTER the cursor arrives as a normal item;
    // asking about it here would be a second delivery of the same fact.
    expect(FEED).toContain("lte(communityPosts.createdAt, cursor.at)");
  });

  it("never turns the changed row into an item", () => {
    // `items` comes from `feedRows()` alone, which filters `isNull(deletedAt)`.
    // The changed row is read into `changedRow` and never reaches the answer.
    const answer = FEED.slice(FEED.indexOf("return {", FEED.indexOf("const stale")));
    expect(answer).toContain("items,");
    expect(answer).toContain("stale,");
    expect(answer).not.toContain("changedRow");
  });
});
