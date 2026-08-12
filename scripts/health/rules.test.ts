// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the verdict MAKES of six answers — and the three ways it could lie.
//
// Pure: no network, no filesystem, no `process.env`, no deployed app. Every
// probe here is a stub returning the answer a real one would, so the assertions
// are about the COMPOSITION — the AC3 split, the exit-code table, the refusal of
// a reasonless skip — rather than about anybody's app on the day this ran.
//
// 🚨 **Three needles, each with its negative control**, because a needle guard
// without a needle probe proves the walk ran and not that the comparison did
// (`scripts/lib/source-text.test.ts`, `lib/setup/guard-presence.test.ts`):
//
//   1. an unreachable app is ONE finding and FIVE skips — and, the other way,
//      an app that answers produces no skips at all
//   2. a planted HIGH turns the verdict red — and a clean run does not
//   3. a `clean` probe with no evidence is refused — and one with evidence is not

import { describe, expect, it } from "vitest";

import { aggregate, failsVerdict, recordFrom, renderVerdict } from "@/scripts/security/rules.mjs";
import { PROBES, resolveHealthTarget, runProbes } from "./check.mjs";
import {
  finding,
  jobLadderFindings,
  errorLadderFindings,
  MAX_ERROR_FINDINGS,
  notAsked,
  ranClean,
  ranFound,
  UNREACHABLE_REASON,
  VERDICT_TEXTS,
} from "./rules.mjs";

const CONTEXT = { url: "https://app.example.com", env: {}, argv: [], now: new Date() };

/** A probe on the shipped shape whose answer is decided by the test. */
const probe = (id: string, run: (ctx: Record<string, unknown>) => unknown) => ({
  id,
  label: `the ${id} probe`,
  tier: 1 as const,
  covers: `what ${id} would have checked`,
  run,
});

describe("the six probes declare themselves on the shipped shape", () => {
  it("is six, in the order the reader reads them, with liveness first", () => {
    // 🚨 The order is load-bearing at exactly one point: liveness runs first and
    // every probe after it reads its outcome. A seventh probe is one entry here.
    expect(PROBES.map((p) => p.id)).toEqual([
      "liveness",
      "readiness",
      "jobs",
      "errors",
      "media",
      "ipn",
    ]);
  });

  it("each carries a covers sentence that is not merely its own name", () => {
    // `covers` is what gets printed when a probe skips, and it is the sentence
    // that stops a skip reading like a pass. "the media probe" is not one.
    for (const p of PROBES) {
      expect(p.tier).toBe(1);
      expect(p.covers.length, `${p.id} has no real covers sentence`).toBeGreaterThan(30);
      expect(p.covers.toLowerCase()).not.toMatch(new RegExp(`\\b${p.id} probe\\b`));
      expect(typeof p.run).toBe("function");
    }
  });
});

describe("AC3 — an unreachable app is one finding and five skips", () => {
  const down = () =>
    ranFound(
      [
        finding({
          severity: "critical",
          title: "Nothing answered at that address",
          where: CONTEXT.url,
          why: "nobody can reach your app",
          fix: "open your host's dashboard",
          evidence: "no answer",
        }),
      ],
      "GET /api/healthz — nothing answered",
    );

  /** The six, with liveness's answer decided by the test and the rest real-shaped. */
  const ladder = (livenessAnswer: () => unknown, asked: string[]) =>
    PROBES.map((p) =>
      p.id === "liveness"
        ? probe("liveness", livenessAnswer)
        : probe(p.id, ({ liveness }: Record<string, unknown>) => {
            if ((liveness as { state?: string })?.state === "found") {
              return notAsked(UNREACHABLE_REASON);
            }
            asked.push(p.id);
            return ranClean(`${p.id} looked and saw nothing`);
          }),
    );

  it("🚨 the needle: nothing answers → one CRITICAL, five skips, and no further requests", async () => {
    const asked: string[] = [];
    const outcomes = await runProbes(ladder(down, asked), CONTEXT);
    const summary = aggregate(outcomes);

    expect(summary.counts.critical).toBe(1);
    expect(summary.notAsked).toBe(5);
    expect(summary.complete).toBe(false);
    // "the five are not attempted, timed out five times over, and reported as
    // five separate network errors" — this is the assertion behind that clause.
    expect(asked, "a probe was attempted after the app failed to answer").toEqual([]);
    for (const outcome of outcomes.slice(1)) {
      expect(outcome.state).toBe("skipped");
      expect(outcome.reason).toBe(UNREACHABLE_REASON);
    }
  });

  it("🚨 …and the other way: with the app answering, NONE of the five is a skip", async () => {
    // Without this half, the test above passes against a command that skips
    // everything always — which is green for the same reason a broken command is.
    const asked: string[] = [];
    const outcomes = await runProbes(ladder(() => ranClean("200 ok"), asked), CONTEXT);
    const summary = aggregate(outcomes);

    expect(summary.notAsked).toBe(0);
    expect(summary.complete).toBe(true);
    expect(asked.length).toBe(5);
  });

  it("a readiness finding does NOT stop the other four", async () => {
    // The app is serving; what it can still answer is worth having.
    const asked: string[] = [];
    const ladder2 = PROBES.map((p) => {
      if (p.id === "liveness") return probe("liveness", () => ranClean("200 ok"));
      if (p.id === "readiness") {
        return probe("readiness", () =>
          ranFound(
            [
              finding({
                severity: "critical",
                title: "The app is up, and its database does not answer",
                where: CONTEXT.url,
                why: "nobody can sign in",
                fix: "look at the database add-on",
                evidence: "HTTP 503",
              }),
            ],
            "GET /api/readyz — HTTP 503",
          ),
        );
      }
      return probe(p.id, () => {
        asked.push(p.id);
        return ranClean(`${p.id} looked`);
      });
    });

    const outcomes = await runProbes(ladder2, CONTEXT);
    expect(asked).toEqual(["jobs", "errors", "media", "ipn"]);
    expect(aggregate(outcomes).counts.critical).toBe(1);
  });
});

describe("AC2 — nothing is green while something was unanswered", () => {
  it("🚨 refuses a skip that cannot say why — inherited, not caught", async () => {
    // `aggregate()`'s own throw. This command does not rescue it: a blank skip
    // is a tick with a different glyph, and that is the failure the whole
    // ladder exists to prevent.
    const outcomes = await runProbes(
      [probe("liveness", () => ({ state: "skipped", reason: "   ", findings: [] }))],
      CONTEXT,
    );
    expect(() => aggregate(outcomes)).toThrow(/skipped without a reason/);
  });

  it("a probe that THROWS becomes that probe's skip and does not end the run", async () => {
    const outcomes = await runProbes(
      [
        probe("liveness", () => {
          throw new Error("the probe itself blew up");
        }),
        probe("readiness", () => ranClean("still asked")),
      ],
      CONTEXT,
    );
    expect(outcomes[0]).toMatchObject({ state: "skipped", reason: "the probe itself blew up" });
    expect(outcomes[1].state).toBe("clean");
  });

  it("the record carries complete:false and numbers only", async () => {
    const outcomes = await runProbes(
      [
        probe("liveness", () => ranClean("200 ok")),
        probe("ipn", () => notAsked("no DIAGNOSTICS_SECRET_PROD in the .env")),
      ],
      CONTEXT,
    );
    const record = recordFrom(outcomes, { now: Date.parse("2026-08-10T12:00:00Z"), template: "0.24.0" });

    expect(record.complete).toBe(false);
    expect(record.rungs).toEqual([
      { id: "liveness", state: "clean" },
      { id: "ipn", state: "skipped", reason: "no DIAGNOSTICS_SECRET_PROD in the .env" },
    ]);
    // 🚨 No address, no finding, no evidence. This shape has to survive a
    // journey into a scheduled job's one line of numbers (docs/cron.md).
    expect(JSON.stringify(record)).not.toContain("app.example.com");
    expect(JSON.stringify(record)).not.toContain("200 ok");
  });
});

describe("AC7 — the exit-code table", () => {
  it("2 when there is no address to ask, and it is never 'passed'", () => {
    const answer = resolveHealthTarget({}, []);
    expect("reason" in answer).toBe(true);
    expect((answer as { reason: string }).reason).toContain("no address to ask");
  });

  it("allows a local address — unlike the security ladder's live rung", () => {
    // "is my app up" is a perfectly good question to ask of node run.mjs start,
    // and `make deploy-test` asks exactly that.
    expect(resolveHealthTarget({}, ["--url", "http://localhost:3007"])).toMatchObject({
      url: "http://localhost:3007",
      from: "--url",
      local: true,
    });
  });

  it("prefers production over staging over APP_URL", () => {
    const env = {
      APP_URL: "http://localhost:3000",
      APP_URL_STAGING: "https://staging.example.com",
      APP_URL_PROD: "https://app.example.com",
    };
    expect(resolveHealthTarget(env, [])).toMatchObject({ from: "APP_URL_PROD" });
    expect(resolveHealthTarget({ ...env, APP_URL_PROD: "" }, [])).toMatchObject({
      from: "APP_URL_STAGING",
    });
  });

  it("🚨 the needle: a planted HIGH turns the verdict red, and a clean run does not", async () => {
    // Without the second half this passes against a broken aggregator that
    // finds nothing — which is exactly what "green" would then mean.
    const red = await runProbes(
      [
        probe("liveness", () => ranClean("200 ok")),
        probe("errors", () =>
          ranFound(
            [
              finding({
                severity: "high",
                title: "FORMATTING_ERROR: Invalid time value",
                where: "app/dashboard/page.tsx:12",
                why: "the page answered 200 and rendered a broken value",
                fix: "open the page and look at it",
                evidence: "seen 3× in the last 34 line(s)",
              }),
            ],
            "1 distinct cause(s) in the last 34 line(s)",
          ),
        ),
      ],
      CONTEXT,
    );
    expect(failsVerdict(aggregate(red).counts)).toBe(true);

    const green = await runProbes([probe("liveness", () => ranClean("200 ok"))], CONTEXT);
    expect(failsVerdict(aggregate(green).counts)).toBe(false);
  });

  it("a skip does NOT raise the exit code", () => {
    // A missing credential is a skip, not a failure — a command that failed
    // because somebody has not set CRON_SECRET_PROD yet is one people stop
    // running. What a skip does instead is say so, loudly.
    const summary = aggregate([
      { id: "jobs", label: "j", covers: "c", state: "skipped", reason: "no secret", findings: [] },
    ]);
    expect(summary.failing).toBe(false);
    expect(summary.notAsked).toBe(1);
  });

  it("a MEDIUM alone does not fail the verdict", () => {
    const summary = aggregate([
      {
        id: "ipn",
        label: "i",
        covers: "c",
        state: "found",
        reason: "",
        evidence: "",
        findings: [
          finding({
            severity: "medium",
            title: "No payment notification for 9 day(s)",
            where: "x",
            why: "y",
            fix: "z",
            evidence: "e",
          }),
        ],
      },
    ]);
    expect(summary.failing).toBe(false);
    expect(summary.counts.medium).toBe(1);
  });
});

describe("🚨 clean is never bare — the ipn tick that reads as 'payments are arriving'", () => {
  it("refuses a clean answer with no evidence, and accepts one with it", async () => {
    // The needle and its control in one. `ranClean("")` throwing is what stops a
    // ✓ appearing beside `ipn` with nothing under it — and the caller's own
    // try/catch turns that into a skip naming itself, which is the honest
    // answer: nothing was shown.
    expect(() => ranClean("")).toThrow(/must say what it looked at/);
    expect(() => ranClean("   ")).toThrow(/must say what it looked at/);
    expect(ranClean("this app has no Digistore24 product configured")).toMatchObject({
      state: "clean",
      evidence: "this app has no Digistore24 product configured",
    });

    const outcomes = await runProbes([probe("ipn", () => ranClean(""))], CONTEXT);
    expect(outcomes[0].state).toBe("skipped");
    expect(outcomes[0].reason).toMatch(/must say what it looked at/);
  });

  it("🚨 …and a probe WITH findings still says what it looked at", async () => {
    // Found against a real deployed app before this guard existed: `· Its media
    // store answers — 1 finding(s)` and nothing under it, between five probes
    // that each named their request. `formatRan()` prints the evidence for both
    // states, so both states owe one.
    expect(() => ranFound([], "")).toThrow(/must still say what it looked at/);
    const outcomes = await runProbes(
      [probe("media", () => ranFound([], "GET /api/diagnostics/health — the store answered"))],
      CONTEXT,
    );
    // `outcomeFrom()` refuses `found` with no findings, so this became a skip —
    // which is the honest answer and is not what is being asserted here; the
    // assertion is the throw above.
    expect(outcomes[0].state).toBe("skipped");
  });

  it("🚨 the planted-empty needle: without the evidence the ✓ really is bare", async () => {
    // The story's third needle, planted rather than argued. `outcomeFrom()` lets
    // an evidence-free `clean` through — it only refuses a state that
    // contradicts its own findings — so the ONLY thing between an `ipn` probe
    // and a tick that reads as "payments are arriving" is `ranClean()`. This
    // measures both sides of that through the shipped renderer.
    const withEvidence = await runProbes(
      [probe("ipn", () => ranClean("this app has no Digistore24 product for that environment"))],
      CONTEXT,
    );
    const spoken = renderVerdict(withEvidence, VERDICT_TEXTS);
    expect(spoken).toContain("✓ the ipn probe");
    expect(spoken).toContain("no Digistore24 product");

    const planted = await runProbes(
      [probe("ipn", () => ({ state: "clean", findings: [], evidence: "" }))],
      CONTEXT,
    );
    const bare = renderVerdict(planted, VERDICT_TEXTS);
    expect(bare).toContain("✓ the ipn probe");
    // This is the defect, reproduced: a tick with nothing under it. Every real
    // probe goes through `ranClean()` so it cannot happen — and the assertion
    // above it is what proves `ranClean()` is doing the stopping.
    expect(bare.split("\n").filter((line) => line.startsWith("    "))).toEqual([]);
  });
});

describe("the finding shape", () => {
  it("refuses a severity outside the shipped ladder", () => {
    expect(() =>
      finding({ severity: "warning", title: "t", where: "w", why: "y", fix: "f", evidence: "e" }),
    ).toThrow(/not one of the shipped severities/);
  });

  it("refuses an empty label — an empty Fix: is a finding nobody can act on", () => {
    for (const missing of ["title", "where", "why", "fix", "evidence"]) {
      const base: Record<string, string> = {
        severity: "high",
        title: "t",
        where: "w",
        why: "y",
        fix: "f",
        evidence: "e",
      };
      base[missing] = "  ";
      expect(() => finding(base as never), `an empty ${missing} was accepted`).toThrow(
        new RegExp(`needs a ${missing}`),
      );
    }
  });

  it("🚨 AC4 — the Fix reads as an instruction, not as a log excerpt", () => {
    // Sampled rather than asserted per probe: what is being held here is that
    // the sentences are sentences. A `Fix:` that quotes a stack trace is the
    // failure NFR-62 names, and it looks like a fix until somebody reads it.
    const jobs = jobLadderFindings(
      [{ job: "prune-ai-usage", kind: "neverRun", severity: "medium", what: "enabled and has never run" }],
      "https://app.example.com",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].fix.length).toBeGreaterThan(60);
    expect(jobs[0].fix).toMatch(/^[A-Z]/);
    expect(jobs[0].where).toContain("prune-ai-usage");
    expect(jobs[0].severity).toBe("medium");
  });

  it("re-rates nothing — the scheduler's own severity travels through", () => {
    const out = jobLadderFindings(
      [
        { job: "a", kind: "failures", severity: "high", what: "1 of 4 run(s) failed" },
        { job: "b", kind: "overdue", severity: "medium", what: "late" },
      ],
      "https://app.example.com",
    );
    expect(out.map((f) => f.severity)).toEqual(["high", "medium"]);
  });
});

describe("the error window, capped", () => {
  const cause = (n: number) => ({
    message: `Error ${n}`,
    location: `app/page-${n}.tsx:1`,
    frame: null,
    count: 2,
  });

  it("names one HIGH per distinct cause", () => {
    const { findings, more } = errorLadderFindings([cause(1), cause(2)], "in the last 34 line(s)", "u");
    expect(findings).toHaveLength(2);
    expect(more).toBe(0);
    expect(findings.every((f) => f.severity === "high")).toBe(true);
    expect(findings[0].evidence).toContain("seen 2×");
    expect(findings[0].evidence).toContain("in the last 34 line(s)");
  });

  it("🚨 caps the block so one bad deploy cannot bury the other five probes", () => {
    const many = Array.from({ length: MAX_ERROR_FINDINGS + 3 }, (_, i) => cause(i));
    const { findings, more } = errorLadderFindings(many, "w", "u");
    expect(findings).toHaveLength(MAX_ERROR_FINDINGS);
    // Counted, never dropped in silence.
    expect(more).toBe(3);
  });

  it("survives an answer that is not a list", () => {
    expect(errorLadderFindings(null as never, "w", "u")).toEqual({ findings: [], more: 0 });
  });
});

describe("the closing words are this ladder's own", () => {
  it("names probes rather than rungs, and does not send the reader to security-gateway", () => {
    expect(VERDICT_TEXTS.noun).toBe("probe");
    expect(VERDICT_TEXTS.judgement).not.toContain("security-gateway");
    // The other command's sentence is the wrong skill for "your app is down",
    // and a doc that does not exist yet would be worse than one that does.
    expect(VERDICT_TEXTS.judgement).toContain("docs/DEPLOY.md");
  });
});

describe("this command is in no gate — measured, not promised", () => {
  it("🚨 is absent from run.mjs's `test` task", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("run.mjs", "utf8");
    const task = /\n {2}test: \{[\s\S]*?\n {2}\},/.exec(source);
    expect(task, "the `test` task could not be read out of run.mjs").not.toBeNull();
    expect(task![0]).not.toContain("health");
    expect(task![0]).not.toContain("scripts/health/");
  });

  it("is registered without `needs` — it has to work when the app has fallen over", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("run.mjs", "utf8");
    const entry = /\n {2}health: \{[\s\S]*?\n {2}\},/.exec(source);
    expect(entry, "the `health` task could not be read out of run.mjs").not.toBeNull();
    expect(entry![0]).not.toMatch(/\bneeds:/);
    expect(entry![0]).toContain("scripts/health/check.mjs");
  });
});

describe("the transport", () => {
  it("🚨 every request is manual-redirect and bounded — asserted on the source", async () => {
    // A followed 307 hands back somebody else's 200 and carries the bearer token
    // there (Story 32.2, Deviation 3). Asserted on the text because the property
    // is about every call site rather than about one answer.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { blankComments } = await import("@/scripts/lib/source-text.mjs");

    const files = [
      "scripts/health/check.mjs",
      "scripts/health/rules.mjs",
      "scripts/health/record.mjs",
      ...readdirSync("scripts/health/probes").map((f) => `scripts/health/probes/${f}`),
    ];
    for (const file of files) {
      const source = blankComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/fetch\(/g)) {
        const block = source.slice(match.index, match.index + 400);
        expect(block, `${file}: a fetch without redirect: manual`).toContain('redirect: "manual"');
        expect(block, `${file}: a fetch without a timeout`).toContain("AbortSignal.timeout");
      }
      // No shell, no process, no curl — `scripts/portability.test.ts` covers the
      // tool names; this is the one that would otherwise only be a comment.
      expect(source, `${file}: spawns a process`).not.toContain("child_process");
    }
  });
});
