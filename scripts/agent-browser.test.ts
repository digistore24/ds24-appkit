// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A browser for the agent — `node run.mjs agent-browser`.
//
// What is guarded here is invisible from the inside, like everything in
// `agent-setup.test.ts` next door: a variant that no longer parses, a merge
// that drops the developer's own server, an `agent-setup` that reads the
// wired file as "yours" and restores the other programs WITHOUT the browser,
// and — the one that produced this command — guidance that names a browser
// tool no customer has. Measured over five field runs: the agent asked the
// user to look, every time, because "walk them through it" had no command.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENTS,
  BROWSER_MCP_VERSION,
  BROWSER_OUTPUT_DIR,
  BROWSER_PLAYWRIGHT_VERSION,
  BROWSER_SERVER_NAME,
  browserServer,
  configFilesFor,
  declaresMcpServer,
  mcpConfigFiles,
} from "./dev/agent-configs.mjs";
import {
  CHROMIUM_INSTALL,
  applyBrowserWiring,
  browserWired,
  chromiumInstalled,
  planBrowserWiring,
  playwrightBrowsersDir,
} from "./dev/browser-tool.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
type Agent = keyof typeof AGENTS;
const names = Object.keys(AGENTS) as Agent[];
const MCP_FILES = mcpConfigFiles() as { agent: Agent; file: string }[];

const folders: string[] = [];
afterAll(() => {
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway app carrying exactly the shipped wiring for all four programs. */
function shippedTree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ds24-agent-browser-"));
  folders.push(dir);
  for (const agent of names) {
    for (const [file, content] of Object.entries(AGENTS[agent].files)) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content as string);
    }
  }
  return dir;
}

/**
 * A Playwright cache that already holds a Chromium, so `--apply` in a test
 * never reaches for the network. `PLAYWRIGHT_BROWSERS_PATH` is Playwright's own
 * override, and `playwrightBrowsersDir()` honours it for exactly this reason.
 */
function fakeBrowserCache(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ds24-ms-playwright-"));
  folders.push(dir);
  mkdirSync(path.join(dir, "chromium-9999"));
  return dir;
}

const cli = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "dev", "agent-browser.mjs"), ...args],
    { cwd, encoding: "utf8", env: { ...process.env, ...env } },
  );

const setup = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", "dev", "agent-setup.mjs"), ...args], {
    cwd,
    encoding: "utf8",
  });

// ── the variant ─────────────────────────────────────────────────────────────

describe("the browser variant of every MCP-bearing config", () => {
  it("covers exactly the files that carry a server, and differs from what ships", () => {
    // Four files, one per program. The two that carry no server (Claude's
    // settings, OpenCode's plugin) must come out of the variant unchanged.
    expect(MCP_FILES.map(({ file }) => file).sort()).toEqual(
      [".agents/mcp_config.json", ".codex/config.toml", ".mcp.json", "opencode.json"],
    );
    for (const agent of names) {
      const shipped = AGENTS[agent].files as Record<string, string>;
      const variant = configFilesFor(agent, { browser: true });
      expect(Object.keys(variant).sort()).toEqual(Object.keys(shipped).sort());
      for (const [file, content] of Object.entries(variant)) {
        const carries = MCP_FILES.some((entry) => entry.file === file);
        expect(content !== shipped[file], `${file} should ${carries ? "" : "NOT "}change`).toBe(carries);
      }
    }
  });

  it.each(MCP_FILES)("$file names the server in the variant and not in the shipped file", ({ agent, file }) => {
    const shipped = (AGENTS[agent].files as Record<string, string>)[file];
    const variant = configFilesFor(agent, { browser: true })[file];
    expect(declaresMcpServer(file, shipped, BROWSER_SERVER_NAME)).toBe(false);
    expect(declaresMcpServer(file, variant, BROWSER_SERVER_NAME)).toBe(true);
    // The setup server must survive the addition — a variant that replaced it
    // would be a browser bought with the setup surface.
    expect(declaresMcpServer(file, variant, "ds24-setup")).toBe(true);
  });

  it("the JSON variants parse, and the TOML one keeps its servers ahead of its hooks", () => {
    for (const { agent, file } of MCP_FILES) {
      const variant = configFilesFor(agent, { browser: true })[file];
      if (file.endsWith(".json")) {
        expect(() => JSON.parse(variant), `${file} is not valid JSON`).not.toThrow();
      } else {
        const servers = variant.indexOf(`[mcp_servers.${BROWSER_SERVER_NAME}]`);
        const hooks = variant.indexOf("[[hooks.SessionStart]]");
        expect(servers).toBeGreaterThan(-1);
        expect(hooks).toBeGreaterThan(servers);
      }
    }
  });

  it("is pinned, headless, and writes into .dev/ — never `latest`, never a window", () => {
    const { command, args } = browserServer("linux");
    expect(command).toBe("npx");
    expect(args).toContain(`@playwright/mcp@${BROWSER_MCP_VERSION}`);
    expect(BROWSER_MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(args).toContain("--headless");
    expect(args.join(" ")).toContain(`--output-dir ${BROWSER_OUTPUT_DIR}`);
    expect(BROWSER_OUTPUT_DIR.startsWith(".dev/")).toBe(true);
    // `.dev/` is gitignored, which is what makes the output dir a legitimate
    // home for screenshots under CLAUDE.md's "session artifacts" rule.
    expect(read(".gitignore").split(/\r?\n/)).toContain(".dev/");
    // The Chromium fetch names the playwright the server was built against.
    expect(CHROMIUM_INSTALL).toEqual(["npx", "-y", `playwright@${BROWSER_PLAYWRIGHT_VERSION}`, "install", "chromium"]);
  });

  it("spells npx through cmd on Windows, and only there", () => {
    // `npx` is `npx.cmd` on Windows; a program spawning it without a shell gets
    // ENOENT, and an MCP server that fails to start is simply absent.
    expect(browserServer("win32")).toEqual({
      name: BROWSER_SERVER_NAME,
      command: "cmd",
      args: ["/c", "npx", ...browserServer("linux").args],
    });
    expect(browserServer("darwin").command).toBe("npx");
  });
});

// ── the plan, per file ──────────────────────────────────────────────────────

describe("what the command decides per file", () => {
  it("writes the variant over a shipped file, then has nothing left to do", () => {
    const dir = shippedTree();
    const plan = planBrowserWiring(dir, { platform: "linux" });
    expect(plan.map((s) => s.action)).toEqual(["write", "write", "write", "write"]);
    expect(browserWired(dir)).toBe(false);

    expect(applyBrowserWiring(dir, plan).sort()).toEqual(MCP_FILES.map(({ file }) => file).sort());
    for (const { agent, file } of MCP_FILES) {
      expect(readFileSync(path.join(dir, file), "utf8")).toBe(
        configFilesFor(agent, { browser: true, platform: "linux" })[file],
      );
    }
    expect(browserWired(dir)).toBe(true);
    expect(planBrowserWiring(dir, { platform: "linux" }).map((s) => s.action)).toEqual([
      "already", "already", "already", "already",
    ]);
  });

  it("--remove puts the shipped file back, and nothing else", () => {
    const dir = shippedTree();
    applyBrowserWiring(dir, planBrowserWiring(dir, { platform: "linux" }));
    const plan = planBrowserWiring(dir, { platform: "linux", remove: true });
    expect(plan.map((s) => s.action)).toEqual(["write", "write", "write", "write"]);
    applyBrowserWiring(dir, plan);
    for (const { agent, file } of MCP_FILES) {
      expect(readFileSync(path.join(dir, file), "utf8")).toBe(
        (AGENTS[agent].files as Record<string, string>)[file],
      );
    }
    expect(planBrowserWiring(dir, { platform: "linux", remove: true }).map((s) => s.action)).toEqual([
      "already", "already", "already", "already",
    ]);
  });

  it("skips a pruned program's file rather than creating it", () => {
    const dir = shippedTree();
    rmSync(path.join(dir, ".codex"), { recursive: true });
    const plan = planBrowserWiring(dir, { platform: "linux" });
    expect(plan.find((s) => s.file === ".codex/config.toml")?.action).toBe("absent");
    applyBrowserWiring(dir, plan);
    expect(existsSync(path.join(dir, ".codex", "config.toml"))).toBe(false);
  });

  it("merges into a file the developer changed, keeping their server", () => {
    // The developer added a server of their own to `.mcp.json` and a line to
    // the Codex config. Neither file is ours any more; both get the entry
    // ADDED, and what they wrote stays.
    const dir = shippedTree();
    const mine = { mcpServers: { "ds24-setup": { type: "stdio", command: "node", args: ["scripts/mcp/server.mjs"] }, mine: { type: "stdio", command: "node", args: ["mine.mjs"] } } };
    writeFileSync(path.join(dir, ".mcp.json"), `${JSON.stringify(mine, null, 2)}\n`);
    const toml = readFileSync(path.join(dir, ".codex", "config.toml"), "utf8");
    writeFileSync(path.join(dir, ".codex", "config.toml"), `${toml}\n[mcp_servers.mine]\ncommand = "node"\nargs = ["mine.mjs"]\n`);

    const plan = planBrowserWiring(dir, { platform: "linux" });
    expect(plan.find((s) => s.file === ".mcp.json")?.action).toBe("merge");
    expect(plan.find((s) => s.file === ".codex/config.toml")?.action).toBe("merge");
    applyBrowserWiring(dir, plan);

    const json = JSON.parse(readFileSync(path.join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(json.mcpServers).sort()).toEqual(["ds24-setup", "mine", BROWSER_SERVER_NAME].sort());
    expect(json.mcpServers[BROWSER_SERVER_NAME]).toEqual({
      type: "stdio",
      command: "npx",
      args: browserServer("linux").args,
    });
    const merged = readFileSync(path.join(dir, ".codex", "config.toml"), "utf8");
    expect(merged).toContain("[mcp_servers.mine]");
    expect(merged).toContain(`[mcp_servers.${BROWSER_SERVER_NAME}]`);
    expect(merged.indexOf(`[mcp_servers.${BROWSER_SERVER_NAME}]`)).toBeLessThan(merged.indexOf("[[hooks.SessionStart]]"));
  });

  it("leaves a `playwright` of the developer's own alone, and a file it cannot read", () => {
    const dir = shippedTree();
    const theirs = { mcpServers: { [BROWSER_SERVER_NAME]: { type: "stdio", command: "npx", args: ["@playwright/mcp@latest"] } } };
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify(theirs));
    writeFileSync(path.join(dir, "opencode.json"), "{ not json");

    const plan = planBrowserWiring(dir, { platform: "linux" });
    expect(plan.find((s) => s.file === ".mcp.json")?.action).toBe("yours");
    expect(plan.find((s) => s.file === "opencode.json")?.action).toBe("yours");
    applyBrowserWiring(dir, plan);
    expect(readFileSync(path.join(dir, ".mcp.json"), "utf8")).toBe(JSON.stringify(theirs));
    expect(readFileSync(path.join(dir, "opencode.json"), "utf8")).toBe("{ not json");
    // Theirs still counts as wired: what doctor asks is whether the agent has
    // a browser, not whether we wrote it.
    expect(browserWired(dir)).toBe(true);
  });
});

// ── agent-setup still knows its own files afterwards ───────────────────────

describe("agent-setup after the browser was wired", () => {
  it("prunes the variant as its own, restores the other program WITH the browser, and --undo keeps it", () => {
    const dir = shippedTree();
    applyBrowserWiring(dir, planBrowserWiring(dir));

    // 🚨 The needle: before `agent-setup` knew the variant, this printed
    // `· .mcp.json (kept — you changed this one)` for every MCP file and
    // wrote `.codex/config.toml` back WITHOUT the browser.
    const toCodex = setup(dir, ["--agent", "codex", "--apply"]);
    expect(toCodex.status, toCodex.stderr).toBe(0);
    expect(toCodex.stdout).not.toContain("kept — you changed");
    expect(existsSync(path.join(dir, ".mcp.json"))).toBe(false);
    expect(readFileSync(path.join(dir, ".codex", "config.toml"), "utf8")).toBe(
      configFilesFor("codex", { browser: true })[".codex/config.toml"],
    );

    // Switching again writes Claude's file back — in the shape the app has.
    const toClaude = setup(dir, ["--agent", "claude", "--apply"]);
    expect(toClaude.status, toClaude.stderr).toBe(0);
    expect(readFileSync(path.join(dir, ".mcp.json"), "utf8")).toBe(
      configFilesFor("claude", { browser: true })[".mcp.json"],
    );

    const undo = setup(dir, ["--undo", "--apply"]);
    expect(undo.status, undo.stderr).toBe(0);
    for (const { agent, file } of MCP_FILES) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).toBe(
        configFilesFor(agent, { browser: true })[file],
      );
    }
  });
});

// ── the command itself ──────────────────────────────────────────────────────

describe("the command", () => {
  it("writes nothing without --apply, and says so", () => {
    const dir = shippedTree();
    const before = readFileSync(path.join(dir, ".mcp.json"), "utf8");
    const dry = cli(dir, [], { PLAYWRIGHT_BROWSERS_PATH: fakeBrowserCache() });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("Nothing written");
    expect(dry.stdout).toContain("after asking");
    expect(readFileSync(path.join(dir, ".mcp.json"), "utf8")).toBe(before);
  });

  it("--apply writes the wiring and ends on what is still to do", () => {
    const dir = shippedTree();
    // A cache that already holds a Chromium: the command must then NOT reach
    // for the network. The fake dir is the whole proof — an install attempt
    // would leave `chromium-9999` beside a real download or fail loudly.
    const cache = fakeBrowserCache();
    const applied = cli(dir, ["--apply"], { PLAYWRIGHT_BROWSERS_PATH: cache });
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("4 file(s) written");
    expect(applied.stdout).toContain("NEXT session");
    // Every touched program's gate, like agent-setup: "I wrote the config and
    // nothing happened" is the ordinary first experience in three of four.
    for (const agent of names) expect(applied.stdout).toContain(AGENTS[agent].label);
    expect(browserWired(dir)).toBe(true);

    const again = cli(dir, ["--apply"], { PLAYWRIGHT_BROWSERS_PATH: cache });
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Nothing to do");

    const removed = cli(dir, ["--remove", "--apply"], { PLAYWRIGHT_BROWSERS_PATH: cache });
    expect(removed.status, removed.stderr).toBe(0);
    expect(browserWired(dir)).toBe(false);
  });

  it("refuses an app with no wiring for any program", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ds24-agent-browser-empty-"));
    folders.push(dir);
    const result = cli(dir, ["--apply"], { PLAYWRIGHT_BROWSERS_PATH: fakeBrowserCache() });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("agent-setup --undo");
  });

  it("is a task in run.mjs, so the guidance names a command that exists", () => {
    const help = spawnSync(process.execPath, ["run.mjs", "help", "--json"], { cwd: ROOT, encoding: "utf8" });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('"agent-browser"');
    // The two places an agent that read nothing else would look.
    expect(read("CLAUDE.md")).toContain("node run.mjs agent-browser --apply");
    expect(read(".claude/skills/ux-gateway/SKILL.md")).toContain("node run.mjs agent-browser");
  });
});

// ── the cache ───────────────────────────────────────────────────────────────

describe("where Playwright keeps its browsers", () => {
  it("follows Playwright's own rule per platform, and the override first", () => {
    const home = "/home/x";
    const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;
    expect(playwrightBrowsersDir({ env: env({}), platform: "linux", home })).toBe("/home/x/.cache/ms-playwright");
    expect(playwrightBrowsersDir({ env: env({ XDG_CACHE_HOME: "/c" }), platform: "linux", home })).toBe("/c/ms-playwright");
    expect(playwrightBrowsersDir({ env: env({}), platform: "darwin", home })).toBe("/home/x/Library/Caches/ms-playwright");
    expect(playwrightBrowsersDir({ env: env({ LOCALAPPDATA: "C:\\L" }), platform: "win32", home })).toBe(path.join("C:\\L", "ms-playwright"));
    expect(playwrightBrowsersDir({ env: env({ PLAYWRIGHT_BROWSERS_PATH: "/pw" }), platform: "linux", home })).toBe("/pw");
    // `0` is Playwright's "inside the package" and not a directory.
    expect(playwrightBrowsersDir({ env: env({ PLAYWRIGHT_BROWSERS_PATH: "0" }), platform: "linux", home })).toBe("/home/x/.cache/ms-playwright");
  });

  it("counts a chromium or a headless shell, and nothing else", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ds24-cache-"));
    folders.push(dir);
    expect(chromiumInstalled(dir)).toBe(false);
    mkdirSync(path.join(dir, "ffmpeg-1011"));
    mkdirSync(path.join(dir, "firefox-1500"));
    expect(chromiumInstalled(dir)).toBe(false);
    mkdirSync(path.join(dir, "chromium_headless_shell-1234"));
    expect(chromiumInstalled(dir)).toBe(true);
    expect(chromiumInstalled(path.join(dir, "does-not-exist"))).toBe(false);
  });
});
