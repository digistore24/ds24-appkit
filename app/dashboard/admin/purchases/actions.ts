// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// Server actions of the unattributed-purchases screen.
//
// SECURITY — the same two layers as the user management screen: requireOwner()
// as the first line of the action (server actions are HTTP endpoints of their
// own), and the refusal reasons decided in lib/digistore/purchases.ts.
//
// LANGUAGE: here — and only here — the result codes become sentences.
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { requireOwner } from "@/lib/authz";
import { attachOrder } from "@/lib/digistore/purchases";

const PAGE = "/dashboard/admin/purchases";

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

export async function attachOrderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireOwner();

    const ds24OrderId = String(formData.get("orderId") ?? "");
    const memberId = String(formData.get("memberId") ?? "");
    const t = await getTranslations("purchases");
    if (!ds24OrderId || !memberId) {
      return { error: t("attachIncomplete"), ok: null };
    }

    const result = await attachOrder(ds24OrderId, memberId);
    revalidatePath(PAGE);

    if (!result.ok) return { error: t(`attachFailed_${result.reason}`), ok: null };
    return { error: null, ok: t("attached", { count: result.credited }) };
  } catch (error) {
    // Anything unexpected belongs in the log, not in front of the Operator.
    console.error("[purchases] unexpected error:", error);
    const t = await getTranslations("errors");
    return { error: t("unknown"), ok: null };
  }
}
