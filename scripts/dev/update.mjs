#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Bring this app's GUIDANCE up to date — CLAUDE.md/AGENTS.md (the same file
// under the two names different programs look for), docs/ and .claude/skills/.
//
//   node run.mjs update            what would change (nothing is written)
//   node run.mjs update --apply    write it
//   node run.mjs update --confirm  show the plan, ask on the terminal, then write
//                                  (this is what `node run.mjs update-agents` runs)
//   node run.mjs update --from <url>   a different manifest (for testing)
//
// Why this exists: the app is a copy of a template that keeps being worked on.
// The code is yours from the moment you clone it — but the guidance is how the
// AI agent knows what the app can already do, and a copy of it from six months
// ago is how an agent rebuilds by hand a feature that has been in the template
// for months.
//
// The files come from the public repo this app was cloned out of
// (`raw` in .template-version), and the manifest is that same
// `.template-version` upstream. So there is no second copy of the truth
// anywhere: whatever `git clone` would give somebody today is what this reads.
//
// Three rules hold, and they are the whole design:
//
//  1. **Text only, never code.** A doc cannot conflict with the pages you built;
//     a lib/ file can. A code update stays a deliberate, separate step.
//  2. **A file you edited is yours.** `.template-version` records the hash each
//     file had when it shipped. Current == shipped means untouched, and only
//     those get replaced. Everything else is reported and left alone.
//  3. **Nothing is written without `--apply`**, and what is written is visible in
//     `git diff` afterwards — so it can be read, kept or thrown away.
//
// The decisions live in update-plan.mjs and are unit-tested; this file is the
// shell: read, fetch, print, write.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { isPrunedPath, readAgentProfile } from "./agent-configs.mjs";
import { confirmsApply, normalizeText, planUpdate, writable } from "./update-plan.mjs";

const STAMP = ".template-version";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
// --apply wins over --confirm: whoever says "write it" is not asked again.
const confirm = !apply && args.includes("--confirm");
const fromIndex = args.indexOf("--from");
const override = fromIndex !== -1 ? args[fromIndex + 1] : null;

// normalizeText: the hash describes the CONTENT, not the line endings this
// machine happens to store it with — see update-plan.mjs.
const sha256 = (text) => createHash("sha256").update(normalizeText(text), "utf8").digest("hex");
const label = { new: "new      ", update: "update   ", withdrawn: "withdrawn" };

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The hash a file has right now, or null when it is not here. */
function currentHash(file) {
  try {
    return sha256(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

// ── what this copy is ───────────────────────────────────────────────────────

if (!existsSync(STAMP)) {
  // Every copy made since the update mechanism exists carries this file. One
  // that does not predates it, and without a baseline there is no way to tell an
  // untouched file from one somebody wrote their own rules into — so this stops
  // rather than guesses.
  console.error(`✗ No ${STAMP} in this app.`);
  console.error("");
  console.error("  This copy is older than the update mechanism. Without it there is no");
  console.error("  record of how the files looked when they shipped, and overwriting them");
  console.error("  could take your own notes with it.");
  console.error("");
  console.error("  Clone the current template into a second folder and compare by hand:");
  console.error("  git clone https://github.com/digistore24/ds24-appkit");
  process.exit(2);
}

const stamp = readJson(STAMP);
const codeVersion = readJson("package.json").version;
const manifestUrl = override ?? stamp.source;

console.log(`This app: template ${stamp.version} (code ${codeVersion})`);

let remote;
try {
  remote = await getJson(manifestUrl);
} catch (error) {
  // Being offline is a normal state, not a failure of the app.
  console.error(`✗ Could not reach ${manifestUrl} — ${error.message}`);
  process.exit(1);
}

// ── the plan ────────────────────────────────────────────────────────────────

// Files this app deliberately does not have, because `node run.mjs agent-setup`
// removed the wiring for the programs it does not use. Without this the update
// would helpfully put them all back — and it would do it again after every
// release, which is how a tidy-up command teaches people to stop running it.
//
// Absent file, absent profile: nothing is filtered, which is the right default
// for everybody who never ran agent-setup.
// One reader, shared with agent-setup itself and with the two tests that walk
// the tree — `readAgentProfile()` in agent-configs.mjs. A profile that is there
// and unusable says so rather than looking like "nobody ever ran agent-setup":
// silently filtering nothing would put the other three programs' wiring back,
// which is the one thing this block exists to prevent.
const profile = readAgentProfile();
if (profile.found && !profile.ok) {
  console.error(`⚠ ${profile.problem} — nothing is treated as pruned.`);
}

const isPruned = (file) => isPrunedPath(profile, file);

// Filtered once, here, and used for everything downstream — a pruned path that
// survives into the plan comes back as "new" and undoes the tidy-up.
const remoteFiles = Object.fromEntries(
  Object.entries(remote.files ?? {}).filter(([file]) => !isPruned(file)),
);

const paths = new Set(
  [...Object.keys(remoteFiles), ...Object.keys(stamp.files ?? {})].filter((file) => !isPruned(file)),
);
const local = {};
for (const file of paths) {
  local[file] = { current: currentHash(file), shipped: stamp.files?.[file] ?? null };
}

const raw = remote.raw ?? stamp.raw;

/** Fetched file contents, keyed by path. Filled as needed, never twice. */
const fetched = {};
async function contentOf(file) {
  if (!(file in fetched)) fetched[file] = await getText(raw + file);
  return fetched[file];
}

// A skill's `requires:` can only be read from its own text, so those have to be
// fetched before the plan can be finished — but only the skills that would
// actually change, which is normally none or a handful. Everything else is
// fetched at `--apply` time and not before: a dry run should cost one request.
//
// Every SKILL.md, not just the ones under .claude/skills/: the stubs in
// .agents/skills/ carry the same `requires:` line, and they have to be refused
// on the same apps. A stub that slips through is worse than a skill that does —
// it is a signpost to a file the update just declined to write.
const skillsInPlay = Object.keys(remoteFiles).filter(
  (file) => file.endsWith("/SKILL.md") && local[file]?.current !== remoteFiles[file],
);
try {
  for (const file of skillsInPlay) await contentOf(file);
} catch (error) {
  console.error(`✗ Could not fetch ${raw} — ${error.message}`);
  process.exit(1);
}

const plan = planUpdate({
  local,
  remote: remoteFiles,
  content: fetched,
  codeVersion,
});

const changes = writable(plan);
const skipped = plan.filter(
  (entry) => entry.action === "local-change" || entry.action === "needs-code",
);
const withdrawn = plan.filter((entry) => entry.action === "withdrawn");

console.log(`Template: ${remote.version ?? "?"}\n`);

if (changes.length === 0 && skipped.length === 0 && withdrawn.length === 0) {
  console.log("✓ The guidance in this app is up to date.");
  process.exit(0);
}

for (const entry of changes) console.log(`  ${label[entry.action]}  ${entry.path}`);
for (const entry of withdrawn) {
  console.log(`  ${label.withdrawn}  ${entry.path}  (no longer in the template — yours stays)`);
}
for (const entry of skipped) console.log(`  keep       ${entry.path}  (${entry.reason})`);
console.log("");

if (skipped.length > 0) {
  console.log("`keep` means untouched. A file you changed here is yours — if you want the");
  console.log(`new version, read it at ${raw} and merge by hand.`);
  console.log("");
}

if (!apply && !confirm) {
  console.log(
    changes.length === 0
      ? "Nothing to write."
      : `${changes.length} file(s) would change. Nothing written — run: node run.mjs update --apply`,
  );
  process.exit(0);
}

if (confirm && changes.length > 0) {
  // The question needs a person on the other end. Without a terminal — an agent,
  // a pipe, a CI step — refuse rather than guess: applying would be the very
  // "--apply on its own initiative" that CLAUDE.md rules out, and declining
  // silently would report an update that never happened.
  if (!process.stdin.isTTY) {
    console.error("✗ --confirm needs a terminal to ask on. Nothing written.");
    console.error("  Read the plan above and decide: node run.mjs update --apply");
    process.exit(2);
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(`Write these ${changes.length} file(s)? [y/N] `);
  terminal.close();
  if (!confirmsApply(answer)) {
    console.log("Nothing written.");
    process.exit(0);
  }
  console.log("");
}

// ── writing ─────────────────────────────────────────────────────────────────

if (changes.length === 0) {
  console.log("Nothing to write.");
  process.exit(0);
}

// Fetch and check everything BEFORE writing anything: a half-applied update
// leaves the guidance describing two different templates at once, and the half
// that is missing is invisible.
try {
  for (const entry of changes) await contentOf(entry.path);
} catch (error) {
  console.error(`✗ Could not fetch the files — ${error.message}`);
  console.error("  Nothing written.");
  process.exit(1);
}

for (const entry of changes) {
  if (sha256(fetched[entry.path]) !== remote.files[entry.path]) {
    // The manifest and the file come from the same commit of the same repo, so
    // this is either a truncated download or a proxy serving something else.
    console.error(`✗ ${entry.path} does not match its hash in the manifest — nothing written.`);
    process.exit(1);
  }
}

for (const entry of changes) {
  mkdirSync(path.dirname(entry.path), { recursive: true });
  writeFileSync(entry.path, fetched[entry.path]);
  console.log(`  ✓ ${entry.path}`);
}

// The stamp records what shipped, so it moves on only for the files that now
// hold the template's version. A skipped file keeps its old baseline — that is
// what makes it recognisable as edited next time too.
const files = { ...(stamp.files ?? {}) };
for (const entry of plan) {
  if (entry.action === "new" || entry.action === "update" || entry.action === "unchanged") {
    files[entry.path] = remote.files[entry.path];
  }
}
writeFileSync(STAMP, `${JSON.stringify({ ...stamp, files }, null, 2)}\n`);

console.log("");
console.log(`✓ ${changes.length} file(s) updated. Everything is in git:`);
console.log("    git diff        read what changed");
console.log("    git checkout .  throw it away again");
