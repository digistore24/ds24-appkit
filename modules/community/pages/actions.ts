// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The member-facing community's write paths — starting a thread, replying,
// editing and deleting one's own post.
//
// SECURITY — the shape every one of them repeats, and none of them may skip:
//
//   1. `notFound()` when the community is not running here. A Server Action is
//      an HTTP endpoint of its own, so the page's guard protects nothing: an
//      app that switched the module off must have no working write path into
//      it, not merely no link to one.
//   2. `requireActiveUser()` — the session, and a blocked account is refused
//      by it.
//   3. The access decision, re-derived inside `lib/community/manage.ts` on
//      every call from the plans this member holds RIGHT NOW. Never carried
//      over from the render that drew the form: a refund between the page load
//      and the submit has to refuse the write, and that is the whole point of
//      deriving access rather than storing it.
//
// **No action here takes a member id**, in either direction. The author is
// always the session's own — the same guarantee `spendTokens()` gives by
// having no parameter for it — so editing and deleting can only ever reach a
// row this member wrote (and the UPDATE is scoped as well, in `manage.ts`).
//
// LANGUAGE: here, and only here, the codes become sentences (AD-10).
import { revalidatePath } from "next/cache";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { MediaError } from "@/lib/media/rules";
import { communityConfig, isCommunityEnabled } from "@/modules/community/lib/config";
import {
  acknowledgeRead,
  addEmbeddedPost,
  addPost,
  deleteOwnPost,
  editOwnPost,
  startDiscussion,
  type PostImageUpload,
} from "@/modules/community/lib/manage";
import {
  CommunityError,
  MAX_DISCUSSION_TITLE_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  MAX_POST_LENGTH,
} from "@/modules/community/lib/rules";

/**
 * Return value for useActionState — `error`/`ok` are finished messages.
 *
 * `postId` rides along on a successful reply and is the other half of the
 * optimistic send (NFR-37): the composer shows the post the moment the member
 * presses the button, and this id is what lets the live channel's next answer
 * UPSERT that same post rather than draw it a second time.
 *
 * ⚠️ It is absent on every refusal, in both directions — which is what keeps
 * `embed-refusal.test.ts`'s byte-for-byte comparison meaningful: two refusals
 * must serialize identically, and a field present on one of them would be the
 * difference a prober is looking for.
 */
export type ActionState = {
  error: string | null;
  ok: string | null;
  postId?: string;
};

/** The two lines every action opens with. Both signal by throwing. */
async function viewer(): Promise<{ memberId: string; role: string }> {
  if (!isCommunityEnabled()) notFound();
  const session = await requireActiveUser();
  return {
    memberId: session.user.id,
    role: session.user.role,
  };
}

async function toState(error: unknown): Promise<ActionState> {
  // redirect() and notFound() signal by THROWING — that is how the guards
  // above answer, and how a successful `startDiscussion` navigates. Swallowing
  // them would turn a legitimate refusal into "unknown error" and log a fault
  // that never happened.
  unstable_rethrow(error);
  const t = await getTranslations("errors");

  if (error instanceof CommunityError) {
    // The bounded codes carry their cap into the sentence, so raising a limit
    // cannot leave a message quoting the old number.
    return { error: t(error.code, { max: capFor(error.code), ...error.detail }), ok: null };
  }

  // A refusal from the media pipeline is a member mistake rather than a fault:
  // too large, not really a picture, a role that may not upload one. Those codes
  // already have sentences in both languages (`i18n/messages.test.ts` enforces
  // it), so they are translated here rather than swallowed into "something went
  // wrong" — the same ruling `profile-actions.ts` reached for the avatar door.
  if (error instanceof MediaError) return { error: t(error.code), ok: null };

  console.error("[community] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * Which cap a bounded code's sentence quotes.
 *
 * One place, because there are now four of them and a ternary chain is where the
 * fifth gets the wrong number. Every value is READ rather than written down:
 * `imagesMax` comes out of the config, so an operator who raises it cannot end up
 * with a refusal quoting three.
 */
function capFor(code: CommunityError["code"]): number {
  if (code === "communityTitleInvalid") return MAX_DISCUSSION_TITLE_LENGTH;
  if (code === "communityTooManyImages") return communityConfig().posting.imagesMax;
  if (code === "communityImageAltInvalid") return MAX_IMAGE_ALT_LENGTH;
  return MAX_POST_LENGTH;
}

/**
 * The pictures a member picked, paired with what they said each one shows.
 *
 * ⚠️ **Paired BY INDEX, and the empty slots are dropped as pairs.** The composer
 * renders one `<MediaUpload name="images">` per picture with an
 * `<input name="imageAlt">` beside it, so both arrive as repeated fields in the
 * order they were rendered — and a file input the member left alone still submits
 * an entry, with an empty name and zero bytes. Filtering the files alone would
 * shift every description one place along: slot 1 empty and slot 2 filled would
 * store picture 2 with the description nobody typed for picture 1. So the pair is
 * dropped or kept together, which is the only reading a form can express.
 *
 * It reads the bytes here rather than passing `File` objects on, because the
 * bytes have to be in this process for the location data to come off them anyway
 * (`profile-ui.tsx:162-172`) and because `manage.ts` then has no dependency on
 * the shape a Server Action happens to receive.
 *
 * ⚠️ **The ceiling is NOT applied here.** `checkPostImages()` applies it inside
 * `addPost()`, after the access check — a refusal in this function would be a
 * second copy of a bound, and this one would be the one nobody re-reads.
 */
async function pickedImages(
  formData: FormData,
): Promise<{ images: PostImageUpload[]; imageAlts: string[] }> {
  const files = formData.getAll("images");
  const alts = formData.getAll("imageAlt");

  const images: PostImageUpload[] = [];
  const imageAlts: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!(file instanceof File) || file.size === 0) continue;
    images.push({
      bytes: new Uint8Array(await file.arrayBuffer()),
      claimedMime: file.type || null,
      filename: file.name || null,
    });
    // The description travels raw — `checkPostImages()` is what judges it, and a
    // `String()` here would turn a missing field into the empty string, which is
    // a different refusal from the one the member should read.
    const alt = alts[index];
    imageAlts.push(typeof alt === "string" ? alt : "");
  }

  return { images, imageAlts };
}

export async function startDiscussionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string;
  try {
    const me = await viewer();
    const groupId = String(formData.get("groupId") ?? "");
    const { discussionId } = await startDiscussion(groupId, me, {
      title: formData.get("title"),
      content: formData.get("content"),
      ...(await pickedImages(formData)),
    });
    revalidatePath(`/dashboard/community/groups/${groupId}`);
    target = `/dashboard/community/discussions/${encodeURIComponent(discussionId)}`;
  } catch (error) {
    return toState(error);
  }

  // Outside the try: `redirect()` signals by throwing and `toState` would
  // rethrow it anyway, but keeping it here says so plainly. No success message
  // is sent and none is needed — the thread they just started IS the feedback,
  // and it is on the page they land on.
  redirect(target);
}

/**
 * Reply — into a room's thread, or into an embedded discussion.
 *
 * ⚠️ **The two legs differ only in the COORDINATE, never in the guard.** A
 * room's thread is named by its row id and the door is the room's; an embedded
 * one is named by its Subject Key and the door is the declaration in
 * `lib/community/embeds.ts`. Both re-derive access inside `manage.ts` on every
 * submit, and neither takes an access level or a plan key from the form — the
 * whole reason there is a registry.
 *
 * ⚠️ **The embedded leg deliberately does NOT `revalidatePath()`.** The path
 * to revalidate would be the HOST page's, and the only thing that knows it is
 * the browser — a path out of a form is a cache target somebody else chose,
 * and that reason does not expire with any later change to the transport.
 * Nothing took its place either: the leg answers with the new post's id,
 * `PostComposer` hands that to `LiveDiscussion` (`ui.tsx`), and the poll on
 * `/api/community/live` carries the same post to every other reader. So the
 * thread catches up without the host page being re-rendered at all, which is
 * the only way an embed can update itself without knowing where it lives.
 */
export async function addPostAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await viewer();
    const t = await getTranslations("community");
    const pictures = await pickedImages(formData);

    const subjectKey = formData.get("subjectKey");
    if (typeof subjectKey === "string" && subjectKey !== "") {
      const { postId } = await addEmbeddedPost(subjectKey, me, {
        content: formData.get("content"),
        ...pictures,
      });
      return { error: null, ok: t("postAdded"), postId };
    }

    const discussionId = String(formData.get("discussionId") ?? "");
    const { postId } = await addPost(discussionId, me, {
      content: formData.get("content"),
      ...pictures,
    });
    revalidatePath(`/dashboard/community/discussions/${discussionId}`);
    return { error: null, ok: t("postAdded"), postId };
  } catch (error) {
    return toState(error);
  }
}

export async function editPostAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await viewer();
    await editOwnPost(String(formData.get("postId") ?? ""), me, {
      content: formData.get("content"),
    });
    revalidatePath(
      `/dashboard/community/discussions/${String(formData.get("discussionId") ?? "")}`,
    );
    const t = await getTranslations("community");
    return { error: null, ok: t("postEdited") };
  } catch (error) {
    return toState(error);
  }
}

export async function deletePostAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const me = await viewer();
    await deleteOwnPost(String(formData.get("postId") ?? ""), me);
    revalidatePath(
      `/dashboard/community/discussions/${String(formData.get("discussionId") ?? "")}`,
    );
    const t = await getTranslations("community");
    return { error: null, ok: t("postDeleted") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * "I have read up to here."
 *
 * ⚠️ **Deliberately silent, and deliberately returns nothing.** It is not an
 * operation a reader asked for and it has no result they need — so it takes no
 * `ActionState`, shows no toast, and swallows what goes wrong. A read marker
 * that failed to save is a dot that stays on for one more navigation, and
 * putting that in front of somebody would be noise about their own reading.
 *
 * Everything that decides anything is in `acknowledgeRead()`: the access
 * re-check, the clamp of the id to a post that really is in this thread, and
 * the advance-only conflict clause. The id from the browser is the only thing
 * it takes, and the tuple written is the ROW's.
 *
 * The live-updates release becomes the second caller of the same path and
 * changes nothing about it — a channel that marked things read because it
 * delivered them would empty an inbox nobody looked at.
 */
export async function acknowledgeReadAction(
  discussionId: string,
  postId: string,
): Promise<void> {
  try {
    if (!isCommunityEnabled()) return;
    const session = await requireActiveUser();
    await acknowledgeRead({
      discussionId,
      postId,
      viewer: {
        memberId: session.user.id,
        role: session.user.role,
      },
    });
  } catch (error) {
    // `requireActiveUser()` redirects by throwing for a signed-out or blocked
    // visitor; that has to keep propagating rather than being logged as a
    // fault. Everything else is a fault, and it belongs in the log where
    // `node run.mjs errors` finds it — not on the page.
    unstable_rethrow(error);
    console.error("[community] could not record a read marker:", error);
  }
}
