// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The configuration files whose only reader is a program that is NOT this app.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// `.gitleaks.toml` was unloadable from the day it was written — `'Rules[0].
// AllowList' expected a map, got 'slice'`, measured against gitleaks 8.30.1 —
// and nobody noticed for a year, because **nobody had the tool**. Every gate in
// this project was green over a file that no program on earth would accept. The
// fix landed in Story 30.7; the LESSON did not, and it is not about gitleaks:
// a config file that only a foreign tool reads is unverified by construction,
// and an unverified file that nobody has said is unverified is a trap.
//
// So every such file in this tree gets one of two things, and this file is where
// that is decided and enforced:
//
//   **`loaded`**    something already in this tree hands it to its tool on a
//                   path somebody walks — `npm run typecheck`, `node run.mjs
//                   start`, the migration runner. Nothing more is owed; what is
//                   asserted here is that the hand-over still exists.
//   **`run-here`**  nobody handed it over, and a run was cheap enough to build.
//                   It is below, and it PROVES THE TOOL ACCEPTS THE FILE — never
//                   that the file exists. That difference is the whole bug.
//   **`nobody`**    nobody loads it and nobody here can: the tool is not present,
//                   costs money, or needs an account. Then the honest answer is
//                   a written sentence, in the file itself wherever its format
//                   allows one, and never a silent tick.
//
// ── 🚨 Two doctrines this file is bound by ─────────────────────────────────
//
//  1. **A missing tool is a SPOKEN skip with a reason** (NFR-60) — `notChecked()`
//     writes one line to stderr and vitest counts the test as skipped. "I could
//     not look" and "there is nothing wrong" may never be the same colour. That
//     is not a detail here: `--config` with a tool nobody has is exactly how the
//     original bug hid, and a run added carelessly would hide it again.
//  2. **Nothing installs anything** (NFR-64). Everything below either uses a
//     devDependency that `npm install` already put there, or a tool that is
//     found on the PATH and otherwise skipped. No `npx` that would fetch, no
//     download, no account, and nothing that takes seconds.
//
// Measured on 2026-08-12, Linux, on the maintainer's machine: gitleaks 8.30.1
// 0.24 s, eslint 0.76 s, postcss + @tailwindcss/postcss 0.18 s, drizzle-kit
// 0.46 s, `git check-attr` 0.01 s.
//
// ── Every run carries its own needle ────────────────────────────────────────
//
// A check that loads a file and finds no fault is indistinguishable from a check
// that has quietly stopped looking — which is, again, the bug this file is about.
// So each run below is paired with a BROKEN file of the same kind, planted in a
// throwaway directory, and the tool has to refuse that one. Where the pair is
// missing, the run proves nothing and should not be believed.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { notChecked } from "@/lib/test-not-checked";

import { capture, hasCommand, whichCommand } from "./lib/proc.mjs";
import { DEVELOPER_KEY_PATHS } from "./security/patterns.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const there = (file: string) => existsSync(path.join(ROOT, file));

/** The sentence a `nobody` file has to carry, where its format allows a comment. */
const SPOKEN = /nobody loads this file/i;

interface Entry {
  /** Path from the app root. */
  file: string;
  /** The program outside this project that reads it. */
  tool: string;
  klass: "loaded" | "run-here" | "nobody";
  /** `loaded`: the in-tree file that hands it over, and the text proving it does. */
  by?: string;
  needle?: string;
  /** `nobody`: why nothing here can load it, and where that sentence is written. */
  why?: string;
  sentenceIn?: string;
}

// ── the inventory ───────────────────────────────────────────────────────────
//
// 🚨 A file belongs here when its READER is foreign. `config/*.json`,
// `modules/*/module.json`, `messages/*.json` and `.template-version` are read by
// this app's own code and are not in scope — they fail loudly when they break.

const INVENTORY: Entry[] = [
  // ── loaded: a path somebody walks already hands it over ───────────────────
  {
    file: "tsconfig.json",
    tool: "tsc, Next.js, vitest, every editor",
    klass: "loaded",
    by: "package.json",
    needle: "tsc --noEmit",
  },
  {
    file: "vitest.config.ts",
    tool: "Vitest",
    klass: "loaded",
    by: "package.json",
    needle: "vitest run",
  },
  {
    file: "next.config.ts",
    tool: "Next.js",
    klass: "loaded",
    by: "package.json",
    needle: "next build",
  },
  {
    file: "docker-compose.yml",
    tool: "Docker Compose v2",
    klass: "loaded",
    // `node run.mjs start` is the command every developer runs before anything
    // else, and it hands this file to `docker compose up` — so a compose file
    // Docker refuses is loud on the first attempt, not a year later.
    by: "scripts/db/up.mjs",
    needle: "docker-compose.yml",
  },
  {
    file: "package.json",
    tool: "npm",
    klass: "loaded",
    by: "scripts/deps.test.ts",
    needle: "package.json",
  },
  {
    file: "package-lock.json",
    tool: "npm",
    klass: "loaded",
    by: "scripts/security/rungs/posture.mjs",
    needle: "package-lock.json",
  },
  {
    file: ".gitignore",
    tool: "git",
    klass: "loaded",
    by: "scripts/security/rungs/posture.mjs",
    needle: ".gitignore",
  },
  {
    file: ".githooks/pre-commit",
    tool: "git (core.hooksPath)",
    klass: "loaded",
    by: "scripts/dev/hooks.mjs",
    needle: ".githooks",
  },
  {
    file: "drizzle/meta/_journal.json",
    tool: "drizzle-orm's migrator",
    klass: "loaded",
    by: "scripts/db/migrate.mjs",
    needle: "migrate",
  },

  // ── run-here: nothing handed it over, so this file does ───────────────────
  { file: ".gitleaks.toml", tool: "gitleaks", klass: "run-here" },
  { file: "eslint.config.mjs", tool: "ESLint 9 (flat config)", klass: "run-here" },
  { file: "postcss.config.mjs", tool: "PostCSS + @tailwindcss/postcss", klass: "run-here" },
  { file: "drizzle.config.ts", tool: "drizzle-kit", klass: "run-here" },
  { file: ".gitattributes", tool: "git", klass: "run-here" },

  // ── nobody: said out loud rather than ticked ──────────────────────────────
  {
    file: "sonar-project.properties",
    tool: "sonar-scanner + a SonarQube/SonarCloud server",
    klass: "nobody",
    why:
      "sonar-scanner is not a dependency here and a scan needs a server and an account. " +
      "Its CONTENT claim is measured below; its SYNTAX is not, and nothing here can measure it.",
    sentenceIn: "sonar-project.properties",
  },
  {
    file: "components.json",
    tool: "the shadcn/ui CLI",
    klass: "nobody",
    why:
      "only `npx shadcn@latest add …` reads it, and that fetches a package from the registry — " +
      "a download this project does not put inside a test run.",
  },
  {
    file: ".nvmrc",
    tool: "nvm / fnm / asdf",
    klass: "nobody",
    why:
      "no version manager is a dependency of this app, and the file's whole content is one " +
      "version number, so it has nowhere to carry a sentence. What it says is compared against " +
      "package.json's `engines.node` below — that is a claim about agreement, not about nvm.",
  },
  {
    file: ".worktreeinclude",
    tool: "Claude Code's git-worktree creation",
    klass: "nobody",
    why:
      "it is read by the agent program when it opens a worktree, and there is no way to ask that " +
      "program whether it accepted the file.",
    sentenceIn: ".worktreeinclude",
  },
  {
    file: ".claude/settings.json",
    tool: "Claude Code",
    klass: "nobody",
    why:
      "generated by scripts/dev/agent-configs.mjs and asserted to be valid JSON by " +
      "scripts/agent-setup.test.ts — but whether Claude Code ACCEPTS the settings it contains " +
      "can only be found out by running Claude Code.",
  },
  {
    file: ".mcp.json",
    tool: "Claude Code's MCP loader",
    klass: "nobody",
    why: "same as .claude/settings.json — generated, JSON-checked, never handed to the program here.",
  },
  {
    file: ".codex/config.toml",
    tool: "the OpenAI Codex CLI",
    klass: "nobody",
    why:
      "generated by scripts/dev/agent-configs.mjs. The Codex CLI is not a dependency, and no TOML " +
      "parser in this tree reads it — so not even its syntax is checked here.",
  },
  {
    file: ".agents/mcp_config.json",
    tool: "the Antigravity CLI",
    klass: "nobody",
    why: "generated, JSON-checked by scripts/agent-setup.test.ts, never handed to the program here.",
  },
  {
    file: "opencode.json",
    tool: "the OpenCode CLI",
    klass: "nobody",
    why: "generated, JSON-checked by scripts/agent-setup.test.ts, never handed to the program here.",
  },
  {
    file: ".opencode/plugins/session-start.js",
    tool: "OpenCode's plugin loader",
    klass: "nobody",
    why:
      "generated by scripts/dev/agent-configs.mjs. It is JavaScript, so it parses or it does not — " +
      "but nothing here loads it, and OpenCode's plugin contract cannot be checked without OpenCode.",
  },
  {
    file: "drizzle/meta/0000_snapshot.json",
    tool: "drizzle-kit generate",
    klass: "nobody",
    why:
      "the snapshots are drizzle-kit's own record of what the schema looked like at each migration. " +
      "Only `db-generate` reads them, and running it would WRITE a migration — the one run in this " +
      "inventory that cannot be made read-only. `drizzle-kit check` (below) does load the journal " +
      "and the migration set, which is the half that can be had for nothing.",
  },
  {
    file: "Makefile",
    tool: "GNU make",
    klass: "nobody",
    why:
      "make is absent on Windows and on a Mac without the Xcode command line tools, which is why " +
      "no documentation points at it — so a run would skip on exactly the systems the file is a " +
      "risk on. scripts/portability.test.ts holds it to being a pure alias for `node run.mjs`.",
  },
];

/** Root entries that are NOT foreign config — read in-tree, or not config at all. */
const NOT_FOREIGN_CONFIG = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "README.md",
  "auth.config.test.ts",
  "auth.config.ts",
  "auth.ts",
  "instrumentation.ts",
  "proxy.test.ts",
  "proxy.ts",
  "run.mjs",
  ".env.example",
  ".template-version",
]);

/** Generated or machine-local, and never committed — not this inventory's business. */
const GENERATED = (name: string) =>
  name === ".env" ||
  name === "next-env.d.ts" ||
  name.endsWith(".tsbuildinfo") ||
  name.endsWith(".log");

const byFile = new Map(INVENTORY.map((entry) => [entry.file, entry]));
const ofClass = (klass: Entry["klass"]) => INVENTORY.filter((entry) => entry.klass === klass);

// ── the inventory itself ────────────────────────────────────────────────────

describe("the inventory of foreign-tool configuration", () => {
  it("🚨 is not empty, and none of its three classes is", () => {
    // A count guard, because an inventory that found nothing is a FAILURE and
    // not a pass — the same shape of mistake as a scanner whose walk collapsed.
    expect(INVENTORY.length, "the inventory is empty — that is a broken test, not a clean tree").
      toBeGreaterThanOrEqual(24);
    expect(ofClass("loaded").length).toBeGreaterThanOrEqual(5);
    expect(ofClass("run-here").length).toBeGreaterThanOrEqual(4);
    expect(ofClass("nobody").length).toBeGreaterThanOrEqual(5);
    // One entry per file — a duplicate would let one classification hide another.
    expect(byFile.size).toBe(INVENTORY.length);
  });

  it("names only files that are really there", () => {
    const gone = INVENTORY.filter((entry) => !there(entry.file)).map((entry) => entry.file);
    expect(gone, "the inventory names files this tree does not have — it has rotted").toEqual([]);
  });

  it("🚨 leaves nothing at the app root unclassified", () => {
    // The guard against the inventory quietly ageing: a new dotfile or config at
    // the root is either foreign config with a class, or explicitly one of ours.
    // Anything else fails here rather than being unverified in silence.
    const stray = readdirSync(ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !GENERATED(name))
      .filter((name) => !NOT_FOREIGN_CONFIG.has(name))
      .filter((name) => !byFile.has(name));
    expect(
      stray,
      "a file at the app root is neither in the foreign-config inventory nor listed as one of " +
        "ours. Classify it: does a foreign tool read it, and if so does anything here load it?",
    ).toEqual([]);
  });

  it("says, for every file nobody loads, WHY nobody can", () => {
    for (const entry of ofClass("nobody")) {
      expect(String(entry.why ?? "").length, `${entry.file} has no written reason`).toBeGreaterThan(60);
    }
  });

  it("🚨 writes that sentence into the file itself wherever the format allows one", () => {
    const carriers = ofClass("nobody").filter((entry) => entry.sentenceIn);
    // Non-vacuity: a list that emptied would pass the loop below in full.
    expect(carriers.length).toBeGreaterThanOrEqual(2);
    for (const entry of carriers) {
      expect(
        read(entry.sentenceIn!),
        `${entry.sentenceIn} does not say that nobody loads it — an unchecked file without that ` +
          "sentence is a trap, which is the whole reason this inventory exists",
      ).toMatch(SPOKEN);
    }
  });

  it("keeps every `loaded` claim honest — the hand-over still exists", () => {
    for (const entry of ofClass("loaded")) {
      expect(there(entry.by!), `${entry.file} claims ${entry.by} loads it, and that file is gone`).
        toBe(true);
      expect(
        read(entry.by!),
        `${entry.by} no longer mentions ${entry.needle} — ${entry.file} may have lost its only reader`,
      ).toContain(entry.needle!);
    }
  });
});

// ── the runs ────────────────────────────────────────────────────────────────

/** A throwaway directory, and the broken file each needle is planted in. */
function scratch(): { dir: string; drop: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "ds24-foreign-"));
  return { dir, drop: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("gitleaks really loads .gitleaks.toml", () => {
  // 🚨 The original case. `rungs/history.mjs` passes this file with `--config`,
  // and a gitleaks that refuses it reports a SKIP — so the failure mode of the
  // file is a rung that quietly stops asking, on every machine that has the tool.
  it("accepts the shipped config, and refuses the spelling it used to have", async (ctx) => {
    if (!(await hasCommand("gitleaks", ["version"]))) {
      // ⚠️ `version`, no dashes — gitleaks exits non-zero on `--version`, so the
      // default would report a present gitleaks as absent.
      return notChecked(
        ctx,
        "gitleaks is not on this machine's PATH — brew install gitleaks, or the release binary from github.com/gitleaks/gitleaks",
      );
    }
    const { dir, drop } = scratch();
    try {
      const args = (config: string) => [
        "detect",
        "--no-git",
        "--source",
        dir,
        "--config",
        config,
        "--no-banner",
        "--no-color",
      ];

      const good = await capture("gitleaks", args(path.join(ROOT, ".gitleaks.toml")), {
        timeout: 30_000,
      });
      expect(
        `${good.stdout}${good.stderr}`,
        "gitleaks refused the shipped .gitleaks.toml — it is a file no scan can use, which is " +
          "exactly the state Story 30.7 found it in",
      ).not.toMatch(/Failed to load config/i);
      expect(good.code, "gitleaks exited non-zero over an empty directory").toBe(0);

      // The needle: the spelling this file used to carry. Measured against
      // gitleaks 8.30.1 — `'Rules[0].AllowList' expected a map, got 'slice'`,
      // exit 1. Without this, the assertion above would pass just as happily on
      // a gitleaks that had stopped reading `--config` at all.
      const broken = path.join(dir, "broken.toml");
      writeFileSync(
        broken,
        '[extend]\nuseDefault = true\n\n[[rules]]\nid = "x"\nregex = "abc"\n[[rules.allowlist]]\nregexes = ["abc"]\n',
      );
      const bad = await capture("gitleaks", args(broken), { timeout: 30_000 });
      expect(
        `${bad.stdout}${bad.stderr}`,
        "gitleaks accepted a config it is known to refuse — this check is no longer measuring the tool",
      ).toMatch(/Failed to load config/i);
      expect(bad.code).not.toBe(0);
    } finally {
      drop();
    }
  }, 60_000);
});

describe("ESLint really loads eslint.config.mjs", () => {
  // Nothing in `make check` runs the linter — `npm run lint` is a command a
  // person types. So a flat config that throws on load is invisible until then.
  it("resolves rules for a real file, and still refuses a broken config", async (ctx) => {
    let loadESLint: typeof import("eslint").loadESLint;
    try {
      ({ loadESLint } = await import("eslint"));
    } catch {
      return notChecked(ctx, "eslint is not installed here — run npm install");
    }

    const ESLint = await loadESLint({ useFlatConfig: true });
    const config = await new ESLint({ cwd: ROOT }).calculateConfigForFile("app/page.tsx");
    // Not "it did not throw": a flat config that resolved to nothing lints
    // nothing, and would pass a bare load. 112 rules on 2026-08-12.
    expect(Object.keys(config.rules ?? {}).length, "eslint.config.mjs resolved to no rules at all").
      toBeGreaterThan(20);

    // The needle, in the shape a flat config actually breaks: a config that
    // names a plugin nobody installed.
    const { dir, drop } = scratch();
    try {
      writeFileSync(
        path.join(dir, "eslint.config.mjs"),
        'import x from "ds24-a-plugin-that-does-not-exist";\nexport default [x];\n',
      );
      writeFileSync(path.join(dir, "a.js"), "const a = 1;\n");
      await expect(
        new ESLint({ cwd: dir }).calculateConfigForFile("a.js"),
        "ESLint accepted a config importing a package that is not there",
      ).rejects.toThrow();
    } finally {
      drop();
    }
  }, 60_000);
});

describe("PostCSS really loads postcss.config.mjs", () => {
  // The file that turns `@import "tailwindcss"` into the app's stylesheet. It is
  // loaded by `next build`, which no test runs — a broken plugin list here is a
  // deploy that produces an unstyled app.
  it("runs the configured plugins over real CSS, and refuses a plugin that is not there", async (ctx) => {
    let postcss: typeof import("postcss").default;
    try {
      postcss = (await import("postcss")).default;
    } catch {
      return notChecked(ctx, "postcss is not installed here — run npm install");
    }

    const loaded = (await import("../postcss.config.mjs")) as { default: { plugins?: object } };
    const names = Object.keys(loaded.default?.plugins ?? {});
    expect(names, "postcss.config.mjs declares no plugins at all").not.toEqual([]);

    const plugins = await Promise.all(
      names.map(async (name) => {
        const plugin = (await import(name)) as { default: (options?: unknown) => unknown };
        return plugin.default();
      }),
    );
    const result = await postcss(plugins as never[]).process('@import "tailwindcss";\n.ds24-x{color:red}', {
      from: undefined,
    });
    // Tailwind emitted a stylesheet rather than passing the import through — the
    // only outcome that proves the plugin ran. 82 KB on 2026-08-12; the floor is
    // deliberately far below it, because the number is a fact about today.
    expect(result.css.length, "the configured plugins produced no stylesheet").toBeGreaterThan(1000);
    expect(result.css).not.toContain('@import "tailwindcss"');

    // The needle: a plugin name nothing can resolve has to fail, or the loop
    // above would pass over a config whose plugins had all silently vanished.
    const absent = "ds24-a-postcss-plugin-that-does-not-exist";
    await expect(import(/* @vite-ignore */ absent)).rejects.toThrow();
  }, 60_000);
});

describe("drizzle-kit really loads drizzle.config.ts", () => {
  it("checks the migration set through the config, and refuses a broken one", async (ctx) => {
    // `npx --no-install` never fetches: it runs what npm already put in
    // node_modules/.bin and refuses otherwise (tier-2 doctrine, `security/tier2.mjs`).
    if (!existsSync(path.join(ROOT, "node_modules", "drizzle-kit"))) {
      return notChecked(ctx, "drizzle-kit is not installed here — run npm install");
    }
    const good = await capture("npx", ["--no-install", "drizzle-kit", "check"], {
      cwd: ROOT,
      timeout: 60_000,
    });
    const said = `${good.stdout}${good.stderr}`;
    expect(said, "drizzle-kit never reported reading drizzle.config.ts").toMatch(/drizzle\.config\.ts/);
    expect(good.code, `drizzle-kit refused this app's config or migrations: ${said.slice(0, 400)}`).
      toBe(0);

    // The needle: the same command in a directory with no config at all must
    // fail. Without it, a drizzle-kit that had started ignoring `check` would be
    // indistinguishable from a healthy one.
    const { dir, drop } = scratch();
    try {
      const bad = await capture("npx", ["--no-install", "drizzle-kit", "check"], {
        cwd: dir,
        timeout: 60_000,
      });
      expect(bad.code, "drizzle-kit reported success with no config in sight").not.toBe(0);
    } finally {
      drop();
    }
  }, 120_000);
});

describe("git really applies .gitattributes", () => {
  // The file that keeps a Windows clone on LF. `portability.test.ts` reads its
  // TEXT and asserts the line is present; this hands the file to git and asks
  // what git DOES with it — not the same claim, and it is git's answer that
  // decides whether `.env` parsing and `node run.mjs update` survive on Windows.
  //
  // 🚨 It is asked in a THROWAWAY repository, and that is the whole design.
  // Measured on 2026-08-12: asked in place, `git check-attr` answered `eol: lf`
  // even with the line deleted from this file — because `.gitattributes` files
  // STACK, and in the factory checkout an outer one says the same thing. The
  // check was reading the enclosing repository and reporting it as this app's
  // property. A fresh repository with nothing in it but this file has no
  // ancestor to borrow from.
  it("turns this app's own .gitattributes into eol=lf, in a repository of its own", async (ctx) => {
    if (!whichCommand("git")) return notChecked(ctx, "git is not on this machine's PATH");

    const { dir, drop } = scratch();
    try {
      const made = await capture("git", ["init", "--quiet", dir], { timeout: 30_000 });
      if (made.code !== 0) {
        return notChecked(ctx, `git could not make a scratch repository: ${made.stderr.trim().slice(0, 80)}`);
      }
      writeFileSync(path.join(dir, ".gitattributes"), read(".gitattributes"));
      writeFileSync(path.join(dir, "page.tsx"), "export default function Page() {}\n");

      const asked = await capture("git", ["check-attr", "text", "eol", "--", "page.tsx"], {
        cwd: dir,
        timeout: 30_000,
      });
      expect(asked.code, `git refused to read this .gitattributes: ${asked.stderr.slice(0, 200)}`).toBe(0);
      expect(
        asked.stdout,
        "git does not turn this app's .gitattributes into eol=lf — a Windows clone would get CRLF, " +
          "which silently breaks .env parsing and makes `node run.mjs update` refuse every file",
      ).toMatch(/eol:\s*lf/);
      expect(asked.stdout).toMatch(/text:\s*auto/);

      // The needle: an attribute nobody sets has to come back unset in the same
      // repository, or this would pass against a git that answered `lf` to
      // everything — including to a `.gitattributes` it never read.
      const unset = await capture("git", ["check-attr", "ds24-no-such-attribute", "--", "page.tsx"], {
        cwd: dir,
        timeout: 30_000,
      });
      expect(unset.stdout).toMatch(/unspecified/);
    } finally {
      drop();
    }
  }, 60_000);
});

// ── the claims a `nobody` file makes, where the CLAIM can be measured ───────

describe("sonar-project.properties — nobody loads it, so its content is checked here", () => {
  // 🚨 The catch this inventory was built to find, and it is the same shape as
  // `.gitleaks.toml`: the exception block used to name `lib/digistore/connect.ts`,
  // a file that has never existed in this tree. So the exemption excused nothing
  // and the first Sonar scan anybody ever ran would have opened with exactly the
  // false positive the block says it prevents. Nothing could notice, because
  // nobody runs Sonar.
  const text = read("sonar-project.properties");
  const exempted = [...text.matchAll(/^sonar\.issue\.ignore\.multicriteria\.\w+\.resourceKey=(.+)$/gm)]
    .map((match) => match[1].trim());

  it("exempts files that exist", () => {
    // Non-vacuity first: a regex that stopped matching would make every
    // assertion below vacuously true.
    expect(exempted.length, "no resourceKey was parsed out — this check is measuring nothing").
      toBeGreaterThanOrEqual(4);
    const missing = exempted.filter((file) => !there(file));
    expect(missing, "sonar-project.properties exempts a path this tree does not have").toEqual([]);
  });

  it("exempts exactly where the developer key legitimately lives", () => {
    // One list, in `scripts/security/patterns.mjs`, and `.gitleaks.toml` is
    // already held to it (`patterns.test.ts`). This is the third copy, and it was
    // the one nobody brought along.
    expect([...exempted].sort()).toEqual([...DEVELOPER_KEY_PATHS].sort());
  });

  it("names the symbol that is really there", () => {
    expect(text, "the reasoning points at a symbol this tree does not export").
      toContain("DIGISTORE_DEVELOPER_KEY");
    expect(text).not.toContain("BUILT_IN_DEVELOPER_KEY");
  });
});

describe(".nvmrc — nobody loads it, so its agreement is checked here", () => {
  it("names a version package.json's engines.node would accept", () => {
    const wanted = read(".nvmrc").trim();
    expect(wanted, ".nvmrc is empty").toMatch(/^\d+(\.\d+)*$/);
    const engines = (JSON.parse(read("package.json")) as { engines?: { node?: string } }).engines;
    const floor = /(\d+)/.exec(String(engines?.node ?? ""))?.[1];
    expect(floor, "package.json declares no engines.node to compare against").toBeTruthy();
    expect(
      Number(wanted.split(".")[0]),
      `.nvmrc says ${wanted} and package.json requires node ${engines?.node} — a version manager ` +
        "would put a developer on a Node this app refuses to run on",
    ).toBeGreaterThanOrEqual(Number(floor));
  });
});
