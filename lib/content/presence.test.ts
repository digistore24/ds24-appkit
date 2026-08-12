// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 An absent manifest is ANSWERED, not skipped.
//
// The core's product-media branch used to be one `if` with no `else`, so an
// environment with no `content/media-manifest.json` produced no item at all —
// not `unanswered`, not `found: 0`, nothing. `presenceProblems()` was handed
// nothing to complain about and `content-check` printed
// "every owner answered, nothing missing" for a question it had never asked.
// That is the exact fault this file's own rule is written against
// (`presence.ts`, top): if "nothing to report" and "I could not look" render
// the same, the check has become the thing it was built to prevent.
//
// Three states have to stay apart, and each one is a case here:
//
//   no manifest at all          an item, `expected: null`, a note — legitimate
//   a manifest declaring none   `0 of 0` — legitimate
//   a manifest that cannot be read   `unanswered` — a failure
//
// `node:fs` is mocked because the states ARE disk states, and both dynamic
// imports are mocked because `applierPresence()` reaches a database and
// `mediaPresence()` is measured in its own file next door.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONTENT_MEDIA_MANIFEST, PRODUCT_MEDIA_ITEM } from "@/lib/content-media/rules.mjs";

const existsSync = vi.fn<(path: string) => boolean>();
const readFileSync = vi.fn<(path: string, encoding: string) => string>();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => existsSync(path),
  readFileSync: (path: string, encoding: string) => readFileSync(path, encoding),
}));

const mediaPresence = vi.fn();
vi.mock("./media-presence", () => ({ mediaPresence: (m: unknown) => mediaPresence(m) }));

const applierPresence = vi.fn();
vi.mock("./applier-presence", () => ({ applierPresence: () => applierPresence() }));

// No module contributes here; the core's own answer is what is under test.
vi.mock("@/lib/modules/presence-registry", () => ({ MODULE_PRESENCE: [] }));

const { collectPresence, corePresence, presenceProblems } = await import("./presence");
type PresenceItem = Awaited<ReturnType<typeof corePresence.check>>["items"][number];

const productMedia = (items: readonly PresenceItem[]) =>
  items.find((item) => item.what === PRODUCT_MEDIA_ITEM);

beforeEach(() => {
  existsSync.mockReset();
  readFileSync.mockReset();
  mediaPresence.mockReset();
  applierPresence.mockReset();
  applierPresence.mockResolvedValue([]);
});

describe("no manifest on disk", () => {
  beforeEach(() => existsSync.mockReturnValue(false));

  it("produces an item for product media rather than a silence", async () => {
    const report = await corePresence.check({ appEnv: "production" });

    const item = productMedia(report.items);
    expect(item, "the product media item is missing from the core's report entirely").toBeDefined();
    expect(item).toMatchObject({ what: PRODUCT_MEDIA_ITEM, found: 0, expected: null });
  });

  it("names what it looked for and where", async () => {
    const item = productMedia((await corePresence.check({ appEnv: "production" })).items);

    // The relative path, in words an operator recognises — "0" on its own says
    // nothing about what was looked for.
    expect(item?.note).toContain(CONTENT_MEDIA_MANIFEST);
  });

  it("is distinguishable from a manifest that declares nothing", async () => {
    const absent = productMedia((await corePresence.check({ appEnv: "production" })).items);

    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('{"entries":[]}');
    mediaPresence.mockResolvedValue({ what: PRODUCT_MEDIA_ITEM, found: 0, expected: 0 });
    const empty = productMedia((await corePresence.check({ appEnv: "production" })).items);

    // Both are legitimate and both are `found: 0`. `expected` is what tells
    // "nothing declares a count here" from "the declaration is here and names
    // no file", and it must not collapse.
    expect(absent?.expected).toBeNull();
    expect(empty?.expected).toBe(0);
    expect(absent?.expected).not.toBe(empty?.expected);
  });

  it("🚨 is not a problem — run through the real aggregator, not inspected", async () => {
    // "the shape cannot be a problem" is a statement about `presenceProblems()`
    // and not about the item, so the item goes through the real function —
    // the argument `modules/courses/presence/check.test.ts` writes out.
    const report = await corePresence.check({ appEnv: "production" });

    expect(presenceProblems([report])).toEqual([]);
  });

  it("the note is a word for a reader — `presenceProblems()` never reads it", async () => {
    // Deliberately unchanged: three ways to fail, and the note is not a fourth.
    const noisy = {
      owner: "core",
      items: [
        { what: PRODUCT_MEDIA_ITEM, found: 0, expected: null, note: "no manifest here" },
        { what: "courses", found: 0, expected: null, note: "nothing at all, really" },
      ],
    };

    expect(presenceProblems([noisy])).toEqual([]);
  });

  it("🚨 nor `notChecked` — a question nobody asked is not a finding", async () => {
    // The half of the design that keeps the HEAD honest. A store that did not
    // answer has said NOTHING about the customer's content, so turning it into
    // a problem would put a red cross on every app whose bucket blinked. It
    // stays visible where the answer is printed (`scripts/content/check.mjs`
    // marks it `⏭` and the verdict counts it), never here.
    const unreachable = {
      owner: "core",
      items: [
        {
          what: PRODUCT_MEDIA_ITEM,
          found: 3,
          expected: 3,
          note: "media store: 0 of 3 declared object(s) asked by HEAD, 0 present",
          notChecked: "the media store was not asked — MEDIA_S3_BUCKET is not set",
        },
      ],
    };

    expect(presenceProblems([unreachable])).toEqual([]);
  });
});

describe("a manifest that is there", () => {
  it("is the item mediaPresence() returned, and carries no note", async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('{"entries":[{"path":"kurs/intro.mp4"}]}');
    mediaPresence.mockResolvedValue({ what: PRODUCT_MEDIA_ITEM, found: 1, expected: 1 });

    const item = productMedia((await corePresence.check({ appEnv: "production" })).items);

    expect(mediaPresence).toHaveBeenCalledWith({ entries: [{ path: "kurs/intro.mp4" }] });
    expect(item).toMatchObject({ found: 1, expected: 1 });
    expect(item?.note).toBeUndefined();
  });
});

describe("a manifest that cannot be read", () => {
  it("is `unanswered`, and NOT the absent-manifest item", async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue("{ this is not json");

    const [core] = await collectPresence({ appEnv: "production" });

    expect(core.owner).toBe("core");
    expect(core.unanswered, "a parse failure stopped being a refusal").toBeTruthy();
    // The inversion this story must not commit: "I do not understand this file"
    // is "I could not look", never "there is nothing there".
    expect(productMedia(core.items)).toBeUndefined();
    expect(presenceProblems([core])).toHaveLength(1);
  });

  it("a shape mediaPresence() refuses lands there too", async () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('{"files":[]}');
    mediaPresence.mockRejectedValue(new Error(`${CONTENT_MEDIA_MANIFEST}: no "entries" array`));

    const [core] = await collectPresence({ appEnv: "production" });

    expect(core.unanswered).toContain(CONTENT_MEDIA_MANIFEST);
    expect(productMedia(core.items)).toBeUndefined();
  });
});
