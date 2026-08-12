// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this member may use — the entitlement API over HTTP.
//
// The same two answers the dashboard reads, from the same functions: `grants`
// through `entitlementsFor()`, never a billing table. `paused` carries the
// keys a missed payment suspended AND nothing else still covers — so a client
// can say "your access is paused" instead of nothing at all, exactly like the
// dashboard (`lib/entitlements/rules.ts` → `pausedKeys`).
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";
import { entitlementsFor, suspendedKeysFor } from "@/lib/entitlements/manage";
import { pausedKeys } from "@/lib/entitlements/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const [owned, suspended] = await Promise.all([
    entitlementsFor(g.memberId),
    suspendedKeysFor(g.memberId),
  ]);

  return apiJson({
    entitlements: owned.map((e) => ({
      productKey: e.productKey,
      source: e.source,
      // `accessUntil` stores the last millisecond of a day in UTC — a client
      // rendering it must pin timeZone: "UTC", exactly like the dashboard
      // (docs/entitlements.md). Serialized as ISO so that stays possible.
      accessUntil: e.accessUntil ? e.accessUntil.toISOString() : null,
    })),
    paused: pausedKeys(owned, suspended),
  });
}
