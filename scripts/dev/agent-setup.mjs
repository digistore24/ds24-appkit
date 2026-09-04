#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reduce this app to the one AI program you actually use.
//
//   node run.mjs agent-setup                  what it would do
//   node run.mjs agent-setup --apply          do it
//   node run.mjs agent-setup --agent codex --apply
//   node run.mjs agent-setup --undo --apply   wire all four up again
//
// ── Why the template ships wired for all four ───────────────────────────────
//
// Because "it works out of the box" has to be literally true. A fresh clone
// opened in Claude Code, Codex, Antigravity or OpenCode greets you and finds the
// skills before anybody has run anything. Wiring it up on demand would have made
// that claim conditional on remembering a command, and the person who most needs
// the greeting is exactly the one who does not know the command exists.
//
// The cost is files for three programs you do not use. This removes them.
// Tidiness afterwards, never a precondition.
//
// ── Nothing here is one-way ─────────────────────────────────────────────────
//
// People try one program and move to another, and that must not mean re-cloning.
// Everything removed can be written again from what stays:
//
//   the configs   from scripts/dev/agent-configs.mjs, which ships for this reason
//   the stubs     from .claude/skills/, via scripts/dev/agent-skills.mjs
//
// So `--agent <other> --apply` is always available, and so is `--undo`.
//
// ── What it never touches ───────────────────────────────────────────────────
//
//   .claude/skills/**              the real skills. Claude Code and OpenCode read
//                                  them directly and the stubs point at them —
//                                  they are not "the Claude folder", they are the
//                                  substance.
//   scripts/dev/session-start.mjs  the greeting, shared by all four.
//   CLAUDE.md, AGENTS.md           the same guidance under both names. Kept even
//                                  for a program that reads only one, because
//                                  switching later is a normal thing to do.
//   anything you wrote             it only ever removes paths it can regenerate.
//
// ── What it says at the end, and why ────────────────────────────────────────
//
// Wiring is not the last step. Three of the four programs gate the MCP server
// on trust or approval, and until that is cleared it is simply absent — no
// error, no tools — so "I wrote the config and nothing happened" is the normal
// first experience in three apps out of four. This command is the last thing
// the operator reads before meeting that, so it ends on the one line that
// applies to the program it has just wired up. The sentences live in
// agent-configs.mjs beside the programs they belong to, one source for the
// command and the document alike.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AGENTS,
  PROFILE_FILE,
  configFilesFor,
  detectAgent,
  gateNotice,
  gateSummary,
  prunedPathsFor,
  readAgentProfile,
} from "./agent-configs.mjs";
import { stubFor } from "./agent-skills.mjs";
import { browserWired } from "./browser-tool.mjs";
import { flagsFrom } from "../lib/args.mjs";

const ROOT = process.cwd();
const PROFILE = PROFILE_FILE;
const STUBS = ".agents/skills";

const abs = (file) => path.join(ROOT, file);

// ── the browser variant ─────────────────────────────────────────────────────
//
// `node run.mjs agent-browser --apply` adds Playwright's MCP server to the
// MCP-bearing configs, and the result is still OURS — a file this command
// wrote, in a second shape, not one the developer changed. Two things follow.
// A file in either shape may be removed (it can be regenerated in either); and
// a file written back — a kept one that is absent, or everything on `--undo` —
// comes back in the shape the app currently has, read off the files that are
// there. Without this, wiring the browser and then switching programs reported
// every MCP config as "kept — you changed this one" and restored the other
// programs WITHOUT the browser, which nobody asked for.
const BROWSER = browserWired(ROOT);

/** This program's files in the shape this app has them. */
const filesFor = (agent) => Object.entries(configFilesFor(agent, { browser: BROWSER }));

/** Is this text one of the two shapes we write for `file`? */
function ours(agent, file, text) {
  return (
    text === AGENTS[agent].files[file] ||
    text === configFilesFor(agent, { browser: true })[file]
  );
}

/** The stub files, derived from whatever skills this app currently has. */
function stubFiles() {
  let skills = [];
  try {
    skills = readdirSync(abs(".claude/skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  return skills.map((skill) => ({
    file: `${STUBS}/${skill}/SKILL.md`,
    content: stubFor(readFileSync(abs(`.claude/skills/${skill}/SKILL.md`), "utf8"), skill),
  }));
}

/**
 * Everything the chosen program needs, and everything it does not.
 *
 * Removal is per FILE and only when the file still holds what we put there.
 * Deleting a directory wholesale would take a `.codex/skills/` somebody added,
 * or the `permissions` block they wrote into `.claude/settings.json`, and it
 * would do it without a word. Same rule the guidance update lives by: a file you
 * changed is yours, and this reports it instead of touching it.
 */
function planFor(agent) {
  const keep = [];
  const drop = [];

  for (const name of Object.keys(AGENTS)) {
    for (const [file, content] of filesFor(name)) {
      (name === agent ? keep : drop).push({ file, content, agent: name });
    }
  }

  // The stubs are generated from this app's own skills, so "what we put there"
  // is whatever they would be regenerated as right now.
  const stubs = stubFiles();
  if (AGENTS[agent].stubs) keep.push(...stubs);
  else drop.push(...stubs);

  // "Still holds what we put there" — either shape of a config, or the stub
  // as it would be regenerated.
  const isOurs = ({ file, content, agent: owner }) =>
    owner ? ours(owner, file, read(file)) : read(file) === content;

  const present = drop.filter(({ file }) => existsSync(abs(file)));

  // 🚨 `yours` used to be computed from `drop` alone — so a file this profile
  // KEEPS, whose content the developer had changed, went straight into `write`
  // and was overwritten. Somebody who had added a `permissions` block to
  // `.claude/settings.json` or a hook to `.codex/config.toml` lost it, reported
  // as a bare `+ .claude/settings.json`, indistinguishable from creating a file
  // that was not there. The header of this file promises the opposite in so many
  // words. A kept file is written only when it is ABSENT.
  const changedKeep = keep.filter(
    (entry) => entry.content !== undefined && existsSync(abs(entry.file)) && !isOurs(entry),
  );

  return {
    write: keep.filter(
      ({ content, file }) => content !== undefined && !existsSync(abs(file)),
    ),
    remove: present.filter(isOurs),
    yours: [...present.filter((entry) => !isOurs(entry)), ...changedKeep],
  };
}

/**
 * What this app should NOT have, given the program it is set up for — minus
 * anything the customer changed, which stayed put and must keep being seen.
 *
 * Derived from the choice, not from what this run happened to delete: otherwise
 * switching twice quietly shortens the list, because the second run finds the
 * first run's files already gone and records only its own.
 */
function prunedPaths(agent) {
  const paths = prunedPathsFor(agent);
  const kept = planFor(agent).yours.map(({ file }) => file);
  return paths.filter((p) => !kept.some((file) => file === p || file.startsWith(`${p}/`)));
}

/** Directories left empty by the removal — never one that still holds anything. */
function emptyDirs(removed) {
  const candidates = new Set();
  for (const { file } of removed) {
    let dir = path.dirname(file);
    while (dir && dir !== "." && dir !== path.sep) {
      candidates.add(dir);
      dir = path.dirname(dir);
    }
  }
  // Deepest first, so `.agents/skills` goes before `.agents`.
  return [...candidates].sort((a, b) => b.length - a.length);
}

function read(file) {
  try {
    return readFileSync(abs(file), "utf8");
  } catch {
    return null;
  }
}

function write(file, content) {
  const target = abs(file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

// ── arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const undo = args.includes("--undo");
// ⚠️ Its own reading wanted the FULL flag name (`flag("--agent")`), so a call
// written like every other one in this tree found nothing and said so as
// "unknown program: undefined". The shared helper takes the bare name.
const flag = flagsFrom(args);

const names = Object.keys(AGENTS);
const asked = flag("agent");

if (asked && !AGENTS[asked]) {
  console.error(`✗ Unknown program: ${asked}`);
  console.error(`  Pick one of: ${names.join(", ")}`);
  process.exit(1);
}

// ── undo ────────────────────────────────────────────────────────────────────

if (undo) {
  const restore = [
    ...Object.keys(AGENTS).flatMap((name) =>
      filesFor(name).map(([file, content]) => ({ file, content })),
    ),
    ...stubFiles(),
    // 🚨 Only what is ABSENT. The filter used to be `read(file) !== content` —
    // i.e. "the developer changed it" was the very REASON to write over it, with
    // no `yours` branch anywhere on this path. `--undo` means "put back what was
    // pruned", never "discard what you wrote".
  ].filter(({ file }) => !existsSync(abs(file)));

  if (restore.length === 0) {
    console.log("✓ Already wired up for all four programs — nothing to do.");
    process.exit(0);
  }

  console.log("Wire this app up for all four programs again:\n");
  for (const { file } of restore) console.log(`  + ${file}`);

  if (!apply) {
    console.log("\nNothing written. Repeat with --apply to do it.");
    process.exit(0);
  }

  for (const { file, content } of restore) write(file, content);
  rmSync(abs(PROFILE), { force: true });
  console.log(`\n✓ ${restore.length} file(s) written. ${PROFILE} removed.`);
  // All four are wired now, so this run cannot know which gate the operator
  // will meet — it names all of them rather than none.
  console.log("");
  for (const line of gateSummary()) console.log(line);
  process.exit(0);
}

// ── which program? ──────────────────────────────────────────────────────────

// One reader for this file, `node run.mjs update` and the two tests that walk
// the tree — see `readAgentProfile()` in agent-configs.mjs. A profile that is
// there and unusable is not "no profile": it is said out loud, and then the
// last-run fallback simply has nothing to offer.
const previous = readAgentProfile(ROOT);
if (previous.found && !previous.ok) {
  console.error(`⚠ ${previous.problem}`);
  console.error("  Ignoring it — say which program this is, or delete the file and run again.");
}

const detected = detectAgent();
const agent = asked ?? detected ?? previous.agent;

if (!agent) {
  // Detection is a convenience, never the mechanism — the program running this
  // knows what it is. Saying so is one word and always correct; guessing from
  // environment variables is neither.
  console.error("✗ Cannot tell which program this is.");
  console.error("");
  console.error("  If you are the agent reading this: say which one you are.");
  for (const name of names) {
    console.error(`      node run.mjs agent-setup --agent ${name} --apply`.padEnd(58) + `# ${AGENTS[name].label}`);
  }
  process.exit(1);
}

// ── the plan ────────────────────────────────────────────────────────────────

const { write: toWrite, remove: toRemove, yours } = planFor(agent);
const label = AGENTS[agent].label;

if (toWrite.length === 0 && toRemove.length === 0) {
  console.log(`✓ Already set up for ${label} — nothing to do.`);
  if (yours.length > 0) {
    console.log("");
    console.log("  Left alone, because you changed them:");
    for (const { file } of yours) console.log(`    · ${file}`);
  }
  // Said here too, and deliberately: this is the exit an operator reaches when
  // the tools did not appear and they ran the command again to find out why.
  console.log("");
  for (const line of gateNotice(agent)) console.log(line);
  process.exit(0);
}

console.log(`This app, set up for ${label}${asked ? "" : detected ? " (detected)" : " (from the last run)"}:\n`);
for (const { file } of toWrite) console.log(`  + ${file}`);
for (const { file } of toRemove) console.log(`  - ${file}`);
for (const { file } of yours) console.log(`  · ${file}  (kept — you changed this one)`);
console.log("");
console.log("  The skills, the guidance and the greeting stay — only the wiring for the");
console.log("  other programs goes. `--undo` puts it all back, and so does --agent <other>.");

if (!apply) {
  console.log("\nNothing written. Repeat with --apply to do it.");
  process.exit(0);
}

for (const { file, content } of toWrite) write(file, content);
for (const { file } of toRemove) rmSync(abs(file), { force: true });

// Removing the last file out of `.agents/skills/build-app` leaves two empty
// directories behind, which reads as something half-finished. Emptiness is the
// whole condition — a directory that still holds anything is somebody's, and
// readdirSync throwing (not there) is fine too.
for (const dir of emptyDirs(toRemove)) {
  try {
    if (readdirSync(abs(dir)).length === 0) rmSync(abs(dir), { recursive: true });
  } catch {
    /* already gone, or never there */
  }
}

writeFileSync(
  abs(PROFILE),
  `${JSON.stringify(
    {
      agent,
      label,
      stubs: AGENTS[agent].stubs,
      pruned: prunedPaths(agent),
      note: "Written by `node run.mjs agent-setup`. Delete it and run the command again to start over.",
    },
    null,
    2,
  )}\n`,
);

console.log(`\n✓ Set up for ${label}. ${toWrite.length} written, ${toRemove.length} removed.`);
console.log(`  Recorded in ${PROFILE}, so \`node run.mjs update\` will not put them back.`);

console.log("");
for (const line of gateNotice(agent)) console.log(line);
