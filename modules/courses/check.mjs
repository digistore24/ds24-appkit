#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs courses-check` — is THIS app's course coherent?
//
// The division of labour, and it matters:
//
//   * `content-check` asks an ENVIRONMENT whether it holds the course. It is a
//     release gate, it runs over HTTP, and it must not go red while somebody is
//     still writing lesson twelve.
//   * this asks the REPO and this machine's database whether the course adds
//     up: the switch, the product key, the slugs, the media a content file
//     names. It is a developer's tool, so it may be as chatty as it likes and
//     it names things by slug.
//
// Bare Node, like every other `run.mjs` command: no bundler, no TypeScript.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import "../../scripts/lib/env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHAPES = ["self-study", "drip", "workshop"];

let failed = false;
const ok = (line) => console.log(`  ✓ ${line}`);
const warn = (line) => console.log(`  ! ${line}`);
const bad = (line) => {
  console.log(`  ✗ ${line}`);
  failed = true;
};

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
}

console.log("\nThe course's settings");

const config = readJson("config/course.json");
if (!config) {
  bad("config/course.json is missing or is not valid JSON — the course counts as OFF");
} else {
  if (config.enabled === true) ok("switched on");
  else warn("switched OFF — every course route answers 404 (this is the normal state until the content is written)");

  if (config.shape === undefined) {
    if (config.enabled === true) bad('"shape" is missing, and there is deliberately no default');
  } else if (!SHAPES.includes(config.shape)) {
    bad(`"shape" is ${JSON.stringify(config.shape)} — one of ${SHAPES.join(", ")}`);
  } else {
    ok(`shape: ${config.shape}`);
  }

  const products = readJson("config/digistore-products.json");
  const keys = products && products.products ? Object.keys(products.products) : [];
  if (typeof config.productKey !== "string" || !config.productKey) {
    if (config.enabled === true) bad('"productKey" is missing — the course has to be sold as something');
    else warn("no productKey yet");
  } else if (keys.length > 0 && !keys.includes(config.productKey)) {
    // `hasPlan()` THROWS on an unknown key, so this is a 500 on the course
    // page rather than a locked-out member — worth catching here.
    bad(
      `productKey "${config.productKey}" is not in config/digistore-products.json ` +
        `(it has: ${keys.join(", ")}) — hasPlan() throws on an unknown key`,
    );
  } else {
    ok(`sold as: ${config.productKey}`);
  }
}

console.log("\nThe content in this repo");

const contentDir = join(ROOT, "content", "course");
const files = existsSync(contentDir)
  ? readdirSync(contentDir).filter((name) => name.endsWith(".json")).sort()
  : [];

if (files.length === 0) {
  warn("no content/course/*.json yet — nothing to apply, so every page would be empty");
} else {
  const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const seen = new Map();
  let units = 0;
  let withoutContent = [];
  let withTask = [];

  for (const name of files) {
    let block;
    try {
      block = JSON.parse(readFileSync(join(contentDir, name), "utf8"));
    } catch (error) {
      bad(`content/course/${name}: not valid JSON — ${error.message}`);
      continue;
    }
    for (const [what, slug] of [["block", block.slug], ...(block.units ?? []).map((u) => ["unit", u.slug])]) {
      if (typeof slug !== "string" || !slugRe.test(slug)) {
        bad(`content/course/${name}: ${what} slug ${JSON.stringify(slug)} is not a slug — lower-case ASCII, digits, single hyphens`);
        continue;
      }
      if (seen.has(slug)) bad(`slug "${slug}" is used twice: ${seen.get(slug)} and ${name}`);
      else seen.set(slug, name);
    }
    for (const unit of block.units ?? []) {
      units += 1;
      if (!unit.body && !unit.video) withoutContent.push(unit.slug);
      // The field is `taskPrompt` here because that is what the applier reads
      // out of a content file (`content/appliers/course.mjs`); it lands in the
      // column `task_prompt`.
      if (unit.taskPrompt) withTask.push(unit.slug);
    }
  }

  // ⚠️ Labelled rather than split, and the label is the whole of it. Blocks and
  // lessons now have two origins (`origin` on both tables), but this command
  // reads the REPO and has no database connection — nor should it get one: a
  // developer's tool that needs a reachable database acquires an "I could not
  // look" state, and `template/CLAUDE.md` is emphatic that it must never be
  // confused with "there is nothing there". So this number is the content
  // files' rows and says so; what an environment actually holds, of either
  // origin, is `node run.mjs content-check`.
  ok(`${files.length} block file(s), ${units} unit(s) — from the content files; rows authored on the course's admin surface live in one environment and are not counted here`);
  if (withoutContent.length > 0) {
    warn(
      `${withoutContent.length} unit(s) have neither text nor video: ${withoutContent.join(", ")} — ` +
        "those pages render a heading and nothing else",
    );
  }

  // 🚨 A hand-in prompt in a course that takes no hand-ins.
  //
  // A member never sees it: the lesson page renders the task only when the
  // shape is `workshop` AND the lesson carries a prompt. Without this line the
  // whole thing is a silent no-op — `content-apply` writes the column,
  // `content-check` counts the row, everything is green, and somebody's work
  // simply never appears.
  //
  // `warn()` and never `bad()`: writing prompts and then changing the shape is
  // ordinary, and an exit 1 for it would be a gate in the way — which is a gate
  // somebody eventually removes, taking the intent with it. The other direction
  // — a workshop with no prompt anywhere — is deliberately NOT warned about: it
  // is the normal state on day one, the same argument `presence/check.ts` makes
  // about a lesson nobody has finished writing.
  if (
    config &&
    SHAPES.includes(config.shape) &&
    config.shape !== "workshop" &&
    withTask.length > 0
  ) {
    warn(
      `${withTask.length} unit(s) ask for a hand-in: ${withTask.join(", ")} — but this course's ` +
        `shape is "${config.shape}", and hand-ins exist under "workshop" only. Nobody can ` +
        `answer them and no member ever sees the task. Either the shape in config/course.json ` +
        `is wrong or those prompts are. (Read here from the content files only — a lesson ` +
        `created on the course's admin surface lives in one environment and is not seen by this ` +
        `command.)`,
    );
  }

  const manifest = readJson("content/media-manifest.json");
  const declared = new Set((manifest?.entries ?? []).map((entry) => entry.path));
  const referenced = new Set();
  for (const name of files) {
    const block = readJson(join("content", "course", name)) ?? {};
    for (const unit of block.units ?? []) {
      for (const path of [unit.cover, unit.video, unit.subtitle, unit.worksheet]) {
        if (path) referenced.add(path);
      }
    }
  }
  const undeclared = [...referenced].filter((path) => !declared.has(path));
  if (undeclared.length > 0) {
    bad(
      `${undeclared.length} media path(s) are named by a unit and not declared in ` +
        `content/media-manifest.json: ${undeclared.join(", ")} — content-apply would fail by name`,
    );
  } else if (referenced.size > 0) {
    ok(`${referenced.size} media path(s), all declared`);
  }
}

console.log(
  failed
    ? "\n✗ The course does not add up — fix the above.\n"
    : "\n✓ The course adds up. Whether an ENVIRONMENT holds it is `node run.mjs content-check`.\n",
);
process.exit(failed ? 1 : 0);
