// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The narrower copies, against a real resizer and real bytes.
//
// ── Why `sharp` is NOT mocked here ─────────────────────────────────────────
// Every claim worth making about this file is a claim about what comes out of
// libvips: that a 2000 px picture really produces a 960 px object rather than a
// row saying it did, that "downscales only" is enforced by the bytes and not
// only by the arithmetic in `variantWidthsFor()`, and that no EXIF rides along.
// A mocked resizer would agree with whatever the code asked it for, which is the
// one thing this file must not do — and `package.json` now declares `sharp`
// explicitly, so it is a dependency this test may rely on rather than a
// transitive hoist it would be borrowing.
//
// The STORE is mocked, because that half is a network and the question here is
// which keys and which bytes it is handed.
//
// ── The failure policy is a test, not a comment ────────────────────────────
// 🚨 The load-bearing property of this file is a NEGATIVE one: nothing it does
// may fail an upload. The original is the product and a variant is an
// optimisation, so a bucket refusing one width, refusing all of them, or a file
// libvips cannot open must each end in a row that records what really landed —
// never in a thrown error that loses a member's picture. Three tests below plant
// exactly those failures.
import { beforeEach, describe, expect, it, vi } from "vitest";

import sharp from "sharp";

const put = vi.fn<(key: string, body: Uint8Array, contentType: string) => Promise<void>>();
const remove = vi.fn<(key: string) => Promise<void>>();

vi.mock("./store", () => ({
  mediaStore: () => ({ put, remove }),
}));

const { deriveImageVariants, removeImageVariants } = await import("./variants");

/** A real picture of a given width, in a real format. */
async function picture(
  width: number,
  format: "jpeg" | "png" | "webp" | "gif" = "jpeg",
): Promise<Uint8Array> {
  const image = sharp({
    create: {
      width,
      // 3:2, so the height is a number a squash would visibly change.
      height: Math.max(1, Math.round((width * 2) / 3)),
      channels: 3,
      background: { r: 40, g: 90, b: 160 },
    },
  });
  const buffer = await image[format]().toBuffer();
  return new Uint8Array(buffer);
}

/** What the store was handed, keyed by the key it was handed it under. */
const stored = () => new Map(put.mock.calls.map(([key, body]) => [key, body]));

beforeEach(() => {
  vi.restoreAllMocks();
  put.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
});

describe("🚨 AC 2 — the widths are derived, and they are really that wide", () => {
  it("writes three sibling objects for a wide picture, and measures the original", async () => {
    const bytes = await picture(2000);

    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/jpeg",
      bytes,
      deliveryKey: "community/post/2026/08/p1.jpg",
    });

    expect(derived.variants).toEqual([480, 960, 1440]);
    // The measurement is what makes an honest `srcset` possible at all: without
    // the original's real width there is no `w` descriptor to give it, and a
    // candidate list that cannot describe the original caps every viewer at the
    // widest variant.
    expect(derived.width).toBe(2000);
    expect(derived.height).toBe(1333);

    const objects = stored();
    expect([...objects.keys()]).toEqual([
      "community/post/2026/08/p1-w480.jpg",
      "community/post/2026/08/p1-w960.jpg",
      "community/post/2026/08/p1-w1440.jpg",
    ]);

    // 🚨 The bytes, not the bookkeeping. A row can claim a width; this asks the
    // object what it is.
    for (const width of [480, 960, 1440]) {
      const object = objects.get(`community/post/2026/08/p1-w${width}.jpg`);
      const meta = await sharp(object as Uint8Array).metadata();
      expect(meta.width, `the ${width}px variant`).toBe(width);
      // Smaller than the original, which is the entire point of the exercise.
      expect((object as Uint8Array).byteLength).toBeLessThan(bytes.byteLength);
    }
  });

  it("keeps the type it was given, so the key's extension stays true", async () => {
    await deriveImageVariants({
      kind: "image",
      mime: "image/webp",
      bytes: await picture(1000, "webp"),
      deliveryKey: "core/upload/2026/08/w1.webp",
    });

    expect(put.mock.calls.map(([key, , contentType]) => [key, contentType])).toEqual([
      ["core/upload/2026/08/w1-w480.webp", "image/webp"],
      ["core/upload/2026/08/w1-w960.webp", "image/webp"],
    ]);
    const object = stored().get("core/upload/2026/08/w1-w480.webp");
    expect((await sharp(object as Uint8Array).metadata()).format).toBe("webp");
  });

  it("🚨 downscales only — a narrow picture produces the widths below it and no more", async () => {
    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/png",
      bytes: await picture(600, "png"),
      deliveryKey: "core/upload/2026/08/n1.png",
    });

    expect(derived.variants).toEqual([480]);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a picture already narrower than every target", async () => {
    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/png",
      bytes: await picture(300, "png"),
      deliveryKey: "core/upload/2026/08/t1.png",
    });

    // `[]` and not `null`: it was asked, and the answer is none. The three states
    // are argued on the column in `db/schema-media.ts`.
    expect(derived.variants).toEqual([]);
    expect(derived.width).toBe(300);
    expect(put).not.toHaveBeenCalled();
  });

  it("asks nothing at all of a video, a recording or a file", async () => {
    for (const kind of ["video", "audio", "file"] as const) {
      const derived = await deriveImageVariants({
        kind,
        mime: "video/mp4",
        bytes: new Uint8Array([0, 1, 2]),
        deliveryKey: "core/upload/2026/08/v1.mp4",
      });
      // `null` — the question does not apply. A backfill looking for rows nobody
      // ever asked must be able to tell these from an image with no variants.
      expect(derived.variants, kind).toBeNull();
    }
    expect(put).not.toHaveBeenCalled();
  });

  it("measures a GIF and derives nothing from it", async () => {
    // Deliberately not resizable: without `{ animated: true }` sharp silently
    // keeps the first frame — an upload that visibly stops moving — and with it
    // the re-encode is routinely larger than the original.
    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/gif",
      bytes: await picture(1200, "gif"),
      deliveryKey: "core/upload/2026/08/g1.gif",
    });

    expect(derived.variants).toEqual([]);
    expect(derived.width).toBe(1200);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("🚨 a variant carries no metadata the original just lost", () => {
  it("does not copy EXIF into the copies", async () => {
    // `acceptUpload()` hands `createMedia()` the output of `stripMetadata()`, so
    // in the shipped path there is no EXIF left to copy. This is the second half
    // of that promise: even handed a picture that still HAS some, sharp writes
    // none — `withMetadata()` is deliberately never called. Without both halves,
    // `docs/data-protection.md` §14 would be claiming a protection that the new
    // objects do not have.
    const withExif = new Uint8Array(
      await sharp({
        create: { width: 1200, height: 800, channels: 3, background: "#204080" },
      })
        .withExif({ IFD0: { Copyright: "Anna Schmidt", Software: "a camera" } })
        .jpeg()
        .toBuffer(),
    );
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    await deriveImageVariants({
      kind: "image",
      mime: "image/jpeg",
      bytes: withExif,
      deliveryKey: "community/post/2026/08/e1.jpg",
    });

    const object = stored().get("community/post/2026/08/e1-w480.jpg");
    expect((await sharp(object as Uint8Array).metadata()).exif).toBeUndefined();
  });
});

describe("🚨 AC 2 — nothing here may cost somebody their upload", () => {
  it("keeps the widths that landed when the bucket refuses one", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    put.mockImplementation(async (key) => {
      if (key.includes("-w960")) throw new Error("bucket hiccup");
    });

    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/jpeg",
      bytes: await picture(2000),
      deliveryKey: "community/post/2026/08/p2.jpg",
    });

    // The row records what REALLY landed, so the delivery side never mints an
    // address for an object that is not there.
    expect(derived.variants).toEqual([480, 1440]);
    // One width failing does not stop the ones after it.
    expect(put).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalled();
  });

  it("returns an empty list rather than throwing when the bucket refuses all of them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    put.mockRejectedValue(new Error("bucket unreachable"));

    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/jpeg",
      bytes: await picture(1500),
      deliveryKey: "community/post/2026/08/p3.jpg",
    });

    expect(derived.variants).toEqual([]);
    // The measurement survived, because it happens before any write.
    expect(derived.width).toBe(1500);
  });

  it("survives bytes libvips cannot open at all", async () => {
    // A file that sniffed as an image (`agreedMime()` decided from its own first
    // bytes) and that libvips will not read — a truncated JPEG off a flaky mobile
    // connection is the real case. `agreedMime()`'s ruling is not sharp's to
    // overturn, so the upload stands with no variants.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const derived = await deriveImageVariants({
      kind: "image",
      mime: "image/jpeg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
      deliveryKey: "community/post/2026/08/p4.jpg",
    });

    expect(derived).toEqual({ variants: [], width: null, height: null });
    expect(put).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  });
});

describe("removeImageVariants is the other direction, and it does throw", () => {
  it("removes one object per recorded width", async () => {
    await removeImageVariants({ storageKey: "community/post/2026/08/p1.jpg", variants: [480, 960] });

    expect(remove.mock.calls.map(([key]) => key)).toEqual([
      "community/post/2026/08/p1-w480.jpg",
      "community/post/2026/08/p1-w960.jpg",
    ]);
  });

  it("asks for nothing on a row that was never asked, or has none", async () => {
    await removeImageVariants({ storageKey: "core/upload/2026/07/old.png", variants: null });
    await removeImageVariants({ storageKey: "core/upload/2026/07/small.png", variants: [] });
    expect(remove).not.toHaveBeenCalled();
  });

  it("🚨 propagates a failure rather than swallowing it", async () => {
    // The asymmetry that matters: writing a variant is best-effort, removing one
    // is not. `media.variants` is the only record that the object exists, so a
    // swallowed failure here plus the row's deletion is bytes nothing can ever
    // locate — and this path is answering an erasure request.
    remove.mockRejectedValue(new Error("bucket unreachable"));

    await expect(
      removeImageVariants({ storageKey: "community/post/2026/08/p1.jpg", variants: [480] }),
    ).rejects.toThrow(/bucket unreachable/);
  });
});
