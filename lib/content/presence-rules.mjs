// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Is a set of presence reports clean? — the judgement, computed exactly once.
//
// ── Why this file is `.mjs`, and why that is the whole point ───────────────
// 🚨 There are two readers of this answer, and they run in different worlds.
// Inside the app it is `lib/setup/tools.ts` → `content_presence`, bundled by
// Next, which puts the summary in its `detail` line and ships the reports on to
// whoever asked. Outside it is `node run.mjs content-check`
// (`scripts/content/check.mjs`), and **every `run.mjs` command in this template
// is bare Node with no bundler and no TypeScript** — a bare-Node command cannot
// import a `.ts` file at all.
//
// The answer is this file, not a second implementation. Re-spelling "what counts
// as a problem" in the command would ship the defect the whole presence design
// is written against: two definitions of clean that agree until the day one of
// them is edited, and then a go-live check says "nothing missing" about an
// environment its own report calls broken.
//
// It is the house pattern and not an invention — `lib/cron/rules.mjs` ←
// `lib/cron/scheduler.ts`, `lib/content-media/rules.mjs` ←
// `scripts/content/_manifest.mjs`, `modules/courses/lib/fingerprint.mjs` ←
// `modules/courses/lib/outline.ts`. One implementation, two readers;
// `lib/content/presence.ts` re-exports it so that every existing caller keeps
// its import.
//
// Keep it dependency-free and keep it pure: no `node:fs`, no `process.env`. It
// is imported by bare `node scripts/…` on all three systems and by vitest.

/**
 * One item of one owner's report, as far as the judgement reads it.
 *
 * The full contract — including `note` and `notChecked`, which are deliberately
 * NOT read here — is `PresenceItem` in `./presence.ts`.
 *
 * @typedef {object} JudgedItem
 * @property {string} what
 * @property {number} found
 * @property {number|null} expected
 * @property {readonly string[]} [missing]
 */

/**
 * One owner's report, as far as the judgement reads it.
 *
 * @typedef {object} JudgedReport
 * @property {string} owner
 * @property {readonly JudgedItem[]} items
 * @property {string} [unanswered]
 */

/**
 * Is the whole answer clean?
 *
 * Three ways to fail, and the first is the one this exists for: an owner that
 * could not answer. The others are a named missing item, and an item that knows
 * what it expected and found fewer.
 *
 * ⚠️ Still three. `note` and `notChecked` are read by the command that PRINTS
 * the answer and never here — a part of one item that could not be asked is not
 * a finding about the environment, and making it one would put a red cross on
 * every app whose bucket was briefly unreachable. What it must never be is
 * invisible, and that is the printer's job (`scripts/content/check.mjs`).
 *
 * @param {readonly JudgedReport[]} reports
 * @returns {string[]}
 */
export function presenceProblems(reports) {
  const problems = [];
  for (const report of reports) {
    if (report.unanswered) {
      problems.push(`${report.owner}: could not answer — ${report.unanswered}`);
      continue;
    }
    for (const item of report.items) {
      if (item.missing && item.missing.length > 0) {
        problems.push(`${report.owner}: ${item.what} — missing ${item.missing.join(", ")}`);
      } else if (item.expected !== null && item.found < item.expected) {
        problems.push(`${report.owner}: ${item.what} — ${item.found} of ${item.expected} present`);
      }
    }
  }
  return problems;
}
