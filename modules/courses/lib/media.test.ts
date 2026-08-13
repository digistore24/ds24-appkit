// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A lesson's media, resolved for one viewer — and refused for another.
//
// 🚨 **The claim is that the PAGE decides nothing.** One `media` row, two
// viewers, and the difference between them is a purchase — so the same slot
// answers with an address for one and with `null` for the other, before any
// component has had a chance to render either. `mayAccess()` is the real one
// here: mocking it would leave the whole question to a spy that agrees.
//
// `mediaImageFor()` IS mocked, and that is the second half of the claim: it
// grants nothing and its own header says so, so the assertion worth making is
// that it was never REACHED for the viewer who may not have the file. An
// address minted and then withheld is an address that exists — and since Story
// 26.2 that goes for the narrower copies too: a `srcset` composed for somebody
// who may not have the original is the same defect three times over.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keysOrSkip, planShapedKey } from "@/lib/digistore/test-product-keys";

import type { MediaRow } from "@/db/schema-media";

const hasPlan = vi.fn<(memberId: string, productKey: string) => Promise<boolean>>();
vi.mock("@/lib/entitlements/manage", () => ({ hasPlan: (m: string, p: string) => hasPlan(m, p) }));

// The row lookup only; `mayAccess()` stays the shipped one.
const findMedia = vi.fn<(id: string) => Promise<MediaRow | null>>();
vi.mock("@/lib/media/manage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/manage")>()),
  findMedia: (id: string) => findMedia(id),
}));

const mediaImageFor = vi.fn(() => ({
  src: "https://bucket.example/signed",
  srcSet: "https://bucket.example/signed-w480 480w, https://bucket.example/signed 1200w",
  width: 1200,
  height: 800,
}));
vi.mock("@/lib/media/url", () => ({ mediaImageFor: () => mediaImageFor() }));

// Never reached — `unitMedia()` touches no table — but `../lib/media.ts` imports
// the client for its batched operator-side read, and a real one would try to
// resolve a connection string at import time.
vi.mock("@/db", () => ({ db: {} }));

const { unitMedia } = await import("./media");

// 🚨 The course's Product Key comes out of THIS app's registry, never out of a
// literal. `mayAccess()` uses the real `planProblem()`, so a key the operator
// deleted — CLAUDE.md tells them to delete the examples they do not sell — turns
// the positive case red and, worse, makes every refusal below pass for the wrong
// reason: "no such product" instead of "hasPlan() said no". Absent shape, skipped
// test with the reason printed: `lib/digistore/test-product-keys.ts`.
const PLAN = planShapedKey();

/** A worksheet the course sells: `entitled`, under the course's own plan. */
function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m-1",
    ownerId: "owner-1",
    kind: "file",
    visibility: "entitled",
    // A placeholder only where there is no plan-shaped product at all — every
    // test that would read it skips first, and says why.
    planKeys: [PLAN.key ?? "no-plan-shaped-product-in-this-app"],
    storageKey: "courses/worksheet/2026/08/m-1.pdf",
    mime: "application/pdf",
    filename: "arbeitsblatt.pdf",
    bytes: 2048,
    width: null,
    height: null,
    durationSeconds: null,
    sha256: "x",
    source: "upload",
    alt: null,
    prompt: null,
    provider: null,
    model: null,
    createdAt: new Date(),
    ...over,
  } as MediaRow;
}

const SLOTS = {
  coverMediaId: null,
  videoMediaId: null,
  subtitleMediaId: null,
  worksheetMediaId: "m-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  findMedia.mockResolvedValue(row());
  hasPlan.mockResolvedValue(false);
  mediaImageFor.mockReturnValue({
    src: "https://bucket.example/signed",
    srcSet: "https://bucket.example/signed-w480 480w, https://bucket.example/signed 1200w",
    width: 1200,
    height: 800,
  });
});

describe("🚨 AC 1 — the same row, two viewers, and the page decides neither", () => {
  it("hands the file to a member who holds the course's plan", async (ctx) => {
    const [plan] = keysOrSkip(ctx, PLAN);
    hasPlan.mockResolvedValue(true);
    const media = await unitMedia(SLOTS, { memberId: "buyer", role: "member" });

    expect(media.worksheet).not.toBeNull();
    expect(media.worksheet?.href).toBe("https://bucket.example/signed");
    // The candidate list travels with the address, out of the same function —
    // which is what stops a page composing one for itself.
    expect(media.worksheet?.srcSet).toContain("480w");
    expect(media.worksheet?.width).toBe(1200);
    expect(hasPlan).toHaveBeenCalledWith("buyer", plan);
  });

  it("🚨 hands a member without it NOTHING — no placeholder, no hint", async (ctx) => {
    keysOrSkip(ctx, PLAN);
    hasPlan.mockResolvedValue(false);
    const media = await unitMedia(SLOTS, { memberId: "browser", role: "member" });

    expect(media.worksheet).toBeNull();
    // `null` covers "no id", "no row" and "not allowed" alike, deliberately:
    // telling the second apart from the third would tell a non-buyer that a
    // worksheet exists.
    expect(media.cover).toBeNull();
  });

  it("🚨 never mints an address for the viewer who may not have it", async (ctx) => {
    keysOrSkip(ctx, PLAN);
    // The order, not merely the outcome. `mediaImageFor()` grants nothing — an
    // address minted and then withheld is an address that exists, and the whole
    // reason the two calls live in ONE function is that a page is where the
    // first of them gets skipped.
    hasPlan.mockResolvedValue(false);
    await unitMedia(SLOTS, { memberId: "browser", role: "member" });
    expect(mediaImageFor).not.toHaveBeenCalled();
  });

  it("hands a signed-out visitor nothing, without asking the entitlement layer", async (ctx) => {
    keysOrSkip(ctx, PLAN);
    const media = await unitMedia(SLOTS, { memberId: null, role: null });
    expect(media.worksheet).toBeNull();
    expect(hasPlan).not.toHaveBeenCalled();
    expect(mediaImageFor).not.toHaveBeenCalled();
  });

  it("lets the operator preview their own product", async (ctx) => {
    keysOrSkip(ctx, PLAN);
    // Deliberate asymmetry, and it is `mayAccess()`'s: an operator may fetch
    // `entitled` content — they uploaded it and they sell it — while a
    // customer's own `owner` upload stays out of reach.
    const media = await unitMedia(SLOTS, { memberId: "owner-1", role: "owner" });
    expect(media.worksheet).not.toBeNull();
    expect(hasPlan).not.toHaveBeenCalled();
  });

  it("an empty slot is null without a lookup at all", async () => {
    const media = await unitMedia(
      { ...SLOTS, worksheetMediaId: null },
      { memberId: "buyer", role: "member" },
    );
    expect(media.worksheet).toBeNull();
    expect(findMedia).not.toHaveBeenCalled();
  });
});
