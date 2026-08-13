// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `content_media_url` and `content_media_confirm` — the staged leg's two acts.
//
// The claim being measured is the one the whole epic rests on: a file too big
// for the repo reaches the environment's bucket, its row reaches that
// environment's database, and no bucket credential was ever on the operator's
// machine. Only the first half of that can be measured without a real bucket, so
// what is asserted here is everything the app itself decides:
//
//   · a path the manifest does not declare is refused (the key space is closed)
//   · an object already there with the declared length is FOUND, not re-minted
//   · a store that cannot mint says so BY NAME — never an empty answer
//   · a wrong length and a wrong kind are refused, and the object is REMOVED
//   · nothing landed is a refusal, and never a row for bytes that do not exist
//   · the confirm step never claims to have verified the sha256
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
// Through the REGISTRY: `tools.ts` and `registry.ts` import each other, and
// entering the cycle at `tools.ts` leaves `ALL_SETUP_TOOLS` spreading a
// `CORE_SETUP_TOOLS` still in its temporal dead zone.
import { toolsByName } from "./registry";

const ENTRY = {
  path: "kurs-basics/intro.mp4",
  key: "content/kurs-basics/intro.mp4",
  kind: "video",
  contentType: "video/mp4",
  visibility: "entitled",
  planKeys: ["course_complete"],
  alt: null,
  filename: "intro.mp4",
  bytes: 15_728_640,
  sha256: "a".repeat(64),
};

const { loadManifest, store, assertContentMediaRow } = vi.hoisted(() => ({
  loadManifest: vi.fn(),
  store: {
    head: vi.fn(),
    firstBytes: vi.fn(),
    remove: vi.fn(),
    createUploadUrl: vi.fn(),
  },
  assertContentMediaRow: vi.fn(),
}));

vi.mock("@/scripts/content/_manifest.mjs", async (importOriginal) => ({
  // 🚨 `keyFor()` stays REAL. It is the one spelling of the content key, and a
  // mocked one would make every assertion below true of a key this app does not
  // use — which is precisely the drift `writers.test.ts` exists to prevent.
  ...((await importOriginal()) as Record<string, unknown>),
  loadManifest,
}));
vi.mock("@/lib/media/store", () => ({ mediaStore: () => store }));
vi.mock("@/lib/content/publish", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  assertContentMediaRow,
}));

const mint = toolsByName().get("content_media_url")!;
const confirm = toolsByName().get("content_media_confirm")!;

const APPLY = { appEnv: "production", ownerId: "owner-1", mode: "apply" } as const;
const PLAN = { appEnv: "production", ownerId: "owner-1", mode: "plan" } as const;

/** The first sixteen bytes of a real MP4 — `ftypisom`, what `sniff.ts` reads. */
const MP4_HEAD = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
]);
/** A PNG's, for the file that was renamed rather than converted. */
const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

beforeEach(() => {
  vi.clearAllMocks();
  loadManifest.mockReturnValue({ entries: [ENTRY], problems: [] });
  store.head.mockResolvedValue(null);
  store.firstBytes.mockResolvedValue(MP4_HEAD);
  store.remove.mockResolvedValue(undefined);
  store.createUploadUrl.mockReturnValue("https://bucket.example.com/content/x?X-Amz-Signature=…");
  assertContentMediaRow.mockResolvedValue({ created: true, key: ENTRY.key });
});

async function refusalOf(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const err = error as Error & { code?: string };
    return { code: String(err.code), message: err.message };
  }
  throw new Error("expected a refusal, and none was thrown");
}

describe("🚨 the key space is the manifest's, and nothing wider", () => {
  it("refuses a path the manifest does not declare", async () => {
    const refused = await refusalOf(() => mint.run(APPLY, { path: "somewhere/else.mp4" }));

    expect(refused.code).toBe("contentMediaUndeclared");
    // The whole reason: without it, `path` is a key space a caller names.
    expect(refused.message).toContain("content/media-manifest.json");
  });

  it("refuses when the manifest itself does not judge", async () => {
    loadManifest.mockReturnValue({ entries: [], problems: ['entries[0]: "x" violates the naming standard'] });

    const refused = await refusalOf(() => mint.run(APPLY, { path: ENTRY.path }));
    expect(refused.code).toBe("contentManifestInvalid");
    expect(refused.message).toContain("violates the naming standard");
  });

  it("refuses an entry with no recorded sha256/bytes, and names content-media-sync", async () => {
    // The manifest records both for staged files; without them nothing here can
    // check what landed, and the row would carry invented numbers.
    loadManifest.mockReturnValue({ entries: [{ ...ENTRY, bytes: null, sha256: null }], problems: [] });

    const refused = await refusalOf(() => confirm.run(APPLY, { path: ENTRY.path }));
    expect(refused.code).toBe("contentMediaUnrecorded");
    expect(refused.message).toContain("node run.mjs content-media-sync --apply");
  });

  it("composes the key through keyFor(), so it is the applier route's own prefix", async () => {
    await mint.run(APPLY, { path: ENTRY.path });
    expect(store.head).toHaveBeenCalledWith("content/kurs-basics/intro.mp4");
  });
});

describe("content_media_url — three answers, and none of them is empty", () => {
  it("① already there with the declared length: found, and nothing minted", async () => {
    store.head.mockResolvedValue({ bytes: ENTRY.bytes });

    const result = await mint.run(APPLY, { path: ENTRY.path });

    expect(store.createUploadUrl).not.toHaveBeenCalled();
    expect(result.found).toBe(1);
    // The audit's `rows` is created + changed: minting is not a row.
    expect(result.created + result.changed).toBe(0);
    expect((result.data as Record<string, unknown>).found).toBe(true);
    expect((result.data as Record<string, unknown>).upload).toBeNull();
    expect(result.detail).toContain("already in this environment's store");
  });

  it("② the store can mint: an address, its expiry and the length expected", async () => {
    const result = await mint.run(APPLY, { path: ENTRY.path });

    expect(store.createUploadUrl).toHaveBeenCalledWith("content/kurs-basics/intro.mp4", 3600);
    const upload = (result.data as { upload: Record<string, unknown> }).upload;
    expect(upload.url).toContain("X-Amz-Signature");
    expect(upload.bytes).toBe(ENTRY.bytes);
    expect(String(upload.expiresAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 🚨 The address is in `data`, which travels back over HTTPS — and never in
    // `detail`, which is what an operator and an agent read back.
    expect(result.detail).not.toContain("X-Amz-Signature");
    expect(result.subjects).toEqual([ENTRY.path]);
  });

  it("③ the store cannot mint: a NAMED refusal with both ways out", async () => {
    store.createUploadUrl.mockReturnValue(null);

    const result = await mint.run(APPLY, { path: ENTRY.path });
    const data = result.data as { found: boolean; upload: null; reason: string };

    // 🚨 Never an empty answer that reads like "nothing to do". The local driver
    // has no address anything but the app can reach, and DEV routinely runs it.
    expect(data.found).toBe(false);
    expect(data.upload).toBeNull();
    expect(data.reason).toContain("content-media-sync");
    expect(data.reason).toContain("S3 driver");
    expect(result.detail).toContain("no address");
  });

  it("mints nothing in plan mode — a plan does not hand out a capability", async () => {
    const result = await mint.run(PLAN, { path: ENTRY.path });

    expect(store.createUploadUrl).not.toHaveBeenCalled();
    expect(result.mode).toBe("plan");
    expect((result.data as { upload: null }).upload).toBeNull();
  });

  it("an object of the WRONG length is not 'found' — the address overwrites it", async () => {
    store.head.mockResolvedValue({ bytes: 12 });

    const result = await mint.run(APPLY, { path: ENTRY.path });

    expect(result.found).toBe(0);
    expect(store.createUploadUrl).toHaveBeenCalled();
    expect(result.detail).toContain("12 byte(s)");
    expect(result.detail).toContain(String(ENTRY.bytes));
  });
});

describe("🚨 content_media_confirm — a bad landing is refused AND undone", () => {
  it("nothing landed: refused by name, nothing removed, no row", async () => {
    store.head.mockResolvedValue(null);

    const refused = await refusalOf(() => confirm.run(APPLY, { path: ENTRY.path }));

    expect(refused.code).toBe("contentMediaMissing");
    expect(refused.message).toContain("nothing landed at content/kurs-basics/intro.mp4");
    expect(store.remove).not.toHaveBeenCalled();
    expect(assertContentMediaRow).not.toHaveBeenCalled();
  });

  it("a wrong length: BOTH numbers, the object removed, no row", async () => {
    store.head.mockResolvedValue({ bytes: 4096 });

    const refused = await refusalOf(() => confirm.run(APPLY, { path: ENTRY.path }));

    expect(refused.code).toBe("contentMediaLengthMismatch");
    expect(refused.message).toContain("4096");
    expect(refused.message).toContain(String(ENTRY.bytes));
    // An object of the wrong length under a deterministic key is worse than
    // none: the next content-check would HEAD it and call the file present.
    expect(store.remove).toHaveBeenCalledWith("content/kurs-basics/intro.mp4");
    expect(assertContentMediaRow).not.toHaveBeenCalled();
  });

  it("a wrong kind: the BYTES decide, the object removed, no row", async () => {
    store.head.mockResolvedValue({ bytes: ENTRY.bytes });
    store.firstBytes.mockResolvedValue(PNG_HEAD);

    const refused = await refusalOf(() => confirm.run(APPLY, { path: ENTRY.path }));

    expect(refused.code).toBe("contentMediaTypeMismatch");
    expect(store.remove).toHaveBeenCalledWith("content/kurs-basics/intro.mp4");
    expect(assertContentMediaRow).not.toHaveBeenCalled();
  });

  it("removes a bad landing in PLAN mode too — a plan that left it would lie", async () => {
    store.head.mockResolvedValue({ bytes: 4096 });

    await refusalOf(() => confirm.run(PLAN, { path: ENTRY.path }));

    expect(store.remove).toHaveBeenCalledWith("content/kurs-basics/intro.mp4");
  });

  it("sniffs sixteen bytes, never the whole object", async () => {
    store.head.mockResolvedValue({ bytes: ENTRY.bytes });
    await confirm.run(APPLY, { path: ENTRY.path });

    expect(store.firstBytes).toHaveBeenCalledWith("content/kurs-basics/intro.mp4", 16);
    // `getBytes()` would pull two gigabytes into the process and give away
    // everything the direct address bought.
    expect(store).not.toHaveProperty("getBytes.mock");
  });
});

describe("content_media_confirm — the row, and what it does NOT claim", () => {
  beforeEach(() => store.head.mockResolvedValue({ bytes: ENTRY.bytes }));

  it("asserts the row from the manifest entry and reports one row", async () => {
    const result = await confirm.run(APPLY, { path: ENTRY.path });

    expect(assertContentMediaRow).toHaveBeenCalledWith(ENTRY);
    expect(result.created).toBe(1);
    expect(result.created + result.changed).toBe(1);
    expect(result.subjects).toEqual([ENTRY.path]);
    expect(result.detail).toContain("media row created");
    expect(result.detail).toContain("entitled");
  });

  it("re-asserting the same row is one CHANGE, not a second creation", async () => {
    assertContentMediaRow.mockResolvedValue({ created: false, key: ENTRY.key });

    const result = await confirm.run(APPLY, { path: ENTRY.path });

    expect(result.created).toBe(0);
    expect(result.changed).toBe(1);
    expect(result.detail).toContain("re-asserted");
  });

  it("🚨 never says the sha256 was verified — in the answer or in the code", async () => {
    const result = await confirm.run(APPLY, { path: ENTRY.path });
    const data = result.data as { verified: string[]; trusted: string[] };

    // What was measured against the object, and what is the operator's own
    // recorded claim. Verifying the hash would mean reading the object back,
    // which is the whole cost this path exists to avoid.
    expect(data.verified).toEqual(["bytes", "kind"]);
    expect(data.trusted).toEqual(["sha256"]);
    expect(result.detail.toLowerCase()).not.toContain("sha");
    expect(result.detail.toLowerCase()).not.toContain("verified");

    const source = blankComments(
      readFileSync(join(process.cwd(), "lib", "setup", "tools.ts"), "utf8"),
    );
    // Read against the code rather than asserted about it: the tool must not
    // hash anything, so the module cannot be reaching for a digest at all.
    expect(/createHash|digest\(/.test(source), "a content tool hashes the object").toBe(false);
  });

  it("writes the row through lib/content/publish.ts, never in this file", () => {
    const source = blankComments(
      readFileSync(join(process.cwd(), "lib", "setup", "tools.ts"), "utf8"),
    );
    // `writers.test.ts` fails the build on a `storageKey:` in an upload door,
    // and a media row insert spells exactly that. The insert therefore lives on
    // the applier route's side of the partition.
    expect(source).not.toMatch(/insert\s+into\s+media/i);
    expect(source).toContain("assertContentMediaRow");
  });
});

describe("🚨 no byte of a lesson video comes near the model", () => {
  it("needs no branch in the MCP server, unlike media_upload", () => {
    // AD-85's stronger form. `media_upload` takes a PATH ON THE OPERATOR'S
    // MACHINE and the MCP server reads that file so the bytes travel as a form
    // part rather than through the model. These two never read a local file at
    // all — the bytes go from the operator's machine straight to the bucket —
    // so the server needs no entry for them, and its ONE file-reading branch
    // must stay the one it has.
    const server = blankComments(
      readFileSync(join(process.cwd(), "scripts", "mcp", "server.mjs"), "utf8"),
    );

    const readers = [...server.matchAll(/name === "([a-z_]+)"/g)].map((match) => match[1]);
    expect(readers).toContain("media_upload");
    expect(readers).not.toContain("content_media_url");
    expect(readers).not.toContain("content_media_confirm");
    // One `readFile` in that file, and it belongs to `media_upload`.
    expect(server.match(/\breadFile\(/g)?.length ?? 0).toBe(1);
  });
});
