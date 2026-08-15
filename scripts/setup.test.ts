// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guarantees the setup rests on.
//
// `portability.test.ts` next door keeps the tooling free of Linux-only
// commands. This file keeps the *setup* honest, and it guards three things that
// each break silently and only on a machine nobody here owns:
//
//   1. every tool has an install instruction for all three systems,
//   2. the skill carries no install commands of its own — it reads them,
//   3. both database drivers are handled everywhere the database is touched.
//
// All three are the kind of mistake that passes review, passes the tests that
// exist, and then greets one Windows user with a dead end.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEPLOY_HOSTS, FIXES, PLATFORMS, fixLine } from "./dev/doctor.mjs";
import { DB_DRIVERS } from "./db/driver.mjs";
import { PROFILE_FILE, readAgentProfile } from "./dev/agent-configs.mjs";
import { notChecked } from "@/lib/test-not-checked";
import { blankCommentsFor } from "@/scripts/lib/source-text.mjs";

const ROOT = path.join(import.meta.dirname, "..");

/**
 * 🚨 A MIXED corpus through one door — four `.md` files, `.env.example`,
 * `package.json` and `lib/env-guard.ts` — so the blanking question is asked per
 * FILE. `blankComments()` here would be wrong in both directions at once: the
 * source half would keep reporting a file for explaining itself, and the docs
 * half would lose the very sentences these assertions are about, several of
 * which are POSITIVE (`toContain`) and would then go quietly green.
 */
const read = (file: string) => blankCommentsFor(file, readFileSync(path.join(ROOT, file), "utf8"));

describe("every tool can be installed on all three systems", () => {
  it.each(Object.keys(FIXES))("%s has an entry per platform", (tool) => {
    const fix = FIXES[tool as keyof typeof FIXES] as Record<string, unknown>;
    expect(Object.keys(fix).sort()).toEqual([...PLATFORMS].sort());
  });

  it.each(Object.keys(FIXES))("%s says something usable on every platform", (tool) => {
    const fix = FIXES[tool as keyof typeof FIXES] as Record<string, object>;
    // A command, a link or at the very least a sentence — an empty entry looks
    // handled in the table and reads as "missing, no idea" on the machine.
    for (const platform of PLATFORMS) {
      expect(fixLine(fix[platform]), `${tool} on ${platform}`).not.toEqual("");
    }
  });
});

// Why this is a test and not a note in the file: the moment a document carries
// its own `brew install …`, there are two tables. The one in doctor.mjs gets
// maintained because commands run through it; the copy in the prose does not,
// and it is the copy the agent reads out to the user.
const INSTALLERS = [
  /\bbrew\s+install\b/,
  /\bwinget\s+install\b/,
  /\bapt(-get)?\s+install\b/,
  /\bdnf\s+install\b/,
  /\bpacman\s+-S\b/,
  /\bsnap\s+install\b/,
  /\bxcode-select\b/,
  /\bnpm\s+install\s+-g\b/,
  // A pipe from the network into a shell — never, and least of all out of prose.
  /\|\s*(ba)?sh\b/,
];

describe("the setup skill reads the commands, it does not know them", () => {
  const skill = read(".claude/skills/setup-machine/SKILL.md");

  it.each(INSTALLERS.map((re) => [String(re), re] as const))(
    "contains no %s",
    (_label, pattern) => {
      expect(skill).not.toMatch(pattern);
    },
  );

  it("points at doctor --json as its source", () => {
    expect(skill).toContain("node run.mjs doctor --json");
  });
});

// The same rule, one step further along the path: the hosting CLIs are
// installed per system too, and the deploy is the moment somebody is on a
// machine none of us has seen. `docs/DEPLOY.md` is in here as well because it
// is where a person reads the same instruction — a stale command there is a
// stale command whether an agent or a human follows it.
describe("the hosting instructions read the commands too", () => {
  it.each(
    [".claude/skills/setup-hosting/SKILL.md", "docs/DEPLOY.md"].flatMap((file) =>
      INSTALLERS.map((re) => [file, String(re), re] as const),
    ),
  )("%s contains no %s", (file, _label, pattern) => {
    expect(read(file)).not.toMatch(pattern);
  });

  it.each([".claude/skills/setup-hosting/SKILL.md", "docs/DEPLOY.md"])(
    "%s points at doctor --deploy as its source",
    (file) => {
      expect(read(file)).toContain("node run.mjs doctor --deploy");
    },
  );

  // Hosting prices are not kept in this repository. They change, and a stale
  // number is worse than none: somebody budgets on it. The agent reads the
  // host's pricing page when it needs one — `setup-hosting` step 2.
  it.each([".claude/skills/setup-hosting/SKILL.md", "docs/DEPLOY.md", "README.md"])(
    "%s quotes no price",
    (file) => {
      expect(read(file)).not.toMatch(/[$€£]\s?\d|\d+\s?(USD|EUR)\b/);
    },
  );

  it("has an install entry per system for every hosting CLI", () => {
    for (const id of Object.keys(DEPLOY_HOSTS)) {
      expect(Object.keys(FIXES[id as keyof typeof FIXES]).sort(), id).toEqual(
        [...PLATFORMS].sort(),
      );
    }
  });
});

// The list of environment variables in DEPLOY.md is what somebody types into a
// hosting dashboard. A name that is wrong there produces an app that starts and
// then fails at the first thing anybody tries — and the name that was wrong for
// a while was `AUTH_RESEND_KEY`, a variable this project has never read.
describe("DEPLOY.md names variables that exist", () => {
  const deploy = read("docs/DEPLOY.md");
  const example = read(".env.example");

  // Tokens that look like an environment variable: SHOUTING_WITH_UNDERSCORES.
  const mentioned = [...new Set(deploy.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])];

  // Not variables of this app: the hosting tokens belong to the host's account
  // and never enter the app's environment, and PRE_DEPLOY is a DigitalOcean job
  // kind sitting in a YAML block.
  const FOREIGN = ["RAILWAY_TOKEN", "FLY_API_TOKEN", "DIGITALOCEAN_ACCESS_TOKEN", "PRE_DEPLOY"];

  it.each(mentioned.filter((name) => !FOREIGN.includes(name)))(
    "%s is declared in .env.example",
    (name) => {
      expect(example).toContain(name);
    },
  );

  // The other direction, for the two the app refuses to start without: whatever
  // lib/env-guard.ts complains about by name has to be findable here.
  it("names every variable the startup check demands", () => {
    const guard = read("lib/env-guard.ts");
    const demanded = [...new Set(guard.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])].filter(
      (name) => example.includes(name),
    );
    for (const name of demanded) expect(deploy, name).toContain(name);
  });
});

// The one failure this project cannot see from the inside: a machine with no
// Node. The greeting that would report it is itself a Node program, so it stays
// silent — and silence reads as "all fine". Three things hold that shut, and each
// one is a sentence somebody could tidy away as redundant while removing the only
// warning a whole class of users ever gets.
describe("a machine without Node cannot go unnoticed", () => {
  it("has a shell guard in front of the Node greeting", (ctx) => {
    // ⚠️ This one reads Claude Code's own file, and an app that ran
    // `node run.mjs agent-setup --agent codex|antigravity|opencode --apply` does
    // not have it — that command's documented purpose is to remove the wiring
    // of the programs this app does not use. The claim itself is not lost: the
    // probe-before-greeting order is asserted for ALL FOUR against
    // agent-configs.mjs in `scripts/agent-setup.test.ts`, which is where the
    // shipped files are generated from. What is skipped here is the disk copy.
    const file = ".claude/settings.json";
    if (!existsSync(path.join(ROOT, file))) {
      const profile = readAgentProfile(ROOT);
      return notChecked(
        ctx,
        `${file} is not in this app — it is set up for ${profile.label ?? "another program"} ` +
          `(${PROFILE_FILE}). The same order is asserted against agent-configs.mjs ` +
          `in scripts/agent-setup.test.ts`,
      );
    }
    const settings = JSON.parse(read(file));
    const commands = settings.hooks.SessionStart.flatMap(
      (entry: { hooks: { command: string }[] }) => entry.hooks.map((hook) => hook.command),
    );

    const guard = commands.find((command: string) => command.includes("command -v node"));
    expect(guard, "no SessionStart hook asks whether node exists").toBeTruthy();

    // `if !` and not `||`: a shell that cannot parse this prints NOTHING, where
    // the `||` form would warn somebody whose Node is fine. See CLAUDE.md →
    // Three systems; silence is the safe failure here, a false alarm is not.
    expect(guard).toMatch(/^if !/);
    expect(guard).toContain("setup-machine");

    // In front of it, so the reason is on screen before the missing greeting.
    expect(commands.indexOf(guard)).toBeLessThan(
      commands.findIndex((command: string) => command.includes("session-start.mjs")),
    );
  });

  it("makes build-app run a command instead of reading a line", () => {
    // Reading the greeting cannot work: on the machine this is for, there is no
    // greeting. A command that does not exist is the signal.
    const skill = read(".claude/skills/build-app/SKILL.md");
    const step = skill.slice(skill.indexOf("## Step 0a"), skill.indexOf("## Step 0 "));
    expect(step).toContain("node run.mjs doctor --json");
    expect(step).toContain("STOP");
  });

  it("states the precondition in CLAUDE.md, where it is always read", () => {
    // build-app is not always the way in — "build me an app" can go straight to
    // a Write. So the rule has to live in the file that is loaded every session.
    const rules = read("CLAUDE.md");
    expect(rules).toMatch(/Before the first file .* is written or changed/);
    expect(rules).toContain("node run.mjs doctor --json");
  });
});

describe("both database drivers are handled", () => {
  it("knows exactly docker and local", () => {
    expect(DB_DRIVERS).toEqual(["docker", "local"]);
  });

  // Every place that starts, stops or wipes the database has to branch — one
  // that forgets reaches for `docker compose` on a machine that has no Docker,
  // which is the single thing DB_DRIVER=local exists to avoid.
  it.each([
    ["scripts/db/up.mjs", "usesLocalPostgres"],
    ["scripts/dev/app.mjs", "usesLocalPostgres"],
    ["run.mjs", "usesLocalPostgres"],
  ])("%s branches on the driver", (file, marker) => {
    expect(read(file)).toContain(marker);
  });

  it.each(["run.mjs", "scripts/dev/app.mjs"])(
    "leaves no bare `docker compose` in %s outside a branch",
    (file) => {
      // A compose call has to sit inside the driver branch. The branch may be a
      // line above or below it (`if (…) … else await docker(…)`), so the test
      // looks at the neighbourhood rather than the single line.
      const lines = read(file).split("\n");
      const offenders = lines
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => /(docker\(|"docker",)\s*\[?\s*"compose"/.test(line))
        .filter(
          ([number]) =>
            !lines.slice(Math.max(0, number - 4), number + 2).join("\n").includes("usesLocalPostgres"),
        );
      expect(offenders).toEqual([]);
    },
  );

  it("ships no embedded Postgres by default", () => {
    // It is fetched on demand by whoever needs it. As a dependency it would cost
    // every user ~60 MB, including the majority who run Docker and never touch it.
    const pkg = JSON.parse(read("package.json"));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(declared)).not.toContain("embedded-postgres");
  });
});
