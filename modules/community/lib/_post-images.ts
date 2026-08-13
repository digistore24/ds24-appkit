// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, or } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { communityPostMedia } from "../schema";
import { acceptUpload, deleteMedia, mayAccess } from "@/lib/media/manage";
import { guardUploadEntry } from "@/lib/media/upload-endpoint";
import { communityConfig } from "./config";
import { CommunityError, checkPostImages } from "./rules";

/**
 * Where a post's pictures go in the bucket, and what they are.
 *
 * 🚨 **One object, used by the writer AND by the test that measures the account
 * sweep.** AC 6 of Story 26.2 asks for the deletion to be *measured* rather than
 * inferred from "`members` is in `OWNED_MEDIA_VISIBILITIES`, and the avatar is
 * swept" — and a measurement built on values retyped into the test would prove
 * something about the test. `post-image-deletion.test.ts` reads these, so the
 * row it hands `deleteOwnedMedia()` is stored exactly as a real post image is.
 *
 * `namespace` is this module's own id and may not be anything else:
 * `modules/boundary.test.ts` refuses a slot naming another module's namespace,
 * because a key claiming to be somebody else's is how a lifecycle rule scoped to
 * one subsystem quietly deletes another's. With `category` it makes the key
 * `community/post/<YYYY>/<MM>/<id>.<ext>` — 26.1's grammar, one slot per thing
 * this module stores.
 */
export const POST_IMAGE_SLOT = {
  namespace: "community",
  category: "post",
  /**
   * ⚠️ **`members`, not `owner`, and the choice is the whole point of that
   * visibility.** A picture in a room has to be readable by everybody else in
   * the room; `owner` would show it to nobody but its author, `entitled` would
   * bind it to a Product Key the room may not have, and `public` would put a
   * member's photograph on an anonymous bucket address. `members` is any active
   * session and nothing more (`lib/media/rules.ts` argues the other three), and
   * it is what puts these rows inside `OWNED_MEDIA_VISIBILITIES` — so they go
   * with the account, which is the second half of AC 6.
   *
   * The ROOM's door is not this decision: a picture is only ever reached through
   * a post, and a post is only ever reached through a thread whose access is
   * re-derived per request. `members` is the floor, not the gate.
   */
  visibility: "members",
  /**
   * A picture, and only a picture. `mayUpload.member` also allows
   * `application/pdf`, so without this a member could attach a 50 MB document
   * to a post and every reader would render a broken image. The `accept` on the
   * input is a browser hint and is not a check.
   */
  onlyKinds: ["image"],
} as const;


/**
 * Store a post's pictures — the WHOLE shipped pipeline, per file, in order.
 *
 * `guardUploadEntry()` is the outer half — is media switched on, is the store
 * usable, has this member had their share of the hour — and `acceptUpload()` the
 * inner one: bytes sniffed rather than believed, the role's ceiling, EXIF
 * stripped, no SVG. Both, in that order, for every file. A door that calls only
 * the second is an upload path with no rate limit on which the operator's media
 * kill switch silently does nothing, and it is a bug this template has already
 * shipped once (Story 19.4).
 *
 * ⚠️ **It runs INSIDE `addPost()` / `startDiscussion()`, after their guards.**
 * Not in the action: an upload before the access check would let somebody who is
 * no longer in the room put bytes in the operator's bucket and spend their hourly
 * allowance on a post that is then refused. Same reasoning as `avatarUrlsFor()`
 * keeping `mayAccess()` and the mint in one function — the order is the design,
 * so it lives where nothing can enter past it.
 *
 * 🚨 **A picture that cannot be stored fails the whole post**, which is the
 * OPPOSITE of what the avatar path does, and the difference is deliberate.
 * `profile-actions.ts` saves the name and reports the picture separately because
 * the two are independent edits to a form. A post is one utterance: publishing
 * the words without the pictures somebody attached to them puts half a
 * contribution in a room permanently — and there is no way back, because editing
 * a post does not take pictures. So the refusal keeps their text in the composer
 * (NFR-37) and they can try again. Anything this attempt already stored is
 * removed on the way out.
 */
export async function storePostImages(
  viewer: { memberId: string; role: string },
  uploads: readonly PostImageUpload[],
  alts: readonly string[],
): Promise<string[]> {
  const stored: string[] = [];
  try {
    for (let index = 0; index < uploads.length; index += 1) {
      guardUploadEntry(viewer.memberId);
      const row = await acceptUpload({
        ownerId: viewer.memberId,
        role: viewer.role || "member",
        ...POST_IMAGE_SLOT,
        bytes: uploads[index].bytes,
        claimedMime: uploads[index].claimedMime,
        filename: uploads[index].filename,
        // Required and never derived — see `checkPostImages()`. A prompt, a
        // filename or the post's own text would each be a sentence about
        // something other than the picture.
        alt: alts[index],
      });
      stored.push(row.id);
    }
    return stored;
  } catch (error) {
    await discardPostImages(stored);
    throw error;
  }
}

/**
 * Take back pictures a post never got.
 *
 * Best-effort and logged rather than thrown: the caller is already on its way
 * out with a refusal, and turning a failed cleanup into a second, different
 * error would replace a sentence the member can act on with one nobody can. An
 * object left behind is swept when the account is deleted, and `node run.mjs
 * errors` finds the line meanwhile.
 */
export async function discardPostImages(mediaIds: readonly string[]): Promise<void> {
  for (const id of mediaIds) {
    try {
      await deleteMedia(id);
    } catch (error) {
      console.error("[community] could not remove an unattached post image", id, error);
    }
  }
}

/**
 * The pictures a member attached, as they are read in `checkPostImages()`'s
 * terms — pure decision first, bytes afterwards.
 *
 * Shared by both write paths so a thread's first post and a reply cannot come to
 * disagree about the ceiling, the descriptions or the order of the checks.
 */
export function judgePostImages(input: {
  images?: readonly PostImageUpload[];
  imageAlts?: readonly unknown[];
}): { uploads: readonly PostImageUpload[]; alts: string[] } {
  const uploads = input.images ?? [];
  const judged = checkPostImages(
    uploads.length,
    input.imageAlts ?? [],
    communityConfig().posting.imagesMax,
  );
  if (!judged.ok) throw new CommunityError(judged.code);
  return { uploads, alts: judged.alts };
}

/**
 * Write the attachment rows — inside the post's own transaction, always.
 *
 * `position` is the index the form delivered, dense and from zero: it is the
 * order the member chose, and it is part of the primary key, so a post cannot
 * end up with two pictures in one place.
 */
export async function attachPostImages(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  postId: string,
  mediaIds: readonly string[],
): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx.insert(communityPostMedia).values(
    mediaIds.map((mediaId, position) => ({ postId, mediaId, position })),
  );
}

/**
 * One picked file, as a write path receives it.
 *
 * ⚠️ **Bytes, not a `File`.** The bytes have to be in this process for the
 * location data to come off them (`profile-ui.tsx` says why `direct` is absent
 * for exactly this reason), and a `File` in the signature would tie this layer to
 * the shape a Server Action happens to receive. The action converts once; every
 * test hands the same three fields.
 */
export interface PostImageUpload {
  bytes: Uint8Array;
  claimedMime: string | null;
  filename: string | null;
}
