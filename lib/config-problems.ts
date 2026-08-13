// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one check every `config/*.json` in this app makes, in one place.
//
// Six subsystems read a JSON file with an `enabled` switch and answer a list of
// problems with it — impersonation, the AI chat, notifications, the community,
// the API module, and the setup surface's own shape reader. Five of them held
// this three-line block **verbatim**, including the sentence:
//
//     if (file.enabled !== undefined && typeof file.enabled !== "boolean") {
//       problems.push('"enabled" must be true or false');
//     }
//
// ⚠️ **What is shared here is the SENTENCE, and that is the reason to extract
// it.** The rest of a config reader is not: which keys are known, what an
// unknown one costs, and which way a doubt falls are decisions each subsystem
// makes for itself — `lib/setup/config.ts` switches the whole surface off on any
// doubt because its failure mode is an open write endpoint, while
// `lib/notify/config.ts` does not. A shared base class would flatten that, and
// this file deliberately is not one.
//
// This string reaches an operator who mistyped something, out of
// `node run.mjs setup-check`, the module diagnosis pages and `module list`. Five
// copies of it is five chances to end up with two vocabularies for one mistake.
//
// 🚨 **Pure, and it stays pure.** `modules/community/lib/config.ts` is imported
// by client components and its own header calls that load-bearing, so anything
// this file imported would be bundled for the browser. It imports nothing.
//
// ── And no scanner refuses a sixth copy, deliberately ──────────────────────
// `blankComments()`, `resolveImport()` and `flagsFrom()` each carry a test that
// refuses another copy of themselves. This one does not, and the reason is a
// measurement rather than a shrug: after the five adoptions the sentence still
// appears three more times, and every one of them is legitimate.
//
//   · `lib/setup/config-shape.mjs` and `modules/api/check.mjs` are bare-Node
//     `.mjs` — they cannot import a `.ts` at all (docs/conventions.md → *A
//     `.mjs` beside a `.ts`*), so a rule pointing them here would be a rule
//     they cannot obey.
//   · `modules/courses/lib/config.ts` says MORE — it echoes the offending value
//     back (`…, not ${JSON.stringify(f.enabled)}`), which is a better message
//     and not this function.
//
// A scanner would therefore open with three findings it could not act on, and
// `CLAUDE.md`'s own account of `factory-skills-lint.mjs` says what happens to a
// linter that opens with a wall: somebody switches it off, and the intent goes
// with it. So the guard here is the import itself.

/**
 * The problem with a file's `enabled` key, or `null` when there is none.
 *
 * Absent is not a problem: every one of these switches has a documented
 * default, and a config that simply does not mention the key takes it.
 */
export function enabledProblem(file: { enabled?: unknown }): string | null {
  if (file.enabled !== undefined && typeof file.enabled !== "boolean") {
    return '"enabled" must be true or false';
  }
  return null;
}

/**
 * Push that problem onto a reader's list, if there is one.
 *
 * The shape the five call sites actually had, so adopting this is one line
 * replacing three rather than a restructure of the function around it.
 */
export function pushEnabledProblem(
  problems: string[],
  file: { enabled?: unknown },
): void {
  const problem = enabledProblem(file);
  if (problem) problems.push(problem);
}
