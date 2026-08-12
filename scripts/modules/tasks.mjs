// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The commands an installed module adds to `node run.mjs`.
//
// `run.mjs` keeps its own `TASKS` literal — that is the core's list and it is
// read as TEXT by `scripts/docs-coverage.test.ts`, which insists every core
// command is documented somewhere. Module commands are merged in AFTER the
// literal, deliberately: they are documented by their own module's guidance,
// not by the core's, and the coverage test should not ask the core to explain
// a command that arrived with a module.
//
// Nothing here imports the app. It runs in a half-set-up project, before
// `npm install`, like the rest of `run.mjs`.
import { loadModules } from "./registry.mjs";

/**
 * @typedef {object} ModuleCommand
 * @property {string} name    what the user types after `node run.mjs`
 * @property {string} help    the line `run.mjs help` prints
 * @property {string} file    app-relative path to the script
 * @property {string} module  which module brought it
 */

/**
 * Every command the installed modules bring, sorted by name.
 *
 * Returns `[]` and says nothing when the module arrangement is broken: this is
 * called while BUILDING the command table, so a throw here would make
 * `node run.mjs` itself unusable — including `node run.mjs module check`, which
 * is the command that explains what is wrong. The diagnosis belongs to that
 * command, not to the table it lives in.
 *
 * @param {string} [root]
 * @returns {ModuleCommand[]}
 */
export function moduleCommands(root) {
  let records;
  try {
    records = root === undefined ? loadModules() : loadModules(root);
  } catch {
    return [];
  }

  const commands = [];
  for (const { id, dir, manifest } of records) {
    const declared = manifest.commands;
    if (!declared || typeof declared !== "object") continue;
    for (const [name, entry] of Object.entries(declared)) {
      commands.push({ name, help: entry.help, file: `${dir}/${entry.script}`, module: id });
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
