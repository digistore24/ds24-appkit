// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's reads and writes — the imperative shell.
//
// The decisions are not here: `../rules.ts` owns the arithmetic (unlocking,
// progress, next unit) because it is what a test can exercise one case at a
// time, and what a mobile companion gets through `coreExport`.
//
// 🚨 Every read of a MEMBER's rows is scoped by `memberId`. `unitSlug` is a
// string the browser sent, so "no such row" and "somebody else's row" are
// deliberately the same answer.
//
// 🚨 **There are THREE writing halves below, and they hold DIFFERENT conditions.**
// The operator's CONTENT half writes the course's own rows and carries `origin`
// in every `where` or `values` (`origin = 'operator'`, never the applier's
// `'content'`). The member's half — the hand-in — carries `memberId` AND
// `replied_at is null`. The operator's ANSWER half, at the very bottom, carries
// neither and instead makes what must not move immovable, with `coalesce` inside
// the one statement. What all three share is the reason a decision is repeated in
// the STATEMENT after an action has already made it: a caller who skips that
// decision then hits NOTHING, or nothing that matters, rather than the wrong row.
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, inArray, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema-core";
import { media } from "@/db/schema-media";
import { escapeLikeFragment } from "@/lib/digistore/purchase-filter";

import { coursesBlocks, coursesCompletions, coursesSubmissions, coursesUnits } from "../schema";
import type { CourseSlotId } from "../rules";

/**
 * One block with its units, in the order the operator gave them.
 *
 * ⚠️ **`origin` is DECLARED, and that is the point of the field rather than an
 * afterthought.** The unit objects have carried it since the column existed —
 * the mapping below spreads the row and drops only `blockId` and `createdAt` —
 * so it arrived through this interface without the interface saying so:
 * type-checked, green, and invisible. A field a page builds on that no type
 * names is a field the next reshaping of this mapping loses in silence, and the
 * page it feeds would then render the same badge for every row and be right
 * about none of them. The blocks did not carry it at all until now, which is
 * the same gap from the other side.
 *
 * `string`, not `CourseRowOrigin` — the same argument `mayOperatorWrite()` in
 * `../rules.ts` makes about its own parameter. The value comes out of a `text`
 * column with no check constraint behind it, so the case worth handling is a
 * value nobody planned for; a narrowed type here would let a reader believe the
 * two literals are exhaustive and treat anything else as impossible.
 */
export interface BlockWithUnits {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  position: number;
  releaseAfterDays: number;
  origin: string;
  units: {
    id: string;
    slug: string;
    title: string;
    position: number;
    origin: string;
    body: string | null;
    coverMediaId: string | null;
    videoMediaId: string | null;
    subtitleMediaId: string | null;
    worksheetMediaId: string | null;
    taskPrompt: string | null;
  }[];
}

/**
 * The whole course, ordered.
 *
 * TWO queries, not one per block: a course is small enough to load whole and
 * big enough that a per-block query is an N+1 on the page every learner opens
 * first.
 */
export async function courseOutline(): Promise<BlockWithUnits[]> {
  const blocks = await db.select().from(coursesBlocks).orderBy(asc(coursesBlocks.position));
  if (blocks.length === 0) return [];

  const units = await db
    .select()
    .from(coursesUnits)
    .where(inArray(coursesUnits.blockId, blocks.map((block) => block.id)))
    .orderBy(asc(coursesUnits.position));

  return blocks.map((block) => ({
    id: block.id,
    slug: block.slug,
    title: block.title,
    summary: block.summary,
    position: block.position,
    releaseAfterDays: block.releaseAfterDays,
    // Named field by field, unlike the units below, so this line is the one
    // that has to be added rather than one that appears by itself.
    origin: block.origin,
    units: units
      .filter((unit) => unit.blockId === block.id)
      .map(({ blockId: _blockId, createdAt: _createdAt, ...unit }) => unit),
  }));
}

/**
 * 🚨 The join `courseOutline()` deliberately does not make: media id → storage key.
 *
 * It exists so `unitFingerprint()` can hash the value that TRAVELS. A media id
 * exists once, in one database; the storage key `content/<topic>/<file>.<ext>`
 * is what `mediaIdFor()` looked the row up under, so the repo can derive the
 * same string from its own manifest path. Without it, the four slots could only
 * be hashed as a boolean, and a lesson whose video was swapped for another read
 * as untouched in `node run.mjs courses-diff` — measured, and the reason this
 * function exists at all (`./fingerprint.mjs` carries the numbers).
 *
 * ⚠️ **A door of its own rather than a third query inside `courseOutline()`,
 * and that is the whole decision.** `courseOutline()` is read by the member's
 * overview and by the admin page, and the overview *deliberately resolves no
 * media at all* (`./media.ts` says so and gives the reason). Folding this in
 * would put an extra query on the page every learner opens first, to compute a
 * value only the setup surface reads. So the tool asks for it and nobody else
 * pays — the same split `unitsWithMedia()` already made in this file.
 *
 * ONE query, ids de-duplicated first: four slots across sixty lessons is a
 * handful of distinct rows, and a course legitimately reuses one cover.
 *
 * A key MISSING from the answer is not this function's to judge — it hands back
 * what it found, and `unitFingerprint()` refuses an occupied slot with no key
 * with a sentence naming the lesson. The FK is `set null`, so a non-null id has
 * a row and this cannot happen from the database side.
 */
export async function mediaKeysFor(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({ id: media.id, storageKey: media.storageKey })
    .from(media)
    .where(inArray(media.id, wanted));

  return new Map(rows.map((row) => [row.id, row.storageKey]));
}

/** One lesson's media slots, plus the release day of the block it sits in. */
export interface UnitMediaRow {
  slug: string;
  title: string;
  /** From the BLOCK, exactly as `UnitSearchRow` carries it and for the same
   *  reason: `isUnlocked()` needs it, and a second query for it would be an N+1
   *  over the very list this door exists to keep to one. */
  releaseAfterDays: number;
  coverMediaId: string | null;
  videoMediaId: string | null;
  subtitleMediaId: string | null;
  worksheetMediaId: string | null;
}

/**
 * Every lesson that has a medium, with its slots — and **no lesson text**.
 *
 * ⚠️ **The absence of `body` is the whole point of this door.** The content
 * source's `findMedia()` used `courseOutline()`, which is `select()` — every
 * column of every unit, so the entire course's prose travelled out of Postgres
 * to read four id columns per row. A twelve-week course is a megabyte of text
 * nobody reads, per question to the assistant. `courseOutline()` is right for
 * the page and for `list()`, which print what they load; this is for the caller
 * that only wants the slots.
 *
 * ONE query, and units with no medium at all never leave the database — they
 * contribute nothing a media search could answer with. The order is the
 * course's own (block, then position), the same as `courseOutline()`, so a
 * capped answer takes the same rows in the same order as the overview shows.
 */
export async function unitsWithMedia(): Promise<UnitMediaRow[]> {
  return db
    .select({
      slug: coursesUnits.slug,
      title: coursesUnits.title,
      releaseAfterDays: coursesBlocks.releaseAfterDays,
      coverMediaId: coursesUnits.coverMediaId,
      videoMediaId: coursesUnits.videoMediaId,
      subtitleMediaId: coursesUnits.subtitleMediaId,
      worksheetMediaId: coursesUnits.worksheetMediaId,
    })
    .from(coursesUnits)
    .innerJoin(coursesBlocks, eq(coursesUnits.blockId, coursesBlocks.id))
    .where(
      or(
        isNotNull(coursesUnits.coverMediaId),
        isNotNull(coursesUnits.videoMediaId),
        isNotNull(coursesUnits.subtitleMediaId),
        isNotNull(coursesUnits.worksheetMediaId),
      ),
    )
    .orderBy(asc(coursesBlocks.position), asc(coursesUnits.position));
}

/** One unit by its slug, or `null`. */
export async function unitBySlug(slug: string) {
  const [unit] = await db.select().from(coursesUnits).where(eq(coursesUnits.slug, slug)).limit(1);
  return unit ?? null;
}

/** One search candidate: a unit, plus the release day of the block it sits in. */
export interface UnitSearchRow {
  slug: string;
  title: string;
  body: string | null;
  /** From the BLOCK — `isUnlocked()` needs it, and a second query for it would
   *  be an N+1 over the very list this door exists to keep to one. */
  releaseAfterDays: number;
}

/**
 * The units whose title or body mentions any of the terms — the candidates a
 * search ranks, never the ranking itself.
 *
 * ⚠️ **The division of labour is the point.** ILIKE NARROWS; the ORDER is the
 * shared pure arithmetic in `lib/content-source/rules.ts`, so a hit out of this
 * table and a hit out of the handbook can be merged into one list that means
 * something. A `where` that tried to score would be a second ranking, and two
 * rankings are two answers to one question.
 *
 * Capped rather than paged: this feeds an assistant's mid-answer lookup, so
 * "the two hundred rows that mention the word" is already far more than any
 * answer uses, and an unbounded scan is the shape a pasted paragraph turns into
 * a table scan. `searchTerms()` has already capped the term count.
 *
 * Course order (block, then position) is the tie-break `rankRecords()` keeps
 * for equal scores — deterministic on every machine, no locale-sensitive sort.
 */
export async function searchUnits(
  terms: readonly string[],
  limit: number,
): Promise<UnitSearchRow[]> {
  if (terms.length === 0) return [];
  // `%`, `_` and `\` are LIKE syntax — an unescaped term from a member's
  // question would match a different set than the one they asked for.
  const patterns = terms.map((term) => `%${escapeLikeFragment(term)}%`);
  return db
    .select({
      slug: coursesUnits.slug,
      title: coursesUnits.title,
      body: coursesUnits.body,
      releaseAfterDays: coursesBlocks.releaseAfterDays,
    })
    .from(coursesUnits)
    .innerJoin(coursesBlocks, eq(coursesUnits.blockId, coursesBlocks.id))
    .where(
      or(
        ...patterns.flatMap((pattern) => [
          ilike(coursesUnits.title, pattern),
          ilike(coursesUnits.body, pattern),
        ]),
      ),
    )
    .orderBy(asc(coursesBlocks.position), asc(coursesUnits.position))
    .limit(limit);
}

/** The block a unit belongs to — needed for the unlock decision. */
export async function blockById(id: string) {
  const [block] = await db.select().from(coursesBlocks).where(eq(coursesBlocks.id, id)).limit(1);
  return block ?? null;
}

/** Which units this member has marked done. A Set, because that is how it is used. */
export async function completedSlugsFor(memberId: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: coursesCompletions.unitSlug })
    .from(coursesCompletions)
    .where(eq(coursesCompletions.memberId, memberId));
  return new Set(rows.map((row) => row.slug));
}

/** Mark a unit done, or undo it. Idempotent in both directions. */
export async function setCompleted(memberId: string, unitSlug: string, done: boolean) {
  if (!done) {
    await db
      .delete(coursesCompletions)
      .where(
        and(eq(coursesCompletions.memberId, memberId), eq(coursesCompletions.unitSlug, unitSlug)),
      );
    return;
  }
  await db
    .insert(coursesCompletions)
    .values({ memberId, unitSlug })
    .onConflictDoNothing();
}

/**
 * This member's hand-in for one unit, or `null`.
 *
 * 🚨 **The only reader in this file that takes a `memberId`, and the only one
 * that ever will.** It serves the MEMBER's own lesson page, where scoping the
 * query by the session's account is what makes "no such row" and "somebody
 * else's row" the same answer. Every other reader of this table below serves
 * the OPERATOR's queue and is scoped by `replied_at` instead — there is
 * deliberately no way to ask "what has member X handed in", because who is
 * working through which lesson is purchase information (`docs/data-protection.md`
 * §14b). `./no-roster.test.ts` reads this file and holds that line.
 */
export async function submissionFor(memberId: string, unitSlug: string) {
  const [row] = await db
    .select()
    .from(coursesSubmissions)
    .where(
      and(eq(coursesSubmissions.memberId, memberId), eq(coursesSubmissions.unitSlug, unitSlug)),
    )
    .limit(1);
  return row ?? null;
}

/** How many rows of one kind exist, split by who wrote them. */
export interface OriginCounts {
  readonly content: number;
  readonly operator: number;
}

/**
 * How many blocks and units this environment holds — what `presence` reports,
 * and it reports both origins because they answer different questions.
 *
 * `content` says whether `content-apply` ever ran against this database: zero
 * there is the deploy-shaped failure `docs/content.md` opens on. `operator`
 * says what somebody typed into THIS environment and nowhere else — rows that
 * travel with no deploy, which is worth seeing precisely because nothing else
 * will ever mention them.
 *
 * ⚠️ An origin with no rows is simply ABSENT from a `group by`, so both are
 * folded to a number here. `undefined` reaching a presence item would render as
 * an empty count and read as "asked and found none", which is the one thing
 * `content-check` may never confuse.
 */
export async function countContent(): Promise<{ blocks: OriginCounts; units: OriginCounts }> {
  const blocks = await db
    .select({ origin: coursesBlocks.origin, n: count() })
    .from(coursesBlocks)
    .groupBy(coursesBlocks.origin);
  const units = await db
    .select({ origin: coursesUnits.origin, n: count() })
    .from(coursesUnits)
    .groupBy(coursesUnits.origin);
  return { blocks: byOrigin(blocks), units: byOrigin(units) };
}

function byOrigin(rows: readonly { origin: string; n: number }[]): OriginCounts {
  const of = (origin: string) => rows.find((row) => row.origin === origin)?.n ?? 0;
  return { content: of("content"), operator: of("operator") };
}

/**
 * Units with a hand-in prompt whose media slot is empty — the second thing
 * `presence` reports, and the one a green tick would otherwise hide.
 *
 * A unit with no body AND no video is a lesson page that renders a heading and
 * nothing else. It is not a broken deploy, so it is `expected: null` — but it is
 * exactly what somebody wants to see before they call a course finished.
 *
 * ⚠️ Deliberately NOT split by origin, unlike `countContent()`: a lesson with
 * neither text nor video is empty whoever wrote it, and a learner opening it
 * cannot tell which surface left it that way.
 */
export async function emptyUnitSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: coursesUnits.slug })
    .from(coursesUnits)
    .where(and(isNull(coursesUnits.body), isNull(coursesUnits.videoMediaId)))
    .orderBy(asc(coursesUnits.position));
  return rows.map((row) => row.slug);
}

// ── The operator's own rows ────────────────────────────────────────────────
//
// Everything below writes, and writes exactly one half of these tables. The
// applier owns `origin = 'content'` and re-asserts it on every `content-apply`;
// this half is `origin = 'operator'` — rows typed into ONE environment, which
// travel with no deploy and which no applier touches (spine AD-82, and
// `content/appliers/course.mjs` carries the other side of the argument).
//
// Two properties hold for every function here, and neither is decoration:
//
//   * **`origin` is set EXPLICITLY on every insert.** The column's
//     `default 'content'` belongs to the migration — it backfills rows that were
//     already there, all of which came through the applier. A writer that leaned
//     on it would produce rows nobody can tell apart from the applier's, and the
//     next `content-apply` would then own them.
//   * **`origin` is in the WHERE of every update and delete.** The action has
//     already refused a `content` row with a sentence naming its file; this is
//     the second half, and it is what a caller who skipped that step runs into.
//     An update matching no row succeeds — which is why these return whether a
//     row was hit rather than nothing.

// The reads a refusal needs before anything is written. A block by id is
// `blockById()` above — the unlock decision already needed it.

/** One unit by id, or `null` — the write path's counterpart to `unitBySlug()`. */
export async function unitById(id: string) {
  const [unit] = await db.select().from(coursesUnits).where(eq(coursesUnits.id, id)).limit(1);
  return unit ?? null;
}

/** How many lessons hang under this block — the number `blockDeletable()` judges. */
export async function unitCountFor(blockId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(coursesUnits)
    .where(eq(coursesUnits.blockId, blockId));
  return row?.n ?? 0;
}

/**
 * The block positions already in use — BOTH origins, and `exceptId` left out.
 *
 * Both origins because a `content` row is untouchable and its position is still
 * occupied; `exceptId` because re-saving a row at its own position is not a
 * collision with itself.
 */
export async function blockPositions(exceptId?: string): Promise<number[]> {
  const rows = await db
    .select({ position: coursesBlocks.position })
    .from(coursesBlocks)
    .where(exceptId ? ne(coursesBlocks.id, exceptId) : undefined);
  return rows.map((row) => row.position);
}

/** The same question inside one block — the scope `courseOutline()` renders in. */
export async function unitPositions(blockId: string, exceptId?: string): Promise<number[]> {
  const rows = await db
    .select({ position: coursesUnits.position })
    .from(coursesUnits)
    .where(
      exceptId
        ? and(eq(coursesUnits.blockId, blockId), ne(coursesUnits.id, exceptId))
        : eq(coursesUnits.blockId, blockId),
    );
  return rows.map((row) => row.position);
}

/**
 * The lesson slugs under one block — the member pages a block-level write has
 * to revalidate, because `releaseAfterDays` is what each of them locks against.
 *
 * BOTH origins on purpose: a content lesson under an operator block (or the
 * other way round) still renders the block's unlock decision.
 */
export async function unitSlugsIn(blockId: string): Promise<string[]> {
  const rows = await db
    .select({ slug: coursesUnits.slug })
    .from(coursesUnits)
    .where(eq(coursesUnits.blockId, blockId));
  return rows.map((row) => row.slug);
}

/**
 * Does any row hold this slug already — whichever side wrote it?
 *
 * Both tables carry a unique index on `slug`, so this is the question the
 * database would answer with a driver error two lines later. Asking it first is
 * what turns that into a sentence.
 */
export async function blockSlugTaken(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: coursesBlocks.id })
    .from(coursesBlocks)
    .where(eq(coursesBlocks.slug, slug))
    .limit(1);
  return Boolean(row);
}

/** The same for a lesson. Separate tables, separate unique indexes. */
export async function unitSlugTaken(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: coursesUnits.id })
    .from(coursesUnits)
    .where(eq(coursesUnits.slug, slug))
    .limit(1);
  return Boolean(row);
}

/** What the operator typed into the block form. */
export interface BlockInput {
  readonly title: string;
  readonly summary: string | null;
  readonly releaseAfterDays: number;
}

/** …and into the lesson form. */
export interface UnitInput {
  readonly title: string;
  readonly body: string | null;
  readonly taskPrompt: string | null;
}

/** Create a block of the operator's own. */
export async function createBlock(
  input: BlockInput & { slug: string; position: number },
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(coursesBlocks)
    .values({
      slug: input.slug,
      origin: "operator",
      title: input.title,
      summary: input.summary,
      position: input.position,
      releaseAfterDays: input.releaseAfterDays,
    })
    .returning({ id: coursesBlocks.id, slug: coursesBlocks.slug });
  return row;
}

/** Change one — never its slug, which is a route and a Subject Key. */
export async function updateBlock(id: string, input: BlockInput): Promise<boolean> {
  const rows = await db
    .update(coursesBlocks)
    .set({
      title: input.title,
      summary: input.summary,
      releaseAfterDays: input.releaseAfterDays,
    })
    .where(and(eq(coursesBlocks.id, id), eq(coursesBlocks.origin, "operator")))
    .returning({ id: coursesBlocks.id });
  return rows.length > 0;
}

/** Move one. Its own statement, because ordering is not content. */
export async function setBlockPosition(id: string, position: number): Promise<boolean> {
  const rows = await db
    .update(coursesBlocks)
    .set({ position })
    .where(and(eq(coursesBlocks.id, id), eq(coursesBlocks.origin, "operator")))
    .returning({ id: coursesBlocks.id });
  return rows.length > 0;
}

/**
 * Delete one.
 *
 * ⚠️ The emptiness check is the ACTION's, not this function's — it has to name
 * the count in a sentence, and a count is not something a delete can hand back.
 * `on delete cascade` is still on the table and would still fire; that is the
 * answer to `module remove --drop-data`, never to a click.
 */
export async function deleteBlock(id: string): Promise<boolean> {
  const rows = await db
    .delete(coursesBlocks)
    .where(and(eq(coursesBlocks.id, id), eq(coursesBlocks.origin, "operator")))
    .returning({ id: coursesBlocks.id });
  return rows.length > 0;
}

/**
 * Create a lesson of the operator's own.
 *
 * ⚠️ The BLOCK it hangs under may be either origin, and that is deliberate: an
 * insert here writes no row of the block's, so a bonus lesson under week one is
 * an operator row inside a file's block and breaks nothing. The next
 * `content-apply` re-asserts the block and leaves the lesson standing.
 */
export async function createUnit(
  input: UnitInput & { blockId: string; slug: string; position: number },
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(coursesUnits)
    .values({
      blockId: input.blockId,
      slug: input.slug,
      origin: "operator",
      title: input.title,
      position: input.position,
      body: input.body,
      taskPrompt: input.taskPrompt,
    })
    .returning({ id: coursesUnits.id, slug: coursesUnits.slug });
  return row;
}

/** Change one — never its slug. */
export async function updateUnit(id: string, input: UnitInput): Promise<boolean> {
  const rows = await db
    .update(coursesUnits)
    .set({ title: input.title, body: input.body, taskPrompt: input.taskPrompt })
    .where(and(eq(coursesUnits.id, id), eq(coursesUnits.origin, "operator")))
    .returning({ id: coursesUnits.id });
  return rows.length > 0;
}

/** Move one inside its block. */
export async function setUnitPosition(id: string, position: number): Promise<boolean> {
  const rows = await db
    .update(coursesUnits)
    .set({ position })
    .where(and(eq(coursesUnits.id, id), eq(coursesUnits.origin, "operator")))
    .returning({ id: coursesUnits.id });
  return rows.length > 0;
}

/**
 * Point one media slot of one lesson at a row — or at nothing.
 *
 * ⚠️ **`null` detaches and deletes NOTHING.** The column goes empty, the `media`
 * row and its object stay. Four reasons, and they are why this is one function
 * rather than a delete with a tidy-up:
 *
 *   a) One file can hang on two lessons. `mediaIdFor(path)` gives ONE id per
 *      manifest path (`content/appliers/course.mjs`), so removing the object
 *      would empty the OTHER lesson's slot through the row's `set null` —
 *      silently, on a page nobody was looking at.
 *   b) `deleteMedia()` takes the object first and the row second
 *      (`lib/media/manage.ts`) — irreversible, and a misclick then costs a new
 *      upload of a file that may not exist anywhere else.
 *   c) A lesson cover is the PRODUCT, not the person.
 *      `OWNED_MEDIA_VISIBILITIES` draws that line explicitly: "deleting the
 *      operator's account must not take the app's lesson covers with it — the
 *      line is *whose data is this*, not *who uploaded it*." A face is deleted,
 *      a cover is not.
 *   d) The price is an orphaned object in the bucket, and it is NAMED rather
 *      than hidden: this app has no surface that really deletes product files.
 *
 * The `origin` condition is here for the same reason it is on every other
 * mutation in this file — see the note above.
 */
export async function setUnitMedia(
  id: string,
  slot: CourseSlotId,
  mediaId: string | null,
): Promise<boolean> {
  const rows = await db
    .update(coursesUnits)
    .set(slotPatch(slot, mediaId))
    .where(and(eq(coursesUnits.id, id), eq(coursesUnits.origin, "operator")))
    .returning({ id: coursesUnits.id });
  return rows.length > 0;
}

/**
 * Which column a slot writes.
 *
 * A `switch` rather than a lookup table with a computed key: the four column
 * names are then written out where the compiler can check each one against the
 * schema, and a fifth slot is a compile error instead of an update that quietly
 * sets nothing.
 */
function slotPatch(slot: CourseSlotId, mediaId: string | null) {
  switch (slot) {
    case "cover":
      return { coverMediaId: mediaId };
    case "video":
      return { videoMediaId: mediaId };
    case "subtitle":
      return { subtitleMediaId: mediaId };
    case "worksheet":
      return { worksheetMediaId: mediaId };
  }
}

/** Delete one. A lesson holds nothing of its own — completions key on the slug. */
export async function deleteUnit(id: string): Promise<boolean> {
  const rows = await db
    .delete(coursesUnits)
    .where(and(eq(coursesUnits.id, id), eq(coursesUnits.origin, "operator")))
    .returning({ id: coursesUnits.id });
  return rows.length > 0;
}

// ── The member's own hand-in ───────────────────────────────────────────────
//
// The third writing surface of this module, and the only one that writes a row
// belonging to a MEMBER. Its counterpart is `submissionFor()` further up: reads
// and writes of one table stay in one file, which is why this sits here rather
// than in a file of its own.
//
// The condition that stands in for `origin` here is twofold, and both halves are
// in the statement:
//
//   * **`memberId`.** The account is the session's own, never a value the
//     request named (`../pages/actions.ts` takes no member id at all). Carrying
//     it into the statement means a caller who lost that guarantee writes
//     NOTHING rather than somebody else's row.
//   * **`replied_at is null`.** A hand-in that has been answered is frozen.

/**
 * Store this member's hand-in for one lesson — or refuse, having written nothing.
 *
 * One statement, because the unique index `courses_submissions_member_unit` is
 * what makes handing in an UPSERT: one row per member per lesson, revised until
 * somebody replies. Two rows would make "has this been answered" a question with
 * two answers.
 *
 * 🚨 **`replied_at is null` sits in the `do update`, although the action has
 * already asked it.** Same reasoning as `origin` on the operator's writes above
 * — and here it buys something the operator's half does not need: two requests
 * arriving together cannot overwrite a row a coach answered between the check
 * and the write. The `do update` then matches no row, `returning` is empty, and
 * `false` travels back to the action, which turns it into the same sentence the
 * check would have produced. An upsert that matches nothing SUCCEEDS, so a
 * function that returned nothing would report that silence as a save.
 *
 * `setWhere`, not the deprecated `where`: it is the condition on the UPDATE
 * branch. `targetWhere` would be a partial-index qualifier, which this table's
 * unique index is not.
 */
export async function upsertSubmission(
  memberId: string,
  unitSlug: string,
  body: string,
): Promise<boolean> {
  const rows = await db
    .insert(coursesSubmissions)
    .values({ memberId, unitSlug, body })
    .onConflictDoUpdate({
      target: [coursesSubmissions.memberId, coursesSubmissions.unitSlug],
      // `submittedAt` is set explicitly: `defaultNow()` fires on the INSERT
      // branch only, so a revision would otherwise keep the first date and the
      // page would tell somebody their new text arrived last week.
      set: { body, submittedAt: new Date() },
      setWhere: and(
        eq(coursesSubmissions.memberId, memberId),
        isNull(coursesSubmissions.repliedAt),
      ),
    })
    .returning({ id: coursesSubmissions.id });
  return rows.length > 0;
}

// ── The operator's answering surface ───────────────────────────────────────
//
// 🚨 **There is no reader here that takes a member id, and that is the design
// rather than an omission.** The queue lists HAND-INS, never people: somebody
// who has handed nothing in appears nowhere, and there is no route from a member
// to "their course progress". Who is working through which lesson is purchase
// information — the same argument with which the community has no roster
// (`CLAUDE.md` → *Which EU rules reach this app*, `docs/data-protection.md`
// §14b). So: no search over all hand-ins, no filter argument, no export of "all
// the replies", and the answered list is capped rather than paged, because a
// browsable body of somebody else's prose IS the export this module refuses.
// `./no-roster.test.ts` reads this file as text and fails on a reader that grows
// a `memberId` parameter.
//
// 🚨 **THE NARROWING IS IN THE QUERY** (`modules/community/pages/moderation/page.tsx`).
// A page that fetched everything and rendered a subset would have shipped the
// rest in its own payload.
//
// ⚠️ **Two queries, not one, and the index is the reason.**
// `courses_submissions_waiting` is an ordinary btree on
// `(replied_at, submitted_at)`, and Postgres orders an ASC btree NULLS LAST. The
// one query this surface suggests —
// `ORDER BY replied_at ASC NULLS FIRST, submitted_at ASC` — asks for the
// opposite null order, which that index cannot serve: the plan becomes a Sort
// over the whole table and the index built for this list goes unused. What it
// DOES serve is `WHERE replied_at IS NULL ORDER BY replied_at, submitted_at` —
// the null rows lie together at the end of the index, ordered by `submitted_at`
// within, so an ordered index scan answers it. `replied_at` stays in the ORDER
// BY although every row it returns has the same value there: it is what makes
// the requested order a PREFIX of the index's own, and dropping it is what turns
// this back into a Sort. The measured plans are in the story's debug log.

/** What the queue shows about one hand-in. Deliberately not the DB row. */
export interface WaitingSubmission {
  readonly id: string;
  readonly memberId: string;
  readonly unitSlug: string;
  readonly submittedAt: Date;
  readonly repliedAt: Date | null;
  /** The account's name, `null` when nobody set one — `learnerLabel()` decides. */
  readonly memberName: string | null;
  /** The account's address, nullable in the schema and therefore here. */
  readonly memberEmail: string | null;
  /** The lesson's title, `null` when the lesson has since been deleted. */
  readonly unitTitle: string | null;
}

/**
 * The columns both lists select. One object, so the two queries cannot drift
 * into showing different things about the same row.
 *
 * ⚠️ **`body` is NOT in it.** The queue says that something is waiting and who
 * from; reading what a person wrote is the detail page, one row at a time. A
 * list that selected fifty bodies would put fifty pieces of somebody's private
 * writing into one HTML payload to render three lines of each.
 */
const LIST_COLUMNS = {
  id: coursesSubmissions.id,
  memberId: coursesSubmissions.memberId,
  unitSlug: coursesSubmissions.unitSlug,
  submittedAt: coursesSubmissions.submittedAt,
  repliedAt: coursesSubmissions.repliedAt,
  memberName: users.name,
  memberEmail: users.email,
  unitTitle: coursesUnits.title,
};

/**
 * What is waiting — unanswered, oldest first.
 *
 * `limit` is a ceiling, not a page: there is no cursor and no `offset`, because
 * a queue is worked through rather than browsed. `waitingCount()` says how many
 * there are in total, so the page can say "the 50 oldest of 312" instead of
 * quietly truncating.
 *
 * Both joins are LEFT joins and both can legitimately miss: a member whose
 * account was deleted takes their rows with them today (`memberId` cascades), and
 * a lesson can be deleted while a hand-in on its slug survives — `unitSlug` is
 * an opaque key, never a foreign key, exactly as a completion's is.
 */
export async function waitingSubmissions(limit = 50): Promise<WaitingSubmission[]> {
  return db
    .select(LIST_COLUMNS)
    .from(coursesSubmissions)
    .leftJoin(users, eq(users.id, coursesSubmissions.memberId))
    .leftJoin(coursesUnits, eq(coursesUnits.slug, coursesSubmissions.unitSlug))
    .where(isNull(coursesSubmissions.repliedAt))
    .orderBy(asc(coursesSubmissions.repliedAt), asc(coursesSubmissions.submittedAt))
    .limit(limit);
}

/** How many are waiting in total — the number the "showing N of M" line needs. */
export async function waitingCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(coursesSubmissions)
    .where(isNull(coursesSubmissions.repliedAt));
  return row?.n ?? 0;
}

/**
 * Is anything waiting at all — the sidebar's dot, and nothing more.
 *
 * ⚠️ **Existence, never a number, and `waitingCount()` above is not an
 * acceptable substitute.** This runs on EVERY protected page load of an app
 * that installed the module, so it asks the cheapest question the index
 * `courses_submissions_waiting` can answer: the null rows lie together at one
 * end of it, and `limit 1` stops at the first. A count is an aggregation over
 * all of them, and the shell has no use for the total —
 * `components/app-shell.tsx` renders a dot rather than a badge number, and says
 * beside it why. The queue page is where the total belongs, because somebody
 * opened it deliberately.
 *
 * ⚠️ **Deliberately NOT scoped by `memberId`** — the one exception to this
 * file's opening rule, and it is worth reading as a decision rather than as
 * forgotten scoping. The question is the OPERATOR's ("is there anything for me
 * to read"), and it is asked over every hand-in in the app because that is what
 * it means. The caller narrows it instead: `../module.ts` asks it only for
 * `isOwner(viewer.role)`, and `/dashboard/admin/course` behind the dot opens
 * with `requireOwner()`. What comes back is one boolean — no id, no slug, no
 * name — so it is not a roster wearing a different signature.
 */
export async function hasWaitingSubmission(): Promise<boolean> {
  const [row] = await db
    .select({ id: coursesSubmissions.id })
    .from(coursesSubmissions)
    .where(isNull(coursesSubmissions.repliedAt))
    .limit(1);
  return Boolean(row);
}

/**
 * The most recently answered ones.
 *
 * The same index, read backwards: `replied_at IS NOT NULL` selects everything
 * before the null tail and `DESC` walks it from the far end.
 *
 * ⚠️ **Capped, and it is not an archive.** There is no page two, deliberately —
 * see the note at the top of this section.
 */
export async function answeredSubmissions(limit = 20): Promise<WaitingSubmission[]> {
  return db
    .select(LIST_COLUMNS)
    .from(coursesSubmissions)
    .leftJoin(users, eq(users.id, coursesSubmissions.memberId))
    .leftJoin(coursesUnits, eq(coursesUnits.slug, coursesSubmissions.unitSlug))
    .where(isNotNull(coursesSubmissions.repliedAt))
    .orderBy(desc(coursesSubmissions.repliedAt))
    .limit(limit);
}

/** One hand-in, whole — what the detail page reads. */
export interface SubmissionDetail extends WaitingSubmission {
  /** What the member wrote. The one place in this module it is read by anybody else. */
  readonly body: string;
  readonly reply: string | null;
}

/**
 * One hand-in by its id, or `null`.
 *
 * 🚨 **No member parameter, and none is missing.** The reader is
 * `requireOwner()` — the account that may read every hand-in in the app — so
 * scoping by a member would be theatre rather than a control. The id is a
 * `randomUUID()`, and the page it feeds is behind the switch and that guard.
 */
export async function submissionById(id: string): Promise<SubmissionDetail | null> {
  const [row] = await db
    .select({ ...LIST_COLUMNS, body: coursesSubmissions.body, reply: coursesSubmissions.reply })
    .from(coursesSubmissions)
    .leftJoin(users, eq(users.id, coursesSubmissions.memberId))
    .leftJoin(coursesUnits, eq(coursesUnits.slug, coursesSubmissions.unitSlug))
    .where(eq(coursesSubmissions.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Write the operator's answer — the first one, or a correction of it.
 *
 * 🚨 **ONE statement with two `coalesce`s, never two paths.** "The first reader
 * stays the first reader" is then the SHAPE of the instruction rather than a
 * rule in code above it, and two operators answering at the same moment cannot
 * overtake each other: whichever `UPDATE` lands second finds the columns already
 * set and leaves them.
 *
 * What may change and what may not:
 *
 *   * **`reply` may be rewritten.** The freeze belongs to the MEMBER — their
 *     text is what an answer refers to, and a text that changes under its answer
 *     makes the answer a lie. Nothing refers to the reply, so correcting it
 *     breaks nothing, and a coach who cannot fix a typo in front of a paying
 *     customer is the worse product. It is irreversible: there is no version
 *     history and there is not to be one — a history of what a coach wrote ABOUT
 *     a member is a second body of member-adjacent prose with its own retention
 *     question. The surface asks before it overwrites.
 *   * **`replied_at` may not.** It answers *when this was read*, and a
 *     correction does not un-read it. More to the point it is the condition the
 *     member's freeze hangs on, so a write that could move or clear it would be
 *     a way to re-open somebody's hand-in from the operator's side.
 *     `replyProblem("")` closes the quiet version of that (`../rules.ts`).
 *   * **`replied_by` may not.** It answers *who read this person's text* — the
 *     identity Art. 15(4) keeps out of both subject-access exports, because it
 *     belongs to a third party. Let it travel and the column would answer "who
 *     typed last", a question nobody asked.
 *
 * ⚠️ No `sql<Date>` anywhere: the two `coalesce`s are untyped `sql`, used in a
 * `set` where Drizzle hands them to Postgres and reads nothing back through
 * them. `db/sql-cast.test.ts` fails on a Date-typed raw expression, and it is
 * right to — a raw expression carries no mapper.
 *
 * Returns whether a row was hit. An `UPDATE` matching nothing SUCCEEDS, so a
 * function returning nothing would report that silence as a save.
 */
export async function replyToSubmission(input: {
  readonly id: string;
  readonly reply: string;
  readonly ownerId: string;
}): Promise<boolean> {
  const rows = await db
    .update(coursesSubmissions)
    .set({
      reply: input.reply,
      repliedAt: sql`coalesce(${coursesSubmissions.repliedAt}, now())`,
      repliedBy: sql`coalesce(${coursesSubmissions.repliedBy}, ${input.ownerId})`,
    })
    .where(eq(coursesSubmissions.id, input.id))
    .returning({ id: coursesSubmissions.id });
  return rows.length > 0;
}
