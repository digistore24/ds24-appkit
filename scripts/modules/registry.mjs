// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The modules this app has, read off the disk and checked.
//
// `config/modules.json` says WHICH modules are installed;
// `modules/<id>/module.json` says what each one IS. This file is where the two
// meet, and it is the reader everything bare-Node uses: `run.mjs`, the
// generators, `scripts/db/migrate.mjs`, `scripts/dev/session-start.mjs`,
// `scripts/dev/smoke.mjs`.
//
// The app does NOT use this file. It cannot: reading a folder at runtime breaks
// under `output: "standalone"`, and a server component needs static imports the
// bundler can see. That is what the generated `lib/modules/registry.ts` is for,
// and this file is what generates it.
//
// ── Everything here refuses rather than shrugs ─────────────────────────────
// An installed module whose folder is missing, a manifest that does not parse,
// an id that disagrees with its folder — each of those produces a smaller
// module list, and a smaller module list is an app quietly forgetting a feature
// it still holds tables for. Same argument as `lib/modules/installed.ts`, one
// layer up.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installedModules } from "./installed.mjs";
import { manifestProblems } from "./manifest.mjs";

/** The app root, from this file's own location — never `process.cwd()`. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @typedef {object} ModuleRecord
 * @property {string} id
 * @property {string} dir       relative to the app root, e.g. `modules/community`
 * @property {Record<string, unknown>} manifest
 */

/**
 * Every module that EXISTS in this tree, installed or not, sorted by id.
 *
 * The difference from `installedModules()` matters for one command: `module
 * list` has to be able to say "this is here and switched off" as distinct from
 * "this is not here at all".
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function availableModules(root = ROOT) {
  const dir = join(root, "modules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => {
      if (entry.startsWith(".") || entry.startsWith("_")) return false;
      return statSync(join(dir, entry)).isDirectory();
    })
    .sort();
}

/**
 * `ids` plus everything they require, transitively — the smallest arrangement
 * containing them that `loadModules()` will actually load.
 *
 * 🚨 **This exists because the failure it prevents is SILENT.** `loadModules()`
 * refuses a list that names a module without its dependency, which is right;
 * but `scripts/modules/inventory.mjs` wraps it in `safeModules()` and swallows
 * that refusal into an empty list, deliberately, so that a broken manifest can
 * never be the reason a session has no greeting. The two together mean a caller
 * passing `["courses"]` gets **nothing back and no error** — no globs, no cron
 * jobs, no sections — and every assertion over the result then passes by being
 * vacuous. Measured on 2026-08-12, the day `courses` first declared `requires`:
 * two assertions in `scripts/modules/inventory.test.ts` flipped to reading an
 * empty map, and only one of them happened to compare against a non-empty
 * expectation.
 *
 * So whoever asks a question ABOUT a module rather than about this app closes
 * the list here first. Cycles are impossible (`manifestProblems()` refuses a
 * module that requires itself, `readModule()` refuses a dependency that is not
 * in the tree), and the `seen` set is what makes that a property of this
 * function rather than a hope about the data.
 *
 * @param {string[]} ids
 * @param {string} [root]
 * @returns {string[]} sorted, deduplicated
 */
export function withRequires(ids, root = ROOT) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const { manifest } = readModule(id, root);
    const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
    for (const dep of requires) visit(dep);
  };
  for (const id of ids) visit(id);
  return [...seen].sort();
}

/**
 * What `module add <id>` is missing — the dependencies not already installed.
 *
 * 🚨 **A decision, extracted, because the command that used to make it made it
 * TOO LATE.** `add()` wrote `config/modules.json` and only then called
 * `writeGenerated()`, which is where `loadModules()`'s refusal lived — so the
 * command printed an error and exited 1 having already put the module in the
 * list, with no generated file rewritten. `module list` then reported it as
 * installed. Measured on 2026-08-12, the day `courses` first declared
 * `requires`. A refusal that leaves the app half-changed is worse than no
 * refusal: the operator reads an error, believes nothing happened, and every
 * later command answers for an arrangement that does not exist.
 *
 * Empty means "go ahead". Order follows the manifest's, so the message names
 * them in the order somebody should install them.
 *
 * @param {Record<string, unknown>} manifest
 * @param {string[]} installed
 * @returns {string[]}
 */
export function missingRequires(manifest, installed) {
  const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
  return requires.filter((dep) => !installed.includes(dep));
}

/**
 * Which INSTALLED modules would break if `id` were removed.
 *
 * The mirror of the above and the more dangerous direction: taking `api` out
 * from under an installed `courses` leaves an arrangement `loadModules()`
 * refuses — which is every command in the app, including `module list`,
 * including the one that would explain it.
 *
 * ⚠️ **A manifest that cannot be READ counts as a dependant.** "I could not
 * look" and "it does not depend on this" must not be the same answer, and of
 * the two directions to be wrong in, refusing to remove is the recoverable one.
 * `module check` is where a broken manifest gets diagnosed.
 *
 * @param {string} id
 * @param {string[]} installed
 * @param {string} [root]
 * @returns {string[]}
 */
export function dependantsOf(id, installed, root = ROOT) {
  return installed
    .filter((other) => other !== id)
    .filter((other) => {
      try {
        const { manifest } = readModule(other, root);
        const requires = Array.isArray(manifest.requires) ? manifest.requires : [];
        return requires.includes(id);
      } catch {
        return true;
      }
    });
}

/**
 * Read and validate one module's manifest.
 *
 * @param {string} id
 * @param {string} [root]
 * @returns {ModuleRecord}
 */
export function readModule(id, root = ROOT) {
  const dir = `modules/${id}`;
  const where = `${dir}/module.json`;
  const file = join(root, dir, "module.json");

  if (!existsSync(join(root, dir))) {
    // Deliberately does NOT claim where the id came from. This function is
    // called both for an installed module (where `config/modules.json` is the
    // source) and for an id somebody typed — `db-generate --module <id>` — and
    // a message that names the wrong source sends the reader to the wrong file.
    throw new Error(
      `There is no module "${id}": ${dir}/ does not exist.\n` +
        `  If config/modules.json lists it, an app is claiming a module it does not carry — ` +
        `a registry with a hole in it — so this is refused rather than skipped.\n` +
        `  Either restore the folder or take the id out of config/modules.json.`,
    );
  }
  if (!existsSync(file)) {
    throw new Error(`${dir}/ has no module.json — a module is its manifest first of all`);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${where} is not valid JSON: ${error.message}`);
  }

  const problems = manifestProblems(raw, where);
  if (problems.length > 0) {
    throw new Error(`${problems.length} problem(s) in ${where}:\n  ` + problems.join("\n  "));
  }
  if (raw.id !== id) {
    // The folder is the address every generated import uses; a manifest that
    // calls itself something else would have the registry importing one module
    // under another's name.
    throw new Error(
      `${where} declares id "${raw.id}" but sits in ${dir}/ — the folder name is the id`,
    );
  }

  return { id, dir, manifest: raw };
}

/**
 * The modules this app is made of, in the order `config/modules.json` lists
 * them, each one validated.
 *
 * ── Why `ids` can be passed in ─────────────────────────────────────────────
 * Everything in production calls this with one argument and gets the app's own
 * list. The second parameter exists for ONE caller —
 * `scripts/modules/profiles.test.ts` — and it is what makes the cross-module
 * checks below testable at all.
 *
 * Those checks are the only place a collision between two modules is refused,
 * and a fresh app has no modules: in the shipped state this function validates
 * a list of length zero, so every `clash()` below is dead code. The alternative
 * ways to exercise it were to install a module (which rewrites checked-in files
 * and cannot run inside a test) or to build a temporary tree of fake modules
 * (which measures the fakes, and did — the fixtures elsewhere in this folder use
 * ids like `"a"` and `"b"`). Handing in a list of ids reads the REAL manifests
 * off the REAL tree without touching `config/modules.json`.
 *
 * ⚠️ It is not a way to run an app on a list other than its own. Nothing that
 * generates or writes passes it: `writeGenerated()` goes through
 * `expectedGenerated(root)`, which leaves it undefined.
 *
 * @param {string} [root]
 * @param {string[]} [ids] which modules to load; defaults to the installed list
 * @returns {ModuleRecord[]}
 */
export function loadModules(root = ROOT, ids = installedModules(root)) {
  const installed = ids;
  const records = installed.map((id) => readModule(id, root));

  // Cross-module collisions. Each of these is invisible inside a single
  // manifest and fatal across two, which is why they are checked here rather
  // than in `manifestProblems()`.
  const clash = (what, keyOf) => {
    const seen = new Map();
    for (const record of records) {
      for (const key of keyOf(record)) {
        const other = seen.get(key);
        if (other) {
          throw new Error(
            `${what} "${key}" is claimed by both "${other}" and "${record.id}" — ` +
              `two modules cannot own the same one`,
          );
        }
        seen.set(key, record.id);
      }
    }
  };

  const list = (record, key) => {
    const value = record.manifest[key];
    return Array.isArray(value) ? value : [];
  };

  clash("a table", (r) => list(r, "tables"));
  clash("a route subtree", (r) => list(r, "app"));
  clash("a nav feature key", (r) => list(r, "features"));
  clash("a message namespace", (r) => {
    const messages = r.manifest.messages;
    return messages && typeof messages === "object" && Array.isArray(messages.namespaces)
      ? messages.namespaces
      : [];
  });
  clash("a command", (r) => {
    const commands = r.manifest.commands;
    return commands && typeof commands === "object" ? Object.keys(commands) : [];
  });
  // Job ids land in ONE flat `JOB_IDS` shared with the core, so two modules
  // claiming one would give `jobById()` a first match and silently never run the
  // other. `manifest.mjs` already requires a module's ids to start with its own,
  // which makes this unreachable between two well-formed manifests — and that is
  // the same relationship every other clash above has to its own field rule.
  clash("a scheduled job", (r) => list(r, "cronJobs"));
  // 🚨 Every declared component name becomes one `export` in ONE file,
  // `lib/modules/component-registry.ts`. Two modules claiming a name would emit
  // the same export twice, and TypeScript's message for that names the
  // GENERATED file — which the customer is told never to edit. Unlike the ids
  // above there is no field rule making this unreachable: a component name is
  // not prefixed with its module, deliberately, because `<ActivityPanel>` is
  // what an app writes on its page.
  clash("a component name", (r) => {
    const components = r.manifest.components;
    return components && typeof components === "object" ? Object.keys(components) : [];
  });
  // Same reasoning, other barrel — and across BOTH, because an app importing
  // `Foo` should not have to know which of the two it comes from.
  clash("an exported name", (r) => [
    ...Object.keys(r.manifest.components ?? {}),
    ...Object.keys(r.manifest.serverExports ?? {}),
  ]);

  // A module may only require another module that is also installed — otherwise
  // it is running against a half of itself it cannot see.
  for (const record of records) {
    for (const dep of list(record, "requires")) {
      if (!installed.includes(dep)) {
        throw new Error(
          `"${record.id}" requires "${dep}", which is not installed. ` +
            `Install it first, or take the dependency out of its manifest.`,
        );
      }
    }
  }

  return records;
}
