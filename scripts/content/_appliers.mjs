// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which appliers exist. One enumeration, so nothing can report content as
// present that was never applied.
//
// 🚨 **One enumerator, because the two commands must never disagree about what
// exists.** `apply` runs them and `check` counts their rows; a file one sees
// and the other does not is an app that reports its content as present after a
// run that never touched it — the exact silence `docs/content.md` is written
// against. Each had its own private copy of this walk, hard-coded to
// `scripts/content/appliers`, so a module could contribute nothing at all.
//
// That mattered the moment content moved into a module. `docs/courses.md` calls
// the applier absolute — "a course built as hand-inserted local rows dies with
// the local database" — and a module that brings the tables has to be able to
// bring the thing that fills them, or its content reaches no environment but
// the one it was typed into.
//
// ⚠️ Bare Node on purpose, like everything else under `scripts/`: this runs
// before `npm install` in a fresh clone and must not import a package.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { loadModules } from "../modules/registry.mjs";

/**
 * The `.mjs` files in one directory, sorted, ignoring `_`-prefixed helpers.
 *
 * Sorted so a run's order is stable and reportable: an applier that inserts
 * rows another one references has to be able to rely on the order, and a
 * directory listing is not ordered by itself.
 *
 * 🚨 **A directory it cannot read is a REFUSAL, not an empty list.** This
 * function is the one enumeration both callers walk, so it owes both of them
 * one answer to "I could not look" — the ruling the module half below has made
 * all along, applied to the core's own folder too. It used to `return []` here,
 * which meant one cause (an unreadable directory) produced a loud failure on
 * one side of this function and a green tick on the other: an app whose
 * appliers were deleted, or whose built output never carried them, reported a
 * successful `content-apply` over nothing and a clean `content-check` after it.
 *
 * ⚠️ It refuses on EVERY error, `ENOENT` included — the missing-from-a-built-
 * output case is exactly `ENOENT`, so exempting it would leave a check that
 * cannot fire for the reason it was written. The code is printed rather than
 * branched on: it means the same thing on all three systems, and none of the
 * three deserves its own path.
 *
 * @param {string} dir the ABSOLUTE directory to read
 * @param {string} asked what it is, in the operator's words, for the refusal
 */
function filesIn(dir, asked) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    const code = error && error.code ? ` (${error.code})` : "";
    throw new Error(
      `Cannot read ${asked}. Looked at: ${dir}${code}. Content that cannot be applied is ` +
        `content that will not exist in PROD — see docs/content.md.`,
    );
  }
  return entries.filter((name) => name.endsWith(".mjs") && !name.startsWith("_")).sort();
}

/**
 * Every applier this app has, in the order they must run.
 *
 * The CORE's own first, then each installed module's in install order. The core
 * goes first because an app's own tables are what a module's content may point
 * at, never the other way round — a module cannot know about the app.
 *
 * A module's label carries its id (`courses:course.mjs`) so a run says which
 * applier it is talking about. The core's stays bare, because that is what it
 * has always printed and there is nothing to disambiguate it from.
 *
 * `ids` exists for the same one reason `loadModules`'s does: a fresh app has no
 * modules, so the module half of this walk is dead code in the shipped state
 * and a test has to be able to hand it a profile without installing anything.
 *
 * @param {string} root
 * @param {string[]} [ids]
 * @returns {{ label: string, file: string, module: string | null }[]}
 */
export function applierSources(root, ids) {
  const coreDir = join(root, "scripts", "content", "appliers");
  // The folder ships with every app — a `_README.md` holds it open, and that
  // file is invisible to the filter below twice over. So "it is not there" is
  // never the normal state of a fresh app; it is a defect, and it says so.
  const sources = filesIn(
    coreDir,
    "the app's own applier directory — scripts/content/appliers/ ships with every app, " +
      "so it was deleted here or this build did not carry it",
  ).map((name) => ({
    label: name,
    file: join(coreDir, name),
    module: null,
  }));

  for (const record of loadModules(root, ids)) {
    const declared = record.manifest.appliers;
    if (typeof declared !== "string") continue;
    // ⚠️ `record.dir` is RELATIVE to the root (`modules/<id>`) — it is written
    // for import specifiers, not for `fs`. Joining it without the root resolves
    // against the process's working directory, which is the same everywhere the
    // command is normally run from and wrong the moment anything runs it from
    // elsewhere.
    const dir = join(root, record.dir, declared);
    // The words are the caller's, the refusal is the enumerator's — so the
    // absent-directory case keeps naming the module and its declared path,
    // which is the diagnosis, while there is still only one place that decides
    // what an unreadable directory means.
    const names = filesIn(
      dir,
      `"${record.id}"'s applier directory — its manifest declares ${record.dir}/${declared}, ` +
        `so either that path is wrong or the folder never shipped`,
    );
    // 🚨 A declared directory that yields nothing is REFUSED, not skipped. A
    // typo in the path, or a folder that never got committed, would otherwise
    // produce exactly the state this seam exists to prevent: a module claiming
    // its content reaches an environment, `content-apply` finding nothing to
    // run, and the caller reading that as a clean pass. "I could not look"
    // and "there is nothing there" must not be the same answer — the same
    // ruling `module remove` makes about the database.
    if (names.length === 0) {
      throw new Error(
        `"${record.id}" declares appliers in ${record.dir}/${declared}, and there is no .mjs ` +
          `file there. Either the path is wrong or the folder never shipped — and content ` +
          `that cannot be applied is content that will not exist in PROD (docs/content.md).`,
      );
    }
    for (const name of names) {
      sources.push({
        label: `${record.id}:${name}`,
        file: join(dir, name),
        module: record.id,
      });
    }
  }

  return sources;
}
