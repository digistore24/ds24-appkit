// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One logo in, five icon files out.
//
// ── sharp is loaded lazily, and here that is copied rather than invented ────
// `lib/media/variants.ts` explains it at length: a static `import "sharp"`
// makes every consumer of the module resolve and dlopen libvips before running
// a line. Same import shape here.
//
// 🚨 **But the FAILURE posture is the opposite one, and the asymmetry is a
// decision.** In `lib/media/` the original is the product and a variant is an
// optimisation, so a missing sharp logs a line and the upload succeeds. Here
// the icon IS the product: producing nothing and reporting success would leave
// the template's placeholder on a rebranded app's home screen, which CLAUDE.md
// names as the usual way a half-done rebrand is noticed. So this refuses,
// loudly, and names the way out.
//
// ── SVG in, PNG out ────────────────────────────────────────────────────────
// Measured on this machine (sharp 0.35.3 / libvips 8.18.3 / rsvg 2.62.90): an
// SVG carrying `<script>alert(1)</script>` rasterises to a 512x512 PNG whose
// bytes contain no trace of the script. A PNG has no scripting; that is the
// real answer to "is it safe to accept an SVG here", and it is why the icons
// are a rasterisation rather than a copy.

import { readFileSync } from "node:fs";

import { ICON_TARGETS, MASKABLE_SAFE, MIN_LOGO_PX, SOFT_LOGO_PX } from "./targets.mjs";

/** sharp, or null with the reason. Never a static import — see the header. */
export async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch (error) {
    return null;
  }
}

/** Markup an SVG must not carry to be accepted as a build asset. */
const SVG_REFUSALS = [
  [/<script[\s>]/i, "it contains a <script> element"],
  [/<foreignObject[\s>]/i, "it contains a <foreignObject>"],
  [/<!ENTITY/i, "it declares an XML entity"],
  [/\bhref\s*=\s*["']?https?:/i, "it references something on another server"],
];

/**
 * Read and vet the logo.
 *
 * The SVG refusals are belt-and-braces: the rasteriser drops scripting anyway,
 * and `next.config.ts` serves the folder with scripting switched off. But a
 * file the operator is about to commit and serve deserves to be looked at once,
 * and "your designer's export has a script in it" is worth saying out loud.
 */
export async function readLogo(file) {
  const sharp = await loadSharp();
  if (!sharp) {
    return {
      error:
        "this installation has no working copy of sharp, so no icon can be rendered. " +
        "Reinstall dependencies (node run.mjs setup), or replace the five icon files by hand.",
    };
  }

  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    return { error: `cannot read ${file}` };
  }

  if (file.endsWith(".svgz") || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    return {
      error:
        "a gzipped SVG (.svgz) is refused: it carries NUL bytes, and " +
        "scripts/portability.test.ts fails on those anywhere in the tree. Save it uncompressed.",
    };
  }

  let meta;
  try {
    meta = await sharp(bytes).metadata();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/svg/i.test(message)) {
      return {
        error:
          "this copy of sharp was built without librsvg, so it cannot read an SVG. " +
          "Export the logo as a PNG (at least 512 px) and try again.",
      };
    }
    return { error: `sharp cannot read ${file}: ${message}` };
  }

  const vector = meta.format === "svg";
  const warnings = [];

  if (vector) {
    const text = bytes.toString("utf8");
    for (const [needle, why] of SVG_REFUSALS) {
      if (needle.test(text)) {
        return { error: `refusing ${file}: ${why}. Export it again without that, or hand over a PNG.` };
      }
    }
    // A CRLF SVG turns the customer's own `npm run test` red — portability.test
    // walks .svg (it is not in the binary exclusion list). Normalised on write.
    if (text.includes("\r\n")) {
      warnings.push("the file has Windows line endings; they will be normalised to LF on write");
    }
  }

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const longest = Math.max(width, height);
  const ratio = longest / Math.max(1, Math.min(width, height));

  if (!vector && longest < MIN_LOGO_PX) {
    return {
      error:
        `${file} is ${width}x${height}. That is a favicon, not a logo — the 512 px icon would be ` +
        `a ${(512 / Math.max(1, longest)).toFixed(1)}x upscale. Export it at 512 px or larger.`,
    };
  }
  if (!vector && longest < SOFT_LOGO_PX) {
    warnings.push(
      `the logo is ${longest} px, so the 512 px icon is a ${(512 / longest).toFixed(1)}x upscale and will look soft on a phone`,
    );
  }
  if (ratio > 3) {
    warnings.push(
      `the logo is ${ratio.toFixed(1)}:1 — the icons are square, so the mark will sit in a lot of empty space. ` +
        `A square mark makes better icons; keep the wide one for the header.`,
    );
  }

  const opaque = meta.hasAlpha !== true;
  if (opaque) {
    warnings.push(
      "the logo has no transparency, so the padded icons get a flat background sampled from its corner",
    );
  }

  return { bytes, format: meta.format, width, height, vector, opaque, warnings };
}

/** The flat background for the padded icons: the logo's own corner pixel. */
async function cornerColor(sharp, raster) {
  try {
    const { data } = await sharp(raster)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // A transparent corner means the logo floats; then white is the honest
    // answer for iOS, which composites onto black otherwise.
    if (data[3] < 8) return { r: 255, g: 255, b: 255, alpha: 1 };
    return { r: data[0], g: data[1], b: data[2], alpha: 1 };
  } catch {
    return { r: 255, g: 255, b: 255, alpha: 1 };
  }
}

/**
 * Every icon, from one logo.
 *
 * A vector source is rasterised ONCE at the largest size and every target is
 * downscaled from that single raster — so all five are provably the same
 * picture rather than five independent renders that could disagree.
 */
export async function renderIcons(logo, { flat } = {}) {
  const sharp = await loadSharp();
  if (!sharp) return { error: "sharp is not available" };

  const BASE = 1024;
  let raster;
  if (logo.vector) {
    // Density chosen so the rasterisation is at least BASE on its long edge.
    const density = Math.min(2400, Math.ceil((72 * BASE) / Math.max(1, Math.max(logo.width, logo.height))));
    raster = await sharp(logo.bytes, { density }).png().toBuffer();
  } else {
    raster = logo.bytes;
  }

  const background = flat ?? (await cornerColor(sharp, raster));
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const out = [];

  for (const target of ICON_TARGETS) {
    const flatBg = target.background === "flat";
    const inner = target.padding
      ? Math.round(target.size * MASKABLE_SAFE)
      : target.size;

    // `withoutEnlargement` is deliberately OFF — the opposite ruling from
    // lib/media/variants.ts. There the original is the product and a bigger
    // copy is pointless; here the pixel size is a CONTRACT with Chrome, and
    // manifest.test.ts reads the header and fails on a file that is smaller
    // than it claims.
    let pipeline = sharp(raster).resize(inner, inner, {
      fit: "contain",
      background: transparent,
    });

    if (target.padding) {
      const pad = target.size - inner;
      const top = Math.floor(pad / 2);
      const left = Math.floor(pad / 2);
      pipeline = pipeline.extend({
        top,
        bottom: pad - top,
        left,
        right: pad - left,
        background: flatBg ? background : transparent,
      });
    } else if (flatBg) {
      pipeline = pipeline.flatten({ background });
    }

    out.push({ ...target, bytes: await pipeline.png().toBuffer() });
  }

  return { icons: out, background };
}
