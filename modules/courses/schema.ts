// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course this app sells: its structure, and what each learner did with it.
//
// ── One schema, three shapes ───────────────────────────────────────────────
// `docs/courses.md` names three products — a self-study course, a week-by-week
// programme, an accompanied workshop — and they are NOT three data models. They
// differ on exactly two axes, and both are columns here:
//
//   * `courses_blocks.releaseAfterDays` makes shape 2. A block IS a week. Zero
//     everywhere is shape 1 *by construction*, so the self-study course needs no
//     code of its own — it is the degenerate case of the drip.
//   * `courses_units.taskPrompt` makes shape 3. Non-null means this unit asks
//     the learner to hand something in, which is what `courses_submissions`
//     holds and what a person answers.
//
// The doc used to give shape 2 its own flat `program_weeks` table with no unit
// level. That split was the single biggest source of re-derivation cost — it
// made a parameter into a different application.
//
// ── Content and state are different tables for a reason ────────────────────
// `courses_blocks` and `courses_units` are CONTENT: the operator's own material,
// written in the repo and applied into an environment (`content/appliers/`,
// `docs/content.md`). They travel by command, not by deploy.
//
// `courses_completions` and `courses_submissions` are the MEMBER's: nobody
// applies them, they exist only where they were made, and they are what
// `privacy/sections.ts` answers for.
//
// ── Why the slug, and why it is unique across the app ──────────────────────
// A unit's `slug` is its route segment AND the `subject` an activity or a
// companion hangs on (`docs/courses.md` → Subjects). One lesson, one string, so
// a lesson's game and a lesson's coach share coordinates without either knowing
// the other exists. Unique, because two lessons answering to one slug would
// merge two products' learners.
//
// ── Media by FK, nullable, `set null` ──────────────────────────────────────
// Four slots, all optional: a unit may be text-only. `set null` keeps a deleted
// media row from leaving a dangling id behind. ⚠️ An applier resolves these from
// the manifest PATH (`mediaIdFor`), never from an id — a media id exists once,
// in one database.
import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

import { users } from "@/db/schema-core";
import { media } from "@/db/schema-media";

/**
 * A course. One app may hold several, and each is sold on its own.
 *
 * ── Why this table exists at all ───────────────────────────────────────────
 * It did not, until Story 44.2. `courses_blocks` was the top level, so an app
 * held exactly ONE course and `docs/courses.md` said so in as many words. The
 * moment a vendor sells two products that each unlock their own material, a
 * flat block list can only serve both to everybody: same pages, same gate, same
 * buyers. That is not a smaller version of two courses, it is the wrong
 * delivery — and it fails silently, because a learner cannot tell a course that
 * is generous from one that is broken.
 *
 * ── What moved here from `config/course.json`, and why ─────────────────────
 * `shape` and `planKeys` are per COURSE, not per app:
 *
 *   * `shape` decides when a block opens and whether a learner hands anything
 *     in. An app with a self-study primer and an accompanied workshop needs
 *     both answers at once, and one app-wide value cannot give them.
 *   * `planKeys` is what SELLS this course. Two courses that shared one list
 *     would be one course in two halves.
 *
 * What stays in the file is what is genuinely about the installation: `enabled`
 * (is the course surface running here at all) and `operatorPreviewsUnlocked`.
 *
 * ── Two origins, one column — the same partition the blocks carry ──────────
 * `content` rows come from `content/course/*.json` through `content-apply` and
 * are re-asserted on every run; `operator` rows are made on the admin surface
 * and exist in one environment only. A course and its blocks may differ here:
 * an operator may add a block to a course the applier owns. What is refused is
 * the other direction — the applier never writes over an `operator` row.
 *
 * ── The slug is the course's identity, and it is in the URL ────────────────
 * `/dashboard/course/<courseSlug>/<unitSlug>`. Unique, because two courses
 * answering to one string would be one course to every link that exists.
 *
 * 🚨 **Unit slugs stay unique across the whole app, not per course.** That is
 * not an oversight carried forward: `courses_completions.unitSlug`,
 * `courses_submissions.unitSlug`, `activity_results.subject` and a companion's
 * conversation key on the bare string (`docs/courses.md` → Subjects), so a
 * `"woche-7"` in two courses would merge two learners' states into one. The
 * price is that a second course prefixes its slugs; the alternative is a
 * migration of every subject-bearing table in the app and a per-table decision
 * about which course a row from before the split belonged to.
 */
export const coursesCourses = pgTable(
  "courses_courses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // What an applier upserts on, and what stands in the URL.
    slug: text("slug").notNull(),
    // See the header — the same discriminator the blocks and units carry.
    origin: text("origin").notNull().default("content"),
    title: text("title").notNull(),
    // One line under the title on the course list. Optional, like a block's.
    summary: text("summary"),
    // The order the courses are offered in. Not derived from the title: a
    // vendor's primer comes before their masterclass whatever the alphabet
    // says.
    position: integer("position").notNull().default(0),
    // 🚨 Which of the three shapes this course is — `COURSE_SHAPES` in
    // `../rules.ts`. NOT NULL and no default: `self-study` is the most
    // PERMISSIVE shape, so a drip course whose shape went missing would open
    // week ten on day one, which is `docs/courses.md`'s definition of having
    // failed at the thing it was bought for. A doubt that falls to "self-study"
    // does not close a door, it opens ten. The reader refuses the row instead.
    shape: text("shape").notNull(),
    // 🚨 The Product Keys that unlock THIS course, and holding ONE is enough.
    // Same shape and same name as `media.plan_keys` and
    // `community_groups.plan_keys`, for the same reason: one offering is one
    // Digistore24 product per billing interval, so a course sold monthly and
    // yearly names both. An empty list is a course nobody can open, which
    // `courses-check` and the admin surface report — never a course that is
    // free.
    planKeys: text("plan_keys").array().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_courses_slug").on(table.slug),
    index("courses_courses_position").on(table.position),
  ],
);

export const coursesBlocks = pgTable(
  "courses_blocks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // 🚨 Which course this block belongs to. NOT NULL: a block with no course
    // is a block no page can reach and no gate can decide about, and making it
    // nullable would buy exactly one thing — the ability to write that row.
    //
    // `cascade`, so deleting a course takes its blocks and (through their own
    // cascade) its units. What it does NOT take is the learners' rows:
    // `courses_completions` and `courses_submissions` key on the unit SLUG, an
    // opaque string with no foreign key, so a hand-in outlives a re-apply. That
    // is the same decision those tables already document, and it is what makes
    // this cascade safe to want.
    courseId: text("course_id")
      .notNull()
      .references(() => coursesCourses.id, { onDelete: "cascade" }),
    // The block's own stable key — what an applier upserts on, so a re-run
    // asserts the content instead of duplicating it.
    //
    // ⚠️ Still unique across the APP rather than per course. The applier's
    // conflict target is this column alone, and a block slug reaching two
    // courses would make "which block is `woche-1`" a question with two
    // answers — including for the operator surface, which names rows by slug.
    slug: text("slug").notNull(),
    // 🚨 WHO owns this row. `content` means it came out of
    // `content/course/*.json` and `content-apply` re-asserts it on every run;
    // `operator` means it was made on the admin surface, exists only in THIS
    // environment and travels with no deploy. One writer per row class is spine
    // AD-82, and this column is how the class gets split rather than shared —
    // the same move `media` makes with its `content/` key prefix.
    //
    // ⚠️ The default belongs to the MIGRATION, not to the code: everything a
    // database already holds arrived through the applier, so backfilling
    // `content` is the truthful direction. Both writers still set the column
    // explicitly — a writer that leans on the default is one whose rows do not
    // say where they came from.
    //
    // No index, and that is a decision rather than an omission: a course has
    // dozens of rows, every read here already scans the whole (tiny) table, and
    // an index on a two-value column would cost writes to buy nothing.
    origin: text("origin").notNull().default("content"),
    title: text("title").notNull(),
    // One line under the title on the overview. Optional: a course whose block
    // titles say enough should not be made to invent prose.
    summary: text("summary"),
    position: integer("position").notNull(),
    // 🚨 THIS COLUMN IS SHAPE 2. Days after the learner's access STARTED until
    // this block opens — 0, 7, 14. Never a date: a date would be the same day
    // for everybody, and the whole point is that the clock runs per purchase
    // (`planStartedAt()` in `lib/entitlements/manage.ts`).
    //
    // NOT NULL with a zero default, so a self-study course has nothing to fill
    // in and a drip course cannot have a block with no answer.
    releaseAfterDays: integer("release_after_days").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_blocks_slug").on(table.slug),
    // Position is only ever asked WITHIN a course now — an app-wide ordering of
    // blocks stopped meaning anything the moment there was more than one
    // course.
    index("courses_blocks_course_position").on(table.courseId, table.position),
  ],
);

export const coursesUnits = pgTable(
  "courses_units",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    blockId: text("block_id")
      .notNull()
      .references(() => coursesBlocks.id, { onDelete: "cascade" }),
    // The Subject Key — see the header. Unique across the app.
    slug: text("slug").notNull(),
    // The same discriminator `courses_blocks` carries, for the same reason —
    // read its comment. A lesson is the row class an authoring surface will
    // want to write, so this is the column that makes such a surface lawful at
    // all: the applier owns `content`, the surface owns `operator`, and neither
    // can reach the other's rows.
    origin: text("origin").notNull().default("content"),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    // The lesson's text. Markdown-ish, rendered through the template's own
    // subset parser — never `dangerouslySetInnerHTML`.
    body: text("body"),
    coverMediaId: text("cover_media_id").references(() => media.id, { onDelete: "set null" }),
    videoMediaId: text("video_media_id").references(() => media.id, { onDelete: "set null" }),
    subtitleMediaId: text("subtitle_media_id").references(() => media.id, { onDelete: "set null" }),
    worksheetMediaId: text("worksheet_media_id").references(() => media.id, { onDelete: "set null" }),
    // 🚨 THIS COLUMN IS SHAPE 3. Non-null = this unit asks for a hand-in, and
    // the text is what the learner is asked. Null = it does not.
    taskPrompt: text("task_prompt"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_units_slug").on(table.slug),
    index("courses_units_block_position").on(table.blockId, table.position),
  ],
);

export const coursesCompletions = pgTable(
  "courses_completions",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ⚠️ The unit's SLUG, not its id — an opaque key, never a foreign key. A
    // completion survives an applier rewriting the unit row it points at, which
    // is what re-applying content does every single run. The same reasoning
    // `activity_results.subject` carries.
    unitSlug: text("unit_slug").notNull(),
    completedAt: timestamp("completed_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.unitSlug] }),
  ],
);

export const coursesSubmissions = pgTable(
  "courses_submissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unitSlug: text("unit_slug").notNull(),
    body: text("body").notNull(),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    // What a person wrote back. Null until somebody has read it — which is the
    // whole product promise of shape 3, so it is a column rather than a guess.
    reply: text("reply"),
    repliedAt: timestamp("replied_at"),
    // 🚨 WHO answered, and `set null` rather than cascade: a coach leaving the
    // app must not destroy the record that a reading happened. It also makes a
    // multi-coach workshop possible later without a migration.
    repliedBy: text("replied_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    // Makes submitting an UPSERT: one hand-in per member per unit, revised
    // until somebody replies. Two rows would make "has this been answered" a
    // question with two answers.
    uniqueIndex("courses_submissions_member_unit").on(table.memberId, table.unitSlug),
    // The operator's "what is waiting" list.
    index("courses_submissions_waiting").on(table.repliedAt, table.submittedAt),
  ],
);
