// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading and judging `content/media-manifest.json` — once, for all three
// content commands (`content-apply`, `content-media-sync`).
//
// The manifest is the DECLARATION of the product's media: one entry per file,
// carrying what a `media` row needs and a file on disk cannot say — who may
// see it (`visibility`), which plans buy it (`planKeys`), what a
// screen reader gets (`alt`). Everything derivable is derived (kind and
// content type come from the extension), everything else is validated here so
// that a bad entry is refused with a sentence, in every command, identically.
//
// The shape:
//
//   {
//     "entries": [
//       { "path": "kurs-basics/intro.mp4",
//         "visibility": "entitled",
//         "planKeys": ["basic_monthly", "basic_yearly"],
//         "alt": null,
//         "sha256": "…",          // staged-leg files: written back by
//         "bytes": 123456789 }    // content-media-sync --apply
//     ]
//   }
//
// Validation is pure functions over parsed JSON — `manifest.test.ts` pins
// them without touching a disk.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CONTENT_MEDIA_BUCKET_PREFIX,
  CONTENT_MEDIA_MANIFEST,
  CONTENT_MEDIA_SHIPPED_DIR,
  CONTENT_MEDIA_STAGED_DIR,
  CONTENT_MEDIA_TYPES,
  isValidContentMediaPath,
} from "../../lib/content-media/rules.mjs";

/** The bucket key of one manifest entry. */
export function keyFor(path) {
  return CONTENT_MEDIA_BUCKET_PREFIX + path;
}

/**
 * Where an entry's file is on THIS machine: shipped leg first, then staged.
 *
 * 🚨 **One spelling of "which leg is this file on".** It lived in
 * `scripts/content/apply.mjs` while that was the only command asking, and moved
 * here when `content-publish` became the second — a copy of it there would have
 * been a second opinion about which of two folders a file counts as being in,
 * and the two commands would then disagree about whether a declared file is
 * missing at all.
 *
 * The order is not arbitrary: a file present on both legs is the SHIPPED one,
 * because that is the copy the deploy carries and therefore the copy every
 * environment can already see.
 *
 * @param {string} root  the app root
 * @param {string} path  a manifest entry's `<topic>/<file>.<ext>`
 * @returns {{leg: "shipped"|"staged", full: string} | null}
 */
export function localFileFor(root, path) {
  for (const [leg, dir] of [
    ["shipped", CONTENT_MEDIA_SHIPPED_DIR],
    ["staged", CONTENT_MEDIA_STAGED_DIR],
  ]) {
    const full = join(root, ...dir.split("/"), ...path.split("/"));
    try {
      if (statSync(full).isFile()) return { leg, full };
    } catch {
      // keep looking
    }
  }
  return null;
}

const VISIBILITIES = ["public", "entitled"];
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Judge one parsed manifest. Returns the enriched entries (kind, contentType
 * and key derived) and every problem as a finished sentence naming the entry.
 *
 * `productKeys` is the plan registry (`config/digistore-products.json` →
 * product keys) — every `planKeys` entry is validated against it because `hasPlan()`
 * THROWS on an unknown key: an unchecked value would not mean "no access", it
 * would take the page down. `null` means the registry could not be read; then
 * the plan check is reported as unverifiable rather than silently passed.
 *
 * @param {unknown} data  the parsed JSON
 * @param {{productKeys: string[] | null}} context
 * @returns {{entries: object[], problems: string[]}}
 */
export function validateManifest(data, { productKeys }) {
  const problems = [];
  const entries = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { entries, problems: ["the manifest is not a JSON object — see docs/content.md for the shape"] };
  }
  const raw = data.entries;
  if (raw === undefined) {
    return { entries, problems: ['the manifest has no "entries" array — see docs/content.md for the shape'] };
  }
  if (!Array.isArray(raw)) {
    return { entries, problems: ['"entries" is not an array'] };
  }

  const seen = new Set();
  for (const [i, entry] of raw.entries()) {
    const where = `entries[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      problems.push(`${where} is not an object`);
      continue;
    }

    const path = entry.path;
    if (!isValidContentMediaPath(path)) {
      problems.push(
        `${where}: "${path}" violates the naming standard — <topic-slug>/<file>.<extension>, ` +
          "lowercase a-z, 0-9 and hyphens, exactly one folder, extension one of: " +
          `${Object.keys(CONTENT_MEDIA_TYPES).join(", ")}. ` +
          "Rename it; a bad name must not become a bad object key",
      );
      continue;
    }
    if (seen.has(path)) {
      problems.push(`${where}: "${path}" is declared twice — one file, one entry`);
      continue;
    }
    seen.add(path);

    const extension = path.slice(path.lastIndexOf(".") + 1);
    const { kind, contentType } = CONTENT_MEDIA_TYPES[extension];

    const visibility = entry.visibility;
    if (!VISIBILITIES.includes(visibility)) {
      problems.push(
        `${where} ("${path}"): visibility "${visibility}" — use "public" (anybody) or ` +
          `"entitled" (behind a plan). "owner" is for what a customer uploads, not for product media`,
      );
      continue;
    }

    // A LIST, and holding ONE of them buys the file — the same shape
    // `media.plan_keys` and `community_groups.plan_keys` carry. One offering is
    // one Digistore24 product per billing interval, so a file sold monthly and
    // yearly names two keys and a single string could never have said so.
    const declared = entry.planKeys ?? null;
    let planKeys = [];
    if (visibility === "entitled") {
      if (!Array.isArray(declared) || declared.length === 0) {
        problems.push(
          `${where} ("${path}"): visibility "entitled" needs "planKeys" — a list of the Product ` +
            "Keys from config/digistore-products.json that buy this file, any one of which does",
        );
        continue;
      }
      if (declared.some((key) => typeof key !== "string" || key === "")) {
        problems.push(`${where} ("${path}"): every entry of "planKeys" must be a non-empty string`);
        continue;
      }
      const duplicate = declared.find((key, i) => declared.indexOf(key) !== i);
      if (duplicate !== undefined) {
        problems.push(`${where} ("${path}"): "planKeys" lists "${duplicate}" twice`);
        continue;
      }
      if (productKeys === null) {
        problems.push(
          `${where} ("${path}"): "planKeys" cannot be verified — ` +
            "config/digistore-products.json is unreadable",
        );
        continue;
      }
      const unknown = declared.find((key) => !productKeys.includes(key));
      if (unknown !== undefined) {
        problems.push(
          `${where} ("${path}"): planKeys "${unknown}" is not in ` +
            "config/digistore-products.json — hasPlan() throws on an unknown key, so this " +
            "would be a 500, not a refusal",
        );
        continue;
      }
      planKeys = declared;
    } else if (declared !== null) {
      problems.push(
        `${where} ("${path}"): "planKeys" beside visibility "public" does nothing — ` +
          'remove it, or make the file "entitled"',
      );
      continue;
    }

    const alt = typeof entry.alt === "string" && entry.alt.trim() !== "" ? entry.alt.trim() : null;
    if (kind === "image" && alt === null) {
      problems.push(
        `${where} ("${path}"): an image needs "alt" — a sentence for a person, ` +
          "the same rule the upload endpoint enforces (lib/media/rules.ts → needsAlt)",
      );
      continue;
    }

    const sha256 = entry.sha256 ?? null;
    if (sha256 !== null && !SHA256_RE.test(String(sha256))) {
      problems.push(`${where} ("${path}"): "sha256" is not a 64-char lowercase hex hash`);
      continue;
    }
    const bytes = entry.bytes ?? null;
    if (bytes !== null && (!Number.isInteger(bytes) || bytes <= 0)) {
      problems.push(`${where} ("${path}"): "bytes" is not a positive integer`);
      continue;
    }

    entries.push({
      path,
      key: keyFor(path),
      kind,
      contentType,
      visibility,
      planKeys,
      alt,
      sha256,
      bytes,
      filename: path.slice(path.indexOf("/") + 1),
    });
  }

  return { entries, problems };
}

/**
 * Load and judge the manifest from disk.
 *
 * @returns {{missing: true} | {entries: object[], problems: string[], data: object}}
 *   `missing` when the file does not exist — the normal state of an app that
 *   ships no media, and the callers' no-op branch. A file that exists but
 *   cannot be parsed is a problem, never a silent no-op.
 */
export function loadManifest(root, e = process.env) {
  let text;
  try {
    text = readFileSync(join(root, ...CONTENT_MEDIA_MANIFEST.split("/")), "utf8");
  } catch (error) {
    // 🚨 Only "it is not there" is `missing`. `EACCES`, `EISDIR`, a Windows
    // lock — every one of those used to answer `missing: true`, i.e. "this app
    // ships no media at all", and the readers act on it: `content-apply` finds
    // nothing to do and exits 0, `content-check --env prod` compares two
    // absences, agrees with itself and exits 0. Green over a question nobody
    // asked, on the command `CLAUDE.md` names as the exit condition for a
    // go-live.
    //
    // This is the ruling Story 42.2 made one folder over, in
    // `scripts/content/_appliers.mjs`: every read error is a refusal, `ENOENT`
    // included — because "not carried into the build" IS `ENOENT`. Here the
    // opposite half applies: a manifest that is genuinely absent is an ordinary
    // state, and anything else is not.
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { missing: true };
    throw error;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { entries: [], problems: [`${CONTENT_MEDIA_MANIFEST} is not valid JSON: ${error.message}`], data: null };
  }

  return { ...validateManifest(data, { productKeys: productKeysFrom(root) }), data };
}

/**
 * Does the environment know about the media THIS checkout declares?
 *
 * The fourth state, and the only one no owner inside the app can see: the two
 * facts live in two processes. The running app knows what it holds; only the
 * machine running `content-check` has the repo the deploy came from. So the
 * comparison happens here, in the CLI, and never by shipping the repo's
 * declaration into the image a second time — which would be the manifest
 * itself, the very file whose absence is the question.
 *
 * @param {number} declaredCount  entries in this checkout's own manifest
 * @param {{expected: number|null, note?: string}|null} coreItem
 *   the environment's product-media item, found by the shared label constant —
 *   `null` when its answer carried no such item at all. Pass `null` for it only
 *   when the core ANSWERED; an owner that could not look is a different state
 *   and comparing against it would turn "I could not see" into "it holds less".
 * @returns {string|null}  one sentence carrying both numbers and both sides, or
 *   `null` when there is nothing to say
 */
export function declaredVsReported(declaredCount, coreItem) {
  // Two absences agree. Inventing a problem out of them would be the mirror
  // image of the defect this whole comparison exists to close.
  if (!Number.isFinite(declaredCount) || declaredCount <= 0) return null;

  const declares = `this checkout declares ${declaredCount} product media file(s), `;

  if (!coreItem) {
    return (
      declares +
      "that environment reported no product media item at all — it is running a build " +
      "from before the item existed, so nothing there answered this question"
    );
  }
  if (coreItem.expected === null) {
    return (
      declares +
      `that environment answered: ${coreItem.note ?? "no manifest"}. ` +
      `${CONTENT_MEDIA_MANIFEST} did not reach it — check the deploy, and ` +
      "outputFileTracingIncludes if it runs a standalone build"
    );
  }
  // Fewer only. MORE is the legitimate version of this finding: a checkout
  // behind the deployed commit is somebody else's push, not a broken PROD.
  if (coreItem.expected < declaredCount) {
    return declares + `that environment declares only ${coreItem.expected} — it is behind this tree`;
  }
  return null;
}

/**
 * The plan registry's product keys, or null when the file is unreadable —
 * the caller words that as "cannot verify", never as "fine".
 */
export function productKeysFrom(root) {
  try {
    const registry = JSON.parse(readFileSync(join(root, "config", "digistore-products.json"), "utf8"));
    if (typeof registry?.products === "object" && registry.products !== null) {
      return Object.keys(registry.products);
    }
    return null;
  } catch {
    return null;
  }
}
