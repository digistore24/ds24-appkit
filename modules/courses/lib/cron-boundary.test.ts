// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What the hand-in digest may read, held as a claim about the FILE.
//
// `../cron.ts` counts a queue and mails the operator a number. Two rules meet on
// it, and neither is behavioural — both are about the function somebody adds
// NEXT:
//
//  1. **Cron rule 2** (`docs/cron.md`, `lib/cron/jobs.ts`): a job's one line
//     lands in `cron_runs.lastDetail`, a table `docs/data-protection.md` §11
//     promises holds nothing personal. Numbers only.
//  2. **The digest rule** (`docs/community.md`): a mail is delivered to an inbox
//     this app does not control, stored on a mail provider's disk, and read on
//     whichever device holds it. Plus the course's own half — WHO is working
//     through WHICH lesson is purchase information (`./no-roster.test.ts`).
//
// Both come down to one mechanical question: does this file reach any reader
// that carries a person? `waitingCount()` returns an integer and nothing else.
//
// 🚨 **So the load-bearing claim is an ALLOWLIST, not a list of banned names.**
// A claim about "the function somebody adds NEXT" cannot be made by enumerating
// the readers that exist TODAY — measured: a copy of `../cron.ts` calling an
// unlisted `oldestWaitingLearner()` passed a four-name denylist without a word.
// What holds instead is the shape `./no-roster.test.ts` uses one directory over:
// DISCOVER what the file reaches and hold it against the short list of what it
// may. The job has exactly one line of data access — `import { waitingCount }
// from "./lib/manage"` — which makes the inversion cheap: every symbol it takes
// out of the module's data layer has to be named below, and it may not reach
// past that layer into the database at all.
//
// The denylist stayed underneath, because it produces the better message for the
// four names somebody is actually tempted by. It is the second opinion now, not
// the claim: `waitingSubmissions()`, `answeredSubmissions()` and
// `submissionById()` carry `memberName`, `memberEmail` and the lesson's title,
// and `users` is the table those names come from.
//
// ⚠️ **Both halves have the house hatch, `digest-read-ok`.** This test ships to
// customers, and a fixed list in a shipped guard with no way past it is how a
// template turns somebody else's suite red about code they wrote correctly. An
// app that genuinely needs a second counter out of `./lib/manage` marks that
// import line and writes down why — which is a decision somebody records rather
// than a guard they delete.
//
// ⚠️ **`./no-roster.test.ts` does not cover this.** It reads `./manage.ts` and
// only that — a new consumer in another file falls entirely outside its view.
// Hence this file, in the same directory and of the same build.
//
// 🚨 **Through `blankComments()`, never a raw grep.** `../cron.ts`'s header names
// every forbidden reader in order to say it does not call them, and a checker
// that punished a file for explaining itself is one whose explanation gets
// deleted (`CLAUDE.md` → the `blankComments()` rule).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

import { DIGEST_JOB_ID } from "../rules";

const FILE = join("modules", "courses", "cron.ts");
const SOURCE = readFileSync(join(process.cwd(), FILE), "utf8");
const CODE = blankComments(SOURCE);
/** The untouched lines, for the hatch only — a marker lives in a comment. */
const LINES = SOURCE.split(/\r?\n/);

/**
 * The escape hatch, same shape as `sql-cast-ok` and `operator-mail-ok`.
 *
 * Written on the import line it exempts. It is deliberately per-line: an app
 * that needs a second count says so about one import, not about the file.
 */
const EXEMPT = "digest-read-ok";

/** The only symbols this job may take out of the module's data access. */
const ALLOWED_READERS = ["waitingCount"];

/**
 * Anything that would reach past `./lib/manage` into the table itself.
 *
 * The allowlist above is worth nothing if the next version writes its own
 * `db.select().from(coursesSubmissions)` — that reaches the same columns
 * without going through a single name this file could enumerate.
 */
const DATABASE = /^(@\/db(\/|$)|drizzle-orm(\/|$)|(\.{1,2}\/)+(db|schema)(\/|$))/;

interface ImportLine {
  specifier: string;
  names: string[];
  line: number;
  exempt: boolean;
}

/**
 * Every `import … from "…"` in a piece of source, with its named bindings.
 *
 * Discovery rather than enumeration — that is the whole point of the file. Line
 * numbers come off the blanked text, which `blankComments()` keeps aligned with
 * the original by replacing comments with spaces of the same length.
 */
function importsOf(code: string, lines: string[] = LINES): ImportLine[] {
  const pattern = /import\s+(?:type\s+)?(?:\{([^}]*)\}|[\w*\s,]+?)\s+from\s+["']([^"']+)["']/g;
  return [...code.matchAll(pattern)].map((match) => {
    const line = code.slice(0, match.index).split("\n").length;
    const span = match[0].split("\n").length;
    return {
      specifier: match[2],
      names: (match[1] ?? "")
        .split(",")
        .map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
        .filter(Boolean),
      line,
      exempt: lines.slice(line - 1, line - 1 + span).some((text) => text.includes(EXEMPT)),
    };
  });
}

const IMPORTS = importsOf(CODE);

/**
 * The readers that carry a person, and the table their names come from.
 *
 * ⚠️ **The second opinion, not the claim** — the allowlist above is what holds
 * against a reader nobody has written yet. This list stays because it catches
 * the four somebody is actually tempted by, wherever in the file they appear,
 * and says WHY about each by name.
 *
 * Spelled from halves so this file does not match itself — the trick
 * `./render-safety.test.ts` and `scripts/knowledge-boundary.test.ts` use, and
 * for the same reason: a needle written whole would be found in its own scanner
 * if this file were ever added to the scan.
 */
const FORBIDDEN: { needle: string; why: string }[] = [
  {
    needle: "waiting" + "Submissions",
    why: "it selects memberName and memberEmail — the queue's rows, not a count",
  },
  {
    needle: "answered" + "Submissions",
    why: "same columns, read from the other end of the index",
  },
  {
    needle: "submission" + "ById",
    why: "one whole hand-in, including the text somebody wrote",
  },
  {
    needle: "users",
    why: "the accounts table itself — the digest knows no recipient, notifyOperators() does",
  },
];

/**
 * And the one it MAY read. Its absence would make every claim above vacuous:
 * a renamed file, a moved import or a scan pointed at nothing all pass by
 * finding no forbidden name either.
 */
const REQUIRED = "waiting" + "Count";

describe("the hand-in digest reads a number and nothing else", () => {
  it("is looking at the job at all", () => {
    // Non-vacuity, three ways: the file exists, it is the job, and it really
    // does reach the one reader it is allowed to reach.
    expect(
      CODE.length,
      `${FILE} is empty after blanking its comments — did the job move?`,
    ).toBeGreaterThan(200);
    expect(CODE, `${FILE} does not look like a cron job any more`).toContain("DIGEST_JOB_ID");
    expect(DIGEST_JOB_ID, "the job id moved — the manifest declares this one").toBe(
      "courses-digest",
    );
    expect(
      CODE,
      `${FILE} no longer calls ${REQUIRED}() — this scan would then be green ` +
        `because it found nothing, which is the same colour as green because it checked.`,
    ).toContain(REQUIRED);
  });

  it("🚨 takes only a COUNT out of the module's data access", () => {
    // THE claim of this file. Not "these four names are absent" but "only this
    // one name is present" — the difference between a rule about today's code
    // and a rule about the function somebody adds next.
    const dataAccess = IMPORTS.filter((entry) => /(^|\/)lib\/manage$/.test(entry.specifier));

    // Non-vacuity: no import found means no symbol found means green.
    expect(
      dataAccess.length,
      `${FILE} no longer imports from ./lib/manage — either the job stopped ` +
        `counting, or it now reaches the rows some other way. Either way this ` +
        `allowlist is measuring nothing.`,
    ).toBeGreaterThan(0);

    const offenders = dataAccess
      .filter((entry) => !entry.exempt)
      .flatMap((entry) =>
        entry.names
          .filter((name) => !ALLOWED_READERS.includes(name))
          .map((name) => `${FILE}:${entry.line} → ${name}`),
      );

    expect(
      offenders,
      `the digest may take ${ALLOWED_READERS.join(", ")} out of ./lib/manage and ` +
        `nothing else. Every other reader of courses_submissions carries a person ` +
        `— a name, an address, a lesson title or the text somebody wrote — and ` +
        `this job's two outputs are a line in cron_runs and a mail, neither of ` +
        `which may hold any of it (cron rule 2; docs/data-protection.md §14b). ` +
        `If your app genuinely needs a second COUNT here, mark that import line ` +
        `"${EXEMPT}" and say in the comment what it counts.`,
    ).toEqual([]);
  });

  it("🚨 does not reach past the module's data access into the table", () => {
    // The other half of the allowlist. A hand-written query in this file would
    // select the same columns without naming a single function above.
    const offenders = IMPORTS.filter(
      (entry) => !entry.exempt && DATABASE.test(entry.specifier),
    ).map((entry) => `${FILE}:${entry.line} → ${entry.specifier}`);

    expect(
      offenders,
      `${FILE} imports the database directly. The job counts through ` +
        `./lib/manage, which is the file ./no-roster.test.ts holds to the ` +
        `no-roster rule; a query written here is outside both guards.`,
    ).toEqual([]);
  });

  it("🚨 the import scan finds a planted reader and a planted query", () => {
    // The needle probe. Proving the walk ran is not proving the comparison did,
    // and the reader that got through the old denylist is the needle: an
    // unlisted, person-carrying reader of the same table.
    const planted = importsOf(
      blankComments(
        `import { waitingCount, oldestWaitingLearner } from "./lib/manage";\n` +
          `import { db } from "@/db";\n` +
          `import { waitingCount as second } from "./lib/manage"; // ${EXEMPT}\n`,
      ),
      [
        `import { waitingCount, oldestWaitingLearner } from "./lib/manage";`,
        `import { db } from "@/db";`,
        `import { waitingCount as second } from "./lib/manage"; // ${EXEMPT}`,
      ],
    );

    expect(planted).toHaveLength(3);
    expect(planted[0].names).toEqual(["waitingCount", "oldestWaitingLearner"]);
    expect(planted[0].names.filter((name) => !ALLOWED_READERS.includes(name))).toEqual([
      "oldestWaitingLearner",
    ]);
    expect(DATABASE.test(planted[1].specifier)).toBe(true);
    // …and the hatch really lets a marked line past, alias and all.
    expect(planted[2].exempt).toBe(true);
    expect(planted[0].exempt).toBe(false);
    expect(planted[2].names).toEqual(["waitingCount"]);
  });

  it("🚨 names no reader that carries a person", () => {
    const offenders: string[] = [];
    for (const { needle, why } of FORBIDDEN) {
      CODE.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(needle)) offenders.push(`${FILE}:${index + 1} → ${needle} (${why})`);
      });
    }

    expect(
      offenders,
      `the digest counts and reports a NUMBER. Its line lands in cron_runs.lastDetail ` +
        `(cron rule 2) and its mail lands in an inbox this app does not control — and ` +
        `who is working through which lesson is purchase information ` +
        `(docs/data-protection.md §14b, modules/courses/lib/no-roster.test.ts). ` +
        `waitingCount() is the query; there is no second one.`,
    ).toEqual([]);
  });

  it("🚨 asks the switch before it asks the database", () => {
    // The order is the claim, and reading it off the source is the cheap half —
    // `../cron.test.ts` measures it with both seams mocked. Both are here
    // because a body rearranged during a refactor passes one and fails the
    // other, and it is not always the same one.
    const body = CODE.slice(CODE.indexOf("async run("));
    const switchAt = body.indexOf("isCourseSwitchedOn");
    const queryAt = body.indexOf(REQUIRED);
    expect(switchAt, "the job no longer reads the course switch at all").toBeGreaterThan(-1);
    expect(queryAt, "the job no longer counts anything").toBeGreaterThan(-1);
    expect(
      switchAt,
      `${FILE} counts before it checks whether the course is even switched on. A ` +
        `switched-off course must cost zero database round-trips and send nothing.`,
    ).toBeLessThan(queryAt);
  });

  it("🚨 builds no second send marker", () => {
    // The marker belongs to the core (`lib/notify/sent-once.ts`), and a second
    // one would be a second truth about the same thing — with a duplicate mail
    // nobody notices as its failure mode.
    for (const needle of ["notification" + "_sends", "claim" + "Send", "onConflict"]) {
      expect(
        CODE,
        `${FILE} reaches for the send marker itself. It supplies the KEY and lets ` +
          `notifyOperators() claim it; two markers are two truths about one message.`,
      ).not.toContain(needle);
    }
    expect(CODE, "the job no longer goes through the core's channel").toContain(
      "notify" + "Operators",
    );
  });
});
