// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which optional modules this app is made of — the bare-Node side of the answer.
//
// The twin of `lib/modules/installed.ts`, and the reason there are two is the
// same one `lib/ai/tasks.ts` / `lib/ai/task-rules.mjs` and `lib/cron/ids.mjs`
// have: the app reads the file through the bundler (a path resolved against
// `process.cwd()` breaks under `output: "standalone"`), while `next.config.ts`,
// `run.mjs` and the scripts under `scripts/` run before any bundler exists and
// must read it off the disk.
//
// `lib/modules/installed.test.ts` fails the build when the two disagree.
//
// 🚨 It THROWS on a malformed list rather than resolving to "no modules" —
// the argument is written out in `lib/modules/installed.ts` and is worth
// reading before anyone "hardens" this into a fallback: guessing "nothing"
// makes an app forget tables it still holds.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The app root, from this file's own location — never `process.cwd()`. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ID = /^[a-z][a-z0-9-]*$/;
const KNOWN = new Set(["installed"]);

/**
 * The pure rules, kept identical to `parseInstalled()` in the TypeScript twin.
 *
 * @param {Record<string, unknown>} file
 * @param {string} where
 * @returns {string[]}
 */
export function parseInstalled(file, where) {
  const refuse = (why) => {
    throw new Error(
      `${where} is not a readable module list: ${why}.\n` +
        `  It decides what this app is made of, so it is refused rather than guessed — ` +
        `an app that forgets a module keeps its tables and stops answering for them.\n` +
        `  Expected: { "installed": ["community", …] }`,
    );
  };

  const unknown = Object.keys(file).filter((k) => !k.startsWith("_") && !KNOWN.has(k));
  if (unknown.length > 0) refuse(`unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")}`);

  const installed = file.installed;
  if (installed === undefined) refuse('no "installed" key');
  if (!Array.isArray(installed)) refuse('"installed" must be an array of module ids');

  for (const entry of installed) {
    if (typeof entry !== "string" || !ID.test(entry)) {
      refuse(`"${String(entry)}" is not a module id (lower-case letters, digits and dashes)`);
    }
  }

  const duplicate = installed.find((id, i) => installed.indexOf(id) !== i);
  if (duplicate) refuse(`"${duplicate}" is listed twice`);

  return installed;
}

/**
 * The ids of the modules this app is made of.
 *
 * @param {string} [root] the app root — only tests pass one.
 * @returns {string[]}
 */
export function installedModules(root = ROOT) {
  const where = "config/modules.json";
  const path = join(root, "config", "modules.json");

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    // A missing file is not "no modules" either. It ships with the template, so
    // its absence means somebody deleted it, and the honest answer is to say so.
    throw new Error(
      `${where} is missing (${error.code ?? "unreadable"}). It ships with the template ` +
        `and says what this app is made of; recreate it with { "installed": [] } ` +
        `if this app has no modules.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} is not valid JSON: ${error.message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${where} must be a JSON object, not ${Array.isArray(parsed) ? "an array" : typeof parsed}`);
  }

  return parseInstalled(parsed, where);
}
