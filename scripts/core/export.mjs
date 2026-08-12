#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Copy the shared core into a companion repo — a mobile app, typically.
//
//   node run.mjs export-core ../my-app-mobile/core            what would change
//   node run.mjs export-core ../my-app-mobile/core --apply    write it
//
// The manifest is config/core-export.json; what makes a file eligible is
// scripts/core/purity.test.ts; the full story is docs/mobile.md. Three rules
// hold, and they are `node run.mjs update`'s rules applied to code:
//
//  1. **Only the manifest.** Nothing else in this app is ever copied.
//  2. **A file you edited in the target repo is yours.** `.core-version` in
//     the target records the hash each file had when it was exported; only
//     files that still match get replaced, the rest are reported as kept.
//  3. **Nothing is written without `--apply`**, and what is written shows up
//     in the target repo's `git diff` — readable, keepable, revertible.
//
// The decisions live in export-plan.mjs (and, reused, in dev/update-plan.mjs)
// and are unit-tested; this file is the shell: read, resolve, print, write.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText, planUpdate, writable } from "../dev/update-plan.mjs";
import { exportStamp, refuseTarget } from "./export-plan.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const STAMP = ".core-version";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const target = args.find((a) => !a.startsWith("--"));

// normalizeText before hashing: the hash describes the CONTENT, not the line
// endings either machine stores it with — the exact lesson .template-version
// learned on Windows (see dev/update-plan.mjs).
const sha256 = (text) => createHash("sha256").update(normalizeText(text), "utf8").digest("hex");

function fail(message) {
  console.error(`✗ ${message}`);
  console.error("  Usage: node run.mjs export-core <target-dir> [--apply]");
  process.exit(1);
}

const targetAbs = target ? path.resolve(target) : "";
const refusal = refuseTarget(targetAbs, ROOT);
if (refusal) fail(refusal);

const { moduleCoreExports } = await import("../modules/inventory.mjs");

const manifest = JSON.parse(readFileSync(path.join(ROOT, "config", "core-export.json"), "utf8"));
// Plus whatever an INSTALLED module contributes through `coreExport`.
//
// ⚠️ `modules/api/keys/rules.ts` was typed into the core's own list until this
// existed, so an app that never ran `module add api` copied it into its
// companion repo regardless — a shared "core" file for a feature that app does
// not have. Merged rather than listed, for the same reason every other module
// contribution is: the core names no module.
manifest.files = [...manifest.files, ...moduleCoreExports()].sort();
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

// The template side: what WOULD be exported, hashed.
const remote = {};
const content = {};
for (const file of manifest.files) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  remote[file] = sha256(text);
  content[file] = text;
}

// The target side: what is there now, and what the last export said it wrote.
let shippedByPath = {};
const stampPath = path.join(targetAbs, STAMP);
if (existsSync(stampPath)) {
  try {
    shippedByPath = JSON.parse(readFileSync(stampPath, "utf8")).files ?? {};
  } catch {
    console.warn(`! ${STAMP} in the target is unreadable — treating every file as the target's own.`);
  }
}

const local = {};
for (const file of new Set([...manifest.files, ...Object.keys(shippedByPath)])) {
  const onDisk = path.join(targetAbs, file);
  local[file] = {
    current: existsSync(onDisk) ? sha256(readFileSync(onDisk, "utf8")) : null,
    shipped: shippedByPath[file] ?? null,
  };
}

// `content: {}` on purpose: `requires:` frontmatter is a skill concept; code
// files have none, and passing their text would only invite one to match.
const plan = planUpdate({ local, remote, content: {}, codeVersion: version });

const LABELS = {
  new: "new      ",
  update: "update   ",
  unchanged: "unchanged",
  "local-change": "keep     ",
  withdrawn: "withdrawn",
};

console.log(`Shared core → ${targetAbs}\n`);
let unchanged = 0;
for (const entry of plan) {
  if (entry.action === "unchanged") {
    unchanged++;
    continue;
  }
  const note =
    entry.action === "local-change"
      ? " (edited in the target — yours, left alone)"
      : entry.action === "withdrawn"
        ? " (no longer in the core — left in place, delete it yourself if unused)"
        : "";
  console.log(`  ${LABELS[entry.action] ?? entry.action} ${entry.path}${note}`);
}
if (unchanged > 0) console.log(`  unchanged ${unchanged} file(s)`);

const changes = writable(plan);
if (changes.length === 0) {
  console.log("\n✓ The target already matches the core. Nothing to write.");
  process.exit(0);
}

if (!apply) {
  console.log(
    `\n${changes.length} file(s) would change. Nothing written — run: node run.mjs export-core ${target} --apply`,
  );
  process.exit(0);
}

// Write. Files verbatim (LF — the repo guarantees it), directories as needed.
for (const entry of changes) {
  const destination = path.join(targetAbs, entry.path);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content[entry.path]);
}

// The refreshed stamp. Files the consumer edited keep their OLD shipped hash —
// so the next export still knows they are the consumer's, not ours.
const files = {};
for (const file of manifest.files) {
  const entry = plan.find((p) => p.path === file);
  files[file] =
    entry?.action === "local-change" ? (shippedByPath[file] ?? remote[file]) : remote[file];
}
writeFileSync(stampPath, `${JSON.stringify(exportStamp({ version, files }), null, 2)}\n`);

console.log(`\n✓ ${changes.length} file(s) written, ${STAMP} updated.`);
console.log("  Map the imports in the consumer's tsconfig: \"@/*\" → [\"./core/*\"] — see docs/mobile.md.");
