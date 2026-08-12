// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Runs once at server start (Next.js instrumentation hook).
//
// Purpose: enforce the environment rules from lib/env-guard.ts BEFORE the app
// accepts requests. In STAGING and PROD email delivery is mandatory — without
// it the app does not start. Better a clear abort at deploy time than a
// running app nobody can sign in to.
export async function register() {
  // Check in the Node runtime only (not in the edge runtime pass).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // The tap on this process's own stderr, so a DEPLOYED app can answer
  // `node run.mjs errors --url …` — there is no .dev/dev.log on a host
  // (lib/diagnostics/capture.ts). FIRST, before the environment check below:
  // that check's own console.error lines, and the scheduler's
  // `[cron] tick failed`, are exactly what an operator wants to find.
  //
  // Dynamic like everything else here, and `capture.ts` stays import-light on
  // purpose — it imports `redact.mjs` and nothing else.
  const { installErrorCapture } = await import("@/lib/diagnostics/capture");
  installErrorCapture();

  // Import env-guard only — NOT lib/email: that depends on nodemailer, and
  // this hook is built for the edge runtime too. An import from there breaks
  // startup with "Can't resolve 'stream'".
  const { checkEnvironment, appEnv, hasEmailConfig } = await import(
    "@/lib/env-guard"
  );
  // Pure, zero imports (lib/email-from.mjs) — edge-safe by construction.
  const { resolvedFrom } = await import("@/lib/email-from.mjs");

  const environment = appEnv(process.env.APP_ENV);

  // Whether the bucket is configured, read WITHOUT importing the media store —
  // same rule as the mail transport above. `lib/media/store.ts` pulls in the
  // config, which pulls in the product registry; this hook is built for the
  // edge runtime too, and an import chain that long is how it stops resolving.
  const s3Configured = Boolean(
    process.env.MEDIA_S3_ENDPOINT?.trim() &&
      process.env.MEDIA_S3_BUCKET?.trim() &&
      process.env.MEDIA_S3_ACCESS_KEY_ID?.trim() &&
      process.env.MEDIA_S3_SECRET_ACCESS_KEY?.trim(),
  );

  // Imported, not read off the disk. It was `readFileSync("config/media.json")`
  // — a path resolved against `process.cwd()`, which is the app root on a
  // developer's machine and something else entirely under `output: "standalone"`
  // or any host that starts the server from another directory. There the read
  // threw, the `catch` treated media as ON, and an app that had switched it OFF
  // and booked no bucket refused to start: a feature that works where it is
  // tested and not where it ships.
  //
  // A plain JSON import is bundled at build time, so there is no path, no cwd
  // and no failure mode. It is still NOT `lib/media/config.ts` — that module
  // pulls in the product registry, and this hook is built for the edge runtime
  // too, where an import chain that long stops resolving.
  const mediaSettings = (await import("@/config/media.json")).default as { enabled?: unknown };
  const mediaEnabled = mediaSettings.enabled !== false;

  const problems = checkEnvironment({
    APP_ENV: process.env.APP_ENV,
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    emailConfigured: hasEmailConfig(process.env),
    APP_URL: process.env.APP_URL,
    emailFrom: resolvedFrom(process.env),
    emailFromForeignDomain: process.env.EMAIL_FROM_FOREIGN_DOMAIN,
    MEDIA_DRIVER: process.env.MEDIA_DRIVER,
    mediaBucketConfigured: s3Configured,
    mediaEnabled,
  });

  if (problems.length > 0) {
    console.error("\n✗ Startup aborted — the environment is not ready:\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    throw new Error(
      `Environment ${environment} is not configured correctly (${problems.length} problem(s)).`,
    );
  }

  console.log(`✓ Environment: ${environment.toUpperCase()}`);

  // The scheduled jobs (docs/cron.md). AFTER the environment check, so an
  // installation that is refusing to start does not begin deleting rows on its
  // way out.
  //
  // Not during `next build`. Measured: this Next.js version does not run the
  // hook at build time at all, so today the guard changes nothing — it is here
  // because the cost of being wrong is a build machine pruning a production
  // table, possibly without even having the database. `NEXT_PHASE` is Next.js's
  // own variable and the documented way to tell the two apart.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { schedulerEnabled } = await import("@/lib/cron/config");
  if (!schedulerEnabled()) {
    console.log("• Scheduler: off (config/cron.json) — /api/cron still works");
    return;
  }
  const { startScheduler } = await import("@/lib/cron/scheduler");
  startScheduler();
}
