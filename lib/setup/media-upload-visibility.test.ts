// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **What the FIRST act promises about who will be able to see the file.**
//
// `media_upload` is a two-act tool outside DEV: a `plan` describes what would
// happen and mints a confirmation token, and the `apply` that spends the token
// does it. The sentence the plan returns is what an operator reads before
// confirming, so it has to name the visibility the second act will really store.
//
// It did not. The schema carried `default: "public"`, `validateInput()`
// materialises a schema default into the validated input, and so both halves
// said "public" while `acceptUpload()`'s own fallback said `owner` — the two
// agreed only because the wrong value had been forced into the input. Security
// review 2026-08-18, L-2. With the default gone, this line is the only thing
// keeping the plan's sentence and the applied row together, so it is measured.
//
// ── Why the tool's `run()` is called directly ──────────────────────────────
// In `plan` mode it returns before `guardUploadEntry()` and before
// `acceptUpload()`, so there is no database, no bucket and no mock in this file
// at all. The schema half of the same finding is measured in `registry.test.ts`
// ("no schema default hands out a wider visibility than saying nothing does");
// this is the half that reads the sentence.
import { describe, expect, it } from "vitest";

// Through the registry and not `CORE_SETUP_TOOLS` directly: `tools.ts` pulls in
// `registry.ts` on its own way up, and importing the array first hands this file
// a half-built module (`CORE_SETUP_TOOLS is not iterable`). The registry is the
// door every other consumer uses anyway.
import { toolsByName } from "./registry";
import type { SetupContext } from "./types";

const mediaUpload = toolsByName().get("media_upload")!;

const context = (mode: "plan" | "apply"): SetupContext => ({
  appEnv: "production",
  ownerId: "owner-1",
  mode,
  file: {
    bytes: new Uint8Array(70),
    filename: "hero.png",
    claimedMime: "image/png",
  },
});

describe("🚨 media_upload's plan names the visibility the apply will store", () => {
  it("says owner when the call said nothing", async () => {
    // The finding, in one sentence: this used to read "…would be stored as
    // public" for a call that named no visibility at all.
    const result = await mediaUpload.run(context("plan"), { path: "/home/op/hero.png" });

    expect(result.mode).toBe("plan");
    expect(result.detail).toContain("would be stored as owner");
    expect(result.detail).not.toContain("public");
  });

  it("repeats an explicit visibility rather than inventing one", async () => {
    // The non-vacuity half. A sentence hard-coded to "owner" would satisfy the
    // test above and lie about every deliberate public upload — which is the
    // same class of defect from the other direction.
    const result = await mediaUpload.run(context("plan"), {
      path: "/home/op/hero.png",
      visibility: "public",
    });

    expect(result.detail).toContain("would be stored as public");
  });

  it("names the file it is about, and its length", async () => {
    // The rest of the sentence, held so that a rewrite of the visibility half
    // cannot quietly take the identifying half with it (A53's rule for refusals,
    // applied to the act an operator confirms).
    const result = await mediaUpload.run(context("plan"), { path: "/home/op/hero.png" });

    expect(result.detail).toContain("hero.png");
    expect(result.detail).toContain("70 bytes");
    expect(result.subjects).toEqual(["/home/op/hero.png"]);
  });
});
