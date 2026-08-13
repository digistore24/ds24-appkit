// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's ONE gate, and the two things it answers at once.
//
// 🚨 **This file exists because the gate learned to take a LIST and nothing
// could tell.** Until Story 44.1 `config/course.json` held one `productKey`;
// one offering is one Digistore24 product per billing interval, so a course
// sold monthly and yearly is two keys before it has a second customer.
// Measured while writing this: with `courseAccessFor()` reduced to asking the
// FIRST key only, the whole suite of 7206 tests stayed green — every other
// test passes a one-key list, so none of them can tell the two apart.
//
// The second half is the CLOCK, and it is the half a boolean gate would lose.
// `courseAccessFor()` answers "may they in" and "since when" together because
// they are one question (`./access.ts` header): separating them invites a
// caller to take the first and forget the second, which in a drip course
// renders week ten on day one. With several keys that clock needs a ruling of
// its own — a member who bought monthly in January and moved to yearly in June
// has been in the course since JANUARY, and a clock restarted by an upgrade
// takes back weeks somebody paid for.
import { beforeEach, describe, expect, it, vi } from "vitest";

const planStartedAt = vi.fn<(memberId: string, planKey: string) => Promise<Date | null>>();
vi.mock("@/lib/entitlements/manage", () => ({
  planStartedAt: (m: string, k: string) => planStartedAt(m, k),
}));

const CONFIG = { enabled: true, operatorPreviewsUnlocked: true };
vi.mock("./config", () => ({ courseConfig: () => CONFIG }));

/**
 * The course under test — a parameter now, not a config read.
 *
 * ⚠️ Only `planKeys` is read, and the type says so (`Pick<Course, "planKeys">`),
 * so this fixture carries what the gate uses and nothing it does not. A whole
 * course row here would invite a later assertion about a field the gate never
 * looks at.
 */
const COURSE = { planKeys: ["monthly", "yearly"] as readonly string[] };

const { courseAccessFor } = await import("./access");

const JANUARY = new Date("2026-01-15T00:00:00.000Z");
const JUNE = new Date("2026-06-01T00:00:00.000Z");

/** What the entitlement layer says this member holds, key by key. */
function holds(grants: Record<string, Date | null>) {
  planStartedAt.mockImplementation(async (_member, key) => grants[key] ?? null);
}

beforeEach(() => {
  planStartedAt.mockReset();
  COURSE.planKeys = ["monthly", "yearly"];
  CONFIG.operatorPreviewsUnlocked = true;
});

describe("🚨 a course sold under several products opens for ANY of them", () => {
  it("🚨 lets in the buyer of the SECOND key — the needle", async () => {
    // The one that goes red on a gate that stops at the head of the list. The
    // yearly buyer is not an edge case: they are the more valuable half of the
    // same offering.
    holds({ yearly: JUNE });
    const access = await courseAccessFor("bob", "member", COURSE);
    expect(access.entitled).toBe(true);
    expect(access.startedAt).toEqual(JUNE);
  });

  it("lets in the buyer of the first key", async () => {
    holds({ monthly: JANUARY });
    const access = await courseAccessFor("bob", "member", COURSE);
    expect(access.entitled).toBe(true);
    expect(access.startedAt).toEqual(JANUARY);
  });

  it("refuses somebody who holds NEITHER, having asked about both", async () => {
    // The counter-test: "any" must not decay into "always true". The call count
    // is half the assertion — a gate that refused without asking would satisfy
    // the verdict and be a different function.
    holds({});
    const access = await courseAccessFor("bob", "member", COURSE);
    expect(access.entitled).toBe(false);
    expect(access.startedAt).toBeNull();
    expect(planStartedAt).toHaveBeenCalledTimes(2);
  });

  it("refuses when the course names no key at all — a broken config, not a throw", async () => {
    // `courseConfigProblems()` reports it and `gate.ts` leaves the diagnosis
    // page reachable for the operator. Answering "not entitled" here rather
    // than throwing keeps a MEMBER on the honest path.
    COURSE.planKeys = [];
    const access = await courseAccessFor("bob", "member", COURSE);
    expect(access.entitled).toBe(false);
    expect(planStartedAt).not.toHaveBeenCalled();
  });
});

describe("🚨 the clock, when somebody holds more than one of the keys", () => {
  it("🚨 starts at the EARLIEST grant, not at the newest", async () => {
    // A monthly buyer from January who switched to yearly in June holds both.
    // Their week ten is ten weeks after JANUARY. A clock that took the last
    // grant would take back four months somebody already paid for — and it
    // would do it silently, because a drip course with a fresh clock looks
    // exactly like a drip course working correctly.
    holds({ monthly: JANUARY, yearly: JUNE });
    const access = await courseAccessFor("bob", "member", COURSE);
    expect(access.startedAt).toEqual(JANUARY);
  });

  it("…whichever order the keys are listed in", async () => {
    // The counter-test for the one above: a `Math.min` that is really a "first
    // non-null" passes the previous test and fails this one.
    COURSE.planKeys = ["yearly", "monthly"];
    holds({ monthly: JANUARY, yearly: JUNE });
    const access = await courseAccessFor("bob", "member", COURSE);
    expect(access.startedAt).toEqual(JANUARY);
  });

  it("ignores a SUSPENDED grant — `planStartedAt()` answers null for one", async () => {
    // A missed payment makes a grant inactive, and the entitlement layer
    // reports that as `null` rather than as an old date. So a member whose
    // monthly plan is paused but whose yearly one is live reads JUNE, and one
    // with nothing active reads nothing at all — "your access is paused",
    // never a quietly rendered week one.
    holds({ monthly: null, yearly: JUNE });
    expect((await courseAccessFor("bob", "member", COURSE)).startedAt).toEqual(JUNE);

    holds({ monthly: null, yearly: null });
    const paused = await courseAccessFor("bob", "member", COURSE);
    expect(paused.entitled).toBe(false);
    expect(paused.startedAt).toBeNull();
  });
});

describe("the operator, who holds no grant at all", () => {
  it("previews everything by default — beginning of time, and the page says so", async () => {
    // Without it an operator could never look at the last week of their own
    // product: they bought nothing, so they have no clock.
    holds({});
    const access = await courseAccessFor("owner-1", "owner", COURSE);
    expect(access.entitled).toBe(true);
    expect(access.asOperator).toBe(true);
    expect(access.startedAt).toEqual(new Date(0));
    expect(planStartedAt).not.toHaveBeenCalled();
  });

  it("with previews OFF, sees exactly what a fresh buyer sees — across ALL keys", async () => {
    // The other legitimate thing to want. It reads the same list as a member
    // does, so an operator who really did buy their own product on the yearly
    // key gets that clock rather than nothing.
    CONFIG.operatorPreviewsUnlocked = false;
    holds({ yearly: JUNE });
    const access = await courseAccessFor("owner-1", "owner", COURSE);
    expect(access.asOperator).toBe(true);
    expect(access.startedAt).toEqual(JUNE);
  });

  it("…and reads null when they hold none of them, while still getting in", async () => {
    // `entitled` stays true: an operator is not locked out of their own
    // product. What they lose is a clock, which is what "no grant" means.
    CONFIG.operatorPreviewsUnlocked = false;
    holds({});
    const access = await courseAccessFor("owner-1", "owner", COURSE);
    expect(access.entitled).toBe(true);
    expect(access.startedAt).toBeNull();
  });
});
