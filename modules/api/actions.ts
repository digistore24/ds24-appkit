// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Server actions for the Member's own HTTP-API keys.
//
// Two rules, and they matter because what is being handed out is a
// credential:
//
//  1. `requireActiveUser()` FIRST, on every action. A server action is an HTTP
//     endpoint of its own; the card only rendering for a signed-in Member
//     protects nothing.
//  2. **The account acted on is always the session's own.** No action takes a
//     member id from the form, and none may ever start doing so. `revokeKey`
//     additionally puts the member id in its WHERE clause, so a key id from a
//     tampered form matches nothing rather than somebody else's key.
//
// There is deliberately no Operator counterpart to any of this. An Operator who
// could mint a key for a customer could act as that customer — the same line
// `/dashboard/admin/users/[id]` already refuses to cross for passwords.
//
// This form path is also the documented fallback for members who sign in by
// magic link only: `POST /api/v1/auth/token` needs a password, this dialog
// needs a session (docs/api.md). ⚠️ That fallback is exactly what
// `"selfService": false` withdraws — an app that switches it off and has
// magic-link-only members has no path to a key for them at all, which is a
// decision rather than an oversight and is written down in `docs/api.md`.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { hasPlan } from "@/lib/entitlements/manage";
import { createKey, revokeKey } from "@/modules/api/keys/keys";
import {
  type ApiKeyErrorCode,
  ApiKeyError,
  checkKeyName,
  isLifetime,
  isScope,
} from "@/modules/api/keys/rules";
import { type KeysCardReason, keysCardMode } from "@/modules/api/keys/visibility";
import { apiConfig, apiOffReason } from "@/modules/api/api/config";

const PAGE = "/dashboard/account";

/**
 * May this Member mint a key right now — the card's own question, asked again.
 *
 * 🚨 **One function, both call sites.** `components/account-card.tsx` decides
 * what to render from `keysCardMode()`; this decides whether to write from the
 * same call. Two conditions that agree today are the shape CLAUDE.md names as
 * the thing nothing can catch — and here the one that matters is the server's,
 * because the card is a rendering decision and never a boundary.
 *
 * `keyCount: 0` because the answer does not depend on it: `manage` requires all
 * three permissions regardless of what the Member already holds. How many keys
 * they may hold is `MAX_LIVE_KEYS`, checked inside `createKey()`.
 */
async function refusalToMint(memberId: string): Promise<ApiKeyErrorCode | null> {
  const config = apiConfig();
  const off = apiOffReason();

  const entitled =
    off !== null || !config.requiresPlan ? true : await hasPlan(memberId, config.requiresPlan);

  const { mode, reason } = keysCardMode({
    apiOff: off,
    selfService: config.selfService,
    entitled,
    keyCount: 0,
  });

  if (mode === "manage") return null;

  const CODES: Record<Exclude<KeysCardReason, null>, ApiKeyErrorCode> = {
    disabledInConfig: "apiDisabled",
    brokenConfig: "apiDisabled",
    selfServiceOff: "apiSelfServiceOff",
    planRequired: "apiPlanRequired",
  };

  return CODES[reason ?? "disabledInConfig"];
}

/**
 * Like `ActionState`, plus the one thing that exists exactly once.
 *
 * `secret` is the new key in clear. It is returned here and nowhere else in
 * this app — the table holds a SHA-256, so after this response there is no
 * second chance to read it. The dialog says so before the Member closes it.
 */
export type ApiKeyActionState = {
  error: string | null;
  ok: string | null;
  secret?: string | null;
};

const EMPTY: ApiKeyActionState = { error: null, ok: null, secret: null };

async function toState(error: unknown): Promise<ApiKeyActionState> {
  // redirect() signals by THROWING — that is how requireActiveUser() sends a
  // signed-out or blocked visitor to /login. Swallowing it would turn a
  // legitimate redirect into "unknown error".
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof ApiKeyError) return { ...EMPTY, error: t(error.code) };

  console.error("[api-keys] unexpected error:", error);
  return { ...EMPTY, error: t("unknown") };
}

/**
 * Issues a key and returns it once.
 *
 * The refusal is repeated here rather than left to the card, and not by
 * accident: a key minted while the API is off — or while this app does not hand
 * keys out at all, or to somebody whose access does not include the API — is a
 * live credential for an endpoint that will never answer it, and the Member
 * would be looking at a key that cannot work with no way to tell why.
 */
export async function createApiKeyAction(
  _prev: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  try {
    const session = await requireActiveUser();

    const refusal = await refusalToMint(session.user.id);
    if (refusal) throw new ApiKeyError(refusal);

    const checked = checkKeyName(formData.get("name"));
    if (!checked.ok) throw new ApiKeyError(checked.code);

    // Both come from a <select>, and neither is trusted because of that. An
    // unrecognised value falls back to the SAFER option — `read`, and an
    // expiry rather than none — instead of throwing: the failure mode of a
    // fallback here is a key that does less than the Member wanted, which they
    // can see and redo.
    const rawScope = formData.get("scope");
    const scope = isScope(rawScope) ? rawScope : "read";

    const rawDays = formData.get("lifetimeDays");
    const parsed = rawDays === "never" ? null : Number(rawDays);
    const lifetimeDays = isLifetime(parsed) ? parsed : 90;

    const created = await createKey({
      memberId: session.user.id,
      name: checked.name,
      scope,
      lifetimeDays,
      audience: "api",
    });

    revalidatePath(PAGE);
    const t = await getTranslations("apiKeys");
    return {
      error: null,
      ok: t("createdToast", { name: created.name }),
      secret: created.secret,
    };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Revokes a key. Immediate — the next call with it is refused.
 *
 * Idempotent on purpose: revoking an already-revoked key reports success. A red
 * message about a key that is, in fact, revoked would send somebody looking for
 * a problem that does not exist.
 *
 * 🚨 **No `refusalToMint()` here, deliberately.** Every condition that stops a
 * Member creating a key is a reason to let them destroy one: taking the way out
 * away at the moment the feature is withdrawn would strand a live credential on
 * somebody's laptop with nobody able to kill it. This is the half of the card
 * that `mode: "readOnly"` exists to keep reachable.
 */
export async function revokeApiKeyAction(
  _prev: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  try {
    const session = await requireActiveUser();

    await revokeKey({
      memberId: session.user.id,
      keyId: String(formData.get("keyId") ?? ""),
    });

    revalidatePath(PAGE);
    const t = await getTranslations("apiKeys");
    return { ...EMPTY, ok: t("revokedToast") };
  } catch (error) {
    return toState(error);
  }
}
