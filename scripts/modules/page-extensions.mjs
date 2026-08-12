// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How a module's routes appear and disappear.
//
// Next requires route files to exist physically under `app/` — there is no
// runtime route registration. So a module's routes live there like everybody
// else's, but under a **module-suffixed name**:
//
//     app/dashboard/community/page.community.tsx   ← a route only when installed
//     app/dashboard/community/ui.tsx               ← never a route, always compiled
//     app/api/community/live/route.community.ts    ← the same for a handler
//
// Next matches a file against `page.<ext>` / `route.<ext>` for every ext in
// `pageExtensions`. With `community.tsx` in that list the suffixed file is a
// route; without it, Next sees no route in that folder at all — it creates
// none, bundles none, and the path answers a **real** 404 rather than a
// rewritten one.
//
// Measured on Next 16.2.11 before this was built, in both directions: with the
// suffix in `pageExtensions` the route exists, without it the build lists no
// such route at all. Pages and route handlers behave identically.
//
// ⚠️ **The suffix is not a naming convention, it is the switch.** Renaming
// `page.community.tsx` to `page.tsx` makes the route exist in every app,
// installed or not — and because the file compiles either way, nothing else
// would notice.

/** Extensions Next always treats as routes — the framework default. */
export const CORE_PAGE_EXTENSIONS = ["tsx", "ts"];

/**
 * `pageExtensions` for a given set of installed modules.
 *
 * Core first, so a plain `page.tsx` keeps winning and the list reads as
 * "the normal ones, plus whatever this app installed".
 *
 * @param {string[]} installed module ids, from `installedModules()`
 * @returns {string[]}
 */
export function modulePageExtensions(installed) {
  return [
    ...CORE_PAGE_EXTENSIONS,
    ...installed.flatMap((id) => CORE_PAGE_EXTENSIONS.map((ext) => `${id}.${ext}`)),
  ];
}
