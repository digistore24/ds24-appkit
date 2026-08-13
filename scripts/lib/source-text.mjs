// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading source code as TEXT, without punishing a file for explaining itself.
//
// A dozen checks in this project work by walking the tree and looking for a
// needle: a forbidden tool (`scripts/portability.test.ts`), a `sql<Date>`
// (`db/sql-cast.test.ts`), a hard-coded colour (`scripts/ux/rules.mjs`), a module
// name in a core file (`modules/boundary.test.ts`), a DM table outside its
// allowlist. Every one of them has to blank the comments first, or the file that
// DOCUMENTS the rule is reported as breaking it.
//
// ── Why this file exists: sixteen copies, and they were not the same ───────
// That rule was known and applied sixteen times, once per checker, and the
// copies had drifted into four different behaviours. One of them carried a
// measured bug fix that the other five blanking variants did not — so three
// checks were silently able to swallow arbitrary amounts of code:
//
// 🚨 **Line comments must be blanked BEFORE block comments.** A `//` comment
// containing `/*` — and 39 files in this tree have one, because
// `` `messages/*.json` `` is a natural thing to write — opens a PHANTOM BLOCK
// that runs to the next real `*/`, usually the end of the next JSDoc. Everything
// in between is invisible to the checker.
//
// Measured before this file existed, and this is the whole reason for it: a
// `sql<Date>` planted eighteen lines into `lib/digistore/purchase-notice.ts` —
// after its `` `messages/*.json` `` comment, before the next `*/` — left
// `db/sql-cast.test.ts` **passing**. The guard `CLAUDE.md` describes as the thing
// that "fails on it" did not, anywhere in 39 files' worth of the tree.
// `scripts/portability.test.ts` and `scripts/ux/rules.mjs` had the same hole, and
// the last one ships: it is `node run.mjs ux-check` in the customer's app.
//
// `scripts/core/purity.test.ts` had found it and fixed it locally, with the
// reason in a comment. That is what a fix looks like when there is nowhere to put
// it — hence this file.
//
// ── Blanking, never stripping ─────────────────────────────────────────────
// Comment content is replaced with SPACES, keeping every newline. So line numbers
// survive, which `ux-check` reports to a customer and `portability.test.ts` uses
// to name a finding; and a needle cannot be created by two lines becoming
// adjacent. Callers that only ask `includes()` cannot tell the difference.

/**
 * The source with every comment blanked out.
 *
 * @param {string} source
 * @returns {string} same length, same lines, comments turned to spaces
 */
export function blankComments(source) {
  return (
    source
      // ── 1. line comments, FIRST — see the header ──────────────────────────
      //
      // The guard excludes two characters before the `//`, for the same reason
      // in both cases: blanking from a `//` that is not a comment eats the rest
      // of a line that may hold the needle.
      //
      //  · `:` keeps `https://…` intact.
      //  · `\` keeps a REGEX LITERAL intact, and that one was measured. A regex
      //    ending in an escaped slash puts two slashes side by side — the escape
      //    and the closing delimiter — so `/^https?:\/\//i` looked like a comment
      //    from its own last `\/` onward and `i.test(base)) return [];` vanished
      //    from the checker's view. Thirty-one lines in this tree, including every
      //    file that spells a comment-stripping regex out.
      //
      // The guard consumes one character, so it is put back. A `//` that really
      // is a comment is never preceded by a backslash; a later one on the same
      // line is still found, because the scan continues past a failed position.
      .replace(/(^|[^:\\])\/\/[^\n]*/gm, (match, before) =>
        before + " ".repeat(match.length - before.length),
      )
      // ── 2. block comments ─────────────────────────────────────────────────
      //
      // Non-greedy, so two blocks on one line do not merge. JSX's `{/* … */}`
      // needs no rule of its own: the braces left behind are not a needle any
      // checker here looks for, and blanking their contents is the whole job.
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
  );
}

/**
 * Does the match at `index` sit inside a string LITERAL rather than in code?
 *
 * 🚨 **For the checkers whose needle is a piece of CODE that a string may
 * legitimately quote.** `lib/ai/providers/leak-guard.test.ts` hunts
 * `process.env.OPENAI_API_KEY`; an assertion message or a test fixture that
 * NAMES that read — and this tree has eight such lines in six files today, with
 * other variables (three in `scripts/lib/env.test.ts` alone, one in
 * `scripts/security/rungs.test.ts`) — is a mention, not a read. Blanking the
 * comments is not enough for those.
 *
 * ⚠️ **This exists instead of a `blankStrings()`, and the reason is a measured
 * one: blanking strings would make that guard SILENT.** The dynamic form
 * `process.env["OPENAI_API_KEY"]` is a real read whose variable NAME lives
 * inside a string, and every checker that hunts an env read covers it. Blank
 * the string and the read disappears; ask instead where the match STARTS and
 * the two separate cleanly, because a real read starts at `process`, outside
 * the quote, and a quoted mention starts inside it.
 *
 * Two properties on purpose:
 *
 *  · **It answers per LINE.** A `'` or `"` cannot span one, and a template
 *    literal that does is answered `false` — reported rather than excused.
 *  · **The quote has to CLOSE after the match on the same line.** A regex
 *    literal such as `` /["']/ `` opens a quote that never closes; without
 *    this, everything after it on that line would count as string and a real
 *    read there would go unseen. Both rules push the doubtful case towards
 *    REPORTING, which is the direction a guard may fail in.
 *
 * Comments are not its job — run `blankComments()` first.
 *
 * @param {string} source
 * @param {number} index offset of the match inside `source`
 * @returns {boolean} true when the match is a mention inside a string literal
 */
export function isQuotedMention(source, index) {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;

  let quote = null;
  for (let i = lineStart; i < index; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    }
  }
  if (quote === null) return false;

  const lineEnd = source.indexOf("\n", index);
  const rest = source.slice(index, lineEnd === -1 ? source.length : lineEnd);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "\\") i += 1;
    else if (rest[i] === quote) return true;
  }
  return false;
}

/**
 * The source with comments AND emitted-source strings blanked.
 *
 * 🚨 For checkers that walk files which GENERATE code. `scripts/modules/generate.mjs`
 * emits lines like `'import type { ModuleEntry } from "./types";'` and
 * `` `import ${alias} from "@/${dir}/${file}";` ``; a scanner reading those as the
 * file's own imports goes looking for `scripts/modules/types` (it threw exactly
 * that `ENOENT`) and reports `@/${record.dir}/…` as an npm package.
 *
 * It is the same rule as blanking comments, one step further: a text scanner must
 * not punish a file for CONTAINING code any more than for explaining itself.
 *
 * ⚠️ **Double quotes are deliberately left alone.** Import specifiers in this
 * project are double-quoted and the emitted code above is wrapped in the other
 * two kinds, which is exactly what makes them separable. A caller that needs
 * double-quoted strings blanked too wants a parser, not this.
 *
 * @param {string} source
 * @returns {string}
 */
export function blankEmittedCode(source) {
  return (
    blankComments(source)
      // Single-quoted: no newline inside, so it cannot run away.
      .replace(/'(?:[^'\\\n]|\\.)*'/g, (s) => `'${" ".repeat(Math.max(0, s.length - 2))}'`)
      // Template literals: `${…}` holding another backtick would defeat this, and
      // nothing in `scripts/` has one. Newlines are preserved, as everywhere here.
      .replace(/`(?:[^`\\]|\\.)*`/g, (s) => `\`${s.slice(1, -1).replace(/[^\n]/g, " ")}\``)
  );
}
