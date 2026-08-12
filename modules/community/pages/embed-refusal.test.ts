// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **A Subject Key must not become an enumeration oracle.**
//
// An embedded discussion is named by a string the app chose — `course:x:unit-3`
// — and a member's browser sends that string. If "there is no such discussion"
// answered differently from "there is one and you have not bought it", then
// anybody with a signed-in account could walk the table of contents of a course
// they never paid for by trying keys and reading the refusals. That is the risk
// the whole epic carries, and this file is where it is settled.
//
// The merge into ONE code happens exactly once, in `mayViewEmbed()`
// (`modules/community/lib/rules.ts`) — so byte-identity is a property of the design and
// what follows PINS it against regression rather than producing it. The
// comparison is deliberately `JSON.stringify` of the whole answer, not a field
// check: a later story adding a field to `ActionState` has to keep the two
// answers identical, and a field-by-field test would let a new one through.
//
// The mocks are the `app/api/v1/auth/token/route.test.ts` shape: the seams
// around the decision are replaced, the decision itself is the real one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/community/lib/config", () => ({
  isCommunityEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveUser: vi.fn(async () => ({
    user: { id: "member-1", role: "member" },
  })),
}));

vi.mock("@/modules/community/lib/embeds", () => ({
  findEmbed: vi.fn(),
}));

vi.mock("@/lib/entitlements/manage", () => ({
  hasPlan: vi.fn(async () => false),
}));

vi.mock("@/lib/media/config", () => ({
  planProblem: vi.fn(() => null),
}));

// ⚠️ The database is mocked as an object with nothing on it, and that is a
// second assertion in disguise: every test below refuses BEFORE any read, so a
// refusal that started touching the database would fail here with a type error
// rather than pass quietly.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/media/manage", () => ({
  findMedia: vi.fn(),
  mayAccess: vi.fn(),
}));
vi.mock("@/lib/media/url", () => ({ mediaUrlFor: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  // A translator that is a pure function of (namespace, key, values) — so two
  // refusals carrying the same code and the same values produce the same
  // string by construction, and two carrying DIFFERENT ones cannot accidentally
  // collide into looking identical.
  getTranslations: vi.fn(
    async (namespace: string) => (key: string, values?: unknown) =>
      `${namespace}.${key}(${JSON.stringify(values ?? null)})`,
  ),
}));

import { addPostAction } from "./actions";
import { findEmbed } from "@/modules/community/lib/embeds";
import { hasPlan } from "@/lib/entitlements/manage";
import { embedAccessFor } from "@/modules/community/lib/manage";

const EMPTY = { error: null, ok: null };
const VIEWER = { memberId: "member-1", role: "member" };

/** A plan-gated declaration — the shape an app writes into `embeds.ts`. */
const DECLARED = {
  subjectKey: "course:birth-prep:unit-3",
  accessLevel: "plan" as const,
  planKeys: ["kurs_komplett"],
};

function reply(subjectKey: string): FormData {
  const form = new FormData();
  form.set("subjectKey", subjectKey);
  form.set("content", "Was ist mit Woche drei?");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasPlan).mockResolvedValue(false);
});

describe("unknown subject and not-entitled are one refusal", () => {
  it("answers byte for byte the same", async () => {
    // (a) a key nobody declared.
    vi.mocked(findEmbed).mockReturnValue(null);
    const undeclared = await addPostAction(EMPTY, reply("course:invented:unit-9"));

    // (b) a key that IS declared, behind a plan this member does not hold.
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    vi.mocked(hasPlan).mockResolvedValue(false);
    const unentitled = await addPostAction(EMPTY, reply(DECLARED.subjectKey));

    expect(
      JSON.stringify(undeclared),
      "the two refusals differ, so a member can tell a declared Subject Key " +
        "from an invented one — which is a course's table of contents, " +
        "readable by anybody with an account. The merge belongs in " +
        "mayViewEmbed(), not in the surface.",
    ).toBe(JSON.stringify(unentitled));

    // Non-vacuity: both really are refusals, not two identical successes.
    expect(undeclared.ok).toBeNull();
    expect(undeclared.error).toContain("communityNotEntitled");
  });

  it("names neither condition in the sentence it shows", async () => {
    vi.mocked(findEmbed).mockReturnValue(null);
    const state = await addPostAction(EMPTY, reply("course:invented:unit-9"));
    // The code is `communityNotEntitled` for BOTH, so the sentence behind it must not
    // describe either one. `messages/*.json` says "not available here".
    expect(state.error).not.toContain("notFound");
    expect(state.error).not.toContain("unknown");
  });
});

describe("the two gates compose", () => {
  // FR-194: the host page guards itself, the discussion additionally enforces
  // its own rule server-side. The property is visible here as an ABSENCE —
  // `embedAccessFor()` asks about the declaration's keys and about nothing
  // else, so whatever the page was gated on cannot widen or narrow it.
  it("refuses a member who holds the page's plan but not the discussion's", async () => {
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    // They hold the lesson page's plan and only that.
    vi.mocked(hasPlan).mockImplementation(
      async (_memberId: string, key: string) => key === "kurs_basis",
    );

    expect(await embedAccessFor(DECLARED.subjectKey, VIEWER)).toBe("communityNotEntitled");
    expect(hasPlan).toHaveBeenCalledWith("member-1", "kurs_komplett");
  });

  it("serves a member who holds the discussion's plan, however the page was guarded", async () => {
    vi.mocked(findEmbed).mockReturnValue(DECLARED);
    vi.mocked(hasPlan).mockImplementation(
      async (_memberId: string, key: string) => key === "kurs_komplett",
    );

    expect(await embedAccessFor(DECLARED.subjectKey, VIEWER)).toBeNull();
  });

  it("asks no entitlement at all for an open declaration", async () => {
    vi.mocked(findEmbed).mockReturnValue({
      subjectKey: "course:free:intro",
      accessLevel: "open",
      planKeys: [],
    });

    expect(await embedAccessFor("course:free:intro", VIEWER)).toBeNull();
    // An `open` embed costs no entitlement round trip — the same budget
    // `planKeysToResolve()` buys the room list.
    expect(hasPlan).not.toHaveBeenCalled();
  });

  it("refuses a member for a moderators-only declaration", async () => {
    vi.mocked(findEmbed).mockReturnValue({
      subjectKey: "course:staff:notes",
      accessLevel: "moderators",
      planKeys: [],
    });

    expect(await embedAccessFor("course:staff:notes", VIEWER)).toBe("communityNotEntitled");
    expect(
      await embedAccessFor("course:staff:notes", {
        memberId: "member-1",
        role: "moderator",
      }),
    ).toBeNull();
  });
});
