// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The bucket driver, against a mocked `fetch`.
//
// ── There was no test for this file at all ─────────────────────────────────
// `lib/media/` had `config`, `deliver`, `exif`, `local`, `manage`, `rules`,
// `sigv4` and `sniff` — and nothing for the driver every deployed app runs on.
// The local driver is the one with a test and the one that never ships. Story
// 8.1 added two methods here, which is the moment to close that.
//
// What is proven is what a mocked `fetch` can prove honestly: which request
// this driver BUILDS. Whether a real bucket then accepts it is a different
// question with its own command — `node run.mjs media-check`, which writes,
// reads and deletes a throwaway object.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createS3Store, type S3Settings } from "./s3";

const SETTINGS: S3Settings = {
  endpoint: "https://fra1.example.com",
  region: "auto",
  bucket: "app-media",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  publicBaseUrl: null,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("createUploadUrl", () => {
  const store = () => createS3Store(SETTINGS);

  it("is a signed PUT at the object's own path", () => {
    const url = store().createUploadUrl("courses/video/2026/08/abc.mp4", 3600)!;
    expect(url).toContain("https://fra1.example.com/app-media/courses/video/2026/08/abc.mp4?");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=3600");
    expect(url).toContain("X-Amz-SignedHeaders=host");
  });

  it("🚨 is not the same address as a read of the same key", () => {
    // A write address that equals a read address means the method never
    // reached the signature — and every signed download URL this app has ever
    // handed out would also be an upload URL.
    const s = store();
    const write = s.createUploadUrl("courses/video/2026/08/abc.mp4", 3600)!;
    const read = s.signedUrl("courses/video/2026/08/abc.mp4", { expiresSeconds: 3600 })!;
    expect(write).not.toBe(read);
  });

  it("sends nothing — minting is arithmetic, not a request", () => {
    store().createUploadUrl("courses/video/2026/08/abc.mp4", 3600);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("copy — the step that makes the direct path a promise", () => {
  it("is a PUT on the destination naming the source, with the type we measured", async () => {
    fetchMock.mockResolvedValue(new Response("<CopyObjectResult/>", { status: 200 }));

    await createS3Store(SETTINGS).copy(
      "pending/2026/08/abc.mp4",
      "courses/video/2026/08/abc.mp4",
      "video/mp4",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://fra1.example.com/app-media/courses/video/2026/08/abc.mp4");
    expect(init.method).toBe("PUT");
    // No body: the provider moves the bytes internally. A two-gigabyte
    // recording costs one request rather than one heap.
    expect(init.body).toBeUndefined();

    const headers = init.headers as Record<string, string>;
    // 🚨 Always bucket-prefixed. The copy source is a reference into the
    // account, not a path on this endpoint — a virtual-hosted endpoint puts the
    // bucket in the host and this header still names it.
    expect(headers["x-amz-copy-source"]).toBe("/app-media/pending/2026/08/abc.mp4");
    // 🚨 REPLACE, not the default COPY. The source object was written by a
    // browser, so its stored type is whatever that browser chose; what gets
    // recorded is what the app read out of the object's own first bytes.
    expect(headers["x-amz-metadata-directive"]).toBe("REPLACE");
    expect(headers["content-type"]).toBe("video/mp4");
  });

  it("🚨 refuses a copy that failed with a 200", async () => {
    // S3 keeps a long copy's connection warm and writes the outcome into the
    // BODY. A status check alone reports success for a copy that did not
    // happen — and the confirm step would then write a row pointing at a key
    // with nothing behind it, which is the one failure shape this whole path
    // exists to make impossible.
    fetchMock.mockResolvedValue(
      new Response("<Error><Code>InternalError</Code></Error>", { status: 200 }),
    );
    await expect(
      createS3Store(SETTINGS).copy("pending/a.mp4", "courses/video/a.mp4", "video/mp4"),
    ).rejects.toThrow(/200 body/);
  });

  it("throws on a refused copy", async () => {
    fetchMock.mockResolvedValue(new Response("no such key", { status: 404 }));
    await expect(
      createS3Store(SETTINGS).copy("pending/a.mp4", "courses/video/a.mp4", "video/mp4"),
    ).rejects.toThrow(/404/);
  });
});

describe("firstBytes", () => {
  it("asks for a byte range and keeps only the window", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { status: 206 }),
    );

    const out = await createS3Store(SETTINGS).firstBytes("courses/video/2026/08/abc.mp4", 4);

    expect(Array.from(out ?? [])).toEqual([1, 2, 3, 4]);
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.range).toBe("bytes=0-3");
    // 🚨 And the range is SIGNED, not merely sent: it is inside the signed
    // header list, so a proxy rewriting it breaks the signature instead of
    // quietly changing which bytes the sniffer sees.
    expect(headers.Authorization).toContain("range");
  });

  it("slices even when the bucket ignores the range and sends everything", async () => {
    // Not belt-and-braces: a provider that does not honour ranges should cost
    // bandwidth, never correctness — the sniffer must still see sixteen bytes.
    fetchMock.mockResolvedValue(new Response(new Uint8Array(64).fill(7), { status: 200 }));
    const out = await createS3Store(SETTINGS).firstBytes("k.mp4", 16);
    expect(out).toHaveLength(16);
  });

  it("answers null for an object that is not there", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await createS3Store(SETTINGS).firstBytes("k.mp4", 16)).toBeNull();
  });

  it("throws on anything else, rather than reporting an empty file", async () => {
    // A 403 answered as `null` would reach the confirm step as "the object
    // never arrived", and the operator would be told to upload it again.
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(createS3Store(SETTINGS).firstBytes("k.mp4", 16)).rejects.toThrow(/403/);
  });
});
