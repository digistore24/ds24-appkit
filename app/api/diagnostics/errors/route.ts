// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The errors a 200 hides, from the app that is actually serving customers.
//
//   GET /api/diagnostics/errors            everything the ring holds
//   GET /api/diagnostics/errors?after=42   only what arrived after sequence 42
//
// `Authorization: Bearer <DIAGNOSTICS_SECRET>`. Read it with
// `node run.mjs errors --url https://your-app` — that command prints exactly
// what the local run prints, because both go through the same
// `parseErrors()` and the same `renderFindings()` (`lib/diagnostics/parse.mjs`).
//
// ── It guards itself ──────────────────────────────────────────────────────
// `proxy.ts` matches `/dashboard` only, so everything under `app/api/` is public
// until it protects itself. Here that is `guardDiagnostics()` as the FIRST line,
// and every refusal — no header, a wrong secret, no secret configured at all —
// is one bodiless 404, deliberately indistinguishable from a route that was
// never built. The shipped state is exactly that: `.env.example` carries
// `DIAGNOSTICS_SECRET` commented out.
//
// ── Why it is here and not somewhere that already exists ──────────────────
// Not `/api/setup`: `guardSetup()` authenticates by looking the key up in
// `setup_keys`, and this read must work with the database DOWN — that is one of
// the failures it exists to report. Not `/api/v1`: that is a MODULE, it is
// member-scoped and it never accepts an id; this is an operator surface
// authenticated by a host secret. And not `CRON_SECRET`: that token is pasted
// into a host's scheduler and a crontab, and widening it to "and it also reads
// my app's errors" is exactly the credential-widening the API module's audience
// rule forbids.
//
// ⚠️ **No `outputFileTracingIncludes` entry in `next.config.ts` is needed, and
// none is added.** Every import below is static, so Next's tracer follows them
// into a standalone build by itself. The absence is a decision, not an
// oversight.

import { readWindow } from "@/lib/diagnostics/capture";
import { guardDiagnostics } from "@/lib/diagnostics/guard";
import { parseErrors } from "@/lib/diagnostics/parse.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refusal = guardDiagnostics(request);
  if (refusal) return refusal;

  const after = Number(new URL(request.url).searchParams.get("after"));
  const window = readWindow({ after: Number.isFinite(after) && after > 0 ? after : undefined });

  // 🚨 The raw lines never leave the process. What goes out is what
  // `parseErrors()` made of them — a headline, a location, a code-frame line
  // and a count — and the window they were read from. They are redacted
  // already (`redact.mjs` runs at capture time), and this is the second reason
  // the same address cannot arrive twice.
  return Response.json({
    seq: window.seq,
    since: window.since,
    instance: window.instance,
    retainedLines: window.retainedLines,
    oldest: window.oldest,
    droppedLines: window.droppedLines,
    findings: parseErrors(window.lines.join("\n")),
  });
}
