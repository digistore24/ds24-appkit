// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Server actions of the community rooms screen.
//
// SECURITY — every action opens with the SAME two lines, in this order:
//
//   1. `notFound()` when the community is not running on this installation.
//      Disabled means gone, for the operator too — there is no admin preview
//      of a switched-off module, by decision: switching it on is an edit to
//      `config/community.json` and the next deploy, and configuring rooms
//      comes after that. A community that is switched ON but whose config does
//      not hold gets the same answer here: this is not the diagnosis surface —
//      `/dashboard/community` is, and it is the module's one door for that.
//   2. `requireOwner()`. A Server Action is an HTTP endpoint in its own right,
//      so the page's guard protects nothing here. Moderators are refused too:
//      they look after rooms, they do not create them.
//
// Neither line is optional and neither is enough on its own. Skipping the
// first would leave a working write path into a module the operator switched
// off; skipping the second would leave every signed-in member able to create
// rooms by posting to an endpoint they can read out of the page's own script.
//
// LANGUAGE: here — and only here — the codes from `lib/community/rules.ts`
// become sentences (AD-10). `communityUnknownPlanKey` carries the mistyped key in the
// error's `detail`, because a refusal that does not name the key it refused
// leaves the operator re-reading five product entries.
import { revalidatePath } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireOwner } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  assignGroupModerator,
  createGroup,
  removeGroupModerator,
  reorderGroups,
  setGroupArchived,
  setMemberStanding,
  updateGroup,
} from "@/modules/community/lib/manage";
import {
  CommunityError,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  isGroupAccessLevel,
} from "@/modules/community/lib/rules";

const PAGE = "/dashboard/admin/community";

/** Return value for useActionState — `error`/`ok` are finished messages. */
import type { ActionState } from "@/lib/action-state";

// Re-exported so the components beside this file keep importing it from here.
// 🚨 WITH the `from` clause, and that is not a style choice. Written
// `export type { ActionState };` — a re-export of a LOCAL binding — Turbopack's
// "use server" transform emits the bare identifier into the server entry list
// (`ensureServerEntryExports([…, ActionState])`) where nothing defines it, and
// the first POST to ANY action in the file dies with
// `ReferenceError: ActionState is not defined`. Measured in this template's own
// production build; `scripts/server-actions.test.ts` now refuses the form.
export type { ActionState } from "@/lib/action-state";

/**
 * The two guards, in the one order that is correct.
 *
 * `notFound()` and `requireOwner()` both signal by throwing, so this returns
 * only for a caller who passed both.
 */
async function guard(): Promise<void> {
  if (!isCommunityEnabled()) notFound();
  await requireOwner();
}

/**
 * The same two guards, handing back WHO passed them.
 *
 * A separate function rather than changing `guard()`'s return type: every
 * caller above wants the refusal and none of them wants the session, and a
 * guard whose value is usually discarded invites the next reader to think the
 * value is optional. The one act that records an actor asks for one.
 */
async function guardAsOperator(): Promise<string> {
  if (!isCommunityEnabled()) notFound();
  const session = await requireOwner();
  return session.user.id;
}

/** Turn an error from the rules/database layer into a displayable message. */
async function toState(error: unknown): Promise<ActionState> {
  // redirect() and notFound() signal by THROWING — that is how the two guards
  // above answer. Swallowing them would turn a legitimate refusal into
  // "unknown error" and log a fake fault for `node run.mjs errors` to find.
  unstable_rethrow(error);
  const t = await getTranslations("errors");

  if (error instanceof CommunityError) {
    // The bounded codes carry their cap into the sentence, so raising a limit
    // cannot leave a message quoting the old number; `communityUnknownPlanKey` carries
    // the key. Extra values are harmless for a message that uses none.
    return {
      error: t(error.code, {
        max:
          error.code === "communityGroupDescriptionTooLong"
            ? MAX_GROUP_DESCRIPTION_LENGTH
            : MAX_GROUP_NAME_LENGTH,
        ...error.detail,
      }),
      ok: null,
    };
  }

  console.error("[community] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * The access level and its keys, out of the form — `null` for a level that is
 * not one of the four.
 *
 * `getAll("planKeys")` rather than one comma-separated field: the form is a
 * set of checkboxes over the product registry, so a key containing a comma is
 * never a parsing question. The level is checked here rather than handed on,
 * because the column is a database enum: an unknown value would come back as a
 * driver error in the log instead of a sentence on the screen. Through the
 * shipped `<Select>` it cannot happen; through a crafted post it can, and an
 * action is a public endpoint.
 */
function levelFrom(
  formData: FormData,
): {
  accessLevel: "open" | "plan" | "moderators" | "operator";
  planKeys: string[];
} | null {
  const accessLevel = formData.get("accessLevel");
  if (!isGroupAccessLevel(accessLevel)) return null;
  return {
    accessLevel,
    planKeys: formData.getAll("planKeys").map((value) => String(value)),
  };
}

export async function createGroupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const level = levelFrom(formData);
    if (!level) {
      const t = await getTranslations("errors");
      return { error: t("unknown"), ok: null };
    }
    const group = await createGroup({
      name: formData.get("name"),
      description: formData.get("description"),
      ...level,
    });
    revalidatePath(PAGE);
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t("created", { name: group.name }) };
  } catch (error) {
    return toState(error);
  }
}

export async function updateGroupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const level = levelFrom(formData);
    if (!level) {
      const t = await getTranslations("errors");
      return { error: t("unknown"), ok: null };
    }
    await updateGroup(String(formData.get("id") ?? ""), {
      name: formData.get("name"),
      description: formData.get("description"),
      ...level,
    });
    revalidatePath(PAGE);
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t("saved") };
  } catch (error) {
    return toState(error);
  }
}

export async function setGroupArchivedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    // The desired state comes from the form rather than being a toggle: two
    // operators clicking the same row would otherwise cancel each other out.
    // The most recently expressed wish wins (the `setBlockedAction` idiom).
    const archived = formData.get("archived") === "true";
    await setGroupArchived(String(formData.get("id") ?? ""), archived);
    revalidatePath(PAGE);
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t(archived ? "archived" : "restored") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Move one room up or down.
 *
 * The client submits the whole ordered id list, not "swap these two": a
 * position rewrite is idempotent and cannot leave the list half-swapped, and
 * the server does not have to reconstruct what the operator was looking at.
 */
export async function reorderGroupsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    await reorderGroups(
      formData.getAll("orderedIds").map((value) => String(value)),
    );
    revalidatePath(PAGE);
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t("reordered") };
  } catch (error) {
    return toState(error);
  }
}

export async function assignModeratorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    await assignGroupModerator(
      String(formData.get("groupId") ?? ""),
      String(formData.get("memberId") ?? ""),
    );
    revalidatePath(PAGE);
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t("moderatorAssigned") };
  } catch (error) {
    return toState(error);
  }
}

export async function removeModeratorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    await removeGroupModerator(
      String(formData.get("groupId") ?? ""),
      String(formData.get("memberId") ?? ""),
    );
    revalidatePath(PAGE);
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t("moderatorRemoved") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Put a member on one of the three lists, or take them off it.
 *
 * 🚨 **`requireOwner()`, never `mayModerate()`.** A standing decision has no
 * WHERE — it applies everywhere at once — so scoping it by room duty would let
 * a moderator who looks after one room neutralise somebody who reports them in
 * another. The role is granted in the core's user administration and the lists
 * are set here; both are the operator's.
 *
 * One field per submit, and the desired VALUE comes from the form rather than
 * being a toggle: two operators pressing the same row would otherwise cancel
 * each other out. The `setBlockedAction` idiom, one table over.
 */
export async function setStandingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const actorId = await guardAsOperator();
    const field = String(formData.get("field") ?? "");
    if (
      field !== "protected" &&
      field !== "writeBlocked" &&
      field !== "reportsIgnored"
    ) {
      // Not one of the three. Through the shipped form this cannot happen;
      // through a crafted post it can, and an action is a public endpoint.
      const t = await getTranslations("errors");
      return { error: t("unknown"), ok: null };
    }
    const value = formData.get("value") === "true";
    await setMemberStanding({
      actorId,
      memberId: String(formData.get("memberId") ?? ""),
      field,
      value,
      reason: formData.get("reason"),
    });
    revalidatePath(PAGE);
    revalidatePath("/dashboard/community/reports");
    const t = await getTranslations("communityAdmin");
    return { error: null, ok: t(value ? "listed" : "unlisted") };
  } catch (error) {
    return toState(error);
  }
}
