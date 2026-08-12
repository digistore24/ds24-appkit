// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The narrower copies of a picture, made while the bytes are already here.
//
// ── Why this exists at all ─────────────────────────────────────────────────
// `next.config.ts` declares no `images.remotePatterns`, and its comment there
// argues both halves of that decision: this file is evaluated at BUILD time
// while `MEDIA_S3_*` are set at RUN time (so the pattern would bake as an empty
// list and every bucket image would answer 400 in production), and a pattern for
// a shared bucket host with no `pathname` turns `/_next/image` into an open
// resizing proxy for every bucket in that region. So bucket media goes to the
// browser `unoptimized`, and until this file existed the cost was stated plainly
// and carried: a 4 MB photo taken on a phone reached a phone at full size, with
// nothing in the template catching it.
//
// Deriving the widths at upload needs no proxy, no run-time configuration and no
// per-request CPU. The browser then chooses, through an `<img srcset>` that
// `lib/media/url.ts` mints — see `mediaImageFor()` for why that cannot go
// through `next/image`.
//
// ── Two properties that are decisions, not details ─────────────────────────
//
//  1. 🚨 **A variant that cannot be produced must NOT fail the upload.** The
//     original is the product; a variant is an optimisation. Losing a member's
//     picture — or a lesson cover an operator just waited two minutes for — to a
//     resize error, a bucket hiccup or a codec libvips was built without is the
//     wrong trade in every direction. So everything here is best-effort: the
//     failure goes to the log where `node run.mjs errors` finds it, the row
//     records the widths that really landed, and the item works.
//  2. **It runs AFTER `stripMetadata()`, and that ordering is load-bearing.**
//     `acceptUpload()` strips GPS and camera data and hands the STRIPPED bytes
//     to `createMedia()`, which is where this is called from — so a variant
//     cannot carry EXIF the original just lost. sharp also writes no metadata of
//     its own unless asked (`withMetadata()`, which is deliberately not called),
//     which makes that true twice rather than by luck.
//
// ── Where it may be read ───────────────────────────────────────────────────
// From `lib/media/manage.ts` only. It writes objects, so it belongs behind the
// one file that owns rows-and-bytes together.
import type { MediaKind } from "./rules";
import { variantKey, variantWidthsFor } from "./rules";
import { mediaStore } from "./store";

/**
 * What was learnt about the bytes, and what was written beside them.
 *
 * `variants: null` means the question does not apply to this item at all — see
 * the three states on `media.variants` in `db/schema-media.ts`. An empty array
 * means it was asked and the answer is none.
 */
export interface DerivedImage {
  variants: number[] | null;
  width: number | null;
  height: number | null;
}

/** Nothing was asked: the honest answer for a video, a PDF, a recording. */
const NOT_ASKED: DerivedImage = { variants: null, width: null, height: null };

/**
 * The image types this app resizes.
 *
 * The same three `lib/media/exif.ts` strips, and that is not a coincidence:
 * these are the raster formats a customer's camera and a designer's export
 * actually produce, and they are the ones a resize is lossless-in-intent for.
 *
 * ⚠️ **`image/gif` is deliberately absent.** A GIF may be animated, and
 * resizing one through sharp without `{ animated: true }` silently keeps the
 * first frame — an upload that visibly stops moving. With it, the output is a
 * multi-megabyte re-encode that is routinely LARGER than the original, which
 * defeats the whole purpose. A GIF therefore gets its measurements and no
 * variants, which the delivery side reads as "serve the original".
 */
const RESIZABLE = ["image/jpeg", "image/png", "image/webp"];

/**
 * Measure a picture and write its narrower copies.
 *
 * Answers what to put on the row. Never throws: see property 1 in the header.
 */
export async function deriveImageVariants(input: {
  kind: MediaKind;
  mime: string;
  bytes: Uint8Array;
  /** The row's own `storageKey`, already written. Variants are its siblings. */
  deliveryKey: string;
}): Promise<DerivedImage> {
  if (input.kind !== "image") return NOT_ASKED;

  const sharp = await loadSharp();
  if (!sharp) return { variants: [], width: null, height: null };

  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(input.bytes).metadata();
    // `metadata()` types both as optional: a format sharp opened but cannot
    // describe answers `undefined`, and `0` would be a lie a `??` would tell.
    width = typeof meta.width === "number" && meta.width > 0 ? meta.width : null;
    height = typeof meta.height === "number" && meta.height > 0 ? meta.height : null;
  } catch (error) {
    // A file that sniffed as an image and that libvips cannot open. The upload
    // stands — `agreedMime()` already decided what this is from its own first
    // bytes, and that decision is not sharp's to overturn.
    console.error("[media] could not measure an image:", error);
    return { variants: [], width: null, height: null };
  }

  if (!RESIZABLE.includes(input.mime) || width === null) {
    return { variants: [], width, height };
  }

  const written: number[] = [];
  for (const target of variantWidthsFor(width)) {
    try {
      const resized = await sharp(input.bytes)
        // `withoutEnlargement` on top of the width filter in
        // `variantWidthsFor()`: two guards for the same thing, because an
        // upscaled variant is bytes spent to serve a worse picture than the
        // original, and only one of the two guards is visible at the call site.
        .resize({ width: target, withoutEnlargement: true })
        // No `.withMetadata()`, deliberately — see property 2 in the header.
        .toBuffer();

      // ⚠️ **`bytelength` is checked, not assumed.** libvips can answer an empty
      // buffer for a page it decoded but could not encode, and an empty object
      // in the bucket is a broken image the row would then advertise.
      if (resized.byteLength === 0) {
        console.error(`[media] the ${target}px variant of ${input.deliveryKey} came back empty`);
        continue;
      }

      await mediaStore().put(variantKey(input.deliveryKey, target), resized, input.mime);
      written.push(target);
    } catch (error) {
      // One width failing does not stop the others, and none of them failing
      // stops the upload. A missing variant is a picture served at full size —
      // which is what every picture did before this file existed.
      console.error(`[media] could not derive the ${target}px variant:`, error);
    }
  }

  return { variants: written, width, height };
}

/**
 * Remove the sibling objects a row's `variants` list names.
 *
 * 🚨 **A failure THROWS, and that is the same ruling `deleteMedia()` makes about
 * the original.** The row's `variants` column is the only record that these
 * objects exist — `MediaStore` has no `list()` — so dropping the row while a
 * copy survives loses the only pointer to a file somebody asked to have deleted,
 * and no later run can find it. Best-effort is right when WRITING a variant and
 * wrong when removing one; the two directions are not symmetrical, because only
 * one of them is a deletion request.
 */
export async function removeImageVariants(row: {
  storageKey: string;
  variants: number[] | null;
}): Promise<void> {
  for (const width of row.variants ?? []) {
    await mediaStore().remove(variantKey(row.storageKey, width));
  }
}

/**
 * sharp, or `null` when this installation has no working copy of it.
 *
 * ⚠️ **Imported lazily, and that is not a micro-optimisation.** `sharp` is a
 * native module: a static import would make every consumer of
 * `lib/media/manage.ts` — the upload route, the Server Actions, the account
 * export, three dozen unit tests — resolve and dlopen libvips before running a
 * line, and a platform without a prebuilt binary would take the whole media
 * layer down rather than one optimisation. `package.json` declares it explicitly
 * (it was a transitive hoist through Next's own optimiser, which is the class of
 * break that surfaces when Next is next bumped), so it is expected to be there;
 * this is what happens when it is not.
 */
async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch (error) {
    console.error(
      "[media] sharp is not available, so no narrower image variants are being derived. " +
        "Pictures are served at their stored size. Reinstall dependencies (npm ci) if this " +
        "is unexpected:",
      error,
    );
    return null;
  }
}
