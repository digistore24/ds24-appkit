// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Following: the refusals, the ghost-follow leak, and the counts that must not
// exist anywhere.
//
// Three things are worth testing here and each fails differently:
//
//   1. **The refusals**, in the pure core. A follow appears on somebody else's
//      list under a name, so it is a write like any other — and a block has to
//      refuse it with the same neutral sentence a message gets, or the follow
//      button becomes a second door onto "have they blocked me".
//   2. **The ghost follow.** A block that FILTERED follows instead of deleting
//      them would leave the row in the follower's own export — which discloses
//      that a block exists. This is asserted on the statements the block
//      transaction issues, the way `deletion.test.ts` asserts the scrub.
//   3. **The absent counts.** FR-222 forbids an aggregate over the follow
//      graph anywhere, operator surfaces included. That is negative space, so
//      it is asserted by reading the source rather than by calling anything.
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { canFollow } from "./rules";
import { blockMember } from "./manage";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// ── The refusals ───────────────────────────────────────────────────────────

describe("canFollow", () => {
  const named = { displayName: "Ada" };
  const live = { blockedAt: null };

  it("lets a named member follow a live account", () => {
    expect(
      canFollow(named, { self: false, target: live, blockedEitherWay: false }),
    ).toBeNull();
  });

  it("refuses a member who has not chosen a name", () => {
    // The AD-69 gate gaining a caller, not a second display-name check: a
    // follow appears on somebody's list under a name, and a member with none
    // would appear there as a blank.
    for (const profile of [null, { displayName: "" }]) {
      expect(
        canFollow(profile, {
          self: false,
          target: live,
          blockedEitherWay: false,
        }),
      ).toBe("communityProfileIncomplete");
    }
  });

  it("refuses a block, an absent account, a closed account and oneself — identically", () => {
    // ⚠️ Compared against EACH OTHER, not against a string. The point is not
    // that each is `communityNotDeliverable`; it is that a follow refusal cannot be
    // told apart from a message refusal, or from another follow refusal with a
    // different cause behind it. A follow button that failed distinguishably
    // would answer "have they blocked me" without anybody asking.
    const causes = {
      blocked: { self: false, target: live, blockedEitherWay: true },
      noSuchAccount: { self: false, target: null, blockedEitherWay: false },
      closedAccount: {
        self: false,
        target: { blockedAt: new Date("2026-01-01") },
        blockedEitherWay: false,
      },
      self: { self: true, target: live, blockedEitherWay: false },
    };

    const answers = Object.entries(causes).map(([label, input]) => [
      label,
      canFollow(named, input),
    ]);
    for (const [label, answer] of answers) {
      expect(answer, String(label)).toBe("communityNotDeliverable");
      expect(answer, String(label)).toEqual(answers[0][1]);
    }
  });

  it("asks participation BEFORE the block", () => {
    // The order the reader of an error message would want: "choose a name" is
    // about them and they can act on it. It is also the safer order — a member
    // with no profile learns nothing about a block from the refusal they get.
    expect(
      canFollow(null, { self: false, target: live, blockedEitherWay: true }),
    ).toBe("communityProfileIncomplete");
  });
});

// ── The ghost follow ───────────────────────────────────────────────────────

const dialect = new PgDialect();

/** One statement the block transaction would have executed. */
interface Recorded {
  kind: "insert" | "delete";
  table: string;
  where: string;
}

function tableName(table: unknown): string {
  const t = table as Record<string | symbol, unknown>;
  return String(t?.[Symbol.for("drizzle:Name")] ?? "unknown");
}

/**
 * A transaction that writes nothing and remembers everything.
 *
 * `deletion.test.ts`'s fake, shaped for this function's two statements.
 * Drizzle's builder is a thenable chain, so the stub has to be one too.
 */
function fakeTx(recorded: Recorded[]) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(table: any) {
      const row: Recorded = { kind: "insert", table: tableName(table), where: "" };
      const chain = {
        values() {
          return chain;
        },
        onConflictDoNothing() {
          recorded.push(row);
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete(table: any) {
      const row: Recorded = { kind: "delete", table: tableName(table), where: "" };
      return {
        where(condition: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          row.where = dialect.sqlToQuery(condition as any).sql;
          recorded.push(row);
          return Promise.resolve([]);
        },
      };
    },
  };
}

async function blockStatements(): Promise<Recorded[]> {
  const recorded: Recorded[] = [];
  // `blockMember()` opens the transaction itself, so the database module is
  // mocked rather than the handle passed in — the transaction boundary is the
  // thing under test and must not be replaced by the test.
  const { db } = await import("@/db");
  const original = db.transaction;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).transaction = async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(fakeTx(recorded));
  try {
    await blockMember("member-a", "member-b");
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).transaction = original;
  }
  return recorded;
}

describe("blocking severs follows — inside the same transaction", () => {
  it("writes the block AND deletes the follows, in one transaction", async () => {
    const statements = await blockStatements();

    expect(
      statements.map((s) => `${s.kind} ${s.table}`),
      "the severing belongs INSIDE the block transaction — a second call site " +
        "leaves a moment in which the block stands and the follow survives it",
    ).toEqual([
      "insert community_member_blocks",
      "delete community_follows",
    ]);
  });

  it("deletes the follow in BOTH directions", async () => {
    const [, sever] = await blockStatements();

    // Two ordered pairs, joined by `or` — whichever way the follow points, and
    // whichever way the block does.
    expect(sever.where).toContain('"follower_id"');
    expect(sever.where).toContain('"followed_id"');
    expect(sever.where.match(/or/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    // Scoped to this pair, not to the table: an unscoped DELETE would empty
    // every follow in the app, and a rendered WHERE is the only assertion that
    // can tell the two apart.
    expect(sever.where).toContain("$1");
    expect(sever.where).toContain("$4");
  });

  it("DELETES rather than marking, so nothing survives to be filtered", async () => {
    // A filtered row still exists — and would then travel in the follower's
    // own export, disclosing that a block exists. That is the leak this whole
    // assertion is about, and it is why the statement is a delete.
    const statements = await blockStatements();
    const follows = statements.filter((s) => s.table === "community_follows");
    expect(follows).toHaveLength(1);
    expect(follows[0].kind).toBe("delete");
  });
});

// ── The counts that must not exist ─────────────────────────────────────────

const SCANNED = ["app", "lib", "components", "db", "scripts", "modules"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      yield* sourceFiles(rel);
    } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
      yield rel.split(sep).join("/");
    }
  }
}

const NAMES_FOLLOWS = /communityFollows|community_follows/;

/**
 * A file split into top-level blocks, as `[name, body]`.
 *
 * Crude and sufficient: every block runs from one top-level declaration to the
 * next, so a body that over-reaches only makes the check STRICTER. A file with
 * no top-level `function`/`const` at all is returned whole under its own name,
 * which is the right answer for a page component or a script.
 */
function blocks(source: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const pattern = /^(?:export )?(?:async )?(?:function|const) (\w+)/gm;
  const starts = [...source.matchAll(pattern)];
  if (starts.length === 0) return [["<file>", source]];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index ?? 0;
    const to = i + 1 < starts.length ? (starts[i + 1].index ?? source.length) : source.length;
    found.push([starts[i][1], source.slice(from, to)]);
  }
  return found;
}

describe("no aggregate over the follow graph exists anywhere", () => {
  it("holds for every source file", () => {
    // FR-222 is negative space, so it is asserted by reading rather than by
    // calling: a count that does not exist has no call site to test. What is
    // looked for is an aggregate applied to the follows table — the shape
    // `count(` or `.length` near it would take.
    const offenders: string[] = [];

    for (const dir of SCANNED) {
      for (const path of sourceFiles(dir)) {
        const source = withoutComments(readFileSync(join(ROOT, path), "utf8"));
        if (!NAMES_FOLLOWS.test(source)) continue;

        // Per FUNCTION, not per file. `manage.ts` legitimately counts messages
        // and posts for their pagers and also names the follow table; a
        // file-level check would either flag that or have to be switched off,
        // and a rule that gets switched off is not a rule. What is forbidden
        // is an aggregate in the same breath as the follow graph.
        for (const [name, body] of blocks(source)) {
          if (!NAMES_FOLLOWS.test(body)) continue;
          if (/\bcount\s*\(/.test(body)) {
            offenders.push(`${path} → ${name} counts over the follow graph`);
          }
        }
      }
    }

    expect(
      offenders,
      "FR-222: no follower count, anywhere — not on a profile, not on a list, " +
        "not on an operator page. How many people follow somebody is a fact " +
        "about those people, and in a plan-gated community an aggregate over " +
        `the graph starts describing who bought what:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("reads the files that name the table, so the result means something", () => {
    // Non-vacuity: the scan has to have SEEN the follow table somewhere, or it
    // is asserting over an empty set.
    const naming = SCANNED.flatMap((dir) => [...sourceFiles(dir)]).filter(
      (path) =>
        /communityFollows|community_follows/.test(
          readFileSync(join(ROOT, path), "utf8"),
        ),
    );
    expect(naming.length).toBeGreaterThan(2);
    expect(naming).toContain("modules/community/lib/manage.ts");
  });
});

// ── The cascade IS the deletion feature ────────────────────────────────────

describe("deleting an account removes its follows, both directions", () => {
  // FR-223's deletion half needs no deletion code — it falls out of two FK
  // declarations. Which is exactly why it is tested: an untested cascade is
  // one somebody later "optimizes" into `set null`, and the result would be a
  // follow row pointing at nobody, surviving an erasure request as a
  // relationship with a hole in it.
  const schema = withoutComments(
    readFileSync(join(ROOT, "modules/community/schema.ts"), "utf8"),
  );

  const table = schema.slice(
    schema.indexOf("communityFollows = pgTable"),
    schema.indexOf("communityMemberBlocks = pgTable"),
  );

  it("declares cascade on BOTH participant columns", () => {
    expect(table, "the follows table should be in the domain file").toContain(
      "follower_id",
    );
    const cascades = table.match(/onDelete: "cascade"/g) ?? [];
    expect(
      cascades,
      "both columns, or deleting one account leaves half a relationship — a " +
        "follow has no words to tombstone, so the row simply goes",
    ).toHaveLength(2);
    expect(table).not.toContain('onDelete: "set null"');
  });

  it("refuses a self-follow in the database as well as in the core", () => {
    // Two layers on purpose: the core turns it into a sentence, the CHECK
    // makes it unreachable by any other route.
    expect(table).toContain("community_follows_not_self");
  });
});

// ── The export carries relationships, never the graph ──────────────────────

describe("the follows export is scoped to the subject", () => {
  const exportSource = withoutComments(
    readFileSync(join(ROOT, "modules/community/privacy/sections.ts"), "utf8"),
  );

  it("queries only rows the subject is part of", () => {
    const section = exportSource.slice(
      exportSource.indexOf("const [followingRows, followedByRows]"),
    ).slice(0, 1200);

    // Both halves scoped by `memberId`, and nothing wider. A query without
    // one of these predicates would hand somebody the graph.
    expect(section).toContain("eq(communityFollows.followerId, memberId)");
    expect(section).toContain("eq(communityFollows.followedId, memberId)");
    expect(section).not.toMatch(/\bcount\s*\(/);
  });
});
