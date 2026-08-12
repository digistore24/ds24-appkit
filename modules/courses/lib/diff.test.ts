// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// No database, no network, no mocks: `diff.mjs` is pure, which is the whole
// reason the comparison was split out of the command.
//
// ⚠️ **No expected hex literal appears anywhere below**, and no report is
// compared against a pasted expected object either. Every claim here compares
// two reports against EACH OTHER across mutated fixtures — the shape
// `outline.test.ts` established, and for the same reason: a pasted expectation
// pins today's output rather than the property, and it is the assertion somebody
// "fixes" by regenerating it.
//
// 🚨 **A test that knows only one case proves nothing.** Two different inputs
// have to give two visibly different answers, and the difference has to be in the
// expected entry — which is why almost everything below runs `movesOnly()`
// rather than asserting a list length.
import { describe, expect, it } from "vitest";

import { compareCourse, diffCounts, sameSubject, sameSubjectPairs } from "./diff.mjs";
import { localUnitRow, unitFingerprint } from "./fingerprint.mjs";

/** One lesson as a `content/course/*.json` file spells it. */
type LocalUnit = {
  slug: string;
  title: string;
  position: number;
  body?: string | null;
  taskPrompt?: string | null;
  cover?: string | null;
  video?: string | null;
  subtitle?: string | null;
  worksheet?: string | null;
};

/** One block file, as `readBlocks()` hands it over. */
type LocalBlock = {
  file: string;
  slug: string;
  title: string;
  summary?: string | null;
  position: number;
  releaseAfterDays?: number;
  units: LocalUnit[];
};

/** Three lessons in two blocks — enough that "exactly that entry" is a real claim. */
function localCourse(): LocalBlock[] {
  return [
    {
      file: "01-grundlagen.json",
      slug: "grundlagen",
      title: "Grundlagen",
      summary: "Womit alles anfaengt",
      position: 1,
      releaseAfterDays: 0,
      units: [
        {
          slug: "lektion-1",
          title: "Lektion 1",
          position: 1,
          body: "Der Palomarknoten haelt am besten.",
          video: "knoten/palomar.mp4",
        },
        { slug: "lektion-2", title: "Lektion 2", position: 2, body: "Ein anderer Text." },
      ],
    },
    {
      file: "02-vertiefung.json",
      slug: "vertiefung",
      title: "Vertiefung",
      summary: null,
      position: 2,
      releaseAfterDays: 7,
      units: [{ slug: "lektion-3", title: "Lektion 3", position: 1, body: null }],
    },
  ];
}

/**
 * What the target would hold if this repo had already been published into it.
 *
 * 🚨 The media ids are DELIBERATELY not the local paths: a media id exists once,
 * in one database, and this is the side that has them. If the local row were
 * built from ids instead of from occupancy, this fixture alone would turn every
 * lesson with a medium into "would change".
 */
function published(blocks: LocalBlock[]): { blocks: object[] } {
  let media = 0;
  return {
    blocks: blocks.map((block) => ({
      slug: block.slug,
      title: block.title,
      summary: block.summary ?? null,
      position: block.position,
      releaseAfterDays: block.releaseAfterDays ?? 0,
      unitCount: block.units.length,
      origin: "content",
      units: block.units.map((unit) => ({
        slug: unit.slug,
        title: unit.title,
        position: unit.position,
        hasBody: Boolean(unit.body),
        hasVideo: Boolean(unit.video),
        hasWorksheet: Boolean(unit.worksheet),
        asksForSubmission: Boolean(unit.taskPrompt),
        origin: "content",
        fingerprint: unitFingerprint({
          slug: unit.slug,
          title: unit.title,
          body: unit.body ?? null,
          taskPrompt: unit.taskPrompt ?? null,
          // Ids the target minted for itself — nothing the repo could know.
          coverMediaId: unit.cover ? `med-${(media += 1)}` : null,
          videoMediaId: unit.video ? `med-${(media += 1)}` : null,
          subtitleMediaId: unit.subtitle ? `med-${(media += 1)}` : null,
          worksheetMediaId: unit.worksheet ? `med-${(media += 1)}` : null,
        }),
      })),
    })),
  };
}

type Report = ReturnType<typeof compareCourse>;
type Entry = { blockSlug: string; slug: string; title: string; origin?: string; fields?: string[] };

const LISTS = ["new", "changed", "untouched", "targetOnly", "refused"] as const;

/** Which list each slug ended up in — the value every claim below diffs. */
function placement(report: Report): Record<string, string> {
  const where: Record<string, string> = {};
  for (const kind of ["blocks", "units"] as const) {
    for (const list of LISTS) {
      for (const entry of (report[kind][list] ?? []) as Entry[]) {
        where[`${kind}:${entry.slug}`] = list;
      }
    }
  }
  return where;
}

/** The baseline: this repo, published, compared against itself. */
function baseline(): Report {
  return compareCourse(localCourse(), published(localCourse()));
}

/**
 * The one entry `mutate` touched moved from `from` to `to`, and no other one moved.
 *
 * A needle probe of its own: it asserts the CHANGED entry changed as well as
 * that the others did not, because "nothing moved" is what a comparison that
 * never ran also reports.
 */
function movesOnly(
  mutate: (local: LocalBlock[]) => void,
  key: string,
  from: string,
  to: string,
): Report {
  const before = placement(baseline());
  // Non-vacuity: the fixture's lessons must be DISTINCT, or "no other entry
  // moved" is a claim about three copies of one string.
  const prints = localCourse().flatMap((b) => b.units.map((u) => unitFingerprint(localUnitRow(u))));
  expect(new Set(prints).size, "the fixture's lessons are not distinct").toBe(prints.length);
  expect(before[key], `${key} did not start in "${from}"`).toBe(from);

  const local = localCourse();
  mutate(local);
  const report = compareCourse(local, published(localCourse()));
  const after = placement(report);

  expect(after[key], `${key} did not move to "${to}"`).toBe(to);
  for (const other of Object.keys(before)) {
    if (other === key) continue;
    expect(after[other], `${other} moved and should not have`).toBe(before[other]);
  }
  return report;
}

describe("the baseline — this repo, published, compared against itself", () => {
  it("is untouched everywhere, and the lists are not empty", () => {
    const report = baseline();
    expect(diffCounts(report)).toEqual({
      blocks: { new: 0, changed: 0, untouched: 2, targetOnly: 0, refused: 0 },
      units: { new: 0, changed: 0, untouched: 3, targetOnly: 0, refused: 0 },
    });
  });

  it("groups every lesson under the block slug it sits in", () => {
    const report = baseline();
    expect((report.units.untouched as Entry[]).map((e) => `${e.blockSlug}/${e.slug}`)).toEqual([
      "grundlagen/lektion-1",
      "grundlagen/lektion-2",
      "vertiefung/lektion-3",
    ]);
  });

  it("🚨 a block's lessons are CONTIGUOUS — no block appears twice", () => {
    // Measured against a real run, not imagined: with three lessons at
    // positions 1, 2 and 1, a sort on the lesson's own position alone
    // interleaves the blocks, and the command's grouped printer then prints the
    // heading "grundlagen" twice. "Grouped under the block it sits in" is only
    // true if the order is block-major.
    const seen: string[] = [];
    for (const entry of baseline().units.untouched as Entry[]) {
      if (seen.at(-1) !== entry.blockSlug) seen.push(entry.blockSlug);
    }
    expect(new Set(seen).size, `a block heading repeats: ${seen.join(", ")}`).toBe(seen.length);
    // Non-vacuity: there really is more than one block in the list.
    expect(seen.length).toBeGreaterThan(1);
  });

  it("names every entry by slug AND title", () => {
    for (const entry of baseline().units.untouched as Entry[]) {
      expect(entry.slug).toMatch(/^lektion-\d$/);
      expect(entry.title).toMatch(/^Lektion \d$/);
    }
  });

  it("answers the same thing twice — the report is deterministic", () => {
    expect(baseline()).toEqual(baseline());
  });

  it("orders by block, then by position, then by slug", () => {
    // Two lessons legitimately share position 1 (one per block), so neither the
    // position alone nor the slug alone makes the order reproducible.
    expect((baseline().units.untouched as Entry[]).map((e) => e.slug)).toEqual([
      "lektion-1",
      "lektion-2",
      "lektion-3",
    ]);
    expect((baseline().blocks.untouched as Entry[]).map((e) => e.slug)).toEqual([
      "grundlagen",
      "vertiefung",
    ]);
  });
});

describe("AC2 — two different inputs, two visibly different answers", () => {
  it("one lesson's body moves THAT lesson from untouched to changed", () => {
    movesOnly(
      (local) => {
        local[0].units[0].body = "Der Palomarknoten haelt am besten. Und noch ein Satz.";
      },
      "units:lektion-1",
      "untouched",
      "changed",
    );
  });

  it("the two reports really do differ", () => {
    // The claim in its plainest form: same comparison, one character apart.
    const local = localCourse();
    local[1].units[0].body = "Jetzt steht hier doch etwas.";
    const changed = compareCourse(local, published(localCourse()));
    expect(changed).not.toEqual(baseline());
    expect((changed.units.changed as Entry[]).map((e) => e.slug)).toEqual(["lektion-3"]);
  });

  it("a lesson's title moves it too", () => {
    movesOnly(
      (local) => {
        local[0].units[1].title = "Lektion 2 (ueberarbeitet)";
      },
      "units:lektion-2",
      "untouched",
      "changed",
    );
  });

  it("a lesson that starts asking for a hand-in", () => {
    movesOnly(
      (local) => {
        local[1].units[0].taskPrompt = "Schicke mir ein Foto deines Knotens.";
      },
      "units:lektion-3",
      "untouched",
      "changed",
    );
  });

  it("a lesson whose media slot fills up", () => {
    movesOnly(
      (local) => {
        local[1].units[0].worksheet = "knoten/uebung.pdf";
      },
      "units:lektion-3",
      "untouched",
      "changed",
    );
  });

  it("🚨 the same medium under a different id is NOT a change", () => {
    // The portability claim: the repo names media by PATH, the target by ID, and
    // the fingerprint hashes the occupancy of the slot. `published()` mints ids
    // the repo has never seen; if the local row were built from ids, lektion-1
    // (which has a video) would read as "would change" here.
    const withMedia = (baseline().units.untouched as Entry[]).find((e) => e.slug === "lektion-1");
    expect(withMedia, "the fixture has no lesson with a medium").toBeDefined();
    // Non-vacuity: the fixture really does carry a medium on that lesson.
    expect(localCourse()[0].units[0].video).toBeTruthy();
  });
});

describe("AC1 — a block is compared field by field, because it has no fingerprint", () => {
  for (const [field, mutate] of [
    ["title", (l: LocalBlock[]) => void (l[0].title = "Grundlagen, ueberarbeitet")],
    ["summary", (l: LocalBlock[]) => void (l[0].summary = "Anders zusammengefasst")],
    ["position", (l: LocalBlock[]) => void (l[0].position = 9)],
    ["releaseAfterDays", (l: LocalBlock[]) => void (l[0].releaseAfterDays = 14)],
  ] as const) {
    it(`${field} moves the block, and says which field moved`, () => {
      const report = movesOnly(mutate, "blocks:grundlagen", "untouched", "changed");
      const entry = (report.blocks.changed as Entry[])[0];
      expect(entry.fields, `${field} was not named`).toEqual([field]);
    });
  }

  it("a block whose lessons changed is itself untouched", () => {
    const report = movesOnly(
      (local) => {
        local[0].units[0].body = "Etwas ganz anderes.";
      },
      "units:lektion-1",
      "untouched",
      "changed",
    );
    expect((report.blocks.untouched as Entry[]).map((e) => e.slug)).toContain("grundlagen");
  });

  it("a content file that omits summary and releaseAfterDays compares as the applier writes them", () => {
    // `apply()` writes `summary ?? null` and `releaseAfterDays ?? 0`, so an
    // omitted field must not read as a change against the row it would produce.
    const local = localCourse();
    delete local[0].summary;
    delete local[0].releaseAfterDays;
    const target = published(localCourse());
    (target.blocks[0] as { summary: string | null }).summary = null;
    const report = compareCourse(local, target);
    expect((report.blocks.untouched as Entry[]).map((e) => e.slug)).toContain("grundlagen");
    expect(report.blocks.changed).toEqual([]);
  });
});

describe("AC1 — new: here and not there", () => {
  it("a lesson the repo has and the target does not", () => {
    const local = localCourse();
    local[1].units.push({ slug: "lektion-4", title: "Lektion 4", position: 2, body: "Neu." });
    const report = compareCourse(local, published(localCourse()));
    expect((report.units.new as Entry[]).map((e) => `${e.blockSlug}/${e.slug}`)).toEqual([
      "vertiefung/lektion-4",
    ]);
    expect(diffCounts(report).units.untouched).toBe(3);
  });

  it("a whole block, with its lessons", () => {
    const local = localCourse();
    local.push({
      file: "03-abschluss.json",
      slug: "abschluss",
      title: "Abschluss",
      position: 3,
      units: [{ slug: "lektion-9", title: "Lektion 9", position: 1, body: "Zum Schluss." }],
    });
    const report = compareCourse(local, published(localCourse()));
    expect((report.blocks.new as Entry[]).map((e) => e.slug)).toEqual(["abschluss"]);
    expect((report.units.new as Entry[]).map((e) => e.slug)).toEqual(["lektion-9"]);
  });

  it("an empty target is every row new, and never a crash", () => {
    const report = compareCourse(localCourse(), { blocks: [] });
    expect(diffCounts(report)).toEqual({
      blocks: { new: 2, changed: 0, untouched: 0, targetOnly: 0, refused: 0 },
      units: { new: 3, changed: 0, untouched: 0, targetOnly: 0, refused: 0 },
    });
  });

  it("no payload at all is the same answer", () => {
    expect(compareCourse(localCourse(), null)).toEqual(compareCourse(localCourse(), { blocks: [] }));
  });
});

describe("AC3 — present in the target only, and a publish deletes none of it", () => {
  /** The target holds one lesson and one block this repo no longer carries. */
  function targetWithExtras(origin: string) {
    const target = published(localCourse()) as {
      blocks: {
        slug: string;
        title: string;
        origin: string;
        position: number;
        units: { slug: string; title: string; position: number; origin: string }[];
      }[];
    };
    target.blocks[0].units.push({
      slug: "lektion-alt",
      title: "Eine Lektion von frueher",
      position: 9,
      origin,
    });
    target.blocks.push({
      slug: "block-alt",
      title: "Ein Block von frueher",
      origin,
      position: 9,
      units: [],
    });
    return target;
  }

  it("lands in targetOnly and in NO other list", () => {
    const report = compareCourse(localCourse(), targetWithExtras("content"));
    expect((report.units.targetOnly as Entry[]).map((e) => e.slug)).toEqual(["lektion-alt"]);
    expect((report.blocks.targetOnly as Entry[]).map((e) => e.slug)).toEqual(["block-alt"]);
    const seen = placement(report);
    expect(seen["units:lektion-alt"]).toBe("targetOnly");
    expect(diffCounts(report).units.untouched).toBe(3);
  });

  it("🚨 separates the rows the applier owns from the rows it does not", () => {
    const ours = compareCourse(localCourse(), targetWithExtras("content"));
    const theirs = compareCourse(localCourse(), targetWithExtras("operator"));
    expect((ours.units.targetOnly as Entry[])[0].origin).toBe("content");
    expect((theirs.units.targetOnly as Entry[])[0].origin).toBe("operator");
    // The two answers really are different reports — the whole point of carrying
    // `origin` here rather than counting rows.
    expect(ours).not.toEqual(theirs);
  });
});

describe("AC6 — a slug held by a row this applier does not own", () => {
  /** The target holds OUR slug on an operator-authored row. */
  function claimed() {
    const target = published(localCourse()) as {
      blocks: { origin: string; units: { slug: string; origin: string }[] }[];
    };
    target.blocks[0].units[1].origin = "operator";
    return target;
  }

  it("is refused, and is in refused ONLY", () => {
    const report = compareCourse(localCourse(), claimed());
    expect((report.units.refused as Entry[]).map((e) => e.slug)).toEqual(["lektion-2"]);
    expect(placement(report)["units:lektion-2"]).toBe("refused");
    expect(diffCounts(report).units).toEqual({
      new: 0,
      changed: 0,
      untouched: 2,
      targetOnly: 0,
      refused: 1,
    });
  });

  it("is refused even when the content is identical — it is not 'untouched'", () => {
    // The sharp case: the lesson's text agrees with the row over there, so a
    // fingerprint comparison alone would call it untouched. It is not: a publish
    // would refuse the WHOLE run rather than leave it alone.
    const same = compareCourse(localCourse(), published(localCourse()));
    expect(placement(same)["units:lektion-2"]).toBe("untouched");
    expect(placement(compareCourse(localCourse(), claimed()))["units:lektion-2"]).toBe("refused");
  });

  it("names the origin it found", () => {
    expect((compareCourse(localCourse(), claimed()).units.refused as Entry[])[0].origin).toBe(
      "operator",
    );
  });

  it("holds for a BLOCK too", () => {
    const target = published(localCourse()) as { blocks: { origin: string }[] };
    target.blocks[1].origin = "operator";
    const report = compareCourse(localCourse(), target);
    expect((report.blocks.refused as Entry[]).map((e) => e.slug)).toEqual(["vertiefung"]);
    expect(placement(report)["blocks:vertiefung"]).toBe("refused");
  });
});

describe("🚨 every entry appears in exactly one list", () => {
  it("across new, changed, untouched, targetOnly and refused", () => {
    const target = published(localCourse()) as {
      blocks: {
        origin: string;
        units: { slug: string; title: string; position: number; origin: string }[];
      }[];
    };
    target.blocks[0].units[1].origin = "operator";
    target.blocks[1].units.push({
      slug: "lektion-alt",
      title: "Von frueher",
      position: 9,
      origin: "content",
    });
    const local = localCourse();
    local[0].units[0].body = "Geaendert.";
    local[1].units.push({ slug: "lektion-neu", title: "Neu", position: 2, body: "Neu." });

    const report = compareCourse(local, target);
    const all = LISTS.flatMap((list) => (report.units[list] as Entry[]).map((e) => e.slug));
    expect(new Set(all).size, `a slug is in two lists: ${all.join(", ")}`).toBe(all.length);
    // Non-vacuity: four of the five lists really are occupied here.
    expect(diffCounts(report).units).toEqual({
      new: 1,
      changed: 1,
      untouched: 1,
      targetOnly: 1,
      refused: 1,
    });
  });
});

describe("🚨 a field the target does not send is NOT compared, and says so", () => {
  /** An older deploy: no `origin`, no `summary` on the payload. */
  function olderTarget() {
    const target = published(localCourse()) as {
      blocks: { summary?: unknown; origin?: unknown; units: { origin?: unknown }[] }[];
    };
    for (const block of target.blocks) {
      delete block.summary;
      delete block.origin;
      for (const unit of block.units) delete unit.origin;
    }
    return target;
  }

  it("names every field it could not compare", () => {
    expect(compareCourse(localCourse(), olderTarget()).notCompared).toEqual([
      "block summary",
      "block origin",
      "lesson origin",
    ]);
  });

  it("does not report every block as changed because summary is missing", () => {
    // The defect this exists for: `undefined` compared against a real summary
    // would make a report of nothing but false positives.
    expect(compareCourse(localCourse(), olderTarget()).blocks.changed).toEqual([]);
  });

  it("says nothing when the payload carries everything", () => {
    expect(baseline().notCompared).toEqual([]);
  });
});

describe("sameSubject — the boundary this app draws, and refuses to move", () => {
  // 🚨 Each case carries its reason in the name, because the rule is not obvious
  // and the next session's instinct is to "improve" it into a similarity score.
  // The asymmetry that forbids that is in `diff.mjs`'s header.

  it("case and whitespace are noise: 'Grundlagen' and '  grundlagen ' are one subject", () => {
    expect(sameSubject("Grundlagen", "  grundlagen ")).toBe(true);
    expect(sameSubject("Grundlagen  der\tKnoten", "grundlagen der knoten")).toBe(true);
  });

  it("🚨 'Grundlagen' and 'Grundlagen für Fortgeschrittene' are NOT — an includes() would overwrite a course", () => {
    // The whole reason there is no `includes()` and no edit distance: these two
    // are a beginners' course and an advanced one, and answering "update" on
    // this pair replaces the lessons customers are working through.
    expect(sameSubject("Grundlagen", "Grundlagen für Fortgeschrittene")).toBe(false);
    expect(sameSubject("Grundlagen für Fortgeschrittene", "Grundlagen")).toBe(false);
  });

  it("no edit distance either — one character apart is a different subject", () => {
    expect(sameSubject("Knoten", "Knopf")).toBe(false);
    expect(sameSubject("Lektion 1", "Lektion 2")).toBe(false);
  });

  it("a title nobody wrote is not a subject — two blanks are two unknowns", () => {
    expect(sameSubject("", "")).toBe(false);
    expect(sameSubject("   ", "")).toBe(false);
  });
});

describe("AC1/AC2/AC7 — same subject, different slug", () => {
  /** The local course, with something renamed, as the TARGET already holds it. */
  function targetWith(mutate: (blocks: LocalBlock[]) => void) {
    const blocks = localCourse();
    mutate(blocks);
    return published(blocks);
  }

  /** `kind local-slug → target-slug`, the one value every claim below diffs. */
  const shape = (pairs: ReturnType<typeof sameSubjectPairs>) =>
    pairs.map((pair) => `${pair.kind} ${pair.local.slug} → ${pair.target.slug}`);

  it("AC1 — a block under another slug, same title, is a pair", () => {
    const target = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
    });
    // Non-vacuity, both halves: the slugs really differ and the titles really
    // are equal. Without this, "a pair was found" could be a pair of one row
    // with itself.
    expect(localCourse()[0].slug).not.toBe("kurs-grundlagen");
    expect((target.blocks[0] as { title: string }).title).toBe(localCourse()[0].title);

    expect(shape(sameSubjectPairs(localCourse(), target))).toEqual([
      "block grundlagen → kurs-grundlagen",
    ]);
  });

  it("AC2 — no pair when nothing matches, and the SAME fixture with the title restored does pair", () => {
    // 🚨 Both directions, in one test, because "nothing matched" is also what a
    // matcher that never ran reports. The two targets differ in the title alone.
    const renamedOnly = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
    });
    const renamedAndRetitled = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
      blocks[0].title = "Etwas voellig anderes";
    });

    // Non-vacuity: the fixtures really are distinct, and only in the title.
    expect(renamedOnly).not.toEqual(renamedAndRetitled);
    expect((renamedAndRetitled.blocks[0] as { slug: string }).slug).toBe(
      (renamedOnly.blocks[0] as { slug: string }).slug,
    );

    expect(shape(sameSubjectPairs(localCourse(), renamedOnly))).toEqual([
      "block grundlagen → kurs-grundlagen",
    ]);
    expect(sameSubjectPairs(localCourse(), renamedAndRetitled)).toEqual([]);
  });

  it("AC2 — the case/whitespace boundary decides a real pair, not only a string comparison", () => {
    const cased = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
      blocks[0].title = "  grundlagen ";
    });
    expect(shape(sameSubjectPairs(localCourse(), cased))).toEqual([
      "block grundlagen → kurs-grundlagen",
    ]);

    // …and the one that must NOT pair, through the whole function rather than
    // through `sameSubject()` alone: an `includes()` here overwrites a course.
    const narrower = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
      blocks[0].title = "Grundlagen für Fortgeschrittene";
    });
    expect(sameSubjectPairs(localCourse(), narrower)).toEqual([]);
  });

  it("🚨 AC7 — an exact slug match is never a pair, even with identical titles", () => {
    // The baseline is this repo published into the target: every slug matches
    // and every title matches. A matcher that paired a slug with itself would
    // ask a question the operator has already answered.
    const baselineTarget = published(localCourse());
    // Non-vacuity: the titles really are identical on both sides, so the ONLY
    // thing keeping this out of the pair list is the slug exclusion.
    expect((baselineTarget.blocks[0] as { title: string }).title).toBe(localCourse()[0].title);
    expect((baselineTarget.blocks[0] as { slug: string }).slug).toBe(localCourse()[0].slug);

    expect(sameSubjectPairs(localCourse(), baselineTarget)).toEqual([]);
  });

  it("a lesson under another slug, inside the same block, is a pair", () => {
    const target = targetWith((blocks) => {
      blocks[0].units[0].slug = "lektion-eins";
    });
    expect(shape(sameSubjectPairs(localCourse(), target))).toEqual([
      "lesson lektion-1 → lektion-eins",
    ]);
  });

  it("🚨 two lessons of the same name in UNRELATED blocks are not a pair", () => {
    // Task 1's extra condition. Two lessons called "Einleitung" in two different
    // blocks are how courses are written, not a collision.
    const local = localCourse();
    local[1].units.push({ slug: "einleitung-v", title: "Einleitung", position: 2, body: "V." });

    const target = published(localCourse()) as {
      blocks: { slug: string; units: { slug: string; title: string; position: number; origin: string }[] }[];
    };
    target.blocks[0].units.push({
      slug: "einleitung-g",
      title: "Einleitung",
      position: 3,
      origin: "content",
    });

    // Non-vacuity: the two really are titled the same, sit under different
    // slugs, and each is on exactly one side — so the ONLY thing keeping them
    // apart is the block condition.
    expect(sameSubject("Einleitung", "Einleitung")).toBe(true);
    const report = compareCourse(local, target);
    expect((report.units.new as Entry[]).map((e) => e.slug)).toContain("einleitung-v");
    expect((report.units.targetOnly as Entry[]).map((e) => e.slug)).toContain("einleitung-g");

    expect(sameSubjectPairs(local, target)).toEqual([]);
  });

  it("…and the same two lessons inside ONE block are a pair", () => {
    // The other direction of the claim above: the block condition is what
    // decides it, and nothing else changed.
    const local = localCourse();
    local[0].units.push({ slug: "einleitung-v", title: "Einleitung", position: 3, body: "V." });

    const target = published(localCourse()) as {
      blocks: { units: { slug: string; title: string; position: number; origin: string }[] }[];
    };
    target.blocks[0].units.push({
      slug: "einleitung-g",
      title: "Einleitung",
      position: 3,
      origin: "content",
    });

    expect(shape(sameSubjectPairs(local, target))).toEqual(["lesson einleitung-v → einleitung-g"]);
  });

  it("a lesson pairs across two blocks that are THEMSELVES a pair", () => {
    // The block was renamed and its lesson with it — the ordinary shape of
    // "the same course, published under other names".
    const target = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
      blocks[0].units[0].slug = "lektion-eins";
    });
    expect(shape(sameSubjectPairs(localCourse(), target))).toEqual([
      "block grundlagen → kurs-grundlagen",
      "lesson lektion-1 → lektion-eins",
    ]);
  });

  it("🚨 carries the target row's origin, so the report can choose the refusal line", () => {
    const ours = sameSubjectPairs(
      localCourse(),
      targetWith((blocks) => {
        blocks[0].slug = "kurs-grundlagen";
      }),
    );
    expect(ours[0].target.origin).toBe("content");

    const theirs = sameSubjectPairs(
      localCourse(),
      (() => {
        const target = targetWith((blocks) => {
          blocks[0].slug = "kurs-grundlagen";
        }) as { blocks: { origin: string }[] };
        target.blocks[0].origin = "operator";
        return target;
      })(),
    );
    expect(theirs[0].target.origin).toBe("operator");
    // The two really are different answers — the whole point of carrying it.
    expect(ours).not.toEqual(theirs);
  });

  it("🚨 an app that does not send origin reads as null, never as 'content'", () => {
    // NFR-60 at the level of one field: "I could not look" and "the applier owns
    // it" must not be the same value, or the report offers an update that the
    // publish would refuse.
    const target = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
    }) as { blocks: { origin?: unknown }[] };
    for (const block of target.blocks) delete block.origin;

    const pairs = sameSubjectPairs(localCourse(), target);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].target.origin).toBeNull();
  });

  it("names both sides by slug AND title, on both halves of the pair", () => {
    const pair = sameSubjectPairs(
      localCourse(),
      targetWith((blocks) => {
        blocks[0].slug = "kurs-grundlagen";
        blocks[0].title = "grundlagen";
      }),
    )[0];
    expect(pair.local).toMatchObject({ slug: "grundlagen", title: "Grundlagen" });
    expect(pair.target).toMatchObject({ slug: "kurs-grundlagen", title: "grundlagen" });
  });

  it("answers the same thing twice, and an empty target pairs nothing", () => {
    const target = targetWith((blocks) => {
      blocks[0].slug = "kurs-grundlagen";
    });
    expect(sameSubjectPairs(localCourse(), target)).toEqual(sameSubjectPairs(localCourse(), target));
    // Everything is new and nothing is over there: no pair is possible.
    expect(sameSubjectPairs(localCourse(), { blocks: [] })).toEqual([]);
    expect(sameSubjectPairs(localCourse(), null)).toEqual([]);
  });
});

describe("localUnitRow — the repo's side of the comparison", () => {
  it("🚨 keeps `null` and `\"\"` apart", () => {
    // The `normalizeText()` trap, arriving from the other side: a lesson with no
    // body and a lesson with an empty body are different rows.
    expect(unitFingerprint(localUnitRow({ slug: "s", title: "T" }))).not.toBe(
      unitFingerprint(localUnitRow({ slug: "s", title: "T", body: "" })),
    );
    expect(unitFingerprint(localUnitRow({ slug: "s", title: "T", body: null }))).toBe(
      unitFingerprint(localUnitRow({ slug: "s", title: "T" })),
    );
  });

  it("maps the four media slots as OCCUPANCY, never as a value", () => {
    const row = localUnitRow({
      slug: "s",
      title: "T",
      cover: "a/cover.png",
      video: "a/film.mp4",
      subtitle: "a/film.vtt",
      worksheet: "a/blatt.pdf",
    });
    // Not the path — a path is meaningless to the side that holds ids.
    expect(JSON.stringify(row)).not.toContain("a/cover.png");
    expect(Boolean(row.coverMediaId)).toBe(true);
    expect(Boolean(row.videoMediaId)).toBe(true);
    // And a different medium in the same slot hashes the same, which is the
    // known limit `fingerprint.mjs` records rather than papers over.
    expect(unitFingerprint(localUnitRow({ slug: "s", title: "T", video: "a.mp4" }))).toBe(
      unitFingerprint(localUnitRow({ slug: "s", title: "T", video: "b.mp4" })),
    );
  });

  it("an empty slot and a filled one are different rows", () => {
    expect(unitFingerprint(localUnitRow({ slug: "s", title: "T" }))).not.toBe(
      unitFingerprint(localUnitRow({ slug: "s", title: "T", video: "a.mp4" })),
    );
  });
});
