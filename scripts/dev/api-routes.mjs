// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What counts as an API route of this app — the sibling of `./routes.mjs`,
// which answers the same question about PAGES.
//
// It exists because `smoke` had a hole it was honest about and could not close:
// the page walk skips every dynamic segment, because a `[id]` route is not
// callable without a real record. That is right for pages and it left
// `/api/media/[id]` — the route that decides whether a PRIVATE FILE is handed
// out — exercised by no run ever (Retro-Action A15).
//
// 🚨 **This walks; it does not list.** A file naming the routes it wants
// checked is a list somebody has to maintain, and the day it stops matching the
// tree is the day it starts reporting about an app that no longer exists — the
// failure `./routes.mjs` already carries the scar of. So the routes are derived
// from `app/api/` and from `config/modules.json`, and whoever adds a dynamic
// route gets it counted without touching anything here.
//
// Nothing here talks to a network, spawns a process or runs at import time.
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { installedModules } from "../modules/installed.mjs";
import { modulePageExtensions } from "../modules/page-extensions.mjs";

/**
 * The file names that ARE a route handler in this app.
 *
 * 🚨 Same switch as a module's pages, and for the same reason: a module's
 * handler is `route.<id>.ts`, and Next builds it exactly while the module is
 * installed (`scripts/modules/page-extensions.mjs`). So `app/api/v1/media/[id]`
 * is a route of an app that installed `api` and is no route at all in one that
 * did not — which is why this set is a function of `config/modules.json` and
 * never a constant.
 */
function routeNames(installed) {
  return modulePageExtensions(installed ?? installedModules()).map((ext) => `route.${ext}`);
}

function walk(dir, urlPath, names, found) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }

  if (names.some((name) => entries.includes(name))) found.push(urlPath);

  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("_")) continue;
    // A route group changes the folder, never the URL — the same rule pages
    // follow.
    if (entry.startsWith("(")) {
      walk(full, urlPath, names, found);
      continue;
    }
    walk(full, `${urlPath}/${entry}`, names, found);
  }
  return found;
}

/**
 * Every route handler this app serves, as URL patterns with their dynamic
 * segments still written the way the folder writes them (`/api/media/[id]`).
 *
 * Sorted and de-duplicated here rather than at the call site: unlike the page
 * walk there is no caller that wants the raw order, and two route groups
 * producing one URL is exactly as legitimate here as it is there.
 *
 * `installed` is the module list, and it is a PARAMETER only so that a test can
 * ask what an app with the `api` module installed would serve without editing
 * `config/modules.json` underneath a running tree. Left out, it is this app's
 * own — there is no second source for it.
 *
 * @param {{cwd?: string, installed?: string[]}} [options]
 * @returns {string[]}
 */
export function collectApiRoutes({ cwd = process.cwd(), installed } = {}) {
  return [...new Set(walk(join(cwd, "app", "api"), "/api", routeNames(installed), []))].sort();
}

/**
 * The ones with a dynamic segment — what `smoke`'s page sweep can never reach.
 *
 * `[id]`, `[...path]` and `[[...slug]]` all count: what they have in common is
 * that no sweep can call them without a real record behind the segment.
 *
 * @param {{cwd?: string, installed?: string[]}} [options]
 * @returns {string[]}
 */
export function collectDynamicApiRoutes(options) {
  return collectApiRoutes(options).filter((route) => route.includes("["));
}
