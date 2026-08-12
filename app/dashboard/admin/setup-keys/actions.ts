// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Server actions for the setup keys screen.
//
// 🚨 `requireOwner()` is the first line of both, and that is not redundancy with
// the page's own guard: a server action is an HTTP endpoint in its own right,
// so somebody who may not see the page could otherwise still call it.
//
// These two actions mint and revoke a credential that can write to this
// environment's database. They are the narrowest surface in the feature and
// they stay that way — there is deliberately no "show me that key again", no
// "extend this key" and no way to mint one for somebody else.

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/lib/authz";
import { mintKey, revokeKey } from "@/lib/setup/manage";

const PAGE = "/dashboard/admin/setup-keys";

export interface SetupKeyActionState {
  error: string | null;
  ok: string | null;
  /**
   * The new key, exactly once.
   *
   * It travels back through the action's return value and is never stored,
   * never logged and never re-readable. The UI renders it in a `Callout` rather
   * than a toast: a toast drifts past, and this is the only moment it exists.
   */
  secret: string | null;
}

export async function createSetupKeyAction(
  _prev: SetupKeyActionState,
  formData: FormData,
): Promise<SetupKeyActionState> {
  const session = await requireOwner();
  const t = await getTranslations("setupKeys");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) {
    return { error: t("nameRequired"), ok: null, secret: null };
  }

  // An optional lifetime, in days. No expiry is a legitimate choice for a key
  // that lives in one developer's .env; a bootstrap key always sets one.
  const rawDays = String(formData.get("lifetimeDays") ?? "").trim();
  const days = rawDays === "" || rawDays === "0" ? null : Number(rawDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
    return { error: t("lifetimeInvalid"), ok: null, secret: null };
  }

  const { secret } = await mintKey({
    // `as string` the way every other admin action here reads it: the session
    // type carries it optional, and `requireOwner()` has already proven there
    // is one.
    ownerId: session.user.id as string,
    name,
    expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000),
  });

  revalidatePath(PAGE);
  return { error: null, ok: t("created"), secret };
}

export async function revokeSetupKeyAction(
  _prev: SetupKeyActionState,
  formData: FormData,
): Promise<SetupKeyActionState> {
  await requireOwner();
  const t = await getTranslations("setupKeys");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: t("revokeFailed"), ok: null, secret: null };

  await revokeKey(id);
  revalidatePath(PAGE);
  return { error: null, ok: t("revoked"), secret: null };
}
