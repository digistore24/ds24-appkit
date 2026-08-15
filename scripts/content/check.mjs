#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs content-check` — does an environment hold what it should?
//
// ── The command is back, and it is not the old one ────────────────────────
// The first `content-check` counted the appliers' rows from the core. That was
// the whole answer only while the core could see everything there was; the
// moment a MODULE owned rows, it was answering a smaller question than its name
// while showing a green tick. It was withdrawn rather than extended.
//
// This one asks. Each owner answers for its own rows — the core for product
// media and the appliers, every module through the `presence` key in its
// manifest — and this command aggregates and never inspects.
//
// ── And it asks the ENVIRONMENT, not a database ───────────────────────────
// The question travels as a read-only setup tool, so `--env prod` needs no
// production connection string in anybody's shell. That the target's setup
// surface has to be switched on is not a new requirement: checking a remote
// environment has always needed a door into it, and this is a narrower door
// than the database.
//
// Usage:
//   node run.mjs content-check                this machine's environment
//   node run.mjs content-check --env prod
import { fileURLToPath } from "node:url";

import { CONTENT_MEDIA_MANIFEST, PRODUCT_MEDIA_ITEM } from "../../lib/content-media/rules.mjs";
import { presenceProblems } from "../../lib/content/presence-rules.mjs";
import { callSetup, reportRefusal, resolveEnvName } from "../setup/client.mjs";
import { declaredVsReported, loadManifest } from "./_manifest.mjs";
import "../lib/env.mjs";
import { flagsFrom } from "../lib/args.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const args = process.argv.slice(2);
const flag = flagsFrom(args);

// 🚨 The environment table and NFR-60's three sentences live in
// `scripts/setup/client.mjs`, not here. They were a copy per reader once, and a
// second copy is how "unreachable", "the surface is off there" and "refused"
// stop being three different answers.
const resolved = resolveEnvName(flag("env"));
if (resolved.error) {
  console.error(`✗ ${resolved.error}`);
  process.exit(2);
}
const target = resolved.env;

const answer = await callSetup(target, { tool: "content_presence" });
if (!answer.ok) process.exit(reportRefusal(answer));

const { data } = answer.body;
const reports = data?.reports;

// 🚨 An answer carrying no reports is a REFUSAL, never an empty environment.
// `collectPresence()` puts the core in first and always — so an array that is
// absent, not an array, or empty is a statement about the ANSWER (a build older
// than this tool's shape, something that rewrote the body), and never about the
// customer's content. A `?? []` here would collapse "it said nothing" into "it
// said nothing is wrong", which is the fault this whole command is written
// against.
if (!Array.isArray(reports) || reports.length === 0) {
  console.error(`✗ ${target} answered without a single presence report — nothing was measured.`);
  console.error(`  At least the core answers for itself (lib/content/presence.ts), so this is`);
  console.error(`  the answer being wrong, not that environment being empty. A deployed app`);
  console.error(`  older than this checkout is the usual reason.`);
  process.exit(1);
}

console.log(`\nWhat ${target} holds\n`);
for (const report of reports) {
  if (report.unanswered) {
    // 🚨 A failure, never a pass. This command exists to catch an environment
    // that is EMPTY, so "nothing to report" and "I could not look" must not
    // render the same — which is the fault the old command had by construction.
    console.log(`  ✗ ${report.owner.padEnd(12)} could not answer — ${report.unanswered}`);
    continue;
  }
  const items = report.items ?? [];
  if (items.length === 0) {
    console.log(`  · ${report.owner.padEnd(12)} nothing of its own to hold`);
    continue;
  }
  for (const item of items) {
    const expected = item.expected === null ? "" : ` of ${item.expected}`;
    // 🚨 Three marks for three states, and `⏭` is the one this command was
    // missing. A named absence is a finding and outranks everything — an object
    // that really is gone stays a `✗` even if the store then stopped answering
    // for the rest. Otherwise an item with an unasked half is `⏭`, never `✓`:
    // a tick that conceals a question nobody put is the defect, not the cure.
    const mark = item.missing?.length ? "✗" : item.notChecked ? "⏭" : item.found === 0 ? "·" : "✓";
    console.log(`  ${mark} ${report.owner.padEnd(12)} ${item.what}: ${item.found}${expected}`);
    if (item.missing?.length) console.log(`      missing: ${item.missing.join(", ")}`);
    // A word for a reader, never a problem: an item in a legitimate state that
    // needs a sentence to be readable at all ("product media: 0" says nothing
    // about what was looked for or where). For product media it is also the
    // EVIDENCE — how many objects were really asked for — so that a tick can be
    // told apart from a tick nobody earned.
    if (item.note) console.log(`      ${item.note}`);
    if (item.notChecked) console.log(`      ⏭ not checked: ${item.notChecked}`);
  }
}

// ── What was not asked ──────────────────────────────────────────────────────
// Neither a pass nor a finding, and it MUST be said out loud: this command
// answers a go-live question, and "green because it checked" and "green because
// it skipped" are the same colour. Collected across every owner, printed above
// the verdict, and it does not change the exit code — an unreachable store is
// not a statement about the customer's content.
const unchecked = reports.flatMap((report) =>
  (report.items ?? [])
    .filter((item) => item.notChecked)
    .map((item) => `${report.owner}: ${item.what} — ${item.notChecked}`),
);

// ── Does that environment know about the media THIS checkout declares? ──────
// Only this process can ask: the app knows what it holds, and the repo the
// deploy came from is here. The item is found by the shared label constant
// rather than by matching a sentence — a comparison that silently finds nothing
// looks exactly like one that found no disagreement.
//
// ⚠️ Deliberately NOT folded into `problems`. Those are one owner's statement
// about its own rows; this is a disagreement BETWEEN two sides, and an operator
// has to be able to tell which of the two they are reading — a checkout ahead
// of the deployed commit is the legitimate version of this finding.
const core = reports.find((report) => report.owner === "core") ?? null;
const local = loadManifest(ROOT);
let disagreement = null;

if (!local.missing && local.problems.length > 0) {
  console.log("");
  console.log(`  ⚠️ this checkout's own ${CONTENT_MEDIA_MANIFEST} has ${local.problems.length} problem(s)`);
  console.log(`     — run node run.mjs content-apply --dry-run; only the entries that`);
  console.log(`     validated are counted below.`);
}

// A core that could not answer is compared against nothing: "I could not look"
// must never be reworded as "that environment holds less".
if (core && !core.unanswered) {
  const declaredHere = local.missing ? 0 : local.entries.length;
  const coreItem = (core.items ?? []).find((item) => item.what === PRODUCT_MEDIA_ITEM) ?? null;
  disagreement = declaredVsReported(declaredHere, coreItem);
}

// ── The verdict, over the reports printed above ─────────────────────────────
// 🚨 **The judgement is made HERE and not taken from the app, deliberately.**
// The exit code has an input the server structurally cannot have: `disagreement`
// compares THIS CHECKOUT's own manifest (`loadManifest(ROOT)`) against what that
// environment reported, and only this process holds the repo the deploy came
// from — sending the manifest up would be the wrong direction, since it is the
// very file whose absence is the question. A verdict that lived over there
// would therefore be half the verdict.
//
// So the reports are judged by the same function the app runs on them
// (`lib/content/presence-rules.mjs` — one implementation, two readers), and the
// `problems` array that travels in the payload is NOT read by this command.
// It was, and it made the exit code the opinion of a build that can be older
// than this checkout: measured in Story 42.3, a report carrying `unanswered`
// beside an empty `problems` printed `✗ core could not answer` and then
// `✓ every owner answered, nothing missing` and exited 0 — a cross on the
// screen and a tick in the exit code, on the command that gates a go-live.
// The array stays in the payload for a client that asks the tool directly over
// MCP (`lib/setup/tools.ts`); it is not the source of this exit.
const problems = presenceProblems(reports);

console.log("");
if (unchecked.length > 0) {
  console.log(`⏭ ${unchecked.length} thing(s) NOT checked — neither a pass nor a finding:\n`);
  for (const line of unchecked) console.log(`  ${line}`);
  console.log("");
}
if (problems.length > 0) {
  console.log(`✗ ${problems.length} problem(s):\n`);
  for (const problem of problems) console.log(`  ${problem}`);
  console.log("");
}
if (disagreement) {
  console.log(`✗ this checkout and ${target} do not agree:\n`);
  console.log(`  ${disagreement}`);
  console.log("");
}
if (problems.length > 0 || disagreement) process.exit(1);

// ⚠️ Green means "everything every owner covers is present". It does not mean
// the pages render — that is your eyes, and `docs/content.md` says so. And when
// something above was not asked, the sentence says so rather than claiming the
// whole question: exit 0 with a `⏭` above it is "nothing is missing of what was
// checked", which is a smaller statement and the true one.
console.log(
  unchecked.length > 0
    ? `✓ every owner answered; nothing missing among what was checked.`
    : `✓ every owner answered, nothing missing.`,
);
console.log(`  That is not the same as "it renders" — open a paid page and look.\n`);
