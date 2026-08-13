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
// The three shapes, from the module's own pure layer — never a second list here.
import { COURSE_SHAPES } from "../../shapes.mjs";

// modules/courses/content/appliers/ → the app root.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CONTENT_DIR = join(ROOT, "content", "course");

/** The name of a course's own file, inside its directory. */
const COURSE_FILE = "course.json";

/**
 * The course directories, in name order. Absent = an app with no course yet.
 *
 * 🚨 **A `.json` lying loose in `content/course/` is a REFUSAL, not a file to
 * skip.** That was the layout before there could be more than one course, so a
 * loose file is somebody's block from the old shape — and skipping it silently
 * would apply three quarters of a course and report success. The message names
 * the move rather than the rule.
 */
function courseDirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const loose = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (loose.length > 0) {
    throw new Error(
      `content/course/ holds ${loose.length} loose .json file(s) (${loose.join(", ")}). ` +
        `A course is a DIRECTORY now: move them into content/course/<course-slug>/ and put ` +
        `that course's own ${COURSE_FILE} beside them — title, shape and planKeys. Nothing was ` +
        `applied; a block with no course is a block no page can reach.`,
    );
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The block files of one course, in name order — everything but `course.json`. */
function blockFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json") && name !== COURSE_FILE)
      .sort();
  } catch {
    return [];
  }
}

/**
 * One course's own file, read and checked.
 *
 * ⚠️ **The slug is the DIRECTORY name and is not in the file.** One place, so
 * the two can never disagree — and a `slug` key is refused rather than ignored,
 * because a value somebody wrote and nothing reads is a value they believe they
 * set. Same reasoning as `KNOWN` in `../../lib/config.ts`.
 */
function readCourseFile(dir, slug) {
  const path = join(dir, slug, COURSE_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `content/course/${slug}/ has no ${COURSE_FILE} — a course needs a title, a shape and ` +
          `the Product Keys it is sold under. Without them nothing can serve it or gate it.`,
      );
    }
    throw new Error(`content/course/${slug}/${COURSE_FILE} is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`content/course/${slug}/${COURSE_FILE} must be one course object`);
  }

  const problem = slugProblem(slug);
  if (problem) {
    throw new Error(`content/course/${slug}/: the directory name is not a slug — ${problem}`);
  }
  if ("slug" in parsed) {
    throw new Error(
      `content/course/${slug}/${COURSE_FILE}: remove "slug" — the DIRECTORY name is the ` +
        `course's slug, and two places to write it are two places to write it differently.`,
    );
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim()) {
    throw new Error(`content/course/${slug}/${COURSE_FILE}: a course needs a "title"`);
  }
  if (!COURSE_SHAPES.includes(parsed.shape)) {
    throw new Error(
      `content/course/${slug}/${COURSE_FILE}: "shape" is ${JSON.stringify(parsed.shape)} — ` +
        `one of ${COURSE_SHAPES.join(", ")}. There is deliberately no default: "self-study" is ` +
        `the most permissive shape, so a drip course whose shape went missing would open week ` +
        `ten on day one.`,
    );
  }
  if (!Array.isArray(parsed.planKeys) || parsed.planKeys.length === 0) {
    throw new Error(
      `content/course/${slug}/${COURSE_FILE}: "planKeys" is missing or empty — the course has ` +
        `to be sold as something. A LIST, because one offering is one Digistore24 product per ` +
        `billing interval: a course sold monthly and yearly names both keys, and holding ` +
        `either one opens it.`,
    );
  }
  if (parsed.planKeys.some((key) => typeof key !== "string" || !key)) {
    throw new Error(
      `content/course/${slug}/${COURSE_FILE}: every "planKeys" entry must be a non-empty string`,
    );
  }
  const duplicate = parsed.planKeys.find((key, i) => parsed.planKeys.indexOf(key) !== i);
  if (duplicate !== undefined) {
    throw new Error(
      `content/course/${slug}/${COURSE_FILE}: "planKeys" lists "${duplicate}" twice`,
    );
  }

  return {
    file: `${slug}/${COURSE_FILE}`,
    slug,
    title: parsed.title,
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
    position: Number.isInteger(parsed.position) ? parsed.position : 0,
    shape: parsed.shape,
    planKeys: parsed.planKeys,
  };
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
export function readCourseContent(dir = CONTENT_DIR) {
  const courses = [];
  const blocks = [];
  for (const courseSlug of courseDirs(dir)) {
    courses.push(readCourseFile(dir, courseSlug));
    for (const name of blockFiles(join(dir, courseSlug))) {
      const rel = `${courseSlug}/${name}`;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(join(dir, courseSlug, name), "utf8"));
      } catch (error) {
        throw new Error(`content/course/${rel} is not valid JSON: ${error.message}`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`content/course/${rel} must be one block object`);
      }
      blocks.push({ file: rel, course: courseSlug, ...parsed });
    }
  }

  // 🚨 Refuse a duplicate before writing anything. Half-applied content is
  // worse than none, and a duplicate slug would silently make one block
  // overwrite another on the way in — the run would report success.
  //
  // ⚠️ **Slug globally, position PER COURSE**, and the split is the whole point
  // of this pass now. A slug reaching two courses is a real collision: the
  // upsert's conflict target is the slug alone and learners' rows key on it
  // (`../../schema.ts`). A POSITION reaching two courses is not a collision at
  // all — every course orders its own blocks from 1, and the app-wide check
  // this replaces would have refused the second course on its first day.
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
    const positionKey = `${block.course}\u0000${block.position}`;
    if (seenPosition.has(positionKey)) {
      throw new Error(
        `two blocks of course "${block.course}" share position ${block.position}: ` +
          `${seenPosition.get(positionKey)} and ${block.file}`,
      );
    }
    seenPosition.set(positionKey, block.file);
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

  return { courses, blocks };
}

/**
 * The blocks alone — what every reader that predates the course level wants.
 *
 * Kept as its own export rather than making each caller destructure, because
 * the two questions really are different: `readCourseContent()` is "what do the
 * files say", `readBlocks()` is "what blocks are there". Each block now carries
 * `course`, so a caller that needs the dimension has it without a second read.
 */
export function readBlocks(dir = CONTENT_DIR) {
  return readCourseContent(dir).blocks;
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
async function claimedSlugs(sql, { courses, blocks }) {
  const courseFileFor = new Map();
  const blockFileFor = new Map();
  const unitFileFor = new Map();
  for (const course of courses) courseFileFor.set(course.slug, course.file);
  for (const block of blocks) {
    blockFileFor.set(block.slug, block.file);
    for (const unit of block.units ?? []) unitFileFor.set(unit.slug, block.file);
  }

  // The course table joins this pass for the same reason the other two are in
  // it: an operator may create a course on the admin surface, and a content
  // file claiming that slug would either be refused by the `where origin =
  // 'content'` guard (leaving the file's blocks grafted onto a course no deploy
  // carries) or, worse, read as applied. Three tables, one question.
  const foreignCourses = await sql`select slug from courses_courses where origin <> 'content'`;
  const foreignBlocks = await sql`select slug from courses_blocks where origin <> 'content'`;
  const foreignUnits = await sql`select slug from courses_units where origin <> 'content'`;

  const clashes = [];
  for (const [rows, table, fileFor] of [
    [foreignCourses, "courses_courses", courseFileFor],
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
async function refuseClaimedSlugs(sql, content) {
  const clashes = await claimedSlugs(sql, content);
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
  const { courses, blocks } = readCourseContent(contentDir);
  let count = 0;

  await refuseClaimedSlugs(sql, { courses, blocks });

  // 🚨 **Courses before blocks, in the same transaction.** A block names its
  // course by foreign key, so the row has to be there — and doing it in a
  // second applier file (which the convention would allow) would put the two
  // in separate transactions, where a course that landed and blocks that did
  // not leave a course with nothing in it. `scripts/content/apply.mjs` gives
  // each applier its own transaction; this one keeps its own rollback whole.
  const courseIdBySlug = new Map();
  for (const course of courses) {
    await sql`
      insert into courses_courses (id, slug, origin, title, summary, position, shape, plan_keys)
      values (${crypto.randomUUID()}, ${course.slug}, 'content', ${course.title},
              ${course.summary}, ${course.position}, ${course.shape}, ${course.planKeys})
      on conflict (slug) do update set
        title = excluded.title,
        summary = excluded.summary,
        position = excluded.position,
        shape = excluded.shape,
        plan_keys = excluded.plan_keys
      where courses_courses.origin = 'content'`;
    count += 1;

    const [row] = await sql`select id from courses_courses where slug = ${course.slug}`;
    courseIdBySlug.set(course.slug, row.id);
  }

  for (const block of blocks) {
    const courseId = courseIdBySlug.get(block.course);
    await sql`
      insert into courses_blocks (id, course_id, slug, origin, title, summary, position,
                                  release_after_days)
      values (${crypto.randomUUID()}, ${courseId}, ${block.slug}, 'content', ${block.title},
              ${block.summary ?? null}, ${block.position}, ${block.releaseAfterDays ?? 0})
      on conflict (slug) do update set
        course_id = excluded.course_id,
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
  const { courses, blocks } = readCourseContent(contentDir);

  // Declaration order — each course, then its blocks with their lessons under
  // them. That is the order a reader of the files already has in mind, and the
  // course line is what tells them WHICH course the block lines belong to.
  const declared = [];
  for (const course of courses) {
    declared.push({ table: "courses_courses", slug: course.slug });
    for (const block of blocks.filter((b) => b.course === course.slug)) {
      declared.push({ table: "courses_blocks", slug: block.slug });
      for (const unit of block.units ?? []) {
        declared.push({ table: "courses_units", slug: unit.slug });
      }
    }
  }

  const present = {
    courses_courses: new Set(
      (await sql`select slug from courses_courses where origin = 'content'`).map((row) => row.slug),
    ),
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
    problems: (await claimedSlugs(sql, { courses, blocks })).map(
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
