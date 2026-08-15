// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The greeting's operational line — what it says, and above all when it says
// nothing at all.
//
// PURE by construction: no filesystem, no network, no spawn. `vitest.config.ts`
// includes `**/*.test.ts`, so anything placed under `template/` is inside the
// project's own gate whether or not anybody wanted it there — and
// `security-check` itself is deliberately in NO gate, because it asks the
// network and its answer moves without this app changing. A test that reached
// the disk would drag that back in through the side door.
//
// The central claim below is a SILENCE, which is the hardest kind of assertion
// to keep honest: a producer that returns "" unconditionally passes every
// silence test ever written. So every silence fixture here has a needle probe
// beside it — the same fixture with one number changed, asserted to produce a
// line. That is the doctrine `scripts/lib/source-text.test.ts` records after a
// guard shipped for months with a needle no file could contain.
import { describe, expect, it } from "vitest";

import { SEVERITIES } from "../security/rules.mjs";
import {
  MAX_ROUND_AGE,
  describeOperations,
  newestRoundDate,
  roundFact,
  securityFact,
} from "./operations.mjs";

/**
 * The record this tree really carries, copied verbatim out of
 * `.dev/security-check.json` after a real `node run.mjs security-check` run.
 *
 * 🚨 **This is the story's central fixture and it must produce NOTHING.** Read
 * what is in it: `complete: false`, three rungs that skipped, and two ℹ️ LOW
 * findings — no `.npmrc` (a fresh app ships none) and a local `.env` that was
 * never committed. That is not a damaged machine, it is the ORDINARY state of
 * every developer's checkout of this template, and a greeting that meets it with
 * a warning is a greeting with a permanent warning in it.
 *
 * `.dev/` is gitignored, so the file this was taken from will not survive a
 * fresh clone — which is exactly why it is quoted here in full rather than read.
 */
const REAL_RECORD = {
  version: 1,
  checkedAt: "2026-08-10T22:38:15.490Z",
  template: "0.24.0",
  complete: false,
  counts: { critical: 0, high: 0, medium: 0, low: 2, accepted: 0 },
  rungs: [
    { id: "advisories", state: "clean" },
    { id: "osv", state: "clean" },
    {
      id: "signatures",
      state: "skipped",
      reason: "EEXPIREDSIGNATUREKEY: a package has a registry signature with keyid: SHA256:jl3bwswu…",
    },
    { id: "registry", state: "clean" },
    { id: "posture", state: "found" },
    { id: "drift", state: "clean" },
    {
      id: "live",
      state: "skipped",
      reason: "no deployed address to check — APP_URL is local and no --url was given",
    },
    { id: "secrets", state: "found" },
    {
      id: "secrets-history",
      state: "skipped",
      reason: "gitleaks is not on this machine's PATH",
    },
    {
      id: "container-scan",
      state: "skipped",
      reason: "Docker answered, but the aquasec/trivy image is not on this machine",
    },
  ],
};

/**
 * The same tree one template version earlier — SEVEN rungs instead of ten.
 *
 * Kept beside the current one on purpose: the ladder's length is not a constant,
 * and a producer that ever learns the number seven (or ten) is a producer that
 * silently stops counting the next rung somebody adds. Both records are the
 * ordinary state of a laptop; both must be silent.
 */
const SEVEN_RUNG_RECORD = {
  version: 1,
  checkedAt: "2026-08-10T21:01:56.663Z",
  template: "0.23.0",
  complete: false,
  counts: { critical: 0, high: 0, medium: 0, low: 1, accepted: 0 },
  rungs: [
    { id: "advisories", state: "clean" },
    { id: "osv", state: "clean" },
    { id: "signatures", state: "skipped", reason: "EEXPIREDSIGNATUREKEY: …" },
    { id: "registry", state: "clean" },
    { id: "posture", state: "found" },
    { id: "drift", state: "clean" },
    { id: "live", state: "skipped", reason: "no deployed address to check" },
  ],
};

/** A deep-ish copy, so a fixture cannot be edited by the test that reads it. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const lineFor = (record: unknown, options = {}) =>
  describeOperations([securityFact("ok", record as never, options)].filter(Boolean) as never);

describe("the record that is worth no line at all", () => {
  it("🚨 says NOTHING about the real record of this tree", () => {
    // Two standing LOW findings, three skipped rungs, `complete: false` — and
    // not one word. A build in which this produces a line is a failed build.
    expect(securityFact("ok", REAL_RECORD as never, {})).toBeNull();
    expect(lineFor(REAL_RECORD)).toBe("");
  });

  it("says nothing about the same tree with seven rungs either", () => {
    expect(lineFor(SEVEN_RUNG_RECORD)).toBe("");
  });

  it("🚨 the needle: the SAME record with one HIGH does produce a line", () => {
    // Without this, a `securityFact()` that returned null unconditionally — or a
    // `describeOperations()` that returned "" unconditionally — would pass every
    // assertion above. The fixture is the silent one with a single number moved.
    const record = clone(REAL_RECORD);
    record.counts.high = 1;

    const fact = securityFact("ok", record as never, {});
    expect(fact).not.toBeNull();
    expect(fact?.severity).toBe("high");

    const line = lineFor(record);
    expect(line).not.toBe("");
    expect(line).toContain("1 HIGH");
    expect(line).toContain("node run.mjs security-check");
  });

  it("says nothing for a MEDIUM or a LOW, because the command's exit code does not either", () => {
    const record = clone(REAL_RECORD);
    record.counts.medium = 3;
    record.counts.low = 9;
    expect(lineFor(record)).toBe("");
  });
});

describe("four ways of not knowing, four sentences, never a silence", () => {
  it("never checked — but only once there is an app to check", () => {
    const built = securityFact("missing", null, { appUnderWay: true });
    expect(built?.severity).toBe("medium");
    expect(built?.text).toContain("never checked");

    // A fresh clone: no pages of its own, no product brief. Nobody has checked
    // the app that has not been built yet, and nagging on session one is what
    // trains people to skip the whole block.
    expect(securityFact("missing", null, { appUnderWay: false })).toBeNull();
  });

  it("unreadable is its own sentence, and never 'never checked'", () => {
    // An unreadable record is not evidence that nobody looked, so it must not
    // borrow the sentence for that — the `appUnderWay` gate does not apply here
    // either: a record that exists at all describes an app somebody built.
    const fact = securityFact("unreadable", null, { appUnderWay: false });
    expect(fact?.severity).toBe("medium");
    expect(fact?.text).not.toContain("never checked");
    expect(fact?.text).toContain("cannot be read");
  });

  it("stale names the record's own date and never says 'never checked'", () => {
    const record = clone(REAL_RECORD);
    record.checkedAt = "2026-07-26T09:00:00.000Z";
    const now = Date.parse("2026-08-10T09:00:00.000Z");

    const fact = securityFact("stale", record as never, { now });
    expect(fact?.severity).toBe("medium");
    expect(fact?.text).toContain("2026-07-26");
    expect(fact?.text).toContain("15 days ago");
    expect(fact?.text).not.toContain("never checked");
    // The bound comes from `MAX_RECORD_AGE`, so this reads 7 because the record
    // says 7 — not because this file decided it does.
    expect(fact?.text).toContain("7-day bound");
  });

  it("stale with an unusable timestamp still speaks", () => {
    const record = clone(REAL_RECORD);
    record.checkedAt = "not a date at all";
    const fact = securityFact("stale", record as never, {});
    expect(fact).not.toBeNull();
    expect(fact?.text).toContain("no usable date");
  });

  it("a check that looked at nothing is its own sentence, distinct from the others", () => {
    const record = clone(REAL_RECORD);
    record.rungs = record.rungs.map((rung) => ({ ...rung, state: "skipped" }));

    const fact = securityFact("ok", record as never, {});
    expect(fact?.severity).toBe("medium");
    expect(fact?.text).toContain("could not look at anything");
    expect(fact?.text).toContain("10 of 10 rungs not asked");
    expect(fact?.text).not.toContain("never checked");
    expect(fact?.text).not.toContain("cannot be read");
  });

  it("a record with no rungs at all does not read as a clean bill", () => {
    const record = clone(REAL_RECORD);
    record.rungs = [];
    expect(securityFact("ok", record as never, {})?.text).toContain("nothing was looked at");
  });
});

describe("the rungs are counted, never assumed", () => {
  it("counts an eleventh rung the day somebody adds one", () => {
    // 30.6 and 30.7 are drafted; the ladder has already grown from seven to ten
    // once. Nothing here may know a number.
    const record = clone(REAL_RECORD);
    record.counts.high = 2;
    record.rungs.push({ id: "a-rung-nobody-has-written-yet", state: "skipped", reason: "…" });

    const line = lineFor(record);
    expect(line).toContain("5 of 11 rungs not asked");
    expect(line).not.toContain("of 10 rungs");
  });

  it("names how many rungs were not asked whenever it speaks at all", () => {
    // "Nothing found" and "nobody asked" must never look the same — and this is
    // the half that has to work even when something WAS found.
    const record = clone(REAL_RECORD);
    record.counts.critical = 1;
    expect(lineFor(record)).toContain("4 of 10 rungs not asked");
  });
});

describe("one line, worst first, ending in the worst one's command", () => {
  const critical = {
    id: "security",
    severity: "critical",
    text: "security — 1 CRITICAL open",
    command: "node run.mjs security-check",
  };
  const low = {
    id: "housekeeping",
    severity: "low",
    text: "housekeeping — something routine",
    command: "node run.mjs doctor",
  };

  it("puts the critical first and ends with ITS command", () => {
    const line = describeOperations([low, critical] as never);
    expect(line.indexOf("1 CRITICAL")).toBeLessThan(line.indexOf("something routine"));
    expect(line.endsWith("Run: node run.mjs security-check]")).toBe(true);
  });

  it("is one line, in the brackets the greeting's other lines use", () => {
    const line = describeOperations([critical, low] as never);
    expect(line).not.toContain("\n");
    expect(line.startsWith("[Operations: ")).toBe(true);
    expect(line.endsWith("]")).toBe(true);
  });

  it("caps at two named facts and counts the rest", () => {
    const medium = { ...low, id: "third", severity: "medium", text: "third — a third thing" };
    const line = describeOperations([low, medium, critical] as never);
    expect(line).toContain("+1 more");
    expect(line).not.toContain("something routine");
  });

  it("a fact whose text arrived with a newline still renders as one line", () => {
    const line = describeOperations([{ ...critical, text: "a\nb" }] as never);
    expect(line).not.toContain("\n");
    expect(line).toContain("a b");
  });

  it("an unknown severity sorts last rather than first", () => {
    const odd = { ...low, severity: "brand-new", text: "odd — an unrated fact" };
    const line = describeOperations([odd, critical] as never);
    expect(line.indexOf("1 CRITICAL")).toBeLessThan(line.indexOf("an unrated fact"));
  });

  it("says nothing for an empty list, and takes null as readily as an array", () => {
    // The `describe(null)` trap `scripts/dev/update-check.mjs` records: a default
    // parameter covers `undefined` only, and the first real run of this file is
    // inside a session hook.
    expect(describeOperations([])).toBe("");
    expect(describeOperations(null)).toBe("");
    expect(describeOperations(undefined as never)).toBe("");
  });
});

// ── The operating round — the second fact on the same channel ────────────────
//
// Pure throughout: the collector is handed a list of FILE NAMES and a `now`,
// never a directory. Any `.test.ts` under `template/` is inside `make check` by
// construction (`vitest.config.ts`), so a test that read `docs/reports/` would
// be a gate that reads `docs/reports/` — and on the machine of whoever ran the
// round yesterday it would pass for a reason nobody chose.

const NOW = Date.parse("2026-08-11T09:00:00.000Z");

describe("the newest round, read out of a file NAME and never out of a file", () => {
  it("takes the newest of several, ignoring every other report kind", () => {
    const names = [
      "security-2026-07-26.md",
      "ux-2026-07-27.md",
      "operations-2026-06-01.md",
      "operations-2026-08-01.md",
      "operations-2026-07-04.md",
    ];
    expect(newestRoundDate(names, NOW)).toBe("2026-08-01");
  });

  it("🚨 the needle: a name that is not a date does not become one", () => {
    // Four shapes that all "look right" to a careless reader, and the whole
    // reason the pattern is not the end of it: `2026-13-45` matches
    // four-two-two and is not a day of any year.
    const names = [
      "operations-not-a-date.md",
      "operations-2026-13-45.md",
      "operations-2026-02-30.md",
      "operations.md",
      "ops-2026-08-11.md",
      "operations-2026-08-11.txt",
      "operations-2026-08.md",
    ];
    expect(newestRoundDate(names, NOW)).toBeNull();
  });

  it("the -2 / -3 of a second round on one day is the SAME day, never a lost one", () => {
    expect(newestRoundDate(["operations-2026-08-01-2.md"], NOW)).toBe("2026-08-01");
    // …and it does not outrank a genuinely newer report just by sorting later.
    expect(
      newestRoundDate(["operations-2026-08-01-3.md", "operations-2026-08-05.md"], NOW),
    ).toBe("2026-08-05");
  });

  it("answers null for nothing, for null, and for a folder full of other things", () => {
    expect(newestRoundDate([], NOW)).toBeNull();
    expect(newestRoundDate(null, NOW)).toBeNull();
    expect(newestRoundDate(["security-2026-07-26.md"], NOW)).toBeNull();
  });

  it("a mistyped year does not silence the round for a century", () => {
    // A date after today is used only when there is nothing else — otherwise
    // `operations-2126-…` would be "newer than the bound" for ever.
    const names = ["operations-2126-01-01.md", "operations-2026-06-01.md"];
    expect(newestRoundDate(names, NOW)).toBe("2026-06-01");
    // With nothing else it is still the answer: a report IS there, and claiming
    // "never run" about a file somebody can see would be the worse lie.
    expect(newestRoundDate(["operations-2126-01-01.md"], NOW)).toBe("2126-01-01");
  });

  it("🚨 …and the fact SAYS so instead of falling silent for a century", () => {
    // The half this pair was missing, measured 2026-08-15. `newestRoundDate()`
    // hands the future date back on purpose (above) — and `roundFact()` then
    // fell through its `now - at <= MAX_ROUND_AGE` test and returned `null`, so
    // the greeting said nothing about the operating round at all. In this
    // template the ABSENCE of that line is a state ("nothing is open"), so
    // silence was the one answer this case could not be given. A first round
    // report with a mistyped year is exactly where the typo happens.
    const fact = roundFact("2126-01-01", { now: NOW, appUnderWay: true });
    expect(fact).not.toBeNull();
    expect(fact?.text).toContain("in the future");
    expect(fact?.text).toContain("2126-01-01");
    // The ordinary recent report is still silence — otherwise this would be a
    // line that fires always, which is a line nobody reads.
    expect(roundFact("2026-08-01", { now: NOW, appUnderWay: true })).toBeNull();
  });
});

describe("when the round fact appears, and when it stays quiet", () => {
  it("a report newer than the bound is worth no line, whatever else is true", () => {
    expect(roundFact("2026-08-01", { now: NOW, appUnderWay: true })).toBeNull();
    expect(roundFact("2026-08-01", { now: NOW, appUnderWay: false })).toBeNull();
    // The needle for that silence: the same fixture, one date moved back.
    expect(roundFact("2026-06-01", { now: NOW, appUnderWay: true })).not.toBeNull();
  });

  it("a report older than the bound names the date, the age and the bound", () => {
    const fact = roundFact("2026-06-01", { now: NOW, appUnderWay: false });
    expect(fact?.severity).toBe("low");
    expect(fact?.text).toContain("2026-06-01");
    expect(fact?.text).toContain("71 days ago");
    // 30 because `MAX_ROUND_AGE` says 30, not because this file decided it does.
    expect(fact?.text).toContain(`${Math.round(MAX_ROUND_AGE / 86_400_000)}-day bound`);
    expect(fact?.command).toContain("operate");
  });

  it("no report at all speaks only once there is an app here", () => {
    const built = roundFact(null, { now: NOW, appUnderWay: true });
    expect(built?.severity).toBe("low");
    expect(built?.text).toContain("never run here");

    // 🚨 The load-bearing row: a fresh clone has no pages and no brief, has
    // never been live, and must meet no round-overdue line on session one.
    expect(roundFact(null, { now: NOW, appUnderWay: false })).toBeNull();
  });

  it("exactly on the bound is not yet overdue, a millisecond past it is", () => {
    // The age is measured from the report's own midnight UTC — the only instant
    // its NAME carries. Both sides of the boundary asserted, so a `<` that
    // becomes a `<=` (or the reverse) fails here rather than a month later.
    const at = Date.parse("2026-07-12T00:00:00.000Z");
    expect(roundFact("2026-07-12", { now: at + MAX_ROUND_AGE, appUnderWay: true })).toBeNull();
    expect(roundFact("2026-07-12", { now: at + MAX_ROUND_AGE + 1, appUnderWay: true })).not.toBeNull();
  });

  it("a date that does not parse is a silence, never a 'never run'", () => {
    // `newestRoundDate()` cannot produce this; a later caller could, and
    // "never" is a claim about a report somebody can see in the folder.
    expect(roundFact("not-a-date", { now: NOW, appUnderWay: true })).toBeNull();
  });

  it("takes its severity from the imported ladder and sits at the bottom of it", () => {
    // "Ranked below any open security finding" is carried entirely by this
    // word plus `describeOperations()`'s existing sort. A fifth severity of
    // this file's own would sort last by accident and read as a decision.
    const fact = roundFact(null, { now: NOW, appUnderWay: true });
    expect(SEVERITIES).toContain(fact?.severity);
    expect(SEVERITIES.indexOf(fact?.severity as never)).toBe(SEVERITIES.length - 1);
  });
});

describe("🚨 the needle for the ordering: security is never softened by the round", () => {
  it("names the security fact first and ends with ITS command", () => {
    const record = clone(REAL_RECORD);
    record.counts.high = 1;

    const security = securityFact("ok", record as never, { now: NOW });
    const round = roundFact("2026-06-01", { now: NOW, appUnderWay: true });
    expect(security).not.toBeNull();
    expect(round).not.toBeNull();

    // Deliberately the WRONG way round going in: the claim is about the sort,
    // not about the order somebody happened to push them in.
    const line = describeOperations([round, security] as never);
    expect(line.indexOf("1 HIGH")).toBeLessThan(line.indexOf("operating round"));
    expect(line.endsWith("Run: node run.mjs security-check]")).toBe(true);
    expect(line).not.toContain("Run: the skill operate");
  });

  it("and carries the round alone when security has nothing to say", () => {
    // The other half of the same claim: the LOW is not suppressed, it is
    // ranked. On the real record of this tree security is silent, so the round
    // is the whole line and names its own way of being started.
    expect(securityFact("ok", REAL_RECORD as never, { now: NOW })).toBeNull();
    const line = describeOperations([
      roundFact("2026-06-01", { now: NOW, appUnderWay: true }),
    ] as never);
    expect(line).toContain("[Operations: the operating round last ran on 2026-06-01");
    expect(line.endsWith("Run: the skill operate]")).toBe(true);
  });
});
