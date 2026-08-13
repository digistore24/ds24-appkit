// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The applier owns ONE partition of its tables, and this is where that is
// measured rather than asserted in prose.
//
// The file under test is bare Node (`content-apply` imports it without a
// bundler), so it can be neither type-checked into behaving nor handed a
// database here. What it CAN be handed is a fake `sql` — and that turns out to
// be the honest instrument, because everything this story is about lives in the
// query TEXT: the `origin` column in each insert, the `where` on each
// `on conflict`, the two pre-flight selects, and the filter on `present()`.
// So the assertions read the queries the applier actually issued.
//
// The other half is the refusal. `content-apply` derives its exit code from the
// throw and from nothing else (`scripts/content/apply.mjs`), so "refused" here
// means the promise rejects AND the fake saw nothing but the two pre-flight
// selects — a half-applied course is the failure this whole mechanism exists to
// prevent, and a run that wrote the blocks before noticing would be exactly it.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { apply, plan, present, readBlocks } from "./course.mjs";

type Row = Record<string, unknown>;

/**
 * A `sql` handle that answers BY TABLE and writes down what it was asked.
 *
 * ── Why not a positional queue ─────────────────────────────────────────────
 * It was one until Story 44.2, and the reason it stopped being one is worth
 * keeping: a positional queue does not look at the SQL, so every test encodes
 * the applier's exact query ORDER. Adding the course table — three reads where
 * there were two, in two different functions — shifted every answer by one and
 * turned 19 tests red with one cause and nineteen misleading messages ("expected
 * a refusal naming grundlagen", when the answer meant for the block select had
 * landed on the unit select).
 *
 * The old comment defended that as a feature: *"a query the applier gains
 * without this test gaining an answer for it fails loudly rather than being
 * absorbed."* Half right — a query gaining no answer SHOULD be loud. What it
 * must not do is silently re-point the answers of unrelated queries, which is
 * what position buys and what a table name does not.
 *
 * ── What a test now says, and what it no longer has to ─────────────────────
 * A test names the table it cares about and hands over a queue for that table
 * alone (`{ courses_blocks: [[{ slug: "grundlagen" }]] }`). Queries against any
 * other table answer empty, and a query against a table this test never
 * mentioned is not an error — that is exactly the coupling being removed.
 *
 * 🚨 **`select id from <table>` answers itself.** Those are plumbing: the
 * applier needs *an* id to hang the next row on, no test is about which one, and
 * making forty fixtures carry `[{ id: "block-1" }]` is how the last shape got
 * its brittleness. A test that IS about the id overrides it like any other.
 *
 * `queries` keeps the static parts of each template with every interpolation
 * marked `?` — the literals these tests are about (`'content'`) are static, the
 * operator's data is not, and that is precisely the line worth keeping visible.
 */
type TableAnswers = Record<string, Row[][]>;

function fakeSql(answers: TableAnswers = {}) {
  const queries: string[] = [];
  const queues: TableAnswers = {};
  for (const [table, rows] of Object.entries(answers)) queues[table] = [...rows];

  const handle = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.raw.join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    void values;

    const table = /\bfrom\s+(courses_\w+)/.exec(text)?.[1] ?? "";
    const queue = queues[table];
    if (queue && queue.length > 0) return Promise.resolve(queue.shift()!);
    // The plumbing answer — see the header. Only for the id lookups, so a
    // `select slug` against a table the test did not mention still answers
    // empty, which is what "there is nothing there" has to look like.
    if (/^select id from/.test(text)) return Promise.resolve([{ id: `${table}-id` }]);
    return Promise.resolve([]);
  };

  return { sql: handle as unknown as Parameters<typeof apply>[0], queries, queues };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A throwaway `content/course/` — built, not mocked: the walk IS the subject. */
function contentDir(files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "ds24-course-content-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    // A key may name a subdirectory (`kurs-a/01-block.json`), because a course
    // IS a directory since Story 44.2 — and a key that does not is how the
    // "loose file from the old layout" refusal gets exercised.
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

/** A course's own file — the smallest one the applier accepts. */
const COURSE = { title: "Der Kurs", shape: "self-study", planKeys: ["basic_monthly"] };

/**
 * One course's worth of files, under `kurs/`.
 *
 * Almost every case below is about a BLOCK, and wrapping each fixture by hand
 * would put the course level in forty places where it decides nothing.
 */
function oneCourse(files: Record<string, unknown>, course: unknown = COURSE) {
  const out: Record<string, unknown> = { "kurs/course.json": course };
  for (const [name, body] of Object.entries(files)) out[`kurs/${name}`] = body;
  return out;
}

const ONE_BLOCK = {
  "01-grundlagen.json": {
    slug: "grundlagen",
    title: "Grundlagen",
    position: 1,
    units: [{ slug: "wehen-atmung", title: "Atmung", position: 1, body: "text" }],
  },
};

const mediaIdFor = async (path: string) => `media-for-${path}`;

describe("what the applier writes", () => {
  it("🚨 stamps every row it creates with its own origin", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql();

    await apply(sql, { mediaIdFor }, dir);
    const inserts = queries.filter((q) => q.startsWith("insert into"));
    // Three: the course, its block, its lesson — each stamped 'content'.
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) {
      // Explicit, never left to the column default — a row whose origin came
      // from the schema is a row nobody can tell was written on purpose.
      expect(insert, insert).toMatch(/\borigin\b/);
      expect(insert, insert).toMatch(/'content'/);
    }
  });

  it("🚨 every `on conflict` refuses to touch a row it does not own", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql();

    await apply(sql, { mediaIdFor }, dir);

    const upserts = queries.filter((q) => q.includes("on conflict"));
    // Three: the course, its block, its lesson.
    expect(upserts).toHaveLength(3);
    for (const upsert of upserts) {
      expect(upsert, upsert).toMatch(/where courses_\w+\.origin = 'content'/);
    }
  });

  it("never rewrites the origin of a row it updates", async () => {
    // `origin` is deliberately absent from every `do update set` list: a row
    // that is content stays content, and the column is not a field the content
    // files can move a row between.
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql();

    await apply(sql, { mediaIdFor }, dir);

    for (const upsert of queries.filter((q) => q.includes("do update set"))) {
      expect(upsert, upsert).not.toMatch(/origin = excluded/);
    }
  });

  it("asks for the operator's rows before it writes anything", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql();

    await apply(sql, { mediaIdFor }, dir);

    // Three tables since the course row exists, and `courses_courses` FIRST —
    // an operator may create a course of their own, and a content file claiming
    // that slug would otherwise hang its blocks on a course no deploy carries.
    expect(queries[0]).toBe("select slug from courses_courses where origin <> 'content'");
    expect(queries[1]).toBe("select slug from courses_blocks where origin <> 'content'");
    expect(queries[2]).toBe("select slug from courses_units where origin <> 'content'");
  });
});

describe("what the applier refuses", () => {
  it("🚨 refuses the whole run when a BLOCK slug is held by an operator row", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql({ courses_blocks: [[{ slug: "grundlagen" }]] });

    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(/grundlagen/);

    // The whole point of refusing rather than skipping: nothing was written.
    // Two pre-flight selects and not one statement more.
    // The three pre-flight selects and not one statement more.
    expect(queries).toHaveLength(3);
    expect(queries.some((q) => q.startsWith("insert into"))).toBe(false);
  });

  it("names the slug AND the file it came from", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = fakeSql({ courses_blocks: [[{ slug: "grundlagen" }]] });

    // Without the file name the operator has a slug and a directory to search.
    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(
      /"grundlagen".*content\/course\/kurs\/01-grundlagen\.json/s,
    );
  });

  it("🚨 refuses on a LESSON slug too, and writes nothing", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql({ courses_units: [[{ slug: "wehen-atmung" }]] });

    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(
      /"wehen-atmung".*content\/course\/kurs\/01-grundlagen\.json/s,
    );
    // The three pre-flight selects and not one statement more.
    expect(queries).toHaveLength(3);
  });

  it("collects every collision instead of stopping at the first", async () => {
    // A run that names one of three is a run somebody fixes three times.
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = fakeSql({
      courses_blocks: [[{ slug: "grundlagen" }]],
      courses_units: [[{ slug: "wehen-atmung" }]],
    });

    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(
      /2 slug\(s\).*grundlagen.*wehen-atmung/s,
    );
  });

  it("ignores an operator row whose slug no content file claims", async () => {
    // The ordinary state once an authoring surface exists: rows of both origins
    // side by side. Only a COLLISION is a refusal.
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = fakeSql({
      courses_blocks: [[{ slug: "eigener-block" }]],
      courses_units: [[{ slug: "eigene-lektion" }]],
    });

    // Three rows written — the course, its block, its lesson — and not one of
    // the operator's slugs is among them, so nothing is refused.
    await expect(apply(sql, { mediaIdFor }, dir)).resolves.toBe(3);
  });
});

describe("what the applier reports", () => {
  it("🚨 counts only its own rows", async () => {
    // `docs/content.md` defines `present()` as "how many rows of THIS applier
    // exist". Counting the operator's lessons would make `content-check` report
    // content as having arrived that never travelled.
    const { sql, queries } = fakeSql({ courses_units: [[{ n: 3 }]] });

    expect(await present(sql)).toBe(3);
    expect(queries[0]).toBe(
      "select count(*)::int as n from courses_units where origin = 'content'",
    );
  });
});

describe("what the applier would do — plan(sql)", () => {
  // The four queries, in order: the two that ask what this applier already owns,
  // then the pre-flight's two. `apply()` uses the same fake, so the two halves
  // of the applier are measured against one instrument.
  const nothingThere = () => fakeSql();

  it("🚨 writes nothing at all", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = nothingThere();

    await plan(sql, dir);

    // Not "no insert landed" — no statement that could write was even composed.
    // A plan runs inside a read-only transaction, so an upsert here would come
    // back as Postgres's refusal and lose the report for this whole applier.
    for (const query of queries) {
      expect(query, query).toMatch(/^select /);
    }
  });

  it("counts a slug it does not own yet as created", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = nothingThere();

    // One course, one block, one lesson — all three absent from the target.
    // The course COUNTS: it is a row this applier asserts, and a plan that left
    // it out would promise two writes and make three.
    expect(await plan(sql, dir)).toMatchObject({ created: 3, reasserted: 0, problems: [] });
  });

  it("counts a slug it already owns as re-asserted, not created", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = fakeSql({
      courses_courses: [[{ slug: "kurs" }]],
      courses_blocks: [[{ slug: "grundlagen" }]],
      courses_units: [[{ slug: "wehen-atmung" }]],
    });

    // All three already this applier's: nothing created, three re-asserted.
    expect(await plan(sql, dir)).toMatchObject({ created: 0, reasserted: 3 });
  });

  it("only counts rows of its OWN origin as present", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = nothingThere();

    await plan(sql, dir);

    expect(queries[0]).toBe("select slug from courses_courses where origin = 'content'");
    expect(queries[1]).toBe("select slug from courses_blocks where origin = 'content'");
    expect(queries[2]).toBe("select slug from courses_units where origin = 'content'");
  });

  it("🚨 created + reasserted is what apply() would actually write", async () => {
    // The property the whole report hangs on. Both walk one block plus its
    // units, so the two numbers cannot drift apart without one of these failing.
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const planned = await plan(nothingThere().sql, dir);
    const written = await apply(
      fakeSql().sql,
      { mediaIdFor },
      dir,
    );

    expect(planned.created + planned.reasserted).toBe(written);
  });

  it("names the slugs it would touch, blocks with their lessons under them", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = nothingThere();

    // The course, then its blocks, then their lessons — declaration order, which
    // is the order a reader of the files has in mind. The course line is what
    // says WHICH course the block lines belong to.
    expect((await plan(sql, dir)).subjects).toEqual(["kurs", "grundlagen", "wehen-atmung"]);
  });

  it("🚨 reports the collision apply() would REFUSE on, before anybody runs it", async () => {
    // The pre-flight that today only fires when `content-apply` refuses. Read
    // it here and the operator fixes the content file; miss it and they find out
    // when a production publish stops halfway through nothing.
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql } = fakeSql({ courses_blocks: [[], [{ slug: "grundlagen" }]] });

    const report = await plan(sql, dir);

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/courses_blocks: "grundlagen"/);
    expect(report.problems[0]).toMatch(/content\/course\/kurs\/01-grundlagen\.json/);
    expect(report.problems[0]).toMatch(/content-apply would refuse/);
    // And it is a PROBLEM, not a refusal: the plan still reports its numbers, so
    // an operator sees the whole picture rather than the first thing wrong.
    expect(report).toMatchObject({ created: 3, reasserted: 0 });
  });

  it("an app with no course files plans nothing, and says so with zeros", async () => {
    // Legitimate, and distinguishable from "this applier cannot say" — which is
    // the ABSENCE of a plan() and lives one level up, in the walker.
    //
    // ⚠️ No `oneCourse()` here, deliberately: a course DIRECTORY with no blocks
    // is a different state — one row to assert and nothing under it — and
    // wrapping this fixture would have made the zero a one.
    const dir = contentDir({});
    const { sql } = nothingThere();

    expect(await plan(sql, dir)).toMatchObject({ created: 0, reasserted: 0, subjects: [] });
  });
});

describe("reading the content files", () => {
  it("an absent directory is an app with no course yet", () => {
    expect(readBlocks(join(tmpdir(), "ds24-course-nothing-here"))).toEqual([]);
  });

  it("reads the files in name order and remembers which file each block came from", () => {
    const dir = contentDir(oneCourse({
      "02-vertiefung.json": { slug: "vertiefung", title: "B", position: 2 },
      "01-grundlagen.json": { slug: "grundlagen", title: "A", position: 1 },
    }));
    // The path carries the course directory: `file` is what an error message
    // hands the operator, and "01-grundlagen.json" would not tell them which
    // course to open once there is more than one.
    expect(readBlocks(dir).map((block) => block.file)).toEqual([
      "kurs/01-grundlagen.json",
      "kurs/02-vertiefung.json",
    ]);
  });

  it("refuses a file that is not JSON, by name", () => {
    const dir = contentDir(oneCourse({ "01-grundlagen.json": "{ not json" }));
    expect(() => readBlocks(dir)).toThrow(/01-grundlagen\.json is not valid JSON/);
  });

  it("refuses a file that is not one block object", () => {
    const dir = contentDir(oneCourse({ "01-list.json": [{ slug: "a" }] }));
    expect(() => readBlocks(dir)).toThrow(/must be one block object/);
  });

  it("refuses a block with no slug", () => {
    const dir = contentDir(oneCourse({ "01-grundlagen.json": { title: "A", position: 1 } }));
    expect(() => readBlocks(dir)).toThrow(/a block needs a slug/);
  });

  it("🚨 refuses two blocks sharing a slug, naming both files", () => {
    const dir = contentDir(oneCourse({
      "01-a.json": { slug: "same", title: "A", position: 1 },
      "02-b.json": { slug: "same", title: "B", position: 2 },
    }));
    expect(() => readBlocks(dir)).toThrow(/two blocks share the slug "same": kurs\/01-a\.json and kurs\/02-b\.json/);
  });

  it("refuses two blocks sharing a position — WITHIN one course", () => {
    const dir = contentDir(oneCourse({
      "01-a.json": { slug: "a", title: "A", position: 1 },
      "02-b.json": { slug: "b", title: "B", position: 1 },
    }));
    expect(() => readBlocks(dir)).toThrow(/two blocks of course "kurs" share position 1/);
  });

  it("refuses a unit with no slug", () => {
    const dir = contentDir(oneCourse({
      "01-a.json": { slug: "a", title: "A", position: 1, units: [{ title: "U", position: 1 }] },
    }));
    expect(() => readBlocks(dir)).toThrow(/a unit needs a slug/);
  });

  it("🚨 refuses two units sharing a slug — one Subject Key, two lessons' learners", () => {
    const dir = contentDir(oneCourse({
      "01-a.json": {
        slug: "a",
        title: "A",
        position: 1,
        units: [
          { slug: "same", title: "U1", position: 1 },
          { slug: "same", title: "U2", position: 2 },
        ],
      },
    }));
    expect(() => readBlocks(dir)).toThrow(/two units share the slug "same"/);
  });
});

describe("🚨 several courses — the layout, and what it refuses", () => {
  // ── What this catches ────────────────────────────────────────────────────
  // Until Story 44.2 `content/course/` was one flat directory of block files
  // and an app held exactly one course. The failure of getting this wrong is
  // not a crash: it is a block silently hanging on the wrong course, which
  // means material served to buyers of a product that does not include it.

  it("🚨 refuses a loose .json under content/course/ and names the move", () => {
    // The old layout. Skipping it would apply three quarters of a course and
    // report success — and the file is somebody's block, not a stray.
    const dir = contentDir({ "01-grundlagen.json": { slug: "g", title: "A", position: 1 } });
    expect(() => readBlocks(dir)).toThrow(/loose \.json file\(s\) \(01-grundlagen\.json\)/);
    expect(() => readBlocks(dir)).toThrow(/content\/course\/<course-slug>\//);
  });

  it("refuses a course directory with no course.json", () => {
    const dir = contentDir({ "kurs/01-a.json": { slug: "a", title: "A", position: 1 } });
    expect(() => readBlocks(dir)).toThrow(/content\/course\/kurs\/ has no course\.json/);
  });

  it("🚨 refuses a \"slug\" key in course.json — the DIRECTORY is the slug", () => {
    // Two places to write it are two places to write it differently, and the
    // one nothing reads is the one somebody believes they set.
    const dir = contentDir({ "kurs/course.json": { ...COURSE, slug: "etwas-anderes" } });
    expect(() => readBlocks(dir)).toThrow(/remove "slug"/);
  });

  it("refuses a shape that is not one of the three, and says why there is no default", () => {
    const dir = contentDir({ "kurs/course.json": { ...COURSE, shape: "selbstlernkurs" } });
    expect(() => readBlocks(dir)).toThrow(/"shape" is "selbstlernkurs"/);
    // The argument, not just the list: a missing shape may NOT fall back to
    // self-study, which is the most permissive of the three.
    expect(() => readBlocks(dir)).toThrow(/week ten on day one/);
  });

  it("refuses a course sold as nothing, and a course sold as the same thing twice", () => {
    const empty = contentDir({ "kurs/course.json": { ...COURSE, planKeys: [] } });
    expect(() => readBlocks(empty)).toThrow(/"planKeys" is missing or empty/);
    const twice = contentDir({
      "kurs/course.json": { ...COURSE, planKeys: ["basic_monthly", "basic_monthly"] },
    });
    expect(() => readBlocks(twice)).toThrow(/lists "basic_monthly" twice/);
  });

  it("🚨 lets two courses BOTH start at position 1 — the needle", () => {
    // The check this replaces was app-wide, so it refused the second course on
    // its first day. Every course orders its own blocks from 1; a position
    // reaching two courses is not a collision at all.
    const dir = contentDir({
      "kurs-a/course.json": COURSE,
      "kurs-a/01-erstes.json": { slug: "a-erstes", title: "A1", position: 1 },
      "kurs-b/course.json": COURSE,
      "kurs-b/01-erstes.json": { slug: "b-erstes", title: "B1", position: 1 },
    });
    expect(readBlocks(dir).map((block) => block.course)).toEqual(["kurs-a", "kurs-b"]);
  });

  it("…and still refuses two blocks of ONE course at the same position", () => {
    // The counter-test. Scoping the check must not switch it off.
    const dir = contentDir({
      "kurs-a/course.json": COURSE,
      "kurs-a/01-a.json": { slug: "a", title: "A", position: 1 },
      "kurs-a/02-b.json": { slug: "b", title: "B", position: 1 },
    });
    expect(() => readBlocks(dir)).toThrow(/two blocks of course "kurs-a" share position 1/);
  });

  it("🚨 refuses one block SLUG across two courses — the half that stays global", () => {
    // The other side of the same split. The upsert's conflict target is the
    // slug alone and the learners' rows key on it, so a slug in two courses is
    // a real collision where a position is not.
    const dir = contentDir({
      "kurs-a/course.json": COURSE,
      "kurs-a/01-a.json": { slug: "geteilt", title: "A", position: 1 },
      "kurs-b/course.json": COURSE,
      "kurs-b/01-b.json": { slug: "geteilt", title: "B", position: 1 },
    });
    expect(() => readBlocks(dir)).toThrow(
      /two blocks share the slug "geteilt": kurs-a\/01-a\.json and kurs-b\/01-b\.json/,
    );
  });

  it("🚨 writes the course BEFORE its blocks, and hangs the block on that id", async () => {
    const dir = contentDir(oneCourse(ONE_BLOCK));
    const { sql, queries } = fakeSql({ courses_courses: [[], [{ id: "course-xyz" }]] });

    await apply(sql, { mediaIdFor }, dir);

    const inserts = queries.filter((q) => q.startsWith("insert into"));
    expect(inserts[0]).toMatch(/^insert into courses_courses/);
    expect(inserts[1]).toMatch(/^insert into courses_blocks/);
    // 🚨 …and the block carries a course_id its upsert also RE-asserts, so a
    // block moved between courses in the files is really re-homed rather than
    // left where it was. The applier has no delete path; without this line a
    // move would be silently ignored.
    expect(inserts[1]).toMatch(/course_id/);
    expect(inserts[1]).toMatch(/course_id = excluded\.course_id/);
  });
});
