// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the session is told again after a context compaction.
//
// Claude Code fires `SessionStart` with the matcher `compact` AFTER the
// conversation was summarised, and adds this hook's stdout to the context. It
// exists because the summary keeps the work and drops the rules: measured
// 2026-09-15, twenty-three turns in the customer's language, then a compaction,
// then twelve English progress lines in a single turn.
//
// 🚨 Every line here is a RESTATEMENT of a rule that lives somewhere else, and
// a restatement ages the moment its source changes. So each entry names its
// source file and an ANCHOR — a phrase copied from that file — and
// `scripts/session-start.test.ts` reads the source and refuses a line whose
// anchor is gone. Change the rule, and this file goes red until the line
// follows; delete the rule, and the line cannot stay. That is the only way a
// copy is allowed to exist in this tree (CLAUDE.md → Rules: derive, do not
// restate — and where deriving is impossible, pin).

/**
 * @typedef {object} AfterCompactRule
 * @property {string} line    what the hook prints (without the leading "- ")
 * @property {string} source  the file the rule lives in, relative to the project root
 * @property {string} anchor  a phrase that file contains, verbatim (whitespace-insensitive)
 */

/** @type {readonly AfterCompactRule[]} */
export const AFTER_COMPACT_RULES = Object.freeze([
  {
    line: "Every line the customer reads is in THEIR language — the plan, every progress line in between, and the hand-back.",
    source: "CLAUDE.md",
    anchor: "Every line the customer reads is in THEIR language",
  },
  {
    line: "\"Done\" is said in the words of somebody who reads no code: what they can now open or do, and what is still open.",
    source: "CLAUDE.md",
    anchor: "in the words of the person who does not read code",
  },
  {
    line: "File paths and function names come LAST, under their own line — never in the first paragraph.",
    source: ".claude/skills/build-app/references/stages.md",
    anchor: "Files and function names, if you name them at all, go under their own line",
  },
  {
    line: "A step that will take more than about two minutes is announced BEFORE it starts: what, roughly how long, what will be true afterwards.",
    source: ".claude/skills/build-app/references/stages.md",
    anchor: "A step that will take more than about two minutes is announced BEFORE it starts",
  },
  {
    line: "A stage hand-back names the address, the app is RUNNING, the app's name is set, and the stage is committed AND pushed.",
    source: ".claude/skills/build-app/references/stages.md",
    anchor: "Committed AND pushed",
  },
  {
    line: "Every function the app sells was opened once AS THE OWNER before the hand-back names it.",
    source: ".claude/skills/build-app/references/stages.md",
    anchor: "opened once AS THE OWNER",
  },
  {
    line: "No secret travels through the chat — never ask for a key, a token or a password here.",
    source: "docs/guidance.md",
    anchor: "A secret never travels through the conversation",
  },
  {
    line: "No technical word unexplained: the plain meaning goes into the sentence, in their language (docs/glossary.md).",
    source: "docs/guidance.md",
    anchor: "No technical word arrives unexplained",
  },
  {
    line: "Questions come as ONE numbered bundle per turn, and \"you choose\" is a valid answer to each of them.",
    source: "docs/guidance.md",
    anchor: "Questions come in one announced bundle per turn",
  },
]);

/**
 * The customer's language, as `docs/app.md` records it (`- **Language:** German`)
 * — or null when the file or the line is missing (a fresh app, an app built
 * before the line existed). The template ships no app.md; the intake writes it.
 *
 * @param {string | null | undefined} appMd the file's text
 * @returns {string | null}
 */
export function customerLanguage(appMd) {
  // The label is whatever language the session wrote app.md in — measured
  // 2026-09-15: "- **Sprache:** Deutsch", and a parser that only knew
  // "Language" said nothing.
  const match = String(appMd ?? "").match(
    /^\s*-\s*\*\*(?:Language|Sprache|Idioma|Langue):\*\*\s*([^\n<]+?)\s*$/m,
  );
  if (!match) return null;
  const value = match[1].replace(/\s*—.*$/, "").trim();
  return value === "" ? null : value;
}

/**
 * The hook's whole stdout after a compaction — nothing else is said.
 *
 * The first line is the language rule; when `docs/app.md` names the language,
 * the line says it: "THEIR language" is a rule, "German" is a fact the model
 * cannot get wrong after its context was summarised away.
 *
 * @param {{ language?: string | null }} [options]
 */
export function afterCompactText({ language = null } = {}) {
  return [
    "[After compaction — these rules still apply]",
    ...AFTER_COMPACT_RULES.map((rule, i) =>
      i === 0 && language
        ? `- ${rule.line} Here that language is ${language} (docs/app.md → Language).`
        : `- ${rule.line}`,
    ),
  ].join("\n");
}
