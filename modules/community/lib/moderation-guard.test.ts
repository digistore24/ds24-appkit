// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **Two properties of moderation power, both of which decay quietly.**
//
//   1. **Authority is re-read from the database at the moment of the act.**
//      Sessions here are JWTs and carry the role somebody had when they signed
//      in. An operator who takes the moderator role away at eleven expects it
//      gone at eleven — and the failure mode of getting this wrong is a person
//      who was demoted still removing posts until their token expires, which
//      nobody notices because nothing errors.
//   2. **The trail is append-only.** A lock and its later unlock are two rows.
//      An editable audit trail is not one: its whole value is that the person
//      who acted cannot revise it afterwards, and the only real guarantee is
//      that no function exists which could.
//
// The first is behavioural and driven with a fake database — the pure decision
// AND the shell's re-read, because the shell is where the session would have
// been trusted. The second is structural, because "there is no such function"
// cannot be tested by calling one.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  conflictOfInterest,
  mayConsumeReport,
  lockProblem,
  mayModerate,
  removalProblem,
  sendBlockState,
  windowMessageIds,
} from "./rules";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const MANAGE = withoutComments(
  readFileSync(join(ROOT, "modules/community/lib/manage.ts"), "utf8"),
);

// ── Who may act ────────────────────────────────────────────────────────────

describe("mayModerate", () => {
  const owner = { role: "owner", blockedAt: null };
  const moderator = { role: "moderator", blockedAt: null };
  const member = { role: "member", blockedAt: null };

  it("lets the operator act anywhere, with no duty row", () => {
    // An empty duty list on a room means "the operator looks after it", never
    // "nobody does" — the schema says so at the duty table, and this is the
    // half of that sentence which is code.
    expect(mayModerate(owner, "group-1", [])).toBeNull();
    expect(mayModerate(owner, null, [])).toBeNull();
  });

  it("lets a moderator act only where a duty names them", () => {
    expect(mayModerate(moderator, "group-1", ["group-1"])).toBeNull();
    expect(mayModerate(moderator, "group-2", ["group-1"])).toBe("notFound");
    // The role alone grants nothing. That is the whole distinction between the
    // third role and an admin.
    expect(mayModerate(moderator, "group-1", [])).toBe("notFound");
  });

  it("refuses an ordinary member outright", () => {
    expect(mayModerate(member, "group-1", ["group-1"])).toBe("notFound");
  });

  it("refuses a blocked account whatever its role says", () => {
    // Asked here as well as at the session guard, because this function is the
    // one every act asks — and a role is not a reason to let a closed account
    // act on other people's content.
    expect(
      mayModerate({ role: "owner", blockedAt: new Date() }, "group-1", []),
    ).toBe("notFound");
    expect(
      mayModerate({ role: "moderator", blockedAt: new Date() }, "g", ["g"]),
    ).toBe("notFound");
  });

  it("lets any duty-holding moderator act on an embedded discussion", () => {
    // The recorded v1 answer: an embed has no group, so a group-scoped duty
    // cannot name it. The alternative — operator only — leaves the threads
    // that appear inside a paid course with no moderator at all.
    expect(mayModerate(moderator, null, ["group-1"])).toBeNull();
    expect(mayModerate(moderator, null, [])).toBe("notFound");
  });

  it("answers ONE code for every refusal", () => {
    // A member probing the moderation actions learns nothing about which rooms
    // have moderators or which posts exist — the 20.1 indistinguishability
    // precedent applied to power instead of to content.
    const refusals = [
      mayModerate(member, "g", ["g"]),
      mayModerate(moderator, "other", ["g"]),
      mayModerate(moderator, null, []),
      mayModerate({ role: "owner", blockedAt: new Date() }, "g", []),
    ];
    for (const refusal of refusals) expect(refusal).toBe(refusals[0]);
  });
});

// ── What may be done ───────────────────────────────────────────────────────

describe("removalProblem", () => {
  const live = { deletedAt: null };

  it("wants a reason, and a real one", () => {
    expect(removalProblem(live, "Werbung")).toBeNull();
    for (const reason of ["", "   ", "​", undefined, null, 42]) {
      expect(removalProblem(live, reason), String(reason)).toBe(
        "reasonRequired",
      );
    }
  });

  it("refuses a second deletion event, in both directions", () => {
    // AD-72: at most one per row. A moderator must not overwrite an author's
    // own deletion — the screen would stop saying "the author deleted this"
    // about something the author did — and nothing overwrites an earlier
    // removal.
    expect(removalProblem({ deletedAt: new Date() }, "Werbung")).toBe(
      "communityAlreadyDeleted",
    );
  });

  it("asks about the row before it asks about the reason", () => {
    // An already-deleted post with no reason reports the ROW's state: it is
    // the truer sentence, and it is the one that keeps the
    // one-deletion-event rule legible.
    expect(removalProblem({ deletedAt: new Date() }, "")).toBe("communityAlreadyDeleted");
  });
});

describe("lockProblem", () => {
  it("refuses an act that would change nothing", () => {
    // A trail with rows for acts that changed nothing is a trail nobody
    // trusts.
    expect(lockProblem({ lockedAt: new Date() }, true)).toBe("communityAlreadyLocked");
    expect(lockProblem({ lockedAt: null }, false)).toBe("communityNotLocked");
  });

  it("permits the change that is real", () => {
    expect(lockProblem({ lockedAt: null }, true)).toBeNull();
    expect(lockProblem({ lockedAt: new Date() }, false)).toBeNull();
  });
});

// ── The stale token ────────────────────────────────────────────────────────

describe("the authority comes from the database, not the session", () => {
  /**
   * Load `manage.ts` over a fake database whose `users` row says what we want.
   *
   * The point is the SHELL, not the pure function: `mayModerate()` is trivially
   * right, and the mistake this test exists to catch is a shell that passes it
   * the session's role.
   */
  async function withRole(role: string) {
    vi.resetModules();
    const selects: unknown[] = [];
    vi.doMock("@/db", () => ({
      db: {
        select(projection: Record<string, unknown>) {
          selects.push(projection);
          const rows =
            "role" in projection
              ? [{ role, blockedAt: null }]
              : "groupId" in projection
                ? [{ groupId: "group-1" }]
                : [];
          const chain = {
            from: () => chain,
            where: () => chain,
            limit: () => Promise.resolve(rows),
            then: (resolve: (value: unknown) => unknown) => resolve(rows),
          };
          return chain;
        },
      },
    }));
    const { moderationAuthority } = await import("./manage");
    return moderationAuthority("actor-1");
  }

  it("reads the role that is in the database right now", async () => {
    const promoted = await withRole("moderator");
    expect(promoted).toEqual({
      role: "moderator",
      blockedAt: null,
      duties: ["group-1"],
    });
    expect(mayModerate(promoted!, "group-1", promoted!.duties)).toBeNull();
  });

  it("refuses once the role has been taken away, with the session unchanged", async () => {
    // The stale-token case, end to end at this layer: the caller's identity is
    // the same `actor-1` the first act used, and nothing about a session was
    // consulted — the answer changed because the DATABASE did.
    const demoted = await withRole("member");
    expect(demoted!.role).toBe("member");
    expect(mayModerate(demoted!, "group-1", demoted!.duties)).toBe("notFound");
  });

  it("takes no role parameter at all, so a caller cannot supply one", () => {
    // The structural half of the same rule. A signature that accepted a role
    // would let a surface pass `session.user.role` and re-open exactly the
    // hole the re-read closes.
    const from = MANAGE.indexOf("export async function moderationAuthority(");
    // The PARAMETER LIST only — up to the closing paren before the return
    // type. A wider slice reaches into the body, where `role: users.role` is
    // the projection this function exists to read.
    const params = MANAGE.slice(from, MANAGE.indexOf("): Promise", from));
    expect(params).toContain("actorId: string");
    expect(params).not.toMatch(/role\s*:/);
    expect(params).not.toMatch(/session/);
  });

  it("is what every act calls before doing anything", () => {
    for (const fn of ["removePostAsModerator", "setDiscussionLocked"]) {
      const body = MANAGE.slice(MANAGE.indexOf(`export async function ${fn}(`));
      const end = body.indexOf("\nexport ");
      const scoped = end > -1 ? body.slice(0, end) : body;
      expect(scoped, `${fn} re-reads the authority`).toContain(
        "requireModerator(",
      );
      expect(scoped, `${fn} does not read a session`).not.toContain("session");
    }
  });
});

// ── The trail cannot be rewritten ──────────────────────────────────────────

describe("the audit trail is append-only", () => {
  it("is never deleted from, anywhere in the module", () => {
    // Rows leave by the prune command's age window and by nothing else. A
    // delete path in the module would be a way for a moderator's act to
    // disappear at the moment it became interesting.
    expect(MANAGE).not.toContain("delete(communityModerationAudit");
  });

  it("has exactly ONE update, and it erases a sentence rather than revising an act", () => {
    // ⚠️ **The one exception, and it is narrow enough to state in a sentence.**
    // When a member deletes their account, the free text a moderator wrote
    // ABOUT them is theirs and goes — the `grants[].note` category. Who acted,
    // what they did and when stays: a trail that emptied itself on an erasure
    // request would be a trail with a way to erase yourself from it, and one
    // that kept the sentence would be an erasure answered with "not that bit".
    //
    // Both halves are asserted, because either alone would let the exception
    // grow: that there is only one update, and that it lives in the scrub and
    // sets only `reason`.
    const updates = [...MANAGE.matchAll(/update\(communityModerationAudit\)/g)];
    expect(
      updates,
      "one update, and it is the account-deletion scrub. A second one is a " +
        "revision path, whatever it is called",
    ).toHaveLength(1);

    const scrub = MANAGE.slice(
      MANAGE.indexOf("export async function scrubCommunityContentFor("),
    );
    const end = scrub.indexOf("\nexport ");
    const scoped = end > -1 ? scrub.slice(0, end) : scrub;
    expect(
      scoped,
      "the one update belongs to the account-deletion scrub",
    ).toContain("update(communityModerationAudit)");

    // Only the sentence, and only where this member is the TARGET.
    const statement = scoped.slice(
      scoped.indexOf("update(communityModerationAudit)"),
    );
    expect(statement.slice(0, 400)).toContain("set({ reason: null })");
    expect(statement.slice(0, 400)).toContain("targetMemberId");
    expect(statement.slice(0, 400)).not.toContain("act:");
    expect(statement.slice(0, 400)).not.toContain("actorId");
  });

  it("appends, and does so inside the act's own transaction", () => {
    // Non-vacuity AND the real property: an act whose record failed to save
    // would be a moderation decision nobody can review, so the two succeed
    // together or neither does.
    const inserts = MANAGE.match(/insert\(communityModerationAudit\)/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);

    for (const fn of ["removePostAsModerator", "setDiscussionLocked"]) {
      const body = MANAGE.slice(MANAGE.indexOf(`export async function ${fn}(`));
      const end = body.indexOf("\nexport ");
      const scoped = end > -1 ? body.slice(0, end) : body;
      const transaction = scoped.indexOf("db.transaction(");
      const audit = scoped.indexOf("insert(communityModerationAudit)");
      expect(transaction, `${fn} opens a transaction`).toBeGreaterThan(-1);
      expect(audit, `${fn} writes its record inside it`).toBeGreaterThan(
        transaction,
      );
    }
  });

  it("writes a SEPARATE row for an unlock", () => {
    // Not an edit of the lock's row, and never will be: "this was locked on
    // Tuesday and opened on Thursday" is two facts, and a trail recording only
    // the current state answers "was this ever closed?" with silence.
    const body = MANAGE.slice(
      MANAGE.indexOf("export async function setDiscussionLocked("),
    );
    expect(body).toContain('"lockDiscussion" : "unlockDiscussion"');
  });
});

// ── A report is a frozen fact ──────────────────────────────────────────────
//
// AD-71, and the most counter-intuitive decision in the module: everything
// else derives access at read time, and this deliberately does not. A report
// is an EVENT — "an eligible member said this was spam on Tuesday" does not
// stop being true on Wednesday — and if it did, a spammer could clear the
// reports against them by getting the reporters' access revoked, or, more
// ordinarily, reports would evaporate whenever somebody's subscription lapsed.

const REPORTS_BLOCK = MANAGE.slice(
  MANAGE.indexOf("export async function reportContent("),
);

describe("a spam report is decided once and then frozen", () => {
  it("checks eligibility BEFORE the insert and nowhere after", () => {
    const insert = REPORTS_BLOCK.indexOf("insert(communitySpamReports)");
    const check = REPORTS_BLOCK.indexOf("reportProblem(");
    expect(check, "the core decides").toBeGreaterThan(-1);
    expect(insert, "and then the row is written").toBeGreaterThan(check);
  });

  it("denormalizes the reported member instead of joining for them later", () => {
    // ⚠️ The reason this matters: a join at read time would follow the
    // content's author column, which goes NULL when that account is deleted —
    // and the send-block derived from these rows would quietly stop existing
    // at the moment it mattered most.
    expect(REPORTS_BLOCK).toContain("reportedMemberId,");
    const values = REPORTS_BLOCK.slice(
      REPORTS_BLOCK.indexOf("insert(communitySpamReports)"),
    ).slice(0, 500);
    expect(values).toContain("reportedMemberId");
  });

  it("has no reader that re-derives eligibility", () => {
    // The queue and the threshold read by `consumedAt`, never by asking again
    // whether the reporter could still see the content. A single call to the
    // access derivation anywhere below the insert would be the drift this AD
    // exists to prevent.
    const afterInsert = REPORTS_BLOCK.slice(
      REPORTS_BLOCK.indexOf("export async function openReports("),
    );
    expect(afterInsert).not.toContain("discussionForViewer(");
    expect(afterInsert).not.toContain("accessibleGroupIds(");
    expect(afterInsert).not.toContain("reportProblem(");
  });

  it("absorbs a duplicate instead of refusing it", () => {
    // The partial unique indexes decide it. A member tapping twice is not
    // doing anything wrong, and an error would tell them their first tap
    // failed.
    const insert = REPORTS_BLOCK.slice(
      REPORTS_BLOCK.indexOf("insert(communitySpamReports)"),
    ).slice(0, 700);
    expect(insert).toContain("onConflictDoNothing()");
  });

  it("bounds the attached window against the CONFIG, not the form", () => {
    // Every attached message is a message a moderator gets to read out of
    // somebody's private conversation, so the bound cannot come from the
    // request.
    expect(REPORTS_BLOCK).toContain("communityConfig().report.attachmentMax");
  });
});

// ── The bounded window (AD-71) ─────────────────────────────────────────────
//
// 🚨 The one place in this app where somebody who is not a participant reads a
// private message. Every part of its shape is a bound, and each is asserted
// rather than argued.

describe("windowMessageIds", () => {
  it("always carries the reported message, first", () => {
    expect(
      windowMessageIds({
        reportedId: "m1",
        attached: [],
        sameConversation: [],
        max: 5,
      }),
    ).toEqual(["m1"]);
  });

  it("drops an id from another conversation, silently", () => {
    // ⚠️ Dropped, not refused. A refusal would tell the reporter whether that
    // other id exists — which is the one thing they must not learn by probing
    // a form.
    expect(
      windowMessageIds({
        reportedId: "m1",
        attached: ["m2", "SMUGGLED", "m3"],
        sameConversation: ["m2", "m3"],
        max: 5,
      }),
    ).toEqual(["m1", "m2", "m3"]);
  });

  it("cuts to the configured maximum", () => {
    const attached = ["a", "b", "c", "d", "e", "f", "g"];
    const window = windowMessageIds({
      reportedId: "m1",
      attached,
      sameConversation: attached,
      max: 3,
    });
    // The reported message plus three, never more — every extra id is another
    // message a moderator gets to read out of somebody's conversation.
    expect(window).toHaveLength(4);
    expect(window[0]).toBe("m1");
  });

  it("never repeats the reported message or an id twice", () => {
    expect(
      windowMessageIds({
        reportedId: "m1",
        attached: ["m1", "m2", "m2"],
        sameConversation: ["m1", "m2"],
        max: 5,
      }),
    ).toEqual(["m1", "m2"]);
  });
});

describe("the queue reads the window by id, never the conversation", () => {
  const READER = MANAGE.slice(
    MANAGE.indexOf("export async function reportedMessagesFor("),
  ).slice(0, 2500);

  it("selects by an explicit id list and re-checks the conversation", () => {
    // Both halves. The id list is the bound; the conversation check is what
    // makes a smuggled id on the report ROW render nothing — the row is data,
    // and data is not a permission.
    expect(READER).toContain("inArray(communityMessages.id, ids)");
    expect(READER).toContain("eq(communityMessages.conversationId");
  });

  it("uses no participant-scoped conversation reader, and no cursor", () => {
    // A conversation-scoped query here would be a moderator reading a
    // conversation, which is precisely what AD-59 says does not exist.
    expect(READER).not.toContain("conversationForParticipant(");
    expect(READER).not.toContain("listMessages(");
    expect(READER).not.toContain("cursor");
  });

  it("re-reads the authority first", () => {
    // ⚠️ Written as an ORDERING rather than as `slice(0, 400)`, which is what it
    // used to be. That window measured characters, and the comment blanker now
    // leaves spaces where it used to delete text (`scripts/lib/source-text.mjs`
    // says why: line numbers have to survive), so a fixed-width window silently
    // moved past the call. The claim was never about 400 characters anyway — it
    // is that the authority is re-read BEFORE anything is looked up.
    const authority = READER.indexOf("requireModerator(");
    // `await db` and not `db.` — the queries here are written `await db\n
    // .select(…)`, so the dot is on the next line. Measured: `db.` matched
    // nothing and the probe below is what said so.
    const firstQuery = READER.indexOf("await db");
    expect(authority, "reportedMessagesFor does not call requireModerator at all").toBeGreaterThan(-1);
    expect(firstQuery, "no query in the window — the slice no longer covers the body").toBeGreaterThan(-1);
    expect(
      authority,
      "the authority is re-read after the first query. A JWT carries the role " +
        "somebody had when they signed in, so it is read from the database at the " +
        "moment of the act — and the act starts here.",
    ).toBeLessThan(firstQuery);
  });
});

describe("the visibility event is recorded with the report", () => {
  /**
   * `reportContent` from its signature to the END of the function.
   *
   * ⚠️ This was `.slice(0, 6000)` and broke without anything about the code
   * changing: the comment blanker now leaves spaces where it used to delete text
   * (`scripts/lib/source-text.mjs` says why — reported line numbers have to
   * survive), so the same 6000 characters no longer reach the same code and
   * `exposedMessageIds: window` fell outside the window.
   *
   * The fix is the one `scripts/modules/data-gate.test.ts` already writes down
   * for its own slices: end at the next top-level declaration, because "a
   * character count that happens to fit today is a test that breaks on the next
   * edit for no reason anybody can read".
   *
   * ℹ️ Eleven other fixed-width slices in this file still pass and are left
   * alone — widening a window that measures the right thing today is churn, and
   * if one of them ever shifts, the failure names this file and its line.
   */
  const REPORT = (() => {
    const start = MANAGE.indexOf("export async function reportContent(");
    expect(start, "reportContent is gone from manage.ts").toBeGreaterThan(-1);
    const body = MANAGE.slice(start + "export async function reportContent(".length);
    const end = body.search(/\nexport (?:async )?function /);
    return body.slice(0, end === -1 ? undefined : end);
  })();

  it("writes a dmVisibility act inside the report's own transaction", () => {
    // A report that granted sight of part of a private conversation WITHOUT
    // its record cannot exist — that is AD-71's accountability half.
    const transaction = REPORT.indexOf("db.transaction(");
    const audit = REPORT.indexOf('act: "dmVisibility"');
    expect(transaction).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(transaction);
  });

  it("records the exact ids that became visible", () => {
    // Whitespace-tolerant: a comment sits between the key and the value, and the
    // blanker leaves spaces where it used to delete them. An assertion that
    // depended on two lines becoming adjacent was measuring the formatting.
    expect(REPORT).toMatch(/exposedMessageIds:\s*window/);
  });

  it("names the REPORTER as the actor", () => {
    // They are the one who decided to show it. A moderator reading the queue
    // later was shown what somebody handed them, which is a different fact.
    const audit = REPORT.slice(REPORT.indexOf('act: "dmVisibility"') - 200);
    expect(audit.slice(0, 400)).toContain("actorId: input.reporterId");
  });
});

describe("the deferred scrub completes on consumption", () => {
  const CONSUME = MANAGE.slice(
    MANAGE.indexOf("export async function consumeReport("),
  ).slice(0, 4000);

  it("finishes the author's deletion inside the consuming transaction", () => {
    expect(CONSUME).toContain("completeDeferredScrub(");
    const transaction = CONSUME.indexOf("db.transaction(");
    const scrub = CONSUME.indexOf("completeDeferredScrub(");
    expect(scrub).toBeGreaterThan(transaction);
  });

  it("only finishes an AUTHOR's own deletion, and only when no report is left", () => {
    const fn = MANAGE.slice(MANAGE.indexOf("async function completeDeferredScrub("));
    // A moderator's removal keeps its words for the reason it always did, and
    // a live post is not being deleted at all.
    expect(fn).toContain('post.deletedBy !== "author"');
    // …and the last-report check, in the same transaction, so two moderators
    // consuming the last two reports at once cannot each decide the other one
    // still needs the words.
    expect(fn).toContain("isNull(communitySpamReports.consumedAt)");
    expect(fn).toContain("ne(communitySpamReports.id, report.id)");
  });
});

// ── The automatic send-block (AD-64) ───────────────────────────────────────
//
// 🚨 **There is no send-block table, and these tests are half of what keeps it
// that way.** The block IS `sendBlockState()` over the unconsumed report rows,
// which is what makes it lift itself when they age out and what makes one tap
// enough to clear it. A stored boolean would need a job to clear, and a job
// nobody runs is a member silenced for ever by five taps.

const NOW = new Date("2026-08-06T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

function reports(...rows: Array<[string, number] | [string, number, Date]>) {
  return rows.map(([reporterId, hours, consumedAt]) => ({
    reporterId,
    createdAt: hoursAgo(hours),
    consumedAt: (consumedAt as Date | undefined) ?? null,
  }));
}

const BASE = { threshold: 5, windowHours: 24, expiryDays: null, now: NOW };

describe("sendBlockState", () => {
  it("blocks at the threshold and not below it", () => {
    const four = reports(["a", 1], ["b", 2], ["c", 3], ["d", 4]);
    expect(
      sendBlockState({ ...BASE, role: "member", reports: four }).blocked,
    ).toBe(false);

    const five = [...four, ...reports(["e", 5])];
    const state = sendBlockState({ ...BASE, role: "member", reports: five });
    expect(state.blocked).toBe(true);
    expect(state.reporterIds).toHaveLength(5);
  });

  it("counts DISTINCT reporters, so one member cannot block anybody alone", () => {
    const spammed = reports(["a", 1], ["a", 2], ["a", 3], ["a", 4], ["a", 5]);
    expect(
      sendBlockState({ ...BASE, role: "member", reports: spammed }).blocked,
    ).toBe(false);
  });

  it("ignores reports a moderator has already judged", () => {
    // Consuming is how the lift works, so a consumed row counting would make
    // the lift do nothing.
    const judged = reports(
      ["a", 1, NOW],
      ["b", 2, NOW],
      ["c", 3, NOW],
      ["d", 4, NOW],
      ["e", 5, NOW],
    );
    expect(
      sendBlockState({ ...BASE, role: "member", reports: judged }).blocked,
    ).toBe(false);
  });

  it("lifts itself as reports age out of the window", () => {
    // ⚠️ This is the property a stored boolean could not have. A slow trickle
    // of complaints over a year is a moderation question, not a spam wave.
    const aging = reports(["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 25]);
    expect(
      sendBlockState({ ...BASE, role: "member", reports: aging }).blocked,
    ).toBe(false);
  });

  it("dates the crossing at the report that reached the threshold", () => {
    const five = reports(["a", 10], ["b", 9], ["c", 8], ["d", 7], ["e", 6]);
    const state = sendBlockState({ ...BASE, role: "member", reports: five });
    // Six hours ago — the fifth distinct one, not the first and not the last.
    expect(state.since?.toISOString()).toBe(hoursAgo(6).toISOString());
  });

  it("never blocks a role-holder", () => {
    // A community that can silence its own moderators by five taps has handed
    // its moderation to whoever organises fastest.
    const five = reports(["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]);
    for (const role of ["owner", "moderator"]) {
      expect(
        sendBlockState({ ...BASE, role, reports: five }).blocked,
        role,
      ).toBe(false);
    }
  });

  it("honours an expiry term when one is configured — and ships without one", () => {
    const five = reports(["a", 20], ["b", 20], ["c", 20], ["d", 20], ["e", 20]);
    // Shipped: null. The block stands.
    expect(
      sendBlockState({ ...BASE, role: "member", reports: five }).blocked,
    ).toBe(true);
    // With a term shorter than the age of the crossing, it has expired.
    expect(
      sendBlockState({
        ...BASE,
        role: "member",
        reports: five,
        windowHours: 24 * 30,
        expiryDays: 1,
        now: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000),
      }).blocked,
    ).toBe(false);
  });
});

describe("communityConflictOfInterest", () => {
  it("refuses a moderator who is among the counted reporters", () => {
    expect(
      conflictOfInterest({ id: "mod", role: "moderator" }, ["a", "mod"]),
    ).toBe("communityConflictOfInterest");
    expect(
      conflictOfInterest({ id: "mod", role: "moderator" }, ["a", "b"]),
    ).toBeNull();
  });

  it("never conflicts the operator out", () => {
    // Somebody must always be able to act. The operator answers for the app
    // and is the end of every escalation; leaving them conflicted would mean a
    // block nobody in the installation can lift.
    expect(conflictOfInterest({ id: "own", role: "owner" }, ["own"])).toBeNull();
  });
});

describe("no act, no trail row", () => {
  // ⚠️ **All three moderation acts wrote their audit row unconditionally**,
  // and their comments said the opposite. The pattern is the same each time:
  // the state is read outside the transaction, the pure core decides on that
  // copy, and by the time the write runs the copy can be stale — so the row
  // records something that did not happen. `lockProblem()`'s own reasoning is
  // the sentence this describe block exists for: "a trail with rows for acts
  // that changed nothing is a trail nobody trusts."

  it("removes a post only while it is still undeleted, and refuses otherwise", () => {
    const fn = MANAGE.slice(
      MANAGE.indexOf("export async function removePostAsModerator("),
      MANAGE.indexOf("export async function removePostAsModerator(") + 3000,
    );
    // The clause was always there; what was missing is that anybody looked at
    // whether it matched. An author deleting their own post in the gap used to
    // leave a MODERATOR's removal reason in the trail — and that reason travels
    // into both subject-access exports, so the member is handed it.
    expect(fn).toContain("isNull(communityPosts.deletedAt)");
    expect(fn).toContain(".returning({ id: communityPosts.id })");
    expect(fn).toContain("if (removed.length === 0)");
    expect(fn).toContain('throw new CommunityError("communityAlreadyDeleted")');
    // The refusal has to come BEFORE the row is written.
    expect(fn.indexOf('throw new CommunityError("communityAlreadyDeleted")')).toBeLessThan(
      fn.indexOf('act: "removePost"'),
    );
  });

  it("moves a lock only when the state is what the act expects", () => {
    const fn = MANAGE.slice(
      MANAGE.indexOf("export async function setDiscussionLocked("),
      MANAGE.indexOf("export async function setDiscussionLocked(") + 3000,
    );
    // The UPDATE used to be keyed on the id alone, so two moderators locking
    // the same thread both wrote: one lock, two rows, and the second write
    // moved the first one's timestamp.
    expect(fn).toContain("isNull(communityDiscussions.lockedAt)");
    expect(fn).toContain("isNotNull(communityDiscussions.lockedAt)");
    // The GUARD, not only the sentence it throws: `if (false) { …same throw… }`
    // leaves every string in place, and a test that only looks for strings
    // stays green beside it. Measured on this very test.
    expect(fn).toContain("if (moved.length === 0) {");
    expect(fn).toContain('throw new CommunityError(input.locked ? "communityAlreadyLocked" : "communityNotLocked")');
    expect(
      fn.indexOf("throw new CommunityError(input.locked"),
    ).toBeLessThan(fn.indexOf('act: input.locked ? "lockDiscussion"'));
  });
});

describe("the report queue is scoped by duty, like every other act", () => {
  // ⚠️ **`null` meant two different things at the two ends of one call.**
  // `mayModerate(actor, null, duties)` is the GROUP-LESS case and its answer is
  // a recorded decision (FR-206; Story 23.3 reuses it for DM reports on
  // purpose). The three report functions passed `null` unconditionally, which
  // silently turned that decision into "duty scoping does not apply to reports
  // at all" — so a moderator of the free welcome room could open a post
  // reported inside a plan-gated course. Found by the inherited-form sweep,
  // 2026-08-07.

  it("keeps the group-less answer for content that really has no room", () => {
    // A DM belongs to no conversation-room, and an embedded discussion hangs
    // off a page. Both keep the decided scope, and this is the behaviour the
    // fix must NOT change.
    const mod = { role: "moderator", blockedAt: null };
    expect(mayModerate(mod, null, ["room-a"])).toBeNull();
    expect(mayModerate(mod, null, [])).toBe("notFound");
    expect(mayModerate({ role: "owner", blockedAt: null }, null, [])).toBeNull();
  });

  it("refuses a room the moderator holds no duty for", () => {
    const mod = { role: "moderator", blockedAt: null };
    expect(mayModerate(mod, "paid-course", ["welcome"])).toBe("notFound");
    expect(mayModerate(mod, "welcome", ["welcome"])).toBeNull();
  });

  it("asks the report's own room, and no reader passes a bare null any more", () => {
    // Asserted as an ABSENCE as well as a presence: the defect was a literal
    // `null` argument, so a test that only checked for `roomOfReport(` would
    // still pass beside a forgotten call site.
    for (const fn of [
      "export async function reportedPostFor(",
      "export async function reportedMessagesFor(",
      "export async function consumeReport(",
    ]) {
      const body = MANAGE.slice(MANAGE.indexOf(fn), MANAGE.indexOf(fn) + 2000);
      expect(body, `${fn} must scope by the report's room`).toContain(
        "roomOfReport(",
      );
      expect(body, `${fn} still passes a bare null as the room`).not.toContain(
        "requireModerator(actorId, null)",
      );
    }
  });

  it("lists only what the moderator may act on", () => {
    const body = MANAGE.slice(
      MANAGE.indexOf("export async function openReports("),
      MANAGE.indexOf("export async function openReports(") + 3000,
    );
    // The queue joins through to the discussion's room and filters on the
    // actor's duties — a row whose detail page would refuse has no business in
    // the list.
    expect(body).toContain("inArray(communityDiscussions.groupId, authority.duties)");
    // …and group-less rows stay in, which is the decided half.
    expect(body).toContain("isNull(communityDiscussions.groupId)");
  });
});

describe("mayConsumeReport — the other half of the shipped promise", () => {
  // ⚠️ **`CLAUDE.md`, `docs/community.md` and `liftBlockAction` all say
  // "Nobody acts on a report they filed or on a block their own reports
  // counted towards". Until 2026-08-07 only the second half was built.**
  // `consumeReport()` checked that the actor was a moderator and nothing else —
  // its query did not even fetch `reporterId`. These tests are the first half.
  const NO_BLOCK = { blocked: false as const, reporterIds: [] };

  it("refuses a moderator their own report", () => {
    expect(
      mayConsumeReport(
        { id: "mod", role: "moderator" },
        { reporterId: "mod" },
        NO_BLOCK,
      ),
    ).toBe("communityConflictOfInterest");
    expect(
      mayConsumeReport(
        { id: "mod", role: "moderator" },
        { reporterId: "someone" },
        NO_BLOCK,
      ),
    ).toBeNull();
  });

  it("refuses SOMEBODY ELSE'S report when it counts towards a block they are conflicted on", () => {
    // 🚨 This is the hole, and it does not need their own report at all. A
    // send-block is derived from UNCONSUMED reports, so consuming enough of
    // them dissolves it: with a threshold of five and five counted reporters, a
    // conflicted moderator consumes the four belonging to other people, the
    // distinct count falls to one, and the block is gone — the exact act
    // `liftSendBlock()` refuses them, reached by a different button.
    const block = { blocked: true as const, reporterIds: ["a", "b", "mod"] };
    expect(
      mayConsumeReport(
        { id: "mod", role: "moderator" },
        { reporterId: "a" },
        block,
      ),
    ).toBe("communityConflictOfInterest");
  });

  it("lets an unconflicted moderator act on a standing block", () => {
    const block = { blocked: true as const, reporterIds: ["a", "b"] };
    expect(
      mayConsumeReport(
        { id: "mod", role: "moderator" },
        { reporterId: "a" },
        block,
      ),
    ).toBeNull();
  });

  it("never conflicts the operator out", () => {
    // Same reasoning as `communityConflictOfInterest` above: somebody must always be
    // able to act, or a queue can reach a state nobody in the installation can
    // clear.
    const block = { blocked: true as const, reporterIds: ["own"] };
    expect(
      mayConsumeReport({ id: "own", role: "owner" }, { reporterId: "own" }, block),
    ).toBeNull();
  });

  it("is the refusal `consumeReport` actually makes, and it reads the block fresh", () => {
    const consume = MANAGE.slice(
      MANAGE.indexOf("export async function consumeReport("),
    );
    // The report's reporter has to be fetched at all — it was not, and that is
    // how the first half of the promise went missing without anybody noticing.
    expect(consume).toContain("reporterId: communitySpamReports.reporterId");
    expect(consume).toContain("mayConsumeReport(");
    // Derived from the database on the act, never taken from the request: a
    // disabled button is not a permission.
    expect(consume).toContain("await sendBlockFor(");
  });
});

describe("the block is derived and recorded, never stored", () => {
  it("has no table and no column", () => {
    // 🚨 AD-64, asserted where somebody would go looking. A schema that grew a
    // `sendBlockedAt` would make the lift a second thing to keep in step, and
    // the self-lifting property would quietly disappear.
    const schema = withoutComments(
      readFileSync(join(ROOT, "modules/community/schema.ts"), "utf8"),
    );
    expect(schema).not.toMatch(/sendBlock/i);
    expect(schema).not.toContain("send_block");
  });

  it("records the CROSSING, and only when the state changes", () => {
    const report = MANAGE.slice(
      MANAGE.indexOf("export async function reportContent("),
    );
    expect(report).toContain('act: "sendBlockFallen"');
    // The before/after comparison inside the transaction: a second report
    // while the block already stands appends nothing.
    expect(report).toContain("state.blocked && !before.blocked");
  });

  it("serialises two racing reports on a row they can BOTH see", () => {
    // ⚠️ **This test used to assert the string `.for("update")` and call that
    // the protection.** It was not one, and the test being green is how the
    // claim survived: `FOR UPDATE` locks the rows in its own statement's
    // snapshot, and under READ COMMITTED each racing transaction has already
    // inserted a report the other cannot see. Neither counted the other. With
    // four existing reporters and two arriving at once the crossing was
    // recorded TWICE; with three, it was recorded not at all while the member
    // was silenced anyway — and both questions the block exists to answer then
    // have no answer.
    //
    // The fix is a lock on the TARGET's `users` row, which existed before
    // either transaction started, so the second one waits and then re-reads.
    // What this test can check without a database is the ORDER of the two
    // statements, and it says so rather than implying more: the lock has to be
    // taken BEFORE the counting select, or it serialises nothing.
    const report = MANAGE.slice(
      MANAGE.indexOf("export async function reportContent("),
    );
    // ⚠️ The whole sequence, not a fragment of it. This function reads `users`
    // twice before here — once for the REPORTER's role, once for the TARGET's —
    // so both `\`.from(users)\`` and `\`eq(users.id, reportedMemberId)\`` match
    // something earlier and pass while the lock itself is gone. Measured: two
    // earlier versions of this assertion did exactly that.
    const lock = report.indexOf(
      '.where(eq(users.id, reportedMemberId))\n        .for("update");',
    );
    const counting = report.indexOf(".from(communitySpamReports)\n        .where(eq(communitySpamReports.reportedMemberId");

    expect(
      lock,
      "the target's row is not locked — a read is not a lock",
    ).toBeGreaterThan(-1);
    expect(counting, "the counting select moved — re-read this test").toBeGreaterThan(-1);
    expect(
      lock,
      "the lock on the target must come BEFORE the count, or two racing " +
        "reports still cannot see each other",
    ).toBeLessThan(counting);
  });

  it("credits nobody with an automatic act", () => {
    // An audit row with a moderator's name on a threshold would be a person
    // credited with arithmetic.
    const report = MANAGE.slice(MANAGE.indexOf('act: "sendBlockFallen"') - 300);
    expect(report.slice(0, 400)).toContain("actorId: null");
  });

  it("lifts by CONSUMING every counted report", () => {
    const lift = MANAGE.slice(
      MANAGE.indexOf("export async function liftSendBlock("),
    ).slice(0, 2000);
    expect(lift).toContain("set({ consumedAt:");
    expect(lift).toContain('act: "blockLifted"');
    // Which is also why the judged set cannot re-trigger: it is consumed.
    expect(lift).toContain("isNull(communitySpamReports.consumedAt)");
  });

  it("guards every WRITE path and no read path", () => {
    const guards = MANAGE.match(/guardSendBlock\(/g) ?? [];
    // The definition plus the four send paths: start a thread, reply, reply in
    // an embed, send a private message.
    expect(guards.length).toBeGreaterThanOrEqual(5);

    // Blocked means silenced, never blinded — no reader asks.
    for (const reader of [
      "export async function postsFor(",
      "export async function listMessages(",
      "export async function feedFor(",
      "export async function discussionsFor(",
    ]) {
      const body = MANAGE.slice(MANAGE.indexOf(reader));
      const end = body.indexOf("\nexport ");
      expect(
        end > -1 ? body.slice(0, end) : body,
        `${reader} must not ask the send-block — reading is untouched`,
      ).not.toContain("guardSendBlock(");
    }
  });
});
