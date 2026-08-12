// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What counts as a Content Media reference — the grammar, exactly once.
//
// ── What "content media" is ────────────────────────────────────────────────
// The files this app SELLS or ships as part of its product: lesson videos,
// worksheets, subtitle files, cover images. They are declared in
// `content/media-manifest.json`, live on one of two legs (small files
// committed under `content/media/`, large ones staged in
// `.data/content-media/`) and land in the media store under `content/<path>`,
// each with a `media` row keyed by that path. `docs/content.md` is the story;
// `scripts/content/` are the commands.
//
// It is the sibling of `lib/knowledge-media/rules.mjs` and shares its segment
// grammar by import — same naming standard, same "one grammar, three readers"
// reasoning. It is deliberately NOT the same module: knowledge media are the
// assistant's (`knowledge/` prefix, kinds for a chat card), content media are
// the product's (`content/` prefix, kinds that must match the `media` table's
// enum, because every one of them becomes a row).
//
// Keep it dependency-free and keep it pure: no `node:fs`, no `process.env`.
// It is imported by bare `node scripts/…` on all three systems and by vitest.
import { MEDIA_SEGMENT_PATTERN } from "../knowledge-media/rules.mjs";

const SEGMENT_RE = new RegExp(`^${MEDIA_SEGMENT_PATTERN}$`);

/**
 * Extension → what the file is and how it is served.
 *
 * `kind` values are the `media` table's enum (`image | video | audio | file`),
 * because every manifest entry becomes a `media` row and an unknown kind is a
 * refused insert. `contentType` is what the store upload and the delivery
 * route say to a browser. An extension not in this map makes the whole path
 * invalid — no "unknown but tolerated" state, same rule as knowledge media.
 *
 * `zip` and `vtt` are here and not in the knowledge map on purpose: an
 * archive a buyer paid for and a subtitle sidecar are product deliverables,
 * not chat-card material (`config/media.json` accepts both for uploads too).
 */
export const CONTENT_MEDIA_TYPES = {
  mp4: { contentType: "video/mp4", kind: "video" },
  webm: { contentType: "video/webm", kind: "video" },
  mp3: { contentType: "audio/mpeg", kind: "audio" },
  ogg: { contentType: "audio/ogg", kind: "audio" },
  wav: { contentType: "audio/wav", kind: "audio" },
  jpg: { contentType: "image/jpeg", kind: "image" },
  jpeg: { contentType: "image/jpeg", kind: "image" },
  png: { contentType: "image/png", kind: "image" },
  webp: { contentType: "image/webp", kind: "image" },
  pdf: { contentType: "application/pdf", kind: "file" },
  zip: { contentType: "application/zip", kind: "file" },
  vtt: { contentType: "text/vtt", kind: "file" },
};

/**
 * Accept or refuse one whole path: `<topic-slug>/<file>.<ext>` — exactly two
 * segments, exactly one extension dot, extension from the allow-map. The same
 * shape as a knowledge media path, for the same reasons (a topicless file has
 * no coordinate, depth 3 is nesting nobody reads back), judged against this
 * module's own extension map.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isValidContentMediaPath(path) {
  if (typeof path !== "string" || path === "") return false;

  const segments = path.split("/");
  if (segments.length !== 2) return false;

  const [topic, file] = segments;
  if (!SEGMENT_RE.test(topic)) return false;

  const parts = file.split(".");
  if (parts.length !== 2) return false;

  const [stem, extension] = parts;
  if (!SEGMENT_RE.test(stem)) return false;
  return Object.hasOwn(CONTENT_MEDIA_TYPES, extension);
}

/**
 * Where content media live in the app's object store: every bucket key is
 * `"content/" + <path>`. Deterministic BY DESIGN, and that is the property
 * the whole dev→prod story hangs on: the same file lands at the same key in
 * every environment, so a manifest entry (and the applier that wires a
 * `videoMediaId`) can name a file by path and be right everywhere. It can
 * never collide with upload keys
 * (`<namespace>/<category>/<YYYY>/<MM>/<uuid>.<ext>`) or knowledge keys
 * (`knowledge/<path>`).
 *
 * 🚨 **That last sentence is now enforced rather than observed.** It used to hold
 * because no upload key could begin with this prefix by accident — the prefixes
 * were the four media kinds. Since a key begins with a caller-chosen namespace,
 * the prefix here is a RESERVED namespace: `RESERVED_MEDIA_NAMESPACES` in
 * `lib/media/rules.ts` names it, and `storageKey()` throws rather than building
 * a key on it. `lib/content/writers.test.ts` holds the other half — that neither
 * of the media layer's two files even carries the literal.
 */
export const CONTENT_MEDIA_BUCKET_PREFIX = "content/";

/**
 * Past this, a file does not belong in the app tree — it belongs on the
 * staged leg (`.data/content-media/`) and travels with
 * `node run.mjs content-media-sync`. Same ceiling and same reasoning as
 * knowledge media: a repo is for what git diffs, not for recordings.
 */
export const CONTENT_MEDIA_SHIPPED_MAX_BYTES = 10 * 1024 * 1024;

/** The two legs, relative to the app root. */
export const CONTENT_MEDIA_SHIPPED_DIR = "content/media";
export const CONTENT_MEDIA_STAGED_DIR = ".data/content-media";

/** The manifest every entry is declared in, relative to the app root. */
export const CONTENT_MEDIA_MANIFEST = "content/media-manifest.json";

/**
 * What the presence report calls the product media, in words an operator
 * recognises (`lib/content/presence.ts` → `PresenceItem.what`).
 *
 * 🚨 A constant rather than a string, because a **reader** has to recognise
 * this item: `node run.mjs content-check` finds it in the core's report to
 * compare what THIS checkout declares against what that environment answered
 * (`declaredVsReported()` in `scripts/content/_manifest.mjs`). A label spelled
 * out in the file that writes it and again in the file that looks for it is a
 * label that drifts — and the drift is silent, because a comparison that finds
 * nothing looks exactly like a comparison that found no disagreement.
 *
 * For the same reason it never encodes the STATE ("product media (no
 * manifest)"): an absent manifest, an empty one and a full one are three
 * different answers under one name.
 */
export const PRODUCT_MEDIA_ITEM = "product media";
