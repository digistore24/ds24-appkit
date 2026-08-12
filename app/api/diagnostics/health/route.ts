// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two facts about a DEPLOYED app that nothing outside it can answer.
//
//   GET /api/diagnostics/health
//
// `Authorization: Bearer <DIAGNOSTICS_SECRET>`. Read it with
// `node run.mjs health --url https://your-app`, which asks this endpoint once
// and turns its two answers into two of its six probes.
//
// Everything else that command asks is public or already has an endpoint:
// `/api/healthz`, `/api/readyz`, `/api/cron?list`, `/api/diagnostics/errors`.
// These two are here because the credentials are the HOST's — an operator's
// laptop has neither the production bucket keys nor a production connection
// string, and `docs/DEPLOY.md` is written so it never needs them.
//
// ── It guards itself, and off is indistinguishable from never built ────────
// `proxy.ts` matches `/dashboard` only, so everything under `app/api/` is public
// until it protects itself. Here that is `guardDiagnostics()` as the FIRST
// statement, and every refusal — no header, a malformed one, a wrong secret, a
// rate-limited caller, no secret configured at all — is one bodiless 404. The
// shipped state is exactly that: `.env.example` carries `DIAGNOSTICS_SECRET`
// commented out and gains nothing here.
//
// ── The same audience, deliberately the same key ───────────────────────────
// `DIAGNOSTICS_SECRET` is the operator-diagnostics audience: read-only, held in
// the host's secret store, never pasted into a third place. This is the same
// audience asking the same kind of question of the same app, so it takes the
// same key rather than minting a second one — a credential that widens by being
// copied somewhere else is what the API module's audience rule forbids.
//
// 🚨 **The boundary that keeps that true: this credential never gains a surface
// that WRITES.** Anything that changes a row is `/api/setup`, with its
// database-backed key, its two-act confirmation and its audit row. A diagnostics
// bearer that could also act would be a read secret with a write blast radius,
// and it is pasted into a laptop's `.env` by design.
//
// ── Unlike its neighbour, this one DOES reach the database ─────────────────
// `app/api/diagnostics/errors/route.ts` must not, and
// `app/api/diagnostics/no-db.test.ts` enforces that on its import closure —
// scoped to that file, and now with a positive assertion about this one, so the
// scoping is a measured decision rather than an oversight somebody later
// "fixes" by widening the scan to the folder. The two answer different
// questions: "what is my app's log hiding" has to work when Postgres is down;
// "when did the last IPN arrive" is a question ABOUT Postgres, and its honest
// answer when the database is unreachable is `unchecked`, which is what
// `operationalState()` returns.

import { guardDiagnostics } from "@/lib/diagnostics/guard";
import { operationalState } from "@/lib/ops/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refusal = guardDiagnostics(request);
  if (refusal) return refusal;

  // Nothing else, and nothing raw. `operationalState()` returns closed codes and
  // numbers by construction; a field added here would be a field nobody argued.
  return Response.json(await operationalState({ now: new Date() }));
}
