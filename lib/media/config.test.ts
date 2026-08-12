// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The shipped `config/media.json`, held to the same deal
// `lib/ai/chat-config.test.ts` makes: a second source of truth is only safe
// while something checks it against the first.
import { describe, expect, it, vi } from "vitest";

import raw from "@/config/media.json";

import {
  MEDIA_KINDS,
  SERVER_ACTION_BODY_LIMIT_BYTES,
  refuseUpload,
  slotCeilingBytes,
} from "./rules";
import { ROLES } from "@/lib/roles";
import { DEFAULT_MEDIA_CONFIG, mediaConfig, mediaConfigProblems, planProblem } from "./config";
import { driverFromEnv, mediaStoreProblems } from "./store";
import { keysOrSkip, planShapedKey, tokenKey } from "@/lib/digistore/test-product-keys";

describe("every role may upload something", () => {
  // The trap this closes, found by a code review of Story 19.2: `refuseUpload()`
  // reads `mayUpload[role] ?? []`, so a role that exists in `lib/roles.ts` but
  // has no line here may upload NOTHING — every type answers
  // `notAllowedForRole`, including the member's own avatar. It typechecks, no
  // test rendered it, and the symptom reaches the customer as a refusal that
  // names no cause. `moderator` shipped that way for exactly one commit.
  //
  // So the guard is against the CLASS: a new role is a new line here, in the
  // shipped JSON and in the default, or the build fails while somebody can
  // still read this comment.
  for (const role of ROLES) {
    it(`${role}: has a declared upload list, in the default and in the shipped file`, () => {
      expect(
        DEFAULT_MEDIA_CONFIG.mayUpload[role],
        `DEFAULT_MEDIA_CONFIG.mayUpload has no "${role}" — that role may upload nothing at all`,
      ).toBeDefined();
      expect(DEFAULT_MEDIA_CONFIG.mayUpload[role].length).toBeGreaterThan(0);

      const configured = mediaConfig().mayUpload[role];
      expect(
        configured,
        `config/media.json → mayUpload has no "${role}"`,
      ).toBeDefined();
      expect(configured.length).toBeGreaterThan(0);
    });

    it(`${role}: can actually put a picture in, measured through refuseUpload`, () => {
      // Not a restatement of the assertion above: this one goes through the
      // real function with the real config, which is where the `?? []` lives.
      expect(
        refuseUpload(mediaConfig(), { role, mime: "image/jpeg", bytes: 1000 }),
      ).toBeNull();
    });
  }

  it("still refuses a role nobody declared", () => {
    // The permissive direction is the one that must NOT be fixed by the above.
    expect(
      refuseUpload(mediaConfig(), { role: "guest", mime: "image/jpeg", bytes: 1000 }),
    ).toBe("notAllowedForRole");
  });

  it("keeps the archive types the operator's", () => {
    // A moderator keeps rooms clean; that is not a reason to let them hand
    // every customer a .zip. If this ever legitimately changes, it changes
    // here, deliberately.
    expect(
      refuseUpload(mediaConfig(), { role: "moderator", mime: "application/zip", bytes: 1000 }),
    ).toBe("notAllowedForRole");
    expect(
      refuseUpload(mediaConfig(), { role: "owner", mime: "application/zip", bytes: 1000 }),
    ).toBeNull();
  });
});

describe("the shipped media config", () => {
  it("is coherent", () => {
    // The build fails here rather than at a customer's first upload. The most
    // likely mistake is a role allowed to upload a media type that belongs to
    // no kind — a rule that can never be satisfied, whose symptom is a refusal
    // with a code that makes no sense.
    expect(mediaConfigProblems()).toEqual([]);
  });

  it("declares every kind", () => {
    const config = mediaConfig();
    for (const kind of MEDIA_KINDS) {
      expect(config.kinds[kind].mimeTypes.length).toBeGreaterThan(0);
      expect(config.kinds[kind].maxBytes).toBeGreaterThan(0);
      expect(config.kinds[kind].signedUrlSeconds).toBeGreaterThan(0);
    }
  });

  it("🚨 every declared ceiling survives the clamp", () => {
    // ── The silent failure this exists for ────────────────────────────────
    // `count()` CLAMPS with `Math.min` rather than refusing, so a `maxBytes`
    // above `MAX_BYTES_CEILING` is quietly replaced and the app runs on a
    // number nobody wrote. It really happened: Story 8.1 raised
    // `video.maxBytes` to 2 GB for the direct-to-bucket path while the clamp
    // still sat at 200 MB, and every test in this file stayed green — because
    // each of them asked whether the value was plausible, and none asked
    // whether it was the value in the file.
    //
    // Reading the JSON directly here is the point: comparing the effective
    // config against itself could not fail.
    const config = mediaConfig();
    const declared = (raw as { kinds: Record<string, { maxBytes?: number }> }).kinds;
    for (const kind of MEDIA_KINDS) {
      const wanted = declared[kind]?.maxBytes;
      if (typeof wanted !== "number") continue;
      expect(
        config.kinds[kind].maxBytes,
        `config/media.json declares ${wanted} bytes for "${kind}" and the app runs on ` +
          `${config.kinds[kind].maxBytes} — MAX_BYTES_CEILING in lib/media/config.ts clamped ` +
          `it, silently. Raise the clamp or lower the declaration; do not leave them ` +
          `disagreeing.`,
      ).toBe(wanted);
    }
  });

  it("gives the direct path a video ceiling a lesson recording fits in", () => {
    // The number Story 8.1 exists for. Below the 10 MB a request body carries
    // there is no direct path worth having, and `slotCeilingBytes()` keeps the
    // through-the-app door at that lower figure whatever this says.
    expect(mediaConfig().kinds.video.maxBytes).toBeGreaterThan(SERVER_ACTION_BODY_LIMIT_BYTES);
    expect(slotCeilingBytes(mediaConfig().kinds.video.maxBytes)).toBe(
      SERVER_ACTION_BODY_LIMIT_BYTES,
    );
  });

  it("gives video and audio a longer address life than images", () => {
    // Not a preference. Sixty seconds is plenty for a picture and takes a
    // forty-minute recording down the moment the player asks for a later byte
    // range — the symptom is a video that stops partway through, for some
    // viewers, sometimes.
    const config = mediaConfig();
    expect(config.kinds.video.signedUrlSeconds).toBeGreaterThan(
      config.kinds.image.signedUrlSeconds,
    );
    expect(config.kinds.audio.signedUrlSeconds).toBeGreaterThan(
      config.kinds.image.signedUrlSeconds,
    );
  });

  it("does not let a member upload an archive or an executable", () => {
    // A customer who can hand every other customer a .zip or a .exe is not a
    // media feature. Archives are the operator's.
    const member = mediaConfig().mayUpload.member ?? [];
    expect(member).not.toContain("application/zip");
    expect(member).not.toContain("application/x-msdownload");
  });

  it("accepts no SVG anywhere", () => {
    // An SVG is a document that can carry script. Serving one a customer
    // uploaded is handing every later visitor code somebody else wrote.
    for (const kind of MEDIA_KINDS) {
      expect(mediaConfig().kinds[kind].mimeTypes).not.toContain("image/svg+xml");
    }
  });
});

describe("defaults", () => {
  it("cover every kind, so a file that cannot be read still leaves a usable app", () => {
    for (const kind of MEDIA_KINDS) {
      expect(DEFAULT_MEDIA_CONFIG.kinds[kind]).toBeDefined();
    }
  });
});

describe("driverFromEnv", () => {
  it("treats unset as local, which is the ordinary state of a fresh clone", () => {
    expect(driverFromEnv({} as unknown as NodeJS.ProcessEnv)).toBe("local");
    expect(driverFromEnv({ MEDIA_DRIVER: "" } as unknown as NodeJS.ProcessEnv)).toBe("local");
  });

  it("reads s3", () => {
    expect(driverFromEnv({ MEDIA_DRIVER: "S3" } as unknown as NodeJS.ProcessEnv)).toBe("s3");
  });

  it("throws on anything else rather than falling back", () => {
    // The same refusal `scripts/db/driver.mjs` makes. Quietly starting the
    // wrong store is how an app writes customer files somewhere nobody
    // intended and nobody backs up.
    expect(() => driverFromEnv({ MEDIA_DRIVER: "s4" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("mediaStoreProblems", () => {
  it("is quiet for the local driver", () => {
    expect(mediaStoreProblems({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("names the missing bucket settings", () => {
    const problems = mediaStoreProblems({ MEDIA_DRIVER: "s3" } as unknown as NodeJS.ProcessEnv);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("MEDIA_S3_ENDPOINT");
  });

  it("is quiet once they are all there", () => {
    expect(
      mediaStoreProblems({
        MEDIA_DRIVER: "s3",
        MEDIA_S3_ENDPOINT: "https://fra1.digitaloceanspaces.com",
        MEDIA_S3_BUCKET: "b",
        MEDIA_S3_ACCESS_KEY_ID: "k",
        MEDIA_S3_SECRET_ACCESS_KEY: "s",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual([]);
  });
});

// ── The lint that switched the whole feature off ───────────────────────────
//
// Added after a code review measured it. `mediaConfigProblems()` grew a check
// for image formats `exif.ts` cannot strip, and `isMediaEnabled()` was
// `enabled && problems.length === 0` — so `image/gif`, which every app
// generated before that change still carries (because `node run.mjs update`
// deliberately never touches `config/`), turned the media feature OFF: uploads
// 503 and every already-stored item 404, photographs and GIFs alike.
//
// The rule these tests hold in place: a configuration mistake refuses what it
// is about, and never stops delivery of what is already in the bucket.

describe("a config problem does not disable delivery", () => {
  it("reports an unstrippable image type without switching media off", async () => {
    vi.resetModules();
    vi.doMock("@/config/media.json", () => ({
      default: {
        enabled: true,
        kinds: { image: { mimeTypes: ["image/jpeg", "image/gif"], maxBytes: 1000 } },
        mayUpload: { owner: ["image/jpeg", "image/gif"] },
      },
    }));
    const mod = await import("./config");

    expect(mod.mediaConfigProblems().join("\n")).toMatch(/image\/gif/);
    // The whole point: still on.
    expect(mod.isMediaEnabled()).toBe(true);
    // And the refusal is exactly as wide as the fault — a GIF upload is
    // refused because no kind accepts it, while JPEG is untouched.
    expect(mod.mediaConfig().kinds.image.mimeTypes).toContain("image/jpeg");
    expect(mod.mediaConfig().kinds.image.mimeTypes).not.toContain("image/gif");
    vi.doUnmock("@/config/media.json");
    vi.resetModules();
  });

  it("drops an SVG from the accepted list rather than refusing to serve anything", async () => {
    vi.resetModules();
    vi.doMock("@/config/media.json", () => ({
      default: {
        enabled: true,
        kinds: { image: { mimeTypes: ["image/png", "image/svg+xml"], maxBytes: 1000 } },
        mayUpload: { owner: ["image/png"] },
      },
    }));
    const mod = await import("./config");

    expect(mod.mediaConfigProblems().join("\n")).toMatch(/SVG/);
    expect(mod.isMediaEnabled()).toBe(true);
    expect(mod.mediaConfig().kinds.image.mimeTypes).not.toContain("image/svg+xml");
    vi.doUnmock("@/config/media.json");
    vi.resetModules();
  });

  it("is off only when the switch says so", async () => {
    vi.resetModules();
    vi.doMock("@/config/media.json", () => ({ default: { enabled: false } }));
    const mod = await import("./config");
    expect(mod.isMediaEnabled()).toBe(false);
    vi.doUnmock("@/config/media.json");
    vi.resetModules();
  });
});

// ── `planProblem()`, which decides whether a sold file can ever be fetched ──
//
// Named as untested by the first review pass and not addressed by it. It is the
// guard standing between `requiresPlan` and `hasPlan()`, and `hasPlan()`
// **throws** on a Product Key it does not know — so a wrong value here does not
// mean "no access", it means the page rendering the item is a 500.

describe("planProblem", () => {
  // 🚨 Read out of THIS app's registry, never written in. The shipped example
  // products are the operator's to delete — CLAUDE.md tells them to — and a
  // literal here turned that instruction into a red suite. Where a shape is
  // genuinely absent the test skips and SAYS SO: see
  // `lib/digistore/test-product-keys.ts`.
  const PLAN = planShapedKey();
  const TOKEN = tokenKey();

  it("accepts a Product Key that grants access", (ctx) => {
    // A subscription — or a one-off — is a right, which is what `entitled`
    // visibility needs.
    const [plan] = keysOrSkip(ctx, PLAN);
    expect(planProblem(plan)).toBeNull();
  });

  it("refuses a key that is in no registry at all", () => {
    // The case that takes a page down: `hasPlan()` throws on it. No lookup
    // needed — a key nothing holds is the one shape every registry has.
    expect(planProblem("no_such_plan")).toMatch(/no product/);
  });

  it("refuses a token package, naming why it could never work", (ctx) => {
    // A balance is a quantity, not a right. `hasPlan()` answers false for it
    // for ever, so a file behind one is a file nobody can ever fetch — and the
    // failure is silent, which is worse than the 500 above.
    //
    // ⚠️ It has to be a token package this app REALLY sells. Handed a key the
    // registry does not hold, this test went on passing — on the "no product"
    // branch above, which is a different refusal — and the claim it exists for
    // was no longer measured by anything.
    const [token] = keysOrSkip(ctx, TOKEN);
    const problem = planProblem(token);
    expect(problem).toMatch(/token package/);
    expect(problem).toMatch(/hasPlan/);
  });

  it("refuses an empty key rather than treating it as 'no plan needed'", () => {
    expect(planProblem("")).not.toBeNull();
  });
});
