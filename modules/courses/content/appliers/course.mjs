// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's content, from the repo into one environment.
//
// 🚨 **This file is why the course may keep its content in tables at all.**
// `docs/content-authority.md` says "when in doubt, case 1" — constants in code —
// and the reason is that rows do not deploy: a course typed into a local
// database dies with it, and the app goes live empty behind a clean 200. That
// reason is what this applier removes. Without it the module would be making a
// promise the template already knows gets broken.
//
// ── Where the content is ───────────────────────────────────────────────────
// `content/course/*.json` in the APP's tree, one file per block. The module
// brings the transport; the material is the operator's and lives where the repo
// carries it. A file is read in name order and its blocks keep their own
// `position`, so neither the filename nor the directory listing decides what a
// learner sees.
//
// ── Upsert by slug, never insert ───────────────────────────────────────────
// Every run ASSERTS the content. A slug survives a re-run, which is what makes
// this safe to point at production twice.
//
// ⚠️ Media are named by PATH and resolved through `mediaIdFor()` — a media id
// exists once, in one database. A missing row throws by name, which is how a
// typo fails the run instead of quietly wiring a null.
//
// ── This applier owns a PARTITION of its tables, not all of it ─────────────
// 🚨 Every row this file writes carries `origin = 'content'`, and every row it
// reads back is filtered on it. The other half — `origin = 'operator'` — belongs
// to the admin surface: rows somebody typed into ONE environment, which travel
// with no deploy and which this applier must never touch. One writer per row
// class is spine AD-82; splitting the class is how two lawful writers become
// legal, and `lib/content/writers.test.ts` holds this file to it by reading the
// SQL below.
//
// The `where` on each `on conflict` is only half of that rule, and on its own it
// would be the WRONG half: an upsert that matches no row still succeeds, so a
// content file claiming an operator-owned slug would apply silently and
// wrongly — the block upsert doing nothing, the following `select id` handing
// back the OPERATOR's block id, and every lesson of that file grafted onto a row
// no deploy carries. That is not a skipped record, it is a half-applied course.
// Hence the pre-flight below, and hence a refusal rather than a log line: the
// exit code comes from the throw and from nothing else.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_UNIT_BODY_CHARS, MAX_UNIT_TITLE_CHARS, slugProblem } from "../../slug.mjs";

// modules/courses/content/appliers/ → the app root.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CONTENT_DIR = join(ROOT, "content", "course");

/** The block files, in name order. Absent directory = an app with no course yet. */
function blockFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/**
 * The content files, read and checked against each other.
 *
 * The directory is a trailing parameter with a default — the same shape
 * `applierSources(root, ids)` uses, and for the same reason: this walk is the
 * part of the applier a test can exercise, and it cannot be exercised against a
 * fixture while the only path it knows is the app's own.
 *
 * @param {string} [dir]
 */
export function readBlocks(dir = CONTENT_DIR) {
  const blocks = [];
  for (const name of blockFiles(dir)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (error) {
      throw new Error(`content/course/${name} is not valid JSON: ${error.message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`content/course/${name} must be one block object`);
    }
    blocks.push({ file: name, ...parsed });
  }

  // 🚨 Refuse a duplicate before writing anything. Half-applied content is
  // worse than none, and a duplicate slug would silently make one block
  // overwrite another on the way in — the run would report success.
  const seenSlug = new Map();
  const seenPosition = new Map();
  for (const block of blocks) {
    if (typeof block.slug !== "string" || !block.slug) {
      throw new Error(`content/course/${block.file}: a block needs a slug`);
    }
    if (seenSlug.has(block.slug)) {
      throw new Error(
        `two blocks share the slug "${block.slug}": ${seenSlug.get(block.slug)} and ${block.file}`,
      );
    }
    seenSlug.set(block.slug, block.file);
    if (seenPosition.has(block.position)) {
      throw new Error(
        `two blocks share position ${block.position}: ` +
          `${seenPosition.get(block.position)} and ${block.file}`,
      );
    }
    seenPosition.set(block.position, block.file);
  }

  const seenUnit = new Map();
  for (const block of blocks) {
    for (const unit of block.units ?? []) {
      if (typeof unit.slug !== "string" || !unit.slug) {
        throw new Error(`content/course/${block.file}: a unit needs a slug`);
      }
      // 🚨 The GRAMMAR, not merely non-empty. `slugProblem()`'s own docstring
      // has always said the applier refuses a bad one here — "a sentence
      // somebody can act on, rather than a page that scrolls nowhere" — and
      // until 2026-08-13 it did not. A content file could write `Übung 1`, and
      // then one address had three spellings: the course overview
      // percent-encodes it, `content-source.ts` builds it raw for the
      // assistant's deep link, and `pages/actions.ts` revalidates the raw path.
      // Exactly one of the three reaches the page.
      const problem = slugProblem(unit.slug);
      if (problem) {
        throw new Error(
          `content/course/${block.file}: ${problem}. A unit's slug is its route AND its ` +
            `Subject Key, so it has to survive being a URL.`,
        );
      }
      // The same two ceilings the admin form applies. A content file is the
      // other writer, and a limit only one of them keeps is not a limit.
      if (typeof unit.title === "string" && unit.title.length > MAX_UNIT_TITLE_CHARS) {
        throw new Error(
          `content/course/${block.file}: the title of "${unit.slug}" is longer than ` +
            `${MAX_UNIT_TITLE_CHARS} characters`,
        );
      }
      if (typeof unit.body === "string" && unit.body.length > MAX_UNIT_BODY_CHARS) {
        throw new Error(
          `content/course/${block.file}: the body of "${unit.slug}" is longer than ` +
            `${MAX_UNIT_BODY_CHARS} characters. It is turned into elements on every ` +
            `request — split the lesson.`,
        );
      }
      if (seenUnit.has(unit.slug)) {
        throw new Error(
          `two units share the slug "${unit.slug}": ${seenUnit.get(unit.slug)} and ${block.file}. ` +
            "A unit's slug is its route AND its Subject Key — two lessons answering to one " +
            "would merge two lessons' learners (docs/courses.md → Subjects)",
        );
      }
      seenUnit.set(unit.slug, block.file);
    }
  }

  return blocks;
}

/**
 * 🚨 Which slugs a content file claims and a row this applier does not own holds.
 *
 * The QUESTION, on its own, because two callers ask it: `apply()` refuses the
 * whole run on any answer, and `plan()` reports them as problems before anybody
 * runs anything. Read-only — two selects and no write — which is what makes it
 * lawful inside the plan's read-only transaction.
 *
 * Two selects, no value list: the rows a course holds are counted in dozens, so
 * fetching every foreign slug and comparing in JS is cheaper to read than a
 * dynamic `IN (…)` — and it keeps this file to the plainest thing a tagged
 * template can express, which is what makes it testable against a fake handle.
 *
 * `origin <> 'content'` rather than `= 'operator'`: whatever a row is, if it is
 * not this applier's then it is not this applier's to overwrite.
 *
 * Every collision is collected before anything is thrown. A run that names one
 * of four is a run somebody fixes four times.
 *
 * @param {import("postgres").Sql} sql
 * @param {{ file: string, slug: string, units?: { slug: string }[] }[]} blocks
 */
async function claimedSlugs(sql, blocks) {
  const blockFileFor = new Map();
  const unitFileFor = new Map();
  for (const block of blocks) {
    blockFileFor.set(block.slug, block.file);
    for (const unit of block.units ?? []) unitFileFor.set(unit.slug, block.file);
  }

  const foreignBlocks = await sql`select slug from courses_blocks where origin <> 'content'`;
  const foreignUnits = await sql`select slug from courses_units where origin <> 'content'`;

  const clashes = [];
  for (const [rows, table, fileFor] of [
    [foreignBlocks, "courses_blocks", blockFileFor],
    [foreignUnits, "courses_units", unitFileFor],
  ]) {
    for (const row of rows) {
      const file = fileFor.get(row.slug);
      if (file) clashes.push(`${table}: "${row.slug}" (content/course/${file})`);
    }
  }
  return clashes;
}

/**
 * The refusal itself — the QUESTION above, plus the throw.
 *
 * Split so that `plan()` can ask the same question read-only and REPORT the
 * collisions, where `apply()` asks it and refuses. Two spellings of "which slugs
 * does the other side hold" would be two opinions about it, and the plan's whole
 * value is that it says in advance what the run would say.
 *
 * @param {import("postgres").Sql} sql
 * @param {{ file: string, slug: string, units?: { slug: string }[] }[]} blocks
 */
async function refuseClaimedSlugs(sql, blocks) {
  const clashes = await claimedSlugs(sql, blocks);
  if (clashes.length === 0) return;

  throw new Error(
    `${clashes.length} slug(s) are claimed by a content file and held by a row this applier ` +
      `does not own:\n    ${clashes.join("\n    ")}\n  Nothing was applied — a course applied ` +
      `around a row it cannot see is worse than one that did not apply. Two ways out: change ` +
      `the slug in the content file, or delete the operator-authored row on the course's admin ` +
      `surface, whichever of the two is the one that should not exist.`,
  );
}

/**
 * @param {import("postgres").Sql} sql
 * @param {{ mediaIdFor: (path: string) => Promise<string> }} helpers
 * @param {string} [contentDir] where the block files are — a test seam, see `readBlocks`
 */
export async function apply(sql, { mediaIdFor }, contentDir = CONTENT_DIR) {
  const blocks = readBlocks(contentDir);
  let count = 0;

  await refuseClaimedSlugs(sql, blocks);

  for (const block of blocks) {
    await sql`
      insert into courses_blocks (id, slug, origin, title, summary, position, release_after_days)
      values (${crypto.randomUUID()}, ${block.slug}, 'content', ${block.title},
              ${block.summary ?? null}, ${block.position}, ${block.releaseAfterDays ?? 0})
      on conflict (slug) do update set
        title = excluded.title,
        summary = excluded.summary,
        position = excluded.position,
        release_after_days = excluded.release_after_days
      where courses_blocks.origin = 'content'`;
    count += 1;

    const [{ id: blockId }] = await sql`
      select id from courses_blocks where slug = ${block.slug}`;

    for (const unit of block.units ?? []) {
      const media = async (path) => (path ? await mediaIdFor(path) : null);
      await sql`
        insert into courses_units (
          id, block_id, slug, origin, title, position, body,
          cover_media_id, video_media_id, subtitle_media_id, worksheet_media_id, task_prompt)
        values (
          ${crypto.randomUUID()}, ${blockId}, ${unit.slug}, 'content', ${unit.title},
          ${unit.position}, ${unit.body ?? null},
          ${await media(unit.cover)}, ${await media(unit.video)},
          ${await media(unit.subtitle)}, ${await media(unit.worksheet)},
          ${unit.taskPrompt ?? null})
        on conflict (slug) do update set
          block_id = excluded.block_id,
          title = excluded.title,
          position = excluded.position,
          body = excluded.body,
          cover_media_id = excluded.cover_media_id,
          video_media_id = excluded.video_media_id,
          subtitle_media_id = excluded.subtitle_media_id,
          worksheet_media_id = excluded.worksheet_media_id,
          task_prompt = excluded.task_prompt
        where courses_units.origin = 'content'`;
      count += 1;
    }
  }

  return count;
}

/**
 * 🚨 Read-only: what a `content-apply` against THIS database would do.
 *
 * The third, OPTIONAL export of the applier convention (`docs/content.md`), and
 * the reason `content_publish`'s plan is not vacuous in every app that installs
 * this module. It takes no helpers on purpose: `mediaIdFor()` throws by name on
 * a missing media row, so a planner holding it would fail on exactly the state a
 * plan exists to describe — what the target's media store is still missing is
 * answered once, for the whole app, by the tool's own media half.
 *
 * ⚠️ **It writes nothing and contains no `on conflict`.** Two selects and the
 * pre-flight's two, all read-only; `lib/content/writers.test.ts` reads the SQL
 * in this file and every `on conflict` it finds has to carry the origin filter,
 * so an upsert added here in the name of "just checking" would fail that scan
 * rather than quietly becoming a second writer.
 *
 * What it counts: the slugs the content files DECLARE against the slugs this
 * applier already owns in the target. `created` is declared minus present,
 * `reasserted` is the intersection — and `created + reasserted` is exactly the
 * row count `apply()` returns, because both walk one block plus its units.
 *
 * `problems` is the pre-flight that today only fires when `content-apply`
 * refuses: a slug held by an operator-authored row, named with its file, before
 * anybody points this at production.
 *
 * @param {import("postgres").Sql} sql
 * @param {string} [contentDir] where the block files are — a test seam, see `readBlocks`
 */
export async function plan(sql, contentDir = CONTENT_DIR) {
  const blocks = readBlocks(contentDir);

  const declared = [];
  for (const block of blocks) {
    declared.push({ table: "courses_blocks", slug: block.slug });
    for (const unit of block.units ?? []) {
      declared.push({ table: "courses_units", slug: unit.slug });
    }
  }

  const present = {
    courses_blocks: new Set(
      (await sql`select slug from courses_blocks where origin = 'content'`).map((row) => row.slug),
    ),
    courses_units: new Set(
      (await sql`select slug from courses_units where origin = 'content'`).map((row) => row.slug),
    ),
  };

  let created = 0;
  let reasserted = 0;
  for (const row of declared) {
    if (present[row.table].has(row.slug)) reasserted += 1;
    else created += 1;
  }

  return {
    created,
    reasserted,
    // The slugs in declaration order — blocks with their lessons under them,
    // which is the order a reader of the content files already has in mind. The
    // caller caps them; forty slugs in a tool answer is a payload nobody reads.
    subjects: declared.map((row) => row.slug),
    problems: (await claimedSlugs(sql, blocks)).map(
      (clash) => `${clash} is held by a row this applier does not own — content-apply would refuse`,
    ),
  };
}

/**
 * Read-only: how many of this applier's rows exist?
 *
 * ⚠️ Units rather than blocks: a course with blocks and no lessons is a menu
 * with nothing behind it, and that is the state worth catching.
 *
 * 🚨 And only THIS applier's rows — `docs/content.md` defines `present()` as
 * "how many rows of this applier exist", and counting the operator's lessons
 * here would let `content-check` report content as having arrived that never
 * travelled: exactly the silence the command was built against. The number an
 * operator wants for their own rows is the module's `presence/check.ts`, which
 * reports both origins side by side.
 *
 * The richer answer — which units are empty, whether the media resolved — is
 * that same file, which runs inside the app and can ask its own tables properly.
 *
 * @param {import("postgres").Sql} sql
 */
export async function present(sql) {
  return (await sql`select count(*)::int as n from courses_units where origin = 'content'`)[0].n;
}
