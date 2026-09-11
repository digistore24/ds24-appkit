// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What may an export touch, and what must it leave alone?
//
// `node run.mjs export-core` copies the shared core (config/core-export.json)
// into a companion repo — typically a mobile app that talks to this app's
// `/api/v1`. Re-running it is how the companion follows the core, and the only
// difficult question about that is: has this file been changed THERE?
// `.core-version` in the target directory records a hash per file as written:
//
//   current === shipped   the consumer never touched it → safe to replace
//   current !== shipped   somebody edited it there → hands off, say so
//
// Getting that wrong in the permissive direction silently overwrites work in
// somebody else's repo. When in doubt this module refuses.
//
// Pure on purpose: no fetch, no fs, no clock. The shell around it is export.mjs.

/**
 * The text of a file, with the line endings taken out before it is hashed.
 *
 * A hash here answers one question — "is this file still the one that was
 * written?" — and the answer must not depend on how the file happens to sit
 * on a disk. Git for Windows checks out CRLF by default, and without this
 * every file in a Windows clone hashes differently from its entry in
 * `.core-version`; the export would then report the whole tree as edited and
 * write nothing, for ever. On Linux and macOS it is a no-op.
 */
export const normalizeText = (text) => String(text ?? "").replace(/\r\n/g, "\n");

/**
 * Decide what happens to every file the core offers, plus the ones it no
 * longer has.
 *
 * @param local   {path: {current: sha|null, shipped: sha|null}} — `current` is
 *                null when the file is not in the target.
 * @param remote  {path: sha} — the core as it is here.
 *
 * @returns entries `{ path, action, reason? }` with action one of:
 *   `new` | `update` | `unchanged` | `local-change` | `withdrawn`
 */
export function planExport({ local, remote }) {
  const plan = [];

  for (const [path, sha] of Object.entries(remote)) {
    const here = local[path] ?? { current: null, shipped: null };

    if (here.current === null) {
      plan.push({ path, action: "new" });
      continue;
    }
    if (here.current === sha) {
      plan.push({ path, action: "unchanged" });
      continue;
    }
    if (here.shipped === null || here.current !== here.shipped) {
      plan.push({
        path,
        action: "local-change",
        reason: here.shipped === null ? "not in .core-version" : "edited in the target",
      });
      continue;
    }
    plan.push({ path, action: "update" });
  }

  // Files the target has and the core no longer ships. Reported, never
  // deleted: it may be the one the companion still imports.
  for (const [path, here] of Object.entries(local)) {
    if (path in remote || here.current === null) continue;
    plan.push({ path, action: "withdrawn" });
  }

  return plan;
}

/** The paths an `--apply` would actually write. */
export function writable(plan) {
  return plan.filter((entry) => entry.action === "new" || entry.action === "update");
}

/**
 * Why a target directory is refused, or null when it is usable.
 *
 * Both arguments are ABSOLUTE, resolved paths — the shell resolves, this
 * decides. Refused: no target at all, the project itself, anything inside it.
 * An export into the app's own tree would shadow the originals and turn the
 * next `git status` into a riddle; the whole point is a SECOND repo.
 */
export function refuseTarget(targetAbs, projectRootAbs) {
  const target = String(targetAbs ?? "").trim();
  if (target === "") return "no target directory given";

  const root = String(projectRootAbs ?? "");
  if (target === root) return "the target is this app itself";

  // Path-segment-aware: `/x/app-mobile` is NOT inside `/x/app`.
  const rootWithSep = root.endsWith("/") || root.endsWith("\\") ? root : `${root}/`;
  if (target.startsWith(rootWithSep) || target.startsWith(`${root}\\`)) {
    return "the target is inside this app — export into a separate repo";
  }

  return null;
}

/**
 * The `.core-version` stamp for one export.
 *
 * No timestamp, deliberately: same input, same output. `version` is this
 * app's package.json version, so a
 * consumer (and a support question) can say which template state its core
 * came from.
 */
export function exportStamp({ version, files }) {
  return {
    source: "ds24-appkit shared core — written by `node run.mjs export-core`; see docs/mobile.md",
    version: String(version ?? "0.0.0"),
    files: { ...files },
  };
}
