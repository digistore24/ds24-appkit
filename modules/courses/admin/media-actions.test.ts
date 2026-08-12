// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the media slots refuse, and what they never let the FORM decide.
//
// Same construction as `./actions.test.ts`: the seams around each decision are
// replaced, the decision itself is the real one, and there is no database — the
// assertions here are about things that must happen BEFORE a byte is stored, so
// a test that needed a database would be proving them in the one place the bug
// would not be.
//
// 🚨 **Two of these measure an ORDER and one measures an ABSENCE**, and those
// are the three no behavioural shortcut reaches:
//
//   * `guardUploadEntry()` runs BEFORE `acceptUpload()`. Presence is not the
//     claim — a door that meters after storing has already spent what the limit
//     protects.
//   * a `content` row reaches NEITHER of them.
//   * detaching a slot calls no `deleteMedia()`, ever.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", () => ({
  isCourseEnabled: vi.fn(() => true),
  courseConfig: vi.fn(() => ({
    enabled: true,
    shape: "self-study",
    productKey: "kurs_komplett",
    operatorPreviewsUnlocked: true,
  })),
}));

vi.mock("@/lib/authz", () => ({
  requireOwner: vi.fn(async () => ({ user: { id: "owner-1", role: "owner" } })),
}));

vi.mock("../lib/manage", () => ({
  unitById: vi.fn(),
  setUnitMedia: vi.fn(async () => true),
}));

vi.mock("../lib/content-files", () => ({
  contentFileIndex: vi.fn(() => ({
    blocks: new Map<string, string>(),
    units: new Map<string, string>(),
    unreadable: [] as string[],
  })),
}));

// The media layer, both halves of the door plus the deletion nobody may call.
// `deleteMedia` is mocked precisely so that "was it called" is answerable — an
// unmocked import would make the absence untestable.
vi.mock("@/lib/media/manage", () => ({
  acceptUpload: vi.fn(async () => ({ id: "media-new" })),
  deleteMedia: vi.fn(async () => {}),
  // The direct-to-bucket pair the video slot uses since Story 8.2. Mocked so
  // that "what was passed" is answerable — the claims here are about the two
  // fields the form does not have, and both are decided before a byte moves.
  createUploadTicket: vi.fn(async () => ({
    ticketId: "ticket-1",
    url: "https://bucket.example.com/put",
    expiresAt: new Date("2026-01-01T01:00:00Z"),
  })),
  confirmUpload: vi.fn(async () => ({ id: "media-direct", mime: "video/mp4" })),
}));
vi.mock("@/lib/media/upload-endpoint", () => ({
  guardUploadEntry: vi.fn(),
  guardUploadConfirm: vi.fn(),
}));

// The real ceilings, so the size refusal is measured against the numbers this
// installation actually ships (`config/media.json`), not against a fixture that
// could agree with a wrong constant.
vi.mock("@/lib/media/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/config")>()),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("TEST_NOT_FOUND");
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && /^TEST_(NOT_FOUND|REDIRECT)$/.test(error.message)) {
      throw error;
    }
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async (namespace: string) => (key: string, values?: unknown) =>
      `${namespace}.${key}(${JSON.stringify(values ?? null)})`,
  ),
  getLocale: vi.fn(async () => "de"),
}));

import { requireOwner } from "@/lib/authz";
import {
  acceptUpload,
  confirmUpload,
  createUploadTicket,
  deleteMedia,
} from "@/lib/media/manage";
import { guardUploadConfirm, guardUploadEntry } from "@/lib/media/upload-endpoint";
import { SERVER_ACTION_BODY_LIMIT_BYTES } from "@/lib/media/rules";

import { courseConfig, isCourseEnabled } from "../lib/config";
import { setUnitMedia, unitById } from "../lib/manage";
import { contentFileIndex } from "../lib/content-files";
import {
  attachCoverAction,
  attachSubtitleAction,
  attachWorksheetAction,
  confirmVideoAction,
  detachSlotAction,
  mintVideoTicketAction,
} from "./media-actions";

const EMPTY = { error: null, ok: null };

const OPERATOR_UNIT = { id: "u-1", slug: "lektion-1", origin: "operator" };
const CONTENT_UNIT = { id: "u-2", slug: "woche-1-intro", origin: "content" };

/** A form with a file in it. Sizes are declared, never allocated. */
function form(fields: Record<string, string>, file?: { name: string; size: number }): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  if (file) {
    // A real `File` whose `size` is what the test says, without allocating 40
    // MB: the action reads `.size` before anything else, and `arrayBuffer()`
    // only where a mocked `acceptUpload` ignores it anyway.
    const real = new File([new Uint8Array(8)], file.name, { type: "" });
    Object.defineProperty(real, "size", { value: file.size });
    data.set("file", real);
  }
  return data;
}

const SMALL = { name: "bild.png", size: 1_000 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCourseEnabled).mockReturnValue(true);
  vi.mocked(requireOwner).mockResolvedValue({
    user: { id: "owner-1", role: "owner" },
  } as never);
  vi.mocked(unitById).mockResolvedValue(OPERATOR_UNIT as never);
  vi.mocked(setUnitMedia).mockResolvedValue(true);
  vi.mocked(acceptUpload).mockResolvedValue({ id: "media-new" } as never);
  vi.mocked(createUploadTicket).mockResolvedValue({
    ticketId: "ticket-1",
    url: "https://bucket.example.com/put",
    expiresAt: new Date("2026-01-01T01:00:00Z"),
  } as never);
  vi.mocked(confirmUpload).mockResolvedValue({
    id: "media-direct",
    mime: "video/mp4",
    // What a ticket minted by `mintVideoTicketAction` carries into the row.
    // Both are asserted again on the way out — see the two probes below.
    visibility: "entitled",
    requiresPlan: "kurs_komplett",
  } as never);
  vi.mocked(courseConfig).mockReturnValue({
    enabled: true,
    shape: "self-study",
    productKey: "kurs_komplett",
    operatorPreviewsUnlocked: true,
  } as never);
  vi.mocked(contentFileIndex).mockReturnValue({
    blocks: new Map(),
    units: new Map(),
    unreadable: [],
  });
});

describe("🚨 AC 2 — the SERVER decides who may see the file, never the form", () => {
  it("stores an entitled row under the course's own Product Key", async () => {
    const state = await attachCoverAction(EMPTY, form({ id: "u-1", alt: "Ein Knoten" }, SMALL));

    expect(state.error).toBeNull();
    expect(acceptUpload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(acceptUpload).mock.calls[0][0]).toMatchObject({
      visibility: "entitled",
      requiresPlan: "kurs_komplett",
    });
  });

  it("🚨 ignores a crafted post that names a visibility and a plan of its own", async () => {
    // The assertion the acceptance criterion asks for by name. `CLAUDE.md` →
    // Media: "a form may never choose public or entitled" — so a request that
    // tries is not an error to report, it is a field nothing reads.
    await attachCoverAction(
      EMPTY,
      form(
        { id: "u-1", alt: "Ein Knoten", visibility: "public", requiresPlan: "fremd_plan" },
        SMALL,
      ),
    );

    const passed = vi.mocked(acceptUpload).mock.calls[0][0];
    expect(passed.visibility).toBe("entitled");
    expect(passed.requiresPlan).toBe("kurs_komplett");
  });

  it("takes the owner from the SESSION, and the alt from its own field", async () => {
    // The alt is never derived from the filename or the lesson title: a file
    // name is not a description, and a title stands beside a picture rather
    // than instead of it.
    await attachCoverAction(EMPTY, form({ id: "u-1", alt: "Ein Palstek" }, SMALL));
    expect(vi.mocked(acceptUpload).mock.calls[0][0]).toMatchObject({
      ownerId: "owner-1",
      role: "owner",
      alt: "Ein Palstek",
    });
  });
});

describe("🚨 AC 6 — both halves of the door, in this order", () => {
  it("meters BEFORE it stores", async () => {
    await attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL));

    expect(guardUploadEntry).toHaveBeenCalledWith("owner-1");
    expect(acceptUpload).toHaveBeenCalledTimes(1);
    // The order, measured rather than assumed. A door that meters afterwards
    // has already read, sniffed, stripped and stored the bytes.
    expect(vi.mocked(guardUploadEntry).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(acceptUpload).mock.invocationCallOrder[0],
    );
  });

  it("lets the outer guard's refusal through as a sentence", async () => {
    // `guardUploadEntry()` throws `MediaError` for the kill switch, a broken
    // store and the hourly ceiling. All three have texts in both languages
    // already; swallowing them into "unknown" would hide an operator's own
    // rate limit from them.
    const { MediaError } = await import("@/lib/media/rules");
    vi.mocked(guardUploadEntry).mockImplementationOnce(() => {
      throw new MediaError("rateLimited");
    });
    const state = await attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL));
    expect(state.error).toContain("rateLimited");
    expect(acceptUpload).not.toHaveBeenCalled();
    expect(setUnitMedia).not.toHaveBeenCalled();
  });
});

describe("each slot is a door of its own", () => {
  const DOORS = [
    { name: "cover", run: () => attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL)) },
    { name: "subtitle", run: () => attachSubtitleAction(EMPTY, form({ id: "u-1" }, SMALL)) },
    { name: "worksheet", run: () => attachWorksheetAction(EMPTY, form({ id: "u-1" }, SMALL)) },
  ] as const;

  const EXPECTED: Record<string, { kinds: string[]; mimes: string[] }> = {
    cover: { kinds: ["image"], mimes: ["image/jpeg", "image/png", "image/webp"] },
    subtitle: { kinds: ["file"], mimes: ["text/vtt"] },
    worksheet: { kinds: ["file"], mimes: ["application/pdf", "application/zip"] },
  };

  for (const { name, run } of DOORS) {
    it(`${name} narrows to its kind AND its types`, async () => {
      await run();
      const passed = vi.mocked(acceptUpload).mock.calls[0][0];
      expect([...(passed.onlyKinds ?? [])]).toEqual(EXPECTED[name].kinds);
      expect(
        [...(passed.onlyMimes ?? [])],
        `${name} does not narrow to its media TYPES. text/vtt, application/pdf and ` +
          `application/zip are the same KIND, so a subtitle door restricted to its kind ` +
          `takes a PDF and a worksheet door takes a .vtt.`,
      ).toEqual(EXPECTED[name].mimes);
    });
  }

  it("only the cover asks for alternative text", async () => {
    // A PDF has no alternative text and a recording has none; demanding one
    // produces the field filled in with "file" that accessibility rules exist
    // to prevent (`needsAlt()` in lib/media/rules.ts).
    await attachWorksheetAction(EMPTY, form({ id: "u-1", alt: "gets ignored" }, SMALL));
    expect(vi.mocked(acceptUpload).mock.calls[0][0].alt).toBeNull();
  });

  it("turns the pipeline's type refusal into a sentence naming what the slot takes", async () => {
    const { MediaError } = await import("@/lib/media/rules");
    vi.mocked(acceptUpload).mockRejectedValueOnce(new MediaError("typeNotAllowed"));
    const state = await attachSubtitleAction(EMPTY, form({ id: "u-1" }, SMALL));
    expect(state.error).toContain("coursesSlotNotAttachable");
    expect(state.error).toContain("slotSubtitleTypes");
    expect(setUnitMedia).not.toHaveBeenCalled();
  });
});

describe("🚨 AC 3b — the size refusal the browser cannot be trusted with", () => {
  it("refuses a file over the real ceiling without spending a rate-limit slot", async () => {
    const state = await attachWorksheetAction(
      EMPTY,
      form({ id: "u-1" }, { name: "handout.pdf", size: SERVER_ACTION_BODY_LIMIT_BYTES + 1 }),
    );

    expect(state.error).toContain("coursesUploadTooLarge");
    expect(acceptUpload).not.toHaveBeenCalled();
    expect(setUnitMedia).not.toHaveBeenCalled();
    // Deliberate: the refusal needs nobody to look at the bytes, so metering it
    // would spend an hour's allowance on a mistake.
    expect(guardUploadEntry).not.toHaveBeenCalled();
  });

  it("🚨 the ceiling is the BODY limit, not the 50 MB config/media.json allows a file", async () => {
    // Story 5.4's measured finding, still true for the three slots that travel
    // through the app. `kinds.file.maxBytes` is 50 MB and 50 MB never arrives:
    // `next.config.ts` caps a Server Action body at 10, and Next refuses while
    // decoding — before this action exists. The VIDEO slot no longer has this
    // ceiling at all: it does not come through here (see the direct pair below),
    // which is the whole reason its number could move to 2 GB.
    const state = await attachWorksheetAction(
      EMPTY,
      form({ id: "u-1" }, { name: "handout.pdf", size: 40 * 1024 * 1024 }),
    );
    expect(state.error).toContain("coursesUploadTooLarge");
  });

  it("🚨 lets a file at the ceiling through — the refusals above are not vacuous", async () => {
    const state = await attachWorksheetAction(
      EMPTY,
      form({ id: "u-1" }, { name: "kurz.pdf", size: SERVER_ACTION_BODY_LIMIT_BYTES }),
    );
    expect(state.error).toBeNull();
    expect(acceptUpload).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty submission before anything else", async () => {
    const state = await attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }));
    expect(state.error).toContain("noFile");
    expect(guardUploadEntry).not.toHaveBeenCalled();
  });
});

describe("🚨 Story 8.2 — the video slot goes straight to the bucket", () => {
  const MINT = { id: "u-1", mime: "video/mp4", filename: "lektion.mp4", bytes: 900_000_000 };

  it("mints an ENTITLED ticket under the course's own Product Key", async () => {
    const answer = await mintVideoTicketAction(MINT);

    expect(answer.error).toBeNull();
    expect(answer.ticketId).toBe("ticket-1");
    expect(answer.url).toBe("https://bucket.example.com/put");
    expect(vi.mocked(createUploadTicket).mock.calls[0][0]).toMatchObject({
      ownerId: "owner-1",
      role: "owner",
      // This module's own namespace and the slot as the category — recorded on
      // the ticket, so the delivery key an hour later says `courses/video/…`
      // rather than the kind the bytes turned out to be.
      namespace: "courses",
      category: "video",
      visibility: "entitled",
      requiresPlan: "kurs_komplett",
      claimedMime: "video/mp4",
      declaredBytes: 900_000_000,
    });
  });

  it("🚨 ignores a crafted call that names a visibility and a plan of its own", async () => {
    // The probe Story 5.4 wrote for the through-the-app route, now for the
    // direct one — and it matters MORE here, because the HTTP door that mints
    // tickets pins `owner` and this is the only place `entitled` is reachable.
    await mintVideoTicketAction({
      ...MINT,
      ...({ visibility: "public", requiresPlan: "fremd_plan" } as unknown as object),
    });

    const passed = vi.mocked(createUploadTicket).mock.calls[0][0];
    expect(passed.visibility).toBe("entitled");
    expect(passed.requiresPlan).toBe("kurs_komplett");
  });

  it("🚨 meters BEFORE it mints — the hourly slot is spent at the address", async () => {
    await mintVideoTicketAction(MINT);
    expect(guardUploadEntry).toHaveBeenCalledWith("owner-1");
    expect(vi.mocked(guardUploadEntry).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createUploadTicket).mock.invocationCallOrder[0],
    );
  });

  it("refuses a claim that is not one of the slot's two types, without minting", async () => {
    // `confirmUpload()` reads the object's own first bytes and would agree with
    // a PDF that claimed to be one. Nothing later narrows to this SLOT, so this
    // is where it happens.
    const answer = await mintVideoTicketAction({ ...MINT, mime: "application/pdf" });
    expect(answer.error).toContain("coursesSlotNotAttachable");
    expect(createUploadTicket).not.toHaveBeenCalled();
    expect(guardUploadEntry).not.toHaveBeenCalled();
  });

  it("refuses a content row, names its file, and spends nothing", async () => {
    vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never);
    vi.mocked(contentFileIndex).mockReturnValue({
      blocks: new Map(),
      units: new Map([["woche-1-intro", "01-woche.json"]]),
      unreadable: [],
    });
    const answer = await mintVideoTicketAction({ ...MINT, id: "u-2" });
    expect(answer.error).toContain("coursesContentRowLocked");
    expect(answer.error).toContain("content/course/01-woche.json");
    expect(createUploadTicket).not.toHaveBeenCalled();
    expect(guardUploadEntry).not.toHaveBeenCalled();
  });

  it("🚨 confirming takes the guard that does NOT count, and never the one that does", async () => {
    // The slot was spent when the address was minted. Taking a second one would
    // count every direct upload twice and halve the operator's allowance.
    const state = await confirmVideoAction({ id: "u-1", ticketId: "ticket-1" });

    expect(state.error).toBeNull();
    expect(guardUploadConfirm).toHaveBeenCalledTimes(1);
    expect(guardUploadEntry).not.toHaveBeenCalled();
  });

  it("fills the column with the row the CONFIRM step wrote", async () => {
    await confirmVideoAction({ id: "u-1", ticketId: "ticket-1" });
    expect(confirmUpload).toHaveBeenCalledWith({
      ticketId: "ticket-1",
      memberId: "owner-1",
      role: "owner",
      // 🚨 **The slot, on the confirm half as well as the mint half.** The core
      // refuses a ticket whose recorded pair is not the one the confirming door
      // names, so these two lines are what stop a ticket minted at the generic
      // `POST /api/media/upload-url` — which pins `core`/`upload` — from being
      // redeemed here and landing an object in this module's key space. It is the
      // same shape as the visibility re-check below, for the other half of the
      // question: not WHO may fetch it, but WHERE it goes.
      namespace: "courses",
      category: "video",
    });
    expect(setUnitMedia).toHaveBeenCalledWith("u-1", "video", "media-direct");
  });

  it("refuses a content row on the confirm half too, and writes no column", async () => {
    vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never);
    const state = await confirmVideoAction({ id: "u-2", ticketId: "ticket-1" });
    expect(state.error).toContain("coursesContentRowLocked");
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(setUnitMedia).not.toHaveBeenCalled();
  });

  it("does not put a non-video row in the video column, whatever confirmed it", async () => {
    // Defence in depth: `agreedMime()` has no alias that turns a `video/mp4`
    // claim into another type today, and an alias added to `lib/media/sniff.ts`
    // a year from now must not quietly widen what this column holds.
    vi.mocked(confirmUpload).mockResolvedValue({
      id: "media-odd",
      mime: "video/quicktime",
      visibility: "entitled",
      requiresPlan: "kurs_komplett",
    } as never);
    const state = await confirmVideoAction({ id: "u-1", ticketId: "ticket-1" });
    expect(state.error).toContain("coursesSlotNotAttachable");
    expect(setUnitMedia).not.toHaveBeenCalled();
  });

  it("🚨 refuses a ticket that was minted with another visibility, and writes no column", async () => {
    // The second door — `POST /api/media/upload-url` — mints for the same owner
    // and pins `visibility: "owner"`. `confirmUpload()` validates the owner and
    // the expiry, never these two fields, so without the check here an operator
    // could mint there, confirm here, and hang a row on the lesson that
    // `mayAccess()` gives to nobody but them: every buyer would get a clean 200
    // with the video missing.
    vi.mocked(confirmUpload).mockResolvedValue({
      id: "media-owner-only",
      mime: "video/mp4",
      visibility: "owner",
      requiresPlan: null,
    } as never);
    const state = await confirmVideoAction({ id: "u-1", ticketId: "ticket-1" });
    expect(state.error).toContain("coursesUploadTicketMismatch");
    expect(setUnitMedia).not.toHaveBeenCalled();
  });

  it("🚨 refuses a ticket that carries another course's Product Key", async () => {
    // The hour a ticket lives is long enough for `config/course.json` to be
    // edited, and a two-gigabyte upload is long enough to span it. A lesson
    // hanging on the old key is a lesson its buyers cannot fetch.
    vi.mocked(confirmUpload).mockResolvedValue({
      id: "media-stale",
      mime: "video/mp4",
      visibility: "entitled",
      requiresPlan: "ein_anderer_kurs",
    } as never);
    const state = await confirmVideoAction({ id: "u-1", ticketId: "ticket-1" });
    expect(state.error).toContain("coursesUploadTicketMismatch");
    expect(setUnitMedia).not.toHaveBeenCalled();
  });

  it("turns the media layer's refusal into a sentence rather than a crash", async () => {
    const { MediaError } = await import("@/lib/media/rules");
    vi.mocked(confirmUpload).mockRejectedValueOnce(new MediaError("uploadTicketInvalid"));
    const state = await confirmVideoAction({ id: "u-1", ticketId: "gone" });
    expect(state.error).toContain("uploadTicketInvalid");
    expect(setUnitMedia).not.toHaveBeenCalled();
  });

  it("lets the outer guard's refusal through when minting", async () => {
    const { MediaError } = await import("@/lib/media/rules");
    vi.mocked(guardUploadEntry).mockImplementationOnce(() => {
      throw new MediaError("rateLimited");
    });
    const answer = await mintVideoTicketAction(MINT);
    expect(answer.error).toContain("rateLimited");
    expect(createUploadTicket).not.toHaveBeenCalled();
  });
});

describe("🚨 AC 4 — a content row is unreachable from all four form actions", () => {
  const AGAINST_CONTENT = [
    { name: "attachCoverAction", run: () => attachCoverAction(EMPTY, form({ id: "u-2", alt: "x" }, SMALL)) },
    { name: "attachSubtitleAction", run: () => attachSubtitleAction(EMPTY, form({ id: "u-2" }, SMALL)) },
    { name: "attachWorksheetAction", run: () => attachWorksheetAction(EMPTY, form({ id: "u-2" }, SMALL)) },
    { name: "detachSlotAction", run: () => detachSlotAction(EMPTY, form({ id: "u-2", slot: "cover" })) },
  ] as const;

  for (const { name, run } of AGAINST_CONTENT) {
    it(`${name} refuses with coursesContentRowLocked AND writes nothing`, async () => {
      vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never);
      const state = await run();

      expect(state.error).toContain("coursesContentRowLocked");
      expect(state.ok).toBeNull();
      expect(setUnitMedia).not.toHaveBeenCalled();
      expect(acceptUpload).not.toHaveBeenCalled();
      // Not even the outer guard: a locked row is refused before a byte is
      // considered, so it costs the operator none of their hourly allowance.
      expect(guardUploadEntry).not.toHaveBeenCalled();
    });
  }

  it("names the file the lesson came from", async () => {
    vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never);
    vi.mocked(contentFileIndex).mockReturnValue({
      blocks: new Map(),
      units: new Map([["woche-1-intro", "01-woche.json"]]),
      unreadable: [],
    });
    const state = await attachWorksheetAction(EMPTY, form({ id: "u-2" }, SMALL));
    expect(state.error).toContain("content/course/01-woche.json");
  });

  it("says so honestly when no file claims it any more", async () => {
    vi.mocked(unitById).mockResolvedValue(CONTENT_UNIT as never);
    const state = await attachWorksheetAction(EMPTY, form({ id: "u-2" }, SMALL));
    expect(state.error).toContain("originContentOrphan");
  });

  it("🚨 the loop above is not vacuous — an operator row goes through", async () => {
    const state = await attachWorksheetAction(EMPTY, form({ id: "u-1" }, SMALL));
    expect(state.error).toBeNull();
    expect(setUnitMedia).toHaveBeenCalledWith("u-1", "worksheet", "media-new");
  });
});

describe("🚨 AC 7 — detaching cuts the connection and deletes nothing", () => {
  it("sets the column to null", async () => {
    const state = await detachSlotAction(EMPTY, form({ id: "u-1", slot: "worksheet" }));
    expect(state.error).toBeNull();
    expect(setUnitMedia).toHaveBeenCalledWith("u-1", "worksheet", null);
  });

  it("🚨 never calls deleteMedia — not for any slot", async () => {
    // The acceptance criterion, and the four reasons are on `setUnitMedia()`:
    // one file can hang on two lessons, the delete takes the object first and
    // is irreversible, a lesson cover is the PRODUCT rather than the person,
    // and the price — an orphaned object — is named rather than hidden.
    for (const slot of ["cover", "video", "subtitle", "worksheet"]) {
      await detachSlotAction(EMPTY, form({ id: "u-1", slot }));
    }
    expect(setUnitMedia).toHaveBeenCalledTimes(4);
    expect(deleteMedia).not.toHaveBeenCalled();
  });

  it("refuses a slot name nobody declared", async () => {
    const state = await detachSlotAction(EMPTY, form({ id: "u-1", slot: "banner" }));
    expect(state.error).toContain("coursesSlotNotAttachable");
    expect(setUnitMedia).not.toHaveBeenCalled();
  });
});

describe("🚨 the guard sequence — every action asks, per request", () => {
  const ALL = [
    { name: "attachCoverAction", run: () => attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL)) },
    { name: "attachSubtitleAction", run: () => attachSubtitleAction(EMPTY, form({ id: "u-1" }, SMALL)) },
    {
      name: "mintVideoTicketAction",
      run: () =>
        mintVideoTicketAction({ id: "u-1", mime: "video/mp4", filename: "l.mp4", bytes: 1_000 }),
    },
    { name: "confirmVideoAction", run: () => confirmVideoAction({ id: "u-1", ticketId: "t" }) },
    { name: "attachWorksheetAction", run: () => attachWorksheetAction(EMPTY, form({ id: "u-1" }, SMALL)) },
    { name: "detachSlotAction", run: () => detachSlotAction(EMPTY, form({ id: "u-1", slot: "cover" })) },
  ] as const;

  for (const { name, run } of ALL) {
    it(`${name}: a switched-off course is not found`, async () => {
      vi.mocked(isCourseEnabled).mockReturnValue(false);
      await expect(run()).rejects.toThrow("TEST_NOT_FOUND");
      expect(requireOwner).not.toHaveBeenCalled();
    });

    it(`${name}: a member is refused`, async () => {
      vi.mocked(requireOwner).mockRejectedValue(new Error("TEST_REDIRECT"));
      await expect(run()).rejects.toThrow("TEST_REDIRECT");
      expect(setUnitMedia).not.toHaveBeenCalled();
      expect(acceptUpload).not.toHaveBeenCalled();
    });
  }

  it("🚨 off beats owner — the switch is asked BEFORE the session", async () => {
    // There is no admin preview of a switched-off module; switching it on is an
    // edit to config/course.json plus a deploy.
    vi.mocked(isCourseEnabled).mockReturnValue(false);
    vi.mocked(requireOwner).mockRejectedValue(new Error("TEST_REDIRECT"));
    await expect(attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL))).rejects.toThrow(
      "TEST_NOT_FOUND",
    );
  });
});

describe("what a write reports back", () => {
  it("a missing row is a refusal, not a crash", async () => {
    vi.mocked(unitById).mockResolvedValue(null as never);
    const state = await attachCoverAction(EMPTY, form({ id: "nope", alt: "x" }, SMALL));
    expect(state.error).toContain("coursesNotFound");
  });

  it("every action ends with a message — none of them is silent", async () => {
    const results = [
      await attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL)),
      await confirmVideoAction({ id: "u-1", ticketId: "ticket-1" }),
      await attachSubtitleAction(EMPTY, form({ id: "u-1" }, SMALL)),
      await attachWorksheetAction(EMPTY, form({ id: "u-1" }, SMALL)),
      await detachSlotAction(EMPTY, form({ id: "u-1", slot: "cover" })),
    ];
    for (const state of results) {
      expect(state.error).toBeNull();
      expect(state.ok, "an action that reports nothing feels like an error").toBeTruthy();
    }
  });

  it("an unexpected failure becomes the unknown error, not a stack trace", async () => {
    vi.mocked(setUnitMedia).mockRejectedValue(new Error("pool exhausted"));
    const state = await detachSlotAction(EMPTY, form({ id: "u-1", slot: "cover" }));
    expect(state.error).toContain("errors.unknown");
  });

  it("🚨 a course with no Product Key faults rather than storing an unreachable file", async () => {
    // Unreachable behind the guard — a missing productKey is `brokenConfig`, so
    // `isCourseEnabled()` is false. Written out anyway, because passing `null`
    // on would make `acceptUpload()` answer MediaError("noAccess"): a sentence
    // about the VIEWER for a fault in the config.
    vi.mocked(courseConfig).mockReturnValue({
      enabled: true,
      shape: "self-study",
      productKey: null,
      operatorPreviewsUnlocked: true,
    } as never);
    const state = await attachCoverAction(EMPTY, form({ id: "u-1", alt: "x" }, SMALL));
    expect(state.error).toContain("errors.unknown");
    expect(acceptUpload).not.toHaveBeenCalled();
  });
});
