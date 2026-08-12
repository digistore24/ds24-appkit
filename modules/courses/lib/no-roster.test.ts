// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 There is no surface over all of a member's hand-ins, and there is not to be
// one.
//
// The operator's queue lists HAND-INS, never people: somebody who has handed
// nothing in appears nowhere, and there is deliberately no way to ask "what has
// member X handed in". **Who is working through which lesson is purchase
// information** — a list of the people who handed something in for a
// plan-gated course IS a list of who bought it, and the products this template
// is built for are routinely health-adjacent. The community is designed around
// exactly this and has no roster for exactly this reason
// (`CLAUDE.md` → *Which EU rules reach this app*, `docs/data-protection.md`
// §14b).
//
// Nothing behavioural can make that claim, because it is about the function
// somebody adds NEXT. So this reads `./manage.ts` as text and asks one thing of
// it: **no exported READER of `courses_submissions` takes a `memberId`, except
// the member's own one.**
//
// ⚠️ **Reader and writer are separated, and that separation is load-bearing
// rather than tidy.** `upsertSubmission(memberId, …)` is a WRITER and takes a
// member id on purpose — it stores the session's own account, and carrying that
// id into the statement is what makes a caller who lost the guarantee write
// NOTHING rather than somebody else's row. A scan that did not tell the two
// apart would fail on the one function whose parameter is a security control.
//
// 🚨 **Through `blankComments()`, never a raw grep.** `./manage.ts` says
// `memberId` in the comments that explain why its readers do not take one, and a
// checker that punished a file for explaining itself is one whose explanation
// gets deleted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const FILE = join("modules", "courses", "lib", "manage.ts");
const SOURCE = blankComments(readFileSync(join(process.cwd(), FILE), "utf8"));

/** Every exported function, with the text that follows it up to the next one. */
function functions(source: string): { name: string; body: string }[] {
  return source
    .split(/export\s+async\s+function\s+/)
    .slice(1)
    .map((chunk) => ({ name: chunk.slice(0, chunk.indexOf("(")).trim(), body: chunk }));
}

/**
 * The one function allowed to take a member id while READING this table.
 *
 * It serves the member's own lesson page, where scoping the query by the
 * session's account is what makes "no such row" and "somebody else's row" the
 * same answer. An entry beside it is a decision that some surface reads another
 * person's hand-ins by member, and it belongs in this comment with its reason.
 */
const MEMBER_SCOPED = ["submissionFor"];

const ALL = functions(SOURCE);
/** A READER: it selects FROM the table. `insert`/`update`/`delete` do not. */
const READERS = ALL.filter(({ body }) => /\.from\(coursesSubmissions\)/.test(body));
/** …and the writers, kept apart on purpose. */
const WRITERS = ALL.filter(({ body }) =>
  /\.(insert|update|delete)\(coursesSubmissions\)/.test(body),
);

describe("the course has no roster and no surface over all hand-ins", () => {
  it("finds the readers and the writers, and tells them apart", () => {
    // Non-vacuity, three ways. A scan matching nothing would report every claim
    // below as satisfied — "green because it checked" and "green because it
    // found nothing" are the same colour. The third assertion is the one that
    // matters: a scan that lumped the writer in with the readers would fail on
    // the function whose member id is a security control.
    expect(
      READERS.length,
      `no reader of courses_submissions found in ${FILE} — did the file move, or ` +
        `did the queries stop using Drizzle's builder? This test is vacuous if ` +
        `it finds nothing.`,
    ).toBeGreaterThanOrEqual(3);
    expect(READERS.map((fn) => fn.name)).toContain("submissionFor");
    expect(READERS.map((fn) => fn.name)).toContain("waitingSubmissions");
    expect(READERS.map((fn) => fn.name)).toContain("submissionById");

    expect(WRITERS.map((fn) => fn.name)).toContain("upsertSubmission");
    expect(WRITERS.map((fn) => fn.name)).toContain("replyToSubmission");
    expect(
      READERS.map((fn) => fn.name).filter((name) =>
        WRITERS.map((fn) => fn.name).includes(name),
      ),
      "a function counted as both a reader and a writer — the scan cannot tell " +
        "them apart any more, and the writer's member id would be judged by the " +
        "readers' rule",
    ).toEqual([]);
  });

  it("🚨 no reader of the hand-ins takes a member id, except the member's own", () => {
    for (const { name, body } of READERS) {
      if (MEMBER_SCOPED.includes(name)) continue;
      const signature = body.slice(0, body.indexOf("{"));
      expect(
        /\bmember_?[Ii]d\b|\buser_?[Ii]d\b/.test(signature),
        `${FILE} → ${name} takes a member id and reads courses_submissions. There is no ` +
          `surface over all of one person's hand-ins, and adding one is not an oversight ` +
          `to fix: who is working through which lesson is purchase information ` +
          `(docs/data-protection.md §14b). The queue lists hand-ins, never people.`,
      ).toBe(false);
    }
  });

  it("🚨 the member's own reader really is scoped by the session's account", () => {
    // The other side of the exemption. `submissionFor` is on the list because
    // it MUST take a member id — an exemption for a function that had quietly
    // stopped using one would be an exemption for nothing.
    const own = READERS.find((fn) => fn.name === "submissionFor");
    expect(own).toBeDefined();
    expect(own!.body.slice(0, own!.body.indexOf("{"))).toMatch(/memberId/);
    expect(own!.body).toMatch(/eq\(coursesSubmissions\.memberId, memberId\)/);
  });

  it("🚨 the scan finds a planted roster", () => {
    // The needle probe: proving the walk ran is not proving the comparison did.
    const planted = functions(
      blankComments(
        `export async function submissionsByMember(memberId: string) {\n` +
          `  return db.select().from(coursesSubmissions).where(eq(x, memberId));\n}\n`,
      ),
    );
    expect(planted).toHaveLength(1);
    expect(/\.from\(coursesSubmissions\)/.test(planted[0].body)).toBe(true);
    expect(
      /\bmember_?[Ii]d\b/.test(planted[0].body.slice(0, planted[0].body.indexOf("{"))),
    ).toBe(true);
  });

  it("🚨 a comment can neither satisfy nor break the claim", () => {
    // What `blankComments()` is for, stated as a measurement: a reader whose
    // member id exists only in prose must still pass.
    const commented = functions(
      blankComments(
        `export async function harmless(limit: number) {\n` +
          `  // deliberately NOT scoped by memberId — see the header\n` +
          `  return db.select().from(coursesSubmissions).limit(limit);\n}\n`,
      ),
    );
    expect(
      /\bmember_?[Ii]d\b/.test(commented[0].body.slice(0, commented[0].body.indexOf("{"))),
    ).toBe(false);
  });
});
