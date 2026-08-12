// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the sidebar costs, and what it shows.
//
// 🚨 **Both halves are asserted in every case, and the second is the point.**
// `scripts/modules/nav.test.ts` already guards the SHAPE of the early return —
// it reads this module's source as text and insists the first line returns
// before any query. That guard is valuable (it catches every module added
// later) and it is a text scanner: it cannot tell whether the query is really
// skipped, only whether the line looks right. So every case below asserts the
// RESULT and the number of times the reader was called, which is the behaviour
// the text is standing in for.
//
// ⚠️ Nothing here touches a database. `./lib/manage` is mocked, exactly as
// `presence/check.test.ts` mocks it — a module's own tables are reachable only
// from inside the app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const isCourseSwitchedOn = vi.fn(() => true);
const isCourseEnabled = vi.fn(() => true);
const hasWaitingSubmission = vi.fn(async () => false);

vi.mock("./lib/config", () => ({
  isCourseSwitchedOn: () => isCourseSwitchedOn(),
  isCourseEnabled: () => isCourseEnabled(),
}));

vi.mock("./lib/manage", () => ({
  hasWaitingSubmission: () => hasWaitingSubmission(),
}));

const { default: courses } = await import("./module");
const { default: nav } = await import("./nav");

/** The one entry the dot may point at. */
const ADMIN_HREF = nav.NAVIGATION.find((item) => item.labelKey === "coursesAdmin")!.href;

const viewer = (role: string, impersonating = false) => ({
  memberId: "member-1",
  role,
  impersonating,
});

const shell = () => courses.shellState!(viewer("owner"));

beforeEach(() => {
  isCourseSwitchedOn.mockReset();
  isCourseEnabled.mockReset();
  hasWaitingSubmission.mockReset();
  isCourseSwitchedOn.mockReturnValue(true);
  isCourseEnabled.mockReturnValue(true);
  hasWaitingSubmission.mockResolvedValue(false);
});

describe("a switched-off course costs nothing", () => {
  it("🚨 answers {} and issues NO query", async () => {
    isCourseSwitchedOn.mockReturnValue(false);

    expect(await courses.shellState!(viewer("owner"))).toEqual({});
    // The assertion the text scanner cannot make. A feature that ships off has
    // to cost nothing, or "off" is only a word.
    expect(hasWaitingSubmission).not.toHaveBeenCalled();
  });
});

describe("who pays for the query", () => {
  it("a member does not — same features as before, no dot, no query", async () => {
    const state = await courses.shellState!(viewer("member"));

    expect(state.features).toEqual({ courses: true, coursesAdmin: true });
    expect(state.badges).toEqual([]);
    expect(hasWaitingSubmission).not.toHaveBeenCalled();
  });

  it("nor does an impersonated session, without a carve-out of its own", async () => {
    // An impersonated session IS the member — `role` reads "member" inside one,
    // so the short-circuit declines to ask and `viewer.impersonating` never has
    // to be consulted. The community's private-message surfaces need that flag
    // because they would otherwise SHOW an operator something; this one would
    // only spend a query.
    const state = await courses.shellState!(viewer("member", true));

    expect(state.badges).toEqual([]);
    expect(hasWaitingSubmission).not.toHaveBeenCalled();
  });

  it("an operator asks exactly once, and gets no dot when nothing waits", async () => {
    const state = await shell();

    expect(state.badges).toEqual([]);
    expect(hasWaitingSubmission).toHaveBeenCalledTimes(1);
  });

  it("…and gets the href when something does", async () => {
    hasWaitingSubmission.mockResolvedValue(true);

    const state = await shell();

    expect(state.badges).toEqual([ADMIN_HREF]);
    expect(hasWaitingSubmission).toHaveBeenCalledTimes(1);
  });
});

describe("the dot points at the entry that exists", () => {
  it("🚨 the href is the one nav.ts declares, byte for byte", async () => {
    // Two files hold this string and no constant joins them: `nav.ts` is
    // client-safe and reaches the browser bundle, `module.ts` is server-side,
    // and `modules/boundary.test.ts` keeps them apart. A typo would show up as
    // a dot that never appears — no error, no log line — so the comparison is
    // made here instead.
    hasWaitingSubmission.mockResolvedValue(true);

    expect(ADMIN_HREF).toBe("/dashboard/admin/course");
    expect((await shell()).badges).toEqual([ADMIN_HREF]);
  });
});

describe("switched on but broken", () => {
  it("keeps the diagnosis entry AND the dot", async () => {
    // `isCourseSwitchedOn()` true with `isCourseEnabled()` false is the state
    // the admin page exists to name (`CLAUDE.md` → UI, rule 3). The hand-ins do
    // not go away while the config is wrong — they sit there waiting — so
    // taking the dot away would hide the queue from the one person who can fix
    // the file it is waiting behind.
    isCourseEnabled.mockReturnValue(false);
    hasWaitingSubmission.mockResolvedValue(true);

    const state = await shell();

    expect(state.features).toEqual({ courses: false, coursesAdmin: true });
    expect(state.badges).toEqual([ADMIN_HREF]);
  });
});
