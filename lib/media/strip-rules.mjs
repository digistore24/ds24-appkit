// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which media types this app refuses to ACCEPT, whatever `config/media.json`
// says — and which image formats it can strip metadata from.
//
// ── Why .mjs ───────────────────────────────────────────────────────────────
// Two readers, one rule. `lib/media/config.ts` applies it when the app decides
// what an upload may be, and `scripts/media/check.mjs` prints it when an
// operator asks what may go in — and the scripts here do not import TypeScript
// (CLAUDE.md → *Three systems*).
//
// It was a function inside `config.ts` for one release, and `check.mjs` read
// `config/media.json` directly instead. The two then disagreed in the way that
// matters: the app refused `image/gif` and the command listed it as accepted,
// while nothing anywhere told the operator why their GIF upload was being
// turned away. That is the exact failure `CLAUDE.md` warns about under *"read
// it through `mediaConfig()` and never by importing the JSON somewhere else"*,
// and the fix is the one `lib/ai/task-rules.mjs` already models: put the rule
// in a file both can import.

/**
 * The image formats `lib/media/exif.ts` can walk and strip.
 *
 * Anything outside this list is an image whose location and camera data this
 * app cannot remove — which would make `docs/data-protection.md`'s promise
 * false for that format.
 */
export const STRIPPED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The declared types that must not be accepted, with the reason for each.
 *
 * Two rules, both properties of the CODE rather than of the product:
 *
 *   - an SVG is a document that can carry script, so one customer's upload
 *     would run in another customer's browser;
 *   - an image format that cannot be stripped makes the data-protection
 *     promise untrue for one of the formats it names.
 *
 * ── Why this filters rather than raising a fatal problem ──────────────────
 * Because it used to do the latter, and the measured result was severe. The
 * check fed `mediaConfigProblems()`, and `isMediaEnabled()` was `enabled &&
 * problems.length === 0` — so an app whose `config/media.json` still listed
 * `image/gif` (which is EVERY app generated before that change) switched the
 * whole feature off: uploads answering 503, and every already-stored item
 * answering 404 — photographs and GIFs alike.
 *
 * A format this app cannot strip is a reason to refuse that format. It is not
 * a reason to stop delivering files that were stored correctly long before the
 * rule existed. So the refusal is exactly as wide as the fault, and the
 * operator hears about it through `mediaConfigProblems()` and
 * `node run.mjs media-check` rather than through their app going dark.
 *
 * @param {string} kind one of `image` / `video` / `audio` / `file`
 * @param {readonly string[]} declared the types written in the config
 * @returns {{ mime: string, why: string }[]}
 */
export function refusedTypes(kind, declared) {
  const refused = [];
  for (const mime of declared) {
    if (mime === "image/svg+xml") {
      refused.push({
        mime,
        why:
          "SVG can carry script, and a file one customer uploaded would then run " +
          "in another customer's browser",
      });
    } else if (kind === "image" && !STRIPPED_MIME_TYPES.includes(mime)) {
      refused.push({
        mime,
        why:
          "lib/media/exif.ts cannot strip its metadata, and an image this app " +
          "cannot strip makes docs/data-protection.md untrue. Either teach " +
          "exif.ts that format, or remove it from config/media.json",
      });
    }
  }
  return refused;
}

/** The same answer as a plain list of media types. */
export function refusedMimes(kind, declared) {
  return refusedTypes(kind, declared).map((entry) => entry.mime);
}
