// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The five icon files, and what each one has to be.
//
// 🚨 The three PWA entries duplicate `PWA_ICONS` in `lib/pwa/manifest.ts`, and
// the duplication is deliberate: this is `.mjs` (a script, running before any
// bundler exists) and that is `.ts`. `targets.test.ts` imports BOTH and holds
// them together name for name and pixel for pixel — the same arrangement
// `lib/cron/ids.mjs` ↔ `lib/cron/jobs.ts` already uses. So a generator that
// drifts from the manifest goes red HERE, in the factory, rather than in a
// customer's suite after they rebranded.

/** Below this the source is a favicon, and upscaling it would be a lie. */
export const MIN_LOGO_PX = 128;

/** Above this it is produced but the report says how soft it will look. */
export const SOFT_LOGO_PX = 512;

/**
 * The maskable icon's artwork occupies this much of the square.
 *
 * Android crops a maskable icon to whatever shape the launcher uses — a circle,
 * a squircle, a rounded square — so the corners are not safe. 60 % is the
 * safe-zone diameter the spec guarantees; the remaining 20 % per side is the
 * padding CLAUDE.md calls "a separate picture", because it is.
 */
export const MASKABLE_SAFE = 0.6;

export const ICON_TARGETS = [
  {
    file: "app/icon.png",
    size: 256,
    background: "transparent",
    what: "the browser tab; picked up by file name",
  },
  {
    file: "app/apple-icon.png",
    size: 180,
    // 🚨 Opaque on purpose. iOS composites a transparent apple-touch-icon onto
    // BLACK, so a dark mark on transparency disappears entirely on a home
    // screen. That is a decision, not an oversight, and `render.test.ts`
    // asserts it.
    background: "flat",
    what: "the iOS home screen",
  },
  {
    file: "public/icons/icon-192.png",
    size: 192,
    background: "transparent",
    manifest: "/icons/icon-192.png",
    what: "Chrome refuses to install the app without it",
  },
  {
    file: "public/icons/icon-512.png",
    size: 512,
    background: "transparent",
    manifest: "/icons/icon-512.png",
    what: "the splash screen",
  },
  {
    file: "public/icons/icon-maskable-512.png",
    size: 512,
    background: "flat",
    padding: MASKABLE_SAFE,
    manifest: "/icons/icon-maskable-512.png",
    what: "Android crops it to the launcher's shape",
  },
];
