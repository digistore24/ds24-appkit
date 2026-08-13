// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What is new, what would change, what is untouched — the comparison itself.
//
// ── Pure, and that is the only reason it can be tested at all ──────────────
// Rows in, verdict out: no `fetch`, no `fs`, no clock, no database. The local
// side arrives as `readBlocks()`'s output (the applier's own reader — a second
// one would be a second opinion about what the repo holds), the target side as
// `courses_outline`'s `data` payload, and this file never learns where either
// came from. The same split `presence/check.ts` and `./outline.ts` already make
// in this module, for the same stated reason.
//
// ── One definition of "changed", never two that agree today ────────────────
// 🚨 A lesson is compared by **fingerprint** and by nothing else: the target's
// value against `unitFingerprint(localUnitRow(unit))`, the same function that
// produced the target's. Re-deriving "changed" from a field list here would be
// the second implementation `./fingerprint.mjs` exists to prevent — and the two
// would agree right up until somebody edited one of them.
//
// A **block** has no fingerprint, so its four applied fields are compared
// explicitly — `title`, `summary`, `position`, `releaseAfterDays`, exactly what
// `content/appliers/course.mjs` writes on conflict — and the report says which
// of them moved. That is not a second opinion about a lesson; it is the only
// opinion about a block, and a block the operator renamed is a change a publish
// would make that no lesson fingerprint carries.
//
// ── Three things this deliberately does NOT catch ──────────────────────────
// Named here rather than discovered later, and each is a consequence of the rule
// above rather than an oversight:
//
//   * **a lesson whose `position` moved** reads as `untouched`. `position` is
//     excluded from the fingerprint on purpose (re-ordering a course would
//     otherwise light every lesson up), and adding a second comparison for it
//     here is exactly the "two definitions" this file refuses. The reorder is
//     still fully visible: the payload carries every lesson's position.
//   * **a lesson MOVED between blocks** reads as `untouched` for the same
//     reason — `blockId` is not hashed. The report groups lessons under their
//     block, so a reader sees it moved even though nothing calls it a change.
//
// A third used to stand here — *one video swapped for another in the same slot*
// — and it is gone: the four slots are hashed as their STORAGE KEY, which both
// sides derive (`./fingerprint.mjs`). What replaced it is the version question
// below.
//
// ── 🚨 A different fingerprint version is not a difference ─────────────────
// The target's digest was computed by the deploy running over there, and a
// deploy older than this checkout computes a different `FINGERPRINT_VERSION`.
// Every lesson then mismatches, correctly and meaninglessly. `compareCourse()`
// reports that as `fingerprintMismatch` — its own field, NOT an entry in
// `notCompared`, because `notCompared` means *that app does not send this
// field* and this is *it sends a value from another version*. Two different
// sentences; folding them would make the report say the wrong one.
//
// The lessons stay in `changed` while it holds, deliberately. It is the safe
// direction — a publish at that moment re-asserts rows that were identical
// anyway — and the command prints the reason above the lists rather than
// leaving a reader to wonder why a course they have not touched is on fire.
//
// ── Nothing here writes, and nothing here proposes ─────────────────────────
// The epic's word is *report*. There is no `--fix`, no rename, no offer: a slug
// renamed in a content file is the AGENT editing a repo file, in a conversation
// with a human present, rather than this function editing anything.
//
// ── "There is already one, under another name" ─────────────────────────────
// `compareCourse()` matches by SLUG, in both directions, because slug is what
// the applier upserts on. So a block the operator published as
// `kurs-grundlagen` and a block this repo calls `grundlagen` are two rows that
// have never met: one lands in `new`, the other in `targetOnly`, and a publish
// would quietly create a second course beside the first.
//
// `sameSubjectPairs()` is what notices. It pairs a local entry with a target
// entry when the SLUGS differ and the TITLES are the same subject — and it
// decides nothing at all: the question belongs to the agent, and the answer is
// expressed by editing a slug in `content/course/*.json`, never by a flag on a
// command or an argument to a tool. The applier stays the only writer of those
// rows, keyed by slug, from files in the repo (AD-82).
//
// ── 🚨 The matcher is deliberately dumb, and here is the reasoning ──────────
// The temptation is a similarity score, and it is the one "improvement" to this
// file that would make it worse. **The two failure modes are not symmetric:**
//
//   * a pair that is MISSED → nobody is asked → the operator publishes under a
//     new slug → the existing course is **untouched**, and the mistake is
//     visible, cheap and reversible (delete a block).
//   * a pair that is WRONG → the agent asks about two blocks that are not the
//     same subject → the operator answers "update" → a local slug is renamed
//     onto the wrong row → the applier upserts → **the lessons customers were
//     working through are replaced.**
//
// A missed pair costs a question that is not asked; a wrong pair costs an
// overwritten course. So: no Levenshtein threshold — a number somebody would
// have to defend for every language this app is sold in — no stemming, and above
// all no `includes()`, which pairs *"Grundlagen"* with *"Grundlagen für
// Fortgeschrittene"* and is exactly the case where updating the wrong one
// destroys a course. Everything past the dumb rule is the agent's judgement in
// the conversation, where a human is present.
import { FINGERPRINT_VERSION, localUnitRow, unitFingerprint } from "./fingerprint.mjs";

/**
 * @typedef {object} DiffEntry
 * @property {string} blockSlug  the block this row sits in (a block's own slug, for a block)
 * @property {string} slug
 * @property {string} title
 * @property {string} [origin]   only on `targetOnly` and `refused` — whose row it is there
 * @property {string[]} [fields] only on a changed BLOCK — which of the four moved
 */

/**
 * @typedef {object} DiffLists
 * @property {DiffEntry[]} new
 * @property {DiffEntry[]} changed
 * @property {DiffEntry[]} untouched
 * @property {DiffEntry[]} targetOnly
 * @property {DiffEntry[]} refused
 */

/** The four block fields `apply()` writes on conflict, in the order it writes them. */
const BLOCK_FIELDS = ["title", "summary", "position", "releaseAfterDays"];

/** The applier's own defaulting, so a file that omits a field compares as the row would be written. */
const blockValues = (block) => ({
  title: block.title,
  summary: block.summary ?? null,
  position: block.position,
  releaseAfterDays: block.releaseAfterDays ?? 0,
});

const emptyLists = () => ({ new: [], changed: [], untouched: [], targetOnly: [], refused: [] });

/**
 * Deterministic order: the block first, then the row inside it.
 *
 * A report whose lines move between runs is one nobody can diff — and this
 * command exists to be run twice. `slug` is the tie-breaker at both levels
 * because two lessons in different blocks legitimately share a position.
 *
 * ⚠️ **The block half is not decoration, and leaving it out was measured.**
 * Sorted on the lesson's own position alone, three lessons at positions 1, 2 and
 * 1 come out as block A / block B / block A — and a printer that groups by block
 * slug then prints the same block heading twice. Lessons are reported *under the
 * block they sit in*, so the order has to be block-major for that to be true.
 */
const bySort = (a, b) =>
  a.blockPosition - b.blockPosition ||
  a.blockSlug.localeCompare(b.blockSlug) ||
  a.position - b.position ||
  a.slug.localeCompare(b.slug);

/** Strip the sort keys: they are an ordering device, not part of the report. */
const shed = (rows) =>
  rows
    .sort(bySort)
    .map(({ position: _position, blockPosition: _blockPosition, ...entry }) => entry);

/**
 * Does any row over there carry this field at all?
 *
 * 🚨 The remote end is a DEPLOY, not this checkout — it may be running an older
 * template than the one that added `summary` and `origin` to the payload. Read
 * as absent, an `origin` nobody sent makes the `refused` list empty and a
 * missing `summary` makes every block "would change", and both are the same
 * defect: *"I could not look"* rendered as *"there is nothing there"*
 * (`template/CLAUDE.md`, everywhere). So a field the target never sends is
 * reported as **not compared** rather than compared against `undefined`.
 */
const carried = (rows, field) => rows.length === 0 || rows.some((row) => Object.hasOwn(row, field));

/**
 * Local content against what one environment holds.
 *
 * Match is **by slug, in both directions**, because slug is what the applier
 * upserts on. Every row lands in exactly ONE of the five lists:
 *
 * | | |
 * |---|---|
 * | `new` | local only — a publish would create it |
 * | `changed` | in both, and the content differs |
 * | `untouched` | in both, and it does not |
 * | `targetOnly` | in the target only. A publish **never deletes it** |
 * | `refused` | in both, and the target's row is not this applier's (`origin` ≠ `content`) — a publish would not touch it, it would REFUSE the whole run |
 *
 * 🚨 `refused` is checked BEFORE the content is compared and takes the row out
 * of every other list. Calling such a row "would change" would be worse than not
 * reporting it: it promises a write that `refuseClaimedSlugs()` guarantees will
 * not happen — the run throws, with every collision collected, and nothing at
 * all is applied.
 *
 * @param {{ slug: string, title: string, summary?: string|null, position: number,
 *           releaseAfterDays?: number, units?: object[] }[]} localBlocks
 *        `readBlocks()`'s output — already refused for duplicate slugs and positions
 * @param {{ blocks?: object[] } | null | undefined} outlineData
 *        `courses_outline`'s `data`
 * @returns {{ blocks: DiffLists, units: DiffLists, notCompared: string[],
 *             fingerprintMismatch: {here: string, there: string | null} | null }}
 *   `notCompared` names every field that deploy's payload does not send at all —
 *   an empty list is the ordinary answer and a non-empty one is a sentence the
 *   command prints, never a silence. `fingerprintMismatch` is non-null only when
 *   a fingerprint was actually compared AND the two sides compute different
 *   versions of it; `there: null` is a deploy that predates the tag.
 */
export function compareCourse(localBlocks, outlineData) {
  const targetBlocks = outlineData?.blocks ?? [];
  const blocks = emptyLists();
  const units = emptyLists();

  const targetBlockBySlug = new Map(targetBlocks.map((block) => [block.slug, block]));
  /** Every target lesson, with the block it sits in — the payload nests them. */
  const targetUnitBySlug = new Map();
  for (const block of targetBlocks) {
    for (const unit of block.units ?? []) targetUnitBySlug.set(unit.slug, { unit, block });
  }
  const targetUnits = [...targetUnitBySlug.values()].map((found) => found.unit);

  // What that deploy's payload does not carry, and therefore what this report
  // cannot answer. Named, never silently answered as "nothing found".
  const notCompared = [];
  if (!carried(targetBlocks, "summary")) notCompared.push("block summary");
  if (!carried(targetBlocks, "origin")) notCompared.push("block origin");
  if (!carried(targetUnits, "origin")) notCompared.push("lesson origin");
  const comparableBlockFields = BLOCK_FIELDS.filter((field) => carried(targetBlocks, field));

  const seenBlockSlugs = new Set();
  const seenUnitSlugs = new Set();

  for (const local of localBlocks) {
    seenBlockSlugs.add(local.slug);
    const target = targetBlockBySlug.get(local.slug) ?? null;
    const entry = {
      blockSlug: local.slug,
      blockPosition: local.position,
      slug: local.slug,
      title: local.title,
      position: local.position,
    };

    if (target === null) {
      blocks.new.push(entry);
    } else if (target.origin !== undefined && target.origin !== "content") {
      blocks.refused.push({ ...entry, origin: target.origin });
    } else {
      const here = blockValues(local);
      const moved = comparableBlockFields.filter((field) => here[field] !== (target[field] ?? null));
      if (moved.length > 0) blocks.changed.push({ ...entry, fields: moved });
      else blocks.untouched.push(entry);
    }

    for (const unit of local.units ?? []) {
      seenUnitSlugs.add(unit.slug);
      const found = targetUnitBySlug.get(unit.slug) ?? null;
      const unitEntry = {
        blockSlug: local.slug,
        blockPosition: local.position,
        slug: unit.slug,
        title: unit.title,
        position: unit.position,
      };

      if (found === null) {
        units.new.push(unitEntry);
      } else if (found.unit.origin !== undefined && found.unit.origin !== "content") {
        units.refused.push({ ...unitEntry, origin: found.unit.origin });
      } else if (found.unit.fingerprint === unitFingerprint(localUnitRow(unit))) {
        units.untouched.push(unitEntry);
      } else {
        units.changed.push(unitEntry);
      }
    }
  }

  // ── The other direction ───────────────────────────────────────────────────
  // Present there, absent here. Never a deletion — see the command's own output.
  for (const block of targetBlocks) {
    if (!seenBlockSlugs.has(block.slug)) {
      blocks.targetOnly.push({
        blockSlug: block.slug,
        blockPosition: block.position,
        slug: block.slug,
        title: block.title,
        origin: block.origin ?? null,
        position: block.position,
      });
    }
    for (const unit of block.units ?? []) {
      if (seenUnitSlugs.has(unit.slug)) continue;
      units.targetOnly.push({
        blockSlug: block.slug,
        blockPosition: block.position,
        slug: unit.slug,
        title: unit.title,
        origin: unit.origin ?? null,
        position: unit.position,
      });
    }
  }

  for (const lists of [blocks, units]) {
    for (const name of Object.keys(lists)) lists[name] = shed(lists[name]);
  }

  // ⚠️ Gated on a comparison having HAPPENED, not on the field being absent.
  // `changed` + `untouched` is exactly the set of lessons whose fingerprint was
  // put next to another one; a target holding a course this repo shares no slug
  // with compares no digests at all, and announcing a version disagreement there
  // would be a warning about nothing. Zero comparisons, zero sentences.
  const compared = units.changed.length + units.untouched.length;
  const theirVersion = outlineData?.fingerprintVersion ?? null;
  const fingerprintMismatch =
    compared > 0 && theirVersion !== FINGERPRINT_VERSION
      ? { here: FINGERPRINT_VERSION, there: theirVersion }
      : null;

  return { blocks, units, notCompared, fingerprintMismatch };
}

/**
 * @typedef {object} SubjectSide
 * @property {string} blockSlug  the block this row sits in (its own slug, for a block)
 * @property {string} slug
 * @property {string} title
 * @property {string | null} [origin]  only on the TARGET side — `null` means that app did not send it
 */

/**
 * @typedef {object} SubjectPair
 * @property {"block" | "lesson"} kind
 * @property {SubjectSide} local
 * @property {SubjectSide} target
 */

/**
 * One title, reduced to the only thing this app compares titles on.
 *
 * Lower-cased, every run of whitespace collapsed to one space, trimmed. **That
 * is the whole rule**, and the header says why it is not a similarity score.
 *
 * ⚠️ `toLowerCase()` and never `toLocaleLowerCase()`: the locale-aware one folds
 * a Turkish dotless `ı` differently depending on the machine's locale, and a
 * matcher whose answer moves with the machine is one that pairs on a laptop and
 * does not pair in CI (NFR-56 — the same answer on all three systems).
 *
 * Deliberately NOT done, each a decision rather than an omission:
 *
 *   * **no `normalize("NFC")`.** There is exactly one in this whole template
 *     (`lib/credentials/hash.mjs`, for passwords); adding a second is a new
 *     decision, not an existing convention.
 *   * **no reuse of `normalise()` from `./fingerprint.mjs`.** That one is line
 *     endings only, for hashing — folding case there would silently move every
 *     fingerprint in every environment.
 */
const subjectKey = (title) =>
  String(title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Are these two titles **the same subject**?
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameSubject(a, b) {
  const key = subjectKey(a);
  // A title nobody wrote is not a subject. Two blank titles are two unknowns,
  // and pairing them would ask a question about nothing — the expensive
  // direction of the asymmetry in the header.
  if (key === "") return false;
  return key === subjectKey(b);
}

/**
 * The same subject, sitting under a different slug on each side.
 *
 * Pure, like `compareCourse()` — and it ASKS `compareCourse()` rather than
 * re-deriving what "new" and "only there" mean, so there is one definition of
 * each rather than two that agree today.
 *
 * A pair exists when **all** of these hold:
 *
 *   1. the local slug is **not** in the target — it is in `new`. An exact-slug
 *      match is the operator already having said *"this one"*, and pairing a
 *      slug with itself would ask a question that has been answered and train
 *      its reader to click through;
 *   2. the target slug is **not** in the local tree — it is in `targetOnly`.
 *      Pairing against a row this repo already owns under another slug is noise;
 *   3. the two titles are the same subject by `sameSubject()`.
 *
 * A **lesson** pair carries one more condition: the two lessons must sit in
 * blocks that are themselves a pair, or in the same block. Two lessons called
 * *"Einleitung"* in two unrelated blocks are not a collision — they are how
 * courses are written.
 *
 * 🚨 One local entry may legitimately pair with two target entries (two rows
 * over there titled the same under different slugs). Both are reported; picking
 * one here would be this function deciding, which is exactly what it must not
 * do.
 *
 * @param {Parameters<typeof compareCourse>[0]} localBlocks
 * @param {Parameters<typeof compareCourse>[1]} outlineData
 * @returns {SubjectPair[]}
 */
export function sameSubjectPairs(localBlocks, outlineData) {
  const { blocks, units } = compareCourse(localBlocks, outlineData);

  /** Only the target side ever carries `origin` — it is the target's property. */
  const side = (entry) => ({
    blockSlug: entry.blockSlug,
    slug: entry.slug,
    title: entry.title,
    ...(entry.origin === undefined ? {} : { origin: entry.origin }),
  });

  /** @type {SubjectPair[]} */
  const pairs = [];
  /** Which local block was paired with which target block — the lesson condition. */
  const partnered = new Set();
  // A space cannot occur in a slug (lower-case ASCII, digits, single hyphens),
  // so it separates the two halves unambiguously.
  const partnerKey = (local, target) => `${local} ${target}`;

  for (const local of blocks.new) {
    for (const target of blocks.targetOnly) {
      if (!sameSubject(local.title, target.title)) continue;
      pairs.push({ kind: "block", local: side(local), target: side(target) });
      partnered.add(partnerKey(local.slug, target.slug));
    }
  }

  for (const local of units.new) {
    for (const target of units.targetOnly) {
      if (!sameSubject(local.title, target.title)) continue;
      const sameBlock = local.blockSlug === target.blockSlug;
      if (!sameBlock && !partnered.has(partnerKey(local.blockSlug, target.blockSlug))) continue;
      pairs.push({ kind: "lesson", local: side(local), target: side(target) });
    }
  }

  // Deterministic by construction: `compareCourse()` sorts both lists it reads
  // from, and this walks them in order. A report whose lines move between runs
  // is one nobody can diff.
  return pairs;
}

/**
 * How many rows each list holds — the one line a reader counts from.
 *
 * @param {{ blocks: DiffLists, units: DiffLists }} report
 */
export function diffCounts(report) {
  const of = (lists) => ({
    new: lists.new.length,
    changed: lists.changed.length,
    untouched: lists.untouched.length,
    targetOnly: lists.targetOnly.length,
    refused: lists.refused.length,
  });
  return { blocks: of(report.blocks), units: of(report.units) };
}
