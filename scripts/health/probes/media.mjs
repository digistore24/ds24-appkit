// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 5 — does the store this app writes to answer?
//
// One of the two facts nothing outside the app can reach, so it is asked OF the
// app: `GET /api/diagnostics/health` over `DIAGNOSTICS_SECRET`, shared with the
// `ipn` probe (one request, both readers).
//
// ⚠️ **"Can my laptop reach the bucket" is a different question**, and the
// template can already answer it — `storeForEnv()` resolves `MEDIA_S3_*_PROD`.
// It is the wrong question: a host firewall, a different key in the host's
// secret store and an IAM policy scoped to the app's role all make the two
// disagree, and the one customers feel is whether the APP can reach it.
//
// 🚨 **"There is nothing to check" is `clean` WITH an evidence line saying
// which.** A DEV app on the local driver has no bucket to be unreachable; that
// question was asked and answered, so it is not a skip — and it is not a bare ✓
// either, because a tick with nothing under it reads as "your customers' files
// are being served".
import { finding, notAsked, ranClean, ranFound, UNREACHABLE_REASON } from "../rules.mjs";
import { diagnosticsCredentials } from "../../dev/errors-remote.mjs";
import { OPS_HEALTH_PATH, readOpsHealth } from "./_transport.mjs";

/** What each closed code means to a person, and what they should do about it. */
const FINDINGS = {
  misconfigured: {
    title: "The app's media store is not configured usably",
    why:
      "Every picture, video, recording and downloadable file this app sells goes through that " +
      "store. As it stands, an upload fails and a customer's download does not arrive.",
    fix:
      "Check the media settings in your HOST's environment variables — the app said the " +
      "configuration itself is wrong, so no request was even attempted. `node run.mjs " +
      "media-check` explains each value in words.",
  },
  unreachable: {
    title: "The app cannot reach its media store",
    why:
      "The app asked its store and got nothing back. Uploads fail and files a customer paid " +
      "for do not arrive — and every page that only shows text still answers 200.",
    fix:
      "Open your storage provider's dashboard: is the bucket still there, are the keys still " +
      "valid, and did anything change about who may reach it? Then redeploy.",
  },
  timedOut: {
    title: "The app's media store did not answer in time",
    why:
      "The store was asked and had not replied when the app gave up. Customers see uploads and " +
      "downloads hang rather than fail, which is the version of this they complain about last.",
    fix:
      "Check your storage provider's own status page first, then whether the app's region and " +
      "endpoint still match the bucket's.",
  },
  localDirUnwritable: {
    title: "The app stores media on its own disk, and that disk is not writable",
    why:
      "Uploads have nowhere to go. On a deployed app this is also the wrong setup entirely: a " +
      "local disk loses every file on the next redeploy.",
    fix:
      "For anything online, set MEDIA_DRIVER=s3 and the bucket variables in your host's " +
      "environment. `node run.mjs media-check` lists what each one is.",
  },
};

export const media = {
  id: "media",
  label: "Its media store answers",
  tier: 1,
  covers: "whether the store this app's pictures, videos and sold files live in answers the APP",

  async run(ctx) {
    if (ctx.liveness?.state === "found") return notAsked(UNREACHABLE_REASON);

    const credentials = diagnosticsCredentials(ctx.env, ctx.url, ctx.askedEnv);
    if (credentials.reason) return notAsked(credentials.reason);

    const answer = await readOpsHealth({ ...ctx, secret: credentials.secret });
    if (!answer.ok) return notAsked(answer.reason);

    const state = answer.body.media ?? {};
    const where = `${ctx.url}${OPS_HEALTH_PATH} → media`;

    if (state.state === "unchecked") {
      return notAsked(`the app could not check its own media store (${state.code ?? "no code"})`);
    }

    if (state.state === "finding") {
      const words = FINDINGS[state.code] ?? {
        title: "The app's media store reported a problem",
        why: "Uploads and downloads are affected; the app named a state this command does not know.",
        fix: "Run `node run.mjs media-check` against that environment and read what it says.",
      };
      const observed = `the app's own probe answered "${state.code}" after ${state.ms} ms (driver ${state.driver})`;
      return ranFound(
        [finding({ severity: "high", ...words, where, evidence: observed })],
        // The `·` line carries it too: AC1's "every probe that RAN gets its
        // line" is about the LINE, and a found probe whose line says only how
        // many findings there are has told the reader nothing about what it
        // actually asked.
        `GET ${OPS_HEALTH_PATH} — ${observed}`,
      );
    }

    // 🚨 clean, and never bare. The two clean cases are different facts and the
    // evidence line is what keeps them apart.
    if (state.driver === "local") {
      return ranClean(
        `this app stores media on its own disk (MEDIA_DRIVER=local), so there is no external ` +
          `store to be unreachable — its directory is there and writable (checked in ${state.ms} ms)`,
      );
    }
    return ranClean(
      `the app asked its own store and it answered in ${state.ms} ms (driver ${state.driver})`,
    );
  },
};
