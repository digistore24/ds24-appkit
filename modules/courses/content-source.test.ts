// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the assistant may read out of this course — measured, not described.
//
// No database. Every assertion below is about something that must happen
// BEFORE a query, or about a pure transformation of rows, and the sharpest ones
// measure an ABSENCE: `toHaveBeenCalledTimes(0)` on the data functions. A test
// that needed a database to prove "nothing was read" would be proving it in the
// one place the bug would not be. Same shape as `admin/actions.test.ts`.
//
// The unlock arithmetic is deliberately NOT mocked — `../rules.ts` is the real
// `isUnlocked()`/`unlockedAt()`, because "a locked lesson is not searchable" is
// a claim about that function and a stub of it would assert nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { mediaAnchor, slugifyAnchor } from "@/lib/content-source/anchors";
import { isLinkableAppPath } from "@/lib/content-source/link-marker";
import type { MediaRow } from "@/db/schema-media";

vi.mock("./lib/config", () => ({
  isCourseEnabled: vi.fn(() => true),
  courseShape: vi.fn(() => "self-study"),
}));

vi.mock("./lib/access", () => ({ courseAccessFor: vi.fn() }));

vi.mock("./lib/manage", () => ({
  searchUnits: vi.fn(),
  unitBySlug: vi.fn(),
  blockById: vi.fn(),
  courseOutline: vi.fn(),
  unitsWithMedia: vi.fn(),
}));

vi.mock("./lib/media", () => ({ mediaRowsFor: vi.fn() }));

vi.mock("@/lib/media/manage", () => ({ mayAccess: vi.fn() }));

import { mayAccess } from "@/lib/media/manage";

import source, { COURSES_SOURCE_ID } from "./content-source";
import { courseAccessFor } from "./lib/access";
import { courseShape, isCourseEnabled } from "./lib/config";
import { blockById, courseOutline, searchUnits, unitBySlug, unitsWithMedia } from "./lib/manage";
import { mediaRowsFor } from "./lib/media";

// ── fixtures ────────────────────────────────────────────────────────────────

const BUYER = { memberId: "m-1", role: null };
const ANON = { memberId: null, role: null };

/** Frozen so "unlocks on <date>" is one string on every machine and every day. */
const TODAY = new Date("2026-08-09T12:00:00.000Z");

const ENTITLED = { entitled: true, startedAt: TODAY, asOperator: false };
const NOT_ENTITLED = { entitled: false, startedAt: null, asOperator: false };
/** A missed payment: the grant is not active, so nothing has a clock. */
const PAUSED = { entitled: true, startedAt: null, asOperator: false };

const WEEK_ONE_ROW = {
  slug: "knoten-binden",
  title: "Lektion 1: Knoten binden",
  body: "Der Palomar-Knoten haelt am besten, und er ist in zehn Sekunden gebunden.",
  releaseAfterDays: 0,
};
const WEEK_TWO_ROW = {
  slug: "der-verkaufsabschluss",
  title: "Lektion 7: Der Verkaufsabschluss",
  body: "Am Ende steht der Knoten im Gespraech.",
  releaseAfterDays: 7,
};

const unit = (over: Record<string, unknown>) => ({
  id: "u-x",
  slug: "x",
  title: "X",
  position: 1,
  origin: "content",
  body: "Text.",
  coverMediaId: null,
  videoMediaId: null,
  subtitleMediaId: null,
  worksheetMediaId: null,
  taskPrompt: null,
  ...over,
});

const OUTLINE = [
  {
    id: "b-1",
    slug: "woche-1",
    title: "Woche 1",
    summary: "Die Grundlagen",
    position: 1,
    releaseAfterDays: 0,
    origin: "content",
    units: [
      unit({
        id: "u-1",
        slug: WEEK_ONE_ROW.slug,
        title: WEEK_ONE_ROW.title,
        body: WEEK_ONE_ROW.body,
        videoMediaId: "med-1",
        worksheetMediaId: "med-2",
      }),
    ],
  },
  {
    id: "b-2",
    slug: "woche-2",
    title: "Woche 2",
    summary: null,
    position: 2,
    releaseAfterDays: 7,
    origin: "content",
    units: [
      unit({
        id: "u-2",
        slug: WEEK_TWO_ROW.slug,
        title: WEEK_TWO_ROW.title,
        body: WEEK_TWO_ROW.body,
        videoMediaId: "med-3",
      }),
    ],
  },
];

const mediaRow = (over: Record<string, unknown>) =>
  ({
    id: "med-1",
    ownerId: null,
    kind: "video",
    visibility: "entitled",
    requiresPlan: "kurs_komplett",
    storageKey: "content/kurs/knoten.mp4",
    mime: "video/mp4",
    filename: "knoten.mp4",
    bytes: 42,
    width: null,
    height: null,
    durationSeconds: null,
    sha256: null,
    source: "upload",
    alt: "Knoten binden, Schritt fuer Schritt",
    createdAt: TODAY,
    ...over,
  }) as unknown as MediaRow;

const MEDIA = new Map<string, MediaRow>([
  ["med-1", mediaRow({})],
  [
    "med-2",
    mediaRow({
      id: "med-2",
      kind: "file",
      storageKey: "content/kurs/arbeitsblatt.pdf",
      mime: "application/pdf",
      filename: "arbeitsblatt.pdf",
      alt: null,
    }),
  ],
  [
    "med-3",
    mediaRow({
      id: "med-3",
      storageKey: "content/kurs/abschluss.mp4",
      filename: "abschluss.mp4",
      alt: "Der Abschluss",
    }),
  ],
]);

/**
 * What `unitsWithMedia()` answers for an outline — the same lessons, without the
 * texts.
 *
 * The two doors deliberately return different shapes: `list()` wants the blocks
 * (their titles and summaries are what it prints), `findMedia()` wants the media
 * slots and the release day and nothing else. Deriving one fixture from the
 * other here keeps the two tests describing ONE course rather than two that
 * drift.
 */
interface OutlineLike {
  releaseAfterDays: number;
  units: {
    slug: string;
    title: string;
    coverMediaId: string | null;
    videoMediaId: string | null;
    subtitleMediaId: string | null;
    worksheetMediaId: string | null;
  }[];
}

function withMedia(outline: readonly OutlineLike[]) {
  return outline.flatMap((block) =>
    block.units.map((unit) => ({
      slug: unit.slug,
      title: unit.title,
      releaseAfterDays: block.releaseAfterDays,
      coverMediaId: unit.coverMediaId,
      videoMediaId: unit.videoMediaId,
      subtitleMediaId: unit.subtitleMediaId,
      worksheetMediaId: unit.worksheetMediaId,
    })),
  );
}

/** All four methods, so a rule that has to hold for every one is written once. */
async function everyMethod(viewer: { memberId: string | null; role: string | null }) {
  return {
    hits: await source.search("Knoten", viewer, 10),
    doc: await source.get(WEEK_ONE_ROW.slug, viewer),
    toc: (await source.list?.(viewer)) ?? [],
    media: (await source.findMedia?.("Knoten", viewer, 10)) ?? [],
  };
}

function expectAllEmpty(result: Awaited<ReturnType<typeof everyMethod>>) {
  expect(result.hits).toEqual([]);
  expect(result.doc).toBeNull();
  expect(result.toc).toEqual([]);
  expect(result.media).toEqual([]);
}

/** Nothing read a table. The claim of AC 8 and AC 11, said once. */
function expectNoDataRead() {
  expect(searchUnits).toHaveBeenCalledTimes(0);
  expect(unitBySlug).toHaveBeenCalledTimes(0);
  expect(blockById).toHaveBeenCalledTimes(0);
  expect(courseOutline).toHaveBeenCalledTimes(0);
  expect(unitsWithMedia).toHaveBeenCalledTimes(0);
  expect(mediaRowsFor).toHaveBeenCalledTimes(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);

  vi.mocked(isCourseEnabled).mockReturnValue(true);
  vi.mocked(courseShape).mockReturnValue("self-study");
  vi.mocked(courseAccessFor).mockResolvedValue(ENTITLED);
  vi.mocked(searchUnits).mockResolvedValue([WEEK_ONE_ROW, WEEK_TWO_ROW]);
  vi.mocked(unitBySlug).mockResolvedValue(
    unit({ id: "u-1", slug: WEEK_ONE_ROW.slug, title: WEEK_ONE_ROW.title, body: WEEK_ONE_ROW.body, blockId: "b-1", videoMediaId: "med-1", worksheetMediaId: "med-2" }) as never,
  );
  vi.mocked(blockById).mockResolvedValue({ id: "b-1", releaseAfterDays: 0 } as never);
  vi.mocked(courseOutline).mockResolvedValue(OUTLINE as never);
  vi.mocked(unitsWithMedia).mockResolvedValue(withMedia(OUTLINE) as never);
  vi.mocked(mediaRowsFor).mockResolvedValue(MEDIA);
  vi.mocked(mayAccess).mockResolvedValue(true);
});

// ── the preamble: three refusals, all before a table is touched ─────────────

describe("the course source refuses before it asks the database", () => {
  it("🚨 the off state answers before it asks the database", async () => {
    // Not merely "returns nothing" — nothing was READ. `config/course.json`
    // ships `enabled: false`, so this is the state a freshly installed module
    // is in for as long as it takes to write the content, and a source that
    // quoted a course members cannot open would be doing it in exactly that
    // window.
    vi.mocked(isCourseEnabled).mockReturnValue(false);

    expectAllEmpty(await everyMethod(BUYER));
    expectNoDataRead();
    // Not even the gate: an off course has nobody to let in.
    expect(courseAccessFor).toHaveBeenCalledTimes(0);
    // And it did not throw — `courseShape()` throws in the broken state, and a
    // source that leaned on `guarded()` would log an error line per question.
    expect(courseShape).toHaveBeenCalledTimes(0);
  });

  it("asks isCourseEnabled(), never isCourseSwitchedOn()", () => {
    // The two differ in exactly the broken state, and `lib/config.ts` says so
    // in as many words: `isCourseSwitchedOn()` is "never a substitute … in a
    // guard". `isCourseEnabled()` is false for BOTH reasons —
    // `disabledInConfig` and `brokenConfig` — which is why one mocked boolean
    // above covers both, and this assertion is what ties that claim to the
    // code rather than to the mock. `lib/config.test.ts` owns the other half.
    const code = blankComments(readFileSync(SOURCE_FILE, "utf8"));
    expect(code).toContain("isCourseEnabled()");
    expect(code, "the guard is the narrower question").not.toContain("isCourseSwitchedOn");
  });

  it("🚨 a viewer with no account is turned away before the gate is asked", async () => {
    // `ContentViewer.memberId` is `string | null` and `courseAccessFor()` wants
    // a `string`. Without this line the anonymous case would be a type error
    // or, worse, a `hasPlan(null)`. The gate assertion comes FIRST because it
    // is the distinguishing one: an empty answer could also come from an empty
    // course, a gate that was never asked could not.
    const result = await everyMethod(ANON);
    expect(courseAccessFor).toHaveBeenCalledTimes(0);
    expectNoDataRead();
    expectAllEmpty(result);
  });

  it("🚨 a non-buyer gets no hit at all — not a hit without a link", async () => {
    vi.mocked(courseAccessFor).mockResolvedValue(NOT_ENTITLED);

    const result = await everyMethod(BUYER);
    expectAllEmpty(result);
    expectNoDataRead();

    // The title IS the disclosure. "Lektion 7: Der Verkaufsabschluss" in her
    // answer tells a non-buyer what they have not bought, whether or not it is
    // clickable — so the assertion is about the whole payload, not the url.
    const payload = JSON.stringify(result);
    expect(payload).not.toContain("Verkaufsabschluss");
    expect(payload).not.toContain(WEEK_TWO_ROW.slug);
    expect(payload).not.toContain("Knoten binden");
    expect(payload).not.toContain(WEEK_ONE_ROW.slug);
  });

  it("asks the gate exactly once per call, with the viewer's own role", async () => {
    await source.search("Knoten", { memberId: "m-1", role: null }, 10);
    expect(courseAccessFor).toHaveBeenCalledTimes(1);
    expect(courseAccessFor).toHaveBeenCalledWith("m-1", null);
  });
});

// ── search ──────────────────────────────────────────────────────────────────

describe("search", () => {
  it("answers with the lesson, its page and the anchor the page renders", async () => {
    const hits = await source.search("Palomar", BUYER, 10);

    expect(hits).toHaveLength(1);
    expect(hits[0].sourceId).toBe(COURSES_SOURCE_ID);
    expect(hits[0].ref).toBe(WEEK_ONE_ROW.slug);
    expect(hits[0].kind).toBe("page");
    expect(hits[0].title).toBe(WEEK_ONE_ROW.title);
    expect(hits[0].url).toBe(`/dashboard/course/${WEEK_ONE_ROW.slug}`);
    // The text card on the lesson page carries `id={slugifyAnchor(unit.slug)}`.
    expect(hits[0].anchor).toBe(WEEK_ONE_ROW.slug);
    expect(hits[0].snippet).toContain("Palomar");
  });

  it("carries no fragment for a lesson with no text", async () => {
    // The page renders the text card — and therefore the id — only when there
    // IS a body. An anchor onto an element nothing renders scrolls nowhere.
    vi.mocked(searchUnits).mockResolvedValue([{ ...WEEK_ONE_ROW, body: null }]);
    const hits = await source.search("Knoten", BUYER, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].anchor).toBeNull();
  });

  it("says nothing for a query with no usable terms, and reads nothing", async () => {
    expect(await source.search("a", BUYER, 10)).toEqual([]);
    expect(searchUnits).toHaveBeenCalledTimes(0);
  });

  it("caps the candidates it asks for", async () => {
    await source.search("Knoten", BUYER, 10);
    expect(searchUnits).toHaveBeenCalledWith(["knoten"], 200);
  });
});

// ── the drip: three shapes ──────────────────────────────────────────────────

describe("a locked lesson", () => {
  it("self-study: everything is open, whatever releaseAfterDays says", async () => {
    // Config wins over data — a stray `releaseAfterDays` in a content file
    // cannot lock a self-study course.
    const hits = await source.search("Knoten", BUYER, 10);
    expect(hits.map((hit) => hit.ref).sort()).toEqual(
      [WEEK_ONE_ROW.slug, WEEK_TWO_ROW.slug].sort(),
    );
  });

  it("🚨 drip: is not searchable", async () => {
    vi.mocked(courseShape).mockReturnValue("drip");
    const hits = await source.search("Knoten", BUYER, 10);
    expect(hits.map((hit) => hit.ref)).toEqual([WEEK_ONE_ROW.slug]);
    expect(JSON.stringify(hits)).not.toContain("Verkaufsabschluss");
  });

  it("🚨 drip: and cannot be fetched either", async () => {
    vi.mocked(courseShape).mockReturnValue("drip");
    vi.mocked(unitBySlug).mockResolvedValue(
      unit({ id: "u-2", slug: WEEK_TWO_ROW.slug, title: WEEK_TWO_ROW.title, blockId: "b-2" }) as never,
    );
    vi.mocked(blockById).mockResolvedValue({ id: "b-2", releaseAfterDays: 7 } as never);

    // `null` for "not open yet", exactly as for "no such lesson" and "not
    // entitled" — the three are indistinguishable by contract.
    expect(await source.get(WEEK_TWO_ROW.slug, BUYER)).toBeNull();
  });

  it("🚨 drip: but list() shows it, with the day it opens and no link", async () => {
    vi.mocked(courseShape).mockReturnValue("drip");
    const toc = await source.list!(BUYER);

    const open = toc.find((entry) => entry.ref === WEEK_ONE_ROW.slug)!;
    expect(open.url).toBe(`/dashboard/course/${WEEK_ONE_ROW.slug}`);
    expect(open.summary).toBe("Woche 1 — Die Grundlagen");

    const locked = toc.find((entry) => entry.ref === WEEK_TWO_ROW.slug)!;
    // The product sold the pacing, so the course a member is shown is the whole
    // course. What it must not carry is a link that bounces them back.
    expect(locked.title).toBe(WEEK_TWO_ROW.title);
    expect(locked.url).toBeNull();
    // `(UTC)` is part of the sentence, not decoration: the note is MODEL-facing
    // (no member ever reads it), the date is derived in UTC out of a zoneless
    // column, and without the marker the model is free to present it as a local
    // day — which for a drip course is the difference between "opens Sunday"
    // and "opens Saturday" for everybody west of Greenwich.
    expect(locked.summary).toBe("not open yet — unlocks on 2026-08-16 (UTC)");
  });

  it("a paused member has no clock, so nothing is open", async () => {
    // A SUSPENDED grant is not active, so `planStartedAt()` answers null and
    // `unlockedAt()` answers "never". Week one at day zero included.
    vi.mocked(courseShape).mockReturnValue("drip");
    vi.mocked(courseAccessFor).mockResolvedValue(PAUSED);

    expect(await source.search("Knoten", BUYER, 10)).toEqual([]);

    const toc = await source.list!(BUYER);
    expect(toc).toHaveLength(2);
    for (const entry of toc) {
      expect(entry.url).toBeNull();
      expect(entry.summary).toBe(
        "not open — this member's access is paused, so no block has a clock",
      );
    }
  });
});

// ── get ─────────────────────────────────────────────────────────────────────

describe("get", () => {
  it("returns the lesson text, its one anchor and its media", async () => {
    const doc = (await source.get(WEEK_ONE_ROW.slug, BUYER))!;

    expect(doc.sourceId).toBe(COURSES_SOURCE_ID);
    expect(doc.ref).toBe(WEEK_ONE_ROW.slug);
    expect(doc.url).toBe(`/dashboard/course/${WEEK_ONE_ROW.slug}`);
    expect(doc.body).toBe(WEEK_ONE_ROW.body);
    expect(doc.sections).toEqual([
      { anchor: WEEK_ONE_ROW.slug, title: WEEK_ONE_ROW.title },
    ]);
    expect(doc.media).toEqual([
      {
        path: "content/kurs/knoten.mp4",
        kind: "video",
        alt: "Knoten binden, Schritt fuer Schritt",
        anchor: "media-content-kurs-knoten-mp4",
      },
      {
        path: "content/kurs/arbeitsblatt.pdf",
        kind: "file",
        alt: null,
        anchor: "media-content-kurs-arbeitsblatt-pdf",
      },
    ]);
  });

  it("answers null for a lesson nobody wrote", async () => {
    vi.mocked(unitBySlug).mockResolvedValue(null as never);
    expect(await source.get("gibt-es-nicht", BUYER)).toBeNull();
  });

  it("answers null for a lesson whose block vanished", async () => {
    vi.mocked(blockById).mockResolvedValue(null as never);
    expect(await source.get(WEEK_ONE_ROW.slug, BUYER)).toBeNull();
  });

  it("skips a medium this viewer may not have", async () => {
    vi.mocked(mayAccess).mockResolvedValue(false);
    const doc = (await source.get(WEEK_ONE_ROW.slug, BUYER))!;
    expect(doc.media).toEqual([]);
    // Asked per row, exactly as the page does inside `unitMedia()`.
    expect(mayAccess).toHaveBeenCalledTimes(2);
  });

  it("has no sections for a lesson with no text", async () => {
    vi.mocked(unitBySlug).mockResolvedValue(
      unit({ id: "u-1", slug: WEEK_ONE_ROW.slug, body: null, blockId: "b-1" }) as never,
    );
    const doc = (await source.get(WEEK_ONE_ROW.slug, BUYER))!;
    expect(doc.sections).toEqual([]);
  });
});

// ── findMedia ───────────────────────────────────────────────────────────────

describe("findMedia", () => {
  // ⚠️ **This assertion is the whole guard, and the registry test is NOT the
  // other half.** `lib/content-source/sources.test.ts` walks every registered
  // source with `VIEWER = { memberId: null }` — an anonymous viewer, which this
  // source turns away in its first line. So in the installed profile it runs
  // over this source and measures nothing about it, by construction. Whoever
  // weakens the rule below has removed the only thing checking it.
  it("🚨 links the PAGE that shows the medium, never the file", async () => {
    const hits = await source.findMedia!("Knoten", BUYER, 10);

    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.kind).toBe("media");
      expect(hit.url).toBe(`/dashboard/course/${WEEK_ONE_ROW.slug}`);
      // The registry's own judgement, borrowed rather than restated — a second
      // opinion about what a linkable path is would be the thing to drift.
      expect(isLinkableAppPath(hit.url!)).toBe(true);
      // A signed address expires under the model's feet and bypasses
      // `mayAccess()`. There must be no trace of one.
      expect(JSON.stringify(hit)).not.toContain("/api/media/");
    }
    expect(hits[0].anchor).toBe("media-content-kurs-knoten-mp4");
    expect(hits[0].media).toEqual({
      path: "content/kurs/knoten.mp4",
      kind: "video",
      alt: "Knoten binden, Schritt fuer Schritt",
    });
  });

  it("skips a row this viewer may not have", async () => {
    vi.mocked(mayAccess).mockResolvedValue(false);
    expect(await source.findMedia!("Knoten", BUYER, 10)).toEqual([]);
  });

  it("leaves a locked lesson's media out", async () => {
    vi.mocked(courseShape).mockReturnValue("drip");
    const hits = await source.findMedia!("", BUYER, 10);
    // Week two's video is behind a page that would redirect them.
    expect(hits.map((hit) => hit.media?.path)).not.toContain("content/kurs/abschluss.mp4");
  });

  it("lists everything for an empty query", async () => {
    const hits = await source.findMedia!("", BUYER, 10);
    expect(hits).toHaveLength(3);
  });

  it("honours the limit", async () => {
    const hits = await source.findMedia!("", BUYER, 1);
    expect(hits).toHaveLength(1);
  });

  it("🚨 does not answer with a subtitle — the page renders no element for it", async () => {
    // `findableSlotsOf()` has said this since the method was written and nothing
    // called it: `findMedia()` looped over `slotsOf()`, so a `.vtt` came back as
    // a hit with `anchor: null` — a "hit" the member can neither see nor fetch,
    // because the file is a `<track>` inside the player and the page gives it no
    // element. `get()` still lists it, where it is part of what the lesson IS.
    const withSubtitle = [
      {
        ...OUTLINE[0],
        units: [{ ...OUTLINE[0].units[0], subtitleMediaId: "med-vtt" }],
      },
    ];
    vi.mocked(unitsWithMedia).mockResolvedValue(withMedia(withSubtitle) as never);
    vi.mocked(mediaRowsFor).mockResolvedValue(
      new Map([
        ...MEDIA,
        [
          "med-vtt",
          mediaRow({
            id: "med-vtt",
            kind: "file",
            storageKey: "content/kurs/knoten.vtt",
            mime: "text/vtt",
            filename: "knoten.vtt",
            alt: "Untertitel: Knoten binden",
          }),
        ],
      ]),
    );

    const hits = await source.findMedia!("Knoten", BUYER, 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((hit) => hit.media?.path)).not.toContain("content/kurs/knoten.vtt");
    // And the row was never even fetched — a slot this method may not answer
    // with has no business in the batch either.
    expect(vi.mocked(mediaRowsFor).mock.calls[0][0]).not.toContain("med-vtt");
  });
});

// ── 🚨 what one question to the assistant COSTS ─────────────────────────────
//
// Not a correctness claim — the answers below are the same ones the method gave
// before. What is measured is the ORDER the questions are asked in, and it is
// worth a test of its own because getting it wrong is invisible: every assertion
// in the block above stays green while the method asks the entitlement layer 180
// times for an answer three rows could have given.
//
// `mayAccess()` reaches `hasPlan()` for an `entitled` row (`lib/media/manage.ts`),
// which is a `grants` query — per row, awaited in sequence. The text filter over
// `alt`, `filename` and the lesson title costs nothing and was BELOW it.

describe("🚨 findMedia asks the free question first", () => {
  // A twelve-week course, which is what the module's own guidance describes:
  // 12 blocks × 5 lessons × 3 media (cover, video, worksheet) = 180 rows.
  const BLOCKS = 12;
  const UNITS_PER_BLOCK = 5;
  const SLOTS_PER_UNIT = 3;
  /** The one lesson the query matches. Nothing else in the fixture says it. */
  const NEEDLE = "Palomar";

  const bigCourse = () => {
    const outline = [];
    const rows = new Map<string, MediaRow>();
    let n = 0;
    for (let b = 0; b < BLOCKS; b++) {
      const units = [];
      for (let u = 0; u < UNITS_PER_BLOCK; u++) {
        n += 1;
        const slug = `lektion-${n}`;
        const ids = ["cover", "video", "worksheet"].map((slot) => `med-${slot}-${n}`);
        for (const id of ids) {
          rows.set(
            id,
            mediaRow({
              id,
              storageKey: `content/kurs/${id}.mp4`,
              filename: `${id}.mp4`,
              alt: `Aufnahme ${n}`,
            }),
          );
        }
        units.push(
          unit({
            id: `u-${n}`,
            slug,
            // Lesson 33 is the needle; every other title is a number.
            title: n === 33 ? `Lektion ${n}: Der ${NEEDLE}-Knoten` : `Lektion ${n}`,
            body: "Ein Text, den diese Methode nie liest.",
            coverMediaId: ids[0],
            videoMediaId: ids[1],
            worksheetMediaId: ids[2],
          }),
        );
      }
      outline.push({
        id: `b-${b}`,
        slug: `woche-${b + 1}`,
        title: `Woche ${b + 1}`,
        summary: null,
        position: b + 1,
        releaseAfterDays: 0,
        origin: "content",
        units,
      });
    }
    return { outline, rows };
  };

  beforeEach(() => {
    const { outline, rows } = bigCourse();
    vi.mocked(unitsWithMedia).mockResolvedValue(withMedia(outline as never) as never);
    vi.mocked(courseOutline).mockResolvedValue(outline as never);
    vi.mocked(mediaRowsFor).mockResolvedValue(rows);
  });

  it("the fixture really is the twelve-week course", () => {
    // The needle probe. A fixture that shrank would make the count below pass
    // for the wrong reason, and the whole point of this block is the SIZE.
    const { rows } = bigCourse();
    expect(rows.size).toBe(BLOCKS * UNITS_PER_BLOCK * SLOTS_PER_UNIT);
    expect(rows.size).toBe(180);
  });

  it("🚨 asks mayAccess() only about the media the query already matched", async () => {
    const hits = await source.findMedia!(NEEDLE, BUYER, 10);

    // The answer is unchanged: the three media of lesson 33 and nothing else.
    expect(hits.map((hit) => hit.ref)).toEqual(["lektion-33", "lektion-33", "lektion-33"]);

    // Measured 2026-08-10 on this fixture: 180 before, 3 after. Each of those
    // 180 was an awaited `grants` query for one question to the assistant.
    expect(
      vi.mocked(mayAccess).mock.calls.length,
      "the media are filtered on their own words BEFORE the entitlement layer is " +
        "asked. Asking first costs one grants query per medium of the WHOLE course " +
        "for a question that three rows answer.",
    ).toBe(SLOTS_PER_UNIT);
  });

  it("🚨 and does not load a single lesson text on the way", async () => {
    // `courseOutline()` selects every column of every unit, `body` included —
    // the whole course's prose, to read four media ids per row. `findMedia()`
    // never touches a body.
    await source.findMedia!(NEEDLE, BUYER, 10);
    expect(unitsWithMedia).toHaveBeenCalledTimes(1);
    expect(
      courseOutline,
      "findMedia() is back on the outline query, which carries every lesson's body",
    ).toHaveBeenCalledTimes(0);
  });

  it("a locked lesson is still out, and its media are never asked about", async () => {
    // The filter that must NOT move below the gate: the cheap text filter went
    // first, the drip check stays where it was — above everything.
    vi.mocked(courseShape).mockReturnValue("drip");
    const { outline, rows } = bigCourse();
    // Week nine (lessons 41–45) is still shut on day zero — and lesson 43 says
    // the needle, so it would be a hit if the drip check ever slipped below the
    // text filter. Lesson 33 stays open and stays the answer.
    outline[8].releaseAfterDays = 70;
    outline[8].units[2].title = `Lektion 43: Der ${NEEDLE}-Knoten`;
    vi.mocked(unitsWithMedia).mockResolvedValue(withMedia(outline as never) as never);
    vi.mocked(mediaRowsFor).mockResolvedValue(rows);

    const hits = await source.findMedia!(NEEDLE, BUYER, 10);
    expect(hits.map((hit) => hit.ref)).toEqual(["lektion-33", "lektion-33", "lektion-33"]);
    expect(JSON.stringify(hits)).not.toContain("lektion-43");
    // Not even fetched: the locked block's slots are out before the batch.
    expect(vi.mocked(mediaRowsFor).mock.calls[0][0]).not.toContain("med-video-43");
  });
});

// ── 🚨 the page renders the anchors this source promises ────────────────────
//
// The browser pass in the story's AC 16 is the other half. This half is the one
// that can run on every machine: it walks the CHAIN both ends of a deep link
// hang on, link by link, and each link is a string comparison rather than a
// belief.

describe("🚨 the anchors agree with the page", () => {
  const page = () => readFileSync(join(MODULE_ROOT, "pages/unit/page.tsx"), "utf8");

  it("the page derives every id with the shared functions", () => {
    const code = blankComments(page());
    expect(code).toContain('from "@/lib/content-source/anchors"');
    // The three elements this source claims exist, and no fourth.
    expect(code).toContain("id={mediaAnchor(media.video.path)}");
    expect(code).toContain("id={mediaAnchor(media.worksheet.path)}");
    expect(code).toContain("id={slugifyAnchor(unit.slug)}");
    // Every one of them scrolled clear of the sticky header.
    expect(code.match(/scroll-mt-20/g) ?? []).toHaveLength(3);
  });

  it("the page never spells an anchor by hand", () => {
    // A literal `id="media-…"` would be a second arithmetic, and the two would
    // agree until the day somebody changed `slugifyAnchor()`.
    expect(blankComments(page())).not.toMatch(/id="media-/);
  });

  it("🚨 both ends start from the SAME string — the bucket path", () => {
    // The link nobody would notice breaking. `unitMedia()` maps
    // `path: row.storageKey`; this source reads `row.storageKey` too. Were the
    // page handed an id or a filename instead, `mediaAnchor()` would still be
    // called on both sides and would still produce two different strings.
    const resolved = blankComments(readFileSync(join(MODULE_ROOT, "lib/media.ts"), "utf8"));
    expect(resolved).toContain("path: row.storageKey");
    const code = blankComments(readFileSync(SOURCE_FILE, "utf8"));
    expect(code).toContain("pageAnchorFor(slot, row.storageKey)");
    expect(code).toContain("mediaAnchor(path)");
  });

  it("and the fragment a hit carries is the id the page would render", async () => {
    // Measured end to end over the fixture: the source's anchor, and the string
    // the page's own expression evaluates to for the same row.
    const doc = (await source.get(WEEK_ONE_ROW.slug, BUYER))!;
    const video = doc.media.find((entry) => entry.kind === "video")!;
    const pageId = mediaAnchor(MEDIA.get("med-1")!.storageKey);
    expect(video.anchor).toBe(pageId);

    const hits = await source.search("Palomar", BUYER, 10);
    expect(hits[0].anchor).toBe(slugifyAnchor(WEEK_ONE_ROW.slug));
  });
});

// ── 🚨 the gate is ONE function ─────────────────────────────────────────────

const MODULE_ROOT = fileURLToPath(new URL("./", import.meta.url));
const SOURCE_FILE = join(MODULE_ROOT, "content-source.ts");

const GATE_FILE = "lib/access.ts";

/**
 * The production files that may name `hasPlan`, each with the reason.
 *
 * Everything else in this module asks `courseAccessFor()`, and that is not a
 * style rule: two `hasPlan()` calls that agree today are two that can drift,
 * and the drift makes the assistant an existence oracle in a way no test in
 * this template could see afterwards.
 */
const ALLOWED: Record<string, string> = {
  [GATE_FILE]: "the gate itself — the ONE call, and every surface asks here",
  "check.mjs":
    "names it in a SENTENCE the operator reads (\"hasPlan() throws on an unknown key\"), inside a template literal rather than a comment, so `blankComments()` cannot reach it. A diagnostic explaining the trap is not a second gate",
};

/**
 * ⚠️ **Test files are out of scope, and the reason is not convenience.** The
 * rule is about the module's PRODUCTION path having one gate. A test names
 * `hasPlan` because it MOCKS the core's entitlement layer in order to exercise
 * `mayAccess()` (`lib/media.test.ts`) or because it says the word in a
 * `describe` title (`lib/config.test.ts`) — neither is a second gate, and
 * neither can become one. Excluding them here rather than allowlisting each is
 * what keeps a new test from being blocked by a rule it cannot break.
 */
const isTest = (file: string) => /\.test\.(ts|tsx|mjs)$/.test(file);

function* productionFiles(dir: string, base = ""): Generator<string> {
  for (const entry of readdirSync(join(dir, base))) {
    if (entry === "node_modules" || entry === "drizzle") continue;
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(join(dir, rel)).isDirectory()) yield* productionFiles(dir, rel);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !isTest(rel)) yield rel;
  }
}

describe("🚨 the purchase gate is ONE function", () => {
  const files = [...productionFiles(MODULE_ROOT)];

  it("found the module's production files", () => {
    // Non-vacuity: an empty walk would make the assertion below pass while
    // guarding nothing — the exact green this repo refuses everywhere else.
    expect(files.length).toBeGreaterThan(15);
    expect(files).toContain("content-source.ts");
    expect(files).toContain(GATE_FILE);
  });

  it("reads content — the needle is really there", () => {
    // The probe for the walk: `lib/access.ts` DOES name `hasPlan`, in code and
    // not only in a comment. If the reader ever stops reading, or
    // `blankComments()` ever starts blanking too much, this fails first.
    const gate = blankComments(readFileSync(join(MODULE_ROOT, GATE_FILE), "utf8"));
    expect(gate).toContain("hasPlan");
  });

  it("keeps no allowance for a file that is gone", () => {
    // Same shape as `modules/boundary.test.ts`: an allowance that outlives its
    // file is how a later, real finding gets waved through under an old name.
    for (const file of Object.keys(ALLOWED)) expect(files).toContain(file);
  });

  it("no other file in the module names hasPlan", () => {
    // Through `blankComments()`, or the scanner punishes the files that EXPLAIN
    // the rule — `content-source.ts`'s own header says "never a second
    // `hasPlan()` here" three times (`CLAUDE.md` → *A checker that reads source
    // as TEXT*).
    const offenders = files.filter(
      (file) =>
        !(file in ALLOWED) &&
        blankComments(readFileSync(join(MODULE_ROOT, file), "utf8")).includes("hasPlan"),
    );
    expect(
      offenders,
      "these files ask the entitlement layer directly instead of going through " +
        `courseAccessFor() (${GATE_FILE}). A source more permissive than its page ` +
        "turns the assistant into an existence oracle:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
