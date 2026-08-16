// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Characters a reviewer cannot see and a model can — the rules, pure.
//
// The shell that walks the tree is `./rungs/invisible.mjs`; everything here
// takes a string and returns rows, for the reason every rules file in this
// project is separate from its shell: a rule that lives inside the script that
// prints it is a rule nothing asserts. `./invisible.test.ts` plants each
// character and proves it is found with its line number, and reads this
// template's OWN tree off disk and proves it stays silent.
//
// ── Why this is a question for THIS app ────────────────────────────────────
//
// Three doors in this template carry text from a stranger into the tree an
// agent reads as instruction:
//
//   `node run.mjs module add --from https://…`  copies somebody else's module
//        in AS YOUR CODE — CLAUDE.md says so in as many words: it "runs with
//        your code's access although nobody read it".
//   `node run.mjs update`                       fetches guidance text and
//        writes it over `CLAUDE.md`, `docs/*.md` and `.claude/skills/**`.
//   the skill `knowledge-intake`                distils third-party ebooks,
//        webinars and transcripts into `content/knowledge/`, which
//        `lib/ai/retriever.ts` then puts in the model's CACHEABLE system block.
//
// A payload made of invisible codepoints survives all three, reads as nothing
// at all in a diff, and is the one class of text where "somebody reviewed it"
// is not evidence. That is the whole subject: not what an attacker sends at
// runtime — no static scan can see that — but what is sitting in the files
// already.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
//
// Injection PHRASES ("ignore previous instructions", "you are now in developer
// mode") were measured against this tree and left off, and the reason is worth
// keeping: `guardrails`, `security-gateway` and `docs/ai-chat.md` all describe
// those attacks in prose, so the rule opens with a wall of findings against the
// files whose job is to explain it. A check that opens with a wall is one
// somebody switches off, taking the intent with it. Base64 candidate matching
// (`[A-Za-z0-9+/]{20,}={0,2}`) is off for the same reason one measurement
// further on: lockfile integrity hashes and source maps answer it by the
// thousand. Homoglyphs are off because the honest form of that rule needs an
// explicit confusable table applied to identifiers only, and the naive form —
// "any non-ASCII" — reports every umlaut in a German app.
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md, "Three systems"). No filesystem and no process:
// this file is importable from a test, and one day from the app.

/** Which tool reported it — the `source` field of every finding this makes. */
export const SOURCE = "working tree";

// ── the character classes ───────────────────────────────────────────────────
//
// 🚨 Written as escapes, never as the characters themselves. A file whose
// subject is invisible text and which contains the literals is a file no
// reviewer can check and no `git diff` can show — and it would be found by its
// own rung, which is the shape of joke this project does not need.

/**
 * Unicode tag characters, U+E0000–U+E007F.
 *
 * They mirror ASCII invisibly, several models decode and follow them, and
 * nothing legitimate writes them into a source tree. The one real use is the
 * emoji tag sequence — a subdivision flag such as the Scottish one is U+1F3F4
 * followed by tag letters and U+E007F — and that is why `tagMatches()` below
 * looks at the character in front rather than treating the block as forbidden.
 */
const TAG_CHARS = /[\u{E0000}-\u{E007F}]+/gu;

/** The base an emoji tag sequence hangs off — U+1F3F4 WAVING BLACK FLAG. */
const TAG_BASE = "\u{1F3F4}";

/**
 * A byte-order mark, U+FEFF — the one position at which it is not a finding.
 *
 * At offset 0 it is the file's declared encoding and nothing else; anywhere
 * further in it is a zero-width no-break space wearing the same codepoint, and
 * `scanInvisible()` reports it. Named rather than inlined because the literal
 * character may not appear in this file at all (see the class header above).
 */
const BOM = "\uFEFF";

/**
 * Bidirectional overrides, embeddings and isolates.
 *
 * This is Trojan Source: the characters reorder how a line is DISPLAYED without
 * changing a byte of what the compiler, the model or the shell then reads. A
 * host, a path or a condition can be made to render as its own opposite.
 *
 * The isolates (U+2066–U+2069) are the modern, sanctioned mechanism for genuine
 * right-to-left text, so they are in the class rather than out of it and the
 * finding says so: an app that really ships Hebrew or Arabic strings judges it
 * once and accepts it, which is what the accepted register is for. Silence
 * would be the wrong direction — an override that nobody sees is exactly the
 * thing this rung exists for.
 */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu;

/**
 * The zero-width characters, as one class — used for the RUN rule only.
 *
 * U+200D (zero width joiner) is in here and out of the single-occurrence rule
 * below, and the split is the whole reason both rules exist. A single ZWJ is
 * how every composed emoji is built — the "technologist" glyph is a person, a
 * joiner and a laptop — so reporting one is reporting an emoji. Three in a row
 * is not an emoji.
 */
const ZERO_WIDTH_RUN = /[\u200B\u200C\u200D\u2060\u2063\uFEFF]{3,}/gu;

/**
 * A single zero-width character, with the two legitimate ones left out.
 *
 * U+200D and U+200C are joiners — emoji sequences and the joining behaviour of
 * Arabic and Indic scripts — and both occur singly in ordinary text. What is
 * left has no business inside a line: a zero-width space, a word joiner, an
 * invisible separator, or a byte-order mark anywhere except the very first
 * character of a file.
 */
const ZERO_WIDTH_ONE = /[\u200B\u2060\u2063\uFEFF]/gu;

// ── the rules ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} InvisibleRule
 * @property {string} id          stable; what an accepted entry is keyed on
 * @property {string} label       the finding's title, before the surface
 * @property {string} codepoints  printed in the evidence — the reader needs it
 * @property {{guidance: string, code: string}} severity  by surface, see below
 * @property {boolean} everywhere true = comments and test files included too
 * @property {string} why
 * @property {string} fix
 */

/**
 * The four rules, and the two axes every one of them is rated on.
 *
 * **Surface.** `guidance` is the text an agent reads AS INSTRUCTION — this
 * file's own `CLAUDE.md`, `docs/`, `.claude/skills/**`, and the corpus under
 * `content/`. A payload there is a standing order to every session of this app
 * for as long as nobody notices. `code` is everything else, where the same
 * character is a display trick against whoever reads the diff. One step apart,
 * deliberately: rating them the same is how an operator learns to scroll past
 * the whole report.
 *
 * **`everywhere`.** Only `tag-chars` is scanned inside code comments and inside
 * test files, and that asymmetry is measured rather than chosen. A test that
 * proves a sanitiser works has to PLANT the character it rejects — this
 * template has three such files today — and a comment illustrating an attack
 * has to contain it; one of them uses a zero-width space to stop a glob from
 * closing a block comment. So the classes a legitimate file has a reason to
 * carry are scanned where such a file is not, and the class that has NO
 * legitimate use in a source tree is scanned with no exception at all. What
 * that leaves unlooked-at is named in the rung's `covers` sentence and in its
 * evidence line rather than left to be discovered.
 *
 * @type {InvisibleRule[]}
 */
export const INVISIBLE_RULES = [
  {
    id: "tag-chars",
    label: "Unicode tag characters",
    codepoints: "U+E0000–U+E007F",
    severity: { guidance: "critical", code: "critical" },
    everywhere: true,
    why:
      "These mirror ASCII invisibly — a whole sentence of them renders as nothing " +
      "at all. Several models decode them and follow what they say, so a line of " +
      "them in a file an agent reads is an instruction nobody can see in a diff, " +
      "in a review, or on the page.",
    fix:
      "Delete them. Nothing in a source tree has a legitimate reason to carry one, " +
      "with the single exception of a subdivision flag emoji (U+1F3F4 followed by " +
      "tag letters), which this rule already leaves alone. If the file came from " +
      "somewhere else — a module added with `module add --from`, a fetched " +
      "guidance file — treat the whole file as unread and read it.",
  },
  {
    id: "bidi",
    label: "Bidirectional override",
    codepoints: "U+202A–U+202E, U+2066–U+2069",
    severity: { guidance: "critical", code: "high" },
    everywhere: false,
    why:
      "They reorder how a line is DISPLAYED without changing what is actually " +
      "read — the Trojan Source trick. A host, a path or a condition can be made " +
      "to render as its own opposite, so the reviewer and the runtime see two " +
      "different things.",
    fix:
      "Delete them, or replace the passage with plain text. Genuine right-to-left " +
      "content is the one honest reason to keep an isolate (U+2066–U+2069): judge " +
      "it once and write it into this app's register of accepted risks, " +
      "`docs/reports/security-accepted.md`, so the next run reads as a decision " +
      "rather than as a question nobody answered. A CRITICAL is never accepted — " +
      "in the guidance surface this one is CRITICAL, and there the answer is to " +
      "delete it.",
  },
  {
    id: "zero-width-run",
    label: "Run of zero-width characters",
    codepoints: "3 or more of U+200B, U+200C, U+200D, U+2060, U+2063, U+FEFF",
    severity: { guidance: "critical", code: "high" },
    everywhere: false,
    why:
      "One zero-width character is how an emoji is composed. Three in a row is " +
      "not: a run is how a payload gets encoded in text that occupies no width " +
      "and survives copy, paste, review and a diff untouched.",
    fix:
      "Delete the run. If a line genuinely needs a joiner, it needs ONE — read " +
      "what the run actually encodes before you decide it was an accident.",
  },
  {
    id: "zero-width",
    label: "Zero-width character",
    codepoints: "U+200B, U+2060, U+2063, U+FEFF (a byte-order mark at offset 0 excepted)",
    severity: { guidance: "high", code: "medium" },
    everywhere: false,
    why:
      "A character with no width inside a line changes what a comparison, a " +
      "lookup or a model sees while changing nothing a person sees. It is also " +
      "how a word gets smuggled past a filter that matches on the word.",
    fix:
      "Delete it. A byte-order mark belongs at the very start of a file or " +
      "nowhere; the joiners U+200C and U+200D are deliberately not reported here " +
      "because a single one of either is ordinary text.",
  },
];

/** The rule behind a row, for composing a finding. Never throws over a lookup. */
export const invisibleRuleFor = (ruleId) =>
  INVISIBLE_RULES.find((rule) => rule.id === ruleId) ?? null;

// ── which surface a file is ─────────────────────────────────────────────────

/**
 * The files this app's agent reads as INSTRUCTION, and the corpus a model reads
 * as knowledge.
 *
 * Deliberately the same set `node run.mjs update` addresses by path, plus
 * `content/` — because those are exactly the files that arrive from somewhere
 * else. `AGENTS.md` is generated from `CLAUDE.md` and is in the list anyway:
 * it is what Codex and Antigravity read, and a check that covers only the
 * Claude Code half covers half the customers.
 *
 * @param {string} path repository-relative, forward slashes
 * @returns {boolean}
 */
export function isGuidanceFile(path) {
  const file = String(path ?? "").replace(/\\/g, "/");
  if (/^(CLAUDE|AGENTS|README)\.md$/.test(file)) return true;
  return /^(docs|content|\.claude|\.agents)\//.test(file);
}

/**
 * A test file — where planting the character IS the job.
 *
 * `rules.test.ts` in the community module holds seven bidi controls and a
 * zero-width run, and every one of them is the subject of an assertion. Same
 * argument `scripts/security/rungs.test.ts` makes about its own `docker pull`.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isTestFile(path) {
  return /\.test\.[cm]?[jt]sx?$/.test(String(path ?? "").replace(/\\/g, "/"));
}

// ── the scan ────────────────────────────────────────────────────────────────

/** 1-based line number of `index`, counting the newlines in front of it. */
function lineAt(text, index) {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < index; at = text.indexOf("\n", at + 1)) {
    line += 1;
  }
  return line;
}

/**
 * Every tag-character run that is not an emoji tag sequence.
 *
 * The sequence is U+1F3F4 followed by tag letters, so the question is asked of
 * the character in FRONT of the run. `codePointAt` on the two units before the
 * match is what reads the surrogate pair correctly; `slice(-2)` alone would
 * compare half of it.
 */
function tagMatches(text) {
  const found = [];
  for (const match of text.matchAll(TAG_CHARS)) {
    const before = text.slice(Math.max(0, match.index - 2), match.index);
    if (before.endsWith(TAG_BASE)) continue;
    found.push({ index: match.index, length: match[0].length, count: [...match[0]].length });
  }
  return found;
}

/** Every match of a plain class, as `{index, length, count}`. */
function classMatches(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => ({
    index: match.index,
    length: match[0].length,
    count: [...match[0]].length,
  }));
}

/**
 * Scan one file's text.
 *
 * Two passes, and the second is what keeps a file from being reported for
 * explaining itself: `blanked` is the same text with its comments turned to
 * spaces (the caller passes it, because only the caller knows whether the file
 * is code — `blankCommentsFor()` in `scripts/lib/source-text.mjs`, never a
 * regex of our own). A match present in the raw text and absent from the
 * blanked one is inside a comment. Blanking only ever turns characters into
 * spaces, so the blanked matches are always a SUBSET and the subtraction is
 * exact — the same argument `patterns.mjs` makes for the same two passes.
 *
 * 🚨 A byte-order mark at offset 0 is the file's encoding, not a payload, and
 * it is dropped before anything else looks. Every other position counts.
 *
 * @param {string} text     the file, as read
 * @param {string} blanked  the same text with code comments blanked; pass `text`
 *                          itself for markdown and everything else that is not code
 * @param {{path?: string}} [options]
 * @returns {{ruleId: string, line: number, count: number, inComment: boolean,
 *            surface: "guidance"|"code", severity: string}[]}
 */
export function scanInvisible(text, blanked, { path = "" } = {}) {
  const source = String(text ?? "");
  if (source === "") return [];

  // Offset 0 only, and replaced rather than removed so every later index still
  // points at the character it did. A mark anywhere else is a finding.
  const raw = source.startsWith(BOM) ? ` ${source.slice(1)}` : source;
  const code = String(blanked ?? raw);
  const blankedText = code.startsWith(BOM) ? ` ${code.slice(1)}` : code;

  const surface = isGuidanceFile(path) ? "guidance" : "code";
  const inTest = isTestFile(path);

  const rows = [];
  /** Character offsets a run already claimed — the single rule never re-reports them. */
  const claimed = new Set();

  const push = (rule, match, source_) => {
    const inComment = !source_.has(match.index);
    if (inComment && !rule.everywhere) return;
    if (inTest && !rule.everywhere) return;
    rows.push({
      ruleId: rule.id,
      line: lineAt(raw, match.index),
      count: match.count,
      inComment,
      surface,
      // A match inside a comment is one step down: it is real enough to report
      // and not certain enough to rate as the live article. Only `tag-chars`
      // can reach this branch, and never below `high` — a class with no
      // legitimate use in a tree does not become a hint by sitting in a comment.
      severity: inComment ? "high" : rule.severity[surface],
    });
  };

  for (const rule of INVISIBLE_RULES) {
    const inCode = new Set(
      (rule.id === "tag-chars"
        ? tagMatches(blankedText)
        : classMatches(blankedText, patternFor(rule.id))
      ).map((match) => match.index),
    );

    const matches = rule.id === "tag-chars" ? tagMatches(raw) : classMatches(raw, patternFor(rule.id));
    for (const match of matches) {
      if (rule.id === "zero-width-run") {
        for (let at = match.index; at < match.index + match.length; at += 1) claimed.add(at);
      }
      // A run of three zero-width spaces is ONE finding, not one plus three.
      if (rule.id === "zero-width" && claimed.has(match.index)) continue;
      push(rule, match, inCode);
    }
  }

  rows.sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  return rows;
}

/** The class a rule matches on. Kept beside `INVISIBLE_RULES` rather than in it,
 *  so the exported table stays data a test can read without a regex in it. */
function patternFor(ruleId) {
  switch (ruleId) {
    case "bidi":
      return BIDI_CONTROLS;
    case "zero-width-run":
      return ZERO_WIDTH_RUN;
    case "zero-width":
      return ZERO_WIDTH_ONE;
    default:
      return TAG_CHARS;
  }
}
