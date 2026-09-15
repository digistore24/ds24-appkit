// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The greeting has to greet a beginner as a beginner.
//
// `scripts/dev/session-start.mjs` decides between two texts by counting the
// pages under app/dashboard/ that the template did NOT ship. Zero means "fresh
// clone" and prints the one sentence the whole README points at — "Build my
// app". Anything above zero means "project under way".
//
// So the list of shipped pages in that hook is load-bearing, and it goes wrong
// in the quietest way there is: somebody adds a page to the template, the list
// stays as it was, the count never reaches zero again, and from then on every
// first-time user is asked what they want to carry on with — in an app in which
// they have not done anything yet. Nothing throws, no page breaks, and the only
// symptom is a greeting nobody who works here ever sees, because their own
// project is under way. That happened once already, with app/dashboard/chat.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { blankComments } from "./lib/source-text.mjs";

const ROOT = path.join(import.meta.dirname, "..");

describe("the session greeting knows which pages ship with the template", () => {
  const hook = readFileSync(path.join(ROOT, "scripts/dev/session-start.mjs"), "utf8");

  // Read as text, not imported: the hook prints the greeting on import and asks
  // the doctor while doing it. Its own side effects are the point of the file.
  const declared = hook.match(/const SHIPPED = new Set\(\[([^\]]*)\]\)/);

  const onDisk = readdirSync(path.join(ROOT, "app/dashboard"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("declares the list in the form this test can read", () => {
    expect(declared, "const SHIPPED = new Set([…]) not found in the hook").not.toBeNull();
  });

  it("names only folders that still exist under app/dashboard/", () => {
    const shipped = [...declared![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    // ONE direction, deliberately. A shipped name pointing at nothing (a
    // template page renamed without updating the list) is the leftover this
    // guards against. The reverse is NOT required: an app built on this
    // template adds its own dashboard folders on purpose, and onDisk growing
    // past SHIPPED is exactly the "project under way" the greeting detects.
    // (A field-test session had to relax this mid-build; the one-directional
    // form is what survives build-app actually being used.)
    const stale = shipped.filter((name) => !onDisk.includes(name));
    expect(stale, "SHIPPED names folders that no longer exist").toEqual([]);
  });

  it("🚨 asks whether a folder is a MODULE's parking spot rather than listing it", () => {
    // A module's routes live under `app/` because Next scans nothing else,
    // named `page.<id>.tsx` — so the folder is on disk whether or not the
    // module is installed, and it is nobody's page: not the template's, not the
    // customer's.
    //
    // `"community"` sat in SHIPPED for exactly that, from the time the community
    // was core. It gave the right answer for the wrong reason and only for the
    // one module somebody had thought of: `moduleNavAreas()` reads the manifests
    // of INSTALLED modules, and this is precisely the uninstalled case. The next
    // module to park a `/dashboard/…` area would have had its folder announced
    // to the customer as a page they built and forgot to write down.
    expect(
      hook,
      "the greeting no longer asks whether a dashboard folder belongs to a module",
    ).toMatch(/function isModuleParkingSpot\(/);
    expect(hook).toMatch(/!isModuleParkingSpot\(`app\/dashboard\/\$\{entry\.name\}`\)/);
  });
});

// ── The path: derived, never typed ─────────────────────────────────────────
//
// 🚨 The greeting used to print the path as ONE hand-typed arrow chain, and that
// chain omitted `operate` — the phase that begins the day the app goes live and
// does not end was missing from the one line every session reads, while CLAUDE.md,
// the README and `coach` all had it. Nothing could see it: four prose tellings of
// one list, each internally consistent, and prose cannot be held against prose.
//
// The fix was DELETION plus an import, not a fifth copy. So what this file can
// check is the property that fix bought: **there is no list of steps in the hook
// that anybody CAN forget to update.**
// After a compaction, Claude Code fires SessionStart again and the hook says the
// rules back — the summary keeps the work and drops them (measured 2026-09-15:
// twelve English lines in the first turn after one, at a customer who had
// written German throughout).
//
// ⚠️ The only test in this file that RUNS the hook, and it has to be: everything
// `--after-compact` is worth is what lands on stdout, and reading the source as
// text would assert that the strings exist — not that the flag reaches them
// ahead of the doctor run, the journey read and the greeting the file opens
// with. The second half is the sharper one: this hook fires mid-work, and a
// "Build my app" greeting there invites a session to start over.
describe("the greeting after a compaction", () => {
  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/dev/session-start.mjs"), "--after-compact"],
    { cwd: ROOT, encoding: "utf8" },
  );

  it("says the rules the summary dropped", () => {
    expect(run.status, `the hook exited ${run.status}: ${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("[After compaction");
    // The line the 2026-09-15 measurement was about, and the one a hand-back
    // loses first.
    expect(run.stdout).toContain("in THEIR language");
    expect(run.stdout).toContain("committed AND pushed");
  });

  it("says nothing else — the session is in the middle of something", () => {
    expect(run.stdout).not.toContain("Build my app");
    expect(run.stdout).not.toContain("[Setup:");
    expect(run.stdout).not.toContain("[Project state:");
    expect(run.stdout).not.toContain("[Journey:");
  });

  it("🚨 restates nothing that is not still written where it says it is", async () => {
    // Every line the hook prints is a copy of a rule in CLAUDE.md, stages.md or
    // guidance.md, and a copy ages silently. So each carries an anchor — a
    // phrase from its source — and this is where the anchor is held against
    // the file: change or delete the rule, and its line here goes red until it
    // follows. Whitespace-insensitive, because the sources wrap at 80 columns.
    const { AFTER_COMPACT_RULES } = await import("./dev/after-compact-rules.mjs");
    expect(AFTER_COMPACT_RULES.length).toBeGreaterThan(0);
    const squash = (text: string) => text.replace(/\s+/g, " ");
    for (const rule of AFTER_COMPACT_RULES) {
      const source = squash(readFileSync(path.join(ROOT, rule.source), "utf8"));
      expect(
        source,
        `the hook says "${rule.line}" but ${rule.source} no longer contains "${rule.anchor}"`,
      ).toContain(squash(rule.anchor));
      expect(run.stdout).toContain(rule.line);
    }
  });
});

describe("the greeting derives the path instead of restating it", () => {
  const hook = readFileSync(path.join(ROOT, "scripts/dev/session-start.mjs"), "utf8");
  // ⚠️ Two readings of one file, deliberately. Anything asking *does the CODE
  // still say this* goes through `blankComments()` — the house rule (CLAUDE.md →
  // Rules), and here it is load-bearing: the hook EXPLAINS the deleted arrow
  // chain and prints the phase names in a comment, so a raw search would report
  // the file that documents the fix as breaking it. The one assertion that is
  // about a comment reads the raw text and says so.
  const code = blankComments(hook);

  it("reads the one machine-readable original", () => {
    // Non-vacuity for everything below: a `blankComments()` that emptied the whole
    // file would make three "does not contain" assertions pass on nothing.
    expect(code).toMatch(/from "\.\/journey\.mjs"/);
    expect(code).toMatch(/from "\.\/journey-render\.mjs"/);
    expect(code).toMatch(/describeJourneyLine\(/);
  });

  it("carries no hand-typed chain of steps", () => {
    // The shape of the deleted line, and of anything like it: step names strung
    // together with two or more arrows. A second copy of the path is what this
    // asserts cannot come back.
    const chains = code.split(/\r?\n/).filter((line) => /(?:→|->).*(?:→|->)/.test(line));
    expect(chains, `a hand-typed path is back in the greeting:\n${chains.join("\n")}`).toEqual([]);
    // The omission itself, by name: the chain that shipped named seven steps and
    // `operate` was not one of them.
    expect(code).not.toContain("build → payment");
  });

  it("names the phases off PHASES rather than spelling them out", () => {
    // Both branches of the greeting print the phase list, and both go through the
    // same derivation — a literal `1 Plan   2 Build` in either would be the fifth
    // copy this change removed.
    expect(code).toMatch(/PHASES\.filter\(\(phase\) => phase\.num !== null\)/);
    // Both call sites: the beginner branch and the carry-on branch.
    expect((code.match(/phaseNames\("/g) ?? []).length).toBe(2);
    expect(code).not.toMatch(/1 Plan.{0,12}2 Build/);
  });

  it("prints the [Journey: …] line unconditionally, unlike its two neighbours", () => {
    // ⚠️ The one deliberate asymmetry. `[Operations: …]` and `[Machine: …]` speak
    // only when there is something to say; this one answers the most common
    // question in this project and REPLACED a line that already printed every
    // time. Its only silence is a read that threw, and then nothing is known.
    expect(code).toMatch(/if \(journeyLine\) console\.log\(journeyLine\)/);
    // The reasoning has to be IN the file, not only in this test — so this one
    // assertion is about the raw text on purpose.
    expect(hook).toMatch(/prints EVERY time/);
  });
});

// The same guard for the three lists the greeting gained when the reminder
// stopped being about pages only. Every one of them is one-directional for the
// reason spelled out above — this test ships inside the customer's app, and an
// app with more tables than the template is not a fault, it is the product.
describe("the greeting knows what else ships with the template", () => {
  const hook = readFileSync(path.join(ROOT, "scripts/dev/session-start.mjs"), "utf8");

  /** The names out of `const <NAME> = new Set([…])`, read as text. */
  function declaredSet(name: string): string[] {
    const match = hook.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
    expect(match, `const ${name} = new Set([…]) not found in the hook`).not.toBeNull();
    return [...match![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }

  it("names only page areas that still exist under app/", () => {
    const onDisk = readdirSync(path.join(ROOT, "app"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const stale = declaredSet("SHIPPED_AREAS").filter((name) => !onDisk.includes(name));
    expect(stale, "SHIPPED_AREAS names folders that no longer exist under app/").toEqual([]);
  });

  it("names only tables the schema still declares", () => {
    // Read with the hook's own expression, so a table it cannot see cannot be
    // "covered" by this test either — the two would disagree silently.
    const onDisk = new Set<string>();
    for (const file of readdirSync(path.join(ROOT, "db"))) {
      if (!file.startsWith("schema") || !file.endsWith(".ts") || file.includes(".test.")) continue;
      const source = readFileSync(path.join(ROOT, "db", file), "utf8");
      for (const match of source.matchAll(/pgTable\(\s*"([A-Za-z0-9_]+)"/g)) onDisk.add(match[1]);
    }
    const stale = declaredSet("SHIPPED_TABLES").filter((name) => !onDisk.has(name));
    expect(stale, "SHIPPED_TABLES names tables the schema no longer declares").toEqual([]);
  });

  it("names only jobs the registry still knows", () => {
    const ids = readFileSync(path.join(ROOT, "lib/cron/ids.mjs"), "utf8");
    const known = [...ids.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const stale = declaredSet("SHIPPED_JOBS").filter((name) => !known.includes(name));
    expect(stale, "SHIPPED_JOBS names jobs that are no longer in lib/cron/ids.mjs").toEqual([]);
  });
});
