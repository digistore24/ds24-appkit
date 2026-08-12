// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What counts as a page of this app, in one place.
//
// This walk used to be a private function inside `scripts/dev/smoke.mjs`, and it
// could not be reused for a reason that had nothing to do with the walk: that
// file performs its whole sweep at module scope, so importing it RUNS a smoke
// test. A second caller — `scripts/security/rungs/live.mjs`, which asks what a
// stranger receives from every `/dashboard` route — therefore had exactly two
// options, and one of them was to write its own opinion about what a route is.
//
// 🚨 **This project has measured what a second opinion costs, twice.**
// `blankComments()` had sixteen copies in four behaviours and three of them were
// broken; `resolveImport()` had three copies answering two different questions,
// so two guarantees that said "transitively" covered relative paths only. A
// second route walker would be the next one, and its failure mode is the worst
// of the three: the sweep and the security rung would disagree about which pages
// exist, and the one that saw fewer would report green about them.
//
// Nothing here talks to a network, spawns a process or runs at import time.
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { installedModules } from "../modules/installed.mjs";
import { modulePageExtensions } from "../modules/page-extensions.mjs";

/**
 * The file names that ARE a page in this app.
 *
 * 🚨 A module's pages are named `page.<id>.tsx`, and that suffix is not a naming
 * convention — it IS the switch (`scripts/modules/page-extensions.mjs`). Next
 * builds such a file exactly while the module is installed, so the set of names
 * that count here is a function of `config/modules.json`, not a constant.
 *
 * ⚠️ **This sweep looked for `page.tsx` alone for one commit, and it silently
 * stopped covering nine pages.** The community's pages had been ordinary
 * `page.tsx` files and were swept every run; the move into `modules/community/`
 * renamed them and they left the sweep without a word — smoke went on reporting
 * "All 16 page(s) answer" about an app that had 25. Green because it checked and
 * green because it skipped are the same colour, which is the confusion the smoke
 * script exists to remove, so the names are derived rather than typed.
 */
function pageNames() {
  return modulePageExtensions(installedModules()).flatMap((ext) => [`page.${ext}`]);
}

/**
 * Collects the static routes from the app/ directory.
 *
 * Deliberately skipped:
 *   [param]  — dynamic segments; not sensibly callable without a real ID
 *   (group)  — route groups, which do not show up in the URL
 *   api/     — not pages; those have tests of their own
 */
function walk(dir, urlPath, names) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  if (entries.includes("page.jsx") || names.some((name) => entries.includes(name))) {
    found.push(urlPath === "" ? "/" : urlPath);
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === "api" || entry.startsWith("_")) continue;
    if (entry.startsWith("[")) continue; // dynamic — no real ID at hand
    if (entry.startsWith("(")) {
      found.push(...walk(full, urlPath, names)); // group: URL unchanged
      continue;
    }
    found.push(...walk(full, `${urlPath}/${entry}`, names));
  }
  return found;
}

/**
 * Every static page route this app serves, as URL paths.
 *
 * ⚠️ **Duplicates are not removed here, and neither is an empty answer refused.**
 * Two route groups can legitimately produce the same URL, and what to DO about a
 * tree with no pages in it is the caller's question: `smoke.mjs` treats it as
 * "you are not in the project root" and exits 1, while the live rung would be
 * saying something quite different. Both behaviours stayed with their caller
 * when the walk moved out, so this function answers exactly one question.
 *
 * `cwd` rather than `process.cwd()` at the point of use: the rung is handed the
 * project root by `check.mjs` and must not depend on where the command was run.
 *
 * @param {{cwd?: string}} [options]
 * @returns {string[]}
 */
export function collectPageRoutes({ cwd = process.cwd() } = {}) {
  return walk(join(cwd, "app"), "", pageNames());
}
