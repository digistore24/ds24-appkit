// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two invariants of the community schema, asserted on the SOURCE TEXT.
//
// Same shape as `db/sql-cast.test.ts` and `lib/impersonation/guard.test.ts`:
// there is no database in a vitest run, so reading the file IS the check — and
// both of these are decisions that would be silently reversed by a change that
// compiles, typechecks and serves pages perfectly.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import { blankComments as stripComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(join(ROOT, "modules", "community", "schema.ts"), "utf8");

/**
 * A source file with its comments removed.
 *
 * ⚠️ **Line comments go FIRST, and the order is not cosmetic.** Doing blocks
 * first means a `//` line that mentions a path like `/dashboard/community/*`
 * opens a block comment that never closes until the next block-comment
 * terminator somewhere below —
 * silently deleting the code in between. That is not hypothetical: it happened
 * to this very file's enablement test, on a comment written two hours earlier.
 * Stripping line comments first removes the fake opener with the line it sits
 * on, and every assertion here reads what it thinks it reads.
 */
/** This file without its comments — both rules are discussed in prose above. */
const code = stripComments(source);

/**
 * Just the `communityProfiles` table declaration.
 *
 * ⚠️ Every assertion below runs against THIS, never against the whole file, and
 * that is the correction of a real defect in the first version of this test.
 * `schema-community.ts` says in its own header that it grows one table per
 * story — groups, discussions, posts, unread markers. A rule asserted over the
 * whole file stops being a rule about profiles the moment a second table
 * arrives: someone could change `community_profiles.member_id` to `set null`
 * and a file-wide `toMatch(/cascade/)` would still pass, because the groups
 * table below it cascades. The test would keep reporting a guarantee it had
 * stopped checking, which is worse than not having it.
 */
const profilesTable = (() => {
  const start = code.indexOf("export const communityProfiles");
  if (start < 0) throw new Error("cannot find communityProfiles in schema-community.ts");
  const rest = code.slice(start);
  const end = rest.indexOf("\n});");
  if (end < 0) throw new Error("cannot find the end of the communityProfiles table");
  return rest.slice(0, end);
})();

describe("the test reads the right thing", () => {
  it("found the profiles table and nothing beyond it", () => {
    // Non-vacuity: an empty or over-long slice would make every assertion
    // below meaningless in one direction or the other.
    expect(profilesTable).toContain('pgTable("community_profiles"');
    expect(profilesTable).toContain("displayName");
    // Later tables must NOT be inside the slice.
    const laterTables = code.slice(code.indexOf(profilesTable) + profilesTable.length);
    expect(profilesTable).not.toContain("pgTable(\"community_groups\"");
    expect(laterTables.includes("pgTable(") || laterTables.trim().length < 200).toBe(true);
  });
});

describe("the profile goes with the account", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // Somebody changes the member FK to `set null` — the shape the avatar column
  // two lines below legitimately uses — and the profile row outlives the
  // account. The app would then hold a name and a self-description belonging to
  // a person who asked to be deleted, with the link to them removed so nothing
  // can ever find it again. `deleteOwnAccount()` names this cascade in its
  // doctrine list and does nothing itself to enforce it; the schema is the
  // enforcement, and this is what keeps the schema honest (AD-65).
  it("member_id cascades", () => {
    expect(profilesTable).toMatch(
      /memberId: text\("member_id"\)[\s\S]*?onDelete: "cascade"/,
    );
  });

  it("the avatar reference does NOT cascade", () => {
    // The opposite direction, and it is deliberate: deleting a picture must
    // leave the person. A cascade here would mean pruning a media row silently
    // deletes profiles.
    expect(profilesTable).toMatch(
      /avatarMediaId: text\("avatar_media_id"\)[\s\S]*?onDelete: "set null"/,
    );
  });
});

describe("OQ-2 stays decided", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // A later story adding `.unique()` to `display_name` because a duplicate name
  // looked like a bug. It is not: two members may legitimately share a name,
  // real people do, and a unique index turns that into an error message a
  // member cannot act on at the moment they are introducing themselves. The
  // answer to impersonation-by-name is the report path (Epic 23), not a
  // constraint that refuses the honest case to inconvenience the dishonest one.
  //
  // If this is ever revisited, it is revisited HERE, on purpose — the decision
  // and its reasoning sit in the column comment right above the line.
  it("display_name carries no unique index — declared on the column OR in the table callback", () => {
    const column = profilesTable.slice(profilesTable.indexOf('displayName: text("display_name")'));
    const declaration = column.slice(0, column.indexOf(","));
    expect(declaration).toContain("notNull()");
    expect(declaration).not.toContain("unique");

    // The second half, and the one the first version of this test missed:
    // every other schema file in this repo declares indexes in the table
    // callback's second argument (`db/schema-api-keys.ts`, `db/schema-media.ts`
    // both use `(t) => [ … ]`). `uniqueIndex(…).on(t.displayName)` there leaves
    // the column declaration untouched — so checking the column alone would
    // have let OQ-2 be reversed with the test still green, which is the only
    // thing it exists to prevent.
    expect(profilesTable).not.toMatch(/unique/i);
  });

  it("there is no second identifier beside the display name", () => {
    // A handle (`@name`) would be a second, scarcer namespace to explain,
    // defend and migrate. OQ-2 decided against one.
    //
    // Scoped to the PROFILES table, deliberately. Asserted over the whole file
    // this would red-build Story 19.5 for a legitimate reason — a group with a
    // URL segment (`slug`) has nothing to do with member identity — and the
    // cheapest fix for whoever hit it would be to delete the assertion, taking
    // the OQ-2 pin with it.
    expect(profilesTable).not.toMatch(/handle|slug|username/i);
  });
});

// ── the post-image attachments, and the two directions their keys point ──────

describe("🚨 a post's pictures go with the post, and a picture's deletion does not", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // Both foreign keys, and they point OPPOSITE ways on purpose — which is
  // exactly the shape somebody "tidies" into one. `post_id` cascading and
  // `media_id` set-nulling are two different claims, and reversing either is a
  // change that compiles, typechecks and serves pages perfectly:
  //
  //   · `media_id` turned into `cascade` would mean deleting a picture DELETES
  //     the attachment row. That sounds harmless until it is read from the other
  //     end: `deleteOwnedMedia()` walks a departing member's pictures one at a
  //     time, so a cascade there silently rewrites other people's threads while
  //     the app reports an account deletion. The `set null` is what leaves the
  //     honest "there was a picture here" — the same shape
  //     `community_profiles.avatarMediaId` uses, and for the mirror-image reason.
  //   · `post_id` turned into `set null` would leave attachment rows no query can
  //     ever reach, holding a member's picture in the Art. 15 answer of a post
  //     that no longer exists.
  //
  // Asserted on the SOURCE, like everything else in this file — there is no
  // database in a vitest run. What a real one does is measured in the module
  // deploy profile (`make deploy-test-modules`).
  const postMediaTable = (() => {
    const start = code.indexOf("export const communityPostMedia");
    if (start < 0) throw new Error("cannot find communityPostMedia in modules/community/schema.ts");
    const rest = code.slice(start);
    const end = rest.indexOf("\n);");
    if (end < 0) throw new Error("cannot find the end of the communityPostMedia table");
    return rest.slice(0, end);
  })();

  it("the test reads that table and nothing beyond it", () => {
    // Non-vacuity, the same way the profiles slice earns it above: an empty or
    // over-long slice makes every assertion below meaningless in one direction
    // or the other.
    expect(postMediaTable).toContain('pgTable(\n  "community_post_media"');
    expect(postMediaTable).toContain("position");
    expect(postMediaTable).not.toContain('pgTable(\n  "community_conversations"');
  });

  it("post_id cascades", () => {
    expect(postMediaTable).toMatch(
      /postId: text\("post_id"\)[\s\S]*?onDelete: "cascade"/,
    );
  });

  it("media_id does NOT cascade — it is set null", () => {
    expect(postMediaTable).toMatch(
      /mediaId: text\("media_id"\)[\s\S]*?onDelete: "set null"/,
    );
    // Said as a refusal too: the regex above would still pass if somebody added
    // a SECOND `onDelete` further down the declaration.
    const mediaColumn = postMediaTable.slice(postMediaTable.indexOf('mediaId: text("media_id")'));
    expect(mediaColumn.slice(0, mediaColumn.indexOf("),"))).not.toContain("cascade");
  });

  it("carries the reverse index the account sweep needs", () => {
    // `ON DELETE set null` scans this table per deleted `media` row, and the
    // primary key leads with `post_id`. Without an index on `media_id`, erasing
    // a member's pictures is one sequential scan of every attachment in the app
    // per picture — invisible on a laptop, and the kind of thing NFR-41 asks to
    // be indexed at design time rather than after somebody notices.
    const at = postMediaTable.indexOf('index("community_post_media_media")');
    expect(at, "community_post_media_media is gone").toBeGreaterThan(-1);
    expect(
      postMediaTable.slice(at, at + 120).replace(/\s+/g, " "),
      "the index exists but does not lead with media_id, so the FK's own lookup " +
        "cannot use it",
    ).toMatch(/\.on\(\s*t\.mediaId/);
  });

  it("keys the row by (post_id, position), so a post cannot hold two pictures in one place", () => {
    expect(postMediaTable.replace(/\s+/g, " ")).toContain(
      "primaryKey({ columns: [t.postId, t.position] })",
    );
  });
});

describe("every community surface re-checks enablement", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // The module's central invariant (AD-67), enforced until now by prose only.
  // Deleting the check in the action leaves `npm run typecheck` clean, all
  // tests green and `make deploy-test` green — because the community ships OFF
  // and smoke therefore never exercises the write path at all. What is left is
  // a live write endpoint accepting member-authored text into the database of
  // an installation whose operator switched the feature off.
  //
  // The page's check is equally invisible to the suite: it is a `[param]`
  // route, which smoke skips by design.
  //
  // Hiding is never guarding — neither the card being unrendered nor the proxy
  // rewrite is the guard, because a form post does not care that the card was
  // not drawn and a matcher edit can move the rewrite.
  const surfaces = [
    ["modules/community/profile-actions.ts", "the profile write action"],
    ["modules/community/pages/members/[memberId]/page.tsx", "the member profile page"],
    ["modules/community/pages/page.tsx", "the community section"],
  ] as const;

  for (const [file, what] of surfaces) {
    it(`${what} calls the enablement check itself`, () => {
      const surface = stripComments(readFileSync(join(ROOT, file), "utf8"));

      // Non-vacuity FIRST. This assertion caught a real bug in its own test on
      // the day it was written: the member page's header comment contains the
      // path `/dashboard/community/*`, and a block-comment stripper that runs
      // before the line-comment stripper reads that `/*` as the start of a
      // block and eats everything up to the next block terminator — which was
      // the JSX comment forty lines below, taking the enablement check with it. The
      // test went red for a guard that was present. Had the check been on the
      // other side of that JSX comment, it would have gone GREEN for a guard
      // that was absent, which is the failure worth designing against.
      expect(surface, `${file}: nothing survived comment stripping`).toMatch(
        /export\s+(default\s+)?(async\s+)?function/,
      );

      expect(surface).toMatch(/isCommunityEnabled\(\)|communityOffReason\(\)/);
    });
  }
});

// ── every table `community-prune` sweeps has an index that serves it ────────

describe("🚨 the retention sweeps are indexed for an age query", () => {
  // The sweeps run `select … where created_at < cutoff limit n`, and what an
  // index leading with `created_at` buys is the DAILY run rather than the first
  // one. Measured on a real table of 40,000 messages with none old enough: an
  // `Index Scan using community_messages_created` at cost 4.31, where without the
  // index Postgres must read every row to establish there is nothing to do — once
  // a day for ever, on the largest table this module has. (The first catch-up run
  // is a sequential scan either way, and the planner is right: when most of the
  // table qualifies, scanning beats seeking. The index is not there for that.)
  //
  // Neither half is visible from the other's file, and this is where the pair is
  // held together: a `DROP INDEX` in a later migration, or a table renamed out of
  // this list, leaves a job that looks fine and degrades into a daily full scan on
  // exactly the installation big enough to notice.
  //
  // Asserted on the SOURCE, like everything else in this file — there is no
  // database in a vitest run. What a real one says is measured in the module
  // deploy profile.
  const SWEPT: Array<[table: string, index: string, why: string]> = [
    [
      "community_messages",
      "community_messages_created",
      "the DM retention sweep — the conversation index leads with conversation_id and cannot serve an age query across all conversations",
    ],
    [
      "community_spam_reports",
      "community_spam_reports_handled",
      "handled reports past a year — the other index on this table is partial on `consumed_at is null` and therefore EXCLUDES every row this sweep touches",
    ],
    [
      "community_moderation_audit",
      "community_moderation_audit_time",
      "the moderation trail past a year — this index predates the sweep and already serves it",
    ],
  ];

  it("found the three swept tables in the schema", () => {
    // Non-vacuity: without this the loop below would pass on a renamed table.
    //
    // ⚠️ The needle allows whitespace after `pgTable(` on purpose: these three
    // declarations put the table name on its OWN line, where
    // `communityProfiles` above has it inline. A `toContain('pgTable("x"')`
    // written from the profiles table's shape finds none of them — and the way
    // that reads is "the table is gone", which is exactly the false alarm this
    // assertion exists to raise honestly.
    for (const [table] of SWEPT) {
      expect(code, `${table} is not declared here any more`).toMatch(
        new RegExp(`pgTable\\(\\s*"${table}"`),
      );
    }
  });

  for (const [table, indexName, why] of SWEPT) {
    it(`${table} has ${indexName} — ${why}`, () => {
      const at = code.indexOf(`index("${indexName}")`);
      expect(
        at,
        `${indexName} is gone. ${why}. The sweep in modules/community/cron.ts ` +
          `asks "older than X" once a day for ever — without this index that ` +
          `question reads the whole table every time, to answer "nothing".`,
      ).toBeGreaterThan(-1);

      // And it really leads with the timestamp: an index on
      // `(something_else, created_at)` carries the same name-shape and answers a
      // different question.
      const declaration = code.slice(at, at + 260);
      expect(
        declaration.replace(/\s+/g, " "),
        `${indexName} exists but does not lead with created_at, so an age query ` +
          `cannot use it`,
      ).toMatch(/\.on\(\s*t\.createdAt/);
    });
  }
});
