// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How a module's switch STANDS — the weakest true answer, on purpose.
//
// ── The failure this closes ────────────────────────────────────────────────
// `node run.mjs module list` is what `CLAUDE.md` points at for "what is this app
// made of", and it named every module's switch file without saying which way it
// pointed. Measured, on a real app: the community was installed, its registries
// were correct, its nav file was right — and the menu was empty, because
// `config/community.json` said `"enabled": false`, which is what it ships as.
// `module list` was the command run to diagnose that, and it could not.
//
// ── Why this does not re-implement `isCommunityEnabled()` ──────────────────
// 🚨 That objection is real and it is why this file answers a NARROWER question
// than the app does. A module's own reader is elaborate — `modules/community/lib/
// config.ts` is 373 lines of code, because any out-of-range value, wrong type or
// unknown key in that file switches the whole module off. A copy of it here
// would be a second answer to a question that already has one, and the day the
// two disagree is the day somebody is looking at this command to find out why.
//
// The way out is that the question is ASYMMETRIC. All three switch files share
// one rule — *anything but `true` counts as off, and so does a broken file* — so:
//
//   · `enabled` is not exactly `true`  → **off, with certainty.** No further
//     validation anywhere can turn that into on. The app's reader agrees by
//     construction, because it falls closed on every doubt this file has.
//   · `enabled` is `true`              → the FILE says on. Whether the module
//     then runs is the module's own reader's answer, and this never claims it.
//
// So every "off" here is exactly what the app decides, and "on" is reported as
// what it is — the switch's position, not a promise that the module runs. A
// strictly weaker claim cannot contradict the stronger one, which is the whole
// reason this is allowed to exist beside `isCommunityEnabled()` when a copy of
// it would not be.
//
// ⚠️ Nothing here reads a file — `raw` arrives, exactly as it does in
// `modules/companion/config.mjs`, and for the same reason: it is what makes the
// "no such file" case (`undefined`) something a test can hand in.

/**
 * @typedef {{ on: boolean, note: string | null }} SwitchState
 *   `note` says why, and only when the answer needs one: a plain `"enabled":
 *   false` is the ordinary case and gets none.
 */

/**
 * Which way a switch file points, from whatever was on disk.
 *
 * The `undefined` / `null` contract is `companionConfigFrom()`'s, deliberately:
 * `undefined` is "no such file", `null` is "the caller could not parse it".
 * Both are off, and both say so rather than passing for an ordinary `false` —
 * "I could not look" and "it is off" are the same colour on screen otherwise,
 * and this whole command exists to stop two states looking alike.
 *
 * @param {unknown} raw
 * @returns {SwitchState}
 */
export function switchStateFrom(raw) {
  if (raw === undefined) return { on: false, note: "no such file" };
  if (raw === null) return { on: false, note: "unreadable" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { on: false, note: "not an object" };
  if (!("enabled" in raw)) return { on: false, note: "no \"enabled\" key" };

  // ⚠️ Exactly `true`, never truthy. `"true"` and `1` are the two an operator
  // really types, and every reader in the app refuses both — a `Boolean(...)`
  // here would report on for a file the app treats as off, which is the one
  // direction this file may never fail in.
  if (raw.enabled !== true) return { on: false, note: null };

  return { on: true, note: null };
}

/**
 * The same state as one line for a terminal, hanging off the file name.
 *
 * ⚠️ `OFF` is shouted and `on` is not, and that asymmetry is the point rather
 * than decoration: off is the state that surprises people, because it is the one
 * a module ships in and the one that looks identical to not being installed.
 *
 * @param {string} file the switch's path, as the manifest names it
 * @param {SwitchState} state
 * @returns {string}
 */
export function switchLine(file, state) {
  if (state.on) return `switch: ${file} — on`;
  return state.note ? `switch: ${file} — OFF (${state.note})` : `switch: ${file} — OFF`;
}

/**
 * What an installed module with NO switch says instead.
 *
 * ⚠️ **Saying nothing is the bug this replaces.** A module that declares no
 * `config` has nothing to switch — `activity` contributes components INTO a
 * lesson somebody else already gates, so it has no route of its own to answer
 * 404 with and no position for an operator to hold. But every OTHER module
 * prints a `switch:` line here, and the guidance tells the reader to set the
 * switch after each `module add`; against that background the one module
 * without a line reads as a manifest somebody forgot to finish rather than as
 * a decision (reported 2026-08-12).
 *
 * It lives here rather than in `cli.mjs` for the reason the whole file exists:
 * `switch-state.test.ts` refuses a second wording of this state invented at the
 * call site.
 *
 * @returns {string}
 */
export function noSwitchLine() {
  return "no switch — live as soon as it is installed";
}
