// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 9 — text that is in the tree and cannot be seen.
//
// The question is narrow on purpose: **does a file git tracks contain a
// character that renders as nothing and reads as something?** Bidirectional
// overrides, Unicode tag characters, runs of zero-width. Not "is this app
// resistant to prompt injection" — a static scan cannot ask that, because the
// attack arrives in a request. What it CAN ask is whether the payload is
// already sitting in the files, and that is the half nothing else here covers.
//
//   the file list   `git ls-files -z --cached`  — tracked files PLUS anything
//                                                 newly staged
//   the content     what is on disk right now
//   the rules       `../invisible.mjs`, pure and measured against this tree
//
// ── Why it is worth a rung of its own ──────────────────────────────────────
//
// Three doors in this template write somebody else's text into files an agent
// then reads as instruction — `module add --from`, `node run.mjs update`, and
// the corpus the skill `knowledge-intake` distils into `content/knowledge/`,
// which `lib/ai/retriever.ts` puts into the model's cacheable system block.
// A review is the control on all three, and a review is exactly what this class
// of character defeats. The reasoning in full, and what was measured and left
// off, is in `../invisible.mjs`.
//
// ── 🚨 No fallback to walking the tree ─────────────────────────────────────
//
// Same refusal as the secrets rung one file over, for the same reason: without
// git there is no way to tell a tracked file from `node_modules`, a build
// output or somebody's scratch folder, and a scan of the wrong set of files
// reported as an answer is worse than an honest skip. So: `skipped`, with the
// reason, and the `covers` sentence saying what nobody therefore looked at.
//
// ── What it does NOT look at, said out loud ────────────────────────────────
//
// Code COMMENTS and TEST files, for every rule except the tag characters. Both
// exclusions are measured rather than assumed — this template ships three test
// files that plant these characters because rejecting them is what they assert,
// and two comments that carry one to illustrate the attack they describe. A
// rule that reported those would open with a wall of findings against the files
// whose job is to be about it, and a check that opens with a wall is one
// somebody switches off. The class with no legitimate use anywhere — the tag
// block — is scanned with no exception at all, which is what keeps the
// exclusion from being a hole somebody can aim at. The evidence line says all
// of this on every run, so it is never discovered by surprise.
//
// ── What it buys, measured ─────────────────────────────────────────────────
//
// A bidirectional override planted inside a real string literal in
// `lib/roles.ts` — `"/admin<U+202E>/safe"`, which renders as its own opposite:
//
//   npm run typecheck ......................... clean
//   the whole vitest suite, minus this rung's . 7644 green
//   ../invisible.test.ts ...................... RED (the tree walk)
//   this rung ................................. FOUND, ❌ HIGH, lib/roles.ts:51
//
// That is the argument for the rung rather than for a test alone: the test half
// guards THIS tree and fails a commit, and the rung is what answers the same
// question about a tree the test was never written against — a module that
// arrived from a stranger, a guidance file that arrived over the network.
// Measured on a clean checkout at template 0.32.0; the whole walk is 1353 files
// in ~140 ms, so it costs nothing worth naming in a ladder that asks a network.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. git is
// started through `capture()`, never a shell; the file list is split on `\0`
// rather than on a newline (a path may contain one). There is no `try/catch` of
// its own: `check.mjs` already turns anything a rung throws into that rung's
// skip carrying the message.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { capture } from "../../lib/proc.mjs";
import { blankCommentsFor } from "../../lib/source-text.mjs";
import { SOURCE, invisibleRuleFor, scanInvisible } from "../invisible.mjs";
// ⚠️ Two pure helpers, imported rather than copied. They are about GIT and not
// about either rung's subject, and this project counts copies of exactly this
// shape — `splitNul` is the NUL split every file list in the tree owes, and
// `skipReason` is the sentence a missing git turns into. Importing a function
// is not a dependency on another rung's RESULT: no rung reads another's outcome
// and this one does not either.
import { skipReason, splitNul } from "./secrets.mjs";

/** Bigger than this and it is not a file anybody reads or a model is given. */
const MAX_BYTES = 512 * 1024;

/** How much of a file is probed for a NUL byte before it is called binary. */
const BINARY_PROBE = 8 * 1024;

/** At most this many line numbers travel into one finding's evidence. */
const LINES_SHOWN = 6;

/**
 * A tracked file's text, or why it was not read.
 *
 * Deliberately identical in shape to the secrets rung's reader, including the
 * three reasons it distinguishes: "it is a picture" and "it vanished between
 * the listing and the read" are not the same fact, and a scanner that counts
 * them together cannot tell a quiet tree from a broken one.
 *
 * @param {string} file
 * @returns {{text: string|null, why: "binary"|"oversized"|"unreadable"|null}}
 */
function textOf(file) {
  try {
    if (statSync(file).size > MAX_BYTES) return { text: null, why: "oversized" };
    const bytes = readFileSync(file);
    if (bytes.subarray(0, BINARY_PROBE).includes(0)) return { text: null, why: "binary" };
    return { text: bytes.toString("utf8"), why: null };
  } catch {
    return { text: null, why: "unreadable" };
  }
}

/** Worst severity wins when one file answers one rule on several lines. */
const RANK = ["critical", "high", "medium", "low"];
const worst = (a, b) => (RANK.indexOf(a) <= RANK.indexOf(b) ? a : b);

/**
 * Every row this file produced for one rule, as ONE finding.
 *
 * Grouped rather than reported per match, and that is the readable half of the
 * design: a payload is a run of characters on one line, and forty findings that
 * are one paste teach the reader to scroll. The count and the lines travel in
 * the evidence, so nothing is lost — `Where:` still points at the first one,
 * which is where the operator opens the file.
 *
 * 🚨 The evidence names the CODEPOINTS and never the surrounding text. That is
 * not the secrets rung's rule about not printing a value — an invisible
 * character has no value worth hiding — it is that the codepoint is the only
 * part a person can act on. A quoted line would print as though it were empty.
 *
 * @param {string} path
 * @param {string} ruleId
 * @param {{line: number, count: number, inComment: boolean, surface: string, severity: string}[]} rows
 * @returns {import("../rules.mjs").Finding}
 */
export function findingFrom(path, ruleId, rows) {
  const rule = invisibleRuleFor(ruleId);
  const lines = [...new Set(rows.map((row) => row.line))].sort((a, b) => a - b);
  const characters = rows.reduce((total, row) => total + row.count, 0);
  const severity = rows.map((row) => row.severity).reduce(worst);
  const inComment = rows.every((row) => row.inComment);
  const surface = rows[0]?.surface === "guidance" ? "guidance" : "code";

  const shown = lines.slice(0, LINES_SHOWN).join(", ");
  const more = lines.length > LINES_SHOWN ? `, and ${lines.length - LINES_SHOWN} more line(s)` : "";

  return {
    // Stable across an edit that moves the line, so accepting one in
    // `docs/reports/security-accepted.md` survives the next commit. Per FILE
    // and per RULE: accepting a bidi control in one translation file must not
    // quietly accept one somewhere else.
    id: `invisible:${ruleId}:${path}`,
    severity,
    title:
      `${rule?.label ?? ruleId} in ${surface === "guidance" ? "a file an agent reads as instruction" : "the code"}` +
      (inComment ? " — inside a comment" : ""),
    where: `${path}:${lines[0] ?? 1}`,
    why:
      (rule?.why ?? "It is a character with no visible width.") +
      (surface === "guidance"
        ? " This file is one an agent reads as INSTRUCTION at the start of a session, or " +
          "one a model is handed as knowledge — so what is written there is acted on rather " +
          "than merely displayed."
        : ""),
    fix: rule?.fix ?? "Delete it.",
    evidence:
      `${characters} character(s) of ${rule?.codepoints ?? ruleId} in ${path}, ` +
      `on line ${shown}${more}` +
      (inComment ? ", inside a code comment" : "") +
      ". The codepoints are named rather than quoted: the characters render as " +
      "nothing, so a quoted line would print as though it were empty.",
    source: SOURCE,
  };
}

/** @type {import("../rules.mjs").Rung} */
export const invisible = {
  id: "invisible-text",
  label: "Invisible characters in the tree",
  // Tier 1: git is here because the app was cloned with it, and the rules are
  // this repository's own. Nothing to install, no account, no key, no network.
  tier: 1,
  covers:
    "characters that render as nothing in the files git tracks — bidirectional overrides, " +
    "Unicode tag characters and runs of zero-width — NOT what somebody sends the app at " +
    "runtime, which no scan of the working tree can see",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();

    const listed = await capture("git", ["ls-files", "-z", "--cached"], { cwd });
    if (Number(listed.code) !== 0) {
      // 🚨 Deliberately no fallback to walking the tree — see the header.
      return { state: "skipped", reason: skipReason(listed), findings: [] };
    }
    const tracked = splitNul(listed.stdout);

    /** `path` → `ruleId` → rows, so one file answering one rule is one finding. */
    const byFile = new Map();
    let skippedFiles = 0;
    let unreadable = 0;
    let scanned = 0;

    for (const path of tracked) {
      const { text, why } = textOf(join(cwd, path));
      if (text === null) {
        if (why === "unreadable") unreadable += 1;
        else skippedFiles += 1;
        continue;
      }
      scanned += 1;
      // The path decides whether the comments are blanked, and only the caller
      // knows the path — `blankCommentsFor()` leaves markdown alone on purpose,
      // which is exactly right here: in a guidance file the prose IS the
      // surface an agent reads.
      const rows = scanInvisible(text, blankCommentsFor(path, text), { path });
      for (const row of rows) {
        if (!byFile.has(path)) byFile.set(path, new Map());
        const byRule = byFile.get(path);
        if (!byRule.has(row.ruleId)) byRule.set(row.ruleId, []);
        byRule.get(row.ruleId).push(row);
      }
    }

    const findings = [];
    for (const [path, byRule] of byFile) {
      for (const [ruleId, rows] of byRule) findings.push(findingFrom(path, ruleId, rows));
    }

    const skippedNote =
      `${skippedFiles} skipped as binary or oversized` +
      (unreadable > 0 ? `, ${unreadable} unreadable` : "");

    return {
      state: findings.length > 0 ? "found" : "clean",
      findings,
      evidence:
        `git ls-files --cached (${scanned} file(s) read, ${skippedNote}). ` +
        "🚨 Code COMMENTS and *.test.* files were NOT scanned for bidirectional " +
        "controls or zero-width characters — a test that proves a sanitiser works " +
        "has to plant the character it rejects, and a comment illustrating the " +
        "attack has to carry one. Unicode TAG characters are scanned everywhere, " +
        "with no exception, because nothing in a source tree has a legitimate " +
        "reason to hold one.",
    };
  },
};
