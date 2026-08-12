// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The mint door, run rather than read.
//
// ── Why this one gets a harness where the neighbour gets a source scan ─────
// `app/api/knowledge-media/[...path]/route.test.ts` pins its route by reading
// it, because what matters there is an ORDER. What matters here is an effect
// nobody can see in the text: whether a request that describes no file gives
// the hourly slot back. `guardUploadEntry()` counts before the body is read —
// which is right, and which also meters the one case that costs nothing. A
// form bug or a retry loop would otherwise lock a member out for an hour
// without an address having been minted, and there is nothing they can do to
// clear it. The through-the-app door has said so in a comment since Story
// 19.4; this one did not do it.
//
// The session and the media layer are mocked; the rate limiter is REAL, since
// its state is the whole question.
import { beforeEach, describe, expect, it, vi } from "vitest";

const currentActiveUser = vi.fn();
vi.mock("@/lib/authz", () => ({ currentActiveUser: () => currentActiveUser() }));

const createUploadTicket = vi.fn();
vi.mock("@/lib/media/manage", () => ({
  createUploadTicket: (input: unknown) => createUploadTicket(input),
}));

const { POST } = await import("./route");
const { mediaConfig } = await import("@/lib/media/config");
const { resetRateLimits } = await import("@/lib/rate-limit");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/media/upload-url", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  currentActiveUser.mockResolvedValue({
    state: "active",
    session: { user: { id: "alice", role: "owner" } },
  });
  createUploadTicket.mockResolvedValue({
    ticketId: "t1",
    url: "https://bucket.example/pending/2026/08/t1.mp4?X-Amz-…",
    expiresAt: new Date(),
  });
});

describe("a request describing no file gets its hourly slot back", () => {
  it("does not lock a member out over a broken body or a missing field", async () => {
    const max = mediaConfig().maxUploadsPerHour;
    for (let i = 0; i < max + 5; i += 1) {
      expect((await post("not json at all")).status, "unparseable body").toBe(400);
      expect((await post({ filename: "x.mp4" })).status, "no mime, no size").toBe(400);
    }
    expect(createUploadTicket).not.toHaveBeenCalled();

    // …and a real request straight afterwards still gets an address.
    const ok = await post({ mime: "video/mp4", filename: "lektion.mp4", bytes: 900_000_000 });
    expect(ok.status).toBe(201);
  });

  it("still spends a slot on a request that really mints one", async () => {
    // The other direction, and the reason `forgetOne()` is not `clearKey()`:
    // giving the hit back must not turn a broken request into a quota reset.
    const max = mediaConfig().maxUploadsPerHour;
    for (let i = 0; i < max; i += 1) {
      expect((await post({ mime: "video/mp4", bytes: 10 })).status).toBe(201);
    }
    const over = await post({ mime: "video/mp4", bytes: 10 });
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rateLimited" });
  });
});

describe("what comes back", () => {
  it("carries the ticket id and no storage key", async () => {
    const body = (await (await post({ mime: "video/mp4", bytes: 10 })).json()) as
      Record<string, unknown>;
    expect(body).toEqual({
      ticketId: "t1",
      url: "https://bucket.example/pending/2026/08/t1.mp4?X-Amz-…",
      expiresAt: expect.any(String),
    });
  });

  it("pins the visibility itself and never reads one from the request", async () => {
    // A customer must not be able to publish their own upload, and certainly
    // not to file one as `entitled` and hand themselves paid content.
    await post({ mime: "video/mp4", bytes: 10, visibility: "public", requiresPlan: "kurs" });
    expect(createUploadTicket.mock.calls[0][0]).toMatchObject({
      ownerId: "alice",
      visibility: "owner",
    });
    expect(createUploadTicket.mock.calls[0][0].requiresPlan).toBeUndefined();
  });
});
