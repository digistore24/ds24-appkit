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
      //
      // 🚨 **A RECURSIVE GLOB is not a comment, and it carries TWO false
      // openers** — one where the path's slash meets the two stars, one where
      // the stars meet the trailing `/` and the final star.
      //
      // `**/` is how every `outputFileTracingIncludes` entry, every
      // vitest pattern and every `tsconfig` include is written, and the plain
      // regex read both slashes in it as comment syntax. Measured 2026-08-15 on
      // `next.config.ts`: `"./content/knowledge-media/**/*"` came back
      // `"./content/knowledge-media    *"`, which turned the assertion that the
      // knowledge-media disk leg is traced into a standalone build RED on a tree
      // where it is traced. Same family as the phantom block above, in the other
      // direction: there a comment looked like data, here data looks like code.
      //
      // Two guards, and each is safe for its own reason rather than by
      // allowlist:
      //
      //  · `(?!\*\/)` — an EMPTY block (`/**/`) is left alone. It has no
      //    content, so a checker reading past one cannot find a needle in it;
      //    declining to blank it removes no protection, whatever a file writes.
      //  · `[^*]` before the opener — the second one. A real comment opener
      //    directly after a `*` means multiplication written against a comment
      //    with no space (`x*/* note */`), and the cost there is a comment left
      //    VISIBLE — the noisy direction, which somebody sees.
      //
      // The guard consumes one character, so it is put back, exactly as in the
      // line-comment rule above; and the blanking still goes character by
      // character so NEWLINES survive, which is what keeps a reported line
      // number pointing at the line it names.
      .replace(/(^|[^*])\/\*(?!\*\/)[\s\S]*?\*\//g, (match, before) =>
        before + match.slice(before.length).replace(/[^\n]/g, " "),
      )
  );
}

/**
 * The formats read here as PROSE or DATA rather than as code.
 *
 * Everything not listed is treated as code, and that direction is the decision:
 * a new code extension that nobody remembered to add would silently stop being
 * blanked, which is exactly the hole this module exists to close. A new DATA
 * format that nobody remembered gets blanked instead — and that shows up as a
 * red assertion over the text it damaged, which is a thing somebody can see.
 *
 * `example` is in the list for `.env.example`, whose extension is the last dot.
 */
const NOT_CODE = /\.(md|mdx|markdown|txt|json|ya?ml|toml|csv|html?|env|example)$/i;

/**
 * `blankComments()`, but only where the file IS code.
 *
 * 🚨 **For the checkers that read a MIXED corpus through one `read()`.** Six in
 * this tree do — `scripts/setup.test.ts` reads four `.md` files, `.env.example`,
 * `package.json` AND `lib/env-guard.ts`; `scripts/docs-coverage.test.ts` reads
 * every doc plus `run.mjs`. A blind wrapper there is wrong in both directions at
 * once: the source half keeps reporting a file for explaining itself, and the
 * markdown half gets its PROSE blanked — a doc that writes `http://` in a fenced
 * example, or spells a block comment out to teach it, loses the sentence the
 * assertion is about.
 *
 * So the question is asked per FILE, at the one place the path is still known.
 * Callers pass the same string they read: `read(rel)` becomes
 * `blankCommentsFor(rel, readFileSync(…))`, and nothing downstream changes.
 *
 * ⚠️ Markdown is not blanked at all, deliberately — not even inside a fenced
 * code block. A fence is a lexer's job, and a checker that needs one wants a
 * markdown parser rather than this. What it means in practice: an assertion
 * hunting a needle in a doc still sees every occurrence, which is what the docs
 * checks want, because in a doc the prose IS the subject.
 *
 * @param {string} file path or name of the file the source came from
 * @param {string} source
 * @returns {string} blanked when `file` is code, unchanged otherwise
 */
export function blankCommentsFor(file, source) {
  return NOT_CODE.test(file) ? source : blankComments(source);
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
