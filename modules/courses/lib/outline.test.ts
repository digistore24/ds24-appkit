// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// No database and no mocking: `outline.ts` is pure, which is the whole reason
// the shape was split out of the tool's `run()`.
//
// ⚠️ **No expected hex literal appears anywhere below, deliberately.** A pasted
// digest pins the ALGORITHM rather than the property, and it is the assertion
// that gets "fixed" by regenerating it the first time it fails. Every claim here
// compares fingerprints against EACH OTHER across mutated fixtures.
import { describe, expect, it } from "vitest";

import { outlinePayload, unitFingerprint } from "./outline";
import type { BlockWithUnits } from "./manage";

type UnitRow = BlockWithUnits["units"][number];

/** The needles: long, recognisable sentences that must never reach the payload. */
const BODY_NEEDLE =
  "Der Palomarknoten haelt am besten, und er ist in zehn Sekunden gebunden — das ist die ganze Lektion.";
const PROMPT_NEEDLE =
  "Schicke mir ein Foto deines ersten Palomarknotens und schreibe dazu, was dabei schwierig war.";

function unit(over: Partial<UnitRow> = {}): UnitRow {
  return {
    id: "u-1",
    slug: "erste-schritte",
    title: "Erste Schritte",
    position: 1,
    origin: "content",
    body: BODY_NEEDLE,
    coverMediaId: null,
    videoMediaId: "med-video-1",
    subtitleMediaId: null,
    worksheetMediaId: null,
    taskPrompt: null,
    ...over,
  };
}

function block(over: Partial<BlockWithUnits> = {}): BlockWithUnits {
  return {
    id: "b-1",
    slug: "grundlagen",
    title: "Grundlagen",
    summary: "Womit alles anfaengt",
    position: 1,
    releaseAfterDays: 0,
    origin: "content",
    units: [unit()],
    ...over,
  };
}

/** Every unit's fingerprint, block by block — the value the sensitivity tests diff. */
function prints(blocks: BlockWithUnits[]): string[][] {
  return outlinePayload(blocks).blocks.map((b) => b.units.map((u) => u.fingerprint));
}

/** Three lessons in two blocks — enough that "exactly that lesson" is a real claim. */
function course(): BlockWithUnits[] {
  return [
    block({
      units: [
        unit({ id: "u-1", slug: "lektion-1", title: "Lektion 1", position: 1 }),
        unit({ id: "u-2", slug: "lektion-2", title: "Lektion 2", position: 2, body: "Ein anderer Text." }),
      ],
    }),
    block({
      id: "b-2",
      slug: "vertiefung",
      title: "Vertiefung",
      position: 2,
      releaseAfterDays: 7,
      // All four slots empty, so the "null → non-null" probes below have
      // somewhere to land. The two lessons above keep a video.
      units: [
        unit({ id: "u-3", slug: "lektion-3", title: "Lektion 3", position: 1, body: null, videoMediaId: null }),
      ],
    }),
  ];
}

/**
 * The one lesson `mutate` touched moved, and no other one did.
 *
 * A needle probe of its own: it asserts the CHANGED position changed as well as
 * that the others did not, because "nothing moved" is what a comparison that
 * never ran also reports.
 */
function movesOnly(mutate: (blocks: BlockWithUnits[]) => void, at: [number, number]): void {
  const before = prints(course());
  // Non-vacuity: three DISTINCT lessons, so "no other one moved" is a claim
  // about the comparison rather than about three copies of one string.
  const flat = before.flat();
  expect(new Set(flat).size, "the fixture's lessons are not distinct").toBe(flat.length);

  const after = course();
  mutate(after);
  const now = prints(after);

  const [bi, ui] = at;
  expect(now[bi][ui], "the mutated lesson's fingerprint did NOT move").not.toBe(before[bi][ui]);

  for (let b = 0; b < before.length; b += 1) {
    for (let u = 0; u < before[b].length; u += 1) {
      if (b === bi && u === ui) continue;
      expect(now[b][u], `lesson [${b}][${u}] moved and should not have`).toBe(before[b][u]);
    }
  }
}

/** Nothing moved anywhere. For the fields the fingerprint must be blind to. */
function movesNothing(mutate: (blocks: BlockWithUnits[]) => void): void {
  const before = prints(course());
  const after = course();
  mutate(after);
  expect(prints(after)).toEqual(before);
}

describe("the refusal this surface is built on", () => {
  // 🚨 The leak test, and the first one this surface has ever had.
  // `courses_outline` calls `courseOutline()`, which is a `select()` — every
  // column of every unit, `body` included — and the ONLY thing keeping the prose
  // out of the payload is this mapping step. `content-source.test.ts` makes the
  // analogous assertion for `findMedia()`; this is the same claim for the outline.
  it("🚨 puts no lesson text on the payload, body or task prompt", () => {
    const payload = JSON.stringify(
      outlinePayload([block({ units: [unit({ body: BODY_NEEDLE, taskPrompt: PROMPT_NEEDLE })] })]),
    );

    expect(
      payload,
      "a lesson BODY reached the outline payload — the tool's header argues this exact refusal",
    ).not.toContain(BODY_NEEDLE);
    expect(
      payload,
      "a lesson's TASK PROMPT reached the outline payload — it is text the operator wrote for a member to read",
    ).not.toContain(PROMPT_NEEDLE);
    // Non-vacuity: the needles really were in the input, so a mapping that
    // dropped the units entirely could not pass the two assertions above.
    expect(payload).toContain("erste-schritte");
  });

  it("🚨 exposes exactly these unit keys, so a new field cannot arrive unnoticed", () => {
    const [only] = outlinePayload([block()]).blocks;
    expect(Object.keys(only.units[0]).sort()).toEqual(
      [
        "asksForSubmission",
        "fingerprint",
        "hasBody",
        "hasVideo",
        "hasWorksheet",
        // Story 35.2. The set was EXTENDED by one name, deliberately, in the
        // commit that put it on the payload — never loosened, because this
        // assertion is the thing keeping lesson prose off this surface.
        "origin",
        "position",
        "slug",
        "title",
      ].sort(),
    );
  });

  it("exposes exactly these block keys", () => {
    const [only] = outlinePayload([block()]).blocks;
    expect(Object.keys(only).sort()).toEqual(
      // `origin` and `summary` arrived with Story 35.2 — the block's four
      // applied fields have to be comparable, and `summary` was the missing one.
      ["origin", "position", "releaseAfterDays", "slug", "summary", "title", "unitCount", "units"].sort(),
    );
  });

  it("carries no media id, on any slot", () => {
    const payload = JSON.stringify(
      outlinePayload([
        block({
          units: [
            unit({
              coverMediaId: "med-cover-77",
              videoMediaId: "med-video-77",
              subtitleMediaId: "med-sub-77",
              worksheetMediaId: "med-work-77",
            }),
          ],
        }),
      ]),
    );
    expect(payload).not.toContain("med-cover-77");
    expect(payload).not.toContain("med-video-77");
    expect(payload).not.toContain("med-sub-77");
    expect(payload).not.toContain("med-work-77");
  });
});

describe("the fingerprint's shape", () => {
  it("is 64 lowercase hex characters, never truncated", () => {
    expect(unitFingerprint(unit())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stability — the same content answers the same string", () => {
  it("twice in a row", () => {
    expect(unitFingerprint(unit())).toBe(unitFingerprint(unit()));
  });

  it("across a whole payload built twice", () => {
    expect(prints(course())).toEqual(prints(course()));
  });
});

describe("sensitivity — a change moves exactly that lesson", () => {
  it("the body", () => {
    movesOnly((blocks) => {
      blocks[0].units[0].body = `${BODY_NEEDLE} Und noch ein Satz.`;
    }, [0, 0]);
  });

  it("the title", () => {
    movesOnly((blocks) => {
      blocks[0].units[1].title = "Lektion 2 (ueberarbeitet)";
    }, [0, 1]);
  });

  it("the slug", () => {
    movesOnly((blocks) => {
      blocks[1].units[0].slug = "lektion-3-neu";
    }, [1, 0]);
  });

  it("the task prompt — a lesson that starts asking for a hand-in", () => {
    movesOnly((blocks) => {
      blocks[1].units[0].taskPrompt = PROMPT_NEEDLE;
    }, [1, 0]);
  });

  // All FOUR slots, including the two the payload does not expose as booleans:
  // the applier writes them, so a publish can change them, so they are hashed.
  for (const slot of ["coverMediaId", "videoMediaId", "subtitleMediaId", "worksheetMediaId"] as const) {
    it(`${slot} going from empty to filled`, () => {
      movesOnly((blocks) => {
        blocks[1].units[0][slot] = "med-newly-attached";
      }, [1, 0]);
    });
  }

  it("a slot going from filled back to empty", () => {
    movesOnly((blocks) => {
      blocks[0].units[0].videoMediaId = null;
    }, [0, 0]);
  });
});

describe("insensitivity — what a publish cannot change must not move it", () => {
  it("the unit's row id", () => {
    movesNothing((blocks) => {
      blocks[0].units[0].id = "u-minted-in-another-database";
      blocks[1].units[0].id = "u-and-another";
    });
  });

  it("the unit's position", () => {
    movesNothing((blocks) => {
      blocks[0].units[0].position = 99;
      blocks[0].units[1].position = 98;
    });
  });

  it("the unit's origin", () => {
    movesNothing((blocks) => {
      blocks[0].units[0].origin = "operator";
    });
  });

  // 🚨 The sharpest one. A media id exists once, in one database, so hashing it
  // would make DEV and PROD disagree about a lesson that is byte-identical in
  // both — the exact failure the fingerprint exists to prevent.
  it("every media id, while the slot stays occupied", () => {
    let rewritten = 0;
    movesNothing((blocks) => {
      for (const b of blocks) {
        for (const u of b.units) {
          rewritten += [u.coverMediaId, u.videoMediaId, u.subtitleMediaId, u.worksheetMediaId].filter(
            (id) => id !== null,
          ).length;
          if (u.coverMediaId !== null) u.coverMediaId = "med-prod-cover";
          if (u.videoMediaId !== null) u.videoMediaId = "med-prod-video";
          if (u.subtitleMediaId !== null) u.subtitleMediaId = "med-prod-sub";
          if (u.worksheetMediaId !== null) u.worksheetMediaId = "med-prod-work";
        }
      }
    });
    // Non-vacuity: a fixture with no media at all would pass the line above
    // while proving nothing about media ids.
    expect(rewritten, "no media id was rewritten — the fixture has none").toBeGreaterThan(0);
  });

  it("the block's id, slug, title, summary, position and releaseAfterDays", () => {
    movesNothing((blocks) => {
      blocks[0].id = "b-elsewhere";
      blocks[0].slug = "grundlagen-neu";
      blocks[0].title = "Grundlagen, ueberarbeitet";
      blocks[0].summary = null;
      blocks[0].position = 42;
      blocks[0].releaseAfterDays = 21;
      blocks[0].origin = "operator";
    });
  });

  // `blockId` and `createdAt` need no test and cannot have one:
  // `courseOutline()` strips both off the unit before it returns, so they never
  // reach `unitFingerprint()` at all.
  it("does not read blockId or createdAt — they are not on the row it is handed", () => {
    const row = unit() as Record<string, unknown>;
    expect(Object.hasOwn(row, "blockId")).toBe(false);
    expect(Object.hasOwn(row, "createdAt")).toBe(false);
  });
});

describe("line endings — the same lesson on Windows and on Linux", () => {
  const lf = "Zeile eins\nZeile zwei\nZeile drei";

  it("CRLF hashes like LF", () => {
    expect(unitFingerprint(unit({ body: lf.replace(/\n/g, "\r\n") }))).toBe(
      unitFingerprint(unit({ body: lf })),
    );
  });

  it("a lone CR hashes like LF", () => {
    expect(unitFingerprint(unit({ body: lf.replace(/\n/g, "\r") }))).toBe(
      unitFingerprint(unit({ body: lf })),
    );
  });

  it("the task prompt is normalised too", () => {
    expect(unitFingerprint(unit({ taskPrompt: "Frage eins\r\nFrage zwei" }))).toBe(
      unitFingerprint(unit({ taskPrompt: "Frage eins\nFrage zwei" })),
    );
  });

  it("and the normalisation is not a blanket whitespace collapse", () => {
    // A trailing space is a change an operator made and can see in their file.
    expect(unitFingerprint(unit({ body: "Text " }))).not.toBe(unitFingerprint(unit({ body: "Text" })));
  });
});

describe("null is not empty", () => {
  it("a lesson with no body and a lesson with an empty body are different rows", () => {
    expect(unitFingerprint(unit({ body: null }))).not.toBe(unitFingerprint(unit({ body: "" })));
  });

  it("the same holds for the task prompt", () => {
    expect(unitFingerprint(unit({ taskPrompt: null }))).not.toBe(
      unitFingerprint(unit({ taskPrompt: "" })),
    );
  });
});

describe("unitCount", () => {
  it("equals the block's unit array length", () => {
    const payload = outlinePayload(course());
    expect(payload.blocks.map((b) => b.unitCount)).toEqual([2, 1]);
    expect(payload.blocks.map((b) => b.units.length)).toEqual([2, 1]);
  });

  it("is 0 for a block nobody has written a lesson into yet", () => {
    const payload = outlinePayload([block({ units: [] })]);
    expect(payload.blocks[0].unitCount).toBe(0);
    expect(payload.blocks[0].units).toEqual([]);
  });

  it("an empty course is an empty block list", () => {
    expect(outlinePayload([])).toEqual({ blocks: [] });
  });
});

describe("everything the tool returned before is still there, unchanged", () => {
  it("block and unit fields keep their values", () => {
    const [only] = outlinePayload([
      block({
        units: [unit({ body: null, taskPrompt: PROMPT_NEEDLE, videoMediaId: null, worksheetMediaId: "med-w" })],
      }),
    ]).blocks;

    expect(only.slug).toBe("grundlagen");
    expect(only.title).toBe("Grundlagen");
    expect(only.position).toBe(1);
    expect(only.releaseAfterDays).toBe(0);

    const [u] = only.units;
    expect(u.slug).toBe("erste-schritte");
    expect(u.title).toBe("Erste Schritte");
    expect(u.position).toBe(1);
    expect(u.hasBody).toBe(false);
    expect(u.hasVideo).toBe(false);
    expect(u.hasWorksheet).toBe(true);
    expect(u.asksForSubmission).toBe(true);
  });

  it("blocks and units keep the order they were handed in", () => {
    const payload = outlinePayload(course());
    expect(payload.blocks.map((b) => b.slug)).toEqual(["grundlagen", "vertiefung"]);
    expect(payload.blocks[0].units.map((u) => u.slug)).toEqual(["lektion-1", "lektion-2"]);
  });
});
