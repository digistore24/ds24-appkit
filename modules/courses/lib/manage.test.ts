// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the hand-in's write STATEMENT says.
//
// 🚨 **The claim here is not about a return value, it is about the SQL that
// leaves this process.** `../pages/actions.ts` already refuses a frozen row and
// already takes the account from the session — and both decisions are held a
// second time inside the statement, which is exactly the half no behavioural
// test can see: an action that lost either would still return the right thing in
// every case a mock could set up, and would write the wrong row in the one case
// that matters (two requests arriving together, or a caller added later that
// skips the action entirely).
//
// So the database is replaced by `drizzle-orm/pg-proxy` — a REAL Drizzle
// instance whose driver is a function. Nothing about the query building is
// faked: what is asserted below is the string Postgres would have received. Not
// the whole string, though — a hand-written copy of it would be a second version
// of the statement agreeing with the first by hand, and would have to be edited
// every time a column moved. What is pinned is the three clauses that carry the
// security argument, and nothing else.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  sql: string;
  params: unknown[];
}

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const captured: Captured[] = [];
  // What the driver hands back, per test. `rows` is Drizzle's array-of-values
  // shape, so `[["id-1"]]` is one row for a `.returning({ id })`.
  const state = { rows: [] as unknown[][] };
  const db = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    return { rows: state.rows };
  });
  return { db, __captured: captured, __state: state };
});

import * as dbModule from "@/db";

import {
  answeredSubmissions,
  replyToSubmission,
  submissionById,
  unitsWithMedia,
  upsertSubmission,
  waitingCount,
  waitingSubmissions,
} from "./manage";

const { __captured: captured, __state: state } = dbModule as unknown as {
  __captured: Captured[];
  __state: { rows: unknown[][] };
};

/** Run the write and hand back the one statement it produced. */
async function statementOf(
  memberId = "member-1",
  slug = "woche-1",
  body = "what I noticed",
): Promise<Captured> {
  const written = await upsertSubmission(memberId, slug, body);
  // Non-vacuity, on every single case below: a call that never reached the
  // driver would otherwise make every claim in this file pass by finding
  // nothing to look at.
  expect(captured, "upsertSubmission() sent no statement at all").toHaveLength(1);
  expect(typeof written).toBe("boolean");
  return captured[0];
}

beforeEach(() => {
  captured.length = 0;
  state.rows = [];
});

describe("storing a member's hand-in", () => {
  it("is ONE statement, and it is an upsert", async () => {
    const { sql } = await statementOf();
    expect(sql).toContain('insert into "courses_submissions"');
    // The unique index is what makes handing in an upsert rather than an insert
    // — one row per member per lesson, revised until somebody replies.
    expect(sql).toMatch(/on conflict \("member_id","unit_slug"\) do update set/);
  });

  it("🚨 the do-update refuses a row somebody has already answered", async () => {
    // Half two of "an answered hand-in is frozen". Half one is the action's
    // check (`../pages/actions.ts`, exercised in `../pages/actions.test.ts`);
    // this one is what stands between two requests arriving while a coach is
    // answering. Without it the later request overwrites the answered text and
    // the reply becomes an answer to something nobody wrote.
    const { sql } = await statementOf();
    expect(
      sql,
      "the do-update lost `replied_at is null`. An upsert matching no row still " +
        "SUCCEEDS, so without this condition a hand-in that has been answered is " +
        "silently replaced — and the reply then answers a text that is gone.",
    ).toMatch(/"courses_submissions"\."replied_at" is null/);
  });

  it("🚨 the do-update names the member, so it can never reach another one", async () => {
    const { sql } = await statementOf();
    expect(
      sql,
      "the do-update lost `member_id`. The account is the session's own and the " +
        "action takes no member id at all — carrying it into the statement is what " +
        "makes a caller who lost that guarantee write NOTHING rather than somebody " +
        "else's row.",
    ).toMatch(/"courses_submissions"\."member_id" = \$\d+/);
  });

  it("carries the member id into the values as well as the condition", async () => {
    const { params } = await statementOf("member-42", "woche-3", "text");
    expect(params).toContain("member-42");
    expect(params).toContain("woche-3");
    expect(params).toContain("text");
  });

  it("🚨 moves submitted_at on a revision", async () => {
    // `defaultNow()` fires on the INSERT branch only. Without this the revision
    // keeps the first date, and the page tells somebody their new text arrived
    // last week — a clean 200 with a wrong sentence on it.
    const { sql } = await statementOf("member-1", "woche-1", "the second version");
    expect(sql).toMatch(/do update set "body" = \$\d+, "submitted_at" = \$\d+/);
  });

  it("does not write the reply columns", async () => {
    // A member's write may never touch what a person wrote back, nor who wrote
    // it. `repliedBy` in particular is a third party's identity and is out of
    // both Art. 15 exports by decision (`../privacy/sections.ts`).
    const { sql } = await statementOf();
    const set = sql.slice(sql.indexOf("do update set"));
    expect(set).not.toContain('"reply" =');
    expect(set).not.toContain('"replied_at" =');
    expect(set).not.toContain('"replied_by" =');
  });

  it("🚨 answers false when the statement hit no row", async () => {
    // An upsert that matches nothing succeeds. A function returning nothing
    // would hand that silence back as a save; this is why it returns a boolean
    // and why the action turns `false` into `coursesAlreadyReplied`.
    state.rows = [];
    expect(await upsertSubmission("member-1", "woche-1", "text")).toBe(false);

    state.rows = [["submission-1"]];
    expect(await upsertSubmission("member-1", "woche-1", "text")).toBe(true);
  });
});

/** Run one read and hand back the single statement it produced. */
async function readStatement(run: () => Promise<unknown>): Promise<Captured> {
  await run();
  expect(captured, "the read sent no statement at all").toHaveLength(1);
  return captured[0];
}

describe("the operator's waiting list", () => {
  it("🚨 narrows in the QUERY, and orders oldest first", async () => {
    // "A page that fetched everything and rendered a subset would have shipped
    // the rest in its own payload" (modules/community/pages/moderation/page.tsx).
    const { sql } = await readStatement(() => waitingSubmissions());
    expect(sql).toContain('from "courses_submissions"');
    expect(sql).toMatch(/where "courses_submissions"\."replied_at" is null/);
    expect(sql).toMatch(/order by .*"submitted_at" asc/);
    expect(sql).not.toContain("desc");
  });

  it("🚨 keeps replied_at in the ORDER BY, which is what the index answers", async () => {
    // Not redundancy. `courses_submissions_waiting` is a btree on
    // `(replied_at, submitted_at)`; an ordered index scan is possible exactly
    // while the requested order is a PREFIX of the index's own. Ordering by
    // `submitted_at` alone asks for something the index does not offer as a
    // prefix, and the plan becomes a Sort over the whole table — the index
    // built for this list going unused. Every row here has `replied_at` null,
    // so the first key changes nothing about the result and everything about
    // the plan. The measured EXPLAIN is in the story's debug log.
    const { sql } = await readStatement(() => waitingSubmissions());
    expect(
      sql,
      "the waiting list stopped ordering by replied_at. That is the half that " +
        "makes courses_submissions_waiting usable — without it Postgres sorts.",
    ).toMatch(/order by "courses_submissions"\."replied_at" asc, "courses_submissions"\."submitted_at" asc/);
  });

  it("🚨 does not select the member's text", async () => {
    // The queue says something is waiting and who from. Reading what a person
    // wrote is one row at a time on the detail page — a list of fifty bodies is
    // fifty pieces of private writing in one payload to render three lines of
    // each.
    const { sql } = await readStatement(() => waitingSubmissions());
    const select = sql.slice(0, sql.indexOf(" from "));
    expect(select).not.toContain('"body"');
    expect(select).not.toContain('"reply"');
  });

  it("names the learner without a second query per row", async () => {
    // `learnerLabel()` takes VALUES, so fifty rows resolve fifty names in one
    // statement rather than fifty.
    const { sql } = await readStatement(() => waitingSubmissions());
    expect(sql).toMatch(/left join "users"/);
    expect(sql).toMatch(/left join "courses_units"/);
  });

  it("takes a ceiling, and no filter of any kind", async () => {
    const { sql, params } = await readStatement(() => waitingSubmissions(7));
    expect(sql).toMatch(/limit \$\d+/);
    expect(params).toContain(7);
    // No search, no member, no lesson — the statement holds nothing but the
    // one condition, and `no-roster.test.ts` holds the rest of that claim.
    expect(sql.slice(sql.indexOf(" where "))).not.toContain("member_id");
  });

  it("counts what is waiting with the same condition it lists by", async () => {
    const { sql } = await readStatement(() => waitingCount());
    expect(sql).toMatch(/select count\(\*\)/);
    expect(sql).toMatch(/where "courses_submissions"\."replied_at" is null/);
  });
});

describe("the operator's answered list", () => {
  it("reads the same index backwards and is capped", async () => {
    const { sql, params } = await readStatement(() => answeredSubmissions(20));
    expect(sql).toMatch(/where "courses_submissions"\."replied_at" is not null/);
    expect(sql).toMatch(/order by "courses_submissions"\."replied_at" desc/);
    expect(sql).toMatch(/limit \$\d+/);
    expect(params).toContain(20);
  });

  it("🚨 has no offset — it is not an archive", async () => {
    // A browsable body of somebody else's prose IS the export this module
    // refuses. Capped, never paged.
    const { sql } = await readStatement(() => answeredSubmissions());
    expect(sql).not.toContain("offset");
  });
});

describe("one hand-in by id", () => {
  it("reads exactly one row and takes no member id", async () => {
    const { sql } = await readStatement(() => submissionById("submission-1"));
    expect(sql).toMatch(/where "courses_submissions"\."id" = \$\d+/);
    expect(sql).not.toContain('"member_id" = ');
    expect(sql).toMatch(/limit \$\d+/);
    expect(submissionById.length).toBe(1);
  });

  it("is the one read that selects the body", async () => {
    const { sql } = await readStatement(() => submissionById("submission-1"));
    const select = sql.slice(0, sql.indexOf(" from "));
    expect(select).toContain('"body"');
    expect(select).toContain('"reply"');
  });
});

describe("writing the operator's answer", () => {
  /** Run the write and hand back the one statement it produced. */
  async function replyStatement(): Promise<Captured> {
    state.rows = [["submission-1"]];
    const written = await replyToSubmission({
      id: "submission-1",
      reply: "Well spotted.",
      ownerId: "owner-1",
    });
    expect(captured, "replyToSubmission() sent no statement at all").toHaveLength(1);
    expect(written).toBe(true);
    return captured[0];
  }

  it("is ONE statement", async () => {
    const { sql } = await replyStatement();
    expect(sql).toContain('update "courses_submissions" set');
    expect(sql).toMatch(/where "courses_submissions"\."id" = \$\d+/);
  });

  it("🚨 the first reader stays the first reader — coalesce, not a branch", async () => {
    // Two paths ("is it answered? then only the text") would be a rule in code
    // that two simultaneous requests can overtake. As the SHAPE of the one
    // statement, they cannot: whichever UPDATE lands second finds the columns
    // set and leaves them.
    const { sql } = await replyStatement();
    expect(
      sql,
      "replied_at stopped being written through coalesce(). It is the condition " +
        "the MEMBER's freeze hangs on — a write that can move it is a way to " +
        "re-open somebody's hand-in from the operator's side.",
    ).toMatch(/"replied_at" = coalesce\("courses_submissions"\."replied_at", now\(\)\)/);
    expect(
      sql,
      "replied_by stopped being written through coalesce(). It answers WHO read " +
        "this person's text — the third-party identity Art. 15(4) keeps out of " +
        "both exports — and letting it travel would make it answer 'who typed last'.",
    ).toMatch(/"replied_by" = coalesce\("courses_submissions"\."replied_by", \$\d+\)/);
  });

  it("writes the reply itself plainly, because a correction is allowed", async () => {
    const { sql, params } = await replyStatement();
    expect(sql).toMatch(/set "reply" = \$\d+/);
    expect(params).toContain("Well spotted.");
    expect(params).toContain("owner-1");
  });

  it("🚨 touches nothing of the member's own row", async () => {
    const { sql } = await replyStatement();
    const set = sql.slice(sql.indexOf("set "), sql.indexOf(" where "));
    expect(set).not.toContain('"body"');
    expect(set).not.toContain('"submitted_at"');
    expect(set).not.toContain('"member_id"');
    expect(set).not.toContain('"unit_slug"');
  });

  it("🚨 answers false when the statement hit no row", async () => {
    // An UPDATE matching nothing SUCCEEDS. Returning nothing would hand that
    // silence back as a save.
    state.rows = [];
    expect(
      await replyToSubmission({ id: "gone", reply: "text", ownerId: "owner-1" }),
    ).toBe(false);
  });
});

// ── the media door the content source reads through ─────────────────────────

describe("every lesson that has a medium", () => {
  it("🚨 does not select a single lesson text", async () => {
    // The claim this function exists for. `findMedia()` used `courseOutline()`,
    // which is `select()` — every column of every unit, so a twelve-week
    // course's whole prose left Postgres to read four id columns per row, once
    // per question to the assistant. A behavioural test cannot see that: the
    // answer is identical either way.
    const { sql } = await readStatement(() => unitsWithMedia(["course-1"]));
    const select = sql.slice(0, sql.indexOf(" from "));
    expect(select).toContain('"slug"');
    expect(select).toContain('"cover_media_id"');
    expect(
      select,
      "unitsWithMedia() is selecting the lesson body again — that is the whole " +
        "thing this door was split off `courseOutline()` to leave behind.",
    ).not.toContain('"body"');
    expect(select).not.toContain('"task_prompt"');
  });

  it("is ONE statement, joined rather than a query per block", async () => {
    // `releaseAfterDays` lives on the BLOCK and the drip check needs it per
    // row. Fetching it separately would be the N+1 over the very list this
    // door exists to keep to one.
    const { sql } = await readStatement(() => unitsWithMedia(["course-1"]));
    expect(sql).toContain('from "courses_units"');
    expect(sql).toMatch(/inner join "courses_blocks"/);
    expect(sql).toContain('"release_after_days"');
  });

  it("leaves a lesson with no medium in the database", async () => {
    const { sql } = await readStatement(() => unitsWithMedia(["course-1"]));
    const where = sql.slice(sql.indexOf(" where "));
    for (const column of ["cover_media_id", "video_media_id", "subtitle_media_id", "worksheet_media_id"]) {
      expect(where, `${column} is not in the filter`).toContain(`"${column}" is not null`);
    }
    // The course's own order, so a capped answer takes the rows the overview
    // shows first.
    // 🚨 The COURSE leads the ordering, and that is not cosmetic: block
    // position is only unique WITHIN a course since Story 44.2, so without it
    // two courses' blocks at position 1 come back in whatever order the planner
    // felt like — and every consumer of this list inherits a ranking that
    // differs between machines.
    expect(sql).toMatch(
      /order by "courses_blocks"\."course_id" asc, "courses_blocks"\."position" asc, "courses_units"\."position" asc/,
    );
  });
});
