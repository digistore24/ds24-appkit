// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The guard that keeps a private conversation private.**
//
// The community module's hardest line is FR-200: a direct message is readable
// by its two participants and by nobody else — not a moderator, not the
// operator, not an admin surface, not any export but the participants' own.
// AD-59 turns that promise into a shape the code can be held to, and this file
// is what holds it:
//
//   1. **Nothing outside a short allowlist so much as NAMES the two DM
//      tables.** Not a page, not an action, not a script. A file that cannot
//      name the table cannot read it, whatever its author intended.
//   2. **Every exported function in `manage.ts` whose body touches a DM table
//      declares a participant id.** Not "the caller checks" — the id is in the
//      signature, so a reader with no participant to scope by does not compile.
//
// This is the `lib/ai/providers/leak-guard.test.ts` shape (walk + needle +
// allowlist with reasons) crossed with `lib/impersonation/guard.test.ts`
// (comment-stripped assertions about one named file), and it exists for the
// same reason both of those do: it is a rule nobody can remember, protecting
// something whose breach is invisible until somebody reads their own inbox in
// a support tool.
//
// ⚠️ **Adding a file to the allowlist is a decision, and it carries a reason
// beside it.** Epic 23's report queue is the one addition already foreseen —
// a moderator sees a reported message inside a bounded window (AD-71), and
// that window is the exception the product decided to grant. Everything else
// that wants to read these tables should be asked why first.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";
import { shellSource } from "./_shell-files.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Trees worth scanning. Everything a customer's app is built from. */
const SCANNED = ["app", "lib", "components", "hooks", "db", "scripts", "i18n", "modules"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

/**
 * The two tables, named every way a file could name them.
 *
 * Both the Drizzle symbols and the snake-case names: a raw query in a script
 * never mentions the symbol, and a TypeScript file never mentions the table.
 * `community_read_markers.conversation_id` is deliberately NOT a needle — the
 * marker table is one both sides share, and its own privacy story was settled
 * in 19.7.
 */
const DM_NEEDLES = [
  "communityConversations",
  "communityMessages",
  "community_conversations",
  "community_messages",
  // The member block belongs to the same walk, for a different reason: it is
  // a DM and follow instrument and must not reach the ROOMS. A group read that
  // consulted it would turn "I do not want messages from you" into "I cannot
  // see your posts", which is a different product decision nobody made — and
  // the one an implementer reaches for when a member asks why they can still
  // see somebody they blocked.
  "communityMemberBlocks",
  "community_member_blocks",
];

/**
 * Who may name them, and why.
 *
 * Empty beyond these four by design. Note what is NOT here: no page under
 * `app/dashboard/admin/`, no support tool, no cron job, no `/api/v1` handler.
 * The member-facing surfaces are not here either — they call `manage.ts` and
 * never touch a table, which is what keeps the number of files that could
 * possibly widen a read down to one.
 */
const ALLOWED: Record<string, string> = {
  "modules/community/schema.ts": "the definition",
  "db/schema.ts": "re-exports the domain file wholesale (`export *`)",
  // 🚨 The DM readers were all in `manage.ts` until it was split into eleven
  // domain files. They are all in ONE of them — which is the same statement the
  // old single entry made, and the reason the split kept them together rather
  // than scattering them across the files that call them.
  "modules/community/lib/messages.ts": "the participant-scoped readers, and the only ones",
  // Reads a conversation to decide what a report may show, through
  // `conversationForParticipant()` — the resolver above, never a table of its own.
  "modules/community/lib/reports.ts": "the spam report's own scoped read",
  "modules/community/lib/unread.ts": "the badge, which counts through the same resolver",
  "modules/community/lib/live.ts": "the live poll, likewise",
  "modules/community/lib/_blocks.ts": "the block tables themselves — one member, by id",
  // Reads `communityMemberBlocks` for `blockMember()`/`unblockMember()`, and
  // scopes every statement by `blockerId` — one of the two names the signature
  // half below accepts. Named here because the split gave following its own
  // file, not because the rule loosened.
  "modules/community/lib/following.ts": "block and unblock, scoped by blockerId",
  // ⚠️ These two used to be `lib/privacy/export.ts` and
  // `scripts/privacy/export-data.mjs`. The Art. 15 answer MOVED into this
  // module when the community became one — and the allowance moved with it,
  // which is the point rather than a detail: the two core files may now name a
  // DM table no more than any other core file may.
  "modules/community/privacy/sections.ts":
    "the member's own download — scoped to their own participation by construction",
  "modules/community/privacy/sections.mjs":
    "the operator's subject access request — the same query in raw SQL, for one named person",
  "modules/community/lib/dm-guard.test.ts": "this file, which has to spell the needles",
  "modules/community/scripts/prune.mjs":
    "bulk-by-age deletion, and the one selector that needs no look inside — it prints counts and dates, never a message, an author or a conversation id",
  // The same sweep on a schedule, and the allowance is granted on a STRONGER
  // form of the same argument rather than a weaker one. A job's only output is
  // the single line that lands in `cron_runs.lastDetail`, and that line must be
  // numbers — `docs/data-protection.md` §11 keeps that table free of any privacy
  // question at all. So this file is structurally unable to reveal what it
  // deleted, where the script above merely declines to. It ships DISABLED in
  // `config/cron.json`; what it may name and what it may run are separate
  // questions and this allowlist only answers the first.
  "modules/community/cron.ts":
    "bulk-by-age deletion on a schedule — its only output is one line of numbers in cron_runs, so it cannot report a message, an author or a conversation id even by mistake",
  "modules/community/lib/deletion.test.ts":
    "names the tables to assert the account-deletion scrub covers BOTH of them — it reads nothing",
  "modules/community/lib/moderation-guard.test.ts":
    "asserts the bounded window's shape — it names the table to prove the reader selects by id list and re-checks the conversation",
  "modules/community/lib/feed-guard.test.ts":
    "names the tables to assert the feed's code CANNOT — the same absence, asserted from the other side",
  "modules/community/lib/follow.test.ts":
    "asserts that the block transaction DELETES the follows between the pair — it names the block table to recognise the statement, and reads nothing",
  "modules/community/lib/unread-parity.test.ts":
    "names the table to assert a COLUMN's precision in schema.ts — it opens no connection, selects nothing, and the only thing it reads is source text",
  "modules/community/schema.test.ts":
    "names the table to assert the retention sweep's INDEX exists — source text again, no connection and no query",
};

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
    const full = join(ROOT, rel);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(rel);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      yield rel;
    }
  }
}

function allFiles(): string[] {
  return SCANNED.flatMap((dir) => [...sourceFiles(dir)]).map((path) =>
    path.split(sep).join("/"),
  );
}

/**
 * A file with its comments taken out.
 *
 * `lib/impersonation/guard.test.ts`'s move. Both halves of this suite need it:
 * the module's prose names these tables constantly and should go on doing so,
 * and an assertion that counts comments is an assertion about documentation
 * rather than about code.
 */
describe("nothing outside the allowlist names a direct-message table", () => {
  it("holds for every source file", () => {
    const offenders: string[] = [];

    for (const path of allFiles()) {
      if (path in ALLOWED) continue;
      // Comments stripped first: a mention in prose is not a read, and this
      // module's files explain themselves at length. `rules.ts` names both
      // tables in the header of `canonicalPair()`, which is exactly the kind
      // of sentence that should keep being written.
      const source = withoutComments(readFileSync(join(ROOT, path), "utf8"));
      for (const needle of DM_NEEDLES) {
        if (source.includes(needle)) offenders.push(`${path} names ${needle}`);
      }
    }

    expect(
      offenders,
      "direct messages are readable by their two participants and by nobody " +
        "else (FR-200). A file that needs one of these tables goes through " +
        "modules/community/lib/manage.ts, whose readers all take a participant id — " +
        "or it gets a line in ALLOWED above, with the reason:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("actually reads files, so an empty result means something", () => {
    // Non-vacuity: a broken path would make the assertion above pass by
    // scanning nothing at all.
    const files = allFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("modules/community/lib/messages.ts");
  });

  it("would catch a violation if there were one", () => {
    // The guard's own guard. The allowlist is checked by exact path, so a
    // near-miss (a copy of manage.ts under another name) is an offender.
    const source = 'import { communityMessages } from "../schema";';
    expect(DM_NEEDLES.some((needle) => source.includes(needle))).toBe(true);
    expect("modules/community/lib/messages-v2.ts" in ALLOWED).toBe(false);
  });
});

// ── The signature half ──────────────────────────────────────────────────────
//
// The allowlist says WHERE a DM table may be read. This says HOW: in
// `manage.ts` — the only file that reads them for the app — an exported
// function whose body touches one must take a participant id. That is AD-59's
// literal wording, and the failure it prevents is a reader that looks harmless
// because it takes a conversation id and answers for whoever asks.

const MANAGE = withoutComments(
  shellSource(),
);

/**
 * The one scoped resolver.
 *
 * A function may satisfy AD-59 in either of two ways, and both end in the same
 * place: it takes a `participantId` itself, or it resolves the conversation
 * through THIS helper, which takes one and puts it in the WHERE clause. The
 * second is how `acknowledgeRead()` — one writer, two legs — stays honest
 * while its parameter is called `viewer`.
 */
const SCOPED_RESOLVER = "conversationForParticipant(";

/**
 * The parameter names that count as "one named member's own scope".
 *
 * Two, and each is a role rather than a synonym: `participantId` is one of the
 * two people in a conversation, `blockerId` is the one person a block row
 * belongs to. Both put their id in the WHERE clause of every statement below
 * them. A third name arriving here should be argued for, not added — the
 * value of a convention is that it is short enough to hold.
 */
const SCOPE_PARAMS = ["participantId", "blockerId"];

/**
 * Functions exempt from the participant-id rule, each with the reason.
 *
 * ⚠️ **An exemption is a decision, and it is only granted to a WRITER that
 * touches nobody else's rows.** The rule exists to stop unscoped READS; a
 * statement whose WHERE clause is "this member's own authored rows" discloses
 * nothing to anybody, and the assertion below still demands it be scoped —
 * just by a differently-named id. Anything that reads gets no exemption.
 */
/**
 * Functions that name a DM table only in a TYPE, and read nothing.
 *
 * 🚨 **A third category, and it appeared the day `manage.ts` was split.** The
 * rule below asks about every EXPORTED function whose body names one of these
 * tables — and `toMessageRow` names `communityMessages` exactly once, as
 * `typeof communityMessages.$inferSelect` on a parameter. It is handed a row
 * somebody else already scoped and turns it into the shape the browser gets; it
 * has no query, no `db`, and nothing to scope.
 *
 * It was private inside the old file, so the scanner never saw it. Making it
 * visible to a sibling is what the split cost, and this is the honest way to
 * pay it: an entry with a reason, rather than widening the rule for everybody.
 *
 * ⚠️ The condition is checked, not trusted — the assertion below refuses an
 * entry whose body contains a `db.` call.
 */
const PURE_MAPPERS: Record<string, string> = {
  toMessageRow:
    "a mapper: takes a row that was already scoped by its caller and returns " +
    "the shape a browser gets. Names the table only as a parameter type.",
};

const SCOPED_WRITERS: Record<string, string> = {
  scrubCommunityContentFor:
    "the account-deletion scrub: UPDATEs over the departing member's OWN rows, " +
    "scoped by memberId, reading nothing back",
};

/**
 * 🚨 **The ONE reader that may answer without a participant id — and the only
 * one there will ever be.**
 *
 * AD-71 grants exactly one exception to "no unscoped DM reader": a moderator
 * seeing a reported message. The product decided to grant it, and the guard
 * records it here rather than letting somebody quietly widen `SCOPE_PARAMS`
 * until the rule means nothing.
 *
 * ⚠️ **The exemption is from the SIGNATURE rule, not from being bounded.** The
 * suite below asserts the three bounds that replace the participant id:
 * moderator authority re-read from the database, selection by an explicit id
 * list, and a re-check that every row returned is in the reported message's
 * conversation. A second entry in this map should be argued for in a story,
 * not added in a refactor.
 */
const BOUNDED_EXCEPTIONS: Record<string, string> = {
  reportedMessagesFor:
    "AD-71's bounded window: a moderator sees the reported message plus what " +
    "the REPORTER attached, by explicit id, re-checked against that " +
    "message's own conversation",
};

/**
 * Every exported function in `manage.ts`, as `[name, body]`.
 *
 * Bodies run to the next top-level `export` or the end of the file. Crude, and
 * sufficient: this file has one export per top-level declaration and no nested
 * ones, so a body that over-reaches would only ever make the test STRICTER.
 */
function exportedFunctions(source: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const pattern = /^export (?:async )?function (\w+)\(([\s\S]*?)\n\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push([match[1], match[2]]);
  }
  return found;
}

describe("every DM reader in manage.ts names a participant", () => {
  const functions = exportedFunctions(MANAGE);
  const touchesDm = functions.filter(([, body]) =>
    DM_NEEDLES.some((needle) => body.includes(needle)),
  );

  it("finds the direct-message functions at all", () => {
    // Non-vacuity, the `export.test.ts` "reads a plausible section list"
    // precedent: a refactor that renamed everything must not make this suite
    // pass over an empty set. These are the functions Story 21.1 built.
    const names = touchesDm.map(([name]) => name);
    for (const expected of [
      "openConversation",
      "sendMessage",
      "listConversations",
      "listMessages",
      "unreadMessagesFor",
      "acknowledgeRead",
      "listBlocks",
      "hasBlocked",
    ]) {
      expect(names, `${expected} should be one of the DM functions`).toContain(
        expected,
      );
    }
  });

  it("scopes each of them by a participant id", () => {
    const offenders = touchesDm
      .filter(([name, body]) => {
        // A writer over the caller's own rows, exempted by name with its
        // reason — and still asserted to be scoped, one test down.
        if (name in SCOPED_WRITERS) return false;
        // A mapper that names a table only as a parameter type. Checked, not
        // trusted — the test below refuses an entry whose body queries.
        if (name in PURE_MAPPERS) return false;
        // AD-71's one granted exception, bounded by other means — asserted
        // below rather than waved through.
        if (name in BOUNDED_EXCEPTIONS) return false;
        // Either the id is in the signature and used below it, or the
        // conversation is resolved through the one scoped resolver — which
        // demands one itself, as the next test asserts.
        if (body.includes(SCOPED_RESOLVER)) return false;
        const split = body.indexOf("): ");
        const signature = body.slice(0, split);
        const rest = body.slice(split);
        // Both halves: a signature that declares a scope id and never uses it
        // is the shape a refactor leaves behind.
        return !SCOPE_PARAMS.some(
          (param) => signature.includes(param) && rest.includes(param),
        );
      })
      .map(([name]) => name);

    expect(
      offenders,
      "AD-59: every function that reads a direct-message or block table " +
        "answers only about ONE named member — either by taking their id " +
        `(${SCOPE_PARAMS.join(", ")}), or by resolving through ` +
        `${SCOPED_RESOLVER}. A reader without one is an unscoped reader, ` +
        "which is the thing this module promises does not exist:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("🚨 keeps the pure mappers pure", () => {
    // The exemption above is granted for "reads nothing". This is what makes
    // that a measurement rather than a claim: an entry that grew a query would
    // otherwise sit in the list forever, exempt from the rule it now breaks.
    expect(Object.keys(PURE_MAPPERS).length, "the mapper list is empty").toBeGreaterThan(0);
    for (const name of Object.keys(PURE_MAPPERS)) {
      const found = functions.find(([fn]) => fn === name);
      expect(found, `${name} is in PURE_MAPPERS but no longer exists`).toBeDefined();
      const body = found?.[1] ?? "";
      expect(body, `${name} is exempted as a mapper but calls the database`).not.toMatch(/\bdb\s*\./);
      expect(body, `${name} is exempted as a mapper but builds a query`).not.toMatch(/\.from\(|\.select\(/);
    }
  });

  it("keeps the exempt writers scoped too", () => {
    // The exemption is from the NAME of the id, never from having one. Each
    // exempt function's body must name `memberId` and put it in a WHERE — a
    // scrub with no predicate would blank the whole table.
    for (const name of Object.keys(SCOPED_WRITERS)) {
      const found = functions.find(([fn]) => fn === name);
      expect(found, `${name} should exist in manage.ts`).toBeDefined();
      const body = found![1];
      expect(body, `${name} scopes by memberId`).toContain("memberId");
      expect(body, `${name} puts it in a where clause`).toContain(".where(");
    }
  });

  it("bounds the one granted exception by other means", () => {
    // The exemption above is from the participant-id rule, not from being
    // bounded. Three bounds replace it, and all three are asserted here — a
    // reader that lost any one of them would be an unscoped DM reader with a
    // reassuring name.
    for (const name of Object.keys(BOUNDED_EXCEPTIONS)) {
      const found = functions.find(([fn]) => fn === name);
      expect(found, `${name} should exist in manage.ts`).toBeDefined();
      const body = found![1];

      // 1. The authority is re-read from the database.
      expect(body, `${name} re-reads the moderator authority`).toContain(
        "requireModerator(",
      );
      // 2. Selection is an explicit id list — never a conversation scope.
      expect(body, `${name} selects by an explicit id list`).toContain(
        "inArray(communityMessages.id",
      );
      // 3. And every row is re-checked against the reported conversation, so
      //    an id smuggled onto the report row renders nothing.
      expect(body, `${name} re-checks the conversation`).toContain(
        "eq(communityMessages.conversationId",
      );
    }
  });

  it("keeps the scoped resolver scoped", () => {
    // The second route above is only worth anything while this holds. It is
    // asserted rather than assumed, because it is the single point every DM
    // read that does not carry its own id passes through.
    const resolver = MANAGE.slice(
      MANAGE.indexOf("async function conversationForParticipant("),
    ).slice(0, 900);

    expect(resolver).toContain("participantId: string");
    // The id in the WHERE clause, on BOTH participant columns — a resolver
    // that scoped by only one of them would answer for half the pairs and
    // silently refuse the other half.
    expect(resolver).toMatch(/participantAId,\s*participantId/);
    expect(resolver).toMatch(/participantBId,\s*participantId/);
  });
});

// ── The block stops at the door of a room ──────────────────────────────────
//
// FR-201: the member block is a DM and follow instrument and touches nothing
// in groups. A blocked member's posts, presence and access in a shared room
// are unchanged in both directions — which is a promise about what the room's
// read path does NOT consult, and therefore a promise a source-reading test
// can keep better than a behavioural one: the behavioural version proves the
// block is not consulted TODAY, this proves it cannot start being.

const BLOCK_NEEDLES = ["communityMemberBlocks", "community_member_blocks"];

describe("the member block does not reach the rooms", () => {
  const functions = exportedFunctions(MANAGE);

  /** The room side: everything that decides what a member sees or may write in a group. */
  const ROOM_FUNCTIONS = [
    "groupsFor",
    "groupFor",
    "listGroups",
    "startDiscussion",
    "addPost",
    "editOwnPost",
    "deleteOwnPost",
    "discussionFor",
    "discussionsFor",
    "postsFor",
    "embedAccessFor",
    "addEmbeddedPost",
    "liveAnswerFor",
    "unreadFor",
    "unreadByDiscussion",
    "unreadByGroup",
  ];

  it("finds the room functions at all", () => {
    // Non-vacuity: a rename must not turn this suite into an assertion about
    // an empty set.
    const names = functions.map(([name]) => name);
    for (const expected of ROOM_FUNCTIONS) {
      expect(names, `${expected} should exist in manage.ts`).toContain(expected);
    }
  });

  it("consults no block state in any of them", () => {
    const offenders = functions
      .filter(([name]) => ROOM_FUNCTIONS.includes(name))
      .filter(([, body]) => BLOCK_NEEDLES.some((needle) => body.includes(needle)))
      .map(([name]) => name);

    expect(
      offenders,
      "a member block is about an INBOX, not about a room. Filtering a " +
        "discussion by it would turn 'I do not want messages from you' into " +
        "'I cannot see your posts' — a different product decision, and one " +
        `nobody made:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
