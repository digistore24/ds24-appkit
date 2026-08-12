// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The second claim no behavioural test can make: there is ONE way to an
// operator's inbox, and it is `notifyOperators()`.**
//
// `sendOperatorMail()` in `lib/email.ts` is exported because the channel lives
// in another file and has to import it — not because it is a second entrance.
// The containment of the address leak this commit exists for is a single
// `catch` in `lib/notify/operators.ts`: Postmark's error body NAMES the
// recipient (`sendViaPostmark` puts it in the message), and `lib/cron/run.ts`
// writes `error.message` straight into `cron_runs.lastDetail` — a column that
// promises to hold nothing personal (`docs/data-protection.md` §11, cron rule
// 2). A job that reaches past the channel and calls the sender directly
// reproduces exactly that finding, and every type in its way says it is allowed.
//
// The sibling property — nothing on this path reads a request — got a text
// scanner (`./guard.test.ts`) on the argument that a runtime test says nothing
// about the line somebody writes NEXT. That argument holds here word for word,
// and this file is the missing half of it.
//
// Built from `modules/community/lib/dm-guard.test.ts` (walk + needle +
// allowlist with reasons) and `lib/ai/customer-text.test.ts` (the per-line
// escape hatch, and the three-part proof that it opens and does not spread).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();

/** Everything a customer's app is built from. */
const SCANNED = ["app", "lib", "components", "hooks", "db", "i18n", "scripts", "modules"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

/** The one name, and it is spelled once so this file is its own first offender. */
const NEEDLE = "sendOperatorMail";

/**
 * Who may name it, and why.
 *
 * Two files and this one. Note what is NOT here: no job, no page, no action, no
 * script. A job that wants to write to one operator wants `notifyOperators()`
 * with a key — which is also how it gets the switch, the owner query and the
 * once-per-window marker, none of which it would otherwise have.
 */
const ALLOWED: Record<string, string> = {
  "lib/email.ts": "the sender itself — it renders and hands over, and it throws like every other send",
  "lib/notify/operators.ts":
    "the channel, and the only caller: its catch turns the transport's own text into a count",
  "lib/notify/envelope-guard.test.ts": "this file, which has to spell the needle",
};

/**
 * The escape hatch, and it is not optional politeness.
 *
 * 🚨 **This test ships inside the customer's app.** The rule it keeps is about
 * one column in one table, and an app has legitimate paths that never reach it:
 * an operator mail sent from a Server Action, where the error is caught and
 * rendered, is not a cron job and `cron_runs` never sees it. Without a way out,
 * that vendor meets a red suite over a file the template has never seen, and
 * the only way past it is editing a shipped test — which `CLAUDE.md` forbids in
 * so many words ("a shipped test that fails is a finding about your change, not
 * an obstacle in its way"), so the two rules would contradict each other and
 * the weaker one would lose.
 *
 * `lib/ai/customer-text.test.ts` (`customer-text-ok`), `db/sql-cast.test.ts`
 * (`sql-cast-ok`) and `scripts/core/purity.test.ts` (`core-pure-ok`) carry the
 * same hatch for the same reason. It is checked against the RAW line, not the
 * comment-blanked one, so the marker lives in a comment beside the line it
 * excuses — which makes it a decision somebody wrote down rather than a silent
 * hole.
 */
const EXEMPT = "operator-mail-ok";

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

/** Does this file name the sender in CODE, on a line nobody excused? */
function names(file: string): boolean {
  const raw = readFileSync(join(ROOT, file), "utf8").split(/\r?\n/);
  // Blanked as one document, then split: a `/* … */` spanning lines is only
  // recognisable whole, and `blankComments()` keeps the line count so the two
  // arrays stay aligned index for index.
  const code = blankComments(raw.join("\n")).split(/\r?\n/);
  return code.some(
    (line, index) => line.includes(NEEDLE) && !(raw[index] ?? "").includes(EXEMPT),
  );
}

const perDirectory = SCANNED.map((dir) => [dir, [...sourceFiles(dir)]] as const);
const files = perDirectory.flatMap(([, found]) => found).map((p) => p.split(sep).join("/"));
const callers = files.filter(names).sort();

describe("one way to an operator's inbox", () => {
  it("the walk is not empty, and it is not empty per directory either", () => {
    // Two ways this could be green while measuring nothing: a walk that found
    // no files, and a walk that silently skipped a directory. `sourceFiles()`
    // returns quietly on a `readdirSync` that throws, so a renamed entry in
    // SCANNED says nothing — and a total cannot see it, because `app` and `lib`
    // alone clear a hundred several times over.
    expect(files.length).toBeGreaterThan(100);
    for (const [dir, found] of perDirectory) {
      expect(found.length, `${dir}/ was scanned and found nothing`).toBeGreaterThan(0);
    }
    // And the needle really is one: the two files that MUST name it do.
    expect(callers).toContain("lib/email.ts");
    expect(callers).toContain("lib/notify/operators.ts");
  });

  it("🚨 nobody outside the channel calls the sender", () => {
    expect(
      callers,
      "a second entrance to `" +
        NEEDLE +
        "`. It throws with the transport's own words in the message, and " +
        "Postmark's error body names the recipient — `lib/cron/run.ts` writes " +
        "that message into `cron_runs.lastDetail`, which holds nothing " +
        "personal by promise. Go through `notifyOperators()` from " +
        "@/lib/notify/operators: it catches, logs the original to the console " +
        "and throws a count — and it brings the switch, the owner query and " +
        "the once-per-window marker with it. If a line genuinely must call the " +
        "sender directly — a path whose errors never reach `cron_runs` — put `" +
        EXEMPT +
        "` in a comment beside it and say why:\n  " +
        callers.join("\n  "),
    ).toEqual(Object.keys(ALLOWED).sort());
  });

  it("every allowlist entry carries a reason, and still exists", () => {
    // An allowlist whose entries have rotted is an allowlist nobody reads.
    for (const [path, why] of Object.entries(ALLOWED)) {
      expect(files, `${path} is allowlisted and is not in the tree`).toContain(path);
      expect(why.length, `${path} is allowlisted without a reason`).toBeGreaterThan(20);
    }
  });

  it("🚨 the hatch opens, and only for the line that carries it", () => {
    // Three halves, because a hatch that cannot be seen working is a promise to
    // a customer whose suite is already red, and one that opens too far is the
    // hole this guard exists to close.
    const marked = `  await ${NEEDLE}(to, mail); // ${EXEMPT}: a Server Action, never a job`;
    const bare = `  await ${NEEDLE}(to, mail);`;
    const commented = `  // ${NEEDLE} is what the channel calls`;

    const detects = (source: string) => {
      const raw = source.split(/\r?\n/);
      const code = blankComments(source).split(/\r?\n/);
      return code.some(
        (line, index) => line.includes(NEEDLE) && !(raw[index] ?? "").includes(EXEMPT),
      );
    };

    expect(detects(bare), "the scanner missed an unexcused caller").toBe(true);
    expect(detects(marked), "the marker beside the line did not excuse it").toBe(false);
    // A file may explain the rule it keeps — the house rule for every text
    // scanner here (`scripts/lib/source-text.mjs`).
    expect(detects(commented), "a comment tripped the scan").toBe(false);
    // 🚨 And the excuse does not spread: a marked line does not license the
    // next one. That is the difference between an exemption and an allowlist
    // entry, and it is the direction that quietly goes wrong.
    expect(detects(`${marked}\n${bare}`), "one excused line excused the whole file").toBe(
      true,
    );
  });
});
