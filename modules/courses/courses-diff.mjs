#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs courses-diff [--env prod]` — what is new, what would change,
// what is untouched, and what is over there that this repo no longer has.
//
// Publishing stops being an act of faith at the moment somebody can SEE the
// difference before anything happens. That is all this is: the target is read
// FIRST, the comparison happens here, and four headed lists come out.
//
// ── 🚨 It writes NOTHING, and that is proved rather than promised ──────────
// No row in any database, no file in this repo, no file anywhere — whatever
// environment it is pointed at and whatever the lists say. Three mechanical
// proofs live in `courses-diff.test.ts`, because a sentence in a header is not
// evidence:
//
//   1. this file's transitive static imports reach **no npm package at all**,
//      so there is no database driver in the graph to open a connection with
//      (the `scripts/modules/data-gate.test.ts` pattern, aimed here);
//   2. every setup tool named below carries `mutates: false` in the registry —
//      looked up, not asserted in prose, and a name that is not a tool at all
//      fails the same test;
//   3. this file's own source contains no filesystem write.
//
// The one thing it sends is one POST: `{ tool: "courses_outline", env }`. That
// tool takes no argument at all and returns an outline — no lesson body, no task
// prompt, no media id — so what travels back is slugs, titles, counts and one
// hex string per lesson.
//
// ── It proposes nothing, and it is not a gate ─────────────────────────────
// No `--fix`, no `--write`, no offer to rename a slug: renaming one is the
// agent editing a repo FILE, which is a different story and a different act.
// And it exits **0** whenever the target was read, whatever it found — a course
// that differs is not an error, it is the answer to the question. A preview that
// fails the shell is a preview somebody stops running (NFR-64).
//
// ── The five ways this can refuse, and why the fifth exists ───────────────
// Four of them are every remote read's: not configured (exit 2), the host did
// not answer, the surface is off there, refused. They come from
// `scripts/setup/client.mjs` rather than being spelled again here — a second
// copy is how "I could not look" and "there is nothing there" stop being
// different sentences.
//
// 🚨 The fifth is this command's own: **`unknownTool`** means that environment
// has no `courses` module INSTALLED. A target with the module and no lessons and
// a target without the module both hold zero lessons, and reading the second as
// "all 34 lessons are new" would offer a publish into an app whose database has
// no `courses_units` table — discovered from a stack trace during a go-live.
//
// On any of the five it prints **no lists at all** and exits non-zero. Half a
// comparison is not a smaller comparison, it is a wrong one.
//
// Bare Node, like every other `run.mjs` command: no bundler, no TypeScript —
// which is why `unitFingerprint()` lives in `lib/fingerprint.mjs` and this file
// computes the local side with the very same function the target used.
import "../../scripts/lib/env.mjs";
import { readBlocks } from "./content/appliers/course.mjs";
import { compareCourse, diffCounts, sameSubjectPairs } from "./lib/diff.mjs";
import { callSetup, reportRefusal, resolveEnvName } from "../../scripts/setup/client.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};

const resolved = resolveEnvName(flag("env"));
if (resolved.error) {
  console.error(`✗ ${resolved.error}`);
  process.exit(2);
}
const target = resolved.env;

// The body is exactly `{ tool, env }` — `callSetup` puts the env in. The name is
// a literal at the call site and nowhere else: `courses-diff.test.ts` reads it
// out of this line and looks it up in the registry, so a const would put the
// claim one indirection away from the thing being claimed.
const answer = await callSetup(target, { tool: "courses_outline" });
if (!answer.ok) {
  // 🚨 The fifth refusal. `unknownTool` is a 404 with a JSON body
  // (`lib/setup/guard.ts` → `setupError("unknownTool", …)`, mapped to 404 in
  // `lib/setup/rules.ts`), which `callSetup` reports as an ordinary refusal —
  // correct for every other caller and useless here, because the one thing this
  // command must never do is call an app without the module an empty course.
  if (answer.code === "unknownTool") {
    console.error(`✗ ${target} has no courses_outline tool — the courses module is NOT installed there.`);
    console.error(`  That is not an empty course. A course published into that app would have`);
    console.error(`  no courses_units table to arrive in, and you would find out during a`);
    console.error(`  go-live. Install it there and deploy: node run.mjs module add courses,`);
    console.error(`  then node run.mjs db-migrate.`);
    process.exit(1);
  }
  process.exit(reportRefusal(answer));
}

// The repo's side, read by the APPLIER's own reader — which already refuses a
// duplicate block slug, a duplicate position and a duplicate unit slug. A second
// reader here would be a second opinion about what this repo holds.
let localBlocks;
try {
  localBlocks = readBlocks();
} catch (error) {
  console.error(`✗ this repo's content/course/ does not read: ${error.message}`);
  process.exit(1);
}

const report = compareCourse(localBlocks, answer.body?.data);
const counts = diffCounts(report);

const line = (entry) => `${entry.slug} — ${entry.title}`;

/** Lessons under the block slug they sit in; blocks as they come. */
function print(heading, entries, { grouped, note } = {}) {
  console.log(`\n${heading} (${entries.length})`);
  if (entries.length === 0) {
    console.log("  ·");
  } else if (grouped) {
    let current = null;
    for (const entry of entries) {
      if (entry.blockSlug !== current) {
        current = entry.blockSlug;
        console.log(`  ${current}`);
      }
      console.log(`    ${line(entry)}${entry.fields ? `  [${entry.fields.join(", ")}]` : ""}`);
    }
  } else {
    for (const entry of entries) {
      console.log(`  ${line(entry)}${entry.fields ? `  [${entry.fields.join(", ")}]` : ""}`);
    }
  }
  if (note && entries.length > 0) console.log(`  ${note}`);
}

console.log(`\nThis repo against ${target}`);
console.log(`  read first, compared here — nothing was written, in either place.`);

print("NEW — a publish would create these blocks", report.blocks.new);
print("NEW — a publish would create these lessons", report.units.new, { grouped: true });
print("WOULD CHANGE — these blocks differ", report.blocks.changed);
print("WOULD CHANGE — these lessons differ", report.units.changed, { grouped: true });
print("UNTOUCHED — blocks", report.blocks.untouched);
print("UNTOUCHED — lessons", report.units.untouched, { grouped: true });

// ── Present there, absent here ─────────────────────────────────────────────
// 🚨 The sentence under this list is the whole point of it, and the two cases
// are never merged: a row the applier owns is one this repo used to carry, a row
// it does not own is the operator's own and no applier ever touches it.
const targetOnly = [...report.blocks.targetOnly, ...report.units.targetOnly];
console.log(`\nPRESENT IN ${target.toUpperCase()} ONLY (${targetOnly.length})`);
if (targetOnly.length === 0) {
  console.log("  ·");
} else {
  const owned = targetOnly.filter((entry) => entry.origin === "content");
  const theirs = targetOnly.filter((entry) => entry.origin !== "content");
  if (owned.length > 0) {
    console.log(`  this applier's own rows (origin "content") — the repo used to carry them:`);
    for (const entry of owned) console.log(`    ${entry.blockSlug} / ${line(entry)}`);
  }
  if (theirs.length > 0) {
    console.log(`  rows this applier does not own — the operator's own, on the admin surface:`);
    for (const entry of theirs) {
      console.log(`    ${entry.blockSlug} / ${line(entry)}  [origin ${entry.origin ?? "unknown"}]`);
    }
  }
}
console.log(`  publishing will not delete anything — nothing here removes a row.`);

// ── The publish that would be REFUSED ──────────────────────────────────────
const refused = [...report.blocks.refused, ...report.units.refused];
console.log(`\nWOULD BE REFUSED (${refused.length})`);
if (refused.length === 0) {
  console.log("  ·");
} else {
  for (const entry of refused) {
    console.log(`  ${entry.blockSlug} / ${line(entry)}  [origin ${entry.origin}]`);
  }
  console.log(`  A content file claims a slug held by a row this applier does not own.`);
  console.log(`  content-apply REFUSES the whole run — it does not skip these and apply the`);
  console.log(`  rest, and nothing at all is written. Two ways out: change the slug in the`);
  console.log(`  content file, or delete the operator-authored row on the course's admin`);
  console.log(`  surface, whichever of the two is the one that should not exist.`);
}

// ── SAME SUBJECT, DIFFERENT SLUG ───────────────────────────────────────────
// 🚨 This section is not a difference — it is a QUESTION, and this command does
// not ask it. It prints the pair and both consequences; the asking is the
// AGENT's, in the conversation, where a human is present.
//
// ⛔ A command that prompted on stdin would be unusable from an agent session and
// untestable in CI — and it would be a second decision surface beside the skill.
// So: no prompt, no `--fix`, nothing written. The answer is expressed by editing
// a slug in a content file, which is the applier staying the only writer of
// those rows (AD-82 / NFR-59).
//
// The section is printed only when there is at least one pair. An empty
// "same subject, different slug" heading trains its reader to skip the one that
// is not empty.
const pairs = sameSubjectPairs(localBlocks, answer.body?.data);
if (pairs.length > 0) {
  console.log(`\nSAME SUBJECT, DIFFERENT SLUG (${pairs.length})`);
  console.log(`  Not a difference — a QUESTION, and nothing here answers it. Each pair below`);
  console.log(`  has the same title on both sides under two different slugs, so a publish`);
  console.log(`  would CREATE the local one BESIDE the one already there.`);
  console.log(`  You answer by editing the slug in content/course/*.json — never with a flag`);
  console.log(`  on this command: the applier writes those rows, keyed by slug, from files.`);

  for (const pair of pairs) {
    const kind = pair.kind === "block" ? "block " : "lesson";
    console.log(`\n  ${kind}  here:      ${pair.local.slug} — ${pair.local.title}`);
    console.log(
      `          in ${target}: ${pair.target.slug} — ${pair.target.title}` +
        `  [origin ${pair.target.origin ?? "not sent"}]`,
    );

    if (pair.target.origin === "content") {
      console.log(`    update that one → set this slug to "${pair.target.slug}" in the content file.`);
      console.log(`      The lessons your customers see are then replaced by the ones in your`);
      console.log(`      files. Their progress is keyed by SLUG, so it survives: somebody who`);
      console.log(`      finished lesson three has still finished lesson three.`);
    } else if (pair.target.origin === null || pair.target.origin === undefined) {
      // NFR-60: "I could not look" is never printed as "there is nothing there".
      console.log(`    update that one → NOT KNOWN from here. That app does not send origin, so`);
      console.log(`      whether this applier may write that row was not compared. Deploy it and`);
      console.log(`      run this again before renaming anything onto that slug.`);
    } else {
      console.log(`    update that one → NOT POSSIBLE. That row's origin is "${pair.target.origin}",`);
      console.log(`      not "content": setting this slug to "${pair.target.slug}" does not update`);
      console.log(`      it. content-apply REFUSES the whole publish before applying anything.`);
      console.log(`      Two ways out: change the slug in the content file, or delete the`);
      console.log(`      operator-authored row on the course's admin surface.`);
    }

    console.log(`    a second one   → leave this slug as it is. The existing rows are untouched`);
    console.log(`      and their buyers stay where they are. ⚠ This app sells ONE course under`);
    console.log(`      ONE product key, so the new ${pair.kind === "block" ? "block" : "lesson"} is visible to exactly the SAME`);
    console.log(`      buyers as the old one — position decides where it appears, nothing else.`);
    console.log(`      Selling it separately is a different piece of work, and it is not this.`);
  }
  console.log(`\n  Matching slugs are NOT in this list: an exact match is you having already`);
  console.log(`  said "this one", and the lists above show what it would change.`);
}

if (report.notCompared.length > 0) {
  // Never a silence. A deploy older than the payload field cannot be compared on
  // it, and saying nothing would report "no difference" about a question nobody
  // asked.
  console.log(`\n! ${target} does not send: ${report.notCompared.join(", ")}`);
  console.log(`  That app predates those payload fields, so they were NOT compared —`);
  console.log(`  which is not the same as "they agree". Deploy it to compare on them.`);
}

console.log(
  `\nblocks: ${counts.blocks.new} new · ${counts.blocks.changed} would change · ` +
    `${counts.blocks.untouched} untouched · ${counts.blocks.targetOnly} only there · ` +
    `${counts.blocks.refused} refused`,
);
console.log(
  `lessons: ${counts.units.new} new · ${counts.units.changed} would change · ` +
    `${counts.units.untouched} untouched · ${counts.units.targetOnly} only there · ` +
    `${counts.units.refused} refused`,
);
console.log(`\nThis was a preview. Nothing was published.\n`);
