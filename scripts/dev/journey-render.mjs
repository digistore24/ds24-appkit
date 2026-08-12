// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The journey, as something a person reads — and as something a program reads.
//
// PURE, and that is the whole point of the file: facts in, string out. It is
// handed what `journeyState()` answered and returns text. No `fs`, no clock of
// its own, no `process`. The same seam `./operations.mjs` keeps between
// `operationalFacts()` and `describeOperations()`, for the same reason — the
// judgement can be measured against hand-built fixtures, so what the user reads
// is tested rather than described. `./journey-cli.mjs` is the three lines that
// touch the disk and print.
//
// ── The rules this file obeys, each with the failure behind it ───────────────
//
// **Exactly ONE `Next:` line, with a reason and an offer.** Coach's rule 1 is
// *"one next step, never a catalogue"*: somebody who asks what to do next is
// already unsure, and fourteen options is not an answer. The reason comes out of
// the row's own evidence rather than out of a sentence written here, so it cannot
// describe a state the app is not in.
//
// **The shelf is a count and a question, never ten rows.** Ten optional things
// most apps do not want, listed in order, is a checklist — and a checklist is
// what makes somebody build a mobile app for a product nobody has bought yet. So
// the numbered group prints as one line with a count, and the second door is a
// question the user can ask.
//
// **A declined row stays VISIBLE.** *"A recorded 'no' is an answer"* cuts both
// ways: it is never re-proposed, and it is never hidden either — a refusal
// nobody can see is a refusal nobody can revoke.
//
// **A row whose code is absent says so.** `needs-newer-template` renders the
// update command and never anything that reads like "open". Sending somebody at
// a feature that is not in their copy is the failure that state exists for.
//
// **Unreached phases collapse to one line each**, so the whole picture fits one
// screen. A picture that scrolls is one nobody reads to the end of, and the end
// is where the next step is.
//
// **An earlier phase's optional row is never proposed once a later phase has
// moved.** A live app is not dragged back to branding: the row reads "not
// taken", which is a record rather than an invitation.
//
// ⚠️ **English, deliberately.** Terminal output of the scripts here is
// untranslated (CLAUDE.md → Languages), so `title.en` is what prints and
// `title.de` is for prose a human writes elsewhere.
//
// Plain Node, no dependency, ESM — Linux, macOS and Git Bash on Windows
// (CLAUDE.md → Three systems).
import { PHASES, performerOf } from "./journey.mjs";

/**
 * What `journeyState()` answered — the only input any of this takes.
 *
 * Typed by IMPORTING the row type rather than restating its fields: a second
 * description of a row is a second thing to keep in step, and this file's whole
 * argument is that there is one original.
 *
 * @typedef {import("./journey.mjs").JourneyRow} JourneyRow
 * @typedef {{ rows: JourneyRow[], currentPhase: string|null, next: JourneyRow|null }} JourneyView
 */

/** Where a phase header's status word ends. Hand-tuned to the approved layout. */
const HEADER_WIDTH = 78;

/** Where a row's evidence column starts, measured from the start of the line. */
const EVIDENCE_AT = 45;

/**
 * The width everything is folded to.
 *
 * ⚠️ A phase header may exceed it — it carries a blurb AND a status, and the
 * alternative is truncating a sentence, which this file never does. Everything
 * that CAN be folded is folded to this.
 */
const LINE_WIDTH = 96;

/** How many of a collapsed shelf's remaining steps get NAMED before "+N others". */
const SHELF_NAMED = 5;

/**
 * The glyph per state.
 *
 * Seven states, seven marks, and `open` is deliberately a SPACE: an open step is
 * the ordinary state of most of this list, and a mark on every line is a page
 * with no signal in it. The two that could be mistaken for each other are kept
 * apart — `–` is a decision somebody made, `?` is nobody having recorded one.
 */
const GLYPH = {
  done: "✓",
  stale: "↻",
  declined: "–",
  blocked: "⊘",
  "needs-newer-template": "⇧",
  unknown: "?",
  open: " ",
};

/** Right-pad, and never truncate: a cut-off sentence is worse than a ragged column. */
const pad = (text, width) => (text.length >= width ? `${text} ` : text.padEnd(width));

/**
 * First letter down, and the rest untouched.
 *
 * The rows and phases carry their titles as headings ("Choose the look"); read
 * mid-sentence they want to be phrases ("choose the look"). ⚠️ The FIRST
 * character only, never `toLowerCase()` on the whole string — a title naming
 * Digistore24 or a proper noun would come back wrong, and titles are prose
 * somebody adds to later.
 */
const lower = (text) => String(text ?? "").replace(/^(.)/, (c) => c.toLowerCase());

/**
 * Fold a sentence onto lines of at most `width`, each carrying `indent`.
 *
 * Word-wrapped rather than left to the terminal, because the terminal wraps at
 * column zero and the second line of a wrapped bullet then reads as a new one.
 */
function wrap(text, width, indent = "") {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length + indent.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

/** The numbered phases, in order — the path. `voraussetzung`/`daneben` are not it. */
const numberedPhases = () => PHASES.filter((phase) => phase.num !== null);

/** Is this step one of a lettered group — `2.3a` rather than `2.3`? */
const shelfKey = (step) => /^(\d+\.\d+)[a-z]$/.exec(String(step ?? ""))?.[1] ?? null;

/**
 * A phase's rows, with any lettered group of three or more folded into one entry.
 *
 * 🚨 **Three, not one**, and the number is the whole rule: `2.2b` (`billing-modes`)
 * is a lettered step with no siblings and is a step in its own right, while
 * `2.3a`–`2.3j` are ten faces of ONE decision point. Folding by "has a letter"
 * would hide a real step; folding by a hard-coded `"2.3"` would stop working the
 * day somebody renumbers. So the shape of the group decides.
 *
 * @param {JourneyRow[]} rows
 * @returns {({ kind: "row", row: JourneyRow } | { kind: "shelf", key: string, rows: JourneyRow[] })[]}
 */
export function groupRows(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = shelfKey(row.step);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out = [];
  for (const row of rows) {
    const key = shelfKey(row.step);
    if (!key || (counts.get(key) ?? 0) < 3) {
      out.push({ kind: "row", row });
      continue;
    }
    const shelf = out.find((entry) => entry.kind === "shelf" && entry.key === key);
    if (shelf) shelf.rows.push(row);
    else out.push({ kind: "shelf", key, rows: [row] });
  }
  return out;
}

/** Does this phase come before the one the app is in? */
function isPast(phaseId, currentPhase) {
  const order = numberedPhases().map((phase) => phase.id);
  const at = order.indexOf(phaseId);
  const now = order.indexOf(currentPhase);
  // No current phase means every required step is answered, so everything with a
  // number is behind us.
  if (now === -1) return at !== -1;
  return at !== -1 && at < now;
}

/**
 * One word for a whole phase: `"current"`, `"done"` or `"not-yet"`.
 *
 * ⚠️ Machine words, and the arrow that a person reads (`← you are here`) is added
 * where the header is composed. A display string in the `--json` shape is a
 * string somebody's code then compares against, and the day the arrow changes
 * their comparison breaks silently.
 */
function phaseStatus(phaseId, rows, currentPhase) {
  if (phaseId === currentPhase) return "current";
  if (isPast(phaseId, currentPhase)) return "done";
  // A phase nobody has reached may still hold something finished — an optional
  // row taken early. "not yet" is about the PHASE, and the rows below say the
  // rest; claiming `done` here because two rows are would be the phase lying
  // about the steps it still owes.
  const owed = rows.filter((row) => row.optional === false);
  return owed.length > 0 && owed.every((row) => row.state === "done") ? "done" : "not-yet";
}

/** The same three states, as a person reads them. */
const PHASE_LABEL = { current: "← you are here", done: "done", "not-yet": "not yet" };

/** The line above a phase's rows: number, title, blurb, status. */
function phaseHeader(phase, rows, currentPhase) {
  const status = PHASE_LABEL[phaseStatus(phase.id, rows, currentPhase)];
  const left =
    `  ${phase.num}  ${phase.title.en.toUpperCase()} — ` +
    lower(phase.blurb.en.replace(/\.$/, ""));
  const gap = Math.max(2, HEADER_WIDTH - status.length - left.length);
  return left + " ".repeat(gap) + status;
}

/**
 * One row of an expanded phase.
 *
 * `withStep` is what makes the numbers a HANDLE rather than decoration: the
 * phase the app is in prints them, because those are the steps somebody can ask
 * for by name; a finished phase does not, because there is nothing left to ask
 * for and four numbers per line is noise.
 */
function rowLine(row, { withStep, notTaken }) {
  const glyph = GLYPH[row.state] ?? "?";
  const step = withStep && row.step ? `${row.step}  ` : "";
  const left = `     ${glyph}  ${step}${lower(row.title.en)}`;
  const evidence = notTaken ? "not taken" : row.evidence;
  // Wrapped into the column rather than truncated: a `kind: "ask"` row's `why` is
  // a whole sentence naming the command that WOULD answer it, and a sentence cut
  // off at the screen's edge is one that names half a command.
  const [first, ...rest] = wrap(evidence, LINE_WIDTH - EVIDENCE_AT);
  return [pad(left, EVIDENCE_AT) + first, ...rest.map((line) => " ".repeat(EVIDENCE_AT) + line)].join(
    "\n",
  );
}

/** The shelf, as a count and a question. Never as its rows. */
function shelfLines(key, rows) {
  const taken = rows.filter((row) => row.state === "done");
  const left = rows.filter((row) => row.state !== "done");
  const glyph = taken.length > 0 ? "✓" : " ";
  const head =
    pad(`     ${glyph}  ${key}  what else it can do`, EVIDENCE_AT) +
    `${taken.length} of ${rows.length} taken`;

  if (left.length === 0) {
    return [head, ...wrap("Everything on the shelf is in. Nothing more to offer here.", 68, "     ")];
  }

  const named = left.slice(0, SHELF_NAMED).map((row) => lower(row.title.en));
  const rest = left.length - named.length;
  const list = named.join(", ") + (rest > 0 ? `, and ${rest} others` : "");
  return [
    head,
    ...wrap(
      `${left.length} more steps are available here — ${list}. ` +
        `Ask "what else can it do?" and I will say.`,
      68,
      "     ",
    ),
  ];
}

/** A phase nobody has reached: one header plus its step numbers, folded. */
function collapsedLines(phase, rows, currentPhase) {
  const parts = groupRows(rows).map((entry) =>
    entry.kind === "shelf"
      ? `${entry.key} what else it can do (${entry.rows.length}, optional)`
      : `${entry.row.step ? `${entry.row.step} ` : ""}${lower(entry.row.title.en)}` +
        (entry.row.optional ? " (optional)" : ""),
  );
  return [phaseHeader(phase, rows, currentPhase), ...wrap(parts.join(" · "), 68, "     ")];
}

/**
 * The ONE next line: what, why, and an offer to start it.
 *
 * 🚨 Two sentences and nothing else. The reason is the row's own evidence, so it
 * is a fact about this app rather than a sentence written in advance, and the
 * offer is what stops the journey being a report somebody reads and closes.
 *
 * `null` gets a sentence of its own instead of silence: an app with nothing
 * outstanding must not print a blank where the next step goes, or "everything is
 * answered" and "this command is broken" look the same.
 *
 * @param {JourneyView} state
 */
export function describeNext(state) {
  const next = state?.next ?? null;
  if (!next) {
    return (
      "Next: nothing the path asks for is outstanding. What is left is optional — " +
      'ask "what else can it do?" and I will say.'
    );
  }

  const step = next.step ? `${next.step} — ` : "";
  const skill = performerOf(next);
  // ⚠️ **One offer, and no branch on the state** — because `journeyState()`'s
  // `OPEN_STATES` cannot hand this function a row that is `needs-newer-template`
  // or `declined` at all. Those two are excluded from being "next" one layer
  // down, deliberately, so an offer to update or to un-refuse would be a branch
  // no fixture can reach. Such a row still PRINTS its own evidence in the table
  // above, which is where the user meets it.
  //
  // The REASON is the row's own evidence and nothing written here, so it is a
  // fact about this app rather than a sentence prepared in advance — and it
  // cannot describe a state the app is not in. `what` is deliberately left out:
  // it is a definition, and two lines is the budget.
  //
  // ⚠️ The evidence is quoted VERBATIM, not sentence-cased: it routinely begins
  // with a path or a command (`app/page.tsx …`, `node run.mjs doctor --deploy …`),
  // and capitalising either one falsifies it — `Node run.mjs` is not a command
  // anybody can type.
  return (
    `Next: ${step}${lower(next.title.en)}. ${next.evidence}` +
    `${skill ? ` — the skill is ${skill}` : ""}. Shall I start it?`
  );
}

/**
 * The whole journey, as the user sees it.
 *
 * @param {JourneyView} state
 * @param {{ appName?: string|null }} [options] the app's own name, where it has one
 * @returns {string}
 */
export function describeJourney(state, { appName = null } = {}) {
  const rows = state?.rows ?? [];
  const currentPhase = state?.currentPhase ?? null;
  const phases = numberedPhases();
  const current = phases.find((phase) => phase.id === currentPhase) ?? null;

  const lines = [];
  // The name is omitted rather than replaced by a placeholder: "Your App —"
  // reads as the app being called that, and this line is the first thing on the
  // page.
  const where = current ? `You are in phase ${current.num}.` : "Every required step is answered.";
  lines.push(`${appName ? `${appName} — four` : "Four"} phases. ${where}`);
  lines.push('Every step is optional. Say "skip that" and it is written down, not asked again.');
  lines.push("");

  for (const phase of phases) {
    const mine = rows.filter((row) => row.phase === phase.id);
    if (mine.length === 0) continue;

    // Reached or behind us: the rows themselves. Ahead of us: one line, because
    // the whole picture has to fit one screen.
    const reached = phase.id === currentPhase || isPast(phase.id, currentPhase);
    if (!reached) {
      lines.push(...collapsedLines(phase, mine, currentPhase));
      lines.push("");
      continue;
    }

    lines.push(phaseHeader(phase, mine, currentPhase));
    const past = isPast(phase.id, currentPhase);
    for (const entry of groupRows(mine)) {
      if (entry.kind === "shelf") {
        lines.push(...shelfLines(entry.key, entry.rows));
        continue;
      }
      lines.push(
        rowLine(entry.row, {
          withStep: !past,
          // An optional row left open in a phase we have moved past is a record,
          // not an invitation — the app is never dragged back to branding.
          notTaken: past && entry.row.optional && entry.row.state === "open",
        }),
      );
    }
    lines.push("");
  }

  lines.push(...wrap(describeNext(state), 72));
  return lines.join("\n");
}

/**
 * The machine shape — what `coach` and the greeting read.
 *
 * The same facts as the human view and never a second derivation of them: a
 * `--json` that computed anything of its own would be a second answer to "where
 * am I", and the two would eventually disagree in front of a user.
 *
 * @param {JourneyView} state
 * @param {{ appName?: string|null }} [options]
 */
export function journeyJson(state, { appName = null } = {}) {
  const rows = state?.rows ?? [];
  const asRow = (row) =>
    row && {
      skill: row.skill,
      startedBy: row.startedBy ?? null,
      performedBy: performerOf(row),
      phase: row.phase,
      step: row.step,
      title: row.title,
      what: row.what,
      optional: row.optional,
      recurring: row.recurring,
      requires: row.requires,
      module: row.module,
      state: row.state,
      evidence: row.evidence,
    };

  return {
    appName,
    currentPhase: state?.currentPhase ?? null,
    phases: numberedPhases().map((phase) => {
      const mine = rows.filter((row) => row.phase === phase.id);
      return {
        id: phase.id,
        num: phase.num,
        title: phase.title,
        state: phaseStatus(phase.id, mine, state?.currentPhase ?? null),
        steps: mine.length,
        done: mine.filter((row) => row.state === "done").length,
      };
    }),
    next: asRow(state?.next ?? null) ?? null,
    nextSentence: describeNext(state),
    rows: rows.map(asRow),
  };
}

/**
 * The greeting's `[Journey: …]` line — one phase, one next step, one count.
 *
 * ⚠️ **Unlike `[Operations: …]` and `[Machine: …]`, this prints EVERY time**, and
 * the asymmetry is deliberate: it answers the most common question in this
 * project ("where am I, what now"), and it REPLACED a line that already printed
 * on every session — the hard-coded arrow chain. It cannot grow: one phase, one
 * next step, one count, and a declined row never appears in it. Anything more
 * belongs in `node run.mjs journey`, which the line names.
 *
 * @param {JourneyView} state
 */
export function describeJourneyLine(state) {
  const currentPhase = state?.currentPhase ?? null;
  const phase = numberedPhases().find((entry) => entry.id === currentPhase) ?? null;
  const rows = (state?.rows ?? []).filter((row) => row.phase === currentPhase);
  const owed = rows.filter((row) => row.optional === false);
  const done = owed.filter((row) => row.state === "done").length;
  const next = state?.next ?? null;

  const where = phase ? `${phase.num} ${phase.title.en}` : "done with the path";
  const count = phase ? ` — ${done} of ${owed.length} done` : "";
  const what = next
    ? `, next: ${next.step ? `${next.step} ` : ""}${lower(next.title.en)}`
    : ", nothing outstanding";
  return `[Journey: ${where}${count}${what}. \`node run.mjs journey\`]`;
}
