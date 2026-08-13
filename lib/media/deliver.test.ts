// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The delivery shape, at the fork that matters: bucket redirect or app stream.
//
// Everything else about `deliverMedia()` — the 404-for-forbidden rule, the 503
// — is a straight line through guards. The fork this file pins down is the one
// with a silent failure mode on the wrong side of it: subtitle text answered
// with a `307` to the bucket looks perfectly healthy in every log, and the CC
// menu in the player just stays empty, because a `<track>` fetch is
// CORS-restricted and will not follow that redirect. Same mocking deal as
// `manage.test.ts`: the store is faked, the LOGIC is not.
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import type { MediaRow } from "@/db/schema-media";

const findMedia = vi.fn<(id: string) => Promise<MediaRow | null>>();
const mayAccess = vi.fn<() => Promise<boolean>>();
const signedUrl = vi.fn<() => string | null>();
const getBytes = vi.fn<() => Promise<Uint8Array | null>>();

vi.mock("@/lib/media/config", () => ({ isMediaEnabled: () => true }));

vi.mock("@/lib/media/manage", () => ({
  findMedia: (id: string) => findMedia(id),
  mayAccess: () => mayAccess(),
}));

vi.mock("@/lib/media/store", () => ({
  mediaStore: () => ({ signedUrl, getBytes }),
  mediaStoreProblems: () => [],
}));

vi.mock("@/lib/media/url", () => ({ signedUrlSeconds: () => 300 }));

const { deliverMedia } = await import("./deliver");

function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    ownerId: "alice",
    kind: "video",
    visibility: "entitled",
    requiresPlan: "basic_monthly",
    storageKey: "courses/video/2026/08/m1.mp4",
    mime: "video/mp4",
    filename: null,
    bytes: 10,
    width: null,
    height: null,
    durationSeconds: null,
    sha256: "x",
    source: "upload",
    alt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  } as MediaRow;
}

const viewerFor = () => Promise.resolve({ memberId: "alice", role: "member" });

beforeEach(() => {
  vi.clearAllMocks();
  mayAccess.mockResolvedValue(true);
});

describe("deliverMedia — bucket redirect or app stream", () => {
  it("sends a video to the bucket when the driver can sign", async () => {
    findMedia.mockResolvedValue(row());
    signedUrl.mockReturnValue("https://bucket.example/signed");

    const response = await deliverMedia({ id: "m1", download: false, viewerFor });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://bucket.example/signed");
  });

  it("streams subtitle text itself, even though the driver could sign", async () => {
    // The point of this file. A `<track>` cannot follow a cross-origin
    // redirect, so `text/vtt` must never take the 307 branch — and the store
    // must not even be ASKED for an address, or a future refactor that
    // reorders the branches would look green while shipping the silent
    // failure back in.
    findMedia.mockResolvedValue(
      row({ mime: "text/vtt", kind: "file", storageKey: "courses/subtitle/2026/08/m1.vtt" }),
    );
    signedUrl.mockReturnValue("https://bucket.example/signed");
    getBytes.mockResolvedValue(new TextEncoder().encode("WEBVTT\n\n"));

    const response = await deliverMedia({ id: "m1", download: false, viewerFor });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/vtt");
    expect(await response.text()).toContain("WEBVTT");
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it("keeps the refusal shape for subtitle text — a missing object is 404", async () => {
    // The `console.error` below is the behaviour under test, not an accident — this
    // test PROVOKES the failure. Silenced so an UNEXPECTED error stays visible in
    // the run's output instead of drowning in expected noise.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    findMedia.mockResolvedValue(row({ mime: "text/vtt", kind: "file" }));
    getBytes.mockResolvedValue(null);

    const response = await deliverMedia({ id: "m1", download: false, viewerFor });

    expect(response.status).toBe(404);
  });
});
