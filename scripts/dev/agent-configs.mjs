// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which program needs which files, and what is in them.
//
// This app ships wired for all four. That is what makes "it works out of the
// box" literally true — a fresh clone opened in any of them finds the skills and
// the MCP server before a single command has run, and three of the four greet
// you as well. `node run.mjs agent-setup` then reduces the clone to the one
// actually in use, and can put the others back.
//
// ⚠️ Three, not four, and the fourth is not an omission: Antigravity CLI has no
// session-start event to hang a greeting on. Its entry below carries the whole
// argument; the short version is that the guidance says what the hook cannot.
//
// So this module is the single source for both directions: the factory
// generates the shipped config files from it (scripts/agent-configs-stamp.mjs),
// and agent-setup restores from it after a prune. Two callers, one definition —
// otherwise "put it back" would put back something slightly different.
//
// ── What is NOT in here, and why ────────────────────────────────────────────
//
//   scripts/dev/session-start.mjs   the greeting itself. Shared by all four —
//                                   three run it from a hook, the fourth from
//                                   `node run.mjs greet` — so it is never
//                                   pruned and never restored.
//   .claude/skills/**               the real skills. OpenCode and Claude Code
//                                   read them directly, and the .agents/ stubs
//                                   point at them — so they stay, always, for
//                                   every program.
//
// Only the wiring is per-program. The substance is shared.

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The one line of shell in this project, repeated per program.
 *
 * The greeting is a Node script, so on a machine without Node it cannot run and
 * cannot say why — it prints nothing, and nothing reads as "all fine". This asks
 * the question in a language that is there before Node is. CLAUDE.md → Three
 * systems calls it the single deliberate exception to "no bash": it starts no
 * process and finds no process.
 */
export const NODE_PROBE =
  "if ! command -v node > /dev/null 2>&1; then echo '[Setup: blocked — node. " +
  "Node.js is not installed on this machine, so the greeting below could not run. " +
  "Run the skill setup-machine BEFORE writing any code.]'; fi";

/** The greeting every program runs at session start. */
export const GREETER = "node scripts/dev/session-start.mjs";

/**
 * The read guard — Claude Code only, because only Claude Code runs a
 * `PreToolUse` hook. It refuses a whole-file `Read` (no offset/limit) and an
 * unpiped `cat` on a file over 200 lines, with the line count and the two
 * ways that work. The rule it enforces is CLAUDE.md → *Reading the tree*; the
 * measurement behind it is in the script's header.
 */
export const READ_GUARD = "node scripts/dev/hooks/read-guard.mjs";

const claudeSettings = `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": ${JSON.stringify(NODE_PROBE)}
          },
          {
            "type": "command",
            "command": ${JSON.stringify(GREETER)}
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Bash",
        "hooks": [
          {
            "type": "command",
            "command": ${JSON.stringify(READ_GUARD)}
          }
        ]
      }
    ]
  }
}
`;

// Codex keeps hooks behind a feature flag and reads them from the same
// config.toml. The probe runs first for the same reason it does everywhere else.
const codexConfig = `# Codex reads AGENTS.md by itself — the only thing it needs from us is the
# greeting, and the flag that turns hooks on at all.

[features]
codex_hooks = true

[mcp_servers.ds24-setup]
command = "node"
args = ["scripts/mcp/server.mjs"]

[[hooks.SessionStart]]
command = ${JSON.stringify(NODE_PROBE)}

[[hooks.SessionStart]]
command = ${JSON.stringify(GREETER)}
`;

// OpenCode has no declarative hooks yet (opencode#14863), only plugins — so this
// is the one program whose greeting is code we ship rather than a line of
// config, and therefore the only one that could take a session down with it.
// Everything is wrapped: the situation it exists to report (no node on this
// machine) is exactly the one in which it fails.
const opencodePlugin = `// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The session greeting, for OpenCode. Generated from
// scripts/dev/agent-configs.mjs — edit it there, not here.
//
// It runs the same scripts/dev/session-start.mjs as the other hooks. Spawned
// rather than imported: a child process cannot take OpenCode down with it, and
// the greeting must never be the reason somebody cannot start work.
//
// Node and not bash, like everything else that has to run on Linux, macOS and
// Windows alike (CLAUDE.md → Three systems).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SessionGreeting = async ({ directory }) => {
  let done = false;

  async function greet() {
    if (done) return;
    done = true;

    try {
      const { stdout } = await run("node", ["scripts/dev/session-start.mjs"], {
        cwd: directory ?? process.cwd(),
        timeout: 15_000,
      });
      if (stdout.trim()) console.log(stdout.trimEnd());
    } catch (error) {
      // The one case worth a word: no node on this machine. Everything else
      // stays quiet — a broken greeting must not look like a broken project.
      if (error?.code === "ENOENT") {
        console.log(
          "[Setup: blocked — node. Node.js is not installed on this machine, so the " +
            "greeting could not run. Run the skill setup-machine BEFORE writing any code.]",
        );
      }
    }
  }

  // Registered twice on purpose. OpenCode's documented shape is a hook keyed by
  // the event name; a generic "event" hook is also described in the wild. Which
  // one is live is not something this file can find out, and the failure mode of
  // guessing wrong is the worst one available: no greeting, no error, and a
  // machine that may have no Node reading as "all fine". The done flag makes the
  // duplicate harmless — whichever fires first wins, the other returns.
  return {
    "session.created": () => greet(),
    event: async ({ event }) => {
      if (event?.type === "session.created") await greet();
    },
  };
};
`;

/**
 * The four programs, what each one needs, and how to tell you are in it.
 *
 * `stubs` says whether this program needs .agents/skills/. Claude Code and
 * OpenCode read .claude/skills/ directly and do not.
 *
 * `detect` is a best-effort read of the environment, never the mechanism: the
 * program running `agent-setup` knows what it is and should pass --agent. Env
 * detection is for a human running it by hand — and one of the four cannot be
 * detected at all (see `antigravity`), which is exactly why it is only ever a
 * convenience.
 */
// ── The setup MCP server ────────────────────────────────────────────────────
//
// Wiring for `scripts/mcp/server.mjs`, so a fresh clone can already ask its own
// app to create a user or a course room (docs/setup-mcp.md). It ships wired for
// the same reason everything else here does: "it works out of the box" beats
// "it works after you remember a command".
//
// 🚨 **The command and nothing else — never a key.** An `env` block inside an
// MCP server declaration is the ordinary way to configure one, and these files
// are tracked, so doing it that way would commit a production credential on the
// first `git add -A`. The server reads SETUP_KEY from `.env`, which is
// gitignored — and that is also the only formulation expressible in all four
// programs, because Codex has no config interpolation at all.
//
// The server is inert until `config/setup.json` says `"enabled": true`, so
// shipping the wiring switches nothing on.
const MCP_COMMAND = "node";
const MCP_ARGS = ["scripts/mcp/server.mjs"];
const MCP_NAME = "ds24-setup";

// ⚠️ Claude Code reads `.mcp.json` at the repo root, NOT `.claude/settings.json`.
const claudeMcp = `{
  "mcpServers": {
    ${JSON.stringify(MCP_NAME)}: {
      "type": "stdio",
      "command": ${JSON.stringify(MCP_COMMAND)},
      "args": ${JSON.stringify(MCP_ARGS)}
    }
  }
}
`;

// 🚨 OpenCode's config is `opencode.json` at the REPO ROOT, not in
// `.opencode/`. That folder holds agents, commands and plugins;
// `.opencode/opencode.json` is a silent dead end (opencode#4054, closed as not
// planned) — and this template already ships `.opencode/plugins/`, so the
// tree's own symmetry invites exactly that mistake. Note also its spelling:
// ONE array carrying the command and its arguments together.
const opencodeMcp = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    ${JSON.stringify(MCP_NAME)}: {
      "type": "local",
      "command": ${JSON.stringify([MCP_COMMAND, ...MCP_ARGS])},
      "enabled": true
    }
  }
}
`;

// 🚨 Antigravity CLI's MCP config is its OWN file, `.agents/mcp_config.json` —
// not a block inside a settings file, the way the other three spell it. Two
// details of that schema are easy to get wrong and both fail silently:
//
//   · there is NO `type` field. Transport is chosen by which key is present —
//     `command` for stdio, `serverUrl` for HTTP. `url` and `httpUrl`, which the
//     rest of the MCP world accepts, are refused here.
//   · it does NOT expand shell variables (antigravity-cli#233), where Claude
//     Code does. Nothing in this file needs one, and nothing in it may grow
//     one — see the `env` warning above.
//
// It shares `.agents/` with the skill stubs, which is a coincidence worth
// naming: `.agents/skills/` is exactly where this program looks for skills, so
// the stub tree that was built for Codex serves it too, unchanged.
const antigravityMcp = `{
  "mcpServers": {
    ${JSON.stringify(MCP_NAME)}: {
      "command": ${JSON.stringify(MCP_COMMAND)},
      "args": ${JSON.stringify(MCP_ARGS)}
    }
  }
}
`;

// ── What is still the operator's to do, once the wiring is written ──────────
//
// 🚨 Writing the config is not the last step, and in three of the four programs
// it is not even the step that makes anything happen. Each of those three gates
// the MCP server on trust or approval, and until that is cleared the server is
// simply ABSENT: no error, no warning, no tools — which from the operator's
// chair is indistinguishable from a template that does not work. "I wrote the
// config and nothing happened" is therefore the ORDINARY first experience
// there, and the command that has just written the config is the one place
// where saying so costs nothing.
//
// One sentence per program, and this is where they live. `docs/setup-mcp.md`
// carries the same four in prose (*Where the wiring lives*), and
// `scripts/agent-setup.test.ts` holds the two against each other — so the
// command and the document cannot drift into saying different things.
//
// `null` is an ANSWER and not a gap: OpenCode has no gate, and a program with
// nothing to clear must say so rather than fall silently out of the list.

/** What the uncleared gate does — the half that is the same in every program. */
export const GATE_EFFECT = "the MCP server is simply absent — no error, no tools";

/** Soft-wrap for the terminal: these sentences are prose, not identifiers. */
function wrap(text, { first = "", rest = "  ", width = 78 } = {}) {
  const lines = [];
  let line = first;
  let indent = first;
  for (const word of text.split(/\s+/)) {
    if (line !== indent && `${line} ${word}`.length > width) {
      lines.push(line);
      line = rest + word;
      indent = rest;
    } else {
      line = line === indent ? line + word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines;
}

/** Where the whole story is — printed with every notice, never restated here. */
const GATE_DOC = "docs/setup-mcp.md says what the server can do once it is there, and which switch it still needs.";

/**
 * What `agent-setup` prints after it has wired ONE program up.
 *
 * @param {string} agent one of the keys of AGENTS
 * @returns {string[]} lines ready to print — never empty, for any program
 */
export function gateNotice(agent) {
  const { label, gate } = AGENTS[agent];
  return gate
    ? [
        ...wrap(`${label} ${gate} Until you clear that, ${GATE_EFFECT}.`, { first: "⚠ " }),
        ...wrap(GATE_DOC, { first: "  " }),
      ]
    : [
        ...wrap(`${label} has no trust gate — there is nothing to clear before the tools appear.`, {
          first: "✓ ",
        }),
        ...wrap(GATE_DOC, { first: "  " }),
      ];
}

/**
 * The same four as one list — for `--undo`, which wires every program back up
 * and therefore cannot know which gate the operator is about to meet.
 *
 * @returns {string[]} lines ready to print
 */
export function gateSummary() {
  const entries = Object.values(AGENTS);
  const gated = entries.filter(({ gate }) => gate).length;
  return [
    ...wrap(
      `${gated} of the ${entries.length} gate the MCP server on trust or approval, and until that is cleared ${GATE_EFFECT}:`,
      { first: "⚠ " },
    ),
    "",
    ...entries.flatMap(({ label, gate }) =>
      wrap(`${label} ${gate ?? "has no gate."}`, { first: "  ", rest: "    " }),
    ),
    "",
    ...wrap(GATE_DOC, { first: "  " }),
  ];
}

export const AGENTS = {
  claude: {
    label: "Claude Code",
    detect: (env) => Boolean(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT),
    stubs: false,
    files: { ".claude/settings.json": claudeSettings, ".mcp.json": claudeMcp },
    gate: "asks you to approve the server; a cloned repo cannot pre-approve itself.",
  },
  codex: {
    label: "OpenAI Codex CLI",
    detect: (env) => Boolean(env.CODEX_SANDBOX || env.CODEX_HOME || env.CODEX_SESSION_ID),
    stubs: true,
    files: { ".codex/config.toml": codexConfig },
    gate: "ignores the whole .codex/ layer until you trust the project.",
  },
  // 🚨 The one program with NO greeting, and that is a property of the program
  // rather than a gap here. Antigravity CLI has five hook events —
  // PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop — and none of
  // them fires at session start. There is nothing to point at the greeter, so
  // this ships no hook file at all rather than one that looks wired and is not.
  //
  // What carries it instead is already written and needs no mechanism: AGENTS.md
  // (which this program reads by itself, no `context.fileName` to configure)
  // says that the ABSENCE of a greeting is never a signal, and that
  // `node run.mjs greet` MUST be run before the first file is touched. That
  // sentence was written for a hook that failed to fire; here it is the normal
  // path. `scripts/agent-setup.test.ts` asserts both halves — that this program
  // wires no greeting, and that the sentence which replaces it is still there —
  // so the exemption cannot quietly become an omission.
  antigravity: {
    label: "Antigravity CLI",
    // No detection, and that is measured rather than lazy: this program passes
    // session context to hooks as stdin JSON and sets no environment variable
    // of its own (the `AGY_CLI_*` names are settings a user may export, never
    // marks of a running session). Guessing from a variable somebody happens to
    // have set would remove the wiring they are using. So it says so, and the
    // `--agent` refusal below names it — which the file's own comment already
    // calls the mechanism, detection being only ever the convenience.
    detect: () => false,
    stubs: true,
    files: { ".agents/mcp_config.json": antigravityMcp },
    gate:
      "asks once whether you trust this workspace, and then asks again per tool: " +
      "an MCP tool nobody has ruled on defaults to Ask.",
  },
  opencode: {
    label: "OpenCode",
    detect: (env) => Boolean(env.OPENCODE || env.OPENCODE_BIN_PATH || env.OPENCODE_SESSION_ID),
    stubs: false,
    files: { ".opencode/plugins/session-start.js": opencodePlugin, "opencode.json": opencodeMcp },
    // The one program with nothing to clear. Written out rather than left off:
    // an absent key and "no gate" would be the same thing to a reader, and this
    // is the field where those two must not look alike.
    gate: null,
  },
};

/** Every config file this template ships, whoever it belongs to. */
export function allConfigFiles() {
  return Object.entries(AGENTS).flatMap(([agent, { files }]) =>
    Object.entries(files).map(([file, content]) => ({ agent, file, content })),
  );
}


/** Where the .agents/skills stubs live — the one prune entry that is a folder. */
export const STUB_TREE = ".agents/skills";

/**
 * What an app set up for `agent` should NOT have.
 *
 * Config files by their exact path, never by their folder. `.claude` as a
 * prefix would swallow `.claude/skills/**` — which is in the knowledge stamp and
 * belongs to every program — and `node run.mjs update` would silently stop
 * updating all seventeen skills. The stub tree is the one folder entry, because
 * a later release adds stubs that do not exist here yet.
 */
export function prunedPathsFor(agent) {
  const paths = new Set();
  for (const [name, { files }] of Object.entries(AGENTS)) {
    if (name === agent) continue;
    for (const file of Object.keys(files)) paths.add(file);
  }
  if (!AGENTS[agent].stubs) paths.add(STUB_TREE);
  return [...paths].sort();
}

/** Which program is this, as far as the environment gives it away? */
export function detectAgent(env = process.env) {
  const hits = Object.keys(AGENTS).filter((name) => AGENTS[name].detect(env));
  return hits.length === 1 ? hits[0] : null;
}

// ── what agent-setup RECORDED, and who reads it ─────────────────────────────
//
// 🚨 This app does not always have all four programs on disk, and everything
// that walks the tree has to know it. `node run.mjs agent-setup --apply` is a
// SHIPPED command whose documented purpose is exactly that — "Tidiness
// afterwards, never a precondition" — so a checker that assumes four is a
// checker that turns red the moment somebody follows the guidance. Measured in
// the field test of 2026-08-11: `scripts/portability.test.ts` did not merely
// fail, it died on `ENOENT: scandir '.opencode/plugins'`, so the portability
// question stopped being ASKED at all — and `scripts/agent-setup.test.ts`
// reported ten failures for files it had itself been told were gone.
//
// The record is `.agent-profile.json`, written by agent-setup and read by
// `node run.mjs update` (so an update does not put the wiring back) and by
// those two tests. The rule that a pruned path covers everything under it had
// three copies before this one existed; a fourth is what this replaces.

/** Where agent-setup records what this app was reduced to. */
export const PROFILE_FILE = ".agent-profile.json";

/**
 * What agent-setup recorded — and, when it cannot be used, WHY.
 *
 * Three answers, never two, on the rule this repo applies everywhere else:
 * "nobody has run agent-setup" and "it ran and I cannot read what it wrote"
 * are different facts, and a caller that treats the second as the first
 * silently checks the wrong app.
 *
 * @param {string} [root] the app's root; defaults to the current directory
 * @returns {{ found: boolean, ok: boolean, problem: string|null,
 *             agent: string|null, label: string|null, stubs: boolean,
 *             pruned: string[] }}
 */
export function readAgentProfile(root = process.cwd()) {
  const none = {
    found: false,
    ok: true,
    problem: null,
    agent: null,
    label: null,
    stubs: false,
    pruned: [],
  };

  let text;
  try {
    text = readFileSync(path.join(root, PROFILE_FILE), "utf8");
  } catch {
    // Not there: the shipped state, wired for all four. Never a problem.
    return none;
  }

  const bad = (problem) => ({ ...none, found: true, ok: false, problem });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return bad(`${PROFILE_FILE} is not valid JSON (${err.message})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return bad(`${PROFILE_FILE} is not an object`);
  }
  if (typeof parsed.agent !== "string" || !AGENTS[parsed.agent]) {
    return bad(`${PROFILE_FILE} names no program this template knows: ${JSON.stringify(parsed.agent)}`);
  }
  if (!Array.isArray(parsed.pruned) || parsed.pruned.some((p) => typeof p !== "string")) {
    return bad(`${PROFILE_FILE} has no "pruned" list of paths`);
  }

  return {
    found: true,
    ok: true,
    problem: null,
    agent: parsed.agent,
    label: typeof parsed.label === "string" ? parsed.label : AGENTS[parsed.agent].label,
    stubs: parsed.stubs === true,
    pruned: parsed.pruned,
  };
}

/**
 * Is this path one the profile says was taken away?
 *
 * A prune entry is either a file or a folder, and a folder covers everything
 * under it — `.agents/skills` stands for every stub in it. The `/` matters:
 * without it `.agents/skillset` would count as pruned by `.agents/skills`.
 *
 * @param {{ pruned: string[] }} profile
 * @param {string} file a path relative to the app root, with `/` separators
 */
export function isPrunedPath(profile, file) {
  return profile.pruned.some((entry) => file === entry || file.startsWith(`${entry}/`));
}
