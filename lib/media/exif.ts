// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Taking the metadata off an uploaded image.
//
// ── Why this is not a nicety ───────────────────────────────────────────────
// A photo taken on a phone carries the place it was taken, to a few metres, and
// the time. An app that lets a customer upload a picture and then serves it
// back — to them, to an operator, or on a page — is publishing that unless
// something removes it. It is personal data under any reading, it was never
// knowingly supplied, and nobody looking at the picture can tell it is there.
// `docs/data-protection.md` names this; this file is what makes the naming true.
//
// ── A segment walk, not a re-encode ────────────────────────────────────────
// The obvious implementation is "decode and write it out again", which needs an
// image library, changes every pixel of a JPEG on the way through, and would be
// the first runtime dependency added since the provider layer shipped five
// providers without one. Instead each format is a chain of labelled blocks, and
// the ones carrying metadata are dropped while the rest are copied byte for
// byte. The image that comes out is the image that went in, minus the blocks
// that were removed.
//
// ── What is kept, and why that is not an oversight ─────────────────────────
// **ICC colour profiles stay.** They live in APP2 for JPEG, and removing them
// would change how the picture looks — noticeably, on wide-gamut screens, in
// the direction of "washed out". A colour profile says how to interpret the
// pixels; it says nothing about where somebody was standing.
//
// ── What happens when the file does not parse ──────────────────────────────
// **It is refused, not half-processed.** This is the correction a code review
// forced, and it is worth stating plainly because the old behaviour looked
// reasonable: on anything the walk did not understand it stopped and copied the
// remainder verbatim. Measured consequences — a JPEG carrying a standalone
// marker before its Exif kept its GPS; a PNG whose first chunk lied about its
// length kept its `eXIf`; a truncated WebP had its pixels dropped while the
// RIFF size was rewritten to look consistent. In every case the upload reported
// success.
//
// A stripper that cannot parse a file cannot promise anything about it, and the
// only honest answer is to refuse the file. `stripMetadata` therefore throws
// `MediaError("fileDamaged")` — a code of its own, because "this kind of file is
// not accepted" would be a false statement to somebody whose JPEG simply
// arrived truncated. The endpoint turns it into a 400 they can act on: send it
// again, rather than convert a format that was never the problem.

// ── The honest limit ───────────────────────────────────────────────────────
// **Video is not touched.** An MP4 can carry its recording location in a
// `©xyz` atom, and taking it out means walking the atom tree and rewriting the
// offsets that depend on it. Half of that is worse than none of it, because a
// half-stripped file reads as protected. So this file handles the three image
// formats and `docs/data-protection.md` says plainly that video metadata
// survives — which lets a vendor decide, rather than assume.

import { MediaError } from "./rules";

const JPEG_SOI = 0xd8;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;

/**
 * JPEG segments that are dropped.
 *
 *   APP1  (0xE1) — Exif, and XMP. This is the one with the GPS in it.
 *   APP13 (0xED) — Photoshop image resource blocks, which carry IPTC. Author,
 *                  location and copyright fields live here in anything that has
 *                  been through a photo editor.
 *   COM   (0xFE) — the free-text comment. Editors write software names and
 *                  occasionally the original path on somebody's disk into it.
 *
 * APP0 (JFIF, density) and APP2 (ICC) are deliberately absent from this list.
 */
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

/**
 * PNG chunks that are dropped. All five are ancillary — a decoder that has
 * never heard of a chunk skips it, so removing them cannot produce a file a
 * reader chokes on.
 *
 * Each chunk carries its own CRC over its own bytes, so removing whole chunks
 * needs no checksum recomputed anywhere. That property is what makes this safe.
 */
const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/** RIFF/WebP chunks that are dropped. Note the trailing space in `XMP ` — a
 * FourCC is always four bytes, and dropping the wrong four would remove pixels. */
const WEBP_DROP = new Set(["EXIF", "XMP "]);

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) {
    throw new MediaError("fileDamaged", "not a JPEG: no SOI marker");
  }

  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;

  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) {
      throw new MediaError("fileDamaged", `malformed JPEG: no marker at byte ${at}`);
    }

    const marker = bytes[at + 1];

    // A run of 0xFF bytes is legal padding before a marker; skip one and look
    // again. Without this a perfectly valid file is refused.
    if (marker === 0xff) {
      at += 1;
      continue;
    }

    // Standalone markers carry NO length: TEM (0x01) and the eight restart
    // markers. Treating one as a segment reads the next two bytes as a length
    // and walks off into the file — which is how an Exif block after one used
    // to survive the strip untouched.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }

    // Once the scan starts, the rest is entropy-coded data and is copied
    // verbatim — walking into it looking for markers finds them by accident.
    if (marker === JPEG_SOS || marker === JPEG_EOI) break;

    if (at + 3 >= bytes.length) {
      throw new MediaError("fileDamaged", "malformed JPEG: truncated segment header");
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) {
      throw new MediaError("fileDamaged", "malformed JPEG: segment length past end of file");
    }

    if (!JPEG_DROP.has(marker)) {
      keep.push(bytes.subarray(at, at + 2 + length));
    }
    at += 2 + length;
  }

  keep.push(bytes.subarray(at));
  return concat(keep);
}

function stripPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) {
    throw new MediaError("fileDamaged", "malformed PNG: shorter than its signature");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;

  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(
      bytes[at + 4],
      bytes[at + 5],
      bytes[at + 6],
      bytes[at + 7],
    );
    const total = 12 + length; // length + type + data + CRC
    if (at + total > bytes.length) {
      // A chunk that declares more than the file holds. Stopping here and
      // copying the tail kept every metadata chunk after the liar.
      throw new MediaError("fileDamaged", "malformed PNG: chunk length past end of file");
    }

    if (!PNG_DROP.has(type)) {
      keep.push(bytes.subarray(at, at + total));
    }
    at += total;
    if (type === "IEND") break;
  }

  if (at < bytes.length) keep.push(bytes.subarray(at));
  return concat(keep);
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) {
    throw new MediaError("fileDamaged", "malformed WebP: shorter than its own header");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const body: Uint8Array[] = [bytes.subarray(8, 12)]; // the "WEBP" FourCC
  let at = 12;
  let dropped = false;

  // ── Walk to the RIFF header's OWN idea of the end, not to the buffer's ────
  // The two differ in both directions and each one was a bug. Reading to
  // `bytes.length` threw "chunk length past end of file" on a perfectly
  // readable file carrying eight or more bytes of padding after its last chunk
  // — a refusal of something valid. And stopping at `at + 8 > bytes.length`
  // silently discarded a one-to-seven byte tail while rewriting the RIFF size
  // to match, which is the same "looks consistent, is not the file you gave me"
  // outcome this function was rewritten to eliminate.
  //
  // So the declared end bounds the walk, and anything outside it is refused
  // below rather than quietly dropped.
  const declaredEnd = 8 + view.getUint32(4, true);
  if (declaredEnd > bytes.length) {
    throw new MediaError("fileDamaged", "malformed WebP: RIFF size past end of file");
  }

  while (at + 8 <= declaredEnd) {
    const type = String.fromCharCode(
      bytes[at],
      bytes[at + 1],
      bytes[at + 2],
      bytes[at + 3],
    );
    const size = view.getUint32(at + 4, true); // RIFF sizes are little-endian
    // Chunks are padded to an even length, and the pad byte is not counted in
    // the size. Forgetting it walks the reader half a byte out of step and
    // every FourCC after it reads as garbage.
    const padded = size + (size % 2);
    const total = 8 + padded;
    if (at + total > declaredEnd) {
      // Truncated. Continuing dropped the pixel chunks AND rewrote the RIFF
      // size to match, producing a twelve-byte file that looked consistent.
      throw new MediaError("fileDamaged", "malformed WebP: chunk length past end of file");
    }

    if (WEBP_DROP.has(type)) {
      dropped = true;
    } else {
      body.push(bytes.subarray(at, at + total));
    }
    at += total;
  }

  // A remainder inside the declared RIFF size is a chunk header that does not
  // fit — the file says there is more and there is not. Refused, not trimmed.
  if (at !== declaredEnd) {
    throw new MediaError("fileDamaged", "malformed WebP: trailing bytes inside the RIFF size");
  }

  if (!dropped) return bytes;

  // ── Clear the VP8X flags for what was removed ────────────────────────────
  // A VP8X chunk carries a flags byte announcing what the file contains, and
  // bits 3 and 2 are "has EXIF" and "has XMP". Dropping the chunks and leaving
  // the flags set produces a file that advertises metadata it does not have —
  // read by libwebp, warned on or rejected by stricter readers, and
  // indistinguishable from a truncation.
  //
  // The copy is not defensive style, it is required: `body` holds `subarray()`
  // VIEWS onto the caller's buffer, so writing through one changes the argument
  // that was passed in — in a function documented as returning a new image and
  // leaving its input alone. Measured before the copy: the caller's byte 20
  // went from 12 to 0 behind their back.
  for (let i = 0; i < body.length; i += 1) {
    const part = body[i];
    const isVp8x =
      part.length >= 9 &&
      String.fromCharCode(part[0], part[1], part[2], part[3]) === "VP8X";
    if (isVp8x) {
      const copy = Uint8Array.from(part);
      // Clearing two documented flag bits. (No `eslint-disable` here: `no-bitwise`
      // is not among this config's rules, so the directive was reported as unused
      // — and an unused suppression is indistinguishable from one that stopped
      // working.)
      copy[8] &= ~0b0000_1100;
      body[i] = copy;
    }
  }

  const payload = concat(body);
  // The RIFF header's size field counts everything after it, so removing a
  // chunk means rewriting it. A file whose declared size no longer matches its
  // contents is one some decoders read and others reject.
  const out = new Uint8Array(8 + payload.length);
  out.set(bytes.subarray(0, 4)); // "RIFF"
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The image, without its metadata blocks.
 *
 * Anything that is not one of the three handled formats — including every
 * video, every recording and every PDF — comes back exactly as it went in. That
 * is the honest answer rather than a silent partial one, and the caller does not
 * branch on it: `manage.ts` runs every upload through here and the file decides
 * whether there is anything to do.
 */
export function stripMetadata(mime: string, bytes: Uint8Array): Uint8Array {
  switch (mime.trim().toLowerCase()) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    default:
      return bytes;
  }
}

/**
 * Which media types this file actually does something to.
 *
 * Re-exported rather than declared, because `scripts/media/check.mjs` needs the
 * same list and cannot import TypeScript. The one copy lives in
 * `strip-rules.mjs` beside the rule that consumes it — see the note at the top
 * of that file for what went wrong when there were two readers.
 */
export { STRIPPED_MIME_TYPES } from "./strip-rules.mjs";
