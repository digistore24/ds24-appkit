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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import "../../scripts/lib/env.mjs";

// The APPLIER's reader — see the note where it is used.
import { readCourseContent } from "./content/appliers/course.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

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

  // 🚨 **`shape` and `planKeys` are not read here any more, and a leftover one
  // is a FINDING.** They moved onto the course row in Story 44.2, because an
  // app may hold several courses and each is a different product. A value left
  // in this file decides nothing — and a value nobody reads is one somebody
  // believes they set, which is worse than one that is missing.
  for (const key of ["shape", "productKey", "planKeys"]) {
    if (config[key] !== undefined) {
      bad(
        `"${key}" in config/course.json does nothing since the app can hold several courses — ` +
          `it belongs in content/course/<course-slug>/course.json, per course. Remove it here, ` +
          `or the next reader will believe it is in force.`,
      );
    }
  }
}

console.log("\nThe content in this repo");

const contentDir = join(ROOT, "content", "course");

// 🚨 **The APPLIER's own reader, not a second one.** This command used to walk
// the directory itself and carry its own copy of the slug grammar — two parsers
// over the operator's files, which is how the two start disagreeing about which
// one is wrong. `readCourseContent()` is the writer's reader, so what it accepts
// here is exactly what `content-apply` will accept.
//
// ⚠️ It THROWS on the first fault where this command collects. That is the right
// trade at this door: it refuses whole-tree faults (a loose file from the old
// layout, a missing `course.json`, a duplicate slug), and every one of them
// stops a publish anyway — reporting three of them while the run cannot proceed
// past the first is a longer message about the same standstill.
let courses = [];
let blocks = [];
if (!existsSync(contentDir)) {
  warn("no content/course/ yet — nothing to apply, so every page would be empty");
} else {
  try {
    ({ courses, blocks } = readCourseContent(contentDir));
  } catch (error) {
    bad(error.message);
  }
}

if (courses.length === 0 && existsSync(contentDir)) {
  warn("no course directory under content/course/ yet — nothing to apply");
}

const products = readJson("config/digistore-products.json");
const productKeys = products && products.products ? Object.keys(products.products) : [];

/**
 * 🚨 **Present is not the same as usable, and this command said otherwise until
 * 2026-08-13.** A TOKEN package is in the registry, so a membership test passes
 * it — and `hasPlan()` answers false for a balance for ever, so a course sold
 * under one is a course NOBODY can open, including the buyer who paid. The app
 * knows this (`lib/media/config.ts` → `planProblem()`, which `courseProblems()`
 * calls), so the course would simply be invisible while this command printed
 * "The course adds up".
 *
 * Found by hand, walking a field test: `planKeys: ["pro"]` was accepted here and
 * refused by the app.
 *
 * ⚠️ A second READING of the registry, not a second rule: `planProblem()` is the
 * authority and lives in TypeScript, which a bare-Node command cannot import.
 * What is duplicated is one field lookup; what must not drift is the VERDICT,
 * and `check.test.ts` holds this half against the registry the app ships.
 */
const tokenKeys = new Set(
  Object.entries(products?.products ?? {})
    .filter(([, def]) => def?.kind === "token")
    .map(([key]) => key),
);

let units = 0;
const withoutContent = [];

for (const course of courses) {
  const mine = blocks.filter((block) => block.course === course.slug);
  const lessons = mine.reduce((sum, block) => sum + (block.units ?? []).length, 0);
  units += lessons;

  // The registry check the applier cannot make: it is bare Node with no view of
  // `config/digistore-products.json`'s meaning, and `hasPlan()` THROWS on a key
  // it does not know — so a typo here is a 500 on the course page rather than a
  // locked-out member.
  const unknown = productKeys.length > 0
    ? course.planKeys.filter((key) => !productKeys.includes(key))
    : [];
  const balances = course.planKeys.filter((key) => tokenKeys.has(key));
  if (unknown.length > 0) {
    bad(
      `${course.slug}: planKeys ${unknown.map((key) => `"${key}"`).join(", ")} not in ` +
        `config/digistore-products.json (it has: ${productKeys.join(", ")}) — ` +
        `hasPlan() throws on an unknown key`,
    );
  } else if (balances.length > 0) {
    bad(
      `${course.slug}: planKeys ${balances.map((key) => `"${key}"`).join(", ")} ` +
        `${balances.length === 1 ? "is a token package" : "are token packages"} — a balance is ` +
        `not an entitlement, so hasPlan() answers false for it for ever and NOBODY could open ` +
        `this course, including the buyer who paid. Sell it under a subscription or a one-off.`,
    );
  } else {
    ok(
      `${course.slug} — ${course.shape}, sold as ${course.planKeys.join(", ")}, ` +
        `${mine.length} block(s), ${lessons} lesson(s)`,
    );
  }

  for (const block of mine) {
    for (const unit of block.units ?? []) {
      if (!unit.body && !unit.video) withoutContent.push(unit.slug);
    }
  }

  // 🚨 A hand-in prompt in a course that takes no hand-ins — asked PER COURSE
  // now, which is the whole reason it had to move: an app with a workshop and a
  // self-study primer used to judge every prompt in the tree against one shape.
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
  if (course.shape !== "workshop") {
    const withTask = mine.flatMap((block) =>
      (block.units ?? []).filter((unit) => unit.taskPrompt).map((unit) => unit.slug),
    );
    if (withTask.length > 0) {
      warn(
        `${course.slug}: ${withTask.length} unit(s) ask for a hand-in (${withTask.join(", ")}) — ` +
          `but this course's shape is "${course.shape}", and hand-ins exist under "workshop" ` +
          `only. Nobody can answer them and no member ever sees the task. Either the shape in ` +
          `content/course/${course.slug}/course.json is wrong or those prompts are.`,
      );
    }
  }
}

if (courses.length > 0) {
  // ⚠️ Labelled rather than split, and the label is the whole of it. This
  // command reads the REPO and has no database connection — nor should it get
  // one: a developer's tool that needs a reachable database acquires an "I
  // could not look" state, and `template/CLAUDE.md` is emphatic that it must
  // never be confused with "there is nothing there". What an environment
  // actually holds, of either origin, is `node run.mjs content-check`.
  ok(
    `${courses.length} course(s), ${units} unit(s) — from the content files; rows authored on ` +
      `the course's admin surface live in one environment and are not counted here`,
  );
  if (withoutContent.length > 0) {
    warn(
      `${withoutContent.length} unit(s) have neither text nor video: ${withoutContent.join(", ")} — ` +
        "those pages render a heading and nothing else",
    );
  }
}

if (courses.length > 0) {
  const manifest = readJson("content/media-manifest.json");
  const declared = new Set((manifest?.entries ?? []).map((entry) => entry.path));
  const referenced = new Set();
  for (const block of blocks) {
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
