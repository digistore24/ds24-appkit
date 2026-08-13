// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The second way in — minting an address, and reading back what landed.
//
// ── Why a file of its own rather than more of `manage.test.ts` ─────────────
// That file's mock is shaped for `mayAccess()` and the deletion path, and four
// existing assertions lean on its exact shape. The confirm step needs a store
// that answers `head()` and `firstBytes()` and a `media_uploads` row coming
// back from a select — a different fixture, and grafting it on would put both
// sets of assertions at the mercy of one mock.
//
// ── What is faked, and what is emphatically not ────────────────────────────
// The database and the bucket are mocked. **The sniffer is not.** The whole
// claim of this path is "the type comes from the object's first bytes, never
// from what the client said", and checking that against a stubbed
// `agreedMime()` would be checking the claim by assuming it. So the fixtures
// are real byte signatures, the same ones `sniff.test.ts` uses.
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const remove = vi.fn<(key: string) => Promise<void>>();
const head = vi.fn<(key: string) => Promise<{ bytes: number } | null>>();
const firstBytes = vi.fn<(key: string, n: number) => Promise<Uint8Array | null>>();
const createUploadUrl = vi.fn<(key: string, seconds: number) => string | null>();
const copy = vi.fn<(from: string, to: string, contentType: string) => Promise<void>>();

const selectRows = vi.fn<() => Promise<unknown[]>>();
const deletedWhere = vi.fn();
const insertedValues = vi.fn();
/** What a `db.update()` set, and what the conditional claim gave back. */
const updatedSet = vi.fn();
const claimRows = vi.fn<() => Promise<unknown[]>>();

vi.mock("./store", () => ({
  mediaStore: () => ({
    driver: "s3",
    remove,
    head,
    firstBytes,
    createUploadUrl,
    copy,
    put: vi.fn(),
    getBytes: vi.fn(),
    publicUrl: () => null,
    signedUrl: () => null,
  }),
}));

vi.mock("@/lib/entitlements/manage", () => ({ hasPlan: vi.fn(async () => true) }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectRows();
          return Object.assign(rows, {
            limit: () => rows,
            orderBy: () => ({ limit: () => rows }),
          });
        },
      }),
    }),
    delete: () => ({
      where: (condition: unknown) => {
        deletedWhere(condition);
        return Promise.resolve();
      },
    }),
    insert: () => ({
      // Recorded in `values()` and not only in `returning()`. The mint path
      // writes its ticket row without asking for it back, so a recorder that
      // only fired on `returning()` left every field of that row — `ownerId`,
      // `expiresAt`, `visibility`, `claimedMime` — unlooked-at by any test.
      values: (values: Record<string, unknown>) => {
        insertedValues(values);
        return {
          returning: () => Promise.resolve([values]),
          then: (resolve: (value: unknown) => unknown) => resolve(undefined),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updatedSet(values);
        return {
          where: () => {
            const rows = claimRows();
            return Object.assign(rows, { returning: () => rows });
          },
        };
      },
    }),
  },
}));

const { confirmUpload, createUploadTicket, pruneAbandonedUploads } = await import("./manage");
const { MediaError, UPLOAD_TICKET_SECONDS, stagingKey, storageKey } = await import("./rules");

/** The real signatures, as `sniff.test.ts` builds them. */
function bytes(...parts: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else for (const char of part) out.push(char.charCodeAt(0));
  }
  return new Uint8Array(out);
}
const MP4 = bytes(0, 0, 0, 0x20, "ftypisom");
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

/**
 * The slot every call in this file mints and confirms for.
 *
 * 🚨 **It is the same pair on both halves on purpose, and one test below is
 * about what happens when it is not.** The slot is recorded on the ticket at
 * mint time and the confirming door has to name it again, because there is more
 * than one door minting tickets for the same owner — so a member who mints at
 * the generic HTTP door and confirms at a module's action is the hole that pair
 * closes.
 */
const SLOT = { namespace: "core", category: "upload" } as const;

const TICKET = {
  id: "ticket-1",
  ownerId: "alice",
  // 🚨 The STAGING key. This is where the browser's presigned address points,
  // and it is deliberately not where the item is served from.
  storageKey: "pending/2026/08/ticket-1.mp4",
  // The slot the DELIVERY key is built from — recorded here rather than
  // re-derived an hour later by whichever door happens to confirm.
  namespace: SLOT.namespace,
  category: SLOT.category,
  kind: "video" as const,
  claimedMime: "video/mp4",
  filename: "lektion-7.mp4",
  visibility: "owner" as const,
  planKeys: [],
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null as Date | null,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  createUploadUrl.mockReturnValue("https://bucket.example/pending/2026/08/ticket-1.mp4?X-Amz-…");
  selectRows.mockResolvedValue([TICKET]);
  claimRows.mockResolvedValue([{ id: TICKET.id }]);
  head.mockResolvedValue({ bytes: 900_000_000 });
  firstBytes.mockResolvedValue(MP4);
  copy.mockResolvedValue(undefined);
  // `clearAllMocks()` clears calls, not implementations — a `mockRejectedValue`
  // from one test otherwise leaks into every test after it, and the leak reads
  // as a finding about the code.
  remove.mockResolvedValue(undefined);
});

describe("minting an address", () => {
  it("derives the key and never takes one", async () => {
    const ticket = await createUploadTicket({
      ownerId: "alice",
      role: "owner",
      ...SLOT,
      claimedMime: "video/mp4",
      filename: "lektion-7.mp4",
      declaredBytes: 900_000_000,
    });

    // The key handed to the store is derived from an id this app minted, and
    // the response carries the TICKET id, never the key.
    //
    // 🚨 **And it is a `pending/` key, not a delivery key.** A presigned PUT
    // stays writable until it expires, so an address on the delivery key would
    // make every check in `confirmUpload()` true of one moment only: confirm a
    // one-kilobyte MP4, then push a gigabyte or a GPS-bearing JPEG onto the same
    // address. Nothing serves this prefix.
    const [key, seconds] = createUploadUrl.mock.calls[0]!;
    expect(key).toMatch(/^pending\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp4$/);
    expect(seconds).toBe(UPLOAD_TICKET_SECONDS);
    expect(ticket.url).toContain("X-Amz");
    expect(JSON.stringify(ticket)).not.toContain(key);
  });

  it("writes the ticket row it says it wrote", async () => {
    // The row's own fields, and no test looked at any of them: the mint path
    // does not call `.returning()`, so a recorder wired only to that saw
    // nothing. Swapping `ownerId` and `filename` stayed green.
    const before = Date.now();
    const ticket = await createUploadTicket({
      ownerId: "alice",
      role: "owner",
      ...SLOT,
      claimedMime: "video/mp4",
      filename: "lektion-7.mp4",
      declaredBytes: 900_000_000,
    });

    const values = insertedValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.id).toBe(ticket.ticketId);
    expect(values.ownerId).toBe("alice");
    expect(values.claimedMime).toBe("video/mp4");
    expect(values.filename).toBe("lektion-7.mp4");
    expect(values.kind).toBe("video");
    // The caller decides visibility; the HTTP door pins `owner`, and a form
    // never reaches this field at all.
    expect(values.visibility).toBe("owner");
    expect(values.storageKey).toBe(createUploadUrl.mock.calls[0]![0]);
    // The window is the ticket's, not something a caller chose — and it is
    // bracketed by BOTH clock readings rather than one. `expiresAt` is computed
    // from a `Date.now()` taken inside the call, so measuring it against
    // `before` alone adds however long the call took: the upper bound went red
    // the moment a run crossed a millisecond boundary, which is roughly every
    // third run (measured). Two references, no slack, no flake.
    const after = Date.now();
    const expiresAt = (values.expiresAt as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + UPLOAD_TICKET_SECONDS * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + UPLOAD_TICKET_SECONDS * 1000);
  });

  it("🚨 refuses an image, because the strip needs the bytes in this process", async () => {
    // `docs/data-protection.md` §14 promises location data comes off uploaded
    // images. An object the browser wrote straight to the bucket was never in
    // this process, so the promise can only hold by not taking the kind.
    await expect(
      createUploadTicket({
        ownerId: "alice",
        role: "owner",
        ...SLOT,
        claimedMime: "image/jpeg",
        filename: "urlaub.jpg",
        declaredBytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "kindNotDirect" });
  });

  it("refuses a type this installation does not take at all", async () => {
    await expect(
      createUploadTicket({
        ownerId: "alice",
        role: "owner",
        ...SLOT,
        claimedMime: "application/x-msdownload",
        filename: "setup.exe",
        declaredBytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "typeNotAllowed" });
  });

  it("says what is missing when the driver cannot mint", async () => {
    // The local driver answers null. That is DEV, not a broken store, and the
    // message has to be the one that names the fix.
    createUploadUrl.mockReturnValue(null);
    await expect(
      createUploadTicket({
        ownerId: "alice",
        role: "owner",
        ...SLOT,
        claimedMime: "video/mp4",
        filename: null,
        declaredBytes: 1000,
      }),
    ).rejects.toMatchObject({ code: "storeUnavailable" });
    await expect(
      createUploadTicket({
        ownerId: "alice",
        role: "owner",
        ...SLOT,
        claimedMime: "video/mp4",
        filename: null,
        declaredBytes: 1000,
      }),
    ).rejects.toThrow(/MEDIA_DRIVER=s3/);
  });
});

describe("confirming what landed", () => {
  it("writes the row with the ticket's own id, a DELIVERY key, and no hash", async () => {
    const row = await confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" });

    expect(row).toMatchObject({ id: TICKET.id });
    const values = insertedValues.mock.calls[0]![0] as Record<string, unknown>;
    // The MEASURED length, not anything the client said.
    expect(values.bytes).toBe(900_000_000);
    // 🚨 Null rather than an invented hash: this app never held the bytes.
    expect(values.sha256).toBeNull();
    expect(values.mime).toBe("video/mp4");
    // 🚨 NOT the key the browser wrote to. `storageKey()`'s shape, derived from
    // the same id and from the type the BYTES turned out to be.
    expect(values.storageKey).not.toBe(TICKET.storageKey);
    // …and it carries the TICKET's slot rather than the kind the bytes turned
    // out to be. The kind is on the row (`values.kind`); the key answers whose
    // object it is, which is the question nobody could answer before.
    expect(values.storageKey).toMatch(/^core\/upload\/\d{4}\/\d{2}\/ticket-1\.mp4$/);
  });

  it("🚨 copies the object server-side and hands the type IT measured", async () => {
    // The whole of the fix. Without this the row points at the key the client
    // still holds a live write address for, and every check above is a
    // statement about one moment: a 1 KB MP4 confirmed, then a gigabyte pushed
    // onto the same address, and `media.bytes` still says 1 KB.
    await confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" });

    const values = insertedValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(copy).toHaveBeenCalledWith(TICKET.storageKey, values.storageKey, "video/mp4");
    // And the staging object goes, best effort, once the row exists.
    expect(remove).toHaveBeenCalledWith(TICKET.storageKey);
  });

  it("🚨 spends the ticket exactly once — the second confirm writes nothing", async () => {
    // Two confirms with one id both pass every check above. Before the
    // conditional claim, the second lost on the primary key and its clean-up
    // removed the object the FIRST had just written a row for: the caller got a
    // 502, the row stayed, the bytes were gone.
    claimRows.mockResolvedValue([]);

    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "uploadTicketInvalid" });

    expect(copy).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("🚨 a ticket already redeemed is refused before the bucket is touched", async () => {
    // The same claim seen from the row rather than from the race — and the one
    // that closes the replay. The address stays writable for the rest of the
    // hour; what must never happen again is a copy from it.
    selectRows.mockResolvedValue([{ ...TICKET, consumedAt: new Date() }]);
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "uploadTicketInvalid" });
    expect(head).not.toHaveBeenCalled();
  });

  it("hands a ticket back when the copy fails, because nothing was written", async () => {
    copy.mockRejectedValue(new Error("bucket said no"));
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toThrow(/bucket said no/);
    // Claimed, then released: a bucket hiccup must not cost the member an
    // upload they would have to start again.
    expect(updatedSet.mock.calls.map((c) => c[0].consumedAt)).toEqual([
      expect.any(Date),
      null,
    ]);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it("🚨 an image sent through a video ticket does not get through", async () => {
    // The one that matters, and the code is worth knowing: `agreedMime()`
    // catches it one step BEFORE the kind check, because bytes that sniff to
    // `image/jpeg` disagree with a claim of `video/mp4` — so the answer is
    // `typeMismatch`, which is also the truer sentence (the client lied about
    // the type). Story 8.1's AC 5 predicted `kindNotDirect`; what the AC is
    // actually about — an image must not reach the bucket path by lying on the
    // form — holds either way, and the object does not stay behind.
    firstBytes.mockResolvedValue(JPEG);
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "typeMismatch" });
    expect(remove).toHaveBeenCalledWith(TICKET.storageKey);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it("🚨 and an honest image claim is refused at the kind, not waved through", async () => {
    // Where `kindNotDirect` is genuinely reached at confirm time. Minting
    // refuses an image claim outright, so no ticket like this can be made
    // through the shipped door today — which is exactly why the check is here
    // as well: a ticket row that predates a config change, or a future caller
    // that mints one differently, must still meet the promise in
    // `docs/data-protection.md` §14 rather than the absence of a mint-time
    // refusal. Defence in depth, and it is tested rather than asserted.
    selectRows.mockResolvedValue([
      { ...TICKET, kind: "image", claimedMime: "image/jpeg", storageKey: "pending/2026/08/t.jpg" },
    ]);
    head.mockResolvedValue({ bytes: 4096 });
    firstBytes.mockResolvedValue(JPEG);

    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "kindNotDirect" });
    expect(remove).toHaveBeenCalledWith("pending/2026/08/t.jpg");
    expect(insertedValues).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("refuses an oversized object at the measured length and removes it", async () => {
    head.mockResolvedValue({ bytes: 3 * 1024 * 1024 * 1024 });
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "tooLarge" });
    expect(remove).toHaveBeenCalledWith(TICKET.storageKey);
    expect(insertedValues).not.toHaveBeenCalled();
  });

  it("says the object never arrived, which is not the same as an empty request", async () => {
    head.mockResolvedValue(null);
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "uploadMissing" });
    expect(remove).not.toHaveBeenCalled();
    // 🚨 **And the row STAYS.** `head() === null` means "nothing there now",
    // not "nothing coming": a PUT still in flight, a confirm from a second tab,
    // a provider without read-after-write consistency. The row is the only
    // record that this ticket's staging object may exist — deleting it here
    // stranded whatever landed a second later where nothing could find it.
    expect(deletedWhere).not.toHaveBeenCalled();
  });

  it("🚨 a refusal keeps the ticket row, so a later write is still collectable", async () => {
    // The rule this path states twice and used to break three times: the row is
    // the only record that the object exists. The address is live for the rest
    // of the hour, so a member refused at 12:01 can write again at 12:02 — with
    // no row, that object is in the bucket for good.
    head.mockResolvedValue({ bytes: 3 * 1024 * 1024 * 1024 });
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "tooLarge" });
    expect(remove).toHaveBeenCalledWith(TICKET.storageKey);
    expect(deletedWhere).not.toHaveBeenCalled();
  });

  it("🚨 refuses a ticket minted for a DIFFERENT slot, and touches nothing", async () => {
    // ── The hole the recorded slot closes ────────────────────────────────────
    // More than one door mints tickets for the same owner. Before the slot was
    // compared, an operator could mint at `POST /api/media/upload-url` — which
    // pins `core`/`upload` — and redeem the ticket at the courses video action,
    // landing an object in that module's key space through a door that never
    // agreed to it. The doors already re-ask about the VISIBILITY for exactly
    // this reason; this is the same question about WHERE the bytes go, and it is
    // asked once in the core so every door gets it.
    selectRows.mockResolvedValue([{ ...TICKET, namespace: "courses", category: "video" }]);

    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "uploadTicketInvalid" });

    // The same three properties the other refusals of this class have: no read
    // from the bucket, no copy, no row, and the ticket unspent — so the door
    // that really minted it can still redeem it.
    expect(head).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(insertedValues).not.toHaveBeenCalled();
    expect(updatedSet).not.toHaveBeenCalled();
  });

  it("🚨 …and it is the SLOT doing that, not the mime or the kind", async () => {
    // Non-vacuity for the test above. A ticket differing in nothing but the
    // category must be refused, and one differing in nothing at all must go
    // through — otherwise "refused" above could be any of the four older
    // conditions and the new comparison could be absent entirely.
    selectRows.mockResolvedValue([{ ...TICKET, category: "setup" }]);
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).rejects.toMatchObject({ code: "uploadTicketInvalid" });

    vi.clearAllMocks();
    head.mockResolvedValue({ bytes: 900_000_000 });
    firstBytes.mockResolvedValue(MP4);
    copy.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
    claimRows.mockResolvedValue([{ id: TICKET.id }]);
    selectRows.mockResolvedValue([TICKET]);
    await expect(
      confirmUpload({ ...SLOT, ticketId: "ticket-1", memberId: "alice", role: "owner" }),
    ).resolves.toMatchObject({ id: TICKET.id });
  });

  it("🚨 unknown, expired and somebody else's are ONE answer", async () => {
    const cases: [string, unknown[]][] = [
      ["never minted", []],
      ["expired", [{ ...TICKET, expiresAt: new Date(Date.now() - 1000) }]],
      ["somebody else's", [{ ...TICKET, ownerId: "bob" }]],
      // The fourth, folded into the same answer for the same reason: a ticket
      // minted at another door is not one this door may redeem, and saying so
      // apart from the other three would be an existence oracle with extra
      // steps.
      ["minted for another slot", [{ ...TICKET, namespace: "courses" }]],
    ];
    for (const [name, rows] of cases) {
      selectRows.mockResolvedValue(rows);
      const error = await confirmUpload({
        ticketId: "ticket-1",
        memberId: "alice",
        role: "owner",
        ...SLOT,
      }).catch((e: unknown) => e);
      expect((error as InstanceType<typeof MediaError>).code, name).toBe("uploadTicketInvalid");
    }
    // Nothing was read from the bucket for any of the three: the refusal comes
    // before the object is touched, so a guessed id cannot even be used to ask
    // whether an object exists.
    expect(head).not.toHaveBeenCalled();
  });
});

describe("the sweep for uploads nobody finished", () => {
  it("removes the object before the row, and stops when a page is short", async () => {
    selectRows.mockResolvedValueOnce([TICKET]).mockResolvedValue([]);
    const result = await pruneAbandonedUploads(new Date(), Date.now() + 60_000);

    expect(result).toEqual({ removed: 1, failed: 0, stoppedEarly: false });
    expect(remove).toHaveBeenCalledWith(TICKET.storageKey);
  });

  it("🚨 keeps the row when the object could not be removed", async () => {
    // The `console.error` below is the behaviour under test, not an accident — this
    // test PROVOKES the failure. Silenced so an UNEXPECTED error stays visible in
    // the run's output instead of drowning in expected noise.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    // The row is the only record that the object exists. Dropping it after a
    // failed delete would strand the bytes where nothing can find them again —
    // so the row stays, is counted, and tomorrow's run tries once more.
    remove.mockRejectedValue(new Error("bucket said no"));
    selectRows.mockResolvedValueOnce([TICKET]).mockResolvedValue([]);
    const result = await pruneAbandonedUploads(new Date(), Date.now() + 60_000);

    expect(result).toEqual({ removed: 0, failed: 1, stoppedEarly: false });
    expect(deletedWhere).not.toHaveBeenCalled();
  });

  it("stops inside the batch when the budget runs out, not one batch later", async () => {
    // Every ticket owes a network round trip, so a budget checked only between
    // batches overruns by up to 200 of them on a slow bucket — and the lock
    // this job holds is what the next tick reads (`docs/cron.md`, rule 4).
    selectRows.mockResolvedValue([TICKET, { ...TICKET, id: "ticket-2" }]);
    const result = await pruneAbandonedUploads(new Date(), Date.now() - 1);

    expect(result).toEqual({ removed: 1, failed: 0, stoppedEarly: true });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("gives up after a whole batch of failures rather than growing its query", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    // `stuck` is excluded from the next `select`, one bind parameter per
    // failure — and Postgres refuses a statement past 65 535 of them. An
    // unreachable bucket and a large backlog used to end this job in a driver
    // error instead of a report of what it managed.
    remove.mockRejectedValue(new Error("bucket unreachable"));
    selectRows.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ ...TICKET, id: `t${i}` })),
    );

    const result = await pruneAbandonedUploads(new Date(), Date.now() + 600_000);

    expect(result).toEqual({ removed: 0, failed: 200, stoppedEarly: true });
    expect(selectRows).toHaveBeenCalledTimes(1);
  });

  it("🚨 can never name a delivered item's key, whatever it selects on", async () => {
    // The sweep picks by `expiresAt` and by nothing else, and that is safe for
    // one structural reason rather than for care: every key it removes is a
    // ticket's `stagingKey()`, and no `media` row can carry one. It used to be
    // able to — the ticket and the row shared a key, so a ticket that survived
    // its own confirm (a crash between the insert and the delete) came back an
    // hour later and removed the object of a LIVE row, counted as a success.
    const when = new Date("2026-08-10T00:00:00Z");
    const staged = stagingKey({ id: "abc", mime: "video/mp4", createdAt: when });
    const delivered = storageKey({
      id: "abc",
      namespace: "courses",
      category: "video",
      mime: "video/mp4",
      createdAt: when,
    });

    expect(staged).not.toBe(delivered);
    expect(staged.startsWith("pending/")).toBe(true);
    expect(delivered.startsWith("pending/")).toBe(false);
  });

  it("a second run over nothing reports zero", async () => {
    selectRows.mockResolvedValue([]);
    expect(await pruneAbandonedUploads(new Date(), Date.now() + 60_000)).toEqual({
      removed: 0,
      failed: 0,
      stoppedEarly: false,
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
