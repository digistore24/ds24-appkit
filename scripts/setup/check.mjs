#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs setup-check` — where the setup surface stands, from a terminal.
//
// ── Why this command exists at all ─────────────────────────────────────────
// Two states answer 404 from outside and are deliberately indistinguishable:
// the surface switched OFF, and an app that never had it. That is right for a
// stranger and useless for the operator — so this is the one place that tells
// them apart, and it is safe here because having a shell in the project IS the
// authentication.
//
// It is also the reader for the audit trail. `SECURITY.md` §7 puts it plainly:
// an audit trail nobody reads is not a control. The page is one reader; this is
// the other, for whoever is already in a terminal.
//
// Usage:
//   node run.mjs setup-check                 this machine's environment
//   node run.mjs setup-check --env prod      what a configured remote says
//   node run.mjs setup-check --live          really call a read tool
import "../lib/env.mjs";
import { readFileSync, existsSync } from "node:fs";

import {
  setupConfigFrom,
  setupProblemsFrom,
} from "../../lib/setup/config-shape.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const live = args.includes("--live");

const ENVIRONMENTS = {
  development: { urlVar: "APP_URL", keyVar: "SETUP_KEY" },
  staging: { urlVar: "APP_URL_STAGING", keyVar: "SETUP_KEY_STAGING" },
  production: { urlVar: "APP_URL_PROD", keyVar: "SETUP_KEY_PROD" },
};

const asked = flag("env");
const target =
  asked === "prod" ? "production" : asked === "dev" ? "development" : (asked ?? null);

if (target && !ENVIRONMENTS[target]) {
  console.error(`✗ unknown environment "${asked}" — development, staging or production`);
  process.exit(2);
}

let problems = 0;
const bad = (line) => {
  problems += 1;
  console.log(`  ✗ ${line}`);
};

// ── 1. the switch, as this checkout has it ─────────────────────────────────

console.log("\nThe switch (config/setup.json in this checkout)\n");

// 🚨 **Read through the APP's reader, never a second one.** This block carried
// its own known-key set, its own unknown-key filter and its own `enabled`
// predicate until 2026-08-13 — all correct-looking, and already drifted: it
// printed `allowDestructive` without ever checking its SHAPE, so
//
//     { "enabled": true, "allowDestructive": "media_upload" }
//
// made this command say `✓ enabled` about a file `setupConfigFrom()` throws away
// whole. The one command whose job is to say where the surface stands said the
// opposite, on the question the surface exists for. `lib/setup/config-shape.mjs`
// is the shared reading; its head carries this measurement.
//
// `undefined` is "no such file" and `null` is "could not be parsed" — the
// contract that reader states, so both are handed to it rather than guessed at
// here.
let enabled = false;
{
  let raw;
  if (!existsSync("config/setup.json")) {
    raw = undefined;
  } else {
    try {
      raw = JSON.parse(readFileSync("config/setup.json", "utf8"));
    } catch (error) {
      raw = null;
      bad(`config/setup.json is not readable JSON (${error.message}) — the surface is off`);
    }
  }

  // Not `problems` — that name is the finding COUNTER above, and shadowing it
  // here would put two different meanings on one word in one file.
  const wrong = setupProblemsFrom(raw);
  const config = setupConfigFrom(raw);
  enabled = config.enabled;

  if (raw === undefined) {
    bad("config/setup.json is missing — the surface is off and cannot be turned on");
  } else if (raw === null) {
    // The parse failure already said its piece above.
  } else if (wrong.length > 0) {
    // Every problem, not the first: `setupOffReasonFrom()` returns one because a
    // terminal line has room for one, and this is the place with room for all.
    for (const problem of wrong) {
      bad(`${problem} — the WHOLE surface is off until it is fixed`);
    }
  } else if (config.enabled) {
    console.log("  ✓ enabled");
    // ⚠️ Said out loud rather than left as a detail. It caught its own author
    // twice: switch it on to try something, forget, and the shipped default
    // is quietly no longer the shipped default.
    console.log(
      "    ⚠️  this is NOT the shipped state — a fresh app ships with the surface off",
    );
  } else {
    // ⚠️ The JSON spelling, not `setupOffReasonFrom()`'s sentence. This line is
    // read by somebody about to open the file, so it says what they will find in
    // it. The pure reason is the one-line form for a terminal that has no room,
    // and `scripts/deploy-test.mjs` pins this wording — a fresh app saying
    // anything else here is a finding.
    console.log('  · off ("enabled": false) — this is the shipped state');
  }

  if (config.allowDestructive.length > 0) {
    console.log(`    destructive tools allowed outside DEV: ${config.allowDestructive.join(", ")}`);
  }
}

// ── 2. what this machine can reach ─────────────────────────────────────────

console.log("\nEnvironments (from .env)\n");

const reachable = [];
for (const [name, vars] of Object.entries(ENVIRONMENTS)) {
  if (target && name !== target) continue;
  const url = process.env[vars.urlVar];
  const key = process.env[vars.keyVar];

  if (!url && !key) {
    console.log(`  · ${name.padEnd(12)} not configured (${vars.urlVar}, ${vars.keyVar})`);
    continue;
  }
  if (!key) {
    // ⚠️ NOT a finding. Every fresh app has APP_URL and no key, because nobody
    // has minted one yet — that is the shipped state, and a check that reports
    // a problem on the shipped state is a check people learn to scroll past.
    // The same argument this repo makes about a gate somebody eventually
    // removes: the cost of crying wolf is the check itself.
    console.log(`  · ${name.padEnd(12)} no key yet (${vars.keyVar}) — ${url}`);
    continue;
  }
  if (!url) {
    // A key with nowhere to send it IS a finding: somebody configured half of
    // something, and the half they did is the half that costs money to leak.
    bad(`${name.padEnd(12)} has ${vars.keyVar} but no ${vars.urlVar} — nothing to call`);
    continue;
  }
  console.log(`  ✓ ${name.padEnd(12)} ${url}`);
  reachable.push({ name, url: url.replace(/\/+$/, ""), key });
}

if (reachable.length === 0) {
  console.log("\n  Nothing to call. Mint a key on /dashboard/admin/setup-keys and put it in .env,");
  console.log("  or bootstrap a fresh environment: node run.mjs setup-bootstrap --email … --apply");
}

// ── 3. really call one ─────────────────────────────────────────────────────

if (live && reachable.length > 0) {
  console.log("\nCalling them (--live)\n");

  for (const env of reachable) {
    let response;
    try {
      response = await fetch(`${env.url}/api/setup`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.key}`, "content-type": "application/json" },
        body: JSON.stringify({ tool: "list_environment", env: env.name }),
      });
    } catch (error) {
      bad(`${env.name.padEnd(12)} ${env.url} did not answer (${error.message})`);
      continue;
    }

    const text = await response.text();

    // 🚨 The one distinction this command exists for. A bodiless 404 is the
    // switched-off surface, deliberately saying nothing — and from outside it
    // is identical to a route that was never built. From HERE we can say which,
    // because we can read the config of the checkout in front of us.
    if (response.status === 404 && text === "") {
      bad(
        `${env.name.padEnd(12)} answered 404 with no body — the surface is off THERE ` +
          `(or that app predates it). Switching it on is a deploy.`,
      );
      continue;
    }
    if (!response.ok) {
      let code = text;
      try {
        code = JSON.parse(text).error ?? text;
      } catch {
        /* keep the raw text */
      }
      bad(`${env.name.padEnd(12)} refused: ${code}`);
      continue;
    }

    const body = JSON.parse(text);
    const data = body.data ?? {};
    console.log(
      `  ✓ ${env.name.padEnd(12)} answers as ${data.appEnv}, ` +
        `${(data.tools ?? []).length} tool(s), ${(data.modules ?? []).length} module(s)`,
    );
    // The environment the APP says it is, against the one we addressed. A
    // mismatch here is a misconfigured host, and the guard would refuse anyway
    // — this names it before somebody spends an afternoon on it.
    if (data.appEnv && data.appEnv !== env.name) {
      bad(`${env.name.padEnd(12)} but the app says it is ${data.appEnv} — check its APP_ENV`);
    }
  }
} else if (live) {
  console.log("\n  --live had nothing to call.");
}

// ── 4. what has been done here ─────────────────────────────────────────────
//
// An audit trail nobody reads is not a control, and this is the terminal's
// reader — the second of the two `SECURITY.md` §7 names, the other being
// `/dashboard/admin/setup-audit`.
//
// ⚠️ This section printed its heading and nothing under it for one release. A
// control that is CLAIMED and not built is worse than one that is absent,
// because somebody stops looking for it.

for (const env of live ? reachable : []) {
  const response = await fetch(`${env.url}/api/setup`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.key}`, "content-type": "application/json" },
    body: JSON.stringify({ tool: "list_acts", env: env.name, input: { limit: 10 } }),
  }).catch(() => null);

  if (!response?.ok) {
    // Not fatal — the environment already answered above, so the surface is
    // there. Saying it plainly beats an empty section that reads as "nothing
    // happened here".
    console.log(`\n  ${env.name}: could not read the trail`);
    continue;
  }

  const { data } = JSON.parse(await response.text());
  const acts = data?.acts ?? [];
  console.log(`\nWhat has been done in ${env.name}\n`);

  if (acts.length === 0) {
    console.log("  nothing yet");
  } else {
    for (const act of acts) {
      const when = act.at.slice(0, 16).replace("T", " ");
      const mark = act.outcome === "refused" ? "✗" : act.outcome === "planned" ? "·" : "✓";
      const tail = [act.target, act.role && `role ${act.role}`, act.code]
        .filter(Boolean)
        .join(" · ");
      console.log(
        `  ${mark} ${when}  ${String(act.tool).padEnd(22)} ${tail}${tail ? "  " : ""}(${act.key ?? "no key"})`,
      );
    }
  }
  console.log(`\n  The full trail is ${env.url}/dashboard/admin/setup-audit`);
}

console.log("");
if (problems > 0) {
  console.log(`✗ ${problems} thing(s) to look at.\n`);
  process.exit(1);
}
console.log(enabled ? "✓ The setup surface is on.\n" : "✓ Nothing wrong — the surface is off.\n");
