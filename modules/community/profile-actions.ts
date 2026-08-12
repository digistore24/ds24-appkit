// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The member's own community profile — the template's first member-facing
// self-service write beyond credentials.
//
// It follows the two rules of the account page next door exactly, and they are
// worth restating rather than assumed:
//
//  1. `requireActiveUser()` FIRST, on every action. A server action is an HTTP
//     endpoint in its own right; the page having guarded itself protects
//     nothing here.
//  2. **The account acted on is the session's own.** No member id is read from
//     the form and none may ever be — that is what makes an IDOR impossible
//     rather than merely unlikely, because there is no parameter to tamper
//     with.
//
// And one rule of its own, from AD-67: the community's enablement is re-checked
// HERE, per request, not merely relied upon because the card that submits this
// form is hidden when the community is off. Hiding is never guarding — a form
// post does not care that the card was not rendered.
//
// LANGUAGE: here, and only here, the codes from lib/community/rules.ts become
// sentences, in the language of the member currently clicking (AD-10).
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import { refreshAvatarAlt, setProfileAvatar, upsertProfile } from "@/modules/community/lib/manage";
import { acceptUpload, deleteMedia } from "@/lib/media/manage";
import { guardUploadEntry } from "@/lib/media/upload-endpoint";
import { MediaError } from "@/lib/media/rules";
import {
  CommunityError,
  MAX_COMMUNITY_ABOUT_LENGTH,
  MAX_COMMUNITY_DISPLAY_NAME_LENGTH,
} from "@/modules/community/lib/rules";

const PAGE = "/dashboard/account";

export interface ActionState {
  error: string | null;
  ok: string | null;
}

export async function saveCommunityProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireActiveUser();

    // Per request, and before any write. The card is hidden while the community
    // is off; this is the check that makes the absence of the card irrelevant.
    if (!isCommunityEnabled()) {
      // Not `notFound()`: the account page is not a community route and must
      // keep rendering with the community off. A member who had the card open
      // when the operator switched it off gets a refusal, not a broken page.
      //
      // ⚠️ And the refusal says NOTHING about a community. `errors.communityOff`
      // exists, and using it here was a code review finding: AD-67 reserves
      // that sentence for the operator's diagnosis view, and this is a member
      // surface. Worse, a server action is a public endpoint — so a member who
      // never saw this card could post to it and be told a community module
      // exists on this installation, which is exactly the distinction FR-180
      // is built to erase. The generic sentence is the one that reveals
      // nothing; `revalidatePath` then takes the card away.
      revalidatePath(PAGE);
      const t = await getTranslations("errors");
      return { error: t("unknown"), ok: null };
    }

    const memberId = session.user.id as string;
    const t2 = await getTranslations("errors");
    const profile = await upsertProfile(memberId, {
      displayName: formData.get("displayName"),
      // `has` before `get`: absent and empty mean different things to
      // `upsertProfile` (see its comment), and `get` alone flattens them.
      ...(formData.has("about") ? { about: formData.get("about") } : {}),
    });

    // ── The picture, through the WHOLE shipped pipeline ─────────────────────
    // "The shipped pipeline" turned out to have two halves, and the first
    // version of this action entered only one of them. `acceptUpload()` is the
    // inner half — bytes sniffed rather than believed, the role's ceiling, EXIF
    // stripped, no SVG. `guardUploadEntry()` is the outer half — is the feature
    // on, is the store usable, has this member had their share of the hour —
    // and skipping it meant an upload door with NO rate limit at all, on which
    // the operator's media kill switch silently did nothing. Both, in order,
    // always.
    //
    // Still called from here rather than through the HTTP route, and for the
    // original reason: that route hardcodes `visibility: "owner"` so a customer
    // cannot mint `public` or `entitled` by posting a field, and its own comment
    // names a guarded server action as the way to store anything else.
    const upload = formData.get("avatar");
    const wantsRemoval = formData.get("removeAvatar") === "on";
    let uploadFailure: string | null = null;

    if (upload instanceof File && upload.size > 0) {
      try {
        guardUploadEntry(memberId);
        const stored = await acceptUpload({
          ownerId: memberId,
          role: session.user.role ?? "member",
          // ── Whose object this is, and what it is for ──────────────────────
          // The namespace is this module's own id and may not be anything else:
          // `modules/boundary.test.ts` refuses a slot naming another module's
          // namespace, because a key claiming to be somebody else's is how a
          // lifecycle rule scoped to one subsystem quietly deletes another's.
          namespace: "community",
          category: "profile",
          bytes: new Uint8Array(await upload.arrayBuffer()),
          claimedMime: upload.type || null,
          filename: upload.name || null,
          visibility: "members",
          // A face, and only a face. `mayUpload.member` also allows
          // `application/pdf`, so without this a member could make a 50 MB
          // document their profile picture and every avatar would render broken.
          // The `accept="image/*"` attribute on the input is a browser hint and
          // is not a check.
          onlyKinds: ["image"],
          // Images require alternative text, and the honest one for a face is
          // the name it appears beside. It is STORED on the media row, so a
          // later rename has to rewrite it — see `refreshAvatarAlt` below.
          alt: profile.displayName,
        });

        const replaced = await setProfileAvatar(memberId, stored.id);
        if (replaced && replaced !== stored.id) {
          // The object is gone or it is not, and either way the member's new
          // picture is already theirs. Reporting a successful change as a
          // failure — which is what letting this throw did — is worse than an
          // orphaned object, and the orphan is swept at account deletion
          // anyway. It is logged so `node run.mjs errors` can find it.
          try {
            await deleteMedia(replaced);
          } catch (error) {
            console.error("[community] could not remove the replaced avatar", replaced, error);
          }
        }
      } catch (error) {
        unstable_rethrow(error);
        // The NAME is already saved at this point. Reporting the whole save as
        // failed — and skipping `revalidatePath` — left the card showing the old
        // name while the rename had in fact happened, which is the worst of the
        // available outcomes. So the picture's failure is carried separately and
        // the page is revalidated regardless.
        if (error instanceof MediaError) uploadFailure = t2(error.code);
        else {
          console.error("[community] avatar upload failed", error);
          uploadFailure = t2("unknown");
        }
      }
    } else if (wantsRemoval) {
      // Removing is the null path `setProfileAvatar` already accepted and
      // nothing ever used. A member who regrets a picture should not have to
      // find another one to be rid of it.
      const removed = await setProfileAvatar(memberId, null);
      if (removed) {
        try {
          await deleteMedia(removed);
        } catch (error) {
          console.error("[community] could not remove the avatar", removed, error);
        }
      }
    } else if (profile.avatarMediaId) {
      // No new picture, no removal — but the name may have changed, and the
      // stored `alt` is the OLD name until something rewrites it.
      await refreshAvatarAlt(profile.avatarMediaId, profile.displayName);
    }

    revalidatePath(PAGE);
    const t = await getTranslations("community");
    // The name saved either way; the picture may not have. Say which.
    if (uploadFailure) return { error: uploadFailure, ok: t("profileSavedNoPicture") };
    return { error: null, ok: t("profileSaved") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * The house error shape, identical to `api-key-actions.ts` and `actions.ts`.
 *
 * Rethrowing an unexpected error — which this action used to do — takes the
 * whole account page to its error boundary over a failure that belongs in one
 * toast, and logs nothing for `node run.mjs errors` to find. A pool exhaustion
 * or an FK violation (the session's user row deleted in another tab) is
 * exactly that case.
 */
async function toState(error: unknown): Promise<ActionState> {
  // redirect() signals by THROWING — that is how requireActiveUser() sends a
  // signed-out or blocked visitor to /login. Swallowing it would turn a
  // legitimate redirect into "unknown error".
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof CommunityError) {
    // The two bounded codes carry their cap into the sentence, so raising a
    // limit cannot leave a message quoting the old number.
    if (error.code === "communityDisplayNameInvalid") {
      return { error: t(error.code, { max: MAX_COMMUNITY_DISPLAY_NAME_LENGTH }), ok: null };
    }
    if (error.code === "communityAboutTooLong") {
      return { error: t(error.code, { max: MAX_COMMUNITY_ABOUT_LENGTH }), ok: null };
    }
    return { error: t(error.code), ok: null };
  }

  // A refusal from the media pipeline is a member mistake, not a fault: too
  // large, wrong type, a role that may not upload it. Those codes already have
  // sentences in both languages (`i18n/messages.test.ts` enforces it), so they
  // are translated rather than swallowed into "something went wrong".
  if (error instanceof MediaError) return { error: t(error.code), ok: null };

  console.error("[community] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}
