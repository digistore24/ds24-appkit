// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Probe 4 — what is a 200 hiding?
//
// Every app keeps a bounded, redacted window of its own stderr in memory and
// answers `GET /api/diagnostics/errors` over `DIAGNOSTICS_SECRET`. The reader is
// `readRemoteFindings()` from `scripts/dev/errors-remote.mjs` — **reused, never
// rewritten**: its `{ ok: false, reason }` arm already IS this probe's four skip
// reasons (a 404, a 429, an answer that is not JSON, an answer with no findings
// list), each with the sentence an operator can act on.
//
// 🚨 **A bare `✓ No errors` here is a defect, and that is why `clean` carries
// `describeWindow(body)`.** The ring empties on every restart and belongs to ONE
// instance, so an empty answer means *"nothing in the last N lines since 14:02"*
// and never *"your app is fine"*. A redeploy five seconds ago is an empty window
// and not health.
import {
  describeWindow,
  diagnosticsCredentials,
  readRemoteFindings,
} from "../../dev/errors-remote.mjs";
import { errorLadderFindings, notAsked, ranClean, ranFound, UNREACHABLE_REASON } from "../rules.mjs";

export const errors = {
  id: "errors",
  label: "What its pages hide behind a 200",
  tier: 1,
  covers:
    "the errors that leave a page's status code at 200 — a bad date, a missing translation, a rejected promise",

  async run({ url, env, argv, liveness }) {
    if (liveness?.state === "found") return notAsked(UNREACHABLE_REASON);

    const at = Array.isArray(argv) ? argv.indexOf("--env") : -1;
    const asked = at === -1 ? null : (argv[at + 1] ?? null);

    const credentials = diagnosticsCredentials(env, url, asked);
    if (credentials.reason) return notAsked(credentials.reason);

    const body = await readRemoteFindings({ baseUrl: url, secret: credentials.secret });
    if (!body.ok) return notAsked(body.reason);

    const window = describeWindow(body);
    if (body.findings.length === 0) {
      // Never a bare ✓. The window IS the claim, and it is a narrow one.
      return ranClean(`No errors ${window}`);
    }

    const { findings, more } = errorLadderFindings(body.findings, window, url);
    const evidence =
      `${body.findings.length} distinct cause(s) ${window}` +
      (more > 0 ? ` — ${more} more not listed below, so one bad deploy cannot bury the other probes` : "");
    return ranFound(findings, evidence);
  },
};
