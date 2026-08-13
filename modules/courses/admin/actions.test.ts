// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the operator's write surface refuses.
//
// The mocks are the `app/api/v1/auth/token/route.test.ts` shape: the seams
// around the decision are replaced, the decision itself is the real one. No
// database — every assertion below is about something that must happen BEFORE a
// write, and a test that needed a database to prove "nothing was written" would
// be proving it in the one place the bug would not be.
//
// 🚨 **The sharpest assertion here measures an ABSENCE.** For a `content` row,
// "the action answered with the right code" is not the claim — the claim is
// that the writing function in `../lib/manage` was NEVER CALLED. An action that
// returned the code and wrote anyway would pass the first and fail the second,
// and it is the second that a member's course depends on.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The course every fixture writes into — hoisted, so the mock factory sees it. */
const COURSE_ROW = {
  id: "course-1",
  slug: "kurs",
  title: "Der Kurs",
  summary: null,
  position: 1,
  shape: "drip" as string | null,
  planKeys: ["basic_monthly"],
  origin: "content",
};

vi.mock("../lib/config", () => ({
  isCourseEnabled: vi.fn(() => true),
}));

// The shape and the sale live on the COURSE now. The admin surface reaches it
// two ways and both are mocked: BY SLUG when a form names it (creating a
// block), BY ID when a row already knows it (editing one).
vi.mock("../lib/courses", () => ({
  courseBySlugForOperator: vi.fn(async () => COURSE_ROW),
  courseByIdForOperator: vi.fn(async () => COURSE_ROW),
}));

vi.mock("@/lib/authz", () => ({
  requireOwner: vi.fn(async () => ({ user: { id: "owner-1", role: "owner" } })),
}));

// Every function the actions import from the shell, all of them spies. The
// readers answer, the writers do nothing — so "was it called" is the whole
// question and there is no way for a write to succeed by accident.
vi.mock("../lib/manage", () => ({
  blockById: vi.fn(),
  unitById: vi.fn(),
  blockPositions: vi.fn(async () => []),
  unitPositions: vi.fn(async () => []),
  unitCountFor: vi.fn(async () => 0),
  unitSlugsIn: vi.fn(async () => []),
  blockSlugTaken: vi.fn(async () => false),
  unitSlugTaken: vi.fn(async () => false),
  createBlock: vi.fn(async () => ({ id: "b-new", slug: "neu" })),
  updateBlock: vi.fn(async () => true),
  deleteBlock: vi.fn(async () => true),
  setBlockPosition: vi.fn(async () => true),
  createUnit: vi.fn(async () => ({ id: "u-new", slug: "neu" })),
  updateUnit: vi.fn(async () => true),
  deleteUnit: vi.fn(async () => true),
  setUnitPosition: vi.fn(async () => true),
}));

// The content tree, which the actions reach through a DYNAMIC import — the
// registry catches that exactly as it catches a static one.
vi.mock("../lib/content-files", () => ({
  contentFileIndex: vi.fn(() => ({
    courses: new Map<string, string>(),
    blocks: new Map<string, string>(),
    units: new Map<string, string>(),
    unreadable: [] as string[],
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// `notFound()` and the redirect inside `requireOwner()` both signal by
// THROWING, and `toState()` is required to let them past. Two distinguishable
// markers, and `unstable_rethrow` rethrows both — a mock that swallowed them
// would make every guard test pass by turning a refusal into "unknown error".
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("TEST_NOT_FOUND");
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && /^TEST_(NOT_FOUND|REDIRECT)$/.test(error.message)) {
      throw error;
    }
  },
}));

vi.mock("next-intl/server", () => ({
  // A translator that is a pure function of (namespace, key, values), so the
  // code a refusal carries is readable in the string it produced.
  getTranslations: vi.fn(
    async (namespace: string) => (key: string, values?: unknown) =>
      `${namespace}.${key}(${JSON.stringify(values ?? null)})`,
  ),
}));

import { requireOwner } from "@/lib/authz";

import { isCourseEnabled } from "../lib/config";
import { courseByIdForOperator, courseBySlugForOperator } from "../lib/courses";
import { contentFileIndex } from "../lib/content-files";
import {
  blockById,
  blockPositions,
  blockSlugTaken,
  createBlock,
  createUnit,
  deleteBlock,
  deleteUnit,
  setBlockPosition,
  setUnitPosition,
  unitById,
  unitCountFor,
  unitPositions,
  unitSlugTaken,
  updateBlock,
  updateUnit,
} from "../lib/manage";
import {
  createBlockAction,
  createUnitAction,
  deleteBlockAction,
  deleteUnitAction,
  moveAction,
  updateBlockAction,
  updateUnitAction,
} from "./actions";

const EMPTY = { error: null, ok: null };

/** Every function that WRITES. The absence measured below is theirs. */
const WRITERS = {
  createBlock,
  updateBlock,
  deleteBlock,
  setBlockPosition,
  createUnit,
  updateUnit,
  deleteUnit,
  setUnitPosition,
};

function expectNothingWritten() {
  for (const [name, fn] of Object.entries(WRITERS)) {
    expect(fn, `${name} was called`).not.toHaveBeenCalled();
  }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const OPERATOR_BLOCK = {
  id: "b-1",
  courseId: "course-1",
  slug: "woche-1",
  origin: "operator",
  title: "Woche 1",
  summary: null,
  position: 1,
  releaseAfterDays: 0,
};
const CONTENT_BLOCK = { ...OPERATOR_BLOCK, id: "b-2", slug: "woche-2", origin: "content" };
const OPERATOR_UNIT = {
  id: "u-1",
  blockId: "b-1",
  slug: "willkommen",
  origin: "operator",
  title: "Willkommen",
  position: 1,
  body: null,
  taskPrompt: null,
};
const CONTENT_UNIT = { ...OPERATOR_UNIT, id: "u-2", slug: "atmung", origin: "content" };

/**
 * Every exported action, called the way its form calls it.
 *
 * A table rather than a test each, deliberately: the guard claims below hold
 * for ALL of them, and a per-action test is a list somebody forgets to extend.
 */
const ACTIONS = [
  { name: "createBlockAction", run: () => createBlockAction(EMPTY, form({ slug: "neu", title: "N", position: "9" })) },
  { name: "updateBlockAction", run: () => updateBlockAction(EMPTY, form({ id: "b-1", title: "N" })) },
  { name: "deleteBlockAction", run: () => deleteBlockAction(EMPTY, form({ id: "b-1" })) },
  { name: "createUnitAction", run: () => createUnitAction(EMPTY, form({ blockId: "b-1", slug: "neu", title: "N", position: "9" })) },
  { name: "updateUnitAction", run: () => updateUnitAction(EMPTY, form({ id: "u-1", title: "N" })) },
  { name: "deleteUnitAction", run: () => deleteUnitAction(EMPTY, form({ id: "u-1" })) },
  { name: "moveBlockAction", run: () => moveAction(EMPTY, form({ kind: "block", id: "b-1", position: "5" })) },
  { name: "moveUnitAction", run: () => moveAction(EMPTY, form({ kind: "unit", id: "u-1", position: "5" })) },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCourseEnabled).mockReturnValue(true);
  COURSE_ROW.shape = "drip";
  vi.mocked(requireOwner).mockResolvedValue({
    user: { id: "owner-1", role: "owner" },
  } as Awaited<ReturnType<typeof requireOwner>>);
  vi.mocked(blockById).mockResolvedValue(OPERATOR_BLOCK as never);
  vi.mocked(unitById).mockResolvedValue(OPERATOR_UNIT as never);
  vi.mocked(blockPositions).mockResolvedValue([]);
  vi.mocked(unitPositions).mockResolvedValue([]);
  vi.mocked(unitCountFor).mockResolvedValue(0);
  vi.mocked(blockSlugTaken).mockResolvedValue(false);
  vi.mocked(unitSlugTaken).mockResolvedValue(false);
  vi.mocked(contentFileIndex).mockReturnValue({
    courses: new Map(),
    blocks: new Map(),
    units: new Map(),
    unreadable: [],
  });
});

describe("🚨 the guard sequence — every action asks, per request", () => {
  // A Server Action is an HTTP endpoint of its own. That the PAGE checked says
  // nothing about a request somebody replayed, which is why these run against
  // every exported action rather than against one.

  for (const { name, run } of ACTIONS) {
    it(`${name}: a switched-off course is not found`, async () => {
      vi.mocked(isCourseEnabled).mockReturnValue(false);
      await expect(run()).rejects.toThrow("TEST_NOT_FOUND");
      expectNothingWritten();
    });

    it(`${name}: a broken config is not found either`, async () => {
      // `isCourseEnabled()` is false in BOTH states, and that is the point: the
      // page forks and diagnoses, an action has nothing to diagnose and must
      // not write against a config whose `shape` nothing can read.
      vi.mocked(isCourseEnabled).mockReturnValue(false);
      await expect(run()).rejects.toThrow("TEST_NOT_FOUND");
    });

    it(`${name}: a member is refused`, async () => {
      vi.mocked(requireOwner).mockRejectedValue(new Error("TEST_REDIRECT"));
      await expect(run()).rejects.toThrow("TEST_REDIRECT");
      expectNothingWritten();
    });

    it(`${name}: a moderator is refused — that is what requireOwner() means`, async () => {
      // A moderator looks after people, not after the course's structure. The
      // refusal is `requireOwner()`'s and is not restated in the action, so
      // what this pins is that the action goes THROUGH it.
      vi.mocked(requireOwner).mockRejectedValue(new Error("TEST_REDIRECT"));
      await expect(run()).rejects.toThrow("TEST_REDIRECT");
      expectNothingWritten();
    });
  }

  it("🚨 off beats owner — the switch is asked BEFORE the session", async () => {
    // Not an ordering nicety: an owner must not get a preview of a switched-off
    // module. If the two lines were the other way round an owner would reach
    // the write path in a state the operator deliberately parked.
    vi.mocked(isCourseEnabled).mockReturnValue(false);
    await expect(
      deleteBlockAction(EMPTY, form({ id: "b-1" })),
    ).rejects.toThrow("TEST_NOT_FOUND");
    expect(requireOwner).not.toHaveBeenCalled();
  });
});

describe("🚨 AC 2 — a content row is unreachable from every write action", () => {
  // The claim the whole partition rests on, measured per action rather than
  // once: a row the applier owns is re-asserted by every `content-apply`, so a
  // change made here would vanish at the next deploy with nothing said about it.

  const AGAINST_CONTENT = [
    {
      name: "updateBlockAction",
      arrange: () => vi.mocked(blockById).mockResolvedValue(CONTENT_BLOCK as never),
      run: () => updateBlockAction(EMPTY, form({ id: "b-2", title: "N" })),
    },
    {
      name: "deleteBlockAction",
      arrange: () => vi.mocked(blockById).mockResolvedValue(CONTENT_BLOCK as never),
      run: () => deleteBlockAction(EMPTY, form({ id: "b-2" })),
    },
    {
      name: "moveAction(block)",
      arrange: () => vi.mocked(blockById).mockResolvedValue(CONTENT_BLOCK as never),
      run: () => moveAction(EMPTY, form({ kind: "block", id: "b-2", position: "4" })),
    },
    {
      name: "updateUnitAction",
      arrange: () => vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never),
      run: () => updateUnitAction(EMPTY, form({ id: "u-2", title: "N" })),
    },
    {
      name: "deleteUnitAction",
      arrange: () => vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never),
      run: () => deleteUnitAction(EMPTY, form({ id: "u-2" })),
    },
    {
      name: "moveAction(unit)",
      arrange: () => vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never),
      run: () => moveAction(EMPTY, form({ kind: "unit", id: "u-2", position: "4" })),
    },
  ] as const;

  for (const { name, arrange, run } of AGAINST_CONTENT) {
    it(`${name} refuses with coursesContentRowLocked AND writes nothing`, async () => {
      arrange();
      const state = await run();
      expect(state.error).toContain("coursesContentRowLocked");
      expect(state.ok).toBeNull();
      expectNothingWritten();
    });
  }

  it("names the file the row came from", async () => {
    vi.mocked(blockById).mockResolvedValue(CONTENT_BLOCK as never);
    vi.mocked(contentFileIndex).mockReturnValue({
      courses: new Map(),
      blocks: new Map([["woche-2", "02-woche.json"]]),
      units: new Map(),
      unreadable: [],
    });
    const state = await updateBlockAction(EMPTY, form({ id: "b-2", title: "N" }));
    expect(state.error).toContain("content/course/02-woche.json");
  });

  it("says so honestly when no file claims it any more", async () => {
    // A `content` row whose file left the tree. Falling back to "made here"
    // would relabel the one row that is about to surprise somebody — the next
    // `content-apply` has nothing to assert it from and leaves it standing.
    vi.mocked(blockById).mockResolvedValue(CONTENT_BLOCK as never);
    const state = await updateBlockAction(EMPTY, form({ id: "b-2", title: "N" }));
    expect(state.error).toContain("originContentOrphan");
  });

  it("🚨 the loop above is not vacuous — an operator row goes through", async () => {
    // The needle. Without this, a `rowWritable()` that refused EVERYTHING would
    // make every assertion above pass while the surface wrote nothing at all.
    const state = await updateBlockAction(EMPTY, form({ id: "b-1", title: "Neu" }));
    expect(state.error).toBeNull();
    expect(updateBlock).toHaveBeenCalledTimes(1);
  });
});

describe("🚨 AC 3 — a slug a content file names is taken, applied or not", () => {
  it("refuses a block slug claimed by a file with no row behind it", async () => {
    // The whole reason this surface reads the TREE. `blockSlugTaken` answers
    // false — there is no row, because the file has never been applied — and
    // the refusal has to come anyway, or tomorrow's `content-apply` refuses its
    // whole run over a slug nobody was warned about.
    vi.mocked(blockSlugTaken).mockResolvedValue(false);
    vi.mocked(contentFileIndex).mockReturnValue({
      courses: new Map(),
      blocks: new Map([["woche-3", "03-woche.json"]]),
      units: new Map(),
      unreadable: [],
    });

    const state = await createBlockAction(
      EMPTY,
      form({ slug: "woche-3", title: "Woche 3", position: "3" }),
    );
    expect(state.error).toContain("coursesSlugClaimedByContent");
    expect(state.error).toContain("content/course/03-woche.json");
    expect(createBlock).not.toHaveBeenCalled();
  });

  it("refuses a lesson slug the same way", async () => {
    vi.mocked(unitSlugTaken).mockResolvedValue(false);
    vi.mocked(contentFileIndex).mockReturnValue({
      courses: new Map(),
      blocks: new Map(),
      units: new Map([["atmung", "02-woche.json"]]),
      unreadable: [],
    });

    const state = await createUnitAction(
      EMPTY,
      form({ blockId: "b-1", slug: "atmung", title: "Atmung", position: "1" }),
    );
    expect(state.error).toContain("coursesSlugClaimedByContent");
    expect(createUnit).not.toHaveBeenCalled();
  });

  it("refuses a slug a ROW holds even when no file names it", async () => {
    // The other direction: a `content` row whose file was deleted keeps its
    // slug, and the tree says nothing about it.
    vi.mocked(blockSlugTaken).mockResolvedValue(true);
    const state = await createBlockAction(
      EMPTY,
      form({ slug: "woche-1", title: "X", position: "3" }),
    );
    expect(state.error).toContain("coursesSlugTaken");
    expect(createBlock).not.toHaveBeenCalled();
  });

  it("refuses a slug that is not a slug", async () => {
    const state = await createBlockAction(
      EMPTY,
      form({ slug: "Woche 3", title: "X", position: "3" }),
    );
    expect(state.error).toContain("coursesSlugMalformed");
    expect(createBlock).not.toHaveBeenCalled();
  });

  it("🚨 lets a free slug through — the three refusals above are not vacuous", async () => {
    const state = await createBlockAction(
      EMPTY,
      form({ slug: "woche-3", title: "Woche 3", position: "3" }),
    );
    expect(state.error).toBeNull();
    expect(createBlock).toHaveBeenCalledTimes(1);
  });
});

describe("positions and emptiness", () => {
  it("refuses a position another row holds — including a content row", async () => {
    vi.mocked(blockPositions).mockResolvedValue([1, 2]);
    const state = await createBlockAction(
      EMPTY,
      form({ slug: "woche-3", title: "X", position: "2" }),
    );
    expect(state.error).toContain("coursesPositionTaken");
    expect(createBlock).not.toHaveBeenCalled();
  });

  it("leaves a row out of its own scope when moving it", async () => {
    await moveAction(EMPTY, form({ kind: "block", id: "b-1", position: "3" }));
    // 🚨 Two arguments now, and both matter: the positions are asked WITHIN the
    // block's own course — an app-wide reading would refuse a move onto a
    // position another course happens to occupy — and the block is still left
    // out of its own scope, because re-saving a row where it already is is not
    // a collision with itself.
    expect(blockPositions).toHaveBeenCalledWith("course-1", "b-1");
    expect(setBlockPosition).toHaveBeenCalledWith("b-1", 3);
  });

  it("🚨 refuses to delete a block that still holds lessons, and names the count", async () => {
    vi.mocked(unitCountFor).mockResolvedValue(3);
    const state = await deleteBlockAction(EMPTY, form({ id: "b-1" }));
    expect(state.error).toContain("coursesBlockNotEmpty");
    expect(state.error).toContain("3");
    expect(deleteBlock).not.toHaveBeenCalled();
  });

  it("deletes an empty one", async () => {
    const state = await deleteBlockAction(EMPTY, form({ id: "b-1" }));
    expect(state.error).toBeNull();
    expect(deleteBlock).toHaveBeenCalledWith("b-1");
  });
});

describe("🚨 AC 5 — releaseAfterDays exists only in a drip course", () => {
  it("is read and kept in a drip course", async () => {
    COURSE_ROW.shape = "drip";
    await createBlockAction(
      EMPTY,
      form({ slug: "woche-3", title: "X", position: "3", releaseAfterDays: "14" }),
    );
    expect(createBlock).toHaveBeenCalledWith(
      expect.objectContaining({ releaseAfterDays: 14 }),
    );
  });

  for (const shape of ["self-study", "workshop"] as const) {
    it(`is ignored in a ${shape} course, even from a crafted post`, async () => {
      // The form does not render the field there — this is the other half:
      // a request that carries it anyway changes nothing, and there is
      // deliberately no error code for it. A field that is not there needs none.
      COURSE_ROW.shape = shape;
      await createBlockAction(
        EMPTY,
        form({ slug: "woche-3", title: "X", position: "3", releaseAfterDays: "14" }),
      );
      expect(createBlock).toHaveBeenCalledWith(
        expect.objectContaining({ releaseAfterDays: 0 }),
      );
    });
  }
});

describe("what a write reports back", () => {
  it("every action ends with a message — none of them is silent", async () => {
    // `CLAUDE.md` → UI, rule 1. An action with no feedback reads as an error.
    for (const { name, run } of ACTIONS) {
      vi.clearAllMocks();
      vi.mocked(blockById).mockResolvedValue(OPERATOR_BLOCK as never);
      vi.mocked(unitById).mockResolvedValue(OPERATOR_UNIT as never);
      vi.mocked(contentFileIndex).mockReturnValue({
        courses: new Map(),
        blocks: new Map(),
        units: new Map(),
        unreadable: [],
      });
      const state = await run();
      expect(Boolean(state.ok) || Boolean(state.error), `${name} said nothing`).toBe(true);
    }
  });

  it("a missing row is a refusal, not a crash", async () => {
    vi.mocked(blockById).mockResolvedValue(null as never);
    const state = await updateBlockAction(EMPTY, form({ id: "gone", title: "X" }));
    expect(state.error).toContain("coursesNotFound");
  });

  it("an unexpected failure becomes the unknown error, not a stack trace", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(blockById).mockRejectedValue(new Error("the database went away"));
    const state = await updateBlockAction(EMPTY, form({ id: "b-1", title: "X" }));
    expect(state.error).toContain("unknown");
    expect(state.error).not.toContain("database went away");
    spy.mockRestore();
  });
});
