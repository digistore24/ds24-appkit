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

import { mediaIdsIn, outlinePayload, unitFingerprint } from "./outline";
import { FINGERPRINT_VERSION } from "./fingerprint.mjs";
import type { BlockWithUnits } from "./manage";

type UnitRow = BlockWithUnits["units"][number];

/**
 * The join `mediaKeysFor()` makes, as a fixture — one deterministic key per id.
 *
 * 🚨 **Derived from the id rather than hand-kept**, because that is what makes
 * the two claims below different claims. A NEW id gets a NEW key, which is what
 * a swapped video really is (a second media row under a second manifest path);
 * `pin` is how a test says the opposite — *another database's id for the same
 * file* — which is the DEV/PROD portability property and the one thing the
 * previous design got right.
 */
function keysFor(blocks: BlockWithUnits[], pin: Record<string, string> = {}): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of mediaIdsIn(blocks)) if (id) map.set(id, pin[id] ?? `content/kurs/${id}.mp4`);
  return map;
}

/** One row in the shape `outlinePayload()` hands to the hash: the row plus its four keys. */
function hashable(row: UnitRow, pin: Record<string, string> = {}) {
  const key = (id: string | null) => (id === null ? null : (pin[id] ?? `content/kurs/${id}.mp4`));
  return {
    ...row,
    coverKey: key(row.coverMediaId),
    videoKey: key(row.videoMediaId),
    subtitleKey: key(row.subtitleMediaId),
    worksheetKey: key(row.worksheetMediaId),
  };
}

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

/** One lesson's fingerprint straight from a row — the shape the payload builds. */
const fp = (over: Partial<UnitRow> = {}) => unitFingerprint(hashable(unit(over)));

/**
 * `outlinePayload()` with the media join already made — the shape the tool calls.
 *
 * ⚠️ It is a helper here and NOT a default parameter on the function itself: an
 * `outlinePayload(blocks)` that quietly resolved no keys is exactly the mistake
 * the required argument exists to make unspellable (`./outline.ts` says why).
 * A test may hand it a fixture; production may not hand it nothing.
 */
const payloadOf = (blocks: BlockWithUnits[], pin: Record<string, string> = {}) =>
  outlinePayload(blocks, keysFor(blocks, pin));

/** Every unit's fingerprint, block by block — the value the sensitivity tests diff. */
function prints(blocks: BlockWithUnits[], pin: Record<string, string> = {}): string[][] {
  return outlinePayload(blocks, keysFor(blocks, pin)).blocks.map((b) =>
    b.units.map((u) => u.fingerprint),
  );
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
function movesOnly(
  mutate: (blocks: BlockWithUnits[]) => void,
  at: [number, number],
  pin: Record<string, string> = {},
): void {
  const before = prints(course());
  // Non-vacuity: three DISTINCT lessons, so "no other one moved" is a claim
  // about the comparison rather than about three copies of one string.
  const flat = before.flat();
  expect(new Set(flat).size, "the fixture's lessons are not distinct").toBe(flat.length);

  const after = course();
  mutate(after);
  const now = prints(after, pin);

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
function movesNothing(
  mutate: (blocks: BlockWithUnits[]) => void,
  pin: Record<string, string> = {},
): void {
  const before = prints(course());
  const after = course();
  mutate(after);
  expect(prints(after, pin)).toEqual(before);
}

describe("the refusal this surface is built on", () => {
  // 🚨 The leak test, and the first one this surface has ever had.
  // `courses_outline` calls `courseOutline()`, which is a `select()` — every
  // column of every unit, `body` included — and the ONLY thing keeping the prose
  // out of the payload is this mapping step. `content-source.test.ts` makes the
  // analogous assertion for `findMedia()`; this is the same claim for the outline.
  it("🚨 puts no lesson text on the payload, body or task prompt", () => {
    const payload = JSON.stringify(
      payloadOf([block({ units: [unit({ body: BODY_NEEDLE, taskPrompt: PROMPT_NEEDLE })] })]),
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
    const [only] = payloadOf([block()]).blocks;
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
    const [only] = payloadOf([block()]).blocks;
    expect(Object.keys(only).sort()).toEqual(
      // `origin` and `summary` arrived with Story 35.2 — the block's four
      // applied fields have to be comparable, and `summary` was the missing one.
      ["origin", "position", "releaseAfterDays", "slug", "summary", "title", "unitCount", "units"].sort(),
    );
  });

  it("carries no media id, on any slot", () => {
    const payload = JSON.stringify(
      payloadOf([
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
    expect(fp()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stability — the same content answers the same string", () => {
  it("twice in a row", () => {
    expect(fp()).toBe(fp());
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

  // ── 🚨 A29/A49: one file SWAPPED for another in the same slot ─────────────
  // The defect this whole design replaced. While the slots were hashed as a
  // boolean, `video → another video` was invisible: measured end to end against
  // a real Postgres, a lesson moved from `kurs/knoten.mp4` to
  // `kurs/palomar.mp4` came back as `0 would change · 2 untouched`, both sides
  // on the same digest. Occupancy is unchanged in every one of these, which is
  // exactly why the old shape could not see them.
  for (const [slot, replacement] of [
    ["coverMediaId", "med-cover-2"],
    ["videoMediaId", "med-video-2"],
    ["subtitleMediaId", "med-subtitle-2"],
    ["worksheetMediaId", "med-worksheet-2"],
  ] as const) {
    it(`🚨 ${slot} swapped for ANOTHER file, the slot staying occupied`, () => {
      // The lesson has to hold the slot on BOTH sides, or "swapped" is "filled".
      const base = course();
      base[0].units[0][slot] = "med-first";
      const before = prints(base);
      expect(before.flat().length, "no lesson was fingerprinted at all").toBe(3);

      const after = course();
      after[0].units[0][slot] = replacement;
      // Non-vacuity, the count guard of this test: occupied before, occupied
      // after, and the two are different files.
      expect(base[0].units[0][slot], "the slot was empty before — a fill, not a swap").not.toBeNull();
      expect(after[0].units[0][slot], "the slot is empty after — an emptying, not a swap").not.toBeNull();
      expect(after[0].units[0][slot], "the same file on both sides").not.toBe(base[0].units[0][slot]);

      const now = prints(after);
      expect(
        now[0][0],
        `${slot} was swapped for another file and the fingerprint did not move — a lesson whose ` +
          `video was replaced reads as UNTOUCHED in courses-diff, which is A49`,
      ).not.toBe(before[0][0]);
      expect(now[0][1], "the OTHER lesson in that block moved").toBe(before[0][1]);
      expect(now[1][0], "a lesson in the other block moved").toBe(before[1][0]);
    });
  }
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

  // 🚨 The sharpest one, and the property the storage key had to preserve. A
  // media id exists once, in one database: PROD's row for the very same file
  // carries a different UUID. Hashing the id would make DEV and PROD disagree
  // about a lesson that is byte-identical in both — the exact failure this
  // exists to prevent, and the reason the OCCUPANCY boolean was the answer
  // until the key made a better one available.
  //
  // ⚠️ The `pin` is what makes this the right claim rather than the old one:
  // the ids are rewritten AND every new id resolves to the key its predecessor
  // resolved to, which is precisely "another database, same file". Without it
  // the fixture's derived keys would move with the ids and this test would be
  // asserting the swap case with the wrong words.
  it("every media id, while the slot stays occupied and the FILE is the same", () => {
    let rewritten = 0;
    movesNothing(
      (blocks) => {
        for (const b of blocks) {
          for (const u of b.units) {
            rewritten += [
              u.coverMediaId,
              u.videoMediaId,
              u.subtitleMediaId,
              u.worksheetMediaId,
            ].filter((id) => id !== null).length;
            if (u.coverMediaId !== null) u.coverMediaId = "med-prod-cover";
            if (u.videoMediaId !== null) u.videoMediaId = "med-prod-video";
            if (u.subtitleMediaId !== null) u.subtitleMediaId = "med-prod-sub";
            if (u.worksheetMediaId !== null) u.worksheetMediaId = "med-prod-work";
          }
        }
      },
      {
        // PROD's ids, DEV's files. `med-video-1` is the only slot the fixture
        // fills, so this is the key `keysFor()` derived for it before the
        // rewrite — hand-written here because the point is that the two
        // DATABASES agree, which a derivation would hide.
        "med-prod-cover": "content/kurs/med-cover-1.mp4",
        "med-prod-video": "content/kurs/med-video-1.mp4",
        "med-prod-sub": "content/kurs/med-subtitle-1.mp4",
        "med-prod-work": "content/kurs/med-worksheet-1.mp4",
      },
    );
    // Non-vacuity: a fixture with no media at all would pass the line above
    // while proving nothing about media ids.
    expect(rewritten, "no media id was rewritten — the fixture has none").toBeGreaterThan(0);
  });

  // The other half of that claim, and the one the boolean could not make: two
  // environments holding the same FILE agree even when nothing else does.
  it("🚨 the same file under two databases' ids fingerprints identically", () => {
    const dev = unitFingerprint(hashable(unit({ videoMediaId: "med-dev-77" }), {
      "med-dev-77": "content/kurs/knoten.mp4",
    }));
    const prod = unitFingerprint(hashable(unit({ videoMediaId: "med-prod-88" }), {
      "med-prod-88": "content/kurs/knoten.mp4",
    }));
    const other = unitFingerprint(hashable(unit({ videoMediaId: "med-prod-88" }), {
      "med-prod-88": "content/kurs/palomar.mp4",
    }));

    expect(dev, "two databases disagree about a lesson that is identical in both").toBe(prod);
    // Non-vacuity: the comparison above is not two copies of one constant.
    expect(other, "a different FILE fingerprinted the same — the key is not being read").not.toBe(dev);
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
    expect(fp({ body: lf.replace(/\n/g, "\r\n") })).toBe(
      fp({ body: lf }),
    );
  });

  it("a lone CR hashes like LF", () => {
    expect(fp({ body: lf.replace(/\n/g, "\r") })).toBe(
      fp({ body: lf }),
    );
  });

  it("the task prompt is normalised too", () => {
    expect(fp({ taskPrompt: "Frage eins\r\nFrage zwei" })).toBe(
      fp({ taskPrompt: "Frage eins\nFrage zwei" }),
    );
  });

  it("and the normalisation is not a blanket whitespace collapse", () => {
    // A trailing space is a change an operator made and can see in their file.
    expect(fp({ body: "Text " })).not.toBe(fp({ body: "Text" }));
  });
});

describe("null is not empty", () => {
  it("a lesson with no body and a lesson with an empty body are different rows", () => {
    expect(fp({ body: null })).not.toBe(fp({ body: "" }));
  });

  it("the same holds for the task prompt", () => {
    expect(fp({ taskPrompt: null })).not.toBe(
      fp({ taskPrompt: "" }),
    );
  });
});

describe("unitCount", () => {
  it("equals the block's unit array length", () => {
    const payload = payloadOf(course());
    expect(payload.blocks.map((b) => b.unitCount)).toEqual([2, 1]);
    expect(payload.blocks.map((b) => b.units.length)).toEqual([2, 1]);
  });

  it("is 0 for a block nobody has written a lesson into yet", () => {
    const payload = payloadOf([block({ units: [] })]);
    expect(payload.blocks[0].unitCount).toBe(0);
    expect(payload.blocks[0].units).toEqual([]);
  });

  it("an empty course is an empty block list", () => {
    // ⚠️ The version tag is on the payload even here. An environment with no
    // course at all still says which fingerprint it computes — otherwise the
    // first block published into it would arrive against a silence.
    expect(payloadOf([])).toEqual({ fingerprintVersion: FINGERPRINT_VERSION, blocks: [] });
  });
});

describe("the fingerprint version travels", () => {
  it("is on the payload, once, at the top", () => {
    const payload = payloadOf(course());
    expect(payload.fingerprintVersion).toBe(FINGERPRINT_VERSION);
    expect(Object.keys(payload).sort()).toEqual(["blocks", "fingerprintVersion"]);
  });

  it("is not repeated per block or per lesson", () => {
    const payload = payloadOf(course());
    for (const b of payload.blocks) {
      expect(Object.hasOwn(b, "fingerprintVersion")).toBe(false);
      for (const u of b.units) expect(Object.hasOwn(u, "fingerprintVersion")).toBe(false);
    }
  });

  it("🚨 says v2, because the storage key moved every fingerprint that existed", () => {
    // A pinned literal, and the one place in this file that has one. It is not
    // a digest — it is the CONTRACT with `compareCourse()`, which reads this
    // string off the wire to tell "these lessons differ" apart from "that app
    // computes something else". Bumping it is a decision about every deployed
    // app's next `courses-diff`, so it fails a test rather than passing quietly.
    expect(FINGERPRINT_VERSION).toBe("courses-unit-v2");
  });
});

describe("🚨 an unresolved slot is refused, never hashed as an empty one", () => {
  // The back door into the defect A49 was about: a caller that hands over a raw
  // `courseOutline()` row — the shape this function took until the storage key
  // arrived — passes four media ids and no keys. Read as absent, a lesson WITH a
  // video would hash exactly like one without, in every environment, and every
  // diff would say `untouched`. There is nothing downstream that could notice.
  it("a row with a media id and no key throws, naming the lesson and the slot", () => {
    const raw = unit({ videoMediaId: "med-video-1" }) as never;
    expect(() => unitFingerprint(raw)).toThrow(/erste-schritte/);
    expect(() => unitFingerprint(raw)).toThrow(/videoKey/);
  });

  it("each of the four slots is guarded, not only the video", () => {
    for (const slot of ["cover", "video", "subtitle", "worksheet"] as const) {
      const raw = {
        ...unit({ videoMediaId: null }),
        [`${slot}MediaId`]: "med-77",
        coverKey: null,
        videoKey: null,
        subtitleKey: null,
        worksheetKey: null,
      } as never;
      expect(() => unitFingerprint(raw), `the ${slot} slot is not guarded`).toThrow(
        new RegExp(`${slot}Key`),
      );
    }
  });

  it("and an EMPTY slot is not refused — the guard reads the id, not the key", () => {
    // Counter-probe: without this, a guard that simply refused every null key
    // would pass the two tests above and break every text-only lesson.
    expect(() =>
      unitFingerprint(hashable(unit({ videoMediaId: null }))),
    ).not.toThrow();
  });
});

describe("everything the tool returned before is still there, unchanged", () => {
  it("block and unit fields keep their values", () => {
    const [only] = payloadOf([
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
    const payload = payloadOf(course());
    expect(payload.blocks.map((b) => b.slug)).toEqual(["grundlagen", "vertiefung"]);
    expect(payload.blocks[0].units.map((u) => u.slug)).toEqual(["lektion-1", "lektion-2"]);
  });
});
