// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Is this a module this app could install — asked BEFORE a byte of it is
// written into the tree.
//
// ── Why this is mostly not new code ─────────────────────────────────────────
//
// The conformance suite for a module already exists and it is `npm run test`:
// `privacy.test.ts`, `messages.test.ts`, `components.test.ts`,
// `account-notes.test.ts`, `page-extensions.test.ts`, `profiles.test.ts`,
// `presence-purity.test.ts` and `modules/boundary.test.ts` all walk
// `availableModules()` — the TREE, installed or not. `boundary.test.ts` says
// why in as many words: *"A module that would put the database in front of
// every request is worth knowing about BEFORE `module add`, not after."*
//
// So this file does not re-implement any of that. It answers the narrower
// question those tests cannot: is this thing installable AT ALL, from a folder
// that is not in the tree yet — and it reuses `manifestProblems()` and
// `crossModuleProblems()` rather than holding a second opinion about either.
//
// 🚨 **What it does NOT establish, and says so in its own output.** It reads
// shape, paths and names. It does not read intent, it does not run the module,
// it does not typecheck. `npm run test` after the install is the full answer,
// and a caller that prints "verified" without that sentence is claiming
// something this file cannot support.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { blankComments } from "../lib/source-text.mjs";
import { isOwnSpecifier } from "../lib/import-graph.mjs";
import { manifestProblems } from "./manifest.mjs";
import { availableModules, crossModuleProblems, readModule, templateTooOld } from "./registry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Manifest keys whose value is one path inside the module.
 *
 * ⚠️ Kept beside `manifest.mjs`'s own list on purpose and NOT imported from it:
 * that one answers *may this path be here*, this one answers *is anything
 * there*. They happen to hold the same names today and they are two questions —
 * a key could legally be shapeless and still have to exist.
 */
const FILE_KEYS = [
  "schema", "migrations", "nav", "gate", "entry", "smoke", "configDefault",
  "disclosure", "cron", "appliers", "setup", "presence", "contentSource",
];

/** Every path the manifest promises, as `[whatDeclaredIt, relativePath]`. */
function declaredPaths(manifest) {
  const out = [];
  for (const key of FILE_KEYS) {
    if (typeof manifest[key] === "string") out.push([`"${key}"`, manifest[key]]);
  }
  for (const key of ["slots", "components", "serverExports"]) {
    const group = manifest[key];
    if (!group || typeof group !== "object") continue;
    for (const [name, file] of Object.entries(group)) {
      if (typeof file === "string") out.push([`"${key}"."${name}"`, file]);
    }
  }
  const commands = manifest.commands;
  if (commands && typeof commands === "object") {
    for (const [name, spec] of Object.entries(commands)) {
      if (spec && typeof spec === "object" && typeof spec.script === "string") {
        out.push([`"commands"."${name}"`, spec.script]);
      }
    }
  }
  const privacy = manifest.privacy;
  if (privacy && typeof privacy === "object") {
    for (const half of ["ts", "mjs"]) {
      if (typeof privacy[half] === "string") out.push([`"privacy"."${half}"`, privacy[half]]);
    }
  }
  const messages = manifest.messages;
  if (messages && typeof messages === "object" && typeof messages.dir === "string") {
    out.push(['"messages"."dir"', messages.dir]);
  }
  const errorCodes = manifest.errorCodes;
  if (errorCodes && typeof errorCodes === "object" && typeof errorCodes.source === "string") {
    out.push(['"errorCodes"."source"', errorCodes.source]);
  }
  for (const file of Array.isArray(manifest.coreExport) ? manifest.coreExport : []) {
    if (typeof file === "string") out.push(['"coreExport"', file]);
  }
  return out;
}

/** Every `.ts`/`.tsx`/`.mjs` file under `dir`, absolute. */
function sourceFiles(dir) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(entry)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * An import specifier, and ONLY where the line really is an import.
 *
 * ⚠️ A bare `/from\s+"([^"]+)"/` over a whole file is not this question, and it
 * was measured saying so: run against `modules/community`, it reported the app
 * depending on packages called `" + "` and `\.\` — matches out of the middle of
 * string literals in the module's own tests, where an assertion happens to
 * contain the word `from` before a quote. So the match is anchored to the start
 * of a line, which is where every import in this tree begins; the `}` form is
 * the second line of a multi-line one.
 */
const IMPORT_FORMS = [
  // `import x from "y"`, `import { a, b } from "y"`, `import type { T } from "y"`.
  // The middle excludes quotes, so a string literal can never be crossed.
  /^\s*import\s(?:[^"';]*?\s)?from\s+"([^"]+)"/,
  // `export { a } from "y"`, `export * from "y"`, `export * as ns from "y"`.
  // Spelled out rather than `export.*from`, which also matches
  // `export const sql = \`select from "left-pad"\`` — measured, in this file's
  // own tests.
  /^\s*export\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+"([^"]+)"/,
  // The closing line of a multi-line import.
  /^\s*\}\s*from\s+"([^"]+)"/,
  // `import "y"` for its side effects.
  /^\s*import\s+"([^"]+)"/,
];

/** Bare npm specifiers this module imports, deduplicated. */
function npmImports(dir) {
  const packages = new Set();
  for (const file of sourceFiles(dir)) {
    // A checker that reads source as TEXT goes through blankComments() — a file
    // that EXPLAINS an import it does not make must not be punished for it.
    const code = blankComments(readFileSync(file, "utf8"));
    for (const line of code.split(/\r?\n/)) {
      let match = null;
      for (const form of IMPORT_FORMS) {
        match = form.exec(line);
        if (match) break;
      }
      if (!match) continue;
      const specifier = match[1];
      if (isOwnSpecifier(specifier) || specifier.startsWith("node:")) continue;
      // `@scope/pkg/deep` and `pkg/deep` both belong to the package, not to the
      // subpath — `npm ls` would be asked about the former.
      const parts = specifier.split("/");
      packages.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  }
  return [...packages].sort();
}

/**
 * Everything wrong with a candidate module — empty when this app could install it.
 *
 * @param {object} options
 * @param {string} options.id           the id its manifest claims
 * @param {string} options.dir          absolute path of the candidate's folder
 * @param {string} [options.root]       the app root it would go into
 * @returns {string[]}
 */
export function verifyProblems({ id, dir, root = ROOT }) {
  const problems = [];
  const where = `${id}/module.json`;

  const file = join(dir, "module.json");
  if (!existsSync(file)) return [`${dir} has no module.json — a module is its manifest first of all`];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return [`${where} is not valid JSON: ${error.message}`];
  }

  problems.push(...manifestProblems(manifest, where));
  if (manifest.id !== id) {
    problems.push(`${where}: says "${manifest.id}" but was read as "${id}"`);
  }

  const tooOld = templateTooOld(manifest, root);
  if (tooOld) problems.push(`${where}: ${tooOld}`);

  // 🚨 The highest-value check here, and the one nothing else makes.
  // `manifestProblems()` is PURE — it can say a path looks like a path and can
  // never say anything is at the end of it. `manifest.test.ts` already argues
  // this for `docs`, in as many words: *"A pointer `module list` prints is
  // worse than no pointer at all when it dangles."* The same holds for every
  // other file a manifest names, and for an archive somebody unpacked over a
  // slow connection it is the difference between a refusal here and a build
  // error three commands later.
  for (const [what, rel] of declaredPaths(manifest)) {
    if (!existsSync(join(dir, rel))) {
      problems.push(`${where}: ${what} names ${rel}, which is not in the module`);
    }
  }
  // `docs` is the one declared path that may point OUT of the module — into the
  // core tree, where our own five keep theirs. Resolved against the right root
  // for whichever form it took.
  if (typeof manifest.docs === "string") {
    const inModule = manifest.docs.startsWith(`modules/${id}/`);
    const at = inModule
      ? join(dir, manifest.docs.slice(`modules/${id}/`.length))
      : join(root, manifest.docs);
    if (!existsSync(at)) {
      problems.push(`${where}: "docs" names ${manifest.docs}, and there is nothing there`);
    }
  }

  // 🚨 Against every module PRESENT in the tree, not merely the installed ones.
  //
  // `config/modules.json` ships EMPTY, so asking the installed set would make
  // this check vacuous in exactly the app a customer starts from — measured,
  // in this file's own tests: a candidate claiming `community_posts` came back
  // clean. And the weaker question is the wrong one anyway. All five of our
  // modules sit in every app whether or not anybody installed them, so a
  // candidate that collides with a dormant one is not free — it is a refusal
  // waiting for the day somebody runs `module add community`, by which time the
  // foreign module has tables of its own and cannot simply be taken out.
  //
  // Same reasoning the suite's own module checks give for walking
  // `availableModules()` rather than the installed list.
  const others = availableModules(root)
    .filter((other) => other !== id)
    .map((other) => {
      try {
        return readModule(other, root);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  problems.push(
    ...crossModuleProblems([...others, { id, dir: `modules/${id}`, manifest }]),
  );

  // ⚠️ `npm ci` on the host installs `package.json` and nothing else. A module
  // importing a package nobody added is a deploy that dies on the host with a
  // resolution error, long after every gate here was green.
  let dependencies = {};
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    // No package.json to compare against is not this check's failure to report.
  }
  const missing = npmImports(dir).filter((name) => !(name in dependencies));
  if (missing.length > 0) {
    problems.push(
      `${where}: imports ${missing.map((n) => `"${n}"`).join(", ")}, which this app does ` +
        `not depend on. \`npm ci\` on a host installs package.json and nothing else, so this ` +
        `would build here and die there. Add them with npm install and commit package.json, ` +
        `or ask for a build that does without them.`,
    );
  }

  return problems;
}
