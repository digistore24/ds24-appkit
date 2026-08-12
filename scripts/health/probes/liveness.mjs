// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 1 — does anything answer at all?
//
// 🚨 **This is the one probe whose silence is an ANSWER.** If nothing replies at
// the resolved address, this probe has not "failed to run": its question was
// *"does anything answer"* and it got a no. So it reports `found` with one
// CRITICAL finding — and the other five report `skipped`, because THEIR
// questions (about a running app) genuinely were not answered.
//
// Reporting all six as findings would be six alarms about one fact. Reporting
// all six as skips would be an app that is down and a command that says "I could
// not look". Neither is honest, and this split is.
//
// It sends **no credential**. `/api/healthz` is public by design
// (`app/route-protection.test.ts`), which is what makes it usable by the uptime
// checker Epic 33 wires up — routing it through a secret for a tidier command
// would take that away for nothing.
import { ask } from "./_transport.mjs";
import { finding, ranClean, ranFound } from "../rules.mjs";

const PATH = "/api/healthz";

/** The fix, in words somebody who has never read a stack trace can act on. */
const FIX = [
  "Open your host's dashboard and check the app is deployed and running. If it says it is,",
  "the address is the next suspect: a typo, a domain not yet pointed at this app, and a",
  "certificate the connection was refused over all look exactly like this from here.",
].join(" ");

const WHY =
  "Nobody can reach your app. Every page, every checkout and every payment notification " +
  "from Digistore24 is arriving at the same silence.";

export const liveness = {
  id: "liveness",
  label: "The app answers at all",
  tier: 1,
  covers: "whether anything is serving at the address given — the question every other probe assumes",

  async run({ url }) {
    const target = `${url}${PATH}`;
    const attempt = await ask(target);

    if (!attempt.ok) {
      const observed = attempt.timedOut
        ? `no answer within the request timeout — ${attempt.reason}`
        : attempt.reason;
      return ranFound(
        [
          finding({
            severity: "critical",
            title: "Nothing answered at that address",
            where: target,
            why: WHY,
            fix: FIX,
            evidence: observed,
          }),
        ],
        // Every probe that RAN gets its line, findings or not — a `·` saying
        // only how many findings there are has told the reader nothing about
        // what was actually asked. No `GET <target> —` prefix on this branch:
        // `ask()`'s own sentence already opens with the address, and printing
        // it twice on one line is how a reader learns to skim the line.
        observed,
      );
    }

    const { response, ms } = attempt;

    // A 3xx is REPORTED, never followed: a followed redirect hands back
    // somebody else's 200, and `/api/healthz` has no business redirecting.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "(no Location header)";
      const observed = `HTTP ${response.status} → ${location} (in ${ms} ms, not followed)`;
      return ranFound(
        [
          finding({
            severity: "critical",
            title: `The health endpoint redirects instead of answering (${response.status})`,
            where: target,
            why:
              "Something in front of your app — a proxy, a login wall, a domain forwarder — is " +
              "answering before the app does, so nothing here reached the app at all.",
            fix:
              "Look at whatever sits in front of the app: the host's routing, a redirect rule, or " +
              "a domain that still points somewhere else. The address it wanted to send us to is " +
              "in the evidence below.",
            evidence: observed,
          }),
        ],
        `GET ${target} — ${observed}`,
      );
    }

    if (response.status !== 200) {
      const observed = `HTTP ${response.status} in ${ms} ms — this endpoint has no dependencies and answers 200 or nothing`;
      return ranFound(
        [
          finding({
            severity: "critical",
            title: `The app answered ${response.status} on its health endpoint`,
            where: target,
            why: WHY,
            fix: FIX,
            evidence: observed,
          }),
        ],
        `GET ${target} — ${observed}`,
      );
    }

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (body?.status !== "ok") {
      const observed = `HTTP 200 in ${ms} ms, but the body was not {"status":"ok"}`;
      return ranFound(
        [
          finding({
            severity: "critical",
            title: "Something other than this app answered 200 at its health endpoint",
            where: target,
            why:
              "The 200 came from something that is not this app — a proxy's holding page, a CDN, " +
              "another app on the same domain. Everything else this command reports would be about " +
              "that thing rather than about your app.",
            fix:
              "Check that the address really points at this app: the host's domain settings, and " +
              "whether an older deployment is still serving it.",
            evidence: observed,
          }),
        ],
        `GET ${target} — ${observed}`,
      );
    }

    return ranClean(`GET ${target} — 200 {"status":"ok"} in ${ms} ms`);
  },
};
