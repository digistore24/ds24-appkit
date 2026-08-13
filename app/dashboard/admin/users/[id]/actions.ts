// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

import { unstable_rethrow } from "next/navigation";

// Server actions of the Member detail screen (story 3.2 onwards).
//
// SECURITY — two layers, deliberately redundant, exactly as on the user list:
//  1. requireOwner() as the first line of EVERY action. A server action is an
//     HTTP endpoint of its own; the fact that the PAGE is guarded protects
//     nothing here.
//  2. The pure rules in lib/tokens/rules.ts, re-checked against the balance
//     that was locked inside the transaction (lib/tokens/account.ts).
//
// LANGUAGE: here — and only here — the codes from the rules layer become
// sentences, in the language of the Operator currently clicking.
import { revalidatePath } from "next/cache";
import { getFormatter, getTranslations } from "next-intl/server";

import { requireOwner } from "@/lib/authz";
import { findUser } from "@/lib/users/manage";
import { adjustTokens } from "@/lib/tokens/account";
import { TokenError } from "@/lib/tokens/rules";
import { grantByHand, revokeGrantByHand } from "@/lib/entitlements/manage";
import { accessUntilFromDay, GrantError } from "@/lib/entitlements/grant-rules";
import { UserError, type Actor } from "@/lib/users/rules";

const PAGE = "/dashboard/admin/users";

/** Return value for useActionState — `error`/`ok` are finished messages. */
import type { ActionState } from "@/lib/action-state";

/** Re-exported so the components beside this file keep importing it from here. */
export type { ActionState };

async function actor(): Promise<Actor> {
  const session = await requireOwner();
  return { id: session.user.id, role: session.user.role };
}

/** Turn an error from the rules/database layer into a displayable message. */
async function toState(error: unknown): Promise<ActionState> {
  // redirect() and notFound() signal by THROWING — that is how requireOwner()
  // turns "not an admin" into a redirect. Swallowing them logs a fake
  // "unexpected error" on every legitimate refusal and answers the caller
  // "unknown error" where the framework meant to send them somewhere.
  //
  // unstable_rethrow knows the current digests. Matching them by hand does not
  // survive a Next upgrade: this project is on 15.5.20, where the old
  // NEXT_NOT_FOUND is already gone in favour of NEXT_HTTP_ERROR_FALLBACK.
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof TokenError) return { error: t(error.code), ok: null };
  if (error instanceof GrantError) return { error: t(error.code), ok: null };
  if (error instanceof UserError) return { error: t(error.code), ok: null };

  // Anything unexpected (database gone, network, programming mistake) ends up
  // here. All the Operator is told is "unknown error" — the reason belongs in
  // the log, not in the UI, where it would likely give away internals.
  console.error("[member-billing] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * Corrects a Member's token balance by hand.
 *
 * Nothing about the amount or the reason is decided here — that is
 * `decideAdjustment`, called against the LOCKED balance inside `adjustTokens`.
 * This function does three things: prove the caller is an Operator, hand the
 * raw form values down untouched, and translate whatever comes back.
 *
 * There is deliberately no self-guard: an Operator may correct their own
 * balance, and the ledger records it like any other correction.
 */
export async function adjustTokensAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // OUTSIDE the try, deliberately. requireOwner() says "not an admin" by
  // throwing Next's redirect; inside the try that lands in the catch-all and
  // comes back as "unknown error" instead of sending the caller to /dashboard.
  const me = await actor();
  try {
    const memberId = String(formData.get("memberId") ?? "");

    // Checked before the write, because `adjustTokens` creates the token
    // account first: an id belonging to nobody would otherwise fail on the
    // foreign key with a 23503 the Operator reads as "unknown error".
    const member = await findUser(memberId);
    if (!member) throw new UserError("userNotFound");

    const { balance, delta } = await adjustTokens({
      actor: me,
      memberId,
      // Raw, exactly as the form produced it. Turning "" into 0 or running it
      // through Number() here would move the decision out of the tested
      // function and into an untested one.
      amount: formData.get("amount"),
      reason: formData.get("reason"),
    });

    // The INSTANCE path, not the list. `PAGE` alone would revalidate
    // /dashboard/admin/users and leave the Operator staring at the stale
    // balance on the very page they just corrected.
    revalidatePath(`${PAGE}/${memberId}`);

    const t = await getTranslations("memberBilling");
    return {
      error: null,
      // The sign travels with the number: "50" that might be a credit or a
      // withdrawal explains nothing on a correction confirmation.
      ok: t("adjustDone", {
        delta: delta > 0 ? `+${delta}` : String(delta),
        balance,
      }),
    };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Hands a Member a plan by hand — a comp, or a purchase that was never matched
 * (story 3.3).
 *
 * ⛔ This is the action that gives away paid-for access without a payment. It
 * is deliberately built the same way as the balance correction above: prove the
 * caller is an Operator, hand the raw form values down untouched, translate
 * whatever comes back. The decision itself is `canGrantByHand`
 * (lib/entitlements/grant-rules.ts), re-evaluated inside `grantByHand`
 * immediately before the INSERT.
 *
 * There is deliberately NO self-guard: an Operator may grant to their own
 * account, and it is recorded like any other grant (AC 7).
 */
export async function grantPlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // OUTSIDE the try — see adjustTokensAction: requireOwner() refuses by
  // throwing Next's redirect, and swallowing it would answer "unknown error"
  // where the framework meant to send the caller to /dashboard.
  const me = await actor();
  try {
    const memberId = String(formData.get("memberId") ?? "");
    const productKey = String(formData.get("productKey") ?? "");

    // Checked before the write: `grants.member_id` is a foreign key, and an id
    // belonging to nobody would fail on it with a 23503 that reaches the
    // Operator as "unknown error" instead of a translated refusal.
    const member = await findUser(memberId);
    if (!member) throw new UserError("userNotFound");

    // §D2, the write side — and the ONE line where "permanent" and "unusable"
    // must not be confused. An empty field is a permanent grant (AC 2). A
    // non-empty value that does not parse is an INVALID Date, which
    // canGrantByHand refuses as `invalidEndDate`; passing `null` here instead
    // would turn an Operator's typo into access that never ends.
    const day = String(formData.get("accessUntilDay") ?? "").trim();
    const accessUntil =
      day === "" ? null : (accessUntilFromDay(day) ?? new Date(NaN));

    const granted = await grantByHand({
      actor: me,
      memberId,
      productKey,
      // Raw, exactly as the form produced it — trimming or defaulting here
      // would move the decision out of the tested function into an untested one.
      reason: formData.get("reason"),
      accessUntil,
    });

    // The INSTANCE path, not the list: the Operator is standing on the Member's
    // page and has to see the grant they just issued appear in the table.
    revalidatePath(`${PAGE}/${memberId}`);

    const t = await getTranslations("memberBilling");
    // The Product Key verbatim — it is what the registry, the grants table and
    // every support conversation call this plan.
    if (!granted.accessUntil) {
      return { error: null, ok: t("grantDone", { product: granted.productKey }) };
    }
    // Named with the DAY access still covers, not with the stored instant: the
    // off-by-one §D2 is about should be visible in words, not only in data.
    const format = await getFormatter();
    return {
      error: null,
      ok: t("grantDoneUntil", {
        product: granted.productKey,
        date: format.dateTime(granted.accessUntil, {
            // UTC, load-bearing and not decoration. `accessUntil` is stored as
            // the last millisecond of the chosen day IN UTC, so rendering it in
            // the app's display zone shows the NEXT day: pick 1 August, read
            // "2. Aug." — and on 31 December, "1. Jan." of the following year.
            // The label promises "through and including", so this is a broken
            // promise, not an ambiguity.
            dateStyle: "medium", timeZone: "UTC" }),
      }),
    };
  } catch (error) {
    return toState(error);
  }
}

/**
 * The Operator ends a grant they issued by hand (story 3.4).
 *
 * ⛔ This takes access away, and it is IRREVERSIBLE (§D5). Same shape as the
 * two actions above: prove the caller is an Operator, hand the raw form value
 * down untouched, translate whatever comes back.
 *
 * The one thing this action does NOT do is decide anything. Whether the grant
 * may be revoked is `canRevokeGrant` (lib/entitlements/grant-rules.ts), and the
 * refusal that actually holds is the `source = 'manual' AND ended_at IS NULL`
 * carried by the UPDATE inside `revokeGrantByHand` — because THIS FUNCTION IS
 * AN HTTP ENDPOINT OF ITS OWN and `grantId` arrives from the client. The row
 * menu hiding the entry on a purchase row is convenience, nothing more.
 *
 * There is deliberately no self-guard: an Operator may revoke a grant on their
 * own account, and it is recorded like any other revocation.
 */
export async function revokeGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // OUTSIDE the try — see adjustTokensAction.
  const me = await actor();
  try {
    const grantId = String(formData.get("grantId") ?? "");

    const revoked = await revokeGrantByHand({ actor: me, grantId });

    // The Member comes back FROM THE ROW, not from the form: the grant names
    // its own owner, so the page that is refreshed is the one whose data
    // actually changed. The INSTANCE path, not the list — the Operator is
    // standing on the Member's page and has to see the row flip to "ended".
    revalidatePath(`${PAGE}/${revoked.memberId}`);

    const t = await getTranslations("memberBilling");
    // The Product Key verbatim, as everywhere else on this page — it is what
    // the registry, the grants table and every support conversation call it.
    //
    // Deliberately NOT "the Member has lost access to X": they may not have.
    // If the same key is also held through a purchase, that access is
    // untouched and the key is still entitled (AC 1, §D1). The message reports
    // what was revoked, and the confirmation said what that does and does not
    // reach.
    return { error: null, ok: t("revokeDone", { product: revoked.productKey }) };
  } catch (error) {
    return toState(error);
  }
}
