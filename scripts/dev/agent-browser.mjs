#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Give the agent a browser.
//
//   node run.mjs agent-browser                  what it would do
//   node run.mjs agent-browser --apply          wire it, fetch Chromium
//   node run.mjs agent-browser --remove --apply take the server out again
//
// Adds Playwright's MCP server — navigate, click, read the page, screenshot —
// to the wiring of every program this app still has on disk, and installs the
// Chromium build the pinned version wants. Why it is a command and not part of
// the template: `browserServer()` in agent-configs.mjs. What it decides per
// file: the header of browser-tool.mjs.
//
// 🚨 **Ask before `--apply`.** It changes the user's own program setup and
// downloads ~150 MB, and the guidance (`ux-gateway`) says so: offer, let them
// decide, then run it. An agent that runs it unasked has done to the user's
// machine exactly what this template refuses to do to their app.
//
// A config is read when a session STARTS — so the tools appear in the next
// session, not this one, and the command ends by saying so. `--remove` leaves
// Chromium where it is: it is Playwright's cache, shared with anything else on
// the machine that uses it, and 150 MB in a cache is not the same as 150 MB in
// a repo.
import { AGENTS, BROWSER_OUTPUT_DIR, BROWSER_SERVER_NAME, gateNotice, mcpConfigFiles } from "./agent-configs.mjs";
import {
  CHROMIUM_INSTALL,
  applyBrowserWiring,
  chromiumInstalled,
  planBrowserWiring,
  playwrightBrowsersDir,
} from "./browser-tool.mjs";
import { run } from "../lib/proc.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const remove = args.includes("--remove");

const steps = planBrowserWiring(ROOT, { remove });
const present = steps.filter((s) => s.action !== "absent");

if (present.length === 0) {
  // Every MCP-bearing file gone is not "nothing to do" — it is an app with no
  // wiring for any program, which `agent-setup` never produces on its own.
  console.error("✗ None of the four programs' config files is on disk:");
  for (const { file } of mcpConfigFiles()) console.error(`    ${file}`);
  console.error("  Run `node run.mjs agent-setup --undo --apply` first, then this again.");
  process.exit(1);
}

const label = (agent) => AGENTS[agent].label;
const verb = remove ? "Take the browser server out of" : "Give the agent a browser in";
console.log(`${verb} this app — the MCP server \`${BROWSER_SERVER_NAME}\`:\n`);

for (const step of steps) {
  const who = `${step.file}  (${label(step.agent)})`;
  switch (step.action) {
    case "absent":
      console.log(`  · ${who} — not on disk, that program was pruned; skipped`);
      break;
    case "already":
      console.log(`  ✓ ${who} — ${remove ? "does not carry it" : "already carries it"}`);
      break;
    case "write":
      console.log(`  ${remove ? "-" : "+"} ${who}`);
      break;
    case "merge":
      console.log(`  + ${who} — you changed this file; the server is added, the rest stays`);
      break;
    case "yours":
      console.log(
        `  · ${who} — ${remove ? "carries a `" + BROWSER_SERVER_NAME + "` that is not ours, or cannot be read" : "already names a `" + BROWSER_SERVER_NAME + "` server of your own, or cannot be read"}; left alone`,
      );
      break;
  }
}

const browsersDir = playwrightBrowsersDir();
const haveChromium = chromiumInstalled(browsersDir);
if (!remove) {
  console.log("");
  console.log(
    haveChromium
      ? `  ✓ Chromium is in Playwright's cache (${browsersDir})`
      : `  + Chromium — ${CHROMIUM_INSTALL.join(" ")}  (~150 MB into ${browsersDir})`,
  );
}

const toWrite = steps.filter((s) => s.content !== undefined);
const nothing = toWrite.length === 0 && (remove || haveChromium);

if (nothing) {
  console.log(`\n✓ Nothing to do.`);
  if (!remove) console.log(`  Tools appear in the NEXT session; screenshots land in ${BROWSER_OUTPUT_DIR}/.`);
  process.exit(0);
}

if (!apply) {
  console.log("\nNothing written. Repeat with --apply to do it — after asking: it changes");
  console.log("the user's own program setup" + (remove ? "." : " and downloads Chromium."));
  process.exit(0);
}

const written = applyBrowserWiring(ROOT, steps);
if (written.length > 0) console.log(`\n✓ ${written.length} file(s) written.`);

let failed = false;
if (!remove && !haveChromium) {
  console.log(`\n>> ${CHROMIUM_INSTALL.join(" ")}`);
  const code = await run(CHROMIUM_INSTALL[0], CHROMIUM_INSTALL.slice(1), { cwd: ROOT });
  if (code === 0 && chromiumInstalled(browsersDir)) {
    console.log(`✓ Chromium fetched into ${browsersDir}`);
  } else {
    failed = true;
    console.error(`✗ Chromium did not arrive (exit ${code}). The wiring is written; the browser is not there.`);
    console.error(`  Run the command above again, or let the server fetch it itself in the next`);
    console.error(`  session — it offers a \`browser_install\` tool when the browser is missing.`);
  }
}

if (!remove) {
  console.log("");
  console.log(`  The tools (browser_navigate, browser_snapshot, browser_take_screenshot, …)`);
  console.log(`  appear in the NEXT session — a config is read at session start.`);
  console.log(`  Screenshots land in ${BROWSER_OUTPUT_DIR}/, which is gitignored.`);
  // The same gates the setup server meets: the new server is absent until the
  // program's trust question is answered, and this is the last thing read
  // before meeting it.
  const touched = [...new Set(present.map((s) => s.agent))];
  for (const agent of touched) {
    console.log("");
    for (const line of gateNotice(agent)) console.log(line);
  }
}

process.exit(failed ? 1 : 0);
