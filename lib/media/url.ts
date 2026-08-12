// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where a browser fetches an item from.
//
// ── The one rule ───────────────────────────────────────────────────────────
// **The bytes come from the bucket, not from this app.** On a successful app
// that is the difference between a node serving pages and a node serving
// megabytes; with video it stops being a preference at all, because a player
// seeking through a recording issues range requests and the bucket answers
// those by itself. Routing them through the app would mean implementing
// `206 Partial Content` — on every node, for every viewer.
//
// ── Why access is decided HERE and not at fetch time ───────────────────────
// Because `next/image` will not follow a redirect to a foreign host. A delivery
// route that answers `307` with a signed URL works for a download and fails for
// an `<Image>`. So the server component that renders the item decides who is
// asking — it already knows, it is the same place `hasPlan()` decides
// everything else — and mints an address that expires. The check moves from
// fetch time to render time, which is what makes bucket-direct delivery
// possible at all (AD-34).
//
// ── The local driver is the exception, and it says so ──────────────────────
// On `MEDIA_DRIVER=local` there is no address a browser can reach that is not
// this app, so everything goes through `app/api/media/[id]`. That is DEV only.
// It also means the two drivers exercise different delivery paths, which is
// worth knowing before concluding from a working local setup that production
// will behave the same.
import { mediaConfig } from "./config";
import type { MediaRow } from "@/db/schema-media";
import {
  safeFilename,
  extensionFor,
  servedThroughApp,
  variantKey,
  type MediaKind,
} from "./rules";
import { mediaStore, type MediaStore } from "./store";

export interface MediaUrlOptions {
  /** Serve as a download, with the name the file was uploaded under. */
  download?: boolean;
}

/** The route this app serves media from when the driver has no public address. */
export function appMediaPath(id: string, download = false): string {
  return `/api/media/${id}${download ? "?download=1" : ""}`;
}

/** How long a minted address for this kind stays valid. */
export function signedUrlSeconds(kind: MediaKind): number {
  return mediaConfig().kinds[kind].signedUrlSeconds;
}

/**
 * The address for an item whose access has ALREADY been decided.
 *
 * **This function grants nothing and checks nothing.** It is the last step
 * after `mayAccess()` said yes, and calling it without that check is how a
 * private file becomes a public one. The name is deliberately not
 * `getMediaUrl` for that reason: a caller should have to notice.
 */
export function mediaUrlFor(row: MediaRow, options: MediaUrlOptions = {}): string {
  const store = mediaStore();

  // Subtitle text is served by this app on every driver — a `<track>` fetch
  // is CORS-restricted and cannot follow a redirect to the bucket, so a
  // bucket address in a track is a subtitle that silently never appears. The
  // reasoning lives on `servedThroughApp()` in `rules.ts`; the delivery route
  // streams these instead of redirecting.
  if (servedThroughApp(row.mime)) {
    return appMediaPath(row.id, options.download);
  }

  // Product imagery, on a bucket that serves anonymous reads: the plain
  // address. Cacheable by the CDN, identical for every visitor, and it never
  // expires — which is right for something anybody may see anyway.
  if (row.visibility === "public" && !options.download) {
    const url = store.publicUrl(row.storageKey);
    if (url) return url;
  }

  const signed = store.signedUrl(row.storageKey, {
    expiresSeconds: signedUrlSeconds(row.kind),
    contentType: row.mime,
    downloadFilename: options.download
      ? safeFilename(row.filename ?? "", extensionFor(row.mime))
      : undefined,
  });
  if (signed) return signed;

  // `local`: nothing but this app can serve it.
  return appMediaPath(row.id, options.download);
}

/** A picture and the narrower copies a browser may choose from instead. */
export interface MediaImage {
  /** The original — the `src`, and the only thing an old browser fetches. */
  src: string;
  /**
   * The `<img srcset>` value, or `null` when there is nothing to choose from.
   *
   * Every candidate carries a `w` descriptor, the ORIGINAL included, and that is
   * why it can be `null` for a row that has variants: descriptors may not be
   * mixed with bare candidates, so a `srcset` that could not describe the
   * original would either omit it — capping every viewer at the widest variant,
   * which is worse than today for a small picture — or lie about its width.
   */
  srcSet: string | null;
  /** The original's real pixel size, as measured at upload. */
  width: number | null;
  height: number | null;
}

/**
 * The address for a picture **and** its narrower copies, for an item whose
 * access has ALREADY been decided.
 *
 * **This function grants nothing and checks nothing**, exactly as
 * `mediaUrlFor()` does not — it is the step after `mayAccess()` said yes, and
 * the variants are the same row's bytes at a different width, so they inherit
 * that decision and are never authorised separately. Adding a second check here
 * would be a second place for the rule to live and therefore a second place for
 * it to disagree; the invariant to preserve is the one
 * `modules/courses/lib/media.ts` states — `mayAccess()` before this, **in one
 * function**, so no renderer can do the second half without the first.
 *
 * ── Why the `srcset` cannot go through `next/image` ────────────────────────
 * `next/image` builds its own `srcset` from a `loader`, and a loader is a
 * FUNCTION — it cannot cross from a server component into a client one, and
 * these addresses are minted on the server because every address in this system
 * is. There is nothing to give up by not using it: bucket media is already
 * `unoptimized` (`next.config.ts` declares no `remotePatterns`, for the two
 * reasons written out there), so for exactly this case `next/image` is a wrapper
 * around nothing. `components/ui/figure.tsx` renders a bare `<img>` for it, with
 * the eslint disable carrying that sentence.
 *
 * ── What this does NOT fix ─────────────────────────────────────────────────
 * The addresses expire (`kinds.image.signedUrlSeconds`), so a page left open
 * past the expiry holds stale candidates — exactly as its single `src` does
 * today. Nothing here changes that and nothing here should pretend to;
 * `docs/visuals.md` carries the expiry story.
 */
export function mediaImageFor(row: MediaRow, options: MediaUrlOptions = {}): MediaImage {
  const src = mediaUrlFor(row, options);
  const base: MediaImage = { src, srcSet: null, width: row.width, height: row.height };

  // A download is one file — the browser is saving it, not laying it out. And a
  // non-image has no widths to choose between.
  if (options.download || row.kind !== "image") return base;

  const widths = row.variants ?? [];
  // `row.width` is what describes the ORIGINAL candidate; without it there is no
  // honest `srcset` (see the field's own comment above).
  if (widths.length === 0 || !row.width || row.width <= 0) return base;

  const store = mediaStore();
  const candidates: string[] = [];
  for (const width of [...widths].sort((a, b) => a - b)) {
    // A recorded width wider than the original cannot happen —
    // `variantWidthsFor()` compares strictly — but a row edited by hand could
    // say so, and a candidate claiming to be wider than the file it points at
    // makes a browser download the wrong one.
    if (width >= row.width) continue;
    const address = variantAddress(store, row, variantKey(row.storageKey, width));
    // 🚨 **One address that cannot be minted drops the whole `srcset`.** On the
    // local driver `signedUrl()` answers null for everything (there is no
    // address a browser can reach that is not this app), and a partial `srcset`
    // would hand the browser a candidate list with a hole in it. Falling back to
    // the plain `src` is what that driver did before variants existed.
    if (!address) return base;
    candidates.push(`${address} ${width}w`);
  }
  if (candidates.length === 0) return base;

  candidates.push(`${src} ${row.width}w`);
  return { ...base, srcSet: candidates.join(", ") };
}

/**
 * One variant's address — the same two branches `mediaUrlFor()` takes for the
 * original, and deliberately no third.
 *
 * A `public` item's copies are public: they are the same bytes at another size,
 * and giving them a signature the original does not have would be a different
 * answer to the same question. Everything else is signed for the kind's own
 * window, so a variant expires with its original rather than outliving it.
 */
function variantAddress(store: MediaStore, row: MediaRow, key: string): string | null {
  if (row.visibility === "public") {
    const url = store.publicUrl(key);
    if (url) return url;
  }
  return store.signedUrl(key, {
    expiresSeconds: signedUrlSeconds(row.kind),
    contentType: row.mime,
  });
}
