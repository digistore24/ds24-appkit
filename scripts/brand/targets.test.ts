// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The icon list exists twice — `scripts/brand/targets.mjs` (a script, running
// before any bundler) and `PWA_ICONS` in `lib/pwa/manifest.ts` (the app). This
// file is what stops the two drifting: it is `.ts`, so it can import both.
//
// The failure it prevents is nasty and remote: a generator that writes 256 px
// into `icon-512.png` makes Chrome refuse to install the app while saying
// nothing useful, and the only symptom is on somebody's phone. `manifest.test.ts`
// catches it — but in the CUSTOMER's suite, after they rebranded. This catches
// it here.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PWA_ICONS } from "@/lib/pwa/manifest";
import { ICON_TARGETS, MASKABLE_SAFE, MIN_LOGO_PX } from "./targets.mjs";

describe("the generator's targets and the manifest's icons", () => {
  const manifestTargets = ICON_TARGETS.filter((t) => t.manifest);

  it("declares one target per manifest icon and no more", () => {
    expect(manifestTargets).toHaveLength(PWA_ICONS.length);
  });

  it("🚨 agrees name for name and pixel for pixel", () => {
    for (const icon of PWA_ICONS) {
      const target = manifestTargets.find((t) => t.manifest === icon.src);
      expect(target, `nothing generates ${icon.src}`).toBeTruthy();
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(target!.size, `${icon.src} is declared ${icon.sizes}`).toBe(width);
      expect(width).toBe(height);
      expect(target!.file).toBe(`public${icon.src}`);
    }
  });

  it("pads exactly the maskable one", () => {
    // The same bitmap declared both ways is either a logo with a hole punched
    // in it or a postage stamp in the middle of a square.
    const padded = ICON_TARGETS.filter((t) => t.padding);
    expect(padded).toHaveLength(1);
    expect(padded[0].manifest).toBe(
      PWA_ICONS.find((i) => i.purpose === "maskable")!.src,
    );
    expect(padded[0].padding).toBe(MASKABLE_SAFE);
    // 60 % artwork, i.e. ~20 % padding per side — what Android's safe zone
    // guarantees and what CLAUDE.md states as a rule rather than a preference.
    expect(MASKABLE_SAFE).toBeCloseTo(0.6, 5);
  });
});

describe("the two file-convention icons", () => {
  it("carries them at the sizes CLAUDE.md names", () => {
    const byFile = Object.fromEntries(ICON_TARGETS.map((t) => [t.file, t]));
    expect(byFile["app/icon.png"].size).toBe(256);
    expect(byFile["app/apple-icon.png"].size).toBe(180);
  });

  it("🚨 keeps the apple icon opaque", () => {
    // iOS composites a transparent apple-touch-icon onto BLACK, so a dark mark
    // on transparency disappears on a home screen. A decision, not an oversight.
    const byFile = Object.fromEntries(ICON_TARGETS.map((t) => [t.file, t]));
    expect(byFile["app/apple-icon.png"].background).toBe("flat");
  });
});

describe("every target names a file that is really shipped", () => {
  it.each(ICON_TARGETS.map((t) => t.file))("%s exists", (file) => {
    expect(existsSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)))).toBe(true);
  });
});

describe("the floor under an upscale", () => {
  it("refuses anything a 512 px icon would blow up more than 4x", () => {
    expect(MIN_LOGO_PX).toBe(128);
    expect(512 / MIN_LOGO_PX).toBeLessThanOrEqual(4);
  });
});
