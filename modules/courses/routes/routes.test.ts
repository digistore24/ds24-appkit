// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's v1 surface, one contract per route.
//
// Four claims, and each is one this module can get wrong on its own — the
// shared guard is covered where it lives (`modules/api/api/guard.ts`), and
// `modules/api/routes/guard-presence.test.ts` is what proves these handlers
// call it at all:
//
//   1. **guard first** — a refused request reaches no query. The mock database
//      layer throws, so "reached a query" is a failure rather than a count.
//   2. **the IDOR invariant** — the member acted on is the KEY's owner, and a
//      `memberId` in the query string or body changes nothing.
//   3. **the unlock rule, per endpoint** — every one of the three lesson doors
//      re-applies it. This is the one a reviewer would call redundant: the
//      outline already said the block is shut, and each of these is a separate
//      HTTP request that has been told nothing.
//   4. **the outline hands out no content** — no body, no media id. A leak
//      there would give week ten to somebody in week one in one request, past
//      every check the lesson endpoint makes.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The course these routes serve — hoisted for the mock factories. */
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

vi.mock("@/modules/api/api/guard", () => ({ guardApi: vi.fn() }));
vi.mock("../lib/access", () => ({ courseAccessFor: vi.fn() }));
vi.mock("../lib/config", () => ({ courseOffReason: vi.fn() }));

// The shape and the sale live on the COURSE. The API reaches it two ways —
// `courseBySlug()` for the outline, whose URL names it, and `courseById()` for
// the three lesson routes, which derive it from the lesson.
vi.mock("../lib/courses", () => ({
  courseBySlug: vi.fn(async () => COURSE_ROW),
  courseById: vi.fn(async () => COURSE_ROW),
  usableCourses: vi.fn(async () => [COURSE_ROW]),
}));
vi.mock("../lib/manage", () => ({
  blockById: vi.fn(),
  completedSlugsFor: vi.fn(),
  courseOutline: vi.fn(),
  setCompleted: vi.fn(),
  submissionFor: vi.fn(),
  unitBySlug: vi.fn(),
  upsertSubmission: vi.fn(),
}));

import { guardApi } from "@/modules/api/api/guard";

import { courseAccessFor } from "../lib/access";
import { courseOffReason } from "../lib/config";
import { courseById, courseBySlug, usableCourses } from "../lib/courses";
import {
  blockById,
  completedSlugsFor,
  courseOutline,
  setCompleted,
  submissionFor,
  unitBySlug,
  upsertSubmission,
} from "../lib/manage";

import * as outline from "./course-outline";
import * as unit from "./unit";
import * as completion from "./completion";
import * as submission from "./submission";

const MEMBER = "member-1";
const GUARDED = {
  ok: true,
  memberId: MEMBER,
  keyId: "key-1",
  scope: "write",
  role: "member",
} as const;

const WHEN = new Date("2026-08-01T10:00:00Z");
const ISO = "2026-08-01T10:00:00.000Z";

/**
 * The fixtures are the FULL row shapes, not the fields these handlers happen to
 * read — the typecheck insists, and it is right to: a partial fixture passes
 * vitest and hides the day a handler starts reading a column that was never in
 * the test's world.
 */
const BLOCK = {
  id: "b1",
  courseId: "course-1",
  slug: "week-1",
  origin: "content",
  title: "Week 1",
  summary: null,
  position: 1,
  releaseAfterDays: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

const UNIT = {
  id: "u1",
  blockId: "b1",
  slug: "lesson-1",
  origin: "content",
  title: "Lesson 1",
  position: 1,
  body: "the text",
  taskPrompt: "hand something in",
  coverMediaId: "m-cover",
  videoMediaId: "m-video",
  subtitleMediaId: null,
  worksheetMediaId: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

type Submission = Awaited<ReturnType<typeof submissionFor>>;

/**
 * `submissionFor()` answers `row ?? null`, and TypeScript reads the destructured
 * row as always-present, so the declared return type has no `null` in it. The
 * cast is named here once rather than sprinkled through the tests.
 */
const haveSubmission = (row: Submission | null) =>
  vi.mocked(submissionFor).mockResolvedValue(row as Submission);

/** A request that TRIES to name somebody else, every way a request can. */
function nosyRequest(method = "GET", body?: unknown): Request {
  return new Request("http://localhost:3000/api/v1/courses?memberId=somebody-else", {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

const params = (slug = UNIT.slug) => ({ params: Promise.resolve({ slug }) });
/** The outline route names its COURSE in the path; the lesson routes do not. */
const courseParams = (course = COURSE_ROW.slug) => ({ params: Promise.resolve({ course }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guardApi).mockResolvedValue({ ...GUARDED });
  vi.mocked(courseOffReason).mockReturnValue(null);
  COURSE_ROW.shape = "workshop";
  vi.mocked(courseAccessFor).mockResolvedValue({
    entitled: true,
    startedAt: new Date(0),
    asOperator: false,
  });
  vi.mocked(courseOutline).mockResolvedValue([{ ...BLOCK, units: [UNIT] }]);
  vi.mocked(completedSlugsFor).mockResolvedValue(new Set<string>());
  vi.mocked(unitBySlug).mockResolvedValue(UNIT);
  vi.mocked(blockById).mockResolvedValue(BLOCK);
  haveSubmission(null);
  vi.mocked(upsertSubmission).mockResolvedValue(true);
});

/** Every door, so a new one cannot be added without meeting the claims below. */
const DOORS = [
  { name: "GET /courses", call: () => outline.GET(nosyRequest(), courseParams()) },
  { name: "GET /courses/units/{slug}", call: () => unit.GET(nosyRequest(), params()) },
  {
    name: "POST /courses/units/{slug}/completion",
    call: () => completion.POST(nosyRequest("POST", { done: true }), params()),
  },
  {
    name: "POST /courses/units/{slug}/submission",
    call: () => submission.POST(nosyRequest("POST", { body: "my work" }), params()),
  },
] as const;

describe("guard first — a refused request reaches no query", () => {
  for (const door of DOORS) {
    it(`${door.name} asks nothing once the guard says no`, async () => {
      vi.mocked(guardApi).mockResolvedValue({
        ok: false,
        response: new Response(null, { status: 401 }),
      });

      const response = await door.call();

      expect(response.status).toBe(401);
      // Not "was called with the right thing" — not called AT ALL. The course
      // gate is behind the key check, so a request with no key must not even
      // reach `courseAccessFor()`, which reads `grants`.
      expect(courseAccessFor).not.toHaveBeenCalled();
      expect(courseOutline).not.toHaveBeenCalled();
      expect(unitBySlug).not.toHaveBeenCalled();
      expect(setCompleted).not.toHaveBeenCalled();
      expect(upsertSubmission).not.toHaveBeenCalled();
    });
  }
});

describe("the account acted on is the key's owner", () => {
  for (const door of DOORS) {
    it(`${door.name} ignores a memberId in the request`, async () => {
      await door.call();

      // Every member-scoped read and write, asked with the guard's id and never
      // with the one in the query string.
      for (const fn of [completedSlugsFor, submissionFor, setCompleted, upsertSubmission]) {
        for (const call of vi.mocked(fn).mock.calls) {
          expect(call[0]).toBe(MEMBER);
        }
      }
      // The gate takes the COURSE now — the account is still the guard's, and
      // the course is still never the request's: the outline route reads it out
      // of its path, the three lesson routes derive it from the lesson.
      expect(courseAccessFor).toHaveBeenCalledWith(MEMBER, "member", COURSE_ROW);
    });
  }

  it("no handler reads an id off the request at all", async () => {
    // The source-level half of the same claim: the runtime one above proves
    // what happens for the requests it makes, this one proves there is no code
    // path at all. `pages/guard.test.ts` makes it for the Server Actions.
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const { blankComments } = await import("@/scripts/lib/source-text.mjs");

    const files = readdirSync(__dirname).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    expect(files.length).toBeGreaterThanOrEqual(5);

    for (const name of files) {
      const source = blankComments(readFileSync(path.join(__dirname, name), "utf8"));
      expect(/memberId["'\]]?\s*[:=]\s*(?:body|params|searchParams)/.test(source), name).toBe(false);
      expect(source.includes('searchParams.get("memberId")'), name).toBe(false);
    }
  });
});

describe("the unlock rule is re-applied at every lesson door", () => {
  const LESSON_DOORS = DOORS.slice(1);

  for (const door of LESSON_DOORS) {
    it(`${door.name} refuses a block that has not opened`, async () => {
      // A drip course, a member whose clock started today, a block that opens
      // after 70 days.
      COURSE_ROW.shape = "drip";
      vi.mocked(courseAccessFor).mockResolvedValue({
        entitled: true,
        startedAt: new Date(),
        asOperator: false,
      });
      vi.mocked(blockById).mockResolvedValue({ ...BLOCK, releaseAfterDays: 70 });

      const response = await door.call();

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "forbidden" });
      // And nothing was written on the way to that refusal.
      expect(setCompleted).not.toHaveBeenCalled();
      expect(upsertSubmission).not.toHaveBeenCalled();
    });
  }
});

describe("the outline carries structure and no content", () => {
  it("hands out no body and no media id", async () => {
    const response = await outline.GET(nosyRequest(), courseParams());
    const payload = await response.json();

    expect(response.status).toBe(200);
    // Asserted over the SERIALIZED answer rather than field by field: a field
    // added later is caught by this, where a list of expected keys would only
    // be caught if somebody remembered to extend it.
    const text = JSON.stringify(payload);
    expect(text).not.toContain(UNIT.body);
    expect(text).not.toContain(UNIT.coverMediaId);
    expect(text).not.toContain(UNIT.videoMediaId);
    expect(text).not.toContain(UNIT.taskPrompt);
    // It does say the lesson ASKS for something — that is structure.
    expect(payload.blocks[0].units[0]).toMatchObject({ slug: UNIT.slug, hasTask: true });
  });

  // 🚨 The other half, and the one that was wrong. `hasTask` used to report the
  // COLUMN, so a prompt on a lesson outside a `workshop` — which the admin
  // surface writes without complaint, and `courses-check` refuses only in the
  // content files — told a client there was a hand-in here. There is not:
  // `submissionProblem()` refuses the shape before it looks at the prompt.
  for (const shape of ["self-study", "drip"] as const) {
    it(`says no lesson asks for a hand-in in a ${shape} course`, async () => {
      COURSE_ROW.shape = shape;

      const payload = await (await outline.GET(nosyRequest(), courseParams())).json();

      expect(UNIT.taskPrompt, "the fixture must carry a prompt, or this proves nothing").toBeTruthy();
      expect(payload.blocks[0].units[0]).toMatchObject({ slug: UNIT.slug, hasTask: false });
    });
  }
});

describe("the lesson endpoint", () => {
  it("serializes every date as ISO and drops repliedBy", async () => {
    haveSubmission({
      id: "s1",
      memberId: MEMBER,
      unitSlug: UNIT.slug,
      body: "my work",
      submittedAt: WHEN,
      reply: "well done",
      repliedAt: WHEN,
      repliedBy: "coach-9",
    });

    const payload = await (await unit.GET(nosyRequest(), params())).json();

    expect(payload.submission).toEqual({
      body: "my work",
      submittedAt: ISO,
      reply: "well done",
      repliedAt: ISO,
    });
    // Who read it is the operator's record, not the member's to receive.
    expect(JSON.stringify(payload)).not.toContain("coach-9");
  });

  // 🚨 Measured against a running app before it was fixed: on a `self-study`
  // course with an operator-authored prompt this route handed the prompt out,
  // a client rendered the hand-in box, and the POST one path over answered
  // `403 This course does not take hand-ins.` The web page had never shown it.
  // One module owes one answer.
  for (const shape of ["self-study", "drip"] as const) {
    it(`withholds the prompt in a ${shape} course — and does not READ the row`, async () => {
      COURSE_ROW.shape = shape;
      haveSubmission({
        id: "s1",
        memberId: MEMBER,
        unitSlug: UNIT.slug,
        body: "my work",
        submittedAt: WHEN,
        reply: null,
        repliedAt: null,
        repliedBy: null,
      });

      const payload = await (await unit.GET(nosyRequest(), params())).json();

      expect(UNIT.taskPrompt, "the fixture must carry a prompt, or this proves nothing").toBeTruthy();
      expect(payload.taskPrompt).toBeNull();
      // Not merely unreported. A route that read the row and then withheld it
      // would still query somebody's private writing on every lesson of every
      // shape — the page states that rule and this is the same rule.
      expect(submissionFor).not.toHaveBeenCalled();
      expect(payload.submission).toBeNull();
    });
  }

  it("hands media out as ids and never as addresses", async () => {
    const payload = await (await unit.GET(nosyRequest(), params())).json();

    expect(payload.media).toEqual({
      coverId: "m-cover",
      videoId: "m-video",
      subtitleId: null,
      worksheetId: null,
    });
    // A signed URL here would expire and would bypass `mayAccess()` — the
    // client fetches /api/v1/media/{id}, which asks.
    expect(JSON.stringify(payload)).not.toMatch(/https?:\/\//);
  });
});

describe("the course's own gate", () => {
  for (const [what, arrange] of [
    ["the module is switched off", () => vi.mocked(courseOffReason).mockReturnValue("disabledInConfig")],
    [
      "the member has not bought it",
      () =>
        vi.mocked(courseAccessFor).mockResolvedValue({
          entitled: false,
          startedAt: null,
          asOperator: false,
        }),
    ],
  ] as const) {
    it(`answers 404 when ${what} — never 403`, async () => {
      arrange();

      const response = await outline.GET(nosyRequest(), courseParams());

      // 🚨 404 and not 403: a member without the plan must not learn that a
      // course exists. The pages call `notFound()` for both of these, and a
      // surface more permissive than its page is the existence oracle
      // `docs/content-source.md` argues about.
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: "notFound" });
      expect(courseOutline).not.toHaveBeenCalled();
    });
  }
});

describe("the write endpoints demand a write key", () => {
  for (const door of DOORS.slice(2)) {
    it(`${door.name} asks the guard for write scope`, async () => {
      await door.call();
      expect(guardApi).toHaveBeenCalledWith(expect.anything(), { scope: "write" });
    });
  }

  for (const door of DOORS.slice(0, 2)) {
    it(`${door.name} does not`, async () => {
      await door.call();
      expect(guardApi).toHaveBeenCalledWith(expect.anything());
    });
  }
});

describe("a course refusal becomes an HTTP-shaped one", () => {
  it("refuses an empty hand-in as badRequest", async () => {
    const response = await submission.POST(nosyRequest("POST", { body: "   " }), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "badRequest" });
    expect(upsertSubmission).not.toHaveBeenCalled();
  });

  it("refuses a hand-in somebody already answered as forbidden", async () => {
    haveSubmission({
      id: "s1",
      memberId: MEMBER,
      unitSlug: UNIT.slug,
      body: "my work",
      submittedAt: WHEN,
      reply: "well done",
      repliedAt: WHEN,
      repliedBy: null,
    });

    const response = await submission.POST(nosyRequest("POST", { body: "again" }), params());

    expect(response.status).toBe(403);
    expect(upsertSubmission).not.toHaveBeenCalled();
  });

  it("refuses a hand-in in a course that does not take them", async () => {
    COURSE_ROW.shape = "self-study";

    const response = await submission.POST(nosyRequest("POST", { body: "my work" }), params());

    expect(response.status).toBe(403);
  });

  it("never answers a course code on the wire", async () => {
    // The vocabularies are separate on purpose: `COURSES_ERROR_CODES` are i18n
    // keys for a person, `/api/v1` answers a program from a closed English set.
    for (const body of ["   ", "x".repeat(20_001)]) {
      const response = await submission.POST(nosyRequest("POST", { body }), params());
      const payload = await response.json();
      expect(payload.error).not.toMatch(/^courses/);
    }
  });
});

describe("the completion endpoint", () => {
  it("refuses a body that does not say true or false", async () => {
    const response = await completion.POST(nosyRequest("POST", { done: "yes" }), params());

    expect(response.status).toBe(400);
    // 🚨 Not defaulted to `true`: a client that meant to un-tick and sent a
    // malformed body must not tick instead.
    expect(setCompleted).not.toHaveBeenCalled();
  });

  it("passes the boolean straight through, both ways", async () => {
    await completion.POST(nosyRequest("POST", { done: true }), params());
    expect(setCompleted).toHaveBeenCalledWith(MEMBER, UNIT.slug, true);

    vi.clearAllMocks();
    vi.mocked(guardApi).mockResolvedValue({ ...GUARDED });
    vi.mocked(courseOffReason).mockReturnValue(null);
    COURSE_ROW.shape = "workshop";
    vi.mocked(courseAccessFor).mockResolvedValue({
      entitled: true,
      startedAt: new Date(0),
      asOperator: false,
    });
    vi.mocked(unitBySlug).mockResolvedValue(UNIT);
    vi.mocked(blockById).mockResolvedValue(BLOCK);

    await completion.POST(nosyRequest("POST", { done: false }), params());
    expect(setCompleted).toHaveBeenCalledWith(MEMBER, UNIT.slug, false);
  });
});
