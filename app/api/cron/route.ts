// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The scheduled jobs, over HTTP — for a host that would rather do the timing
// itself.
//
// The app schedules itself by default (`lib/cron/scheduler.ts`), so nothing has
// to call this. It exists for the Operator who wants their platform's cron to
// decide the hour, or who runs the app somewhere a long-lived timer does not
// survive. Set `"enabled": false` in `config/cron.json`, point the host's
// scheduler here, and the same registry runs — there is no second list of jobs.
//
// It is also what `node run.mjs cron` calls, so a job triggered by hand takes
// exactly the path the scheduler takes. A separate offline runner would prove
// nothing about the one that actually runs in production.
//
// ── It guards itself ──────────────────────────────────────────────────────
// `proxy.ts` matches `/dashboard` only, so everything under `app/api/` is
// public until it protects itself — the same rule `/api/ipn` and `/api/v1`
// live by. Here that is a bearer token: set `CRON_SECRET` and send
// `Authorization: Bearer <CRON_SECRET>`. **Without the secret configured the
// endpoint refuses to run at all**, so it can never be left as an open "delete
// my data" URL by an Operator who has not got to that step yet.
import crypto from "node:crypto";

import { CRON_JOBS } from "@/lib/cron/jobs";
import { jobStatuses, runDueJobs, runJobById } from "@/lib/cron/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — no secret, no run
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  // Constant-time compare; the length guard comes first so `timingSafeEqual`
  // never throws on a mismatched length (it does, rather than returning false).
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    // 503, not 401: an Operator has to be able to tell "I never set the secret"
    // apart from "my scheduler is sending the wrong one". Those have completely
    // different fixes and the same symptom.
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);

  // `?list` — what exists and when it last ran. Read-only, and the only thing
  // that answers "is the scheduler alive" from outside the app.
  if (url.searchParams.has("list")) {
    return Response.json({ jobs: await jobStatuses() });
  }

  // `?job=<id>` — run one, whether or not it is due. What `--force` sends.
  const one = url.searchParams.get("job");
  if (one) {
    const result = await runJobById(one, new Date());
    return Response.json(
      {
        results: [result],
        // The same `known` the bare run below sends, for the same reason and one
        // question further: with it, "this app has no job called X" can say what
        // it DOES have instead of repeating the name back. The 404 already says
        // *that* it is unknown — `scripts/cron/run-report.mjs` reads the status
        // first, so an app deployed before this line still gets the right
        // answer, only a shorter one.
        known: CRON_JOBS.map((job) => job.id),
      },
      // A job the caller named and that does not exist is their mistake to see,
      // not a 200 with a failure buried in the body.
      { status: result.outcome === "failed" && result.detail.startsWith("no such job") ? 404 : 200 },
    );
  }

  const results = await runDueJobs(new Date());
  return Response.json({
    results,
    // So a scheduler's own log shows what the app knows about, not just what it
    // did — an empty `results` and an empty registry look identical otherwise.
    known: CRON_JOBS.map((job) => job.id),
  });
}

// GET for platform schedulers (most only send GET), POST for a curl in a
// crontab. Deliberately not GET-only: some hosts refuse to schedule a GET that
// changes state, and deliberately not POST-only: Vercel Cron sends GET.
export const GET = handle;
export const POST = handle;
