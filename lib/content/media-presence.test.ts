// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The regression this file exists for: `mediaPresence()` read a key no
// producer writes.
//
// It read `manifest.files`. The manifest is `{ "entries": [ … ] }` — validated
// in `scripts/content/_manifest.mjs`, documented in `docs/content.md`, written
// by nothing else. So `declared` was empty for EVERY real manifest, the early
// return fired, and the core answered `product media: 0 of 0` for an app
// declaring seven files. A green tick for a question that was never asked, in
// the one item whose expected count is knowable and whose missing files can be
// NAMED — and there was no test on this function at all.
//
// Hence the shape assertions below are not decoration. The case that keeps the
// defect from returning is `{ "files": [...] }`: it must THROW, because a
// reader that quietly accepts a shape nobody writes is a reader that can never
// be wrong out loud.
//
// 🚨 And the second regression, which is what the HEAD half is here for: this
// function answered the whole question by COUNTING ROWS. Measured at Story
// 34.4 — `media` row present, bucket emptied — `node run.mjs content-check`
// said `✓ core product media: 1 of 1` and exited 0, over a lesson whose media
// id resolves to nothing. The row is not evidence of the bytes: `content_publish`
// writes it out of the manifest's own recorded `sha256`/`bytes`.
//
// So `@/lib/media/store` is MOCKED AT THE MODULE rather than injected through
// the second parameter, and that is the needle. An injected store proves what
// this function does with an answer; only the module mock proves it goes and
// ASKS. Delete the `head()` loop, or default the resolver to something that
// never reaches the store, and the calls asserted below stop arriving.
//
// The database is mocked and the manifest is not: the claim under test is what
// this function makes of a manifest, and the rows are only what it compares
// against. The `vi.mock("@/db")` shape follows `lib/media/direct-upload.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONTENT_MEDIA_BUCKET_PREFIX } from "@/lib/content-media/rules.mjs";

/** What the `select().from().where()` chain gives back. */
const rows = vi.fn<() => Promise<{ storageKey: string }[]>>();

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => rows() }) }) },
}));

/** The store this installation would really use, as `mediaPresence()` finds it. */
const head = vi.fn<(key: string) => Promise<{ bytes: number } | null>>();
const storeProblems = vi.fn<() => string[]>();

vi.mock("@/lib/media/store", () => ({
  mediaStore: () => ({ head }),
  mediaStoreProblems: () => storeProblems(),
}));

const { mediaPresence } = await import("./media-presence");

const entry = (path: string) => ({ path, visibility: "public", alt: "x" });
const stored = (...paths: string[]) =>
  paths.map((path) => ({ storageKey: `${CONTENT_MEDIA_BUCKET_PREFIX}${path}` }));
const keyOf = (path: string) => `${CONTENT_MEDIA_BUCKET_PREFIX}${path}`;

beforeEach(() => {
  rows.mockReset();
  rows.mockResolvedValue([]);
  head.mockReset();
  head.mockResolvedValue({ bytes: 12 });
  storeProblems.mockReset();
  storeProblems.mockReturnValue([]);
});

describe("a manifest in the shipped shape", () => {
  const three = {
    entries: [entry("kurs/intro.mp4"), entry("kurs/teil-2.mp4"), entry("kurs/cover.png")],
  };

  it("counts the entries and NAMES the ones with no row", async () => {
    rows.mockResolvedValue(stored("kurs/intro.mp4"));

    const item = await mediaPresence(three);

    expect(item.expected).toBe(3);
    expect(item.found).toBe(1);
    // Names, not a count — the whole reason this item is worth having. And the
    // name says WHICH half is missing: a row is written by `content-publish`,
    // an object is not, and a reader told only "missing" has to guess.
    expect(item.missing).toEqual([
      "kurs/teil-2.mp4 (no media row)",
      "kurs/cover.png (no media row)",
    ]);
  });

  it("reports every key present with no `missing` at all", async () => {
    rows.mockResolvedValue(stored("kurs/intro.mp4", "kurs/teil-2.mp4", "kurs/cover.png"));

    const item = await mediaPresence(three);

    expect(item.found).toBe(3);
    expect(item.expected).toBe(3);
    expect(item.missing).toBeUndefined();
    expect(item.notChecked).toBeUndefined();
  });

  it("matches a row on CONTENT_MEDIA_BUCKET_PREFIX + path, and on nothing else", async () => {
    // Asserted through the constant rather than a second literal, and through
    // `missing` rather than `found`: `found` is the row count the store gave
    // back, while `missing` is the one field computed by re-deriving the key —
    // so a key composed any other way shows up here and only here.
    rows.mockResolvedValue([{ storageKey: `${CONTENT_MEDIA_BUCKET_PREFIX}kurs/intro.mp4` }]);

    expect((await mediaPresence({ entries: [entry("kurs/intro.mp4")] })).missing).toBeUndefined();
    expect((await mediaPresence({ entries: [entry("kurs/andere.mp4")] })).missing).toEqual([
      "kurs/andere.mp4 (no media row)",
    ]);
  });
});

// ── The state the row count cannot see ──────────────────────────────────────
describe("🚨 a row whose object is not in the store", () => {
  const one = { entries: [entry("kurs/intro.mp4")] };

  beforeEach(() => rows.mockResolvedValue(stored("kurs/intro.mp4")));

  it("is a FINDING that names the file and says the OBJECT is what is gone", async () => {
    // The measured defect, inverted. Row there, bucket emptied: this used to be
    // `found: 1, expected: 1, missing: undefined` — `✓ 1 of 1`, exit 0.
    head.mockResolvedValue(null);

    const item = await mediaPresence(one);

    expect(item.found).toBe(0);
    expect(item.expected).toBe(1);
    expect(item.missing).toEqual(["kurs/intro.mp4 (a media row, but no object in the store)"]);
    // It is a finding, not a skip: nobody may read this as "not checked".
    expect(item.notChecked).toBeUndefined();
  });

  it("🚨 THE NEEDLE: it asks the store, by the deterministic key, once per row", async () => {
    // Red the moment the HEAD goes away again — no injected store, no seam: the
    // module the app really resolves is the one that has to be called.
    rows.mockResolvedValue(stored("kurs/intro.mp4", "kurs/cover.png"));

    await mediaPresence({ entries: [entry("kurs/intro.mp4"), entry("kurs/cover.png")] });

    expect(head).toHaveBeenCalledTimes(2);
    expect(head).toHaveBeenCalledWith(keyOf("kurs/intro.mp4"));
    expect(head).toHaveBeenCalledWith(keyOf("kurs/cover.png"));
  });

  it("does not spend a round-trip on a declared file that has no row", async () => {
    // It is already on the `missing` list; asking the store buys nothing and
    // costs one request per file in an app that declares fifty.
    rows.mockResolvedValue(stored("kurs/intro.mp4"));

    const item = await mediaPresence({
      entries: [entry("kurs/intro.mp4"), entry("kurs/fehlt.mp4")],
    });

    expect(head).toHaveBeenCalledTimes(1);
    expect(head).toHaveBeenCalledWith(keyOf("kurs/intro.mp4"));
    expect(item.missing).toEqual(["kurs/fehlt.mp4 (no media row)"]);
  });

  it("says in the note how many objects were REALLY asked for", async () => {
    // A tick with no number behind it is the claim this change removed.
    const item = await mediaPresence(one);

    expect(item.note).toContain("1 of 1 declared object(s) asked by HEAD");
    expect(item.note).toContain("1 present");
  });

  it("asks nothing at all when no declared file has a row, and says so", async () => {
    rows.mockResolvedValue([]);

    const item = await mediaPresence(one);

    expect(head).not.toHaveBeenCalled();
    // Not a `notChecked`: every declared file is already a named finding, so
    // there is no tick for an unasked question to hide under.
    expect(item.notChecked).toBeUndefined();
    expect(item.missing).toEqual(["kurs/intro.mp4 (no media row)"]);
    expect(item.note).toContain("nothing to ask");
  });
});

// ── The third state ─────────────────────────────────────────────────────────
describe("🚨 the store did not answer — neither a tick nor a finding", () => {
  const one = { entries: [entry("kurs/intro.mp4")] };

  beforeEach(() => rows.mockResolvedValue(stored("kurs/intro.mp4")));

  it("no store configured is `notChecked`, and NEVER a missing object", async () => {
    // A HEAD that reports "missing" on an unconfigured store would be worse
    // than no HEAD at all: it makes the check lie about the customer's content.
    storeProblems.mockReturnValue([
      "MEDIA_DRIVER=s3, but MEDIA_S3_ENDPOINT / MEDIA_S3_BUCKET / … are not all set",
    ]);

    const item = await mediaPresence(one);

    expect(item.missing).toBeUndefined();
    expect(item.notChecked).toContain("the media store was not asked");
    expect(item.notChecked).toContain("MEDIA_S3_ENDPOINT");
    // The row half still answered, and what was never asked stays counted as
    // present-by-row: the item must not SHRINK because nobody looked, or an
    // unreachable bucket would arrive as `0 of 1` — a finding by arithmetic.
    expect(item.found).toBe(1);
    expect(item.expected).toBe(1);
    expect(head).not.toHaveBeenCalled();
  });

  it("a store that stops answering names how many of how many were asked", async () => {
    rows.mockResolvedValue(stored("a/one.mp4", "a/two.mp4", "a/three.mp4"));
    head
      .mockResolvedValueOnce({ bytes: 3 })
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue({ bytes: 3 });

    const item = await mediaPresence({
      entries: [entry("a/one.mp4"), entry("a/two.mp4"), entry("a/three.mp4")],
    });

    // It stops rather than retrying every key — the `lib/content/publish.ts`
    // byte loop's contract, and the tail is accounted for rather than dropped.
    expect(head).toHaveBeenCalledTimes(2);
    expect(item.notChecked).toContain("stopped answering after 1 of 3 object(s)");
    expect(item.notChecked).toContain("fetch failed");
    expect(item.missing).toBeUndefined();
    expect(item.found).toBe(3);
  });

  it("keeps an object it already PROVED absent when the store then dies", async () => {
    // The two states coexist, and the finding is the real one. Rewording it as
    // "not checked" because the connection dropped afterwards would lose the
    // one thing this run actually established.
    rows.mockResolvedValue(stored("a/one.mp4", "a/two.mp4"));
    head.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("ECONNRESET"));

    const item = await mediaPresence({ entries: [entry("a/one.mp4"), entry("a/two.mp4")] });

    expect(item.missing).toEqual(["a/one.mp4 (a media row, but no object in the store)"]);
    expect(item.notChecked).toContain("stopped answering after 1 of 2 object(s)");
  });

  it("an injected resolver is the seam, and throwing in it is the same state", async () => {
    // The second parameter exists so a caller can say which store it means;
    // its refusal travels exactly like the configured one's.
    const item = await mediaPresence(one, () => {
      throw new Error("no store in this process");
    });

    expect(item.notChecked).toContain("no store in this process");
    expect(item.missing).toBeUndefined();
  });
});

describe("declaring nothing is legitimate", () => {
  it('answers `0 of 0` for `{ "entries": [] }` and asks the database nothing', async () => {
    const item = await mediaPresence({ entries: [] });

    expect(item).toMatchObject({ found: 0, expected: 0 });
    expect(item.missing).toBeUndefined();
    // 0 expected is not the absent manifest's `null`: the file IS here and
    // names no file. The two states must not collapse into one.
    expect(item.expected).not.toBeNull();
    expect(rows).not.toHaveBeenCalled();
  });
});

describe("a shape it does not understand is a refusal, never `0 of 0`", () => {
  it('🚨 THROWS on `{ "files": [...] }` — the key the old code read', async () => {
    // The assertion that stops the defect returning. Nothing writes `files`;
    // accepting it "to be safe" would restore the silent green tick.
    await expect(
      mediaPresence({ files: [{ path: "kurs/intro.mp4" }] }),
    ).rejects.toThrow(/content\/media-manifest\.json/);
  });

  it("throws on a top level that is not an object, naming the file and the doc", async () => {
    for (const bad of [{}, [], null, "text", 7]) {
      const error = await mediaPresence(bad).catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("content/media-manifest.json");
      expect((error as Error).message).toContain("docs/content.md");
      expect((error as Error).message).toContain('"entries"');
    }
  });

  it("throws when `entries` is not an array, and when an entry has no path", async () => {
    await expect(mediaPresence({ entries: {} })).rejects.toThrow(/"entries" array/);
    await expect(mediaPresence({ entries: [{ pfad: "kurs/intro.mp4" }] })).rejects.toThrow(
      /entries\[0\]/,
    );
  });

  it('says "I could not look", never "there is nothing there"', async () => {
    // The distinction the whole check exists for: an unreadable manifest must
    // reach `safely()` as a throw so the core lands `unanswered`. Answering
    // `{ found: 0 }` here would make it indistinguishable from an app that
    // genuinely ships no media.
    const answer = await mediaPresence({ files: {} }).then(
      (item) => item,
      () => "threw" as const,
    );
    expect(answer).toBe("threw");
  });
});
