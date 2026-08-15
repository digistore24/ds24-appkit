// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The core reports operationally in exactly ONE place, and it is
// `lib/ops/watchdog.ts`.**
//
// `lib/notify/envelope-guard.test.ts` next door keeps the sender from being
// called past the channel. This is the layer above it: with the channel used
// correctly, WHO may use it is still a claim, and it is a claim no behavioural
// test can make — it is about the job somebody adds next spring.
//
// The mechanism, not the manners: `claimSend()` spends a key FOR EVER
// (`./sent-once.ts`). Two jobs reporting operational findings therefore have
// exactly two possible arrangements and both are broken. Sharing a window means
// one job's claim swallows the other's finding — the second job's condition is
// never mailed, on that run or any later one. Holding two windows means two
// mails land on one operator's morning about one app, which is how a channel
// becomes a channel people filter, and a filtered channel is the same state as
// no channel with costs on top. So: one producer per channel (NFR-67).
//
// Built from `./envelope-guard.test.ts` — the walk, the per-directory
// non-vacuity claim, the allowlist with a written reason per entry and the
// planted needle are that file's shape, and they are what stop a scanner from
// being green because it looked at nothing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();

/** Everything a customer's app is built from. */
const SCANNED = ["app", "lib", "components", "hooks", "db", "i18n", "scripts", "modules"];

/**
 * ⚠️ And the FLAT files at the root, which are not in any of those directories:
 * `instrumentation.ts`, `proxy.ts`, `auth.config.ts`, `next.config.ts`, `run.mjs`.
 * A `notifyOperators()` call in one of them is a second reporter and this guard
 * would not have seen it — the same gap `scripts/lib/source-text.test.ts`
 * records for its own walk, in the same words: a list of places to look is only
 * as good as the place nobody thought to name. Measured at zero on the tree of
 * the day it was added.
 */
const rootFiles = (): string[] =>
  readdirSync(ROOT).filter(
    (entry) => /\.(ts|tsx|mjs)$/.test(entry) && !statSync(join(ROOT, entry)).isDirectory(),
  );

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

/** The one name, spelled once, which is why this file is on the allowlist. */
const NEEDLE = "notifyOperators";

/**
 * Who may reach the channel, and why.
 *
 * ⚠️ **Two entries and only one of them is in the core.** That split is the
 * claim: the CORE has exactly one operational reporter, and the module beside it
 * is arguing its way in rather than being forgotten out.
 */
const ALLOWED: Record<string, string> = {
  "lib/notify/operators.ts":
    "the channel itself — this is where the function is declared, not a caller of it",
  "lib/ops/watchdog.ts":
    "the operational reporter, and the core's only one: it reads all four operational facts and sends ONE mail naming every open finding",
  "modules/courses/cron.ts":
    "a MODULE's product digest, not a second operational report. It says how many hand-ins are waiting for an answer — a fact about a work queue somebody bought, never about whether this app is healthy. It carries its own key (`digestKey()`), its own window and its own `enabledByDefault: false`, so it and the watchdog can never claim each other's window, and an app without the courses module does not have it at all",
  "lib/notify/reporter-guard.test.ts":
    "this file, which has to spell the needle in order to look for it — it is excluded from the scan as a test anyway, and is listed so the allowlist reads as the whole truth",
};

/** The allowlist entries that are the CORE's — everything outside `modules/`. */
const CORE_ALLOWED = Object.keys(ALLOWED)
  .filter((path) => !path.startsWith("modules/") && !path.includes(".test."))
  .sort();

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) yield rel;
  }
}

/**
 * Does this file name the channel in CODE?
 *
 * Through `blankComments()` and never a regex of its own (CLAUDE.md → *Rules*):
 * a checker that greps source punishes a file for explaining itself, and this
 * rule is explained a lot — `lib/cron/security-record.ts`'s header cannot say
 * why it mails nobody without writing the word down.
 */
function names(file: string): boolean {
  const source = readFileSync(join(ROOT, file), "utf8");
  return blankComments(source).includes(NEEDLE);
}

/**
 * A test file is not a reporter, and excluding them is a decision.
 *
 * The channel's own suite drives it directly (`./operators.test.ts`), a module's
 * job test mocks it by name, and `lib/cron/security-record.test.ts` writes a
 * fixture whose whole point is to contain a forbidden import. None of them
 * sends anything to anybody, and all three would otherwise have to be
 * allowlisted — an allowlist of four test files is one nobody reads, and it is
 * where a real caller would eventually hide. What a test cannot do is claim a
 * `claimSend()` window in a running app, which is the only thing this file is
 * about.
 */
const isTest = (file: string) => /\.test\.(ts|tsx|mjs|js)$/.test(file);

const perDirectory = SCANNED.map((dir) => [dir, [...sourceFiles(dir)]] as const);
const files = [...perDirectory.flatMap(([, found]) => found), ...rootFiles()].map((p) =>
  p.split(sep).join("/"),
);
const callers = files.filter((file) => !isTest(file)).filter(names).sort();

describe("one operational reporter (NFR-67)", () => {
  it("the walk is not empty, and it is not empty per directory either", () => {
    // Two ways this could be green while measuring nothing: a walk that found no
    // files at all, and one that silently skipped a directory — `sourceFiles()`
    // returns quietly on a `readdirSync` that throws, and `app` and `lib` alone
    // clear a hundred several times over, so a total cannot see it.
    expect(files.length).toBeGreaterThan(100);
    for (const [dir, found] of perDirectory) {
      expect(found.length, `${dir}/ was scanned and found nothing`).toBeGreaterThan(0);
    }
    // The root is its own count guard, for the same reason: it is a handful of
    // files, so it disappears in the total above.
    expect(rootFiles().length, "the repository root was scanned and found nothing").toBeGreaterThan(
      0,
    );
    expect(files).toContain("proxy.ts");
    // And the needle really is one: the two files that MUST name it do.
    expect(callers).toContain("lib/notify/operators.ts");
    expect(callers).toContain("lib/ops/watchdog.ts");
  });

  it("🚨 the CORE has exactly one operational reporter", () => {
    expect(
      callers.filter((file) => !file.startsWith("modules/")),
      "a second caller of `" +
        NEEDLE +
        "` in the core. A claimed send key is spent FOR EVER, so two jobs " +
        "sharing one window have one swallow the other's finding, and two " +
        "windows put two mails on one operator's morning (NFR-67). If the new " +
        "condition is operational, add it to `collectFindings()` in " +
        "lib/ops/watchdog.ts — it already sends ONE mail naming every open " +
        "finding, worst first. If it is a PRODUCT message about work somebody " +
        "bought, it belongs in a module beside `modules/courses/cron.ts`, with " +
        "its own key, its own window and its own `enabledByDefault: false` — " +
        "and it gets an entry here saying so:\n  " +
        callers.join("\n  "),
    ).toEqual(CORE_ALLOWED);
  });

  it("🚨 and nobody outside the allowlist reaches the channel at all", () => {
    expect(callers).toEqual(
      Object.keys(ALLOWED)
        .filter((path) => !path.includes(".test."))
        .sort(),
    );
  });

  it("every allowlist entry carries a reason, and still exists", () => {
    // An allowlist whose entries have rotted is an allowlist nobody reads, and
    // a reason of four words is one nobody can weigh.
    for (const [path, why] of Object.entries(ALLOWED)) {
      expect(files, `${path} is allowlisted and is not in the tree`).toContain(path);
      expect(why.length, `${path} is allowlisted without a real reason`).toBeGreaterThan(40);
    }
  });

  it("🚨 the needle probe: a second core caller is found, by name", () => {
    // Without this the test proves the WALK ran, not that the comparison did.
    // A fixture rather than a real file: planting one in the tree would be a
    // second reporter for as long as the test takes to run.
    const planted = "lib/cron/some-new-job.ts";
    const found = [...callers, planted].sort().filter((file) => !file.startsWith("modules/"));

    expect(found).not.toEqual(CORE_ALLOWED);
    expect(found.filter((file) => !CORE_ALLOWED.includes(file))).toEqual([planted]);
  });

  it("🚨 a comment can neither satisfy nor break the claim", () => {
    // What `blankComments()` is for, as a measurement. `security-record.ts`'s
    // header MUST be able to name the channel it deliberately does not use, and
    // a `//` line containing `/*` must not open a phantom block that swallows
    // the real caller eighteen lines further down.
    const commented = blankComments(
      `// It mails NOBODY — not ${NEEDLE}(), and /* not the sender either */\n` +
        "export const fine = 1;\n",
    );
    expect(commented).not.toContain(NEEDLE);

    const real = blankComments(
      `// the channel is ${NEEDLE}()\n` +
        `import { ${NEEDLE} } from "@/lib/notify/operators";\n` +
        `export const go = ${NEEDLE};\n`,
    );
    expect(real).toContain(NEEDLE);
    // And the line count survived, so a reported line still points at its line.
    expect(real.split("\n")).toHaveLength(4);
  });

  it("🚨 nothing here opens a hatch past the envelope guard", () => {
    // `envelope-guard.test.ts` fails the build on any file outside the channel
    // that names the SENDER, with an `operator-mail-ok` marker as the per-line
    // way out. This story adds none, and the watchdog must not be the first: it
    // goes through the channel, which is where the switch, the owner query and
    // the once-per-window marker come from.
    const watchdog = readFileSync(join(ROOT, "lib", "ops", "watchdog.ts"), "utf8");
    expect(watchdog).not.toContain("operator-mail-ok");
    expect(blankComments(watchdog)).not.toContain("sendOperator" + "Mail");
  });
});
