// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `config/media.json`, read once and defaulted field by field.
//
// The same five-part shape as `lib/api/config.ts` and `lib/ai/chat-config.ts`:
// a typed interface, a default that is safe, coercion helpers, one reader, and
// a `…Problems()` function a test fails the build on. Read it through
// `mediaConfig()` and never by importing the JSON somewhere else — a second
// reader is a second set of defaults, and they drift.
//
// ── Which way it fails ─────────────────────────────────────────────────────
// A malformed ceiling falls back to the default rather than to infinity, and a
// malformed type list falls back to the default rather than to "everything".
// Both directions matter and they are not symmetrical: an unreadable config
// that accepted every media type would be an upload endpoint that takes
// arbitrary executables, which is a worse outcome than one that takes nothing.
//
// ── Where it may be read ───────────────────────────────────────────────────
// Server components, Server Actions, route handlers, and the check command.
// NOT a client component: it imports the product registry to validate a Product
// Key, and Digistore24 ids and prices have no business in a browser bundle —
// the same rule `lib/billing-mode.ts` and `lib/ai/chat-config.ts` follow.
import raw from "@/config/media.json";
import { allProducts } from "@/lib/digistore/products";

import { refusedMimes, refusedTypes } from "./strip-rules.mjs";
import {
  MEDIA_KINDS,
  type KindRule,
  type MediaKind,
  type MediaRules,
} from "./rules";

export interface MediaConfig extends MediaRules {
  enabled: boolean;
  maxUploadsPerHour: number;
}

/**
 * The defaults.
 *
 * Chosen to be usable rather than minimal — an installation that never opens
 * this file still gets an app where a customer can attach a photo and a vendor
 * can sell a PDF. The ceilings are what fits comfortably through a route
 * handler on every host in `docs/DEPLOY.md`.
 */
export const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  enabled: true,
  maxUploadsPerHour: 30,
  kinds: {
    image: {
      maxBytes: 10 * 1024 * 1024,
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      signedUrlSeconds: 300,
    },
    video: {
      maxBytes: 50 * 1024 * 1024,
      mimeTypes: ["video/mp4", "video/webm"],
      signedUrlSeconds: 6 * 60 * 60,
    },
    audio: {
      maxBytes: 50 * 1024 * 1024,
      mimeTypes: ["audio/mpeg", "audio/ogg", "audio/wav"],
      signedUrlSeconds: 6 * 60 * 60,
    },
    file: {
      maxBytes: 50 * 1024 * 1024,
      mimeTypes: ["application/pdf", "application/zip"],
      signedUrlSeconds: 300,
    },
  },
  mayUpload: {
    member: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    // A moderator uploads exactly what a member uploads, and this entry is not
    // optional politeness: `refuseUpload()` reads `mayUpload[role] ?? []`, so a
    // role missing from this table cannot upload ANYTHING — not their own
    // avatar, not a PDF. Leaving it out would mean promoting somebody to a role
    // the app calls "a member the operator trusts" silently takes away a
    // capability every plain member has, and the refusal a customer would read
    // is `notAllowedForRole`, which points at nothing they can act on.
    // Moderating rooms is not a reason to hand out the operator's archive
    // types, so this is the member list, deliberately, and not the owner's.
    moderator: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    owner: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/webm",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "application/pdf",
      "application/zip",
    ],
  },
};

/**
 * A bounded number.
 *
 * The upper bound is a **typo brake**, and no longer the thing that keeps a
 * route handler from running the process out of memory — that is
 * `routeCeilingBytes()` at the door, since a kind may now legitimately declare
 * gigabytes for the direct-to-bucket path. What it still catches is a digit too
 * many in `config/media.json`. ⚠️ It CLAMPS rather than refusing, which is
 * exactly why `MAX_BYTES_CEILING` below carries its own reasoning and
 * `config.test.ts` checks every declared ceiling against the file: a clamp
 * nobody notices is how 2 GB silently ran as 200 MB.
 */
function count(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

/**
 * A list of media types, lowercased.
 *
 * **An explicit empty list means NOTHING, not "the default".** It used to fall
 * back, which made `"member": []` — the obvious way to stop members uploading —
 * silently leave them with jpeg, png, webp and pdf. A value that is not a list
 * at all still falls back, because that is a broken file rather than a decision.
 */
function mimeList(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim().toLowerCase());
}

/**
 * The largest `maxBytes` this file will believe — a typo brake, not a policy.
 *
 * ⚠️ **`count()` CLAMPS, it does not refuse**, so this number silently wins
 * over anything larger in `config/media.json`. It sat at 200 MB with no comment
 * from the day uploads only ever travelled through the app, where the real
 * limit was a tenth of that anyway and nobody could reach it. Story 8.1 gave
 * the app a second way in, `video.maxBytes` became 2 GB — and the clamp turned
 * that into 200 MB without a word anywhere, which is the exact shape of failure
 * this template writes tests about.
 *
 * 5 GB because that is where the physics is: a single presigned `PUT` tops out
 * there at every major provider, and going past it needs multipart uploads,
 * which bring their own abandoned-upload state and their own sweep. So the
 * brake now sits at the first real wall instead of at an arbitrary number, and
 * `config.test.ts` asserts the shipped video ceiling survives it — a clamp that
 * quietly eats a configured value is only safe while something notices.
 */
const MAX_BYTES_CEILING = 5 * 1024 * 1024 * 1024;

export function mediaConfig(): MediaConfig {
  const file = raw as Record<string, unknown>;
  const kindsRaw = (file.kinds ?? {}) as Record<string, unknown>;
  const mayUploadRaw = (file.mayUpload ?? {}) as Record<string, unknown>;

  const kinds = Object.fromEntries(
    MEDIA_KINDS.map((kind) => {
      const fallback = DEFAULT_MEDIA_CONFIG.kinds[kind];
      const entry = (kindsRaw[kind] ?? {}) as Record<string, unknown>;
      const declared = mimeList(entry.mimeTypes, fallback.mimeTypes);
      const refused = new Set(refusedMimes(kind, declared));
      const rule: KindRule = {
        maxBytes: count(entry.maxBytes, fallback.maxBytes, MAX_BYTES_CEILING),
        mimeTypes: declared.filter((mime) => !refused.has(mime)),
        // A day is the ceiling. Beyond that an address is not "short-lived" in
        // any sense a vendor would recognise, and the honest answer for content
        // that must not be passed on is a shorter one, not a longer one.
        signedUrlSeconds: count(entry.signedUrlSeconds, fallback.signedUrlSeconds, 86400),
      };
      return [kind, rule];
    }),
  ) as Record<MediaKind, KindRule>;

  const mayUpload: Record<string, readonly string[]> = {};
  for (const [role, list] of Object.entries(mayUploadRaw)) {
    // `_comment` keys are documentation and are not roles.
    if (role.startsWith("_")) continue;
    mayUpload[role] = mimeList(list, DEFAULT_MEDIA_CONFIG.mayUpload[role] ?? []);
  }
  if (Object.keys(mayUpload).length === 0) {
    Object.assign(mayUpload, DEFAULT_MEDIA_CONFIG.mayUpload);
  }

  return {
    enabled: file.enabled !== false,
    maxUploadsPerHour: count(
      file.maxUploadsPerHour,
      DEFAULT_MEDIA_CONFIG.maxUploadsPerHour,
      1000,
    ),
    kinds,
    mayUpload,
  };
}

/**
 * Everything wrong with the shipped config — empty when it is coherent.
 *
 * `config.test.ts` fails the build on a non-empty result, which is the point:
 * a role allowed to upload a media type that belongs to no kind would be a rule
 * that can never be satisfied, and it should be found here rather than by a
 * customer whose upload is refused with a code that makes no sense.
 */
export function mediaConfigProblems(): string[] {
  const config = mediaConfig();
  const problems: string[] = [];

  // The types the operator WROTE, not the ones that survived `refusedTypes()`.
  // Checking against the filtered list would report `image/gif` twice — once as
  // unstrippable and once as "belongs to no kind" — and the second message
  // would send them to add it back to a kind, which is the opposite of the fix.
  const kindsRaw = ((raw as Record<string, unknown>).kinds ?? {}) as Record<string, unknown>;
  const declaredFor = (kind: MediaKind): readonly string[] =>
    mimeList(
      ((kindsRaw[kind] ?? {}) as Record<string, unknown>).mimeTypes,
      DEFAULT_MEDIA_CONFIG.kinds[kind].mimeTypes,
    );

  const known = new Set(MEDIA_KINDS.flatMap((kind) => declaredFor(kind)));

  for (const [role, allowed] of Object.entries(config.mayUpload)) {
    for (const mime of allowed) {
      if (!known.has(mime)) {
        problems.push(
          `"mayUpload.${role}": "${mime}" belongs to no kind — add it to one of ` +
            `${MEDIA_KINDS.join(", ")} in config/media.json, or remove it here`,
        );
      }
    }
  }

  // The two the code refuses outright. They are reported here and REMOVED by
  // `mediaConfig()`, so the sentence below describes something already in
  // force — an upload of one answers `typeNotAllowed` whether or not anybody
  // reads this. See `refusedTypes()` for why it is not a reason to switch the
  // feature off.
  for (const kind of MEDIA_KINDS) {
    for (const { mime, why } of refusedTypes(kind, declaredFor(kind))) {
      problems.push(
        `"kinds.${kind}": "${mime}" has been dropped — ${why}. ` +
          `Uploads of it are refused; files already stored are unaffected.`,
      );
    }
  }

  return problems;
}

/**
 * Is a Product Key on a media row usable?
 *
 * Called wherever an `entitled` item is written — the endpoint, a seed, a
 * script. **`hasPlan()` throws on an unknown Product Key**, so an unchecked key
 * does not mean "no access", it means the page that renders the item is a 500.
 * That is the trap this function exists for, and it is the same refusal
 * `apiConfigProblems()` makes for the same reason.
 */
export function planProblem(productKey: string): string | null {
  const plan = allProducts().find((p) => p.key === productKey);
  if (!plan) {
    return `no product "${productKey}" in config/digistore-products.json`;
  }
  if (plan.kind === "token") {
    return (
      `"${productKey}" is a token package — a balance is not an entitlement, ` +
      `so hasPlan() answers false for it for ever and nobody would ever get the file`
    );
  }
  return null;
}

/**
 * Is media available on this installation at all?
 *
 * **One question, one answer: the switch in `config/media.json`.** It used to
 * be `enabled && mediaConfigProblems().length === 0`, and that conflated a
 * product decision with a config lint — a single unrecognised media type then
 * 404'd every picture in the app, including the ones stored long before the
 * lint existed. Configuration mistakes are reported (`mediaConfigProblems()`,
 * `node run.mjs media-check`) and refused where they apply (`refusedTypes()`,
 * at upload time). None of them is a reason to stop delivering what is already
 * in the bucket.
 */
export function isMediaEnabled(): boolean {
  return mediaConfig().enabled;
}
