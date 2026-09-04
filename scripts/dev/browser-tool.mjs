// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A browser for the agent — what is wired, what is installed, what to write.
//
// The library half of `node run.mjs agent-browser`; the command itself is
// `agent-browser.mjs` next door, and `doctor.mjs` reads the two questions
// (`browserWired()`, `chromiumInstalled()`) from here so the greeting's check
// and the command cannot disagree about what "set up" means.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// CLAUDE.md → *Never ship a broken page* asks the agent to call a page up
// before saying "done", and `ux-gateway` says an unseen page is not a passed
// page. `smoke` and `errors` see the SERVER — status codes and the log. What a
// page looks like is seen in a browser, and the agent has none: measured over
// five field runs, a session without a browser tool searched for one, found
// nothing, and asked the user to look instead. Every time.
//
// Playwright's MCP server is that browser. It is opt-in — the reasons are on
// `browserServer()` in agent-configs.mjs — so this is the command that adds it,
// to whichever of the four programs' configs are on disk, and fetches the
// Chromium build the pinned version wants.
//
// ── What "on disk" decides ──────────────────────────────────────────────────
//
// `agent-setup` prunes the three programs not in use, so a config file that is
// absent is a program the operator does not have — skipped, never created.
// Each file that IS there is one of four things, and the plan says which:
//
//   already   carries exactly the variant this command writes
//   write     is byte-for-byte the shipped file → becomes the variant
//   merge     was changed by the developer (a server of their own, say) and
//             does not name this one → the entry is added, the rest kept
//   yours     already names a server called `playwright` that is not ours —
//             theirs, and not touched; or cannot be parsed, same answer
//
// `agent-setup` recognises the variant as its own (a file it wrote, not one
// the developer changed), so pruning and restoring keep working after this.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  AGENTS,
  BROWSER_PLAYWRIGHT_VERSION,
  BROWSER_SERVER_NAME,
  browserServer,
  configFilesFor,
  declaresMcpServer,
  mcpConfigFiles,
} from "./agent-configs.mjs";

/**
 * Where Playwright keeps its browsers on this machine.
 *
 * Its own rule: `PLAYWRIGHT_BROWSERS_PATH` wins (`0` means "inside the
 * package", which no install here uses), otherwise a per-platform cache.
 * Parameters exist for the tests; a real call takes the machine it is on.
 */
export function playwrightBrowsersDir({
  env = process.env,
  platform = process.platform,
  home = homedir(),
} = {}) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override !== "0") return override;
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ms-playwright");
  }
  if (platform === "darwin") return path.join(home, "Library", "Caches", "ms-playwright");
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "ms-playwright");
}

/**
 * Is there a Chromium in that cache at all?
 *
 * Any build, deliberately — headless runs on `chromium_headless_shell-<rev>`
 * and headed on `chromium-<rev>`, and which revision the pinned version wants
 * is a fact only that version knows. A wrong revision is not silent: the
 * server says so on the first `browser_navigate` and offers its own
 * `browser_install` tool. What this answers is the question `doctor` can ask
 * cheaply — has anything ever been fetched here.
 */
export function chromiumInstalled(dir = playwrightBrowsersDir()) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  return entries.some((entry) => /^chromium(_headless_shell)?-\d+$/.test(entry));
}

/**
 * The install command — as a list, never a line a shell would parse
 * (CLAUDE.md → Three systems). `-y` so npx does not stop to ask, and the
 * PINNED playwright, because `install` fetches the build of the version that
 * runs it and the server was pinned to match.
 */
export const CHROMIUM_INSTALL = [
  "npx",
  "-y",
  `playwright@${BROWSER_PLAYWRIGHT_VERSION}`,
  "install",
  "chromium",
];

/** The MCP entry as each program's JSON spells it — for a merge into a changed file. */
function entryFor(file, { command, args }) {
  if (file === "opencode.json") return { type: "local", command: [command, ...args], enabled: true };
  if (file === ".mcp.json") return { type: "stdio", command, args };
  return { command, args };
}

/** Add the server to a file the developer changed, keeping everything else. */
function merged(file, current, server) {
  if (file.endsWith(".toml")) {
    const block =
      `[mcp_servers.${server.name}]\ncommand = ${JSON.stringify(server.command)}\n` +
      `args = ${JSON.stringify(server.args)}\n`;
    // Before the first hook block where there is one, so the file keeps the
    // shape the shipped one has (servers, then hooks); at the end otherwise.
    const at = current.search(/^\[\[hooks\./m);
    return at === -1
      ? `${current.replace(/\n*$/, "\n")}\n${block}`
      : `${current.slice(0, at)}${block}\n${current.slice(at)}`;
  }
  const parsed = JSON.parse(current);
  const key = file === "opencode.json" ? "mcp" : "mcpServers";
  parsed[key] = { ...(parsed[key] ?? {}), [server.name]: entryFor(file, server) };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * What `agent-browser` would do to each MCP-bearing config file on disk.
 *
 * @param {string} root the app's root
 * @param {{ platform?: string, remove?: boolean }} [options]
 * @returns {{ agent: string, file: string, action: "absent"|"already"|"write"|"merge"|"yours", content?: string }[]}
 */
export function planBrowserWiring(root, { platform = process.platform, remove = false } = {}) {
  const server = browserServer(platform);
  const steps = [];
  for (const { agent, file } of mcpConfigFiles()) {
    const target = path.join(root, file);
    if (!existsSync(target)) {
      steps.push({ agent, file, action: "absent" });
      continue;
    }
    const current = readFileSync(target, "utf8");
    const shipped = AGENTS[agent].files[file];
    const withBrowser = configFilesFor(agent, { browser: true, platform })[file];
    const declares = declaresMcpServer(file, current, BROWSER_SERVER_NAME);

    if (remove) {
      if (current === withBrowser) steps.push({ agent, file, action: "write", content: shipped });
      else if (current === shipped || declares === false) steps.push({ agent, file, action: "already" });
      else steps.push({ agent, file, action: "yours" });
      continue;
    }

    if (current === withBrowser) steps.push({ agent, file, action: "already" });
    else if (current === shipped) steps.push({ agent, file, action: "write", content: withBrowser });
    else if (declares !== false) steps.push({ agent, file, action: "yours" });
    else steps.push({ agent, file, action: "merge", content: merged(file, current, server) });
  }
  return steps;
}

/** Write the plan's `write` and `merge` steps. Returns the files written. */
export function applyBrowserWiring(root, steps) {
  const written = [];
  for (const step of steps) {
    if (step.content === undefined) continue;
    const target = path.join(root, step.file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, step.content);
    written.push(step.file);
  }
  return written;
}

/**
 * Does any program's wiring in this app name the browser server?
 *
 * The question `doctor` asks. "Any" rather than "all": an app reduced to one
 * program has one file, and that one is the whole answer. It reads the files,
 * not a record — a developer who added the server by hand has it too.
 */
export function browserWired(root = process.cwd()) {
  return mcpConfigFiles().some(({ file }) => {
    const target = path.join(root, file);
    if (!existsSync(target)) return false;
    return declaresMcpServer(file, readFileSync(target, "utf8"), BROWSER_SERVER_NAME) === true;
  });
}
