// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The history rung's discriminator — the line that tells *clean* from *nobody
// asked*, and the two ways it can be wrong.
//
// ⚠️ **Pure.** `vitest.config.ts` puts every `.test.ts` under `template/` inside
// `npm run test` and therefore inside `make check`, and `security-check` must
// never become a gate (NFR-64, and `check.mjs`'s own header). So nothing here
// spawns gitleaks, reads a repository or starts a clock. What the rung does
// against a real gitleaks is proven by running the command; what lives here is
// the one decision it makes once the tool has stopped talking.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// `history.mjs` reaches this decision three ways and they must never be merged:
// the bound stopped an attempt, the shared budget ran out before the next
// spelling could start, or the tool was here and failed for its own reason.
// Until 2026-08-12 the first of those was DERIVED — `Date.now() - started >=
// TIMEOUT_MS` — and a wall clock steps. Measured against that revision: a
// gitleaks that refused its config and exited 1 after **12 ms**, with the clock
// stepped forward once mid-run, was reported as
// `gitleaks did not finish within 60s and was stopped — a partial scan is not a
// pass`, and the tool's own error line — the only sentence naming the real
// fault — was dropped. `capture()` has returned the fact as `result.timedOut`
// since Story A38; the rung reads it now, and the two tests at the foot of this
// file are what keeps it reading it.
//
// The text scan goes through `blankComments()` from
// `scripts/lib/source-text.mjs` — never its own regex (CLAUDE.md → Rules).
// Without it this file's own prose, which quotes the removed expression twice,
// would fail the very assertion it exists to make.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "../../lib/source-text.mjs";
import { TIMEOUT_MS, noReportReason, spendBudget } from "./history.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = blankComments(readFileSync(path.join(HERE, "history.mjs"), "utf8"));

/** What gitleaks says when it will not load a config — the shape that was measured. */
const REFUSED = 'FTL Failed to load config error="\'Rules[0].AllowList\' expected a map, got \'slice\'"';

/**
 * A gitleaks whose behaviour this test decides, and a clock this test winds.
 *
 * `spendBudget()` takes both, which is what makes the two attempts measurable at
 * all — before this the loop could only be reached by installing gitleaks and
 * waiting a minute, so nothing in the tree ever ran it.
 */
function planted(script: {
  answers: { ms: number; timedOut?: boolean; stderr?: string; report?: object[] | null }[];
}) {
  let clock = 1_000_000;
  const seen: { args: string[]; timeoutMs: number }[] = [];
  let report: object[] | null = null;
  let turn = 0;

  return {
    seen,
    now: () => clock,
    readBack: () => report,
    attempt: async (args: string[], timeoutMs: number) => {
      seen.push({ args, timeoutMs });
      const answer = script.answers[turn] ?? { ms: 0 };
      turn += 1;
      // The tool cannot run longer than it was allowed to — that is what the
      // bound means, and a fake that ignored it would measure nothing.
      clock += Math.min(answer.ms, timeoutMs);
      report = answer.report ?? null;
      return {
        code: answer.timedOut || answer.stderr ? 1 : 0,
        stdout: "",
        stderr: answer.stderr ?? "",
        timedOut: Boolean(answer.timedOut),
      };
    },
  };
}

const BUDGET = 60_000;

// ── the loop, driven ────────────────────────────────────────────────────────

describe("spendBudget() runs both spellings against one budget and reports facts", () => {
  it("takes the first spelling that leaves a report and never tries the second", () => {
    // Non-vacuity for everything below: a loop that ran nothing would satisfy
    // most of the negative assertions in this block.
    const tool = planted({ answers: [{ ms: 400, report: [] }] });
    return spendBudget({
      list: [["git", "/repo"], ["detect", "--source", "/repo"]],
      budgetMs: BUDGET,
      ...tool,
    }).then((outcome) => {
      expect(tool.seen).toHaveLength(1);
      expect(outcome.spelling).toBe("git");
      expect(outcome.rows).toEqual([]);
      expect(outcome.stopped).toBe(false);
      expect(outcome.budgetSpent).toBe(false);
    });
  });

  it("falls through to the older spelling, and hands it what is LEFT of the budget", async () => {
    const tool = planted({
      answers: [{ ms: 25_000, stderr: "unknown command" }, { ms: 300, report: [{ RuleID: "x" }] }],
    });
    const outcome = await spendBudget({
      list: [["git", "/repo"], ["detect", "--source", "/repo"]],
      budgetMs: BUDGET,
      ...tool,
    });
    expect(tool.seen.map((call) => call.args[0])).toEqual(["git", "detect"]);
    // 🚨 The line the rung's header is about: 60 s and 60 s would be a two-minute
    // wall clock wearing a one-minute label.
    expect(tool.seen[0].timeoutMs).toBe(BUDGET);
    expect(tool.seen[1].timeoutMs).toBe(BUDGET - 25_000);
    expect(outcome.spelling).toBe("detect");
    expect(outcome.rows).toHaveLength(1);
  });

  it("🚨 reports a stopped attempt as stopped — capture()'s fact, carried through", async () => {
    const tool = planted({ answers: [{ ms: BUDGET, timedOut: true }] });
    const outcome = await spendBudget({
      list: [["git", "/repo"], ["detect", "--source", "/repo"]],
      budgetMs: BUDGET,
      ...tool,
    });
    expect(outcome.stopped).toBe(true);
    expect(outcome.rows).toBeNull();
    // …and the sentence that comes out of it is the bound's, not the tool's.
    expect(noReportReason(outcome)).toContain("was stopped");
  });

  it("🚨 does not call a tool that FAILED stopped, however long it took", async () => {
    // The planted defect of A73, at the level the rung actually runs: gitleaks
    // was here, answered fast and refused its config. Under the old derivation
    // this run's reason depended on what a wall clock happened to say.
    const tool = planted({ answers: [{ ms: 12, stderr: REFUSED }, { ms: 9, stderr: REFUSED }] });
    const outcome = await spendBudget({
      list: [["git", "/repo"], ["detect", "--source", "/repo"]],
      budgetMs: BUDGET,
      ...tool,
    });
    expect(outcome.stopped).toBe(false);
    expect(outcome.budgetSpent).toBe(false);
    expect(noReportReason(outcome)).toContain("Failed to load config");
    expect(noReportReason(outcome)).not.toContain("was stopped");
  });

  it("never starts an attempt there is no budget left for, and says which fact that was", async () => {
    // The narrow window: the first attempt used the budget up without being
    // stopped by it. Nothing was killed — so `stopped` must stay false, and the
    // second spelling must not be started with a bound of zero or less.
    const tool = planted({ answers: [{ ms: BUDGET, stderr: "died on its own" }] });
    const outcome = await spendBudget({
      list: [["git", "/repo"], ["detect", "--source", "/repo"]],
      budgetMs: BUDGET,
      ...tool,
    });
    expect(tool.seen).toHaveLength(1);
    expect(outcome.budgetSpent).toBe(true);
    expect(outcome.stopped).toBe(false);
    expect(noReportReason(outcome)).toContain("budget is spent");
    expect(noReportReason(outcome)).toContain("died on its own");
  });

  it("carries a stopped FIRST attempt through even when a later one answers", async () => {
    // A run in which anything was killed by the bound is not a clean run, and a
    // second spelling that happens to answer cannot make it one.
    const tool = planted({
      answers: [{ ms: 10_000, timedOut: true }, { ms: 200, report: [] }],
    });
    const outcome = await spendBudget({
      list: [["git", "/repo"], ["detect", "--source", "/repo"]],
      budgetMs: BUDGET,
      ...tool,
    });
    expect(outcome.rows).toEqual([]);
    expect(outcome.stopped).toBe(true);
  });
});

// ── the three answers ───────────────────────────────────────────────────────

describe("noReportReason() keeps the three ways of having no report apart", () => {
  it("names the BOUND when capture() says an attempt was stopped", () => {
    const reason = noReportReason({ stopped: true, last: { stderr: "" } });
    expect(reason).toContain(`did not finish within ${TIMEOUT_MS / 1000}s`);
    expect(reason).toContain("was stopped");
    // The half that stops a skip reading like a pass.
    expect(reason).toContain("a partial scan is not a pass");
  });

  it("🚨 never turns a tool that FAILED into a tool that was stopped", () => {
    // The planted defect, in the shape it really occurred: gitleaks was here,
    // answered in milliseconds, and refused its config. Nothing timed out.
    const reason = noReportReason({ stopped: false, last: { stderr: REFUSED } });
    expect(reason).not.toContain("did not finish");
    expect(reason).not.toContain("was stopped");
    // And the operator gets the line that says what to fix — the half the old
    // derivation threw away whenever it guessed wrong.
    expect(reason).toContain("Failed to load config");
  });

  it("says so plainly when the tool failed and said nothing at all", () => {
    expect(noReportReason({ last: { stderr: "", stdout: "" } })).toBe(
      "gitleaks wrote no report and said nothing",
    );
    // Called with nothing at all it must still answer, and must not claim a bound.
    expect(noReportReason()).not.toContain("was stopped");
  });

  it("gives the spent BUDGET its own sentence — nothing was stopped there", () => {
    // The shared budget is not the same question as one attempt's bound: an
    // attempt that never started was not killed, and telling the operator it was
    // sends them after a hung tool that does not exist.
    const reason = noReportReason({ budgetSpent: true, last: { stderr: REFUSED } });
    expect(reason).toContain(`${TIMEOUT_MS / 1000}s budget is spent`);
    expect(reason).not.toContain("was stopped");
    // Still carrying what the last attempt said — that is the point of not
    // folding this into the bound's sentence.
    expect(reason).toContain("Failed to load config");
  });

  it("lets the BOUND win when both are true — an attempt really was killed", () => {
    // The ordinary shape of a timeout: the attempt is stopped, and the budget it
    // was spending is gone by the same act. One event, and the sentence has to be
    // about the event rather than about its side effect.
    const reason = noReportReason({ stopped: true, budgetSpent: true, last: { stderr: REFUSED } });
    expect(reason).toContain("was stopped");
    expect(reason).not.toContain("budget is spent");
  });

  it("never lets a reason grow past what the record keeps", () => {
    // `unanswered()` caps at MAX_REASON_LENGTH and cuts mid-word; the fixed half
    // of each sentence has to fit before the tool's own text is pasted in, or the
    // part that survives is the part nobody needs.
    for (const outcome of [
      { stopped: true },
      { budgetSpent: true },
      { last: { stderr: "" } },
    ]) {
      expect(noReportReason(outcome).length).toBeLessThanOrEqual(120);
    }
  });
});

// ── the fact, not the estimate ──────────────────────────────────────────────

describe("the rung reads capture()'s answer instead of a wall clock", () => {
  it("🚨 derives no bound from a subtraction of clock readings", () => {
    // The exact shape that was there, and any respelling of it: a `Date.now()`
    // difference compared against the rung's own limit. `blankComments()` above
    // is what keeps this from firing on the paragraphs that quote it.
    expect(
      SOURCE,
      "history.mjs compares a Date.now() difference against TIMEOUT_MS again — that is an estimate where capture() has the fact",
    ).not.toMatch(/Date\.now\(\)[^;]*[<>]=?\s*TIMEOUT_MS/);
    expect(SOURCE).not.toMatch(/TIMEOUT_MS\s*[<>]=?[^;]*Date\.now\(\)/);
  });

  it("hands the facts it collected to the decision, unchanged", () => {
    // ⚠️ The one claim in this file that only source text can make, and it is
    // said out loud rather than left implied: `run()` needs a real gitleaks and a
    // real repository, so nothing in `npm run test` can reach the line that wires
    // the measured loop to the measured decision. A needle that puts the wall
    // clock back into `run()` moves this assertion and no other.
    expect(
      SOURCE,
      "history.mjs no longer passes spendBudget()'s own facts to noReportReason() — something is deciding on its own again",
    ).toMatch(/noReportReason\(\{\s*stopped,\s*budgetSpent,\s*last\s*\}\)/);
  });

  it("reads result.timedOut, and the loop that reads it is still there", () => {
    // Non-vacuity for the assertion above: a file emptied of its scan loop would
    // pass it in full. Both halves have to be present for the negative to mean
    // anything.
    expect(SOURCE).toMatch(/\.timedOut/);
    expect(SOURCE).toMatch(/capture\("gitleaks"/);
    expect(SOURCE).toMatch(/noReportReason\(/);
  });

  it("still spends a clock on the BUDGET, which is the one honest use of one", () => {
    // Handing the second spelling what is left of the shared 60 s does need a
    // clock — but it decides how much time to GIVE, never what the answer WAS.
    // The arithmetic itself is measured in `spendBudget()` above; this is the
    // proof it is still the RUNG's own 60 s being divided up.
    expect(SOURCE).toMatch(/remaining\s*=\s*budgetMs\s*-\s*\(now\(\)\s*-\s*started\)/);
    expect(SOURCE).toMatch(/budgetMs:\s*TIMEOUT_MS/);
  });

  it("the scanner can see the pattern it forbids — a probe, not a hope", () => {
    // A negative assertion over source is worth exactly as much as the proof that
    // its pattern is findable at all. This is that proof, on a planted string.
    const planted = blankComments(
      "// Date.now() - started >= TIMEOUT_MS in prose stays invisible\n" +
        "if (Date.now() - started >= TIMEOUT_MS) return unanswered('…');\n",
    );
    expect(planted).toMatch(/Date\.now\(\)[^;]*[<>]=?\s*TIMEOUT_MS/);
    // …and the same line as PROSE alone does not trip it, which is why the
    // paragraphs above this file's imports are allowed to quote it.
    const proseOnly = blankComments("// Date.now() - started >= TIMEOUT_MS was the old shape\n");
    expect(proseOnly).not.toMatch(/Date\.now\(\)[^;]*[<>]=?\s*TIMEOUT_MS/);
  });
});
