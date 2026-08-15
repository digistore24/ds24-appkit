// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The security check's vocabulary, its two formats and its arithmetic — pure.
//
//   node run.mjs security-check
//
// Separate from check.mjs for the reason every rules file in this project is
// separate from its shell: a rule that lives inside the script that prints it
// is a rule nothing asserts. Everything here takes objects and returns objects
// or strings — no filesystem, no child process, no `process.cwd()`, no exit
// code — so scripts/security/rules.test.ts can hand it a planted finding and
// check that the verdict really turns red.
//
// That purity is also a promise to whoever comes next: the app itself will
// import this file one day (a scheduled job that measures the same thing and
// records the same numbers), and an import that reaches for `node:fs` on the
// way cannot cross into a running Next.js app.
//
// ── The one thing this file exists to make impossible ───────────────────────
//
// "Clean" and "nobody asked" must never look the same. Every rung reports one
// of three states, and a rung that did not run has to say WHY and WHAT IT
// WOULD HAVE COVERED. `aggregate()` refuses a skip that carries no reason —
// throwing with the rung's id rather than printing a blank tick — because a
// silent skip is the single failure this whole command exists to prevent. The
// same rule is everywhere in this template: `"9 protected page(s) NOT checked"
// is not a pass`, `an unreachable store is a problem, never a skip`, `"I could
// not look" and "there is nothing there" must never be the same answer`.
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md, "Three systems").

// ── The ladder ──────────────────────────────────────────────────────────────

/**
 * The four severities, worst first. Copied from the shipped ladder in
 * `.claude/skills/security-gateway/SKILL.md`, not invented here: the command
 * and the skill's report have to rate the same thing the same way, or an
 * operator reading both learns to trust neither.
 *
 * ⚠️ Do not conflate these with `scripts/dev/doctor.mjs`'s
 * "blocker" | "optional" | "info". Two different questions, two different
 * words — merging them would put "Docker is not installed" next to "money is
 * reachable".
 *
 * @typedef {"critical" | "high" | "medium" | "low"} Severity
 * @type {Severity[]}
 */
export const SEVERITIES = ["critical", "high", "medium", "low"];

/**
 * The glyph per severity — again the skill's, verbatim.
 * @type {Record<Severity, string>}
 */
export const SEVERITY_GLYPHS = {
  critical: "🚨",
  high: "❌",
  medium: "⚠️",
  low: "ℹ️",
};

/** Known, judged, and deliberately NOT counted in the totals. */
export const ACCEPTED_GLYPH = "✅";

/** A rung that did not run. The fifth field of the tally line, never a severity. */
export const NOT_ASKED_GLYPH = "⏭";

/**
 * The three states a rung can end in, and there is no fourth.
 *
 *   clean    it ran, and it found nothing
 *   found    it ran, and it found something
 *   skipped  it did NOT run — and then it owes a reason
 */
export const RUNG_STATES = ["clean", "found", "skipped"];

// ── What a rung is ──────────────────────────────────────────────────────────

/**
 * @typedef {"clean" | "found" | "skipped"} RungState
 *
 * @typedef {object} Finding
 * @property {"critical"|"high"|"medium"|"low"} severity
 * @property {string} title      the header line, after the glyph and the severity
 * @property {string} where      file:line, package@version, or a URL — whatever locates it
 * @property {string} why        what somebody gets out of it, in plain words
 * @property {string} fix        a change somebody can make
 * @property {string} evidence   what was actually observed
 * @property {string} source     which database or tool reported it ("npm audit")
 * @property {string} [id]       that database's own id for it (a GHSA id), when it has one —
 *                               this is what an accepted set is keyed on, and what lets two
 *                               rungs disagreeing about one package be recognised as one thing
 *
 * @typedef {object} RungResult
 * @property {RungState} state
 * @property {string} [reason]      REQUIRED when state === "skipped"
 * @property {Finding[]} findings   [] unless state === "found"
 * @property {Finding[]} [accepted] recognised as known; never counted, always printed
 * @property {string} [evidence]    one line naming what the rung actually ran
 *
 * @typedef {object} Rung
 * @property {string} id       stable and machine-readable — it goes into the record
 * @property {string} label    one line a person reads
 * @property {1|2} tier        1 = needs nothing installed; 2 = needs a tool that may be absent
 * @property {string} covers   what it WOULD have checked — printed when it skips
 * @property {(ctx: {root: string, argv: string[]}) => Promise<RungResult>} run
 */

/**
 * Two fields exist before anything needs them, and that is deliberate.
 *
 *   `tier`  — every rung shipped today needs nothing installed. The moment one
 *             needs a tool that may be absent, its absence has to read as a
 *             skip and never as a failure; a field added at that point is an
 *             aggregator edited at that point, and this is the file every later
 *             rung was supposed to leave alone.
 *   `source`— only one database answers today. Two rungs disagreeing about one
 *             package is exactly what this field settles, and retrofitting it
 *             means re-rating findings that were already printed.
 *
 * A rung PRINTS NOTHING. `--json` promises nothing else on stdout, and a rung
 * that logs breaks that promise from a file nobody looks at.
 */

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Where a finding's values start, and how wide the block is.
 *
 * Both are measured off the shipped example in the skill rather than chosen:
 * three spaces of indent, the label padded so values begin at column 14, and
 * continuation lines aligned to the same column. 79 is the length of the
 * longest line in that example — `scripts/security/rules.test.ts` holds this
 * code against the example itself, so changing either number here without
 * changing the skill's block is a red test rather than a quiet divergence.
 */
const LABEL_COLUMN = 13;
const LINE_WIDTH = 79;

/** Break `text` at spaces so no line is wider than `width`. Long words stand alone. */
function wrap(text, width) {
  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** One labelled line of a finding block, wrapped and hanging-indented. */
function labelled(label, value) {
  const head = `   ${`${label}:`.padEnd(LABEL_COLUMN - 3)}`;
  const indent = " ".repeat(LABEL_COLUMN);
  return wrap(value, LINE_WIDTH - LABEL_COLUMN)
    .map((line, index) => (index === 0 ? head + line : indent + line))
    .join("\n");
}

/**
 * A finding, in the shape every gateway in this template uses.
 *
 *   🚨 CRITICAL — Admin action reachable without an owner check
 *      Where:    app/dashboard/admin/users/actions.ts:34
 *      Why:      A server action is an HTTP endpoint. Any signed-in member can POST
 *                to it and change another member's role.
 *      Fix:      requireOwner() at the top of the action, before the first query.
 *      Evidence: The action calls auth() but never checks session.user.role.
 *
 * Four lines, always in that order; the header is not one of the four.
 */
export function formatFinding(finding) {
  const glyph = SEVERITY_GLYPHS[finding?.severity] ?? "•";
  const severity = String(finding?.severity ?? "").toUpperCase();
  return [
    `${glyph} ${severity} — ${finding?.title ?? ""}`,
    labelled("Where", finding?.where),
    labelled("Why", finding?.why),
    labelled("Fix", finding?.fix),
    labelled("Evidence", finding?.evidence),
  ].join("\n");
}

/**
 * An accepted finding — the same four lines under a different header.
 *
 * They are printed rather than swallowed on purpose: a check that quietly drops
 * what somebody once judged is a check that trains its reader to assume nothing
 * was there. The severity word is left off because an accepted risk is not
 * counted in the totals, and a number beside it invites adding it back in.
 */
export function formatAccepted(finding) {
  return [
    `${ACCEPTED_GLYPH} ${finding?.title ?? ""}`,
    labelled("Where", finding?.where),
    labelled("Why", finding?.why),
    labelled("Fix", finding?.fix),
    labelled("Evidence", finding?.evidence),
  ].join("\n");
}

/**
 * A rung that did not run — its reason AND what nobody therefore looked at.
 *
 * 🚨 `covers` is not decoration. It is the sentence that stops a skip reading
 * like a pass, and it has to say what WOULD have been checked rather than what
 * the rung is called. A skip is never rendered as a tick, here or anywhere.
 */
export function formatSkip(outcome) {
  return [
    `${NOT_ASKED_GLYPH} NOT ASKED — ${outcome?.label ?? outcome?.id ?? ""}`,
    labelled("Reason", outcome?.reason),
    labelled("Blind to", outcome?.covers),
  ].join("\n");
}

/**
 * A rung that DID run — one line, plus what it actually ran.
 *
 * Without this the whole ladder collapses into a tally, and a tally of zero
 * looks the same whether one rung ran or seven did. `ux-check` prints a `✓` per
 * check for the same reason: green means counted, and the reader has to be able
 * to see WHAT was counted.
 */
export function formatRan(outcome) {
  const found = outcome?.state === "found" ? ` — ${outcome.findings.length} finding(s)` : "";
  const head = `${outcome?.state === "clean" ? "✓" : "·"} ${outcome?.label ?? outcome?.id ?? ""}${found}`;
  if (!outcome?.evidence) return head;
  return [head, ...wrap(outcome.evidence, LINE_WIDTH - 4).map((line) => `    ${line}`)].join("\n");
}

/**
 * The header line the skill's own report uses, with one field appended.
 *
 * `⏭ not asked N` appears only when N > 0 — the same asymmetry the greeting's
 * browser line carries: a field that is always there is read by nobody.
 */
export function tallyLine(counts, notAsked = 0) {
  const parts = SEVERITIES.map(
    (severity) => `${SEVERITY_GLYPHS[severity]} ${severity.toUpperCase()} ${counts?.[severity] ?? 0}`,
  );
  parts.push(`${ACCEPTED_GLYPH} accepted ${counts?.accepted ?? 0}`);
  if (notAsked > 0) parts.push(`${NOT_ASKED_GLYPH} not asked ${notAsked}`);
  return parts.join("   ");
}

// ── Arithmetic ──────────────────────────────────────────────────────────────

/**
 * How many findings at each severity. Anything unrecognised is not counted.
 *
 * Written out rather than derived from SEVERITIES so the four keys are a TYPE
 * and not a guess: a reader in the app (TypeScript, `strict`) gets
 * `counts.high` checked rather than indexed into a string map.
 */
export function countBySeverity(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings ?? []) {
    if (Object.hasOwn(counts, finding?.severity)) counts[finding.severity] += 1;
  }
  return counts;
}

/**
 * Split findings into the open ones and the ones somebody has already judged.
 *
 * Keyed on the finding's `id`, never on its title or its package: a title is
 * upstream prose that changes, and one advisory reaches a tree through any
 * number of packages. A finding with no id can never be accepted, which is the
 * right way round — an exemption nobody can name is an exemption nobody can
 * review.
 */
export function partitionAccepted(findings, acceptedIds) {
  const known = acceptedIds instanceof Set ? acceptedIds : new Set(acceptedIds ?? []);
  const open = [];
  const accepted = [];
  for (const finding of findings ?? []) {
    if (finding?.id && known.has(finding.id)) accepted.push(finding);
    else open.push(finding);
  }
  return { findings: open, accepted };
}

/** Worst first — CRITICAL, HIGH, MEDIUM, LOW. Stable within a severity. */
const bySeverity = (a, b) => SEVERITIES.indexOf(a?.severity) - SEVERITIES.indexOf(b?.severity);

/**
 * A rung's declaration and its answer, merged into the one shape everything
 * downstream reads.
 *
 * It also refuses a rung that contradicts itself — `clean` while handing over
 * findings, or `found` while handing over none. That is a bug in a rung rather
 * than a state of the app, and the caller runs this INSIDE its per-rung
 * try/catch, so such a rung becomes a skip naming the contradiction. Which is
 * the honest answer: its result could not be trusted, so nothing was measured.
 */
export function outcomeFrom(rung, result) {
  const state = result?.state;
  const findings = result?.findings ?? [];
  const accepted = result?.accepted ?? [];
  // 🚨 The two refusals `aggregate()` makes, made HERE as well — and that is the
  // whole point rather than a duplicate. `aggregate()` runs inside
  // `recordFrom()`, which `securityCheck()` calls OUTSIDE the per-rung `try`: a
  // single rung answering `skipped` with no reason therefore threw past every
  // other rung's result, past `writeVerdict()`, and left the PREVIOUS run's
  // record on disk — which the greeting then reports as today's "ok" for up to
  // seven days. Refused here, the same mistake becomes one honest skip.
  if (!RUNG_STATES.includes(state)) {
    throw new Error(
      `rung "${rung?.id}" reported the state ${JSON.stringify(state)} — ` +
        `it has to be one of: ${RUNG_STATES.join(", ")}`,
    );
  }
  if (state === "skipped" && !String(result?.reason ?? "").trim()) {
    throw new Error(
      `rung "${rung?.id}" skipped without a reason. A skip that cannot say why is ` +
        `indistinguishable from a pass — give the RungResult a reason, or do not skip.`,
    );
  }
  if (state === "clean" && findings.length > 0) {
    throw new Error(
      `rung "${rung?.id}" reported clean while handing over ${findings.length} finding(s)`,
    );
  }
  if (state === "found" && findings.length === 0) {
    throw new Error(`rung "${rung?.id}" reported found while handing over no findings`);
  }
  // 🚨 The same refusal for the SEVERITY, which `aggregate()` has for the state
  // and did not have for this. Measured 2026-08-15 with `severity: "moderate"` —
  // npm's own word, which `npm-audit.mjs` passes through raw as `npmSeverity`:
  // the finding was PRINTED, counted in nothing, `failing` stayed false, exit 0,
  // and that same zero travelled into the record and from there into the
  // greeting's line. A word this code does not know must not be able to make a
  // finding weightless — thrown here, it becomes an honest skip through the
  // per-rung catch rather than a silent pass.
  for (const finding of [...findings, ...accepted]) {
    if (!SEVERITIES.includes(finding?.severity)) {
      throw new Error(
        `rung "${rung?.id}" reported a finding with severity "${finding?.severity}", ` +
          `which is not one of ${SEVERITIES.join(", ")} — it would be counted nowhere`,
      );
    }
  }
  return {
    id: rung?.id,
    label: rung?.label,
    tier: rung?.tier,
    covers: rung?.covers,
    state,
    reason: result?.reason ?? "",
    evidence: result?.evidence ?? "",
    findings,
    accepted,
  };
}

/**
 * Every rung's outcome, added up into one verdict.
 *
 * Two refusals, and both are the point of this file:
 *
 *   * a `skipped` outcome with no reason throws, naming the rung. A blank skip
 *     is a tick with a different glyph, and the whole command exists so that
 *     cannot happen.
 *   * an unknown state throws too. A fourth state invented by a later rung
 *     would otherwise fall through every branch below and be counted as
 *     nothing at all — which is the same failure wearing a typo.
 */
export function aggregate(outcomes) {
  const findings = [];
  const accepted = [];
  const skipped = [];
  const states = [];

  for (const outcome of outcomes ?? []) {
    if (!RUNG_STATES.includes(outcome?.state)) {
      throw new Error(
        `✗ rung "${outcome?.id}" reported the state ${JSON.stringify(outcome?.state)} — ` +
          `it has to be one of: ${RUNG_STATES.join(", ")}`,
      );
    }
    if (outcome.state === "skipped" && !String(outcome.reason ?? "").trim()) {
      throw new Error(
        `✗ rung "${outcome.id}" skipped without a reason. A skip that cannot say why is ` +
          `indistinguishable from a pass — give the RungResult a reason, or do not skip.`,
      );
    }
    states.push(
      outcome.state === "skipped"
        ? { id: outcome.id, state: outcome.state, reason: outcome.reason }
        : { id: outcome.id, state: outcome.state },
    );
    if (outcome.state === "skipped") {
      skipped.push(outcome);
      continue;
    }
    findings.push(...(outcome.findings ?? []));
    accepted.push(...(outcome.accepted ?? []));
  }

  findings.sort(bySeverity);
  const counts = { ...countBySeverity(findings), accepted: accepted.length };
  return {
    counts,
    findings,
    accepted,
    skipped,
    states,
    notAsked: skipped.length,
    complete: skipped.length === 0,
    failing: failsVerdict(counts),
  };
}

/**
 * Does this run end non-zero?
 *
 * CRITICAL or HIGH open — nothing else. Not a MEDIUM, and above all **not a
 * skip**: an optional tool that is not installed is a skip, and a command that
 * failed because somebody's machine is missing a scanner is a command people
 * stop running. What a skip does instead is say so, loudly, in the verdict.
 */
export function failsVerdict(counts) {
  return (counts?.critical ?? 0) + (counts?.high ?? 0) > 0;
}

// ── The verdict a person reads ──────────────────────────────────────────────

/**
 * What the shipped ladder calls its steps, and where its judgement half lives.
 *
 * Both are defaults rather than constants because a SECOND ladder exists since
 * 0.24.0 — `node run.mjs health` runs six probes on this same interface and
 * would otherwise close with *"the judgement half is the skill:
 * security-gateway"*, which is the wrong skill for "your app is down".
 *
 * 🚨 **The alternative was a second renderer, and it is the one to keep
 * refusing.** Two renderers is how two ladders come to disagree about a glyph,
 * about where the ⏭ block goes, and about whether "nothing found" may be
 * printed next to a skip. One renderer, two callers, and the default below
 * reproduces today's output byte for byte — `rules.test.ts` passes unmodified,
 * which is the proof.
 */
const DEFAULT_VERDICT_TEXTS = Object.freeze({
  judgement: "The judgement half is the skill: security-gateway",
  noun: "rung",
  plural: "rungs",
});

/** The last line — and the whole reason "clean" and "nothing asked" are two sentences. */
export function closingLine(summary, texts = {}) {
  const { judgement, noun, plural } = { ...DEFAULT_VERDICT_TEXTS, ...texts };
  const guided = `  ${judgement}`;
  const skips =
    summary.notAsked > 0 ? ` — ${summary.notAsked} ${noun}(s) were not asked` : "";

  if (summary.failing) {
    const serious = summary.counts.critical + summary.counts.high;
    return `✗ ${serious} finding(s) at HIGH or above${skips}.\n${guided}`;
  }
  if (summary.findings.length > 0) {
    return `⚠️  ${summary.findings.length} finding(s), none at HIGH or above${skips}.\n${guided}`;
  }
  if (summary.notAsked > 0) {
    // Deliberately not "✓ clean". Nothing here knows whether the app is clean —
    // it knows what the rungs that ran found, and the ⏭ blocks above say what
    // nobody looked at.
    return (
      `✓ Nothing found in the ${plural} that ran${skips}.\n` +
      `  That is not a clean bill: read the ⏭ block(s) above for what nobody looked at.`
    );
  }
  return (
    `✓ Nothing found — every ${noun} ran.\n` +
    `  That means what can be counted was counted, not that the app is safe.\n` +
    `${guided}`
  );
}

/**
 * The whole run, as the text a person reads. Nothing here decides an exit code.
 *
 * `texts` is the second ladder's seam and nothing else — see
 * `DEFAULT_VERDICT_TEXTS`. Omitting it produces exactly what this file has
 * always produced.
 */
export function renderVerdict(outcomes, texts = {}) {
  const summary = aggregate(outcomes);
  const blocks = [tallyLine(summary.counts, summary.notAsked)];

  const ran = (outcomes ?? []).filter((outcome) => outcome.state !== "skipped");
  if (ran.length > 0) blocks.push(ran.map(formatRan).join("\n"));

  if (summary.findings.length > 0) {
    blocks.push(summary.findings.map(formatFinding).join("\n\n"));
  }
  if (summary.accepted.length > 0) {
    blocks.push(
      [
        "Accepted — judged already, and not counted above",
        ...summary.accepted.map(formatAccepted),
      ].join("\n\n"),
    );
  }
  if (summary.skipped.length > 0) {
    blocks.push(summary.skipped.map(formatSkip).join("\n\n"));
  }
  blocks.push(closingLine(summary, texts));
  return `${blocks.join("\n\n")}\n`;
}

// ── The record ──────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

/** The shape written to `.dev/`. Bumped when a reader could misread the old one. */
export const RECORD_VERSION = 1;

/**
 * Beyond this an answer is too old to report as if it were current.
 *
 * A week, not a month: advisory databases move daily, and this record describes
 * a dependency tree that gets re-resolved on every install. Bounded on the READ
 * side, exactly as `readApprovalCache()` bounds its own — an answer nobody has
 * refreshed is not a finding, it is a leftover. The safe direction is the one
 * this takes: too short means a reader is told nobody has looked recently,
 * which is honest; too long means a stale answer is presented as today's.
 */
export const MAX_RECORD_AGE = 7 * DAY;

/**
 * How much of a skip's reason travels into the record.
 *
 * The record's shape is meant to survive a journey into a scheduled job's one
 * line of numbers, and `docs/cron.md` is strict about what may go there: no
 * address, no member id, no text anybody typed. A rung's reason clears that bar
 * by construction — it is this app's own sentence about a TOOL ("npm is not on
 * the PATH", "the registry did not answer"), never about a person, and no rung
 * may put a member id or anything somebody typed into one. The cap is here so
 * that a tool's own error message, pasted in verbatim, stays one line.
 *
 * 🚨 **"By construction" stopped being true when the HEALTH probes started
 * writing records in this shape.** Theirs are about a DEPLOYED app, and their
 * transport failure reads `${url} did not answer (…)` — so the production
 * address travelled into a record whose own header forbids exactly that, and
 * would travel on into `cron_runs.lastDetail`. The claim is now KEPT rather than
 * assumed: the address is removed here, at the one door both producers pass
 * through, instead of in each probe where the next one would forget.
 */
export const MAX_REASON_LENGTH = 120;

/** What replaces an address, so the sentence still reads as a sentence. */
const ADDRESS_PLACEHOLDER = "the address";

const shorten = (text) => {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    // Everything up to whitespace or a closing bracket: an address ends where
    // the sentence resumes. Case-insensitive because a copied `.env` block
    // spells the scheme in capitals often enough to matter.
    .replace(/\bhttps?:\/\/[^\s)\]]*/gi, ADDRESS_PLACEHOLDER);
  return line.length <= MAX_REASON_LENGTH ? line : `${line.slice(0, MAX_REASON_LENGTH - 1)}…`;
};

/**
 * The record — numbers and rung states, and deliberately nothing else.
 *
 * 🚨 **Never a finding's title, path, package name or evidence.** Not for size:
 * this same shape is what a scheduled job would write into `cron_runs`, which
 * `docs/cron.md` restricts to numbers. A record carrying
 * `"where": "lib/foo.ts:12"` is a record that cannot make that journey. The
 * findings live in the terminal output and in `--json`; this is the tally.
 *
 * `complete` is false whenever ANY rung was skipped, so "the measurement did
 * not finish" needs no second field and no second opinion about what counts.
 */
export function recordFrom(outcomes, { now = Date.now(), template = "" } = {}) {
  const { counts, states, complete } = aggregate(outcomes);
  return {
    version: RECORD_VERSION,
    checkedAt: new Date(now).toISOString(),
    template: String(template ?? ""),
    complete,
    counts,
    rungs: states.map((state) =>
      state.reason ? { ...state, reason: shorten(state.reason) } : state,
    ),
  };
}

/**
 * Is this record too old to speak for the app as it stands?
 *
 * A record with no usable timestamp is stale rather than fresh. The guard is
 * written that way round on purpose: `_approval.mjs` records what the other
 * order cost — a missing or garbled timestamp skipped the age check entirely,
 * and a hand-written file was reported as today's answer for ever.
 */
export function recordIsStale(record, now = Date.now()) {
  const at = Date.parse(record?.checkedAt ?? "");
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at > MAX_RECORD_AGE;
}
