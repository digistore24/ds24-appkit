// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What is known to be wrong with what this app runs.
//
//   node run.mjs security-check           the text a person reads
//   node run.mjs security-check --json    the same facts for an agent
//
// A LADDER of independent checks and ONE verdict. Each rung answers its own
// question, none of them can stop another, and the run ends with a single tally
// line, the findings worst-first, and one exit code.
//
// It is the countable half of the skill `security-gateway`, the same way
// `ux-check` is the countable half of `ux-gateway`: a green run means the things
// that can be counted have been counted, not that the app is safe. Whether a
// route is protected for the right reason, whether a flow leaks somebody else's
// data — none of that is here, because a script cannot settle it.
//
// ── Adding a rung ──────────────────────────────────────────────────────────
//
// One file under ./rungs/, one import, one entry in RUNGS below. Nothing else
// changes: the aggregator, the record and the renderer are written against the
// rung shape in ./rules.mjs and know no rung by name. If adding a rung ever
// needs an edit anywhere else in this file, that is the design going wrong
// rather than the rung being unusual.
//
// ── The one rule every rung keeps ──────────────────────────────────────────
//
// 🚨 **A rung that could not look reports `skipped` with a reason — never
// `clean`, never an empty findings list.** A rung throwing is treated the same
// way, here, by the caller: the error becomes that rung's reason and the ladder
// carries on, exactly as `doctor.mjs` does and for the same reason — one check
// that cannot answer must not take the answers of the others with it.
//
// ⚠️ **This command is not a gate and must not become one.** Not in
// `node run.mjs test`, not in a build, not in a commit hook. It asks the network
// and the answer moves without anything in this repo changing; a check like that
// wired into a gate is a brake, and a brake is what somebody eventually removes,
// taking the intent with it. It is run because somebody wants to know.
//
// Plain Node, no bundler, no dependency — Linux, macOS and Git Bash on Windows.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { advisories } from "./rungs/advisories.mjs";
import { container } from "./rungs/container.mjs";
import { drift } from "./rungs/drift.mjs";
import { history } from "./rungs/history.mjs";
import { invisible } from "./rungs/invisible.mjs";
import { live } from "./rungs/live.mjs";
import { osv } from "./rungs/osv.mjs";
import { posture } from "./rungs/posture.mjs";
import { registry } from "./rungs/registry.mjs";
import { secrets } from "./rungs/secrets.mjs";
import { signatures } from "./rungs/signatures.mjs";
import { aggregate, outcomeFrom, recordFrom, renderVerdict } from "./rules.mjs";
import { writeVerdict } from "./verdict.mjs";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The ladder, in the order it runs.
 *
 * Order is cheapest-and-sharpest first, the same order the skill's own full
 * pass uses. It is not load-bearing — no rung reads another's result — but it is
 * the order somebody reads the output in.
 *
 * ⚠️ One ordering rule, and `rungs.test.ts` asserts it: **every `tier: 2` rung
 * comes after every `tier: 1` one.** A tier-2 rung needs a tool that may be
 * absent, and on most machines it prints a `⏭ NOT ASKED` block — those belong at
 * the bottom of what somebody reads, under the answers that were actually given.
 */
export const RUNGS = [
  advisories,
  osv,
  signatures,
  registry,
  posture,
  drift,
  live,
  secrets,
  invisible,
  history,
  container,
];

/** This app's own version, for the record. Never a reason to fail anything. */
function templateVersion() {
  try {
    return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
}

/**
 * Run every rung and collect its outcome.
 *
 * A rung that throws becomes that rung's skip, carrying the error's message as
 * its reason. That covers the honest failures (a tool that vanished mid-run) and
 * the dishonest ones alike: `outcomeFrom()` refuses a rung whose state
 * contradicts its own findings, and a rung whose answer cannot be trusted has,
 * for our purposes, not looked.
 */
export async function runRungs(rungs, context) {
  const outcomes = [];
  for (const rung of rungs) {
    try {
      outcomes.push(outcomeFrom(rung, await rung.run(context)));
    } catch (error) {
      const reason = error?.message ? String(error.message) : String(error);
      outcomes.push(
        outcomeFrom(rung, {
          state: "skipped",
          // Never empty: `outcomeFrom()` refuses a reasonless skip, and this is
          // the one place that could hand it one — an error whose message is
          // the empty string would otherwise throw out of the catch itself.
          reason: reason.trim() || `${rung?.id} threw something with no message`,
          findings: [],
        }),
      );
    }
  }
  return outcomes;
}

/** The whole run as one object — the record's fields, plus the findings per rung. */
function asJson(record, outcomes) {
  return {
    ...record,
    rungs: outcomes.map((outcome) => ({
      id: outcome.id,
      label: outcome.label,
      tier: outcome.tier,
      covers: outcome.covers,
      state: outcome.state,
      reason: outcome.reason,
      evidence: outcome.evidence,
      findings: outcome.findings,
      accepted: outcome.accepted,
    })),
  };
}

/** Measure, record, report. Returns the exit code rather than taking it. */
export async function securityCheck(argv = []) {
  const asData = argv.includes("--json");
  const outcomes = await runRungs(RUNGS, { root: PROJECT_ROOT, argv });

  // Written before anything is printed: the record is the measurement, and a
  // broken renderer must not be able to lose it. It swallows its own errors.
  const record = recordFrom(outcomes, { now: Date.now(), template: templateVersion() });
  writeVerdict(record);

  // This story's boundary: it MEASURES and RECORDS. It adds no line to the
  // session greeting and sends no mail — one producer per channel, and neither
  // of those is this file.
  if (asData) console.log(JSON.stringify(asJson(record, outcomes), null, 2));
  else console.log(renderVerdict(outcomes));

  return aggregate(outcomes).failing ? 1 : 0;
}

// Run only when this file IS the command — compared as a resolved path rather
// than by name, because four other scripts in this project are also called
// check.mjs. Importing it (a test, a later reader) runs nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await securityCheck(process.argv.slice(2)));
}
