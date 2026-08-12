// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The addresses a picture is delivered under — and the `srcset` that is the
// whole reason a phone stops downloading a desktop-sized photo.
//
// ── What the claims are ────────────────────────────────────────────────────
//
//  1. **Every candidate carries a `w` descriptor, the ORIGINAL included.** The
//     HTML grammar forbids mixing descriptors with bare candidates, so a
//     `srcset` that could not describe the original would have to leave it out —
//     capping every viewer at the widest variant, which for a 600 px picture
//     with one 480 variant is WORSE than serving the original. That is why a row
//     with variants but no measured width answers `srcSet: null`.
//  2. **One address that cannot be minted drops the whole list.** On the local
//     driver there is no address a browser can reach that is not this app, so a
//     partial `srcset` would be a candidate list with a hole in it.
//  3. **A variant is never authorised separately.** It is the same row's bytes at
//     another width, so it inherits `mayAccess()`'s decision — this function
//     grants nothing and checks nothing, exactly as `mediaUrlFor()` does not, and
//     the assertion that can be made here is that a `public` row's copies are
//     public and everything else's are signed for the kind's own window.
//
// The store is mocked; the composition is not. What a real bucket answers is
// `node run.mjs media-check`, which is a different question with its own command.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaRow } from "@/db/schema-media";

const signedUrl = vi.fn<(key: string, options: { expiresSeconds: number }) => string | null>();
const publicUrl = vi.fn<(key: string) => string | null>();

vi.mock("./store", () => ({
  mediaStore: () => ({ signedUrl, publicUrl }),
}));

const { mediaImageFor, mediaUrlFor, signedUrlSeconds } = await import("./url");

function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    ownerId: "alice",
    kind: "image",
    visibility: "members",
    requiresPlan: null,
    storageKey: "community/post/2026/08/m1.jpg",
    mime: "image/jpeg",
    filename: "urlaub.jpg",
    bytes: 900_000,
    width: 2000,
    height: 1333,
    variants: [480, 960, 1440],
    durationSeconds: null,
    sha256: "x",
    source: "upload",
    alt: "Ein Strand",
    prompt: null,
    provider: null,
    model: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  } as MediaRow;
}

beforeEach(() => {
  signedUrl.mockReset().mockImplementation((key) => `https://bucket.example/${key}?sig`);
  publicUrl.mockReset().mockImplementation((key) => `https://cdn.example/${key}`);
});

describe("🚨 AC 3 — a phone is handed a candidate list, narrowest first", () => {
  it("puts every variant and the original in the srcset, each with its width", () => {
    const image = mediaImageFor(row());

    expect(image.src).toBe("https://bucket.example/community/post/2026/08/m1.jpg?sig");
    expect(image.srcSet).toBe(
      [
        "https://bucket.example/community/post/2026/08/m1-w480.jpg?sig 480w",
        "https://bucket.example/community/post/2026/08/m1-w960.jpg?sig 960w",
        "https://bucket.example/community/post/2026/08/m1-w1440.jpg?sig 1440w",
        "https://bucket.example/community/post/2026/08/m1.jpg?sig 2000w",
      ].join(", "),
    );
    expect(image.width).toBe(2000);
    expect(image.height).toBe(1333);
  });

  it("orders the candidates by width even when the row does not", () => {
    // The column is an array a hand-written UPDATE could scramble, and a browser
    // reading an unordered list still works — but a human reading the markup
    // while debugging a wrong pick should not have to sort it themselves.
    const image = mediaImageFor(row({ variants: [1440, 480, 960] }));
    expect(image.srcSet).toMatch(/w480\.jpg\?sig 480w, .*w960\.jpg\?sig 960w, .*w1440/);
  });

  it("signs each variant for its KIND's window, never a longer one", () => {
    mediaImageFor(row());
    for (const [, options] of signedUrl.mock.calls) {
      expect(options.expiresSeconds).toBe(signedUrlSeconds("image"));
    }
  });

  it("leaves a public row's copies public, exactly like its original", () => {
    // Giving the copies a signature the original does not have would be a
    // different answer to the same question — and it would make a CDN cache miss
    // on every request for bytes anybody may see anyway.
    const image = mediaImageFor(row({ visibility: "public" }));
    expect(image.src).toBe("https://cdn.example/community/post/2026/08/m1.jpg");
    expect(image.srcSet).toContain("https://cdn.example/community/post/2026/08/m1-w480.jpg 480w");
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it("🚨 drops a candidate that would claim to be wider than the file", () => {
    // `variantWidthsFor()` compares strictly, so this cannot arise from the
    // shipped path — a row edited by hand can say it, and a browser told a 960
    // candidate exists for an 800 px picture downloads the wrong one.
    const image = mediaImageFor(row({ width: 800, variants: [480, 960] }));
    expect(image.srcSet).toBe(
      [
        "https://bucket.example/community/post/2026/08/m1-w480.jpg?sig 480w",
        "https://bucket.example/community/post/2026/08/m1.jpg?sig 800w",
      ].join(", "),
    );
  });
});

describe("🚨 AC 3 — when there is nothing honest to choose from, there is no srcset", () => {
  it("answers null for a row nobody ever asked", () => {
    // Every picture stored before Story 26.2. It keeps serving its original,
    // which is exactly what it did yesterday.
    expect(mediaImageFor(row({ variants: null })).srcSet).toBeNull();
  });

  it("answers null for a row that was asked and had none", () => {
    expect(mediaImageFor(row({ variants: [] })).srcSet).toBeNull();
  });

  it("🚨 answers null when the ORIGINAL's width was never measured", () => {
    // The claim from the header: with no `w` descriptor for the original it can
    // only be left out, and a list capped at the widest variant is worse than the
    // original for a picture that is barely wider than one.
    expect(mediaImageFor(row({ width: null })).srcSet).toBeNull();
    expect(mediaImageFor(row({ width: 0 })).srcSet).toBeNull();
  });

  it("answers null for anything that is not a picture", () => {
    expect(
      mediaImageFor(row({ kind: "video", mime: "video/mp4", variants: [480] })).srcSet,
    ).toBeNull();
  });

  it("answers null for a download — the browser is saving one file", () => {
    const image = mediaImageFor(row(), { download: true });
    expect(image.srcSet).toBeNull();
    expect(image.src).toContain("m1.jpg");
  });

  it("🚨 answers null on the local driver rather than a list with a hole in it", () => {
    // Claim 2. `signedUrl()` is null there for everything, and `mediaUrlFor()`
    // falls back to this app's own route — for which there is no per-variant
    // address at all.
    signedUrl.mockReturnValue(null);
    publicUrl.mockReturnValue(null);

    const image = mediaImageFor(row());
    expect(image.srcSet).toBeNull();
    expect(image.src).toBe("/api/media/m1");
    expect(image.src).toBe(mediaUrlFor(row()));
  });

  it("🚨 drops the whole list when ONE variant address cannot be minted", () => {
    // Non-vacuity for the branch above: it must not be satisfied merely by "the
    // local driver answers null for everything".
    signedUrl.mockImplementation((key) =>
      key.includes("-w960") ? null : `https://bucket.example/${key}?sig`,
    );

    const image = mediaImageFor(row());
    expect(image.srcSet).toBeNull();
    // …and the original is still served, which is the point of falling back.
    expect(image.src).toBe("https://bucket.example/community/post/2026/08/m1.jpg?sig");
  });
});
