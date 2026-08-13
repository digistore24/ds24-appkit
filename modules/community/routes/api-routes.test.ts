// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The community's v1 surface, one contract per route.
//
// 🚨 **The claim this file exists for is the one about what is NOT here.** The
// bearer surface carries no private messages, and that is a promise which fails
// silently if nobody measures it: a `conversation` scope quietly answering
// `unavailable` looks identical to a `conversation` scope nobody implemented,
// and both look identical to one somebody adds next year.
//
// The SOURCE half of the same promise is held elsewhere and deliberately not
// restated here: `modules/community/lib/dm-guard.test.ts` fails the build on any
// file outside a short allowlist that so much as NAMES a direct-message table,
// and it walks this folder. That allowlist did not grow for this surface, which
// is the positive form of the guarantee — nothing here can read a DM because
// nothing here may name one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/api/api/guard", () => ({ guardApi: vi.fn() }));
vi.mock("@/modules/community/lib/config", () => ({ isCommunityEnabled: vi.fn() }));
vi.mock("@/modules/community/lib/manage", () => ({
  addPost: vi.fn(),
  discussionFor: vi.fn(),
  groupsFor: vi.fn(),
  liveAnswerFor: vi.fn(),
  postsFor: vi.fn(),
}));

import { guardApi } from "@/modules/api/api/guard";

import { isCommunityEnabled } from "@/modules/community/lib/config";
import { addPost, discussionFor, groupsFor, liveAnswerFor, postsFor } from "@/modules/community/lib/manage";
// NOT mocked: the error class is the contract the handlers map from.
import { CommunityError } from "@/modules/community/lib/rules";

import * as groups from "./api-groups";
import * as live from "./api-live";
import * as discussion from "./api-discussion";
import * as posts from "./api-posts";

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

const GROUP = {
  id: "g1",
  name: "Room One",
  description: null,
  position: 1,
  accessLevel: "plan" as const,
  planKeys: ["basis_monatlich"],
  archivedAt: null,
  createdAt: WHEN,
};

const DISCUSSION = {
  id: "d1",
  groupId: "g1",
  title: "A thread",
  createdBy: MEMBER,
  lockedAt: null,
  lastActivityAt: WHEN,
  createdAt: WHEN,
  starterProfileName: "Chris",
  starterAccountName: null,
};

function request(url: string, method = "GET", body?: unknown): Request {
  return new Request(url, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

/** A request that TRIES to name somebody else. */
const nosy = (method = "GET", body?: unknown) =>
  request("http://localhost:3000/api/v1/community/x?memberId=somebody-else", method, body);

const idParams = { params: Promise.resolve({ id: DISCUSSION.id }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guardApi).mockResolvedValue({ ...GUARDED });
  vi.mocked(isCommunityEnabled).mockReturnValue(true);
  vi.mocked(groupsFor).mockResolvedValue([GROUP]);
  vi.mocked(discussionFor).mockResolvedValue({ discussion: DISCUSSION, group: GROUP });
  vi.mocked(postsFor).mockResolvedValue({ rows: [], total: 0, page: 1 });
  vi.mocked(liveAnswerFor).mockResolvedValue({ state: "unavailable" });
  vi.mocked(addPost).mockResolvedValue({ postId: "p1" });
});

const DOORS = [
  { name: "GET /community/groups", call: () => groups.GET(nosy()) },
  {
    name: "POST /community/live",
    call: () => live.POST(nosy("POST", { scopes: [{ kind: "feed" }] })),
  },
  {
    name: "GET /community/discussions/{id}",
    call: () => discussion.GET(nosy(), idParams),
  },
  {
    name: "POST /community/discussions/{id}/posts",
    call: () => posts.POST(nosy("POST", { content: "hello" }), idParams),
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
      expect(isCommunityEnabled).not.toHaveBeenCalled();
      for (const fn of [groupsFor, discussionFor, postsFor, liveAnswerFor, addPost]) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  }
});

describe("the account acted on is the key's owner", () => {
  for (const door of DOORS) {
    it(`${door.name} ignores a memberId in the request`, async () => {
      await door.call();

      const viewers = [
        ...vi.mocked(groupsFor).mock.calls.map((c) => c[0]),
        ...vi.mocked(discussionFor).mock.calls.map((c) => c[1]),
        ...vi.mocked(postsFor).mock.calls.map((c) => c[2]),
        ...vi.mocked(liveAnswerFor).mock.calls.map((c) => c[0]),
        ...vi.mocked(addPost).mock.calls.map((c) => c[1]),
      ];
      expect(viewers.length).toBeGreaterThan(0);
      for (const viewer of viewers) {
        expect(viewer).toEqual({ memberId: MEMBER, role: "member" });
      }
    });
  }
});

describe("🚨 the bearer surface carries no private messages", () => {
  it("refuses a conversation scope by name, and never reaches the data layer", async () => {
    const response = await live.POST(
      nosy("POST", { scopes: [{ kind: "conversation", conversationId: "c1" }] }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe("badRequest");
    // Named, not silent: a client author must be able to learn the fact from
    // the answer. On the COOKIE twin the same scope answers `unavailable`, and
    // that difference is deliberate — there the question is about one member's
    // correspondence, here about what this surface does at all.
    expect(payload.detail).toMatch(/conversation/i);
    expect(liveAnswerFor).not.toHaveBeenCalled();
  });

  it("refuses the whole request even when a legal scope travels beside it", async () => {
    // The mistake this catches: refusing per scope and answering `ok` for the
    // rest, which would make a DM request a partially-served one.
    const response = await live.POST(
      nosy("POST", {
        scopes: [{ kind: "feed" }, { kind: "conversation", conversationId: "c1" }],
      }),
    );

    expect(response.status).toBe(400);
    expect(liveAnswerFor).not.toHaveBeenCalled();
  });

  it("passes the three legal kinds through", async () => {
    await live.POST(
      nosy("POST", {
        scopes: [
          { kind: "feed" },
          { kind: "discussion", discussionId: "d1" },
          { kind: "subject", subjectKey: "lesson-1" },
        ],
      }),
    );

    expect(vi.mocked(liveAnswerFor).mock.calls.map((c) => c[1].kind)).toEqual([
      "feed",
      "discussion",
      "subject",
    ]);
  });

  it("has no door that names a conversation at all", async () => {
    // The source half, asked of THIS folder rather than of the tree — the
    // tree-wide claim is `lib/dm-guard.test.ts`'s, and it is about table names.
    // This one is about the WIRE: a handler here must not be able to accept a
    // conversation id, however it spells the lookup.
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const { blankComments } = await import("@/scripts/lib/source-text.mjs");

    const files = readdirSync(__dirname).filter(
      (name) => name.startsWith("api-") && name.endsWith(".ts") && !name.includes(".test."),
    );
    expect(files.length).toBeGreaterThanOrEqual(4);

    for (const name of files) {
      const source = blankComments(readFileSync(path.join(__dirname, name), "utf8"));
      expect(source.includes("conversationId"), name).toBe(false);
    }
  });
});

describe("the switch", () => {
  for (const door of DOORS) {
    it(`${door.name} answers 404 when the community is off`, async () => {
      vi.mocked(isCommunityEnabled).mockReturnValue(false);

      const response = await door.call();

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: "notFound" });
    });
  }
});

describe("the room list", () => {
  it("serializes dates as ISO and publishes no plan keys", async () => {
    const payload = await (await groups.GET(nosy())).json();

    expect(payload.groups).toEqual([
      {
        id: GROUP.id,
        name: GROUP.name,
        description: null,
        position: 1,
        createdAt: ISO,
      },
    ]);
    // What a room would have cost is product information, and no client needs
    // it for a room the viewer is already in.
    expect(JSON.stringify(payload)).not.toContain("basis_monatlich");
  });
});

describe("the thread", () => {
  it("answers one 404 for unknown, archived and not-yours alike", async () => {
    vi.mocked(discussionFor).mockResolvedValue(null);

    const response = await discussion.GET(nosy(), idParams);

    expect(response.status).toBe(404);
    // And the posts were never fetched for a thread the viewer may not read.
    expect(postsFor).not.toHaveBeenCalled();
  });

  it("opens at the end by default", async () => {
    await discussion.GET(nosy(), idParams);
    expect(postsFor).toHaveBeenCalledWith(DISCUSSION.id, "last", expect.anything());
  });

  it("refuses a page that is not a positive whole number", async () => {
    const response = await discussion.GET(
      request("http://localhost:3000/api/v1/community/discussions/d1?page=0"),
      idParams,
    );

    expect(response.status).toBe(400);
    expect(postsFor).not.toHaveBeenCalled();
  });
});

describe("writing into a room", () => {
  it("demands a write key", async () => {
    await posts.POST(nosy("POST", { content: "hello" }), idParams);
    expect(guardApi).toHaveBeenCalledWith(expect.anything(), { scope: "write" });
  });

  it("the reading doors do not", async () => {
    await groups.GET(nosy());
    expect(guardApi).toHaveBeenCalledWith(expect.anything());
  });

  it("answers 201 with the new post's id", async () => {
    const response = await posts.POST(nosy("POST", { content: "hello" }), idParams);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "p1" });
  });

  for (const [code, status] of [
    ["notFound", 404],
    ["communityProfileIncomplete", 403],
    ["communityDiscussionLocked", 403],
    ["communitySendBlocked", 403],
    ["communityPostEmpty", 400],
    ["communityPostTooLong", 400],
    ["communityPostRateLimited", 429],
  ] as const) {
    it(`maps ${code} to ${status} without leaking the module's code`, async () => {
      vi.mocked(addPost).mockRejectedValue(new CommunityError(code));

      const response = await posts.POST(nosy("POST", { content: "hello" }), idParams);
      const payload = await response.json();

      expect(response.status).toBe(status);
      // The i18n key never crosses the wire — `/api/v1` answers a program from
      // a closed English vocabulary (`docs/api.md`).
      expect(payload.error).not.toMatch(/^community/);
      expect(payload.detail).toBeTruthy();
    });
  }

  it("says so loudly rather than guessing when a refusal has no mapping", async () => {
    // A code this file has never seen must not be answered as "your request was
    // bad" — that sends the reader looking in the wrong place.
    vi.mocked(addPost).mockRejectedValue(new CommunityError("communityImagesOff"));

    const response = await posts.POST(nosy("POST", { content: "hello" }), idParams);

    expect(response.status).toBe(500);
    expect((await response.json()).detail).toContain("communityImagesOff");
  });

  it("lets an error that is not a community refusal escape", async () => {
    // A database failure is not a refusal and must not be dressed as one.
    vi.mocked(addPost).mockRejectedValue(new Error("connection lost"));

    await expect(posts.POST(nosy("POST", { content: "hello" }), idParams)).rejects.toThrow(
      "connection lost",
    );
  });
});
