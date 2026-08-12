// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Taking an upload in — the pipeline both upload doors share.
//
// `app/api/media/route.ts` (session cookie) and `app/api/v1/media/route.ts`
// (bearer key) prove WHO is uploading and then come here. The member and role
// handed in are already authenticated by the caller — and the owner of the
// stored item is ALWAYS that member: there is no `ownerId` field to send,
// which is what keeps a foreign upload (and the read-back `owner` visibility
// would then grant) impossible by construction.
//
// ── Why the bytes travel through the app ───────────────────────────────────
// Because this is where they are checked: the type is read from the bytes
// rather than believed, and an image's location data is stripped before
// anything is stored. That costs one pass through the process per file, once,
// and it is the reason a customer cannot put an executable where the app will
// later hand it to another customer.
//
// It also sets the ceiling. Several hundred megabytes through a route handler
// is not an upload, it is an outage — the hosts cap the request body and the
// process buffers what it is checking. The way past that ceiling is the
// browser writing straight to the bucket, and since Story 8.1 that path
// exists: `createUploadTicket()` / `confirmUpload()` in `lib/media/manage.ts`,
// entered through `app/api/media/upload-url` and `app/api/media/confirm`.
//
// **It is a second way in, not a replacement**, and the two divide the work
// rather than competing: the direct path takes what is too big to travel
// through a process, this one keeps everything whose checking needs the bytes
// in hand. An image is the case that makes the split concrete — location data
// comes off here, so pictures go this way and the direct path refuses them
// (`docs/data-protection.md` §14, `kindNotDirect`).
import { isMediaEnabled, mediaConfig } from "@/lib/media/config";
import { acceptUpload } from "@/lib/media/manage";
import {
  MediaError,
  formatBytes,
  kindForMime,
  routeCeilingBytes,
  type MediaErrorCode,
} from "@/lib/media/rules";
import { mediaStoreProblems } from "@/lib/media/store";
import { forgetOne, isLimited, record } from "@/lib/rate-limit";

/**
 * The hourly ceiling's bucket, and the ONE place it is named.
 *
 * Every door that stores an upload draws on this same bucket keyed by the
 * member, so a member cannot get a fresh allowance by choosing a different
 * entrance. Exported for that reason rather than for reuse.
 */
export const UPLOAD_BUCKET = "media-upload";
const BUCKET = UPLOAD_BUCKET;

/**
 * The preconditions EVERY upload door shares — the outer half of the pipeline.
 *
 * `acceptUpload()` is the inner half: what the bytes are, whether the role may
 * put that in, the metadata strip. Around it sit three questions that have
 * nothing to do with the bytes and everything to do with whether this request
 * should be doing any work at all:
 *
 *   1. is the feature switched on,
 *   2. is there a working place to put things,
 *   3. has this member had their share of the hour.
 *
 * ⚠️ **It exists because a door was built that skipped all three.** Story 19.4
 * stored avatars by calling `acceptUpload()` from a server action, which is
 * genuinely the shipped pipeline — and genuinely only half of it. The result
 * was an upload path with no rate limit at all, on which the operator's media
 * kill switch silently did nothing. Any new door calls THIS first; a door that
 * calls `acceptUpload()` alone is the same bug again.
 *
 * Throws `MediaError` so a server action can translate it like any other
 * refusal; `handleUpload()` maps the same codes to HTTP statuses.
 */
export function guardUploadEntry(memberId: string): void {
  if (!isMediaEnabled()) throw new MediaError("storeUnavailable");

  const storeProblems = mediaStoreProblems();
  if (storeProblems.length > 0) {
    console.error("[media] the store is not usable:", storeProblems);
    throw new MediaError("storeUnavailable");
  }

  const limit = { max: mediaConfig().maxUploadsPerHour, windowMs: 60 * 60 * 1000 };
  if (isLimited(BUCKET, memberId, limit)) throw new MediaError("rateLimited");
  // Counted BEFORE the work, not after: a refused request still consumed the
  // thing this limit protects.
  record(BUCKET, memberId, limit);
}

/**
 * The same preconditions, for the SECOND half of a direct-to-bucket upload —
 * without the meter.
 *
 * 🚨 **The one door that may skip the counting, and why it is not a loophole.**
 * A direct upload is two requests: one that mints an address and one that
 * confirms what landed. `guardUploadEntry()` runs on the first, which is where
 * the hourly slot is genuinely spent — an address handed out is the thing the
 * ceiling protects, whether or not anybody writes to it. Calling the counting
 * guard again on the confirm step would charge every upload twice, halving an
 * operator's configured allowance without a word anywhere saying so.
 *
 * What does NOT get skipped is the rest: media switched off and a broken store
 * both refuse here exactly as they refuse there, so the kill switch reaches
 * both halves. `lib/media/manage.test.ts` records which guard each door uses,
 * so a second caller cannot quietly adopt this one.
 *
 * The only legitimate caller is `app/api/media/confirm/route.ts`.
 */
export function guardUploadConfirm(): void {
  if (!isMediaEnabled()) throw new MediaError("storeUnavailable");

  const storeProblems = mediaStoreProblems();
  if (storeProblems.length > 0) {
    console.error("[media] the store is not usable:", storeProblems);
    throw new MediaError("storeUnavailable");
  }
}

function refuse(code: MediaErrorCode, status: number, detail?: string): Response {
  return Response.json({ error: code, detail }, { status });
}

/**
 * Accepts one upload for an ALREADY AUTHENTICATED member.
 *
 * Both doors share the `media-upload` bucket keyed by that member, so web and
 * API draw on ONE hourly ceiling by construction. The role decides what may
 * go in (`config/media.json` → `mayUpload`) — for the API door it rides in
 * on the key (`authenticate()` joins it), for the web door on the session.
 */
export async function handleUpload(args: {
  memberId: string;
  role: string;
  request: Request;
}): Promise<Response> {
  const { memberId, role, request } = args;

  // 1+2. Is the feature on, is there anywhere to put things, and has this
  //      member had their share of the hour — all three in `guardUploadEntry`,
  //      which every door shares so that none of them can be built without it.
  //      Before the body is read, because reading it is the expensive part and
  //      a limit that fires afterwards has already paid for what it refuses.
  try {
    guardUploadEntry(memberId);
  } catch (error) {
    if (error instanceof MediaError) {
      return refuse(error.code, error.code === "rateLimited" ? 429 : 503);
    }
    throw error;
  }

  const config = mediaConfig();

  // 3. Get the file out of the request.
  //
  //    A request that turns out to carry no file gets its slot BACK. Counting
  //    before the read is right for the reason above, and it also metered the
  //    one case that costs nothing — an empty POST. A form bug or a client retry
  //    loop could then lock a member out for an hour without a byte having been
  //    uploaded, and there is no way for them to clear it. `forgetOne()` gives
  //    back exactly the hit recorded above; it is not `clearKey()`, which would
  //    turn an empty request into a quota reset.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    forgetOne(BUCKET, memberId);
    return refuse("noFile", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    forgetOne(BUCKET, memberId);
    return refuse("noFile", 400);
  }

  // 4. A size refusal from the part's declared length. NOT a check on its own —
  //    `acceptUpload` measures what actually arrived — and NOT free either:
  //    `request.formData()` above has already read the body, which is the
  //    ceiling this endpoint has and the reason the direct-to-bucket path
  //    exists (docs/visuals.md). It is here to give an oversized upload a
  //    message that names the limit rather than a generic refusal.
  // 🚨 `routeCeilingBytes()` — and which of the three ceilings this is took two
  //    goes to get right. The kind's raw `maxBytes` is what may be STORED, and
  //    stopped being usable here when `video` went to 2 GB for the direct path:
  //    `request.formData()` above has already buffered the body, so quoting a
  //    gigabyte at this door promises an outage. `slotCeilingBytes()` is not it
  //    either — that is `next.config.ts` → `bodySizeLimit`, which applies to a
  //    Server Action and never to a route handler, and using it here refused a
  //    30 MB recording the HTTP API had accepted since the day it existed.
  //    This is the third question: what THIS app puts through the process on
  //    one request (`rules.ts` → `ROUTE_HANDLER_BODY_LIMIT_BYTES`).
  const declaredKind = kindForMime(config, file.type || "");
  const ceiling = routeCeilingBytes(
    declaredKind
      ? config.kinds[declaredKind].maxBytes
      : Math.max(...Object.values(config.kinds).map((k) => k.maxBytes)),
  );
  if (file.size > ceiling) {
    return refuse("tooLarge", 413, `max ${formatBytes(ceiling)}`);
  }

  // 5. And now the real checks: what the bytes ARE, whether this role may put
  //    that in, and the metadata strip. All of it in `lib/media/manage.ts`.
  try {
    const row = await acceptUpload({
      ownerId: memberId,
      role,
      // ── The slot, and it is the CORE's ────────────────────────────────────
      // This is the generic door: whatever the app's own pages, and the `api`
      // module's `POST /api/v1/media`, hand in. The module reuses this pipeline
      // rather than building a second one, so the objects belong to the core and
      // not to it — a namespace names a subsystem that OWNS objects, never a
      // transport that carries them. Hard-coded here on purpose: a namespace
      // read off a request would let a caller file their own upload into a
      // module's key space.
      namespace: "core",
      category: "upload",
      bytes: new Uint8Array(await file.arrayBuffer()),
      claimedMime: file.type || null,
      filename: file.name || null,
      // Visibility is deliberately NOT read from the form. A customer must not
      // be able to publish their own upload, and they must certainly not be
      // able to file one as `entitled` and hand themselves paid content. An app
      // that needs those calls `createMedia()` from a Server Action of its own,
      // where an operator check can sit in front of it.
      visibility: "owner",
      alt: typeof form.get("alt") === "string" ? (form.get("alt") as string) : null,
    });

    return Response.json(
      { id: row.id, kind: row.kind, mime: row.mime, bytes: row.bytes },
      { status: 201, headers: { "cache-control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof MediaError) {
      const status =
        error.code === "tooLarge" ? 413 : error.code === "notAllowedForRole" ? 403 : 400;
      const detail =
        error.code === "tooLarge" && declaredKind
          ? `max ${formatBytes(routeCeilingBytes(config.kinds[declaredKind].maxBytes))}`
          : undefined;
      return refuse(error.code, status, detail);
    }
    // A store that refused the write. The message carries the provider's own
    // error code, which is the difference between "wrong key", "no such bucket"
    // and "clock skew" — it belongs in the log, never in the response.
    console.error("[media] upload failed:", error);
    return refuse("storeUnavailable", 502);
  }
}
