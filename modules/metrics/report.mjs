#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The funnel, the cohorts and the split tests, as text or as data.
//
// This is the half the AGENTS in a project read. The dashboard is for the
// person who runs the app; `--json` is for the coding agent that is about to
// suggest a change and should look at what the last one did.
//
// 🚨 **The verdict travels with the numbers.** An agent handed two rates and no
// verdict will announce a winner out of noise, which is the failure this whole
// module is built against — so `readSplit()` runs here too, from the same
// `rules.mjs` the page uses. There is one implementation of that judgement, and
// this file is not a second one.
//
// Usage:
//   node run.mjs metrics-report
//   node run.mjs metrics-report --period 7d|30d|90d|all
//   node run.mjs metrics-report --json
//
// Exit codes follow the project's convention:
//   0  read it, nothing to fix
//   1  the config has problems — an experiment may be silently not running
//   2  could not look (no DATABASE_URL, or the database did not answer)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "../../scripts/lib/env.mjs";
import { connectUtc } from "../../scripts/lib/pg-utc.mjs";
import { flagsFrom } from "../../scripts/lib/args.mjs";

import { cohortQuery, funnelQuery, splitQuery, fromDayFor, PERIOD_DAYS } from "./lib/queries.mjs";
import {
  cohortsFrom,
  funnelReadingFrom,
  splitReadingFrom,
  MIN_CONVERSIONS_PER_VARIANT,
  MIN_EXPOSED_PER_VARIANT,
} from "./rules.mjs";
import {
  experimentsIn,
  funnelStepsIn,
  isEnabledIn,
  problemsIn,
} from "./lib/config-rules.mjs";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const COHORT_WEEKS = 8;

const argv = process.argv.slice(2);
const flag = flagsFrom(argv);
const asJson = argv.includes("--json");

/** `✗` on stderr, so `--json` keeps stdout clean for whoever is parsing it. */
function couldNotLook(reason) {
  console.error(`✗ Could not look — ${reason}`);
  process.exit(2);
}

function config() {
  try {
    return JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
  } catch (error) {
    couldNotLook(`${HERE}config.json is missing or is not valid JSON (${error.message})`);
  }
}

function pct(value) {
  return `${(value * 100).toFixed(1)} %`;
}

async function main() {
  const raw = config();
  const period = flag("period") ?? "30d";
  if (!(period in PERIOD_DAYS)) {
    console.error(`✗ Unknown --period "${period}" — one of: ${Object.keys(PERIOD_DAYS).join(", ")}`);
    process.exit(2);
  }

  const problems = problemsIn(raw);
  const enabled = isEnabledIn(raw);
  const steps = funnelStepsIn(raw);
  const experiments = experimentsIn(raw);

  const url = process.env.DATABASE_URL;
  if (!url) couldNotLook("DATABASE_URL is not set");

  // ⚠️ The tables may not exist yet — installed but never migrated. That is a
  // "could not look", not an empty report: zero rows and no table read the same
  // on a dashboard and must not here.
  const sql = connectUtc(url, { max: 1 });
  let funnel;
  let cohorts;
  let splits;
  try {
    const now = new Date();
    const fromDay = fromDayFor(period, now);

    funnel = funnelReadingFrom(await funnelQuery(sql, fromDay), steps);
    cohorts = cohortsFrom(await cohortQuery(sql), COHORT_WEEKS);
    splits = [];
    for (const experiment of experiments) {
      const rows = await splitQuery(sql, {
        id: experiment.id,
        exposure: experiment.exposure,
        goal: experiment.goal,
        fromDay,
      });
      splits.push({ ...experiment, ...splitReadingFrom(experiment, rows) });
    }
  } catch (error) {
    couldNotLook(error.message);
  } finally {
    await sql.end();
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          period,
          enabled,
          problems,
          // Named so a reader cannot mistake the shape: every bucket in this
          // module is a UTC day or a UTC week.
          timeZone: "UTC",
          thresholds: {
            minExposedPerVariant: MIN_EXPOSED_PER_VARIANT,
            minConversionsPerVariant: MIN_CONVERSIONS_PER_VARIANT,
          },
          funnel,
          cohorts,
          splits,
        },
        null,
        2,
      ),
    );
    return problems.length > 0 ? 1 : 0;
  }

  console.log(`\nMetrics — ${period}, all buckets UTC\n`);

  if (!enabled) {
    console.log("  ! The module is switched OFF — nothing is being recorded.");
    console.log("    modules/metrics/config.json → \"enabled\": true\n");
  }
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  if (problems.length > 0) console.log("");

  console.log("  Onboarding funnel");
  if (funnel.rows.length === 0) {
    console.log('    (no steps declared — fill "funnel" in modules/metrics/config.json)');
  }
  for (const row of funnel.rows) {
    const flagged = row.share > 1 ? "   ← larger than the first step, check the order" : "";
    console.log(
      `    ${row.id.padEnd(28)} ${String(row.members).padStart(7)}  ${pct(row.share).padStart(8)}` +
        `  lost ${String(row.lost).padStart(6)}${flagged}`,
    );
  }
  if (funnel.unlisted.length > 0) {
    console.log(
      `    ! recorded but in no step: ${funnel.unlisted.map((u) => u.event).join(", ")}`,
    );
  }

  console.log("\n  Return by cohort (activity, not payment)");
  if (cohorts.length === 0) console.log("    (no cohorts yet)");
  for (const row of cohorts) {
    console.log(
      `    ${row.cohort}  n=${String(row.size).padStart(6)}  ` +
        row.weeks.map((w) => pct(w).padStart(8)).join(""),
    );
  }

  console.log("\n  Split tests");
  if (splits.length === 0) console.log("    (none declared)");
  for (const split of splits) {
    console.log(`    ${split.id}  (${split.exposure} → ${split.goal})`);
    for (const v of split.variants) {
      const rate = v.exposed > 0 ? pct(v.reached / v.exposed) : "—";
      console.log(
        `      ${v.id.padEnd(20)} in ${String(v.exposed).padStart(7)}` +
          `  ok ${String(v.reached).padStart(7)}  ${rate.padStart(8)}`,
      );
    }
    if (!split.reading) {
      console.log("      → no verdict: a pairwise reading of more than two variants is not one");
    } else if (split.reading.verdict === "not-enough-data") {
      console.log(
        `      → not enough data: each variant needs ${MIN_EXPOSED_PER_VARIANT} in the test ` +
          `and ${MIN_CONVERSIONS_PER_VARIANT} successes`,
      );
    } else if (split.reading.verdict === "no-difference") {
      console.log("      → no difference you can rely on — let it run longer");
    } else {
      console.log(`      → "${split.reading.leader}" is ahead, at 95% confidence`);
    }
  }

  console.log("");
  return problems.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(2);
  },
);
