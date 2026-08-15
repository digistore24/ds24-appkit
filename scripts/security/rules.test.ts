// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs security-check` is only worth having if a green run means
// something, and there are exactly two ways for it to stop meaning anything:
//
//   1. a rung that could not look reports "clean", and nobody ever learns that
//      half the ladder went unasked;
//   2. the aggregator quietly stops seeing findings, and every run is green
//      because nothing reaches it.
//
// Both are tested here, and the second one needs a NEEDLE: a planted HIGH
// finding that MUST turn the verdict red. Without it, a broken aggregator
// passes this file by finding nothing — which is the failure mode of every test
// written around a check that reports emptiness.
//
// ⚠️ **This file is pure on purpose.** `vitest.config.ts` includes
// `**/*.test.ts`, so anything placed here runs inside every `npm run test` — and
// `security-check` must never become a gate. Nothing below touches the network,
// spawns a process or reads a file. The rung's own correctness is proven by
// running the command; what lives here is the arithmetic and the two formats.

import { describe, expect, it } from "vitest";

import {
  ACCEPTED_GLYPH,
  MAX_RECORD_AGE,
  NOT_ASKED_GLYPH,
  RECORD_VERSION,
  RUNG_STATES,
  SEVERITIES,
  SEVERITY_GLYPHS,
  aggregate,
  countBySeverity,
  failsVerdict,
  formatFinding,
  formatSkip,
  outcomeFrom,
  partitionAccepted,
  recordFrom,
  recordIsStale,
  renderVerdict,
  tallyLine,
} from "./rules.mjs";
import { ACCEPTED_ADVISORIES, acceptedIds } from "./accepted.mjs";
import { RUNGS } from "./check.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

const rung = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: `${id} rung`,
  tier: 1,
  covers: `what the ${id} rung would have checked`,
  run: async () => ({ state: "clean", findings: [] }),
  ...extra,
});

const finding = (severity: string, extra: Record<string, unknown> = {}) => ({
  severity,
  title: `a ${severity} thing`,
  where: "somewhere",
  why: "because",
  fix: "do this",
  evidence: "seen",
  source: "npm audit",
  ...extra,
});

const outcome = (id: string, result: Record<string, unknown>) =>
  outcomeFrom(rung(id), result);

// ── the shipped formats ─────────────────────────────────────────────────────

describe("a finding is printed in the shape every gateway here uses", () => {
  // Taken verbatim out of .claude/skills/security-gateway/SKILL.md. The command
  // and the skill's report have to render the same finding the same way, and the
  // only way to keep that true is to hold the code against the example rather
  // than against a description of it.
  const SHIPPED = [
    "🚨 CRITICAL — Admin action reachable without an owner check",
    "   Where:    app/dashboard/admin/users/actions.ts:34",
    "   Why:      A server action is an HTTP endpoint. Any signed-in member can POST",
    "             to it and change another member's role.",
    "   Fix:      requireOwner() at the top of the action, before the first query.",
    "   Evidence: The action calls auth() but never checks session.user.role.",
  ].join("\n");

  it("reproduces the shipped example character for character", () => {
    expect(
      formatFinding({
        severity: "critical",
        title: "Admin action reachable without an owner check",
        where: "app/dashboard/admin/users/actions.ts:34",
        why:
          "A server action is an HTTP endpoint. Any signed-in member can POST to it " +
          "and change another member's role.",
        fix: "requireOwner() at the top of the action, before the first query.",
        evidence: "The action calls auth() but never checks session.user.role.",
        source: "read",
      }),
    ).toBe(SHIPPED);
  });

  it("keeps the four labels in their order, whatever the severity", () => {
    const lines = formatFinding(finding("low")).split("\n");
    expect(lines[0].startsWith(SEVERITY_GLYPHS.low)).toBe(true);
    expect(lines.slice(1).map((line) => line.trim().split(":")[0])).toEqual([
      "Where",
      "Why",
      "Fix",
      "Evidence",
    ]);
  });

  it("aligns a wrapped value with the column its label opened", () => {
    const block = formatFinding(finding("high", { why: "word ".repeat(40).trim() }));
    const wrapped = block.split("\n").filter((line) => /^ {13}\S/.test(line));
    expect(wrapped.length).toBeGreaterThan(0);
  });
});

describe("the tally line", () => {
  it("is the report header, in the shipped glyph order", () => {
    expect(tallyLine({ critical: 0, high: 2, medium: 3, low: 1, accepted: 2 })).toBe(
      "🚨 CRITICAL 0   ❌ HIGH 2   ⚠️ MEDIUM 3   ℹ️ LOW 1   ✅ accepted 2",
    );
  });

  it("appends `not asked` only when something was not asked", () => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, accepted: 0 };
    expect(tallyLine(counts, 0)).not.toContain(NOT_ASKED_GLYPH);
    expect(tallyLine(counts, 2)).toContain(`${NOT_ASKED_GLYPH} not asked 2`);
  });
});

// ── the three states, and the refusals that keep them apart ─────────────────

describe("a rung reports one of exactly three states", () => {
  it("names them, and nothing else", () => {
    expect(RUNG_STATES).toEqual(["clean", "found", "skipped"]);
  });

  it("refuses a skip that carries no reason, naming the rung — at INTAKE", () => {
    // 🚨 The refusal moved from `aggregate()` to `outcomeFrom()` on 2026-08-15,
    // and that is the whole fix: `aggregate()` runs inside `recordFrom()`, which
    // `securityCheck()` calls OUTSIDE the per-rung `try`. One rung skipping
    // without a reason therefore threw past every other rung's result and past
    // `writeVerdict()`, leaving the PREVIOUS run's record on disk — which the
    // greeting reports as today's "ok" for up to seven days. Refused here, the
    // same mistake is caught by the per-rung `catch` and becomes one honest skip.
    expect(() => outcome("advisories", { state: "skipped", findings: [] })).toThrow(/advisories/);
    expect(() => outcome("advisories", { state: "skipped", findings: [] })).toThrow(
      /without a reason/,
    );
    // Whitespace is not a reason either — that is the shape a placeholder takes.
    expect(() => outcome("advisories", { state: "skipped", reason: "   ", findings: [] })).toThrow(
      /without a reason/,
    );
  });

  it("…and `aggregate()` still refuses one, for an outcome built by hand", () => {
    // Defence in depth, deliberately kept: `aggregate()` is exported and the
    // health command builds outcomes of its own. A guard at the door does not
    // excuse the guard at the till.
    const byHand = { id: "advisories", state: "skipped", reason: "", findings: [] };
    expect(() => aggregate([byHand])).toThrow(/without a reason/);
  });

  it("refuses a state nobody has defined, naming the rung", () => {
    expect(() =>
      aggregate([{ ...outcome("live", { state: "clean", findings: [] }), state: "unknown" }]),
    ).toThrow(/live/);
  });

  it("refuses a rung whose state contradicts its own findings", () => {
    expect(() =>
      outcomeFrom(rung("advisories"), { state: "clean", findings: [finding("high")] }),
    ).toThrow(/advisories/);
    expect(() => outcomeFrom(rung("advisories"), { state: "found", findings: [] })).toThrow(
      /advisories/,
    );
  });
});

describe("a skip is never a pass", () => {
  const skipped = outcome("live", {
    state: "skipped",
    reason: "no deployed address to check",
    findings: [],
  });

  it("prints the reason AND what nobody therefore looked at", () => {
    const block = formatSkip(skipped);
    expect(block).toContain("no deployed address to check");
    expect(block).toContain("what the live rung would have checked");
  });

  it("never renders as a tick", () => {
    expect(formatSkip(skipped)).not.toContain("✓");
    expect(formatSkip(skipped)).toContain(NOT_ASKED_GLYPH);
  });

  it("does not raise the exit code — an absent answer is not a failure", () => {
    const summary = aggregate([skipped]);
    expect(summary.failing).toBe(false);
    expect(summary.notAsked).toBe(1);
    expect(summary.complete).toBe(false);
  });

  it("makes the closing line say so, instead of saying clean", () => {
    const allRan = renderVerdict([outcome("advisories", { state: "clean", findings: [] })]);
    const oneSkipped = renderVerdict([
      outcome("advisories", { state: "clean", findings: [] }),
      skipped,
    ]);

    expect(allRan).toContain("every rung ran");
    expect(allRan).not.toContain("not asked");

    expect(oneSkipped).toContain("Nothing found in the rungs that ran");
    expect(oneSkipped).toContain("1 rung(s) were not asked");
    expect(oneSkipped).not.toContain("every rung ran");
    // The two must not be one sentence with a number swapped in: "clean" and
    // "nobody asked" are different claims, and this is the line that says which.
    expect(allRan).not.toBe(oneSkipped);
  });

  it("🚨 the second ladder's seam changes nothing when nobody uses it", () => {
    // `node run.mjs health` runs six probes on this same interface and closes
    // with different words: "the judgement half is the skill: security-gateway"
    // is the wrong skill for "your app is down". It got an optional argument
    // rather than a second renderer — two renderers is how two ladders come to
    // disagree about a glyph — and this is the assertion that the DEFAULT is
    // still byte for byte what it always was.
    const outcomes = [
      outcome("advisories", { state: "clean", findings: [] }),
      outcome("osv", { state: "found", findings: [finding("high")] }),
      skipped,
    ];
    expect(renderVerdict(outcomes, {})).toBe(renderVerdict(outcomes));
    expect(renderVerdict(outcomes)).toContain("The judgement half is the skill: security-gateway");

    // …and that it really is a seam: the other caller's words come out.
    const other = renderVerdict(outcomes, { judgement: "Read docs/DEPLOY.md", noun: "probe", plural: "probes" });
    expect(other).toContain("Read docs/DEPLOY.md");
    expect(other).toContain("1 probe(s) were not asked");
    expect(other).not.toContain("security-gateway");
  });

  it("makes the three states three visibly different runs", () => {
    const texts = [
      renderVerdict([outcome("advisories", { state: "clean", findings: [] })]),
      renderVerdict([outcome("advisories", { state: "found", findings: [finding("medium")] })]),
      renderVerdict([skipped]),
    ];
    expect(new Set(texts).size).toBe(3);
  });
});

// ── the verdict ─────────────────────────────────────────────────────────────

describe("what turns the verdict red", () => {
  it("counts by severity, worst first", () => {
    expect(countBySeverity([finding("high"), finding("low"), finding("high")])).toEqual({
      critical: 0,
      high: 2,
      medium: 0,
      low: 1,
    });
    const summary = aggregate([
      outcome("a", { state: "found", findings: [finding("low"), finding("critical")] }),
    ]);
    expect(summary.findings.map((f: { severity: string }) => f.severity)).toEqual([
      "critical",
      "low",
    ]);
  });

  it("is CRITICAL or HIGH, and nothing else", () => {
    expect(failsVerdict({ critical: 1, high: 0, medium: 0, low: 0 })).toBe(true);
    expect(failsVerdict({ critical: 0, high: 1, medium: 0, low: 0 })).toBe(true);
    expect(failsVerdict({ critical: 0, high: 0, medium: 9, low: 9 })).toBe(false);
  });

  // 🚨 THE NEEDLE PROBE. Every assertion above is about a run that found
  // nothing or found something harmless — so an aggregator that silently
  // dropped its findings would pass all of them. This is the one test that
  // fails when that happens: a planted HIGH has to arrive, be counted, be
  // printed, and turn the exit code.
  it("🚨 a planted HIGH really does turn the run red", () => {
    const needle = finding("high", { title: "PLANTED-NEEDLE" });
    const summary = aggregate([outcome("advisories", { state: "found", findings: [needle] })]);

    expect(summary.counts.high).toBe(1);
    expect(summary.failing).toBe(true);
    const text = renderVerdict([outcome("advisories", { state: "found", findings: [needle] })]);
    expect(text).toContain("PLANTED-NEEDLE");
    expect(text).toContain("❌ HIGH 1");
    expect(text).toContain("1 finding(s) at HIGH or above");
  });

  it("a MEDIUM is reported and does NOT turn the run red", () => {
    const outcomes = [outcome("advisories", { state: "found", findings: [finding("medium")] })];
    expect(aggregate(outcomes).failing).toBe(false);
    expect(renderVerdict(outcomes)).toContain("none at HIGH or above");
  });
});

describe("an accepted finding is shown and not counted", () => {
  const accepted = finding("medium", { id: "GHSA-test", title: "ACCEPTED-NEEDLE" });

  it("splits on the id, never on the title", () => {
    const split = partitionAccepted(
      [accepted, finding("medium", { id: "GHSA-other", title: "ACCEPTED-NEEDLE" })],
      new Set(["GHSA-test"]),
    );
    expect(split.accepted).toHaveLength(1);
    expect(split.findings).toHaveLength(1);
  });

  it("cannot accept a finding that carries no id", () => {
    const split = partitionAccepted([finding("medium")], new Set(["GHSA-test"]));
    expect(split.accepted).toEqual([]);
  });

  it("stays out of the severity totals but inside the verdict", () => {
    const outcomes = [
      outcome("advisories", { state: "clean", findings: [], accepted: [accepted] }),
    ];
    const summary = aggregate(outcomes);
    expect(summary.counts.medium).toBe(0);
    expect(summary.counts.accepted).toBe(1);
    expect(summary.failing).toBe(false);

    const text = renderVerdict(outcomes);
    expect(text).toContain(`${ACCEPTED_GLYPH} accepted 1`);
    expect(text).toContain("ACCEPTED-NEEDLE");
  });
});

// ── the record ──────────────────────────────────────────────────────────────

describe("the record is numbers and rung states", () => {
  const LEAK = "LEAK-NEEDLE";
  const outcomes = [
    outcome("advisories", {
      state: "found",
      findings: [
        finding("high", {
          title: `title ${LEAK}`,
          where: `where ${LEAK}`,
          why: `why ${LEAK}`,
          fix: `fix ${LEAK}`,
          evidence: `evidence ${LEAK}`,
        }),
      ],
      evidence: `rung evidence ${LEAK}`,
    }),
    outcome("live", { state: "skipped", reason: "no deployed address to check", findings: [] }),
  ];

  it("🚨 carries no part of a finding — and the needle is findable at all", () => {
    // The second half of that sentence is the probe: an assertion that a string
    // is ABSENT passes just as happily when nothing was ever produced. So the
    // same needle is required to be present where it belongs first.
    expect(renderVerdict(outcomes)).toContain(LEAK);
    expect(JSON.stringify(recordFrom(outcomes))).not.toContain(LEAK);
  });

  it("holds the version, the counts and one state per rung", () => {
    const record = recordFrom(outcomes, { now: Date.parse("2026-08-10T09:00:00.000Z"), template: "0.21.0" });
    expect(record.version).toBe(RECORD_VERSION);
    expect(record.checkedAt).toBe("2026-08-10T09:00:00.000Z");
    expect(record.template).toBe("0.21.0");
    expect(record.counts).toEqual({ critical: 0, high: 1, medium: 0, low: 0, accepted: 0 });
    expect(record.rungs).toEqual([
      { id: "advisories", state: "found" },
      { id: "live", state: "skipped", reason: "no deployed address to check" },
    ]);
  });

  it("says `complete: false` whenever a rung was not asked", () => {
    expect(recordFrom(outcomes).complete).toBe(false);
    expect(recordFrom([outcome("advisories", { state: "clean", findings: [] })]).complete).toBe(
      true,
    );
  });

  it("keeps a tool's own error message down to one line", () => {
    const long = recordFrom([
      outcome("advisories", { state: "skipped", reason: "x".repeat(400), findings: [] }),
    ]);
    expect(long.rungs[0].reason.length).toBeLessThanOrEqual(120);
  });

  it("is stale once nobody has refreshed it, and stale when it cannot say", () => {
    const now = Date.parse("2026-08-10T09:00:00.000Z");
    const fresh = recordFrom([outcome("a", { state: "clean", findings: [] })], { now });
    expect(recordIsStale(fresh, now)).toBe(false);
    expect(recordIsStale(fresh, now + MAX_RECORD_AGE + 1)).toBe(true);
    expect(recordIsStale({ ...fresh, checkedAt: "" }, now)).toBe(true);
    expect(recordIsStale({ ...fresh, checkedAt: "not a date" }, now)).toBe(true);
    expect(recordIsStale(null, now)).toBe(true);
  });
});

// ── the ladder itself ───────────────────────────────────────────────────────

describe("every registered rung keeps the shape the aggregator reads", () => {
  it("has rungs at all — an empty ladder is not a pass", () => {
    expect(RUNGS.length).toBeGreaterThan(0);
  });

  it("gives each one a unique id", () => {
    const ids = RUNGS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(RUNGS.map((entry) => [entry.id, entry]))("%s declares id/label/tier/covers/run", (_id, entry) => {
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.label).toBe("string");
    expect(entry.label.length).toBeGreaterThan(0);
    expect([1, 2]).toContain(entry.tier);
    expect(typeof entry.run).toBe("function");
    // `covers` is what stops a skip reading like a pass, so it has to be a
    // sentence about what would have been checked — not the rung's own name.
    expect(typeof entry.covers).toBe("string");
    expect(entry.covers.length).toBeGreaterThan(20);
    expect(entry.covers).not.toBe(entry.label);
  });
});

// ── the accepted set ────────────────────────────────────────────────────────

describe("the accepted set is a set with reasons", () => {
  // ⚠️ Nothing here asserts HOW MANY entries there are, and nothing ever may.
  // An empty set is the normal state of a fresh app, and a set that shrinks is
  // good news; a test that pinned the size would go red on good news and, worse,
  // would go green on the day a real finding landed inside an allowance.
  it.each(Object.entries(ACCEPTED_ADVISORIES))("%s carries a scope and a written reason", (_id, entry) => {
    expect(entry.scope).toBe("dev");
    // Long enough to be an argument rather than a label. An id with no reason
    // reads as an arbitrary exemption to whoever finds it next.
    expect(entry.reason.length).toBeGreaterThan(120);
  });

  it("is keyed on advisory ids the partition can use", () => {
    const ids = acceptedIds();
    expect(ids.size).toBe(Object.keys(ACCEPTED_ADVISORIES).length);
    for (const id of ids) expect(id).toMatch(/^GHSA-/);
  });
});

// ── the ladder's vocabulary ─────────────────────────────────────────────────

describe("the severity ladder is the shipped one", () => {
  it("is four deep, worst first, with the shipped glyphs", () => {
    expect(SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
    expect(SEVERITIES.map((severity) => SEVERITY_GLYPHS[severity])).toEqual([
      "🚨",
      "❌",
      "⚠️",
      "ℹ️",
    ]);
  });
});
