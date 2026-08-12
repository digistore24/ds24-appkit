// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's token balance.
//
// Read-only, and deliberately WITHOUT a spend counterpart: "the price is
// yours, computed in code" (CLAUDE.md → Access; the long form is
// `docs/entitlements.md`) — an endpoint
// taking an amount from the wire would hand the price to the caller. Paid API
// operations charge internally, the way a charging chat tool does via
// `ctx.spend` (lib/ai/run-tool.ts).
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";
import { getTokenAccount } from "@/lib/tokens/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  // A member who never bought tokens HAS no account row — zero, not an error,
  // the same answer the dashboard's balance card gives.
  const account = await getTokenAccount(g.memberId);
  return apiJson({ balance: account?.balance ?? 0 });
}
