#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs module …` — what this app is made of.
//
//   module list       what is installed, and what is here but not installed
//   module check      is the whole arrangement coherent?
//   module sync       rewrite the generated registries from the manifests
//   module add <id>   make this app one that has that module
//   module remove <id>  take it out — see the gate below
//
// ── 🚨 `remove` looks in the database first, and that is the point ──────────
// Uninstalling a module makes the FEATURE absent. It does not make the ROWS
// absent: a module that ran for a year leaves its tables behind with everything
// members wrote in them, and an app that no longer knows about them cannot name
// them in a subject access request — a worse position than the hand-edited
// arrangement this system replaces.
//
// There is no code-level fix, only a product decision: **a module is chosen
// before the first row is written, never after.** So `remove` refuses on a
// non-empty module and names the two lawful ways forward.
// 🚨 For the side effect, and it is load-bearing. Two commands here read
// `process.env.DATABASE_URL` — `remove`, to prove a module is empty before it
// takes it out, and `check`, for the orphan-table backstop — and nothing put the
// `.env` into the environment. So on every customer's machine:
//
//   · `module remove <id>` always took the "I could not look" path and refused,
//     for every module with tables, empty or not. Three of the four documented
//     paths were unreachable;
//   · `module check`'s database half sits behind `if (process.env.DATABASE_URL)`
//     and therefore never ran — silently. `docs/modules.md` calls that half "the
//     backstop … an alarm rather than a silence", and it was the silence.
//
// Every other database-touching script in `scripts/` already does this
// (`db/migrate.mjs`, `db/seed.mjs`, `users/_db.mjs`, all three prune jobs).
// `scripts/lib/env.test.ts` now asks it of all of them rather than of the ones
// somebody remembered — this file was the one it had not been asked of.
//
// Safe for the import-graph rule below: `lib/env.mjs` imports `node:fs` alone.
import "../lib/env.mjs";

import { availableModules, loadModules, readModule } from "./registry.mjs";
import { installedModules } from "./installed.mjs";
import { writeGenerated } from "./generate.mjs";
// What still has to happen before an installed module does anything — one
// answer, read by `add` and by `list`, because the two used to disagree by
// omission: `list` named the switch and `add` did not. See that file's header.
import { afterInstall } from "./next-steps.mjs";
// Which way each installed module's switch points — the weak, certain half of
// the question its own reader answers in full. See that file's header for why
// a weaker claim is allowed here where a copy of `isCommunityEnabled()` is not.
import { switchLine, switchStateFrom } from "./switch-state.mjs";
// 🚨 NOT a static import, and the reason is a fresh clone.
//
// `data-gate.mjs` imports `postgres` — it exists to look in the database. A
// static import here puts that driver in the import graph of EVERY module
// command, including the three that never touch a database: `add`, `list` and
// `sync`. On a tree with no `node_modules` yet, all of them then die with
//
//     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'postgres'
//
// — a Node stack trace, from the command line meant for people who are not
// developers, about a dependency the command does not use. `module list` is the
// one command that answers "what is this app made of" (`CLAUDE.md` says so), and
// it was unusable on a clone until somebody happened to run something else first.
//
// Measured: `make deploy-test-modules` deploys the template and runs
// `module add` before the dependencies are in, which is the order the migrations
// force — and that is what found this.
//
// So the gate is loaded where it is USED, inside `check` and `remove`. Both are
// already `async` and both already refuse without a reachable database, so the
// import sits behind the same condition the database work does.
const dataGate = () => import("./data-gate.mjs");
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const command = args[0] ?? "list";

/** What a module says it brings, in one line per kind. Empty kinds stay silent. */
function summarise(manifest) {
  const parts = [];
  const say = (n, one, many = `${one}s`) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  const count = (key, one, many) => {
    const value = manifest[key];
    say(Array.isArray(value) ? value.length : 0, one, many);
  };
  count("tables", "table");
  count("app", "route subtree", "route subtrees");
  say(manifest.messages?.namespaces?.length ?? 0, "text namespace");
  say(manifest.commands ? Object.keys(manifest.commands).length : 0, "command");
  say(Array.isArray(manifest.cronJobs) ? manifest.cronJobs.length : 0, "scheduled job");
  // 🚨 The two questions somebody actually asks after `module add`: did anything
  // appear in the MENU, and did anything appear on a page the core owns? Only
  // `community` declares nav, and it is the one people expect entries from — so
  // its silence after an install (the switch below is still off) is the single
  // most confusable state this command has.
  //
  // Whether it is one entry or two is inside `nav.ts`, which is TypeScript and
  // therefore unreadable from here. So: that there ARE some, never how many —
  // a number this file would have to guess at is worse than the plain fact.
  if (manifest.nav) parts.push("menu entries of its own");
  const slots = manifest.slots ? Object.keys(manifest.slots) : [];
  if (slots.length > 0) parts.push(`a card on the ${slots.join(" and ")} page`);
  return parts.length > 0 ? parts.join(" · ") : "nothing but itself";
}

/**
 * What one switch file currently says — `undefined` when there is none,
 * `null` when it cannot be parsed. That is `switchStateFrom()`'s contract, and
 * the reading happens HERE because that file deliberately touches no disk.
 *
 * @param {string} file
 */
function readSwitch(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Where to read about one module, and how its switch currently stands.
 *
 * ⚠️ The switch is read for the WEAK answer only, and the distinction is the
 * whole reason this is allowed. A copy of `isCommunityEnabled()` here would be a
 * second answer to a question that already has one — 373 lines of range and type
 * checks, any of which turns the module off — and two answers that disagree on
 * the day somebody typos a key is precisely the state this command exists to
 * clear up. So `switch-state.mjs` claims strictly less than the app does: every
 * `OFF` it prints is one the app also decides, and `on` reports the switch's
 * POSITION rather than promising the module runs. See that file's header.
 *
 * @param {Record<string, unknown>} manifest
 * @param {boolean} installed a dormant module's switch says nothing — it is off
 *   because it is not here, and printing a position would answer another question
 */
function pointers(manifest, installed) {
  const parts = [];
  if (typeof manifest.config === "string") {
    parts.push(
      installed
        ? switchLine(manifest.config, switchStateFrom(readSwitch(manifest.config)))
        : `switch: ${manifest.config}`,
    );
  }
  if (typeof manifest.docs === "string") parts.push(manifest.docs);
  if (typeof manifest.skill === "string") parts.push(`skill: ${manifest.skill}`);
  return parts.join("  ·  ");
}

/**
 * One module's two lines: what it IS, then what it brings.
 *
 * A dormant module's manifest is read by nothing at build time, so a broken one
 * reaches this command first — and `list` is the wrong place to die on it: the
 * whole point of the command is to say what is in the tree. It names the fault
 * and defers to `check`, which is the command that reports it properly.
 *
 * @param {string} id
 * @param {number} width the id column, so the second line hangs under the first
 * @param {boolean} withParts whether to print what it brings (dormant: it brings nothing yet)
 */
function describe(id, width, withParts) {
  let manifest;
  try {
    ({ manifest } = readModule(id));
  } catch {
    console.log(`  ${id.padEnd(width)}  —  its manifest is broken; \`module check\` says how`);
    return;
  }
  const hang = `  ${" ".repeat(width)}  ${" ".repeat(String(manifest.version).length)}     `;
  console.log(`  ${id.padEnd(width)}  ${manifest.version}  —  ${manifest.summary}`);
  // The community brings seven kinds at once, which is one line of about 150
  // characters — wrapped by the terminal at a column the hanging indent knows
  // nothing about, so it lands under the id and reads as another module.
  if (withParts) for (const line of wrap(summarise(manifest), hang.length)) console.log(`${hang}${line}`);
  // `withParts` is "this module is installed" wearing the name of what it was
  // first used for — and the switch's position is only a fact about an installed
  // module, so it travels on the same flag.
  const where = pointers(manifest, withParts);
  if (where) console.log(`${hang}${where}`);
}

/**
 * Break a ` · `-joined line into terminal-width pieces, never mid-item.
 *
 * @param {string} text
 * @param {number} indent how much of the line the hanging indent already spends
 * @returns {string[]}
 */
function wrap(text, indent) {
  const room = Math.max(30, 96 - indent);
  const lines = [];
  let line = "";
  for (const part of text.split(" · ")) {
    if (line && `${line} · ${part}`.length > room) {
      lines.push(line);
      line = part;
    } else {
      line = line ? `${line} · ${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Break prose at word boundaries, for a sentence whose length is a module's to
 * decide rather than this file's.
 *
 * `wrap()` above splits on ` · ` and is for the ITEM lists; a switch's
 * consequence is one sentence, and splitting it on a separator it does not
 * contain would print it whole and blow past the column either way.
 *
 * @param {string} text
 * @param {number} indent how much of the line the hanging indent already spends
 * @returns {string[]}
 */
function wrapWords(text, indent) {
  const room = Math.max(30, 92 - indent);
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > room) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * How to add or remove ONE module, with a real id in it.
 *
 * 🚨 A real id rather than `<id>`: this list is routinely the first thing
 * somebody reads about modules, and a placeholder is one more thing to work out
 * before the command runs. The ids come from the two lists just printed, so the
 * example is always a command that would really do something in THIS app.
 *
 * @param {string[]} installed
 * @param {string[]} dormant
 */
function howToChange(installed, dormant) {
  console.log("\nAdding one, taking one out — by id, one module at a time:\n");

  const addId = dormant[0];
  if (addId) {
    console.log(`  node run.mjs module add ${addId}`);
    let manifest = {};
    try { ({ manifest } = readModule(addId)); } catch { /* said above */ }
    // The same steps `add` prints when somebody really runs it — from one
    // place, so the example and the aftermath cannot drift apart.
    for (const step of afterInstall(manifest)) {
      if (step.kind === "migrate") {
        const brings =
          step.tables === 1 ? "1 table, which is not there yet" : `${step.tables} tables, which are not there yet`;
        console.log(`  node run.mjs db-migrate         ${addId} brings ${brings}`);
      } else {
        // The step people leave out, and the reason the first question after an
        // install is "why is nothing there?". The INVARIANT half only — this is
        // a command column, and `whileOff` is a sentence. `add` prints that one,
        // which is where somebody stands when they ask.
        console.log(`  ${step.file.padEnd(29)} "enabled": true, then restart — ${step.why}`);
      }
    }
  } else {
    console.log("  node run.mjs module add <id>    everything in this tree is already installed");
  }
  console.log(
    installed[0]
      ? `  node run.mjs module remove ${installed[0]}`
      : "  node run.mjs module remove <id> nothing is installed here, so there is nothing to take out",
  );

  console.log(
    "\n  `remove` looks in the database first and refuses while the module holds rows —\n" +
      "  a module is chosen before the first row is written, never after. Both commands\n" +
      "  rewrite the generated registries, and they belong in the same commit as the list.\n" +
      "  What each module is, in full: docs/modules.md.",
  );
}

function list() {
  const installed = installedModules();
  const available = availableModules();
  const dormant = available.filter((id) => !installed.includes(id));

  if (installed.length === 0 && available.length === 0) {
    console.log("This app is the core — no modules.\n");
    console.log("  A module is a whole feature (pages, tables, texts, guidance) that an app");
    console.log("  either has or does not. See docs/modules.md.");
    return 0;
  }

  const width = Math.max(...available.map((id) => id.length), 9);

  if (installed.length > 0) {
    console.log(`Installed (${installed.length}):\n`);
    for (const id of installed) describe(id, width, true);
    // 🚨 The sentence the whole command is missing without it. "I installed the
    // community and there are no menu entries" is not a bug and not a stale
    // clone: the entries carry a featureKey, the switch ships OFF, and a
    // switched-off module is deliberately indistinguishable from an absent one.
    if (installed.some((id) => hasSwitch(id))) {
      console.log(
        "\n  The switch is a second question, and the line above answers it per module.\n" +
          "  An installed module that is off does NOTHING — its pages answer the same 404 a\n" +
          "  route that never existed answers, and its menu entries stay hidden. They ship\n" +
          "  off; switching one on is that file plus a restart.\n" +
          "\n" +
          // 🚨 Said once, here, rather than hedged on every module's line: `OFF`
          // is this command's own certain answer, `on` is the switch's position
          // and the module's reader still has the last word. Printing that
          // caveat per line would train people to skim past the state itself.
          "  `OFF` is certain — nothing can turn it on from there. `on` is what the FILE says:\n" +
          "  an out-of-range value or an unknown key in it still means off, and the module's\n" +
          "  own page is what reports that.",
      );
    }
  } else {
    console.log("Installed: none — this app is the core.");
  }

  if (dormant.length > 0) {
    console.log(`\nPresent but not installed (${dormant.length}):\n`);
    for (const id of dormant) describe(id, width, false);
    console.log("\n  Their code is in the tree and does nothing: no routes, no tables, no texts.");
  }

  howToChange(installed, dormant);
  return 0;
}

async function check() {
  const problems = [];
  const notes = [];

  let records;
  try {
    records = loadModules();
  } catch (error) {
    console.error(`✗ ${error.message}`);
    return 1;
  }

  // A module that is installed but whose id is not a folder, or the reverse,
  // is already refused by loadModules(). What is left to say is the part that
  // is legal and still worth knowing.
  for (const { id, manifest } of records) {
    const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
    if (requires.length > 0) {
      // Legal, and it costs something specific: the factory can only test k+2
      // profiles while modules are independent. Said here rather than refused
      // in the manifest, because an undeclared dependency is worse than a
      // declared one.
      notes.push(
        `"${id}" requires ${requires.map((d) => `"${d}"`).join(", ")} — the modules are no ` +
          `longer independent, so the variant harness cannot assume that testing each module ` +
          `alone covers the combinations.`,
      );
    }
    if (Array.isArray(manifest.tables) && manifest.tables.length > 0 && manifest.erase !== true) {
      // Belt and braces: manifestProblems() already refuses this. If it ever
      // stops, this is the second place somebody sees it.
      problems.push(`"${id}" holds tables but declares no eraseFor()`);
    }
  }

  // 🚨 The backstop the gate cannot cover: somebody edited config/modules.json
  // by hand, or restored an old copy of it. Tables whose prefix belongs to a
  // module that is NOT installed are data this app holds and can no longer
  // answer for — an alarm rather than a silence.
  if (process.env.DATABASE_URL) {
    try {
      const known = availableModules()
        .map((id) => { try { return readModule(id).manifest.tablePrefix; } catch { return null; } })
        .filter((p) => typeof p === "string" && p.length > 0);
      const installedPrefixes = records
        .map((r) => r.manifest.tablePrefix)
        .filter((p) => typeof p === "string" && p.length > 0);
      const { orphanTables } = await dataGate();
      const orphans = await orphanTables(process.env.DATABASE_URL, installedPrefixes, known);
      if (orphans.length > 0) {
        problems.push(
          `the database holds ${orphans.length} table(s) belonging to a module that is not ` +
            `installed:\n    ${orphans.join(", ")}\n    Nothing in this app can name them in a ` +
            `subject access request. Re-install the module, or remove them deliberately.`,
        );
      }
    } catch (error) {
      notes.push(`could not check the database for orphan tables: ${error.message}`);
    }
  } else {
    notes.push("DATABASE_URL is not set, so tables of uninstalled modules were not looked for.");
  }

  const dormant = availableModules().filter((id) => !installedModules().includes(id));
  for (const id of dormant) {
    // A dormant module's manifest is not read by anything at build time, so a
    // broken one would only be discovered by whoever installs it — probably in
    // a hurry.
    try {
      readModule(id);
    } catch (error) {
      problems.push(`"${id}" is present but its manifest is broken:\n    ${error.message}`);
    }
  }

  console.log(
    `Modules: ${records.length} installed, ${dormant.length} present but not installed.`,
  );
  for (const note of notes) console.log(`\n·  ${note}`);

  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  • ${p}`);
    return 1;
  }
  console.log("\n✓ The module arrangement is coherent.");
  return 0;
}

function sync() {
  const changed = writeGenerated();
  if (changed.length === 0) {
    console.log("✓ The generated registries already match the manifests.");
    return 0;
  }
  console.log(`✓ Rewrote ${changed.length} generated file(s):\n`);
  for (const file of changed) console.log(`  ${file}`);
  console.log("\n  They are ordinary source files and belong in the same commit as the change");
  console.log("  that caused them — the customer's `npm run build` runs no generator.");
  return 0;
}

/** The declared tables of a module, or `[]`. */
const tablesOf = (manifest) => (Array.isArray(manifest.tables) ? manifest.tables : []);

/** Does this module have a switch of its own? A broken manifest is `check`'s to report. */
function hasSwitch(id) {
  try {
    return typeof readModule(id).manifest.config === "string";
  } catch {
    return false;
  }
}

/** Rewrite `config/modules.json`, keeping its prose. */
function writeInstalled(ids) {
  const path = "config/modules.json";
  const file = JSON.parse(readFileSync(path, "utf8"));
  file.installed = ids;
  // Two-space indent and a trailing newline — the shape every other config in
  // this app has, so a diff shows the change and not the formatting.
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Record a `--drop-data` removal, and return the path it was written to.
 *
 * Append-only and numbers-only. One line per removal, so the file reads as a
 * history rather than a state — the same shape as the moderation trail, and for
 * the same reason: what it records is that somebody decided something.
 *
 * ⚠️ Nothing about WHAT was deleted, ever. The counts are per table because
 * "the module held 4 rows" and "the module held 4 rows in `api_keys`" are
 * different answers to an auditor, and neither says anything about a person.
 */
function writeRemovalRecord(id, counted) {
  const dir = "docs/reports";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = `${dir}/module-removals.md`;
  if (!existsSync(path)) {
    writeFileSync(
      path,
      "# Modules removed with their data\n\n" +
        "Written by `node run.mjs module remove <id> --drop-data`. Numbers only —\n" +
        "never what was in the rows. Append-only: a line here is a record that\n" +
        "somebody decided on an erasure, and it is what answers the question a\n" +
        "year later.\n\n",
    );
  }
  const when = new Date().toISOString().slice(0, 10);
  const detail = Object.entries(counted.counts)
    .map(([table, n]) => `${table}: ${n}`)
    .join(", ");
  appendFileSync(path, `- ${when} — module "${id}" removed with --drop-data. ${detail}\n`);
  return path;
}

async function add() {
  const id = args[1];
  if (!id) {
    console.error("Usage: node run.mjs module add <id>");
    return 2;
  }

  const installed = installedModules();
  if (installed.includes(id)) {
    console.log(`"${id}" is already installed. Nothing to do.`);
    return 0;
  }

  // Validated BEFORE it goes in the list: a broken manifest that reached
  // `config/modules.json` would make every command that reads the arrangement
  // fail, including the one that explains what is wrong.
  const { manifest } = readModule(id);

  writeInstalled([...installed, id]);
  const changed = writeGenerated();

  console.log(`✓ "${id}" is now part of this app (${manifest.version}).\n`);
  if (changed.length > 0) {
    console.log(`  Rewrote ${changed.length} generated file(s):`);
    for (const file of changed) console.log(`    ${file}`);
    console.log("");
  }
  // 🚨 The switch is the step that gets left out, and this is where somebody
  // stands when they ask why nothing appeared. `module list` knew the sentence
  // and printed it only in its example for a module that is still DORMANT — so
  // in an app where everything is already installed it printed no switch step at
  // all, and the operator who had just added the community saw an empty menu and
  // concluded the module system was broken. Both commands read `next-steps.mjs`
  // now; neither keeps a copy.
  const steps = afterInstall(manifest);
  const commit = "Commit both: the list and the generated files belong in one commit.";
  if (steps.length === 0) {
    // A module that is pure seam — no table, no switch. Numbering one item
    // would promise a list that is not there.
    console.log(`  ${commit}`);
    return 0;
  }

  console.log("  What is left, in this order:\n");
  let n = 0;
  for (const step of steps) {
    n += 1;
    if (step.kind === "migrate") {
      const tables = step.tables === 1 ? "its 1 table is" : `its ${step.tables} tables are`;
      console.log(`  ${n}. node run.mjs db-migrate — ${tables} not there yet.`);
    } else {
      console.log(`  ${n}. ${step.file} — set "enabled": true, then restart.`);
      const said = `${step.why[0].toUpperCase()}${step.why.slice(1)}: while it is off ${step.whileOff}.`;
      for (const line of wrapWords(said, 5)) console.log(`     ${line}`);
    }
  }
  console.log(`  ${n + 1}. ${commit}`);
  return 0;
}

async function remove() {
  const id = args[1];
  if (!id) {
    console.error("Usage: node run.mjs module remove <id> [--drop-data]");
    return 2;
  }

  const installed = installedModules();
  if (!installed.includes(id)) {
    console.log(`"${id}" is not installed. Nothing to do.`);
    return 0;
  }

  const { dir, manifest } = readModule(id);
  const tables = tablesOf(manifest);
  const dropData = args.includes("--drop-data");

  if (tables.length > 0) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      // 🚨 Refused rather than assumed empty. "I could not look" and "there is
      // nothing there" are the same colour and must never be the same answer.
      console.error(
        `✗ DATABASE_URL is not set, so there is no way to see whether "${id}" holds data.\n\n` +
          `  Uninstalling is only a decision about CODE while its tables are empty.\n` +
          `  Point DATABASE_URL at the database this app uses and run it again.`,
      );
      return 1;
    }

    const { countModuleRows, dropModuleTables, moduleTypes } = await dataGate();

    let counted;
    try {
      counted = await countModuleRows(url, tables);
    } catch (error) {
      console.error(
        `✗ Could not read the database (${error.message}).\n\n` +
          `  Empty cannot be proven without looking, so this refuses rather than guesses.`,
      );
      return 1;
    }

    if (counted.total > 0 && !dropData) {
      console.error(`✗ "${id}" still holds ${counted.total} row(s):\n`);
      for (const [table, n] of Object.entries(counted.counts)) {
        if (n > 0) console.error(`    ${table.padEnd(34)} ${n}`);
      }
      console.error(
        `\n  Uninstalling now would leave those rows in the database with nothing in the\n` +
          `  app that knows about them — and a subject access request could not name them.\n\n` +
          `  Two lawful ways forward:\n\n` +
          `    1. Keep it installed and switch it OFF in its own config. That is what the\n` +
          `       switch is for: the code is inert, the exports keep answering, and it\n` +
          `       costs nothing.\n\n` +
          `    2. \`--drop-data\`, which DELETES those rows. That is erasure, it is\n` +
          `       irreversible, and it is a decision somebody takes rather than a step in\n` +
          `       an uninstall.`,
      );
      return 1;
    }

    try {
      await dropModuleTables(
        url,
        tables,
        manifest.migrationsTable,
        // Its own enums, read out of its own migrations — see `moduleTypes()`.
        typeof manifest.migrations === "string"
          ? moduleTypes(join(dir, manifest.migrations))
          : [],
      );
    } catch (error) {
      console.error(`✗ Could not drop the module's tables: ${error.message}`);
      return 1;
    }
    if (counted.total > 0) {
      // 🚨 WRITTEN, not suggested. This used to print "write this down where
      // your app records decisions" — and the first person to use the flag in
      // anger was the one who built it, dropping a row and recording nothing.
      // An erasure that leaves no trace is the one thing this branch must not
      // be: `--drop-data` is a deletion somebody decided on, and a decision
      // nobody wrote down is one nobody can answer for later.
      //
      // A numbers-only record, the same rule `cron_runs` follows: what was
      // deleted, how much of it, and when — never what was in it. It goes to
      // `docs/reports/`, which is where everything in this app that produces a
      // verdict already writes, and which the knowledge stamp deliberately
      // leaves alone because it is the customer's.
      const written = writeRemovalRecord(id, counted);
      console.log(`·  Dropped ${counted.total} row(s) with --drop-data. Recorded in ${written}.`);
    }
  }

  writeInstalled(installed.filter((other) => other !== id));
  const changed = writeGenerated();

  console.log(`\n✓ "${id}" is no longer part of this app.`);
  if (changed.length > 0) {
    console.log(`  Rewrote ${changed.length} generated file(s).`);
  }
  console.log(`  Its code is still in modules/${id}/ and does nothing.`);
  return 0;
}

const COMMANDS = { list, check, sync, add, remove };

if (!Object.hasOwn(COMMANDS, command)) {
  console.error(`Unknown: module ${command}\n`);
  console.error(`  node run.mjs module list    what this app is made of`);
  console.error(`  node run.mjs module check   is the arrangement coherent?`);
  console.error(`  node run.mjs module sync    rewrite the generated registries`);
  console.error(`  node run.mjs module add <id> / remove <id>`);
  process.exit(2);
}

try {
  process.exit(await COMMANDS[command]());
} catch (error) {
  // Every throw from the registry layer is already a sentence written for the
  // person who edited the file. A stack trace on top of it helps nobody.
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
