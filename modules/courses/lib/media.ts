// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A lesson's four media slots, resolved for one viewer.
//
// 🚨 **`mayAccess()` before `mediaUrlFor()`, in ONE function, so no renderer can
// do the second half without the first.** `mediaUrlFor()` grants nothing and
// checks nothing — its own header says so — and calling it on an `entitled`
// worksheet without the check is exactly how a paid file becomes a public one.
// A page is where that gets skipped, which is why the two live here rather than
// in the page. The community's `avatarUrlFor()` is the same decision.
//
// ⚠️ **One query per slot, and a lesson has four.** That is fine for a page that
// renders ONE lesson and would not be for a list — the overview deliberately
// does not resolve media at all. A story that renders covers in a list needs a
// batch-shaped door beside this one, keyed by id; building it blind would be
// guessing at the join that story actually needs.
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { media, type MediaRow } from "@/db/schema-media";
import { findMedia, mayAccess, type Viewer } from "@/lib/media/manage";
import { mediaImageFor } from "@/lib/media/url";
import { formatBytes } from "@/lib/media/rules";

export interface ResolvedFile {
  href: string;
  /**
   * The narrower copies a browser may fetch instead — `null` for anything that
   * is not a picture, and for a picture with no variants (every one stored
   * before Story 26.2).
   *
   * 🚨 **Minted in the same function as the `mayAccess()` check, exactly as
   * `href` is.** A variant is the same row's bytes at another width, so it
   * inherits that decision and is never authorised separately; resolving it in
   * the page would be the second half without the first, which is the failure
   * this module's header is about.
   */
  srcSet: string | null;
  /**
   * The picture's real pixel size, measured at upload — `null` for a
   * non-picture and for a row written before the measurement existed.
   *
   * ⚠️ **This is what makes the `srcSet` honest**, so it travels with it: a
   * candidate list cannot mix width descriptors with bare candidates, so the
   * original needs its own real width or it has to be left out.
   */
  width: number | null;
  height: number | null;
  /** `null` when the upload carried no name — `<MediaDownload>` needs one anyway. */
  filename: string | null;
  size: string;
  mime: string;
  alt: string | null;
  /**
   * Where the object sits in the bucket — the string BOTH ends of a deep link
   * slugify.
   *
   * ⚠️ **The path, never the id.** A media id exists in exactly one database
   * (`../schema.ts`, header *"Media by FK"*), so an anchor computed from one
   * would name a different element in DEV than in PROD. The page renders
   * `id={mediaAnchor(path)}` and the content source computes the identical
   * string without ever seeing the page — that agreement is the whole reason
   * `lib/content-source/anchors.ts` exists, and it only holds while both sides
   * start from a value that travels.
   */
  path: string;
}

export interface UnitMedia {
  cover: ResolvedFile | null;
  video: ResolvedFile | null;
  subtitle: ResolvedFile | null;
  worksheet: ResolvedFile | null;
}

/**
 * One slot, or `null`.
 *
 * `null` covers three states on purpose — no id, no row, and not allowed — and
 * a page renders all three the same way: the thing is not there. Distinguishing
 * "you may not have this" from "there is none" on the page would tell a
 * non-buyer that a worksheet exists.
 */
async function resolve(
  id: string | null,
  viewer: Viewer,
  options: { download?: boolean } = {},
): Promise<ResolvedFile | null> {
  if (!id) return null;
  const row = await findMedia(id);
  if (!row) return null;
  if (!(await mayAccess(row, viewer))) return null;

  const image = mediaImageFor(row, options);
  return {
    href: image.src,
    srcSet: image.srcSet,
    width: image.width,
    height: image.height,
    filename: row.filename,
    size: formatBytes(row.bytes),
    mime: row.mime,
    alt: row.alt,
    path: row.storageKey,
  };
}

export interface UnitMediaIds {
  coverMediaId: string | null;
  videoMediaId: string | null;
  subtitleMediaId: string | null;
  worksheetMediaId: string | null;
}

/** What the OPERATOR's surface shows about an attached file. No address. */
export interface SlotSummary {
  readonly id: string;
  readonly filename: string | null;
  readonly bytes: number;
  readonly mime: string;
}

/**
 * Name, size and type for a set of media ids — one query for the whole page.
 *
 * ⚠️ **This is not the batch door the header above refuses to build, and the
 * difference is the whole reason it is allowed to exist.** `unitMedia()`
 * resolves ONE lesson for ONE viewer and mints an address, so its access check
 * and its per-slot query are the point. This resolves NOTHING: no
 * `mayAccess()`, no `mediaUrlFor()`, no bytes — three columns off the `media`
 * table so the operator's own surface can write "cover.jpg · 240 KB" beside a
 * slot it already knows is filled.
 *
 * It is therefore safe to batch and would be wrong to loop: the admin page
 * lists every lesson, and four `findMedia()` calls per row is the N+1 the
 * header warns about. **It is also owner-only by placement, not by check** —
 * the page and every action in front of it are `requireOwner()`, and this
 * function must never be called from a member surface, which would be handing
 * out the names of files somebody has not bought.
 */
export async function mediaSummaries(
  ids: readonly string[],
): Promise<Map<string, SlotSummary>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({
      id: media.id,
      filename: media.filename,
      bytes: media.bytes,
      mime: media.mime,
    })
    .from(media)
    .where(inArray(media.id, wanted));

  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The media rows behind a set of ids — one query, and **no address**.
 *
 * 🚨 **This is the batch door the header refuses to build blind, and the story
 * that needed it has arrived: the content source** (`../content-source.ts`).
 * It searches every lesson's slots at once, so four `findMedia()` calls per
 * lesson is exactly the N+1 the header warns about.
 *
 * It is safe to batch for the same reason `mediaSummaries()` is: it resolves
 * NOTHING. No `mediaUrlFor()`, so there is no address to hand out without a
 * check — and unlike `mediaSummaries()` it returns the WHOLE row, because the
 * caller's next line is `mayAccess(row, viewer)` and that needs the visibility
 * and the plan key. Returning rows rather than answers is what keeps the check
 * where AC 10 wants it: in the source, per row, refusal by skipping the hit.
 *
 * ⚠️ **A row coming back is not permission.** Whoever calls this and then reads
 * `storageKey` without asking `mayAccess()` has written the bug this module's
 * header is about, one level up.
 */
export async function mediaRowsFor(
  ids: readonly (string | null)[],
): Promise<Map<string, MediaRow>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
  if (wanted.length === 0) return new Map();

  const rows = await db.select().from(media).where(inArray(media.id, wanted));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function unitMedia(unit: UnitMediaIds, viewer: Viewer): Promise<UnitMedia> {
  const [cover, video, subtitle, worksheet] = await Promise.all([
    resolve(unit.coverMediaId, viewer),
    resolve(unit.videoMediaId, viewer),
    resolve(unit.subtitleMediaId, viewer),
    // The worksheet is what a buyer downloads, so it carries the original name.
    resolve(unit.worksheetMediaId, viewer, { download: true }),
  ]);
  return { cover, video, subtitle, worksheet };
}
