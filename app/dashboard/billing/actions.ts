// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The Member's own billing actions.
//
// SECURITY: a Server Action is an HTTP endpoint of its own. Every action here
// resolves the account from the SESSION and takes no member id — the same rule
// `app/dashboard/account/actions.ts` and `lib/tokens/spend.ts` follow. An id in
// the form would let anybody arm or disarm somebody else's unattended card
// charge.
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { requireActiveUser } from "@/lib/authz";
import { setAutoReloadEnabled } from "@/lib/tokens/account";

// The shape every server action in this template returns — `hooks/use-action-toast`
// walks it. Re-exported so the tab can type its `useActionState` without
// reaching into hooks from a server file. A TYPE export is safe here: it is
// erased before the file ever runs.
//
// ⚠️ A VALUE is not. **A `"use server"` file may export async functions and
// nothing else** — every export becomes a callable server endpoint, so a
// constant, an object or a plain string fails the production build with
// "A 'use server' file can only export async functions, found object". It does
// not fail `npm run test`, it does not fail `npm run typecheck`, and `next dev`
// serves the page regardless: the first thing that notices is `npm run build`,
// which is why the empty state below lives in the tab that uses it.
export type { ActionState as AutoReloadState } from "@/hooks/use-action-toast";
type State = { error: string | null; ok: string | null };

/**
 * Turns auto top-up off for the signed-in Member.
 *
 * One statement, not a read-modify-write. The earlier version read the account
 * and then handed all four columns back to `setAutoReload`, so an IPN arming a
 * fresh purchase in between was clobbered with the stale snapshot — losing the
 * mandate permanently, since `creditTokens` only fills `ds24PurchaseId` when it
 * is empty and Digistore24 will not redeliver.
 *
 * The mandate is preserved on purpose: it is what `enableAutoReloadAction`
 * below needs, so a Member who switches off today can switch back on tomorrow
 * without buying again.
 */
export async function disableAutoReloadAction(): Promise<State> {
  const session = await requireActiveUser();
  const t = await getTranslations("billing");
  try {
    await setAutoReloadEnabled({ memberId: session.user.id, enabled: false });
  } catch (err) {
    console.error("[billing] could not disable auto top-up:", err);
    return { error: t("autoReloadDisableFailed"), ok: null };
  }
  revalidatePath("/dashboard/billing");
  return { error: null, ok: t("autoReloadDisabled") };
}

/**
 * Turns it back on — offered only when a chargeable mandate is already stored.
 *
 * This exists because arming is otherwise a ONE-SHOT event. It happens on the
 * single IPN delivery that books the credit, and every ordinary way that fails
 * is terminal: a transient error there is swallowed to a log line, a credit
 * attributed by buyer email rather than identity refuses to arm, and a purchase
 * credited later by `lib/digistore/claim.ts` never reads the flag at all. In
 * each case the buyer paid having asked for auto top-up, was never told it did
 * not take, and — with an off-only switch — could not fix it except by buying
 * again.
 *
 * It cannot invent a mandate: `setAutoReloadEnabled` refuses when
 * `ds24PurchaseId` is null, so this is only ever reachable for an account that
 * has already paid for one.
 */
export async function enableAutoReloadAction(): Promise<State> {
  const session = await requireActiveUser();
  const t = await getTranslations("billing");
  try {
    const armed = await setAutoReloadEnabled({
      memberId: session.user.id,
      enabled: true,
    });
    if (!armed) return { error: t("autoReloadNoMandate"), ok: null };
  } catch (err) {
    console.error("[billing] could not enable auto top-up:", err);
    return { error: t("autoReloadEnableFailed"), ok: null };
  }
  revalidatePath("/dashboard/billing");
  return { error: null, ok: t("autoReloadEnabled") };
}
