// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The manifest judgement, pinned — `validateManifest` is what stands between
// a typo in `content/media-manifest.json` and a 500 on a customer's course
// page (`hasPlan()` throws on an unknown key) or a bad object key in the
// store. All three content commands share the one implementation; this file
// makes its refusals a contract rather than a habit.
import { describe, expect, it } from "vitest";

import { declaredVsReported, keyFor, validateManifest } from "./_manifest.mjs";
import {
  CONTENT_MEDIA_BUCKET_PREFIX,
  CONTENT_MEDIA_TYPES,
  isValidContentMediaPath,
} from "../../lib/content-media/rules.mjs";

const PLANS = ["basis_monatlich", "premium_jahr"];

function manifest(entries: unknown[]) {
  return validateManifest({ entries }, { productKeys: PLANS });
}

describe("the grammar", () => {
  it("accepts <topic-slug>/<file>.<ext> and nothing shallower or deeper", () => {
    expect(isValidContentMediaPath("kurs-basics/intro.mp4")).toBe(true);
    expect(isValidContentMediaPath("intro.mp4")).toBe(false);
    expect(isValidContentMediaPath("a/b/c.mp4")).toBe(false);
  });

  it("refuses traversal, empty segments and foreign characters", () => {
    for (const path of [
      "../etc/passwd.pdf",
      "a/../b.mp4",
      "a//b.mp4",
      "/a/b.mp4",
      "a/b.mp4/",
      "A/b.mp4",
      "a/b c.mp4",
      "a\\b.mp4",
      "a/b.exe",
      "",
    ]) {
      expect(isValidContentMediaPath(path), path).toBe(false);
    }
  });

  it("maps every extension to a kind the media table's enum knows", () => {
    const enumKinds = ["image", "video", "audio", "file"];
    for (const [extension, type] of Object.entries(CONTENT_MEDIA_TYPES)) {
      expect(enumKinds, extension).toContain(type.kind);
    }
  });

  it("builds keys under the content/ prefix, apart from uploads and knowledge", () => {
    expect(keyFor("kurs/intro.mp4")).toBe(`${CONTENT_MEDIA_BUCKET_PREFIX}kurs/intro.mp4`);
    expect(CONTENT_MEDIA_BUCKET_PREFIX).toBe("content/");
  });
});

describe("validateManifest", () => {
  it("enriches a valid entry with kind, contentType, key and filename", () => {
    const { entries, problems } = manifest([
      { path: "kurs/intro.mp4", visibility: "entitled", requiresPlan: "basis_monatlich" },
    ]);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      expect.objectContaining({
        path: "kurs/intro.mp4",
        key: "content/kurs/intro.mp4",
        kind: "video",
        contentType: "video/mp4",
        visibility: "entitled",
        requiresPlan: "basis_monatlich",
        filename: "intro.mp4",
      }),
    ]);
  });

  it("refuses a shape that is not { entries: [...] }", () => {
    expect(validateManifest(null, { productKeys: PLANS }).problems).toHaveLength(1);
    expect(validateManifest([], { productKeys: PLANS }).problems).toHaveLength(1);
    expect(validateManifest({}, { productKeys: PLANS }).problems).toHaveLength(1);
    expect(validateManifest({ entries: "x" }, { productKeys: PLANS }).problems).toHaveLength(1);
  });

  it("names a bad path and never enriches it", () => {
    const { entries, problems } = manifest([{ path: "Intro.MP4", visibility: "public" }]);
    expect(entries).toEqual([]);
    expect(problems[0]).toContain("naming standard");
  });

  it("refuses the same path twice — one file, one entry", () => {
    const { problems } = manifest([
      { path: "kurs/a.pdf", visibility: "public" },
      { path: "kurs/a.pdf", visibility: "public" },
    ]);
    expect(problems[0]).toContain("declared twice");
  });

  it('refuses "owner" visibility — product media belong to no account', () => {
    const { problems } = manifest([{ path: "kurs/a.pdf", visibility: "owner" }]);
    expect(problems[0]).toContain('"public"');
  });

  it("demands requiresPlan on entitled entries, and a KNOWN one", () => {
    expect(manifest([{ path: "kurs/a.pdf", visibility: "entitled" }]).problems[0]).toContain(
      "requiresPlan",
    );
    const unknown = manifest([
      { path: "kurs/a.pdf", visibility: "entitled", requiresPlan: "nope" },
    ]);
    // The reason this check exists: hasPlan() throws on an unknown key.
    expect(unknown.problems[0]).toContain("hasPlan()");
  });

  it("reports an unreadable registry as unverifiable, never as fine", () => {
    const { problems } = validateManifest(
      { entries: [{ path: "kurs/a.pdf", visibility: "entitled", requiresPlan: "basis_monatlich" }] },
      { productKeys: null },
    );
    expect(problems[0]).toContain("cannot be verified");
  });

  it("refuses requiresPlan beside public — it would do nothing", () => {
    const { problems } = manifest([
      { path: "kurs/a.pdf", visibility: "public", requiresPlan: "basis_monatlich" },
    ]);
    expect(problems[0]).toContain("does nothing");
  });

  it("demands alt for images — the upload endpoint's rule, same here", () => {
    expect(manifest([{ path: "kurs/cover.png", visibility: "public" }]).problems[0]).toContain(
      '"alt"',
    );
    expect(
      manifest([{ path: "kurs/cover.png", visibility: "public", alt: "The course cover" }])
        .problems,
    ).toEqual([]);
  });

  it("judges recorded sha256/bytes by shape", () => {
    expect(
      manifest([{ path: "kurs/a.pdf", visibility: "public", sha256: "short" }]).problems[0],
    ).toContain("sha256");
    expect(
      manifest([{ path: "kurs/a.pdf", visibility: "public", bytes: -3 }]).problems[0],
    ).toContain("bytes");
    expect(
      manifest([
        { path: "kurs/a.pdf", visibility: "public", sha256: "a".repeat(64), bytes: 12 },
      ]).problems,
    ).toEqual([]);
  });
});

// ── The fourth state, and the only one no owner inside the app can see ──────
// A manifest that IS in this repo and did NOT reach the environment being
// asked. The two facts live in two processes — the app knows what it holds,
// this machine has the repo the deploy came from — so the comparison is the
// CLI's, and it is a pure function precisely so it can be measured without a
// fetch. `check.mjs`'s wire half stays untested, as it is today.
describe("declaredVsReported", () => {
  const item = (expected: number | null, note?: string) => ({ expected, note });

  it("says both numbers and both sides when the environment has no manifest", () => {
    const said = declaredVsReported(7, item(null, "no content/media-manifest.json here"));

    expect(said).toContain("7");
    expect(said).toContain("this checkout");
    expect(said).toContain("no content/media-manifest.json here");
  });

  it("says both numbers when the environment declares fewer", () => {
    const said = declaredVsReported(7, item(5));

    expect(said).toContain("7");
    expect(said).toContain("5");
  });

  it("says so when the environment carried no product media item at all", () => {
    // A build from before the item existed. Its answer and an app that really
    // holds nothing look identical from here, so the sentence names the cause
    // rather than claiming the count.
    expect(declaredVsReported(7, null)).toContain("7");
  });

  it("is silent when the environment declares the same, or more", () => {
    expect(declaredVsReported(7, item(7))).toBeNull();
    // A checkout BEHIND the deployed commit is somebody else's push, not a
    // broken production.
    expect(declaredVsReported(7, item(9))).toBeNull();
  });

  it("🚨 is silent when this checkout declares nothing either", () => {
    // Two absences agree. Inventing a problem out of them would be the mirror
    // image of the defect the answered absence closes.
    expect(declaredVsReported(0, null)).toBeNull();
    expect(declaredVsReported(0, item(null, "no manifest"))).toBeNull();
    expect(declaredVsReported(0, item(0))).toBeNull();
  });
});
