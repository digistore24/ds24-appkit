// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a member's own actions refuse — the first test over this file at all.
//
// The mocks are `../admin/actions.test.ts`'s shape: the seams around the
// decision are replaced, the decision itself (`../rules.ts`) is the real one. No
// database — every assertion here is about something that must happen BEFORE a
// write, and a test that needed a database to prove "nothing was written" would
// be proving it in the one place the bug would not be.
//
// 🚨 **The sharpest assertion measures an ABSENCE, and it is repeated on every
// refusal.** "The action answered with the right code" is not the claim; the
// claim is that `upsertSubmission()` was NEVER CALLED. An action that returned
// the code and wrote anyway would pass the first and fail the second — and the
// second is the one a member's frozen hand-in depends on.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", () => ({
  courseOffReason: vi.fn(() => null),
}));

// The shape lives on the COURSE now, and the actions reach it by walking the
// lesson: unit → block → `courseById()`. Mocking that walk's last step is what
// used to be a one-line `courseShape()` mock.
vi.mock("../lib/courses", () => ({
  courseById: vi.fn(async () => ({
    id: "course-1",
    slug: "kurs",
    title: "Der Kurs",
    summary: null,
    position: 1,
    shape: "workshop",
    planKeys: ["basic_monthly"],
    origin: "content",
  })),
}));

vi.mock("../lib/access", () => ({
  courseAccessFor: vi.fn(async () => ({
    entitled: true,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    asOperator: false,
  })),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveUser: vi.fn(async () => ({ user: { id: "member-1", role: "member" } })),
}));

// Every function the actions import from the shell, all of them spies. The
// readers answer, the writers do nothing — so "was it called" is the whole
// question and there is no way for a write to succeed by accident.
vi.mock("../lib/manage", () => ({
  unitBySlug: vi.fn(),
  blockById: vi.fn(),
  setCompleted: vi.fn(async () => undefined),
  submissionFor: vi.fn(async () => null),
  upsertSubmission: vi.fn(async () => true),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// `notFound()` signals by THROWING, and the off state is the whole reason this
// file exists — a mock that swallowed it would turn a refusal into "unknown
// error" and every guard test would pass.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("TEST_NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  // A translator that is a pure function of (namespace, key), so the code a
  // refusal carries — and the NAMESPACE it came from — are readable in the
  // string it produced.
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}.${key}`),
}));

import { requireActiveUser } from "@/lib/authz";

import { courseAccessFor } from "../lib/access";
import { courseOffReason } from "../lib/config";
import { courseById } from "../lib/courses";
import { blockById, submissionFor, unitBySlug, upsertSubmission } from "../lib/manage";
import { MAX_SUBMISSION_CHARS } from "../rules";
import { submitTaskAction } from "./actions";

const EMPTY = { error: null, ok: null };

const BLOCK = { id: "b-1", slug: "woche-1", position: 1, releaseAfterDays: 0 };
const UNIT = {
  id: "u-1",
  blockId: "b-1",
  slug: "woche-1-aufgabe",
  origin: "content",
  title: "Woche 1",
  position: 1,
  body: null,
  taskPrompt: "Write down what you noticed.",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const HAND_IN = () => form({ unitSlug: UNIT.slug, body: "I noticed three things." });

/** The absence, asserted the same way everywhere. */
function expectNothingWritten() {
  expect(upsertSubmission, "upsertSubmission was called").toHaveBeenCalledTimes(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(courseOffReason).mockReturnValue(null);
  vi.mocked(courseById).mockResolvedValue({
    id: "course-1",
    slug: "kurs",
    title: "Der Kurs",
    summary: null,
    position: 1,
    shape: "workshop",
    planKeys: ["basic_monthly"],
    origin: "content",
  });
  vi.mocked(requireActiveUser).mockResolvedValue({
    user: { id: "member-1", role: "member" },
  } as never);
  vi.mocked(courseAccessFor).mockResolvedValue({
    entitled: true,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    asOperator: false,
  });
  vi.mocked(unitBySlug).mockResolvedValue(UNIT as never);
  vi.mocked(blockById).mockResolvedValue(BLOCK as never);
  vi.mocked(submissionFor).mockResolvedValue(null as never);
  vi.mocked(upsertSubmission).mockResolvedValue(true);
});

describe("handing work in", () => {
  it("writes exactly once, with the session's account and the trimmed text", async () => {
    const state = await submitTaskAction(EMPTY, form({ unitSlug: UNIT.slug, body: "  hello  " }));

    expect(upsertSubmission).toHaveBeenCalledTimes(1);
    // 🚨 The member id is the SESSION's — nothing in the form named it. And the
    // stored string is the trimmed one, which is exactly the string the rule
    // judged: a check on one text beside a store of another is two texts
    // wearing one decision.
    expect(upsertSubmission).toHaveBeenCalledWith("member-1", UNIT.slug, "hello");
    expect(state.error).toBeNull();
  });

  it("🚨 says it worked in the courses namespace, not in errors", () => {
    // `errors` is the SHARED namespace the refusal codes live in.
    // `coursesMarkedDone` sits there and should not; this is not a precedent to
    // follow, and the mocked translator makes the namespace visible.
    return submitTaskAction(EMPTY, HAND_IN()).then((state) => {
      expect(state.ok).toBe("courses.submissionSaved");
      expect(state.ok).not.toMatch(/^errors\./);
    });
  });

  it("🚨 takes no member id from the form — one there changes nothing", async () => {
    await submitTaskAction(
      EMPTY,
      form({ unitSlug: UNIT.slug, body: "hello", memberId: "somebody-else" }),
    );
    expect(upsertSubmission).toHaveBeenCalledWith("member-1", UNIT.slug, "hello");
  });

  it("revalidates the lesson it wrote", async () => {
    const { revalidatePath } = await import("next/cache");
    await submitTaskAction(EMPTY, HAND_IN());
    // The lesson's path carries its COURSE now — a revalidate of the old,
    // course-less path would name a route that no longer exists, so the page
    // would keep serving a hand-in that is no longer there.
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/course/kurs/${UNIT.slug}`);
  });
});

describe("the off state answers before it asks the database", () => {
  // AC 10, and the reason it is two cases: a course switched OFF and a course
  // whose config does not hold are different faults with the same answer, and
  // an action has nothing to diagnose in either.
  for (const reason of ["disabledInConfig", "brokenConfig"] as const) {
    it(`refuses on ${reason} without reading or writing anything`, async () => {
      vi.mocked(courseOffReason).mockReturnValue(reason);

      const outcome = await submitTaskAction(EMPTY, HAND_IN()).then(
        () => "it returned instead of refusing",
        (error: unknown) => (error as Error).message,
      );

      // 🚨 The absence is asserted FIRST, and the order is the point. An action
      // that read the row and THEN threw the not-found would answer correctly
      // and still have touched a switched-off module's data — so the claim that
      // has to go red first is "it did not look", not "it said no".
      expect(submissionFor, "submissionFor was called").toHaveBeenCalledTimes(0);
      expect(unitBySlug, "unitBySlug was called").toHaveBeenCalledTimes(0);
      expectNothingWritten();
      expect(outcome).toBe("TEST_NOT_FOUND");
    });
  }
});

describe("what it refuses", () => {
  it("refuses somebody who has not bought the course", async () => {
    vi.mocked(courseAccessFor).mockResolvedValue({
      entitled: false,
      startedAt: null,
      asOperator: false,
    });

    await expect(submitTaskAction(EMPTY, HAND_IN())).rejects.toThrow("TEST_NOT_FOUND");
    expectNothingWritten();
  });

  it("refuses a slug nobody wrote", async () => {
    vi.mocked(unitBySlug).mockResolvedValue(null as never);

    const state = await submitTaskAction(EMPTY, form({ unitSlug: "erfunden", body: "x" }));
    expect(state.error).toBe("errors.coursesNotFound");
    expectNothingWritten();
  });

  it("refuses a lesson whose block has vanished", async () => {
    vi.mocked(blockById).mockResolvedValue(null as never);

    const state = await submitTaskAction(EMPTY, HAND_IN());
    expect(state.error).toBe("errors.coursesNotFound");
    expectNothingWritten();
  });

  it("🚨 a locked lesson refuses, although the page would have redirected", async () => {
    // The unlock rule, re-applied. Without this line a learner could hand week
    // ten in on day one by replaying the action — the page's redirect says
    // nothing about a request somebody sent by hand.
    // A learner who bought TODAY, on a block that opens after nine weeks.
    vi.mocked(courseAccessFor).mockResolvedValue({
      entitled: true,
      startedAt: new Date(),
      asOperator: false,
    });
    vi.mocked(blockById).mockResolvedValue({ ...BLOCK, releaseAfterDays: 63 } as never);

    const state = await submitTaskAction(EMPTY, HAND_IN());
    expect(state.error).toBe("errors.coursesLocked");
    expectNothingWritten();
  });

  it("refuses one on a course that takes no hand-ins", async () => {
    vi.mocked(courseById).mockResolvedValue({
    id: "course-1",
    slug: "kurs",
    title: "Der Kurs",
    summary: null,
    position: 1,
    shape: "drip",
    planKeys: ["basic_monthly"],
    origin: "content",
  });

    const state = await submitTaskAction(EMPTY, HAND_IN());
    expect(state.error).toBe("errors.coursesShapeForbidsSubmission");
    expectNothingWritten();
  });

  it("refuses one on a lesson that asks for nothing", async () => {
    vi.mocked(unitBySlug).mockResolvedValue({ ...UNIT, taskPrompt: null } as never);

    const state = await submitTaskAction(EMPTY, HAND_IN());
    expect(state.error).toBe("errors.coursesNotFound");
    expectNothingWritten();
  });

  it("refuses an empty one, whitespace included", async () => {
    for (const body of ["", "   \n  "]) {
      vi.clearAllMocks();
      const state = await submitTaskAction(EMPTY, form({ unitSlug: UNIT.slug, body }));
      expect(state.error, JSON.stringify(body)).toBe("errors.coursesSubmissionEmpty");
      expectNothingWritten();
    }
  });

  it("refuses one nobody could have written", async () => {
    const state = await submitTaskAction(
      EMPTY,
      form({ unitSlug: UNIT.slug, body: "a".repeat(MAX_SUBMISSION_CHARS + 1) }),
    );
    expect(state.error).toBe("errors.coursesSubmissionTooLong");
    expectNothingWritten();
  });

  it("🚨 refuses one that has already been answered", async () => {
    vi.mocked(submissionFor).mockResolvedValue({
      id: "s-1",
      memberId: "member-1",
      unitSlug: UNIT.slug,
      body: "the first version",
      submittedAt: new Date("2026-02-01T00:00:00Z"),
      reply: "Well seen.",
      repliedAt: new Date("2026-02-03T00:00:00Z"),
      repliedBy: "owner-1",
    } as never);

    const state = await submitTaskAction(EMPTY, HAND_IN());
    expect(state.error).toBe("errors.coursesAlreadyReplied");
    expectNothingWritten();
  });

  it("🚨 answers alreadyReplied when the STATEMENT hit no row", async () => {
    // Somebody replied between the check and the write. The statement carries
    // `replied_at is null` too (`../lib/manage.test.ts`), so it matched nothing
    // — and an upsert matching nothing SUCCEEDS, which is why the write reports
    // whether it hit a row rather than returning nothing.
    vi.mocked(upsertSubmission).mockResolvedValue(false);

    const state = await submitTaskAction(EMPTY, HAND_IN());
    expect(state.error).toBe("errors.coursesAlreadyReplied");
    expect(state.ok).toBeNull();
  });

  it("lets a revision through while nobody has answered", async () => {
    vi.mocked(submissionFor).mockResolvedValue({
      id: "s-1",
      memberId: "member-1",
      unitSlug: UNIT.slug,
      body: "the first version",
      submittedAt: new Date("2026-02-01T00:00:00Z"),
      reply: null,
      repliedAt: null,
      repliedBy: null,
    } as never);

    const state = await submitTaskAction(
      EMPTY,
      form({ unitSlug: UNIT.slug, body: "the second version" }),
    );
    expect(state.error).toBeNull();
    expect(upsertSubmission).toHaveBeenCalledTimes(1);
    expect(upsertSubmission).toHaveBeenCalledWith("member-1", UNIT.slug, "the second version");
  });

  it("🚨 reads the existing row scoped to the session's own account", async () => {
    // Where an IDOR would live: `unitSlug` is a string the browser sent, and
    // the member id it is paired with is never one.
    await submitTaskAction(EMPTY, form({ unitSlug: UNIT.slug, body: "x", memberId: "other" }));
    expect(submissionFor).toHaveBeenCalledWith("member-1", UNIT.slug);
  });
});
