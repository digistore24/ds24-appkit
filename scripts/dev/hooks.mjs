// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Wiring the commit gate into this clone.
//
// Git hooks are not cloned — `.git/hooks/` is local to every checkout, which is
// why the hook itself lives in `.githooks/` (a normal, versioned folder) and
// this file only points git at it: `core.hooksPath`. One config value, set once
// per clone, on every system.
//
// It runs as a prerequisite of `setup` AND of `start`, because plenty of people
// only ever type `start` — a gate that depends on somebody having typed the
// right command is not a gate.
//
// Three things it refuses to do, and each one has cost somebody a day
// somewhere:
//
//  • **It never touches a foreign `core.hooksPath`.** A developer who points
//    their clone at their own hooks folder has decided something, and a setup
//    step is not the place to overrule it.
//  • **It only wires a repository whose ROOT is this folder.** An app sitting
//    inside somebody else's repository (a monorepo, or a `projects/` folder
//    that was git-inited years ago) would otherwise have `core.hooksPath`
//    written into THAT repository — where `.githooks` does not exist, and
//    where git then runs no hooks at all, silently switching off whatever the
//    owner had in `.git/hooks`. Doing nothing is the only safe answer there.
//  • **It says nothing when there is nothing to do.** This runs in front of
//    `start`; a line printed on every single start is a line nobody reads.
//  • **It never fails the command it is a prerequisite of.** No git, no
//    repository, a `git config` that errors — none of that is a reason to
//    refuse to start the app. It is a gate on committing, not on working.
import { resolve } from "node:path";
import { capture, isWindows } from "../lib/proc.mjs";

/** Where the hooks live, relative to the repository root. */
export const HOOKS_PATH = ".githooks";

/**
 * Is `top` (git's answer to `--show-toplevel`) this very folder?
 *
 * Compared after `resolve()`, so `/a/b` and `/a/b/` are one answer; on Windows
 * case-insensitively, because `C:\Apps` and `c:\apps` are the same folder there
 * and git and Node do not always spell it the same way.
 */
export function isRepoRoot(top, here) {
  if (!top) return false;
  const a = resolve(top.trim());
  const b = resolve(here);
  return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Decide what to do, given what git says. Pure — the whole point of the split,
 * because the interesting cases here are "somebody already has a hooks path"
 * and "this is not our repository at all", and neither is fun to set up for
 * real.
 *
 * @param isRoot   is this folder the ROOT of a git repository?
 * @param current  the configured `core.hooksPath`, "" when unset
 * @returns `"set"` | `"already"` | `"foreign"` | `"no-repo"`
 */
export function hookAction(isRoot, current) {
  if (!isRoot) return "no-repo";
  const configured = (current ?? "").trim();
  if (configured === "") return "set";
  // Both spellings mean this folder; git accepts either and people type both.
  if (configured === HOOKS_PATH || configured === `./${HOOKS_PATH}`) return "already";
  return "foreign";
}

/**
 * Point this clone's git at `.githooks`, unless somebody has other plans.
 *
 * Returns the action taken, so the caller (and the test) can see which branch
 * ran without reading the terminal.
 */
export async function wireCommitHook() {
  const probe = await capture("git", ["rev-parse", "--show-toplevel"]);
  // code 127 is "no git on this machine" — the same nothing-to-do as "no repo".
  const isRoot = probe.code === 0 && isRepoRoot(probe.stdout, process.cwd());
  const current = isRoot ? (await capture("git", ["config", "--get", "core.hooksPath"])).stdout : "";

  const action = hookAction(isRoot, current);
  if (action !== "set") return action;

  const { code } = await capture("git", ["config", "core.hooksPath", HOOKS_PATH]);
  if (code !== 0) return "no-repo"; // an unwritable config is not our emergency
  console.log(
    `✓ Commit gate wired (${HOOKS_PATH}): typecheck + tests run before a commit.\n` +
      "  A deliberate work-in-progress commit: git commit --no-verify",
  );
  return "set";
}
