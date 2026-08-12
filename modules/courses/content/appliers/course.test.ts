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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { apply, plan, present, readBlocks } from "./course.mjs";

type Row = Record<string, unknown>;

/**
 * A `sql` handle that answers from a queue and writes down what it was asked.
 *
 * The queue is exact on purpose: a query the applier gains without this test
 * gaining an answer for it fails loudly rather than being absorbed. `text` keeps
 * the static parts of the template and marks every interpolation `?` — the
 * literals this story is about (`'content'`) are static, the operator's data is
 * not, and that is precisely the line worth keeping visible.
 */
function fakeSql(answers: Row[][] = []) {
  const queries: string[] = [];
  const queue = [...answers];
  const handle = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.raw.join("?").replace(/\s+/g, " ").trim());
    void values;
    return Promise.resolve(queue.shift() ?? []);
  };
  return { sql: handle as unknown as Parameters<typeof apply>[0], queries, queue };
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
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
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
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries, queue } = fakeSql([[], [], [], [{ id: "block-1" }], []]);

    await apply(sql, { mediaIdFor }, dir);

    expect(queue, "the applier issued fewer queries than this test expected").toHaveLength(0);
    const inserts = queries.filter((q) => q.startsWith("insert into"));
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      // Explicit, never left to the column default — a row whose origin came
      // from the schema is a row nobody can tell was written on purpose.
      expect(insert, insert).toMatch(/\borigin\b/);
      expect(insert, insert).toMatch(/'content'/);
    }
  });

  it("🚨 every `on conflict` refuses to touch a row it does not own", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries } = fakeSql([[], [], [], [{ id: "block-1" }], []]);

    await apply(sql, { mediaIdFor }, dir);

    const upserts = queries.filter((q) => q.includes("on conflict"));
    expect(upserts).toHaveLength(2);
    for (const upsert of upserts) {
      expect(upsert, upsert).toMatch(/where courses_\w+\.origin = 'content'/);
    }
  });

  it("never rewrites the origin of a row it updates", async () => {
    // `origin` is deliberately absent from every `do update set` list: a row
    // that is content stays content, and the column is not a field the content
    // files can move a row between.
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries } = fakeSql([[], [], [], [{ id: "block-1" }], []]);

    await apply(sql, { mediaIdFor }, dir);

    for (const upsert of queries.filter((q) => q.includes("do update set"))) {
      expect(upsert, upsert).not.toMatch(/origin = excluded/);
    }
  });

  it("asks for the operator's rows before it writes anything", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries } = fakeSql([[], [], [], [{ id: "block-1" }], []]);

    await apply(sql, { mediaIdFor }, dir);

    expect(queries[0]).toBe("select slug from courses_blocks where origin <> 'content'");
    expect(queries[1]).toBe("select slug from courses_units where origin <> 'content'");
  });
});

describe("what the applier refuses", () => {
  it("🚨 refuses the whole run when a BLOCK slug is held by an operator row", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries } = fakeSql([[{ slug: "grundlagen" }], []]);

    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(/grundlagen/);

    // The whole point of refusing rather than skipping: nothing was written.
    // Two pre-flight selects and not one statement more.
    expect(queries).toHaveLength(2);
    expect(queries.some((q) => q.startsWith("insert into"))).toBe(false);
  });

  it("names the slug AND the file it came from", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql } = fakeSql([[{ slug: "grundlagen" }], []]);

    // Without the file name the operator has a slug and a directory to search.
    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(
      /"grundlagen".*content\/course\/01-grundlagen\.json/s,
    );
  });

  it("🚨 refuses on a LESSON slug too, and writes nothing", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries } = fakeSql([[], [{ slug: "wehen-atmung" }]]);

    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(
      /"wehen-atmung".*content\/course\/01-grundlagen\.json/s,
    );
    expect(queries).toHaveLength(2);
  });

  it("collects every collision instead of stopping at the first", async () => {
    // A run that names one of three is a run somebody fixes three times.
    const dir = contentDir(ONE_BLOCK);
    const { sql } = fakeSql([[{ slug: "grundlagen" }], [{ slug: "wehen-atmung" }]]);

    await expect(apply(sql, { mediaIdFor }, dir)).rejects.toThrow(
      /2 slug\(s\).*grundlagen.*wehen-atmung/s,
    );
  });

  it("ignores an operator row whose slug no content file claims", async () => {
    // The ordinary state once an authoring surface exists: rows of both origins
    // side by side. Only a COLLISION is a refusal.
    const dir = contentDir(ONE_BLOCK);
    const { sql, queue } = fakeSql([
      [{ slug: "eigener-block" }],
      [{ slug: "eigene-lektion" }],
      [],
      [{ id: "block-1" }],
      [],
    ]);

    await expect(apply(sql, { mediaIdFor }, dir)).resolves.toBe(2);
    expect(queue).toHaveLength(0);
  });
});

describe("what the applier reports", () => {
  it("🚨 counts only its own rows", async () => {
    // `docs/content.md` defines `present()` as "how many rows of THIS applier
    // exist". Counting the operator's lessons would make `content-check` report
    // content as having arrived that never travelled.
    const { sql, queries } = fakeSql([[{ n: 3 }]]);

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
  const nothingThere = () => fakeSql([[], [], [], []]);

  it("🚨 writes nothing at all", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries, queue } = nothingThere();

    await plan(sql, dir);

    expect(queue, "the planner issued fewer queries than this test expected").toHaveLength(0);
    // Not "no insert landed" — no statement that could write was even composed.
    // A plan runs inside a read-only transaction, so an upsert here would come
    // back as Postgres's refusal and lose the report for this whole applier.
    for (const query of queries) {
      expect(query, query).toMatch(/^select /);
    }
  });

  it("counts a slug it does not own yet as created", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql } = nothingThere();

    // One block, one lesson — both absent from the target.
    expect(await plan(sql, dir)).toMatchObject({ created: 2, reasserted: 0, problems: [] });
  });

  it("counts a slug it already owns as re-asserted, not created", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql } = fakeSql([[{ slug: "grundlagen" }], [{ slug: "wehen-atmung" }], [], []]);

    expect(await plan(sql, dir)).toMatchObject({ created: 0, reasserted: 2 });
  });

  it("only counts rows of its OWN origin as present", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql, queries } = nothingThere();

    await plan(sql, dir);

    expect(queries[0]).toBe("select slug from courses_blocks where origin = 'content'");
    expect(queries[1]).toBe("select slug from courses_units where origin = 'content'");
  });

  it("🚨 created + reasserted is what apply() would actually write", async () => {
    // The property the whole report hangs on. Both walk one block plus its
    // units, so the two numbers cannot drift apart without one of these failing.
    const dir = contentDir(ONE_BLOCK);
    const planned = await plan(nothingThere().sql, dir);
    const written = await apply(
      fakeSql([[], [], [], [{ id: "block-1" }], []]).sql,
      { mediaIdFor },
      dir,
    );

    expect(planned.created + planned.reasserted).toBe(written);
  });

  it("names the slugs it would touch, blocks with their lessons under them", async () => {
    const dir = contentDir(ONE_BLOCK);
    const { sql } = nothingThere();

    expect((await plan(sql, dir)).subjects).toEqual(["grundlagen", "wehen-atmung"]);
  });

  it("🚨 reports the collision apply() would REFUSE on, before anybody runs it", async () => {
    // The pre-flight that today only fires when `content-apply` refuses. Read
    // it here and the operator fixes the content file; miss it and they find out
    // when a production publish stops halfway through nothing.
    const dir = contentDir(ONE_BLOCK);
    const { sql } = fakeSql([[], [], [{ slug: "grundlagen" }], []]);

    const report = await plan(sql, dir);

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatch(/courses_blocks: "grundlagen"/);
    expect(report.problems[0]).toMatch(/content\/course\/01-grundlagen\.json/);
    expect(report.problems[0]).toMatch(/content-apply would refuse/);
    // And it is a PROBLEM, not a refusal: the plan still reports its numbers, so
    // an operator sees the whole picture rather than the first thing wrong.
    expect(report).toMatchObject({ created: 2, reasserted: 0 });
  });

  it("an app with no course files plans nothing, and says so with zeros", async () => {
    // Legitimate, and distinguishable from "this applier cannot say" — which is
    // the ABSENCE of a plan() and lives one level up, in the walker.
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
    const dir = contentDir({
      "02-vertiefung.json": { slug: "vertiefung", title: "B", position: 2 },
      "01-grundlagen.json": { slug: "grundlagen", title: "A", position: 1 },
    });
    expect(readBlocks(dir).map((block) => block.file)).toEqual([
      "01-grundlagen.json",
      "02-vertiefung.json",
    ]);
  });

  it("refuses a file that is not JSON, by name", () => {
    const dir = contentDir({ "01-grundlagen.json": "{ not json" });
    expect(() => readBlocks(dir)).toThrow(/01-grundlagen\.json is not valid JSON/);
  });

  it("refuses a file that is not one block object", () => {
    const dir = contentDir({ "01-list.json": [{ slug: "a" }] });
    expect(() => readBlocks(dir)).toThrow(/must be one block object/);
  });

  it("refuses a block with no slug", () => {
    const dir = contentDir({ "01-grundlagen.json": { title: "A", position: 1 } });
    expect(() => readBlocks(dir)).toThrow(/a block needs a slug/);
  });

  it("🚨 refuses two blocks sharing a slug, naming both files", () => {
    const dir = contentDir({
      "01-a.json": { slug: "same", title: "A", position: 1 },
      "02-b.json": { slug: "same", title: "B", position: 2 },
    });
    expect(() => readBlocks(dir)).toThrow(/two blocks share the slug "same": 01-a\.json and 02-b\.json/);
  });

  it("refuses two blocks sharing a position", () => {
    const dir = contentDir({
      "01-a.json": { slug: "a", title: "A", position: 1 },
      "02-b.json": { slug: "b", title: "B", position: 1 },
    });
    expect(() => readBlocks(dir)).toThrow(/two blocks share position 1/);
  });

  it("refuses a unit with no slug", () => {
    const dir = contentDir({
      "01-a.json": { slug: "a", title: "A", position: 1, units: [{ title: "U", position: 1 }] },
    });
    expect(() => readBlocks(dir)).toThrow(/a unit needs a slug/);
  });

  it("🚨 refuses two units sharing a slug — one Subject Key, two lessons' learners", () => {
    const dir = contentDir({
      "01-a.json": {
        slug: "a",
        title: "A",
        position: 1,
        units: [
          { slug: "same", title: "U1", position: 1 },
          { slug: "same", title: "U2", position: 2 },
        ],
      },
    });
    expect(() => readBlocks(dir)).toThrow(/two units share the slug "same"/);
  });
});
