// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this endpoint promises, held in place.
//
// Three of the four promises are about what it does NOT do — it does not
// redirect, it does not distinguish, and it does not write — and all three are
// the kind that a change can break without anything else noticing:
//
//   - **It does not redirect.** `requireActiveUser()` here would answer a
//     `fetch()` with an HTML sign-in page and the caller would parse HTML as
//     JSON. The test asserts a status, because a redirect has one.
//   - **It does not distinguish.** An inaccessible scope, an unknown scope
//     kind and a malformed scope answer byte for byte the same — 20.1's
//     indistinguishable refusal, extended to the live surface. Without it the
//     endpoint is a probe: for which Subject Keys exist, and (the day Epic 21
//     lands) for whether direct messages are switched on here.
//   - **It does not write.** No read marker, no discussion row, nothing. The
//     database handed to it below THROWS on `insert`, `update` and `delete`,
//     so a write added later fails here rather than in somebody's inbox.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/community/lib/config", () => ({
  isCommunityEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/authz", () => ({
  currentActiveUser: vi.fn(async () => ({
    state: "active",
    session: { user: { id: "member-1", role: "member" } },
  })),
}));

vi.mock("@/modules/community/lib/embeds", () => ({ findEmbed: vi.fn() }));
vi.mock("@/lib/entitlements/manage", () => ({ hasPlan: vi.fn(async () => false) }));
vi.mock("@/lib/media/config", () => ({ planProblem: vi.fn(() => null) }));
vi.mock("@/lib/media/manage", () => ({ findMedia: vi.fn(), mayAccess: vi.fn() }));
vi.mock("@/lib/media/url", () => ({ mediaUrlFor: vi.fn() }));

// ⚠️ A database that refuses to be written to. `select` answers whatever the
// current test queued; every write throws with a sentence naming the rule.
const selectQueue: unknown[][] = [];
function refuseWrite(what: string) {
  return () => {
    throw new Error(
      `the live endpoint performed a ${what}. It answers "what is new since X"; ` +
        `"I have seen up to X" is acknowledgeRead()'s, and creating a discussion ` +
        `row is ensureEmbeddedDiscussion()'s. Read the route header.`,
    );
  };
}
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "leftJoin", "innerJoin", "where", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  chain.then = (resolve: (rows: unknown[]) => void) =>
    resolve(selectQueue.shift() ?? []);
  return {
    db: {
      select: () => chain,
      selectDistinct: () => chain,
      insert: refuseWrite("insert"),
      update: refuseWrite("update"),
      delete: refuseWrite("delete"),
      transaction: refuseWrite("transaction"),
    },
  };
});

import { POST } from "./live";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { currentActiveUser } from "@/lib/authz";
import { findEmbed } from "@/modules/community/lib/embeds";
import { hasPlan } from "@/lib/entitlements/manage";

function post(body: unknown): Request {
  return new Request("http://localhost:3000/api/community/live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function scopesOf(response: Response): Promise<unknown[]> {
  const body = (await response.json()) as { scopes: unknown[] };
  return body.scopes;
}

beforeEach(() => {
  selectQueue.length = 0;
  vi.clearAllMocks();
  vi.mocked(isCommunityEnabled).mockReturnValue(true);
  vi.mocked(currentActiveUser).mockResolvedValue({
    state: "active",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: { user: { id: "member-1", role: "member" } } as any,
  });
  vi.mocked(hasPlan).mockResolvedValue(false);
  vi.mocked(findEmbed).mockReturnValue(null);
});

describe("the guards, in order", () => {
  it("answers 404 when the community is off — before anything is read", async () => {
    vi.mocked(isCommunityEnabled).mockReturnValue(false);
    const response = await POST(post({ scopes: [{ kind: "discussion", discussionId: "d1" }] }));

    expect(response.status).toBe(404);
    // SM-16's other half: an app that never enabled the module pays nothing
    // for this endpoint. Not even the session is resolved.
    expect(currentActiveUser).not.toHaveBeenCalled();
  });

  it("answers ONE 401 for anonymous and for blocked alike", async () => {
    const answers: string[] = [];
    for (const state of ["anonymous", "blocked"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(currentActiveUser).mockResolvedValue({ state } as any);
      const response = await POST(post({ scopes: [] }));
      expect(response.status).toBe(401);
      answers.push(JSON.stringify(await response.json()));
    }

    expect(
      answers[0],
      "a caller without a session has no business learning whether they are " +
        "signed out or blocked",
    ).toBe(answers[1]);
  });

  it("answers with a STATUS, never a redirect to the sign-in page", async () => {
    // The standing API rule: `requireActiveUser()` would `redirect()`, and a
    // redirect is a nonsensical answer to a fetch(). A 3xx here is the bug.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(currentActiveUser).mockResolvedValue({ state: "anonymous" } as any);
    const response = await POST(post({ scopes: [] }));
    const isRedirect = response.status >= 300 && response.status < 400;
    expect(isRedirect, `answered ${response.status} — a 3xx to /login is what requireActiveUser() would do`).toBe(false);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses a body that is not a scope list", async () => {
    for (const body of [{}, { scopes: "all" }, { scopes: 1 }, null]) {
      expect((await POST(post(body))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("refuses a body that is not JSON at all", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/community/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{{{",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("bounds how many scopes one request may buy", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      kind: "subject",
      subjectKey: `k${i}`,
    }));
    // 429, not 400: the body has always said `tooManyRequests`, and a status
    // saying "malformed request" points whoever reads it at the wrong fix.
    const refused = await POST(post({ scopes: many }));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "tooManyRequests" });
    // Ten is fine — the bound is a ceiling, not a hint.
    expect((await POST(post({ scopes: many.slice(0, 10) }))).status).toBe(200);
  });
});

describe("one refusal for every no", () => {
  it("answers an unknown scope kind exactly like an inaccessible one", async () => {
    // (a) a Subject Key nobody declared — refused by mayViewEmbed().
    vi.mocked(findEmbed).mockReturnValue(null);
    const inaccessible = await scopesOf(
      await POST(post({ scopes: [{ kind: "subject", subjectKey: "course:invented:1" }] })),
    );

    // (b) a kind this build does not know. Epic 21's "conversation" is exactly
    // this case today, and it must not answer differently.
    const unknownKind = await scopesOf(
      await POST(post({ scopes: [{ kind: "conversation", conversationId: "c1" }] })),
    );

    // (c) something that is not a scope at all.
    const malformed = await scopesOf(await POST(post({ scopes: [42] })));

    expect(JSON.stringify(inaccessible)).toBe(JSON.stringify(unknownKind));
    expect(JSON.stringify(inaccessible)).toBe(JSON.stringify(malformed));
    expect(inaccessible).toEqual([{ state: "unavailable" }]);
  });

  it("answers a declared-but-unentitled key the same way", async () => {
    vi.mocked(findEmbed).mockReturnValue({
      subjectKey: "course:paid:1",
      accessLevel: "plan",
      planKeys: ["course_complete"],
    });
    vi.mocked(hasPlan).mockResolvedValue(false);

    const answer = await scopesOf(
      await POST(post({ scopes: [{ kind: "subject", subjectKey: "course:paid:1" }] })),
    );
    expect(answer).toEqual([{ state: "unavailable" }]);
  });

  it("re-checks access per scope, per request — never once for the batch", async () => {
    vi.mocked(findEmbed).mockReturnValue({
      subjectKey: "course:paid:1",
      accessLevel: "plan",
      planKeys: ["course_complete"],
    });
    await POST(
      post({
        scopes: [
          { kind: "subject", subjectKey: "course:paid:1" },
          { kind: "subject", subjectKey: "course:paid:1" },
        ],
      }),
    );
    // Two scopes, two entitlement questions. `cache()` memoises within a
    // request in the real app; what matters here is that the ANSWER is derived
    // per scope rather than carried over from a render or from a neighbour.
    expect(vi.mocked(findEmbed).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("an entitled but empty scope", () => {
  it("is not the same answer as an unavailable one", async () => {
    // Declared, entitled, and nobody has posted under it yet (20.1's lazy
    // creation means there is no row). The member IS in the room, so telling
    // them "unavailable" would be a lie in the other direction.
    vi.mocked(findEmbed).mockReturnValue({
      subjectKey: "course:free:1",
      accessLevel: "open",
      planKeys: [],
    });
    selectQueue.push([]); // embeddedDiscussionFor → no row

    const answer = await scopesOf(
      await POST(post({ scopes: [{ kind: "subject", subjectKey: "course:free:1" }] })),
    );
    expect(answer).toEqual([
      // `stale` is scope-level state beside `locked`, and false for every
      // scope that carries its changes as rows. Only the feed ever sets it —
      // it cannot deliver tombstones, so a removal reaches an open page as one
      // bit and a re-render.
      { state: "ok", cursor: null, locked: false, stale: false, posts: [] },
    ]);
  });
});

describe("it writes nothing", () => {
  it("answers a normal poll without touching a write path", async () => {
    // The mocked db throws on insert/update/delete/transaction with a sentence
    // naming the rule, so "no writes" is measured rather than reviewed.
    vi.mocked(findEmbed).mockReturnValue({
      subjectKey: "course:free:1",
      accessLevel: "open",
      planKeys: [],
    });
    // The discussion row, then the bootstrap "newest post" read.
    selectQueue.push([
      {
        id: "d1",
        subjectKey: "course:free:1",
        groupId: null,
        title: null,
        createdBy: null,
        lockedAt: null,
        lastActivityAt: new Date("2026-08-06T10:00:00Z"),
        createdAt: new Date("2026-08-06T09:00:00Z"),
      },
    ]);
    selectQueue.push([
      { id: "p9", createdAt: new Date("2026-08-06T10:00:00.000Z") },
    ]);

    const response = await POST(
      post({ scopes: [{ kind: "subject", subjectKey: "course:free:1" }] }),
    );
    expect(response.status).toBe(200);

    const [answer] = (await scopesOf(response)) as Array<{
      state: string;
      cursor: string | null;
      posts: unknown[];
    }>;
    expect(answer.state).toBe("ok");
    // No cursor came in, so nothing is delivered — the client already has the
    // server-rendered page. What it gets is the current point.
    expect(answer.posts).toEqual([]);
    expect(answer.cursor).toBeTruthy();
  });
});
