// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The brand mark — does this app have a logo, and where is it.
//
// One question, one answer, read through `brand()` and never by re-reading the
// JSON. The shape is the one `isChatEnabled()` and `billingMode()` already
// have: a checked-in `config/*.json`, a static import the bundler resolves at
// build time, and a reader that validates.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Anywhere, and that is deliberate: this module imports the JSON and NOTHING
// else. `lib/ai/chat-config.ts` carries the mirror-image warning about itself
// (it drags the product registry into whatever imports it); this one has to
// cross into the browser bundle, because `components/app-shell.tsx` is a client
// component and is one of the four places the mark appears.
//
// ── The direction it fails in ──────────────────────────────────────────────
// Anything malformed, half-filled or pointing outside `public/brand/` resolves
// to NO LOGO, and the letter tile renders instead. That is the opposite of
// `billingMode()`, which falls back to showing everything, and the reason is
// the failure mode rather than a preference: the tile is always renderable,
// while a half-configured logo is a broken-image icon in the header of every
// page in the app. There is no state here worth being loud about — an app
// without a logo is the shipped state.
//
// 🚨 What this file does NOT do is check that the file EXISTS. A `fs.stat()`
// would be a syscall per render and is not even available in a client
// component. The gap is closed where it belongs, at build time:
// `components/brand-mark.test.ts` fails when a path here names a file that is
// not on disk, and `node run.mjs brand --apply` writes the files and this
// config in one act.
import raw from "@/config/brand.json";

export interface Brand {
  /** Public path of the mark, e.g. `/brand/logo.svg`, or null for the tile. */
  logo: string | null;
  /** Optional second file for dark mode. Null means `logo` serves both. */
  logoDark: string | null;
  /** The file's own dimensions. Both are > 0 whenever `logo` is set. */
  width: number;
  height: number;
}

export const NO_BRAND: Brand = {
  logo: null,
  logoDark: null,
  width: 0,
  height: 0,
};

/**
 * The one place a brand asset path is judged.
 *
 * Under `public/brand/` and nowhere else, and one of three extensions. Both
 * halves are load-bearing rather than tidy: the folder is what
 * `next.config.ts` hangs its locked-down headers on, and the extension list is
 * what keeps `.html` — a document with the same scripting powers as an SVG and
 * none of the reasons to be here — out of the one slot that accepts markup.
 */
function assetPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/brand/")) return null;
  if (path.includes("..")) return null;
  return /\.(svg|png|webp)$/i.test(path) ? path : null;
}

function positiveInt(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

/** This app's brand mark, or `NO_BRAND` when there is none to render. */
export function brand(): Brand {
  const config = raw as Record<string, unknown>;
  const logo = assetPath(config.logo);
  const width = positiveInt(config.logoWidth);
  const height = positiveInt(config.logoHeight);

  // All three or none. A logo without its dimensions is the case that renders
  // and then jumps, which is worse than not rendering.
  if (!logo || !width || !height) return NO_BRAND;

  return { logo, logoDark: assetPath(config.logoDark), width, height };
}
