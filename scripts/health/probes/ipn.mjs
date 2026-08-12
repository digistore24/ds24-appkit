// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 6 — when did the last payment notification arrive?
//
// The second fact nothing outside the app can reach, off the same request the
// `media` probe made (`readOpsHealth()` caches it on the run's context).
//
// 🚨 **A bare `✓` beside this probe reads as "payments are arriving", and that
// is the exact defect this epic exists to end.** So every `clean` here carries
// an evidence line saying WHICH clean it is:
//
//   * this app sells nothing in that environment → there is nothing to miss
//   * it sells and has sold nothing in 90 days   → there is no silence to report
//   * the last notification is inside the window → and the line says when
//
// ⚠️ **An EMPTY log is not "never".** `prune-ipn-log` deletes past
// `IPN_LOG_RETENTION_DAYS`, so an empty table on an app with recent orders means
// at LEAST that long without a notification — a finding naming the window, never
// an unknown.
import { finding, notAsked, ranClean, ranFound, UNREACHABLE_REASON } from "../rules.mjs";
import { diagnosticsCredentials } from "../../dev/errors-remote.mjs";
import { OPS_HEALTH_PATH, readOpsHealth } from "./_transport.mjs";

const WHY =
  "A payment notification is what turns a purchase into access. While they are not arriving, " +
  "customers are paying and getting nothing — and the app looks perfectly healthy from every " +
  "other angle, because the requests simply never come.";

const FIX = [
  "Open Digistore24 → your product's IPN connection and check the address it calls and the",
  "passphrase beside it. `node run.mjs ds24-sync --env prod` re-registers both. If a customer",
  "has reported a specific purchase, `node run.mjs ds24-purchase --order <id>` says what",
  "Digistore24 holds for it.",
].join(" ");

export const ipn = {
  id: "ipn",
  label: "Payment notifications are arriving",
  tier: 1,
  covers: "when the last Digistore24 payment notification reached this app — the step that turns a purchase into access",

  async run(ctx) {
    if (ctx.liveness?.state === "found") return notAsked(UNREACHABLE_REASON);

    const credentials = diagnosticsCredentials(ctx.env, ctx.url, ctx.askedEnv);
    if (credentials.reason) return notAsked(credentials.reason);

    const answer = await readOpsHealth({ ...ctx, secret: credentials.secret });
    if (!answer.ok) return notAsked(answer.reason);

    const state = answer.body.ipn ?? {};
    const where = `${ctx.url}${OPS_HEALTH_PATH} → ipn`;

    if (state.state === "unchecked") {
      return notAsked(
        state.code === "dbUnreachable"
          ? "the app could not read its own IPN log — its database did not answer, so nobody " +
            "knows when the last notification arrived"
          : `the app could not check its own IPN log (${state.code ?? "no code"})`,
      );
    }

    if (state.state === "finding") {
      if (state.code === "emptyLog") {
        const observed =
          `${state.ordersRecent > 0 ? "at least one order" : "orders"} inside the activity ` +
          `window, and no notification at all in the log — which is kept for ` +
          `${state.logRetentionDays} days, so this is at least that long without one`;
        return ranFound(
          [
            finding({
              severity: "medium",
              title: "This app has sold recently and its payment-notification log is empty",
              where,
              why: WHY,
              fix: FIX,
              evidence: observed,
            }),
          ],
          observed,
        );
      }
      const observed =
        `the newest one arrived ${state.lastEventAt}, and this app has sold inside the activity window`;
      return ranFound(
        [
          finding({
            severity: "medium",
            title: `No payment notification for ${state.silentDays} day(s)`,
            where,
            why: WHY,
            fix: FIX,
            evidence: observed,
          }),
        ],
        observed,
      );
    }

    if (state.code === "noProducts") {
      return ranClean(
        "this app has no Digistore24 product configured for that environment, so there are no " +
          "payment notifications to be missing",
      );
    }
    if (state.code === "noRecentSales") {
      return ranClean(
        "nothing has been bought recently, so this app has no silence to report — that is a " +
          "marketing question rather than an operational one",
      );
    }
    return ranClean(
      `the last payment notification arrived ${state.lastEventAt} (${state.silentDays} day(s) ago)`,
    );
  },
};
