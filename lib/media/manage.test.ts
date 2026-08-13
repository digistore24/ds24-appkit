// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `mayAccess()` and the deletion path — the two pieces of this feature that
// decide who gets somebody else's file and whether "delete my account" is true.
//
// ── Why this file exists ───────────────────────────────────────────────────
// A code review found that neither had a test. `mayAccess()` is the most
// security-critical function in the media layer — an owner comparison, a
// `hasPlan()` call, and a deliberate asymmetry that lets an operator fetch
// product content but not a customer's own upload — and nothing exercised any
// of it. Story 9.1 names one of these as an acceptance criterion in its own
// right: *"a test asserts the store was asked to remove them"*.
//
// ── What is faked, and what is not ─────────────────────────────────────────
// The database and the object store are mocked; the LOGIC is not. That is the
// point: these tests are about which branch is taken, and a real Postgres would
// only make them slower and flakier without testing anything more. The round
// trip against real storage is `node run.mjs media-check`, which is a different
// question and has its own command.
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import type { MediaRow } from "@/db/schema-media";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const hasPlan = vi.fn<(memberId: string, productKey: string) => Promise<boolean>>();
const remove = vi.fn<(key: string) => Promise<void>>();
const deleteWhere = vi.fn();
const selected = vi.fn<() => Promise<MediaRow[]>>();

vi.mock("@/lib/entitlements/manage", () => ({ hasPlan: (m: string, p: string) => hasPlan(m, p) }));

vi.mock("./store", () => ({
  mediaStore: () => ({ remove, put: vi.fn(), head: vi.fn(), getBytes: vi.fn() }),
}));

// `where()` has to be BOTH awaitable and chainable: `listOwnedMedia` awaits it
// directly, `findMedia` calls `.limit(1)` on it first. A mock that offers only
// one of the two fails on the other with "rows is not iterable", which says
// nothing about the code under test.
// The predicate is CAPTURED, not discarded. It used to be `where: () => …`,
// which meant no test could ever see which rows a query asked for — so the
// story whose whole point was widening `listOwnedMedia()` from `owner` to
// `owner ∪ members` had its "most load-bearing assertion" pinned by nothing.
// Reverting the filter left every test green.
const whereArg = vi.fn();
const inserted = vi.fn();
// Two select shapes in this file, told apart by their projection: the `media`
// queries ask for whole rows (`db.select()`), the open-ticket sweep in
// `deleteOwnedMedia()` asks for two columns (`db.select({ id, storageKey })`).
// One recorder for both made the ticket sweep look like a second pass over the
// media rows.
const selectedTickets = vi.fn<() => Promise<{ id: string; storageKey: string }[]>>();
vi.mock("@/db", () => ({
  db: {
    select: (projection?: unknown) => ({
      from: () => ({
        where: (condition: unknown) => {
          whereArg(condition);
          const result = projection ? selectedTickets() : selected();
          return Object.assign(result, { limit: () => result });
        },
      }),
    }),
    delete: () => ({ where: deleteWhere }),
    // Only `acceptUpload`'s happy path reaches this — every refusal below
    // happens before a row is written, which is the property those tests are
    // about. It hands the values straight back so the caller gets a row shape.
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted(values);
        return { returning: async () => [values] };
      },
    }),
  },
}));

// `planProblem` reads the product registry; the branch under test is "does a
// retired key deny or throw", so the answer is supplied per test.
const planProblem = vi.fn<(key: string) => string | null>();
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  planProblem: (key: string) => planProblem(key),
}));

const { acceptUpload, mayAccess, deleteMedia, deleteOwnedMedia } = await import("./manage");

/**
 * The BOUND VALUES of a Drizzle condition — what the query actually asks for.
 *
 * Two things make this fiddlier than it looks, and both are worth stating
 * because the naive versions are wrong in opposite directions:
 *
 *  - `JSON.stringify` throws. A condition holds column objects whose `table`
 *    property points back at the table, so the structure is circular.
 *  - Collecting every nested string finds "public" and "entitled" whatever the
 *    predicate says, because the COLUMN carries the enum's full value list in
 *    its metadata. A test written that way passes and fails for reasons that
 *    have nothing to do with the filter.
 *
 * So only `Param` nodes are collected: those are the values bound into the
 * statement, which is precisely the question — which visibilities did this
 * query ask for.
 */
function literalsIn(condition: unknown): string[] {
  const found: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node.constructor?.name === "Param" && typeof (node as { value?: unknown }).value === "string") {
      found.push((node as { value: string }).value);
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(condition);
  return found;
}

function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    ownerId: "alice",
    kind: "image",
    visibility: "owner",
    planKeys: [],
    storageKey: "core/upload/2026/07/m1.png",
    mime: "image/png",
    filename: null,
    bytes: 10,
    width: null,
    height: null,
    // "Nobody asked" — the state every row written before Story 26.2 carries.
    // Tests about the narrower copies say so explicitly.
    variants: null,
    durationSeconds: null,
    sha256: "x",
    source: "upload",
    alt: "a picture",
    prompt: null,
    provider: null,
    model: null,
    createdAt: new Date(),
    ...over,
  } as MediaRow;
}

beforeEach(() => {
  hasPlan.mockReset().mockResolvedValue(false);
  remove.mockReset().mockResolvedValue(undefined);
  deleteWhere.mockReset().mockResolvedValue(undefined);
  selected.mockReset().mockResolvedValue([]);
  selectedTickets.mockReset().mockResolvedValue([]);
  planProblem.mockReset().mockReturnValue(null);
  whereArg.mockReset();
  inserted.mockReset();
});

describe("a door may narrow to a TYPE, not only to a kind", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // A door whose kind holds more than one type. `text/vtt`,
  // `application/pdf` and `application/zip` are all `file` in
  // `config/media.json`, so a subtitle slot written with
  // `onlyKinds: ["file"]` accepts a PDF and a worksheet slot accepts a `.vtt`
  // — the same mistake `onlyKinds` prevents for a profile picture, one level
  // down.
  //
  // Real bytes, real config, real sniffing: the question is what the PIPELINE
  // does with a file, and a mocked sniff would be asking the mock.
  const bytesOf = (text: string) => new TextEncoder().encode(text);
  const PDF = bytesOf("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
  const VTT = bytesOf("WEBVTT\n\n00:00.000 --> 00:02.000\nhello\n");

  const upload = (bytes: Uint8Array, over: Record<string, unknown>) =>
    acceptUpload({
      ownerId: "owner-1",
      role: "owner",
      bytes,
      claimedMime: null,
      filename: null,
      // The generic door's slot. Every test in this file goes through the
      // pipeline rather than through a door, so the pair only has to be a
      // legal one — which door owns which is asserted at the doors.
      namespace: "core",
      category: "upload",
      ...over,
    });

  it("refuses a subtitle offered to a worksheet door", async () => {
    await expect(
      upload(VTT, { onlyKinds: ["file"], onlyMimes: ["application/pdf", "application/zip"] }),
    ).rejects.toMatchObject({ code: "typeNotAllowed" });
    expect(inserted, "it was refused and a row was written anyway").not.toHaveBeenCalled();
  });

  it("refuses a PDF offered to a subtitle door", async () => {
    await expect(
      upload(PDF, { onlyKinds: ["file"], onlyMimes: ["text/vtt"] }),
    ).rejects.toMatchObject({ code: "typeNotAllowed" });
    expect(inserted).not.toHaveBeenCalled();
  });

  it("🚨 lets the right type through — otherwise the two refusals prove nothing", async () => {
    // Without this the pair above would pass on a door that refuses
    // everything, which is a different bug wearing the same green.
    const row = await upload(VTT, { onlyKinds: ["file"], onlyMimes: ["text/vtt"] });
    expect(row.mime).toBe("text/vtt");
    expect(inserted).toHaveBeenCalledTimes(1);
  });

  it("🚨 shows the gap it closes: the KIND alone accepts both", async () => {
    // The measurement behind the whole change. A door narrowed to its kind is
    // a subtitle door that stores a PDF.
    const row = await upload(PDF, { onlyKinds: ["file"] });
    expect(row.mime).toBe("application/pdf");
  });
});

describe("mayAccess — public", () => {
  it("lets anybody have it, signed in or not", async () => {
    const item = row({ visibility: "public" });
    expect(await mayAccess(item, { memberId: null, role: null })).toBe(true);
    expect(await mayAccess(item, { memberId: "bob", role: "member" })).toBe(true);
  });

  it("asks the entitlement layer nothing", async () => {
    // A session lookup in front of every product image on a page a signed-out
    // visitor is looking at would be the cost of getting this branch wrong.
    await mayAccess(row({ visibility: "public" }), { memberId: null, role: null });
    expect(hasPlan).not.toHaveBeenCalled();
  });
});

describe("mayAccess — owner", () => {
  const item = row({ visibility: "owner", ownerId: "alice" });

  it("lets the owner have it", async () => {
    expect(await mayAccess(item, { memberId: "alice", role: "member" })).toBe(true);
  });

  it("refuses another member", async () => {
    expect(await mayAccess(item, { memberId: "bob", role: "member" })).toBe(false);
  });

  it("refuses a signed-out visitor", async () => {
    expect(await mayAccess(item, { memberId: null, role: null })).toBe(false);
  });

  it("refuses an OPERATOR, deliberately", async () => {
    // The asymmetry that is easiest to "fix" and must not be. A customer's own
    // upload is their data; an operator who wants to see what a customer sees
    // has `impersonation`, which is recorded. Reading it straight out of an
    // admin session would be the same capability without the record.
    expect(await mayAccess(item, { memberId: "carol", role: "owner" })).toBe(false);
  });

  it("refuses a row with no owner", async () => {
    // `ownerId` is `set null` when an account goes, so an orphaned row must not
    // become readable by whoever happens to be signed out.
    expect(await mayAccess(row({ visibility: "owner", ownerId: null }), {
      memberId: null,
      role: null,
    })).toBe(false);
  });
});

describe("mayAccess — members", () => {
  // An avatar: a face members show each other. The whole condition is "is
  // there an active session", which is what makes this a fourth shape rather
  // than one of the three with a different question attached — the proofs of
  // that are in `rules.test.ts`, executable.
  const item = row({ visibility: "members", ownerId: "alice" });

  it("lets the member who uploaded it have it", async () => {
    expect(await mayAccess(item, { memberId: "alice", role: "member" })).toBe(true);
  });

  it("lets ANOTHER member have it — the whole point of the level", async () => {
    // The difference from `owner` in one line. If this ever returns false, the
    // community has become a place where nobody can see anybody.
    expect(await mayAccess(item, { memberId: "bob", role: "member" })).toBe(true);
  });

  it("lets the operator have it", async () => {
    // Deliberate, and the opposite of the `owner` asymmetry above: an avatar is
    // shown to every signed-in person by design, and the operator is one. There
    // is nothing here impersonation would protect.
    expect(await mayAccess(item, { memberId: "carol", role: "owner" })).toBe(true);
  });

  it("refuses a signed-out visitor", async () => {
    // FR-185. This is the assertion that keeps a face off the open web.
    expect(await mayAccess(item, { memberId: null, role: null })).toBe(false);
  });

  it("asks the entitlement layer nothing", async () => {
    // A face is not something anybody buys. A `hasPlan()` call here would mean
    // a member who has not bought a plan cannot see their neighbours.
    hasPlan.mockClear();
    await mayAccess(item, { memberId: "bob", role: "member" });
    expect(hasPlan).not.toHaveBeenCalled();
  });

  it("does not depend on the row having an owner", async () => {
    // `ownerId` is `set null` when an account goes. An avatar row that outlived
    // its uploader should not suddenly change who may fetch it — the sweep in
    // `deleteOwnedMedia` is what removes it, not an access rule.
    expect(
      await mayAccess(row({ visibility: "members", ownerId: null }), {
        memberId: "bob",
        role: "member",
      }),
    ).toBe(true);
  });
});

describe("why an avatar needed a fourth visibility — driven through mayAccess", () => {
  // `lib/media/rules.ts` warns that "a fourth shape is almost always one of
  // these three with a different question attached". `members` was added
  // anyway, so the burden is to show each of the three FAILS against FR-185 —
  // a profile picture is visible to signed-in members, never anonymously.
  //
  // ⚠️ These were first written in `rules.test.ts` as object literals compared
  // to object literals: they asserted the reasoning against itself and would
  // have passed with the entire `members` branch deleted. A review caught it.
  // They run against the real function here, which is the only place the claim
  // can be false.
  const avatar = (visibility: MediaRow["visibility"]) =>
    row({ visibility, ownerId: "alice", planKeys: [] });

  const anonymous = { memberId: null, role: null };
  const otherMember = { memberId: "bob", role: "member" };

  it("public would serve an avatar with NO session — the opposite of the requirement", async () => {
    expect(await mayAccess(avatar("public"), anonymous)).toBe(true);
    // …which is exactly what FR-185 forbids, so `public` is out.
    expect(await mayAccess(avatar("members"), anonymous)).toBe(false);
  });

  it("owner would show a member their own face and nobody else's", async () => {
    expect(await mayAccess(avatar("owner"), otherMember)).toBe(false);
    // A community where no member can see another is not the feature.
    expect(await mayAccess(avatar("members"), otherMember)).toBe(true);
  });

  it("entitled would put a face behind a purchase", async () => {
    hasPlan.mockClear();
    planProblem.mockReturnValue(null);
    hasPlan.mockResolvedValue(false);
    const paid = row({ visibility: "entitled", planKeys: ["basis"], ownerId: "alice" });
    expect(await mayAccess(paid, otherMember)).toBe(false);
    expect(hasPlan).toHaveBeenCalled();

    // `members` asks the entitlement layer nothing at all.
    hasPlan.mockClear();
    expect(await mayAccess(avatar("members"), otherMember)).toBe(true);
    expect(hasPlan).not.toHaveBeenCalled();
  });
});

describe("mayAccess — a blocked account gets no bytes", () => {
  // AC 2 asks for this explicitly and it was missing. The refusal does not live
  // in `mayAccess()` — the delivery route maps a non-active session to
  // `{ memberId: null }` before calling it — so the assertion is that the
  // no-session shape is refused for EVERY visibility a member could otherwise
  // reach. Delete the route's `state !== "active"` guard and a blocked session
  // arrives here as an anonymous one, which this pins as refused.
  const blockedShape = { memberId: null, role: null };

  it("is refused for members, owner and entitled alike", async () => {
    planProblem.mockReturnValue(null);
    hasPlan.mockResolvedValue(true);
    expect(await mayAccess(row({ visibility: "members" }), blockedShape)).toBe(false);
    expect(await mayAccess(row({ visibility: "owner", ownerId: "alice" }), blockedShape)).toBe(false);
    expect(
      await mayAccess(row({ visibility: "entitled", planKeys: ["basis"] }), blockedShape),
    ).toBe(false);
  });

  it("the delivery route really does map a blocked session to no member", () => {
    // The other half, asserted on the source: the mapping above is what makes
    // the runtime behaviour true, and it is one edit away from being lost.
    const route = readFileSync(
      join(ROOT, "app", "api", "media", "[id]", "route.ts"),
      "utf8",
    );
    expect(route).toMatch(/state !== "active"/);
    expect(route).toMatch(/memberId: null/);
  });
});

describe("mayAccess — entitled", () => {
  const item = row({ visibility: "entitled", ownerId: null, planKeys: ["basis"] });

  it("lets a member who holds the plan have it", async () => {
    hasPlan.mockResolvedValue(true);
    expect(await mayAccess(item, { memberId: "bob", role: "member" })).toBe(true);
    expect(hasPlan).toHaveBeenCalledWith("bob", "basis");
  });

  it("refuses a member who does not", async () => {
    hasPlan.mockResolvedValue(false);
    expect(await mayAccess(item, { memberId: "bob", role: "member" })).toBe(false);
  });

  it("refuses a signed-out visitor without asking", async () => {
    expect(await mayAccess(item, { memberId: null, role: null })).toBe(false);
    expect(hasPlan).not.toHaveBeenCalled();
  });

  it("lets the OPERATOR have it — it is their own product", async () => {
    // The other half of the asymmetry above. `entitled` content is what the
    // operator uploaded and sells; refusing them their own workbook would be
    // theatre.
    expect(await mayAccess(item, { memberId: "carol", role: "owner" })).toBe(true);
    expect(hasPlan).not.toHaveBeenCalled();
  });

  it("refuses a row with no plan named", async () => {
    expect(await mayAccess(row({ visibility: "entitled", planKeys: [] }), {
      memberId: "bob",
      role: "member",
    })).toBe(false);
  });

  it("DENIES rather than throwing when the plan was retired", async () => {
    // The `console.error` below is the behaviour under test, not an accident — this
    // test PROVOKES the failure. Silenced so an UNEXPECTED error stays visible in
    // the run's output instead of drowning in expected noise.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    // Write-time validation cannot cover a later edit to
    // `config/digistore-products.json`, and `hasPlan()` throws on a key it does
    // not know — so without this the delivery route and every server component
    // rendering the item answered 500 instead of refusing access.
    planProblem.mockReturnValue('no product "basis" in config/digistore-products.json');
    expect(await mayAccess(item, { memberId: "bob", role: "member" })).toBe(false);
    expect(hasPlan).not.toHaveBeenCalled();
  });
});

describe("🚨 mayAccess — entitled under SEVERAL plans, and holding one is enough", () => {
  // ── What this catches, and why it had nothing ──────────────────────────
  // The column was ONE key until Story 44.1. One offering is one Digistore24
  // product per billing interval, so a course sold monthly and yearly is two
  // keys before it has a second customer — and the failure of asking only the
  // first is invisible by construction: the yearly buyer's lesson page passes
  // its own gate and every medium on it resolves to `null`, which the page
  // renders as "there is none". A clean 200 over a product half-delivered,
  // exactly the class `CLAUDE.md` → *Never ship a broken page* is about.
  //
  // ⚠️ Measured while writing it: with `mayAccess()` reduced to
  // `hasPlan(memberId, live[0])`, the ENTIRE suite of 7206 tests stayed green.
  // Every test above passes a one-key list, so none of them can tell the two
  // apart. These four are what make the loop falsifiable.
  const sold = row({ visibility: "entitled", ownerId: null, planKeys: ["monthly", "yearly"] });

  it("🚨 lets in a member who holds the SECOND key — the needle", async () => {
    // The one that goes red on a gate that stops at the head of the list.
    hasPlan.mockImplementation(async (_member: string, key: string) => key === "yearly");
    expect(await mayAccess(sold, { memberId: "bob", role: "member" })).toBe(true);
  });

  it("lets in a member who holds the FIRST key without asking about the rest", async () => {
    // The counter-test: short-circuiting is right, and a gate that asked every
    // key regardless would pass the needle above while making one pointless
    // round-trip per key on every render of every lesson.
    hasPlan.mockImplementation(async (_member: string, key: string) => key === "monthly");
    expect(await mayAccess(sold, { memberId: "bob", role: "member" })).toBe(true);
    expect(hasPlan).toHaveBeenCalledTimes(1);
  });

  it("refuses a member who holds NEITHER, having asked about both", async () => {
    // The other counter-test: "any" must not decay into "always true". The call
    // count is half the assertion — a gate that refused without asking would
    // satisfy the verdict and be a different function.
    hasPlan.mockResolvedValue(false);
    expect(await mayAccess(sold, { memberId: "bob", role: "member" })).toBe(false);
    expect(hasPlan).toHaveBeenCalledTimes(2);
  });

  it("🚨 skips a RETIRED key and still opens for the live one", async () => {
    // Retiring a product is an ordinary thing to do. Taking the whole row down
    // because ONE of its keys went stale would refuse people who paid — so a
    // stale key is skipped rather than fatal, and only an all-stale list is a
    // refusal. The `console.error` is the behaviour under test.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    planProblem.mockImplementation((key: string) =>
      key === "monthly" ? 'no product "monthly" in config/digistore-products.json' : null,
    );
    hasPlan.mockImplementation(async (_member: string, key: string) => key === "yearly");
    expect(await mayAccess(sold, { memberId: "bob", role: "member" })).toBe(true);
    // 🚨 And it never ASKED about the retired one: `hasPlan()` throws on a key
    // the registry does not know, so asking would be a 500 rather than a
    // refusal — the trap this filter exists for.
    expect(hasPlan).not.toHaveBeenCalledWith("bob", "monthly");
  });

  it("refuses when EVERY key has been retired", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    planProblem.mockReturnValue("gone");
    expect(await mayAccess(sold, { memberId: "bob", role: "member" })).toBe(false);
    expect(hasPlan).not.toHaveBeenCalled();
  });
});

describe("every upload door enters the outer guard", () => {
  // ── What this catches ──────────────────────────────────────────────────
  // A door built on `acceptUpload()` alone. That is genuinely the shipped
  // pipeline — sniffing, role ceiling, EXIF — and genuinely only its inner
  // half; the media kill switch, the store-health check and the hourly rate
  // limit live in `guardUploadEntry()`. Story 19.4 shipped exactly that mistake
  // (an avatar upload with NO rate limit, on which the operator's switch did
  // nothing), and nothing in the suite noticed.
  //
  // Source-text, because the doors are a route handler and a server action —
  // neither runnable in a node test — and because what must be true is
  // structural: wherever `acceptUpload` is called, the guard is called too.
  // ── Why an entry and not a filename ──────────────────────────────────────
  // The list held plain paths while every door had the same shape: store with
  // `acceptUpload()`, guard with `guardUploadEntry()`. The direct-to-bucket
  // path (Story 8.1) has two halves and neither fits that shape — one guards
  // and stores NOTHING (it mints an address), the other stores and must NOT
  // call the counting guard, because the hourly slot was already spent when the
  // address was minted and charging it twice halves the operator's allowance.
  //
  // So each door says which function stores and which guard has to come first,
  // and the claim generalises from "guardUploadEntry before acceptUpload" to
  // "every door calls ITS guard before it WRITES".
  //
  // ⚠️ **`stores` is never null, and it used to be for the mint halves.** The
  // loop returns before the order comparison when it is, so those two entries
  // asserted presence and nothing else — moving `guardUploadEntry()` below the
  // mint left every test green, which is precisely the arrangement in which the
  // hourly slot is taken after the address has been handed out. A mint half
  // does store something: the ticket row, through `createUploadTicket()`, and
  // that is the write the guard has to precede.
  const doors = [
    { file: "lib/media/upload-endpoint.ts", stores: "acceptUpload", guard: "guardUploadEntry" },
    {
      file: "modules/community/profile-actions.ts",
      stores: "acceptUpload",
      guard: "guardUploadEntry",
    },
    // The setup surface's `media_upload`. A third caller, and the sweep below
    // is what found it rather than anybody remembering — which is the whole
    // argument for that sweep. This door's uploader is an OPERATOR whose key
    // was authenticated by `guardSetup()`, so `guardUploadEntry()` here is
    // metering an account that already proved itself; it is called anyway,
    // because "this caller is trustworthy" is how the kill switch stops being
    // wired to one of the doors.
    { file: "lib/setup/tools.ts", stores: "acceptUpload", guard: "guardUploadEntry" },
    // The course's media slots. The FOURTH door, and the first whose upload is
    // the operator's product rather than somebody's own file — which changes
    // nothing about this rule, and that is the point of stating it per door.
    {
      file: "modules/courses/admin/media-actions.ts",
      stores: "acceptUpload",
      guard: "guardUploadEntry",
    },
    // A picture on a community post (Story 26.2). The FIFTH door, and the sweep
    // below is what found it rather than anybody remembering — which is the whole
    // argument for that sweep.
    //
    // ⚠️ **It is the module's `lib/manage.ts` and NOT its action**, which is the
    // one thing worth reading twice here: every other door in this list is a
    // Server Action or a route handler. This one is a level deeper on purpose —
    // `addPost()` re-derives the room's access, the participation check and the
    // send-block, and the upload has to happen AFTER all three or a member who is
    // no longer in the room puts bytes in the operator's bucket and spends their
    // hourly allowance on a post that is then refused. So the guard and the store
    // live inside the function that owns that order, where no caller can enter
    // past them. `modules/community/lib/post-image-write.test.ts` measures the
    // order against the guards as well as against each other.
    // ⚠️ `_post-images.ts` since the split of `manage.ts` (5,902 lines → eleven
    // domain files). The door did not move; the file it lives in was named.
    { file: "modules/community/lib/_post-images.ts", stores: "acceptUpload", guard: "guardUploadEntry" },
    // Direct-to-bucket, half one: mints an address, stores nothing, and is
    // where the hourly slot is spent.
    {
      file: "app/api/media/upload-url/route.ts",
      stores: "createUploadTicket",
      guard: "guardUploadEntry",
    },
    // Direct-to-bucket, half two: stores, and uses the guard that does not
    // count. 🚨 The sweep below keeps `guardUploadConfirm` to the doors listed
    // here with that guard — it is a rate-limit bypass anywhere else.
    {
      file: "app/api/media/confirm/route.ts",
      stores: "confirmUpload",
      guard: "guardUploadConfirm",
    },
    // The course's video slot, as of Story 8.2 — the same two halves, but as
    // Server Actions rather than routes, because a lesson recording is
    // `entitled` and the HTTP door pins `owner`. The file appears three times in
    // this list on purpose: its other three slots still travel through the app,
    // so it stores through `acceptUpload()` behind the counting guard, mints
    // through `createUploadTicket()` behind the same one, and stores again
    // through `confirmUpload()` behind the guard that does not count.
    //
    // ⚠️ **The ORDER inside this file is measured elsewhere, and it has to be.**
    // These assertions read the file as text and compare FIRST occurrences, so
    // for a file holding several doors they say "the guard is named" and not
    // "this door calls it first" — `attach()` names `guardUploadEntry()` near
    // the top whatever the two halves below do. The real order claim for them is
    // `modules/courses/admin/media-actions.test.ts` → "meters BEFORE it mints",
    // which watches `invocationCallOrder` on the real calls. Listed here anyway,
    // because presence in this list is what the two sweeps below check against.
    {
      file: "modules/courses/admin/media-actions.ts",
      stores: "createUploadTicket",
      guard: "guardUploadEntry",
    },
    {
      file: "modules/courses/admin/media-actions.ts",
      stores: "confirmUpload",
      guard: "guardUploadConfirm",
    },
  ] as const;

  const doorFiles = new Set<string>(doors.map((d) => d.file));

  /**
   * The media layer's own files — the ones that DEFINE what the sweeps below
   * look for, and are therefore not doors that use it.
   *
   * ⚠️ **Exact paths, and that is the whole point of the constant.** The
   * exemptions used to read `file.endsWith("manage.ts")`, and this tree holds
   * ten files by that name — `modules/courses/lib/manage.ts` and
   * `modules/community/lib/manage.ts` among them. A module calling
   * `acceptUpload()` or `createUploadUrl()` from its own `manage.ts` was
   * invisible to every sweep here, which is exactly the class of door the
   * sweeps were widened over `modules/` to catch.
   */
  const MEDIA_LAYER = ["lib/media/manage.ts", "lib/media/upload-endpoint.ts"];

  /**
   * Every non-test source file under the app's own trees whose code — comments
   * blanked — names something.
   *
   * ⚠️ **Through `blankComments()`, not a regex of its own.** It used to strip
   * `//` lines only, so a `/** … *\/` naming `acceptUpload()` reported the file
   * that EXPLAINS the rule as breaking it — `modules/courses/rules.ts`
   * documents what its slots hand the door and was flagged as a fourth upload
   * path. `CLAUDE.md` names this exact failure and
   * `scripts/lib/source-text.mjs` is the one answer.
   */
  const filesNaming = (needle: RegExp): string[] => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(rel);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
          if (needle.test(blankComments(readFileSync(join(ROOT, rel), "utf8")))) hits.push(rel);
        }
      }
    };
    for (const root of ["app", "lib", "scripts", "modules"]) walk(root);
    return hits;
  };

  for (const door of doors) {
    it(`${door.file} calls ${door.guard}() before ${door.stores}`, () => {
      const source = blankComments(readFileSync(join(ROOT, door.file), "utf8"));

      expect(
        source,
        `${door.file} does not call ${door.guard}() — that is an upload path with no kill ` +
          `switch and, on the counting guard, no rate limit either`,
      ).toMatch(new RegExp(`${door.guard}\\(`));

      expect(
        source,
        `${door.file}: no ${door.stores}() call found — has the door moved?`,
      ).toMatch(new RegExp(`${door.stores}\\(`));

      // ── And in that ORDER, which presence alone does not say ─────────────
      // A door that calls its guard AFTER storing has already spent the thing
      // the limit protects: the bytes are read, sniffed, stripped and written,
      // and the kill switch fires on a file that is already in the bucket.
      // `CLAUDE.md` → *Media* names the sequence, not the pair.
      const guardAt = source.indexOf(`${door.guard}(`);
      const storeAt = source.indexOf(`${door.stores}(`);
      expect(
        guardAt,
        `${door.file} reaches ${door.stores}() before ${door.guard}(). The upload would be ` +
          `accepted before anything asked whether media is switched on, whether the store ` +
          `works, or whether this account has had its share of the hour.`,
      ).toBeLessThan(storeAt);
    });
  }

  it("🚨 only a declared confirm door uses the guard that does not count", () => {
    // `guardUploadConfirm()` skips the hourly meter on purpose. That is correct
    // for a door whose ticket already spent a slot, and a rate-limit bypass for
    // any other — and the difference is invisible in review, because both lines
    // read like a guard.
    //
    // ⚠️ Derived from the list above rather than written out again. It was one
    // literal path while there was one confirm door; Story 8.2 added a second
    // (the course's video slot, as a Server Action), and a second literal is
    // where a third would have been forgotten. A door reaches this allowance by
    // being IN the list with that guard, which is an entry carrying an
    // assertion rather than an exemption.
    const allowed: string[] = doors
      .filter((door) => door.guard === "guardUploadConfirm")
      .map((door) => door.file);
    const users = filesNaming(/\bguardUploadConfirm\(/).filter(
      (file) => !allowed.includes(file) && !MEDIA_LAYER.includes(file),
    );
    expect(
      users,
      `guardUploadConfirm() does not spend an hourly slot. Only a door declared with it above ` +
        `may call it (${allowed.join(", ")}) — every other one takes guardUploadEntry(), or it ` +
        `is an upload path with no ceiling.`,
    ).toEqual([]);
  });

  it("🚨 no file outside the list mints an upload TICKET", () => {
    // The third sweep, and the one the `createUploadUrl(` sweep below cannot
    // make. `createUploadTicket()` is the door-facing half: it writes the
    // ticket row, derives the key and asks `store.createUploadUrl()` on the
    // caller's behalf — so a file that calls IT reaches a presigned PUT without
    // ever naming one, and the sweep below would see nothing at all.
    const unexpected = filesNaming(/\bcreateUploadTicket\(/).filter(
      (file) => !doorFiles.has(file) && !MEDIA_LAYER.includes(file),
    );
    expect(
      unexpected,
      "a file mints an upload ticket outside the door list. That reaches a presigned PUT " +
        "with no guard in front of it — the Story 19.4 defect in the shape the createUploadUrl " +
        "sweep cannot see, because the call is one level up.",
    ).toEqual([]);
  });

  it("🚨 the order assertion finds a door that has them the wrong way round", () => {
    // The needle probe. Both `indexOf`s returning -1 would make the comparison
    // above vacuously false in one direction and vacuously true in the other,
    // and a scan that matched nothing would report every door as correct.
    const wrong = blankComments(
      `const row = await acceptUpload({ ownerId });\nguardUploadEntry(ownerId);\n`,
    );
    expect(wrong.indexOf("guardUploadEntry(")).toBeGreaterThan(wrong.indexOf("acceptUpload("));

    const right = blankComments(
      `guardUploadEntry(ownerId);\nconst row = await acceptUpload({ ownerId });\n`,
    );
    expect(right.indexOf("guardUploadEntry(")).toBeLessThan(right.indexOf("acceptUpload("));
  });

  it("no OTHER file calls acceptUpload", () => {
    // The list above is only a guarantee while it is the whole list.
    //
    // ⚠️ **`modules/` is in the sweep, and its absence made the list a
    // half-guarantee.** One module door is already pinned above by hand
    // (`modules/community/profile-actions.ts`), while the sweep that keeps the
    // list honest stopped at the core's trees — so the one door somebody had
    // thought of was checked and every future module door was invisible. An
    // upload path that skips `guardUploadEntry()` has no rate limit and a kill
    // switch that does nothing; CLAUDE.md calls it "a bug this template has
    // already shipped once", and a module is where the next one would live.
    const unexpected = filesNaming(/\bacceptUpload\(/).filter(
      (file) => !doorFiles.has(file) && !MEDIA_LAYER.includes(file),
    );
    expect(
      unexpected,
      "a new upload door appeared — add it to the list above and make sure it guards first",
    ).toEqual([]);
  });

  it("🚨 no file outside the list mints an upload address", () => {
    // ── The sweep the direct path needed, and the one that is easiest to
    //    forget ────────────────────────────────────────────────────────────
    // `createUploadUrl()` hands out a presigned PUT: a URL anybody holding it
    // may write an object with, no session and no further check. Reached
    // without `guardUploadEntry()` in front, it is an upload path with no rate
    // limit on which the operator's kill switch does nothing — literally the
    // Story 19.4 defect, in a shape the `acceptUpload` sweep above cannot see,
    // because this half stores nothing.
    const unexpected = filesNaming(/\bcreateUploadUrl\(/).filter(
      (file) =>
        !doorFiles.has(file) &&
        // The contract and its two implementations. They define the thing.
        !["lib/media/store.ts", "lib/media/s3.ts", "lib/media/local.ts"].includes(file) &&
        // The media layer itself: `createUploadTicket()` is the one caller, and
        // it sits behind whichever door the list above pins.
        !MEDIA_LAYER.includes(file),
    );
    expect(
      unexpected,
      "a file mints a presigned upload address outside the door list — that is a write to the " +
        "bucket with no rate limit and a kill switch that does nothing",
    ).toEqual([]);
  });

  it("🚨 both sweeps see a planted violation", () => {
    // Non-vacuity for the pair. A walk that matched nothing would report every
    // file as clean, and both sweeps would be green for the same wrong reason.
    const needle = filesNaming(/\bacceptUpload\(/);
    expect(needle, "the walk found no acceptUpload at all — it is not reading the tree").not.toEqual(
      [],
    );
    const minted = filesNaming(/\bcreateUploadUrl\(/);
    expect(
      minted,
      "the walk found no createUploadUrl at all — it is not reading the tree",
    ).not.toEqual([]);
    const ticketed = filesNaming(/\bcreateUploadTicket\(/);
    expect(
      ticketed,
      "the walk found no createUploadTicket at all — it is not reading the tree",
    ).not.toEqual([]);
    // And the comment blanking really is in the path: a file that only MENTIONS
    // the name in prose must not be reported.
    expect(blankComments("// createUploadUrl( in a comment\n")).not.toMatch(
      /createUploadUrl\(/,
    );
  });
});

describe("listOwnedMedia asks for the member's OWN media — both kinds of own", () => {
  // AC 4 of Story 19.4, and the Dev Notes call it the story's most load-bearing
  // assertion: a `members`-visible avatar must be found by the sweep, or a
  // member's own face survives their account deletion — in the bucket, with
  // `ownerId` set to null, so nothing left in the database can ever find it.
  //
  // Asserted on the PREDICATE the query was built with, because that is the
  // only thing a mocked database can honestly observe.
  it("filters on owner AND members, not owner alone", async () => {
    const { listOwnedMedia } = await import("./manage");
    await listOwnedMedia("alice");

    expect(whereArg).toHaveBeenCalledTimes(1);
    const values = literalsIn(whereArg.mock.calls[0][0]);

    // Both values present…
    expect(values).toContain("owner");
    expect(values).toContain("members");
  });

  it("does not ask for product imagery", async () => {
    const { listOwnedMedia } = await import("./manage");
    await listOwnedMedia("alice");
    const values = literalsIn(whereArg.mock.calls[0][0]);
    // Deleting the operator's account must not take the app's lesson covers.
    expect(values).not.toContain("public");
    expect(values).not.toContain("entitled");
  });
});

describe("deleteOwnedMedia", () => {
  it("asks the store to remove the object, not only the row", async () => {
    // The acceptance criterion, and the reason it is one: a foreign key cascade
    // reaches the database and not the bucket, so a row that vanishes on its
    // own leaves a customer's file in storage with nothing left to find it.
    selected.mockResolvedValue([
      row({ id: "m1", storageKey: "core/upload/2026/07/m1.png" }),
      row({ id: "m2", storageKey: "core/upload/2026/07/m2.png" }),
    ]);

    const count = await deleteOwnedMedia("alice");

    expect(count).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith("core/upload/2026/07/m1.png");
    expect(remove).toHaveBeenCalledWith("core/upload/2026/07/m2.png");
    expect(deleteWhere).toHaveBeenCalledTimes(2);
  });

  it("removes the object BEFORE the row", async () => {
    // The order is the whole guarantee. Row first, and a failure in between
    // leaves a file nothing can locate; object first, and the worst case is a
    // row pointing at nothing — visible, and fixable.
    const order: string[] = [];
    remove.mockImplementation(async () => void order.push("object"));
    deleteWhere.mockImplementation(async () => void order.push("row"));
    selected.mockResolvedValue([row()]);

    await deleteOwnedMedia("alice");

    expect(order).toEqual(["object", "row"]);
  });

  it("stops rather than dropping the row when the store refuses", async () => {
    // Deleting the row anyway would lose the only pointer to a file somebody
    // asked to have deleted, and no later run could find it.
    remove.mockRejectedValue(new Error("bucket unreachable"));
    selected.mockResolvedValue([row()]);

    await expect(deleteOwnedMedia("alice")).rejects.toThrow(/bucket unreachable/);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("is quiet for a member with nothing", async () => {
    expect(await deleteOwnedMedia("alice")).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it("🚨 empties the member's open upload tickets too, objects included", async () => {
    // The half that was missing, and the failure it caused is the one this
    // whole function exists to prevent. `media_uploads.ownerId` is `cascade`,
    // so deleting the account took the ticket row — the only record that a
    // `pending/` object exists, since the sweep finds an object by reading that
    // table and `MediaStore` has no `list()`. A member who deleted their
    // account with an upload in flight left their file in the bucket for good.
    selectedTickets.mockResolvedValue([
      { id: "t1", storageKey: "pending/2026/08/t1.mp4" },
      { id: "t2", storageKey: "pending/2026/08/t2.mp4" },
    ]);

    // The count is of `media` rows, which is what both callers report on — a
    // ticket is an expectation rather than an item somebody had.
    expect(await deleteOwnedMedia("alice")).toBe(0);
    expect(remove).toHaveBeenCalledWith("pending/2026/08/t1.mp4");
    expect(remove).toHaveBeenCalledWith("pending/2026/08/t2.mp4");
    expect(deleteWhere).toHaveBeenCalledTimes(2);
  });

  it("🚨 stops rather than dropping a ticket row the store would not empty", async () => {
    // Same rule as for `media` above, and here it is the sharper one: with the
    // row gone and the object still there, nothing in the app can ever name
    // that object again.
    selectedTickets.mockResolvedValue([{ id: "t1", storageKey: "pending/2026/08/t1.mp4" }]);
    remove.mockRejectedValue(new Error("bucket unreachable"));

    await expect(deleteOwnedMedia("alice")).rejects.toThrow(/bucket unreachable/);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("🚨 takes the narrower copies of every item with it", async () => {
    // The account sweep and `deleteMedia()` go through the same helper, so this
    // is the assertion that keeps them from drifting: a sweep that removed the
    // original and left `…-w960.jpg` behind would answer an erasure request with
    // a file still in the bucket, and `media.variants` — the only record that
    // the copy exists — is gone with the row.
    selected.mockResolvedValue([
      row({ id: "m1", storageKey: "core/upload/2026/07/m1.png", variants: [480, 960] }),
    ]);

    expect(await deleteOwnedMedia("alice")).toBe(1);
    expect(remove.mock.calls.map(([key]) => key)).toEqual([
      "core/upload/2026/07/m1-w480.png",
      "core/upload/2026/07/m1-w960.png",
      "core/upload/2026/07/m1.png",
    ]);
  });
});

describe("🚨 deleteMedia removes every object of an item, not only the original", () => {
  // ── Why this is a `describe` of its own ────────────────────────────────────
  // `media.variants` is the ONLY record that the narrower copies exist —
  // `MediaStore` has no `list()`, deliberately — so a deletion that drops the
  // row first, or drops it while a copy survives, strands a customer's picture
  // where nothing in this app can ever name it again. That is the same failure
  // `media_uploads`' header describes for a cascaded ticket, one table over.
  beforeEach(() => {
    selected.mockResolvedValue([
      row({ id: "m1", storageKey: "core/profile/2026/08/m1.jpg", variants: [480, 960] }),
    ]);
  });

  it("removes the variants, then the original, then the row", async () => {
    const order: string[] = [];
    remove.mockImplementation(async (key: string) => void order.push(key));
    deleteWhere.mockImplementation(async () => void order.push("row"));

    await deleteMedia("m1");

    // The ordering is the guarantee, extended by one step rather than reasoned
    // about afresh: every object before the row, and among the objects the
    // copies before the thing they were copied from.
    expect(order).toEqual([
      "core/profile/2026/08/m1-w480.jpg",
      "core/profile/2026/08/m1-w960.jpg",
      "core/profile/2026/08/m1.jpg",
      "row",
    ]);
  });

  it("stops rather than dropping the row when a VARIANT cannot be removed", async () => {
    // The direction that is easy to get wrong. Writing a variant is best-effort
    // (`variants.ts`: the original is the product); REMOVING one is not, because
    // only one of the two is answering a deletion request.
    remove.mockImplementation(async (key: string) => {
      if (key.includes("-w960")) throw new Error("bucket unreachable");
    });

    await expect(deleteMedia("m1")).rejects.toThrow(/bucket unreachable/);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("asks for nothing extra on a row that never had variants", async () => {
    // NULL is "nobody asked" — every row written before the column existed, and
    // every video, PDF and recording. One `remove()`, exactly as before.
    selected.mockResolvedValue([row({ id: "m1", storageKey: "core/upload/2026/07/m1.png" })]);

    await deleteMedia("m1");

    expect(remove.mock.calls.map(([key]) => key)).toEqual(["core/upload/2026/07/m1.png"]);
  });

  it("is quiet about an item that is not there", async () => {
    selected.mockResolvedValue([]);
    await deleteMedia("gone");
    expect(remove).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
