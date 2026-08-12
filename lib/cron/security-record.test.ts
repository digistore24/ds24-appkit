// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The one thing the `check-advisories` job can get wrong in a way nothing
// else catches: writing a record that looks COMPLETE after asking two of the
// ladder's rungs. That record would make the session greeting say "nothing
// serious is open" about questions nobody asked — the exact failure the whole
// epic is named after, rebuilt inside its own fix, and one line of code away at
// all times.
//
// ⚠️ **This test is PURE and must stay that way.** `vitest.config.ts` includes
// every `**/*.test.ts` under `template/`, so a `.test.ts` here is inside
// `make check` whether anybody wanted it there or not — and
// `node run.mjs security-check` is deliberately in no gate, because it asks the
// network and its answer moves without this app changing. So this file may
// IMPORT the ladder (nothing runs at import time) and must never RUN a rung: no
// network, no spawn, no database, and nothing written to disk. Reading source as
// text is the one filesystem access, and it is what every structural test in
// this repository does.
import { readFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isOwnSpecifier, resolveImport } from "@/scripts/lib/import-graph.mjs";
import { RUNGS } from "@/scripts/security/check.mjs";
import { MAX_REASON_LENGTH, outcomeFrom, recordFrom } from "@/scripts/security/rules.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

import { jobSettings } from "./config";
import {
  ASKED_RUNGS,
  DEFAULT_BUDGET_MS,
  budgetReason,
  composeOutcomes,
  detailLine,
  notAskedReason,
  type OutcomeLike,
  type RungLike,
} from "./security-record";

const ROOT = process.cwd();
const ENTRY = join(ROOT, "lib/cron/security-record.ts");

/** The ladder's ids, as the running app would see them. */
const RUNG_IDS: string[] = (RUNGS as readonly RungLike[]).map((rung) => rung.id);

/** An answer from a rung that really ran, with nothing found. */
const clean = (id: string): OutcomeLike =>
  outcomeFrom({ id }, { state: "clean", findings: [] }) as OutcomeLike;

/** An answer from a rung that ran and found one thing. */
const found = (id: string, finding: Record<string, unknown>): OutcomeLike =>
  outcomeFrom({ id }, { state: "found", findings: [finding] }) as OutcomeLike;

/** An answer from a rung that was asked and could not look. */
const skipped = (id: string, reason: string): OutcomeLike =>
  outcomeFrom({ id }, { state: "skipped", reason, findings: [] }) as OutcomeLike;

describe("ASKED_RUNGS is a subset of the ladder that really exists", () => {
  it("names rungs the ladder answers to, and at least one", () => {
    // Without this, a rename upstream would leave the job asking nothing at all
    // and reporting a perfectly well-formed record in which every rung is "not
    // asked". That is a green cron run measuring nothing.
    expect(RUNG_IDS.length, "the ladder read as empty — the import is not doing its job")
      .toBeGreaterThan(3);
    expect(ASKED_RUNGS.length).toBeGreaterThan(0);
    expect(ASKED_RUNGS.filter((id) => !RUNG_IDS.includes(id))).toEqual([]);
  });

  it("asks the bounded rung FIRST", () => {
    // `runRungs()` runs rungs in order. `advisories` spawns npm through
    // `capture()`, which sets no timeout at all; `osv` bounds every request it
    // makes. The rung that can hang must not be able to stop the one that
    // cannot, so this order is a property and not a preference.
    expect(ASKED_RUNGS[0]).toBe("osv");
    expect(ASKED_RUNGS).toContain("advisories");
  });

  it("keeps both skip reasons inside what the record may carry", () => {
    for (const reason of [notAskedReason(), budgetReason()]) {
      expect(reason.trim().length).toBeGreaterThan(20);
      expect(reason.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
      // The sentence has to name the way to ask everything, or a reader learns
      // only that something was skipped.
      expect(reason).toContain("security-check");
    }
  });
});

describe("a record from this job names every rung, and can never look complete", () => {
  const answered = ASKED_RUNGS.map((id) => clean(id));
  const record = recordFrom(composeOutcomes(RUNGS as readonly RungLike[], answered), {
    now: Date.UTC(2026, 7, 11),
    template: "0.24.0",
  });

  it("names every registered rung, in the ladder's own order", () => {
    expect(record.rungs.map((rung: { id: string }) => rung.id)).toEqual(RUNG_IDS);
  });

  it("marks every rung it did not ask as skipped, with a reason", () => {
    for (const rung of record.rungs as Array<{ id: string; state: string; reason?: string }>) {
      if (ASKED_RUNGS.includes(rung.id)) {
        expect(rung.state).toBe("clean");
        continue;
      }
      expect(rung.state).toBe("skipped");
      expect(String(rung.reason ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("🚨 is never complete — two questions must not look like all of them", () => {
    expect(record.complete).toBe(false);
  });

  // 🚨 The needle probe. Every assertion above passes just as well against a
  // hard-coded list of the rungs that are not asked today — and such a list rots
  // the day a rung is added, silently, leaving the new rung out of the record
  // entirely. So: a rung the ladder has never heard of, handed in at run time.
  it("🚨 covers a rung that did not exist when this file was written", () => {
    const ladder: RungLike[] = [...(RUNGS as readonly RungLike[]), { id: "a-rung-from-next-year" }];
    const outcomes = composeOutcomes(ladder, ASKED_RUNGS.map((id) => clean(id)));
    const later = recordFrom(outcomes, { now: Date.UTC(2026, 7, 11), template: "0.24.0" });

    const newest = (later.rungs as Array<{ id: string; state: string; reason?: string }>).at(-1);
    expect(
      newest,
      "the composed record is shorter than the ladder handed to it — the not-asked " +
        "list is coming from somewhere other than the ladder",
    ).toBeDefined();
    expect(newest?.id).toBe("a-rung-from-next-year");
    expect(newest?.state).toBe("skipped");
    expect(newest?.reason).toBe(notAskedReason());
    expect(later.rungs.length).toBe(RUNG_IDS.length + 1);
  });

  it("tells a rung it never asked from one the budget cut off", () => {
    // Both are `skipped` in the record and both are honest, but they are
    // different facts about the world: one was never a question, the other was a
    // question that did not come back in time.
    const partial = composeOutcomes(RUNGS as readonly RungLike[], [clean("osv")]);
    const byId = new Map(partial.map((outcome) => [outcome.id, outcome]));
    expect(byId.get("advisories")?.reason).toBe(budgetReason());
    expect(byId.get("live")?.reason).toBe(notAskedReason());
  });
});

describe("nothing measured is not the same as nothing found", () => {
  const outcomes = composeOutcomes(
    RUNGS as readonly RungLike[],
    ASKED_RUNGS.map((id) => skipped(id, "there is no network on this machine")),
  );
  const record = recordFrom(outcomes, { now: Date.UTC(2026, 7, 11), template: "0.24.0" });

  it("puts no rung in a state that ran", () => {
    expect(record.complete).toBe(false);
    expect(
      (record.rungs as Array<{ state: string }>).filter((rung) => rung.state !== "skipped"),
    ).toEqual([]);
  });

  it("says so in the line, rather than reporting a clean tally", () => {
    // 🚨 The failure this whole epic is named after: `0 critical, 0 high, …` is
    // what a fully clean run looks like, and printing it for a run that measured
    // nothing is the lie. The line has to say the measurement did not happen.
    const line = detailLine(record);
    expect(line).toContain("nothing was measured");
    expect(line).not.toContain("0 critical");
    expect(line).toBe(
      `0 of ${RUNG_IDS.length} rung(s) answered — nothing was measured; ${RUNG_IDS.length} not asked`,
    );
  });
});

describe("the line that lands in cron_runs is numbers", () => {
  // Everything a finding carries that a person could recognise, planted at once.
  const PACKAGE = "leftpad-supreme";
  const PATH = "node_modules/leftpad-supreme/index.js";
  const TITLE = "Prototype pollution in leftpad-supreme";
  const SKIP_REASON =
    "EEXPIREDSIGNATUREKEY: a package has a registry signature with keyid SHA256:abcdef";

  const outcomes = composeOutcomes(RUNGS as readonly RungLike[], [
    found("osv", {
      id: "GHSA-xxxx-yyyy-zzzz",
      severity: "high",
      title: TITLE,
      where: PATH,
      package: PACKAGE,
    }),
    skipped("advisories", SKIP_REASON),
  ]);
  const record = recordFrom(outcomes, { now: Date.UTC(2026, 7, 11), template: "0.24.0" });
  const line = detailLine(record);

  it("counts what was found", () => {
    expect(line).toContain("1 high");
    expect(line).toContain(`1 of ${RUNG_IDS.length} rung(s) answered`);
    expect(line).toContain(`${RUNG_IDS.length - 1} not asked`);
  });

  for (const secret of [PACKAGE, PATH, TITLE, "GHSA-xxxx-yyyy-zzzz", "EEXPIREDSIGNATUREKEY"]) {
    it(`never carries "${secret.slice(0, 24)}"`, () => {
      expect(
        line,
        `cron_runs.lastDetail is a table with no privacy question attached ` +
          `(docs/data-protection.md §11) and this line put upstream text into it.`,
      ).not.toContain(secret);
    });
  }

  it("is one line, comfortably under what run.ts truncates at", () => {
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(200);
  });

  it("survives a record that crossed JSON and lost its shape", () => {
    // The record is read back off disk, so `counts` may be anything. A `NaN`
    // rendered into the line would be worse than a zero — it reads as a bug in
    // the app rather than as a number nobody has.
    const line = detailLine({
      counts: { critical: null, high: "2", medium: undefined, low: 1, accepted: NaN },
      rungs: [{ id: "osv", state: "clean" }],
    } as never);
    expect(line).toBe("1 of 1 rung(s) answered — 0 critical, 0 high, 0 medium, 1 low, 0 accepted; 0 not asked");
  });
});

describe("the shipped schedule says what it does rather than inheriting it", () => {
  it("is on, daily, and carries its own budget", () => {
    const settings = jobSettings("check-advisories");
    expect(settings.enabled).toBe(true);
    expect(settings.everyMinutes).toBe(1440);
    // Written out in `config/cron.json` on the same argument as `enabled`: a
    // number nobody wrote down is a number nobody decided, and the operator has
    // to be able to raise it by editing a line that is already there.
    expect(settings.budgetSeconds).toBe(DEFAULT_BUDGET_MS / 1000);
  });

  it("stays far inside the stale-lock window", () => {
    // Rule 4 for a job: it finishes in well under an hour, because that is when
    // the lock goes stale and a second copy can start beside the first.
    expect(DEFAULT_BUDGET_MS).toBeLessThan(10 * 60_000);
  });
});

// ── NFR-67: this job mails nobody, and the absence is walked rather than claimed
//
// Two helpers are used rather than reimplemented, and both are rules in
// `CLAUDE.md` rather than preferences: `blankComments()` because this reads
// source as TEXT (the file's own header NAMES `lib/notify/` in prose, and
// without it the file documenting the rule is reported as breaking it), and
// `resolveImport()` because a hand-written `@/` branch is the bug this test
// would then have — every import here is aliased.
const FORBIDDEN_PREFIX = "@/lib/notify";

/** Every static `import … from "x"` in a source, comments already blanked. */
function importsIn(source: string): string[] {
  const blanked = blankComments(source);
  const out: string[] = [];
  for (const match of blanked.matchAll(/\bfrom\s+["']([^"']+)["']/g)) out.push(match[1]);
  for (const match of blanked.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(match[1]);
  return out;
}

function isFile(candidate: string): boolean {
  return statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** The transitive STATIC import graph from one entry point. */
function closure(entry: string): { files: string[]; specifiers: string[] } {
  const seen = new Set<string>();
  const specifiers: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !isFile(file)) continue;
    seen.add(file);
    for (const specifier of importsIn(readFileSync(file, "utf8"))) {
      // Recorded BEFORE any skip: a bare package name is never followed, and it
      // is exactly what the assertion below reads.
      specifiers.push(specifier);
      const target = resolveImport(file, specifier, { root: ROOT });
      if (target?.exists) queue.push(target.path);
    }
  }
  return { files: [...seen], specifiers };
}

describe("the job's body reaches no mail channel (NFR-67)", () => {
  const { files, specifiers } = closure(ENTRY);

  it("actually walked something, and walked PAST the entry file", () => {
    expect(files.length).toBeGreaterThan(1);
    expect(files.some((file) => file.endsWith(join("scripts", "security", "rules.mjs")))).toBe(true);
  });

  it("resolves the @/ alias rather than skipping it", () => {
    const aliased = specifiers.filter(
      (specifier) => isOwnSpecifier(specifier) && !specifier.startsWith("."),
    );
    expect(aliased.length).toBeGreaterThan(0);
    expect(
      aliased.filter(
        (specifier) => resolveImport(ENTRY, specifier, { root: ROOT })?.exists !== true,
      ),
    ).toEqual([]);
  });

  // 🚨 The needle probe, transitive on purpose: a one-level fixture proves the
  // walk RAN, not that it walks. A imports B, B imports the mail channel.
  it("would flag a mail channel reached two hops away", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds24-notify-probe-"));
    try {
      writeFileSync(
        join(dir, "b.mjs"),
        `import { notifyOperators } from "${FORBIDDEN_PREFIX}/operators";\nexport const x = notifyOperators;\n`,
      );
      writeFileSync(join(dir, "a.mjs"), 'import { x } from "./b.mjs";\nexport const y = x;\n');

      const probe = closure(join(dir, "a.mjs"));
      expect(
        probe.files.some((file) => file.endsWith("b.mjs")),
        "the walk stopped at the entry file — it is not transitive",
      ).toBe(true);
      expect(probe.specifiers.some((s) => s.startsWith(FORBIDDEN_PREFIX))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never imports anything under lib/notify/", () => {
    const hit = specifiers.find(
      (specifier) =>
        specifier === FORBIDDEN_PREFIX || specifier.startsWith(`${FORBIDDEN_PREFIX}/`),
    );
    expect(
      hit,
      `lib/cron/security-record.ts reaches ${hit} through its import graph.\n` +
        `The operator-mail channel has exactly ONE producer and it is not this job:\n` +
        `a claimed send key is spent for ever, so two jobs sharing one window would\n` +
        `have one swallow the other's finding, and two keys would put two mails on\n` +
        `one operator's morning (NFR-67).`,
    ).toBeUndefined();
  });

  it("names no mail channel in its code at all, dynamic imports included", () => {
    // The walk above follows STATIC imports. This job reaches its two runtime
    // dependencies by file URL, so the specifier is never a literal a walker can
    // follow — and a `await import("@/lib/notify/operators")` would slip past it.
    //
    // ⚠️ The needle is the PATH rather than the function names, and that is not
    // laziness: `notifyOperators()`, `claimSend()` and the transport all live
    // under `lib/notify/`, so nothing can reach one of them without the path
    // appearing here — and the sender has a stricter guard of its own
    // (`lib/notify/envelope-guard.test.ts` refuses ANY file outside the channel
    // that names it, which is also why spelling it out here would put this test
    // itself on that list).
    const code = blankComments(readFileSync(ENTRY, "utf8"));
    expect(
      code,
      "the job's code names the mail channel rather than only its reasoning",
    ).not.toContain(FORBIDDEN_PREFIX.slice("@/".length));
  });
});
