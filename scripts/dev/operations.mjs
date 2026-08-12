// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The greeting's ONE operational line — what is open about RUNNING this app.
//
// The commands that measure things already write their answers down;
// `node run.mjs security-check` writes `.dev/security-check.json`. What was
// missing was somebody reading them back: an operator who has to remember to
// ask is an operator who finds out six weeks later. So the session greeting
// reads the records — synchronously, off disk, no network — and says at most
// ONE line about them.
//
// ── Three properties, and each of them is a decision ────────────────────────
//
// **It takes FACTS, not records.** `describeOperations()` knows nothing about
// security; it takes `{ id, severity, text, command }` objects and renders them.
// `operationalFacts()` produces two kinds of fact today, from two places on
// disk — the security record, and the NAME of the newest operating-round report
// in `docs/reports/`. The second one was added without touching the renderer at
// all: one collector, one entry. That is the whole point of the seam. A third
// contributor joins the same way and never by printing a second line. One
// channel, one producer: two producers is how a greeting grows a paragraph
// nobody reads.
//
// **Silence is a state, and it is the ordinary one.** No line at all means "at
// least one rung ran and nothing serious is open". That is asymmetry on purpose,
// the same argument `session-start.mjs` writes out above its `[Machine: …]`
// line: a line that appears every time gets read by nobody.
//
// **It never measures.** No rung, no spawn, no fetch, no `--json` call to the
// command "just this once". It reads one small JSON file that is already there.
// The record IS the cache; a cache of a cache is a second truth with its own TTL.
//
// ── What is deliberately NOT here ──────────────────────────────────────────
//
// A finding's title, path, package name or host. The record does not carry them
// — `rules.mjs` → `recordFrom()` argues why, and a test holds it there: the same
// shape has to survive the journey into a scheduled job's line of numbers. Where
// the operator has to know WHAT was found, this line names the command that
// prints it and stops.
//
// Plain Node, no dependency, ESM — Linux, macOS and Git Bash on Windows
// (CLAUDE.md → Three systems).
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_RECORD_AGE,
  SEVERITIES,
  SEVERITY_GLYPHS,
  failsVerdict,
} from "../security/rules.mjs";
import { readVerdictState } from "../security/verdict.mjs";

/** The command that prints what the security record only counts. */
const SECURITY_COMMAND = "node run.mjs security-check";

/**
 * How the operating round is started — and it is not a command.
 *
 * The round is a conversation with an agent (`.claude/skills/operate/`), so the
 * house form for naming one is `session-start.mjs`'s own
 * *"Run the skill setup-machine"*. Rendered here it reads
 * `Run: the skill operate]`, which is the same sentence the greeting already
 * uses two lines further down.
 */
const ROUND_COMMAND = "the skill operate";

// Resolved from THIS file, never from the cwd — the mistake
// `scripts/ds24/_approval.mjs` records, where a script run from another folder
// wrote and then deleted a cache that was never where it was looking. The
// greeting runs from wherever the agent happened to open the project.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where every gateway writes its dated report. Absent in a fresh app. */
const REPORTS_DIR = join(PROJECT_ROOT, "docs", "reports");

/**
 * How many facts get named in full before the line turns into a wall.
 *
 * Two, plus a `+N more` tail — the `describeUnwritten()` idiom from
 * `./app-notes.mjs`. The greeting is a dozen lines and this is one of them; a
 * line that can grow without bound eventually pushes the `[Setup: …]` state off
 * the screen, which is the one line nobody may miss.
 */
const SHOWN = 2;

const DAY = 24 * 60 * 60 * 1000;

/** The staleness bound in days — DERIVED from the record's own bound, never restated. */
const STALE_DAYS = Math.round(MAX_RECORD_AGE / DAY);

/**
 * How long an operating round speaks for this app: **thirty days**.
 *
 * The number is argued here rather than in a story file nobody opens again. The
 * round is a MONTHLY habit — it asks a running app the handful of questions
 * nobody remembers, and most of its answers (are the jobs running, does the
 * environment still hold the content, what does a stranger get) move on the
 * timescale of a deploy rather than of an hour. Thirty days is the longest gap
 * at which "nobody has looked" is still worth one line of somebody's session,
 * and short enough that a quarterly habit gets caught rather than blessed.
 *
 * 🚨 **It is deliberately NOT `MAX_RECORD_AGE`** (seven days,
 * `scripts/security/rules.mjs`), and importing that number because it is
 * already here is the mistake to avoid: the security record ages in a week
 * because advisory databases move daily and a week-old count is a count of
 * yesterday's world. That is a different question with a different clock, and
 * two questions sharing one constant is how the tighter one quietly drags the
 * looser one along.
 *
 * "Configurable" was asked for and is answered by this being ONE binding in ONE
 * place with its reason beside it — not by a `config/*.json` key. A new config
 * surface is not free in this template (`lib/setup/config.ts`: an unknown key
 * switches the whole surface OFF), and a key nobody has ever changed is a key
 * whose default is the real answer.
 */
export const MAX_ROUND_AGE = 30 * DAY;

/** The round's bound in days — derived, so the sentence and the rule agree. */
const ROUND_DAYS = Math.round(MAX_ROUND_AGE / DAY);

/** `operations-YYYY-MM-DD.md`, plus the `-2` / `-3` a second round on one day gets. */
const ROUND_REPORT = /^operations-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md$/;

/**
 * A record's `checkedAt` as a plain `YYYY-MM-DD`, or `""`.
 *
 * `.slice(0, 10)` of the ISO string and nothing cleverer: the greeting is
 * terminal output of a script and is deliberately not translated
 * (CLAUDE.md → Languages), so a locale-formatted date here would be a date
 * formatted for whichever machine happens to print it.
 */
function checkedDay(record) {
  const at = record?.checkedAt;
  if (typeof at !== "string" || at.length < 10) return "";
  // Guarded rather than sliced blind: `"not a date at all".slice(0, 10)` is ten
  // characters long and reads as a date to nothing but a length check.
  return Number.isFinite(Date.parse(at)) ? at.slice(0, 10) : "";
}

/** How many rungs the record has, and how many of them never answered. */
function rungCount(record) {
  const rungs = Array.isArray(record?.rungs) ? record.rungs : [];
  return {
    total: rungs.length,
    notAsked: rungs.filter((rung) => rung?.state === "skipped").length,
  };
}

/**
 * The one security fact, or `null` when there is nothing to say.
 *
 * PURE: it takes what `readVerdictState()` answered and returns a fact object.
 * No `fs` in here — the disk is `operationalFacts()`'s job, and keeping the
 * judgement pure is what lets the real record of this tree be a test fixture.
 *
 * 🚨 **`complete: false` is NOT a reason to speak, and this is the whole design.**
 * Measured on the template's own tree: `live` skips on every laptop for ever
 * (nobody looked at a live app — that is the correct answer, not a defect),
 * `drift` skips with no network, `signatures` skips even on a fully connected
 * machine because an upstream signing key expired, and the two tier-2 rungs skip
 * on every machine without `gitleaks` and a Trivy image. A greeting that reads an
 * incomplete ladder as a warning is a greeting with a permanent warning in it,
 * which is a greeting with no warning in it — noise within a day.
 *
 * 🚨 **And yet a skip must never read as a pass.** Two mechanisms carry that, and
 * both are required: a record where NOTHING ran gets its own sentence, and
 * whenever this fact appears at all it names how many rungs were not asked —
 * counted from `record.rungs`, never from a constant, because the ladder's length
 * moves with every rung somebody adds.
 *
 * The threshold for "open" is `failsVerdict()` — imported, not re-derived. It is
 * the same function the command's own exit code uses, so the greeting and the
 * command can never disagree about what counts as serious. MEDIUM is *"real, but
 * it needs a second condition to become dangerous"* and LOW is *"hardening, when
 * you get around to it"*; neither is a thing to meet at the start of every
 * session for a week.
 *
 * @param {"missing" | "unreadable" | "stale" | "ok"} state
 * @param {Record<string, any> | null} record
 * @param {{ now?: number, appUnderWay?: boolean }} [options]
 * @returns {{ id: string, severity: string, text: string, command: string } | null}
 */
export function securityFact(state, record, { now = Date.now(), appUnderWay = false } = {}) {
  const fact = (severity, text) => ({ id: "security", severity, text, command: SECURITY_COMMAND });

  if (state === "missing") {
    // 🚨 Nobody has checked the app that has not been built yet. On session one
    // of a fresh clone there are no pages, no brief and nothing to secure, and a
    // line nagging about it there is exactly the noise that trains people to
    // skip the whole block. Every OTHER fact is reported regardless of this
    // signal — a record that exists describes an app somebody built.
    if (!appUnderWay) return null;
    return fact("medium", "security — never checked on this machine");
  }

  if (state === "unreadable") {
    return fact("medium", "security — the last check's record cannot be read");
  }

  if (state === "stale") {
    const day = checkedDay(record);
    // A record whose timestamp does not parse is stale too (`recordIsStale()`
    // answers that way round on purpose), and then there is no date to name.
    const when = day ? `last checked ${day}` : "the last check's record carries no usable date";
    const age = Number.isFinite(Date.parse(String(record?.checkedAt ?? "")))
      ? ` (${Math.floor((now - Date.parse(String(record.checkedAt))) / DAY)} days ago)`
      : "";
    return fact(
      "medium",
      `security — ${when}${age}, past the ${STALE_DAYS}-day bound and too old to speak for this app`,
    );
  }

  const { total, notAsked } = rungCount(record);

  // Asked FIRST, before the every-rung-skipped case: a rung that skipped found
  // nothing, so the two cannot both be true today — and if a later record shape
  // ever makes them, the worse fact is the one to say.
  if (failsVerdict(record?.counts)) {
    const critical = record?.counts?.critical ?? 0;
    const high = record?.counts?.high ?? 0;
    const open = [
      critical > 0 ? `${SEVERITY_GLYPHS.critical} ${critical} CRITICAL` : "",
      high > 0 ? `${SEVERITY_GLYPHS.high} ${high} HIGH` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const day = checkedDay(record);
    const context = [
      day ? `checked ${day}` : "",
      // Said whenever the line appears at all: the reader who sees "2 HIGH open"
      // also sees that two rungs never answered. "Nothing found" and "nobody
      // asked" must not look the same, and this is the half that works even when
      // something WAS found.
      `${notAsked} of ${total} rungs not asked`,
    ]
      .filter(Boolean)
      .join("; ");
    return fact(critical > 0 ? "critical" : "high", `security — ${open} open (${context})`);
  }

  if (total === 0) {
    // A record that registered no rungs at all measured nothing, whatever its
    // counts say. This is not reachable from today's ladder; it is what a
    // half-built record looks like, and it must not read as a clean bill.
    return fact("medium", "security — the last check recorded no rungs at all, so nothing was looked at");
  }

  if (notAsked === total) {
    // Everything skipped. This is the state a scheduled re-measurement produces
    // on a machine that has lost its network, and it is exactly where "nothing
    // found" would be a lie.
    return fact(
      "medium",
      `security — the last check could not look at anything: ${notAsked} of ${total} rungs not asked`,
    );
  }

  // At least one rung ran and nothing is open at HIGH or above. **Silence.**
  return null;
}

/**
 * The newest operating round's date, from a list of FILE NAMES, or `null`.
 *
 * PURE: it is handed the names and answers a `YYYY-MM-DD` string. **No file is
 * ever opened.** The name IS the datum — the round writes
 * `docs/reports/operations-2026-08-11.md` and its own guide says that report's
 * date and stem are the only state it creates. Opening one would put a
 * customer's own prose into a code path that runs in front of every session,
 * and the round's findings are not the greeting's business.
 *
 * Every shape it does not understand answers "I do not know" rather than
 * becoming a date: `operations.md`, `ops-2026-08-11.md`,
 * `operations-not-a-date.md` and `operations-2026-13-45.md` are all no date at
 * all. The last one is why the match is not the end of it — the pattern accepts
 * any four-two-two, so the day is parsed back and compared with what was read.
 *
 * `now` bounds the FUTURE, and the fallback is the point of the two steps: the
 * newest date at or before today wins, and a date after today is used only when
 * there is nothing else. A mistyped year (`operations-2126-…`) would otherwise
 * silence this fact for a century, while a report written today on a machine an
 * hour ahead of UTC must still count as today's.
 *
 * @param {string[] | null} names
 * @param {number} [now]
 * @returns {string | null}
 */
export function newestRoundDate(names, now = Date.now()) {
  const days = (Array.isArray(names) ? names : [])
    .map((name) => ROUND_REPORT.exec(String(name ?? ""))?.[1] ?? "")
    // `Date.parse` answers NaN for "2026-13-45" on some engines and rolls it
    // over into next year on others; the round trip refuses both readings, and
    // it is written out rather than as one expression because `toISOString()`
    // THROWS on an invalid date — an exception in front of somebody's session.
    .filter((day) => {
      if (!day) return false;
      const at = Date.parse(`${day}T00:00:00.000Z`);
      return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day;
    })
    .sort()
    .reverse();

  const today = new Date(now).toISOString().slice(0, 10);
  return days.find((day) => day <= today) ?? days[0] ?? null;
}

/**
 * The one operating-round fact, or `null` when there is nothing to say.
 *
 * PURE, on the same contract as `securityFact()` above: it takes what the
 * directory read answered and returns a fact object.
 *
 * 🚨 **`severity: "low"` is the WHOLE of this fact's ordering claim.**
 * `SEVERITIES` is `["critical", "high", "medium", "low"]` and
 * `describeOperations()` sorts by `SEVERITIES.indexOf()`, so a LOW sorts behind
 * every open security finding by construction — no special case, no second
 * criterion, nothing for a later reader to preserve by accident. The word comes
 * out of the ladder `scripts/security/rules.mjs` owns and is never a fifth
 * severity of this file's own: a second severity vocabulary here is how two
 * reports start disagreeing about one word.
 *
 * 🚨 **Silence on a fresh clone is the load-bearing case.** An app with no
 * pages and no product brief has never been live, and a greeting telling
 * somebody on day one to run an operating round on the app they have not built
 * is exactly the noise this line must not become. It mirrors `securityFact()`'s
 * own `missing` + not-`appUnderWay` case rather than inventing a second rule.
 *
 * @param {string | null} newest a `YYYY-MM-DD` from `newestRoundDate()`
 * @param {{ now?: number, appUnderWay?: boolean }} [options]
 * @returns {{ id: string, severity: string, text: string, command: string } | null}
 */
export function roundFact(newest, { now = Date.now(), appUnderWay = false } = {}) {
  const fact = (text) => ({ id: "round", severity: "low", text, command: ROUND_COMMAND });

  if (!newest) {
    if (!appUnderWay) return null;
    return fact("the operating round has never run here — nothing in docs/reports/");
  }

  const at = Date.parse(`${newest}T00:00:00.000Z`);
  // Not a date after all, so nobody knows when the round last ran. Said rather
  // than swallowed, because a name that does not parse is not evidence of a
  // recent round — but never as "never", which would be a claim about a report
  // that is plainly there.
  if (!Number.isFinite(at)) return null;
  if (now - at <= MAX_ROUND_AGE) return null;

  const days = Math.floor((now - at) / DAY);
  return fact(
    `the operating round last ran on ${newest} (${days} days ago), past the ${ROUND_DAYS}-day bound`,
  );
}

/**
 * The names in `docs/reports/`, or `[]`.
 *
 * The only impure part of the round half, and it is one synchronous directory
 * read: no network, no cache file, no TTL, no `.env`. A missing folder throws
 * `ENOENT` and answers `[]` — that is not an error state, it is the ordinary
 * state of an app nobody has inspected, since every gateway creates the folder
 * the first time it has something to write.
 */
function reportNames() {
  try {
    return readdirSync(REPORTS_DIR);
  } catch {
    return [];
  }
}

/** Unknown severities sort last rather than first — `indexOf` answers -1. */
function rank(severity) {
  const index = SEVERITIES.indexOf(severity);
  return index < 0 ? SEVERITIES.length : index;
}

/** One line, whatever a fact's text was written with. */
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/**
 * The greeting's operational line, or `""` when there is nothing to say.
 *
 * Takes `null` as readily as an array — `update-check.mjs` records what the
 * other shape cost: destructuring in the signature threw on the first real run,
 * in the hook, the one place in this project where an exception is printed
 * instead of a greeting.
 *
 * Ordered worst-first by `SEVERITIES.indexOf()`, so a severe finding is never
 * softened by being listed beside a routine one, and the line ends with the
 * command belonging to the WORST fact — the operator's next move, not an
 * average of everybody's.
 *
 * ⚠️ **The known risk, and the answer decided in advance.** One line carrying a
 * CRITICAL beside a routine fact may still soften the CRITICAL. If that is ever
 * observed, the answer is a SECOND line for CRITICAL only — one criterion
 * deciding which line something goes on, never two authors each writing their
 * own. It is written here rather than built, because building it now would cost
 * the property this file exists for on the evidence of nothing.
 *
 * @param {{ id: string, severity: string, text: string, command: string }[] | null} facts
 * @returns {string}
 */
export function describeOperations(facts) {
  const list = (Array.isArray(facts) ? facts : []).filter(Boolean);
  if (list.length === 0) return "";

  const sorted = [...list].sort((a, b) => rank(a?.severity) - rank(b?.severity));
  const worst = sorted[0];
  // No severity glyph in front of a fact, deliberately: the ORDER carries the
  // severity (worst first), and where a glyph says something a number cannot —
  // 🚨 beside a CRITICAL count — the fact's own text has already put it there.
  // A second glyph one level up would print `❌ security — ❌ 2 HIGH open`.
  const shown = sorted.slice(0, SHOWN).map((f) => oneLine(f?.text));
  const rest = sorted.length - shown.length;
  const body = shown.join(" · ") + (rest > 0 ? ` · +${rest} more` : "");
  return `[Operations: ${body}. Run: ${oneLine(worst?.command)}]`;
}

/**
 * Every operational fact this app can state without measuring anything.
 *
 * The impure function here, and the seam every later contributor joins: a new
 * fact is one reader and one `push`, with no edit to the renderer above — the
 * property `rules.mjs` gave the rung ladder, for the same reason. The round
 * fact below is what that looked like when it was collected: four lines here,
 * two pure functions above, and `describeOperations()` untouched.
 *
 * It reads one small JSON file and one directory listing. It never throws:
 * every reader it calls answers a state rather than raising, and the caller
 * wraps it anyway.
 *
 * @param {{ now?: number, appUnderWay?: boolean }} [options]
 */
export function operationalFacts({ now = Date.now(), appUnderWay = false } = {}) {
  const facts = [];
  const { state, record } = readVerdictState(now);
  const security = securityFact(state, record, { now, appUnderWay });
  if (security) facts.push(security);
  const round = roundFact(newestRoundDate(reportNames(), now), { now, appUnderWay });
  if (round) facts.push(round);
  return facts;
}
