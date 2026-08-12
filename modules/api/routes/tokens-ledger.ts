// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's own token bookings — the billing tab's list, over HTTP.
//
// Same function as the page (`listOwnLedger`), so the same privacy line
// holds: operator adjustments come back with `label: null` (the Member never
// sees an operator's note), and only `consume` rows carry the app's own label
// ("report generation"). The label is a code-like string the APP wrote, not a
// translation — a client shows it as-is or maps it, exactly like the page.
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";
import { OWN_LEDGER_PAGE_SIZE, listOwnLedger } from "@/lib/tokens/own-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const rows = await listOwnLedger(g.memberId);
  return apiJson({
    entries: rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      label: row.label,
      origin: row.origin,
      createdAt: row.createdAt.toISOString(),
    })),
    // The list is capped; a client is told rather than handed a slice
    // presented as the whole story (lib/tokens/own-ledger.ts).
    capped: rows.length === OWN_LEDGER_PAGE_SIZE,
  });
}
