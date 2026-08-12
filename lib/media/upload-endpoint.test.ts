// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The door the bytes travel THROUGH — and the ceiling it really has.
//
// ── There was no test for this file, and that is how the ceiling moved ─────
// `handleUpload()` is the entry for `POST /api/media` and for the API module's
// `/api/v1/media`, and nothing anywhere exercised it. Story 8.1 changed its
// ceiling from the kind's `maxBytes` to `slotCeilingBytes()` — the Server
// Action body limit, which does not apply to a route handler at all — and every
// gate stayed green while the HTTP API silently lost 40 MB of capacity. A
// refusal a customer can hit and no test can see is the shape this file exists
// to close.
//
// What is faked: the media layer's inner half (`acceptUpload`, tested where it
// lives) and the clock-free rate limiter's state. What is NOT faked: the
// config, the ceiling arithmetic and the refusal codes — those are the claim.
import { beforeEach, describe, expect, it, vi } from "vitest";

const acceptUpload = vi.fn();
vi.mock("./manage", () => ({ acceptUpload: (input: unknown) => acceptUpload(input) }));

const { handleUpload } = await import("./upload-endpoint");
const { mediaConfig } = await import("./config");
const { ROUTE_HANDLER_BODY_LIMIT_BYTES, SERVER_ACTION_BODY_LIMIT_BYTES } = await import("./rules");
const { resetRateLimits } = await import("@/lib/rate-limit");

/** One multipart POST carrying a file of a given type and size. */
function upload(type: string, size: number): Request {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(size)], "lektion.bin", { type }));
  return new Request("http://localhost/api/media", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  acceptUpload.mockResolvedValue({ id: "m1", kind: "audio", mime: "audio/mpeg", bytes: 1 });
});

describe("the ceiling a ROUTE HANDLER upload really has", () => {
  it("🚨 takes a recording the Server Action limit would have refused", async () => {
    // The regression, stated as the capability it took away. `audio.maxBytes`
    // is 50 MB in `config/media.json` and this door accepted 50 MB for as long
    // as it existed; pinning it to `slotCeilingBytes()` — `next.config.ts` →
    // `experimental.serverActions.bodySizeLimit`, which a route handler never
    // sees — turned a 30 MB upload into `413 max 10 MB`.
    const size = SERVER_ACTION_BODY_LIMIT_BYTES * 3;
    expect(size).toBeLessThanOrEqual(mediaConfig().kinds.audio.maxBytes);

    const response = await handleUpload({
      memberId: "alice",
      role: "owner",
      request: upload("audio/mpeg", size),
    });

    expect(response.status).toBe(201);
    expect(acceptUpload).toHaveBeenCalled();
  });

  it("🚨 files what it takes in as the CORE's, never as a caller's namespace", async () => {
    // ── Why this door names a slot at all, and why it is hard-coded ──────────
    // This is the generic door: `POST /api/media` enters it with a session
    // cookie and the `api` module's `POST /api/v1/media` with a bearer key. The
    // module reuses this pipeline rather than building a second one, so the
    // objects are the CORE's — a namespace names a subsystem that OWNS objects,
    // never a transport that carries them, and `api`/`upload` would claim
    // otherwise.
    //
    // Hard-coded for the same reason `visibility: "owner"` is: a namespace read
    // off a request would let a customer file their own upload into a module's
    // key space, where a lifecycle rule scoped to that module would then reach
    // it.
    const response = await handleUpload({
      memberId: "alice",
      role: "member",
      request: upload("audio/mpeg", 1_000),
    });

    expect(response.status).toBe(201);
    expect(acceptUpload.mock.calls[0]![0]).toMatchObject({
      namespace: "core",
      category: "upload",
    });
  });

  it("🚨 does not quote the direct path's ceiling at a door that buffers", async () => {
    // The other half, and the reason the raw `maxBytes` is not the answer
    // either. `video.maxBytes` is 2 GB so that the browser can write straight
    // to the bucket; `request.formData()` here has already read the body into
    // this process before anything is checked, so promising a gigabyte at this
    // door promises an outage.
    const config = mediaConfig();
    expect(config.kinds.video.maxBytes).toBeGreaterThan(ROUTE_HANDLER_BODY_LIMIT_BYTES);

    const response = await handleUpload({
      memberId: "alice",
      role: "owner",
      request: upload("video/mp4", ROUTE_HANDLER_BODY_LIMIT_BYTES + 1),
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string; detail?: string };
    expect(body.error).toBe("tooLarge");
    // The number in the refusal is the one this door can honour. Quoting a
    // higher one sends somebody away to shrink a file to a size that would
    // still fail.
    expect(body.detail).toBe("max 50 MB");
    expect(acceptUpload).not.toHaveBeenCalled();
  });

  it("keeps the kind's own ceiling where the kind is the narrower one", async () => {
    // `image.maxBytes` is 10 MB, well under what this door buffers — a route
    // ceiling that overrode it would let a member store a picture bigger than
    // the configuration allows.
    const config = mediaConfig();
    expect(config.kinds.image.maxBytes).toBeLessThan(ROUTE_HANDLER_BODY_LIMIT_BYTES);

    const response = await handleUpload({
      memberId: "alice",
      role: "owner",
      request: upload("image/png", config.kinds.image.maxBytes + 1),
    });

    expect(response.status).toBe(413);
    expect(acceptUpload).not.toHaveBeenCalled();
  });
});

describe("a request carrying no file gets its hourly slot back", () => {
  it("does not spend the allowance on an empty POST", async () => {
    // `guardUploadEntry()` counts before the body is read, which is right — and
    // it also meters the one case that costs nothing. A form bug or a retry
    // loop would otherwise lock a member out for an hour without a byte having
    // moved, with no way for them to clear it.
    const empty = () =>
      handleUpload({
        memberId: "alice",
        role: "owner",
        request: new Request("http://localhost/api/media", {
          method: "POST",
          body: new FormData(),
        }),
      });

    const max = mediaConfig().maxUploadsPerHour;
    for (let i = 0; i < max + 5; i += 1) {
      expect((await empty()).status).toBe(400);
    }

    // …and a real upload right afterwards still goes through.
    const response = await handleUpload({
      memberId: "alice",
      role: "owner",
      request: upload("audio/mpeg", 1024),
    });
    expect(response.status).toBe(201);
  });
});
