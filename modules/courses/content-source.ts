// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the in-app assistant may read out of this course, and for whom.
//
// Declared in `module.json` as `"contentSource": "content-source.ts"`, folded
// into `lib/modules/content-source-registry.ts` by `node run.mjs module sync`,
// and read by `lib/content-source/sources.ts` — so the core never names this
// module. The contract lives in the CORE (`lib/content-source/types.ts`) and
// the generated file is typed against it, which is what makes a default export
// that does not keep it a `npm run typecheck` failure naming this file rather
// than a customer's first question.
//
// Three things nobody should have to re-derive:
//
//  1. 🚨 **The COURSE gate is ONE function**, `courseAccessFor()` in
//     `./lib/access.ts`, and the lesson page calls the same one. Never a second
//     `hasPlan()` for the question "may they into the course".
//     A source more permissive than its page turns the assistant into an
//     existence oracle: it names "Lektion 7: Der Verkaufsabschluss" to somebody
//     who has not bought it and hands them a link that bounces. Two `hasPlan()`
//     calls that agree today are two that can drift, and no test in this
//     template could see the drift — which is why there is only one call.
//     `content-source.test.ts` scans this whole module for a second one.
//     ⚠️ The MEDIA question is a different one and has its own answer:
//     `mayAccess()` (`lib/media/manage.ts`) does reach `hasPlan()` per row, in
//     the core and outside that scanner. Legitimate — "may they see the course"
//     and "may they have this file" are two questions — but the sentence
//     "never a second `hasPlan()` here" would otherwise read as more than it is.
//  2. 🚨 **This source answers as a BUYER, whoever asks — and that is enforced
//     here.** `asBuyer()` below is the one place `viewer.role` is dropped, and
//     both consumers take its result: the gate and `mayAccess()` per media row.
//     It used to be an invariant of the CALLER — `lib/ai/tools.ts` →
//     `viewerFor()` passes `role: null` — and this header stated it as a fact.
//     One line in another layer is not an invariant. A second caller carrying a
//     real role (the mobile companion over `coreExport`, an MCP endpoint, an
//     operator assistant) would have opened two doors at once:
//     `operatorPreviewsUnlocked` is on by default, so an owner gets a clock at
//     the beginning of time and every locked lesson of a drip course travels
//     into a transcript with its full `body`; and `mayAccess()` short-circuits
//     on `role === "owner"`, so every `entitled` medium in the whole app goes
//     with it. The consequence is unchanged and now mechanical: the operator
//     preview belongs to the PAGE. An operator asking the assistant is answered
//     as a buyer would be, and if they hold no grant they are answered with
//     nothing. `content-source.test.ts` refuses the string `viewer.role`
//     anywhere in this file's code.
//  3. **The lesson text goes to the AI provider**, because that is what
//     answering out of it means. It is unproblematic for exactly one reason,
//     and the reason is worth keeping: a lesson is the SAME for every member
//     (`docs/content-source.md` → *Visibility*). Submissions, replies and
//     completions are the member's own writing, and this source does not touch
//     those tables at all — it reads `courses_blocks` and `courses_units`,
//     nothing else. Whoever adds a fourth table here re-opens that question.
//
// NOT in `coreExport`: this file reads the database, and every file in the
// export cut is held pure by `scripts/core/purity.test.ts`. It belongs beside
// `presence/check.ts` and `setup/tools.ts`, not beside `rules.ts`.
import { mediaAnchor, slugifyAnchor } from "@/lib/content-source/anchors";
import { rankRecords, searchTerms, snippetFor } from "@/lib/content-source/rules";
import type {
  ContentDocument,
  ContentHit,
  ContentSource,
  ContentTocEntry,
  ContentViewer,
} from "@/lib/content-source/types";
import type { MediaRow } from "@/db/schema-media";
import { mayAccess } from "@/lib/media/manage";

import { courseAccessFor, type CourseAccess } from "./lib/access";
import { isCourseEnabled } from "./lib/config";
import { usableCourses, type Course } from "./lib/courses";
import { blockById, courseOutline, searchUnits, unitBySlug, unitsWithMedia } from "./lib/manage";
import { mediaRowsFor } from "./lib/media";
import { isUnlocked, unlockedAt } from "./rules";

/** The source id carries the module's name, like its error codes and commands. */
export const COURSES_SOURCE_ID = "courses";

/**
 * How many rows ILIKE may hand the ranking.
 *
 * The narrowing is the database's, the ORDER is the shared pure arithmetic —
 * so this is a ceiling on the candidates, not on the answer.
 */
const CANDIDATE_LIMIT = 200;

/**
 * The ONE place a lesson's path is composed.
 *
 * `/dashboard/course/<course>/<slug>` is a real route
 * (`app/dashboard/course/[course]/[unit]/page.courses.tsx`), and both slugs are
 * spellable
 * as a url because `slugProblem()` in `../rules.ts` refuses anything that is
 * not lower-case ASCII — which it does for exactly this reason. A second
 * helper beside this one is the two-arithmetics failure; there is not to be one.
 */
function unitUrl(courseSlug: string, slug: string): string {
  return `/dashboard/course/${courseSlug}/${slug}`;
}

/**
 * The check order, once, for all four methods — the same order the lesson page
 * keeps (`pages/unit/page.tsx`): off, then who is asking, then the gate, and
 * only then a data function.
 *
 * `null` means "answer empty", and every caller turns it into `[]` or `null`
 * without asking why — the three reasons are deliberately indistinguishable
 * from the outside.
 *
 *  - **Off is not absent.** `config/course.json` ships `enabled: false`, and
 *    the window between `module add courses` on day one and the content being
 *    written on day twenty is the NORMAL state, not an incident. A source that
 *    only fell silent when the module was missing would, in exactly that
 *    window, quote a course that does not exist for members.
 *    `isCourseEnabled()` and never `isCourseSwitchedOn()`: the latter is true
 *    in the broken state, where `courseShape()` throws.
 *  - **An anonymous viewer is refused before the gate is asked.**
 *    `ContentViewer.memberId` is `string | null`, `courseAccessFor()` wants a
 *    `string`. Without this line the anonymous case would be a type error or,
 *    worse, a `hasPlan(null)`.
 *  - **Not entitled means NO HIT, not a hit without a link.** The title
 *    "Lektion 7: Der Verkaufsabschluss" in her answer is already the
 *    disclosure.
 *
 * ⚠️ It does not throw of its own accord. `hasPlan()` and `planStartedAt()`
 * behind the gate can, on a driver error or a product key that left the
 * registry, and `guarded()` in `lib/content-source/query.ts` catches that —
 * with the error line per question this comment is about. What the code here
 * must not do is LEAN on the catcher; a broken config is answered with `null`
 * rather than a throw, which is why `isCourseEnabled()` comes before
 * `courseShape()`.
 */
async function courseAccessForViewer(
  viewer: ContentViewer,
): Promise<{ course: Course; access: CourseAccess }[]> {
  if (!isCourseEnabled()) return [];
  if (viewer.memberId === null) return [];
  const memberId = viewer.memberId;

  // 🚨 **Every course this member is in, and only those.** An app may hold
  // several, each sold on its own — a source that answered for "the" course
  // would either serve one member material from a product they did not buy or
  // hide one they did. Both are silent: the assistant simply says a different
  // thing than the pages do.
  //
  // 🚨 `null`, never the caller's role — header point 2. The operator preview
  // belongs to the PAGE, and this source cannot be talked into granting one.
  const courses = await usableCourses();
  const held = await Promise.all(
    courses.map(async (course) => ({
      course,
      access: await courseAccessFor(memberId, null, course),
    })),
  );
  return held.filter((row) => row.access.entitled);
}

/**
 * The viewer this source hands on — the caller's member, never their role.
 *
 * 🚨 The ONE place the role is dropped, and header point 2 is the reasoning.
 * `mayAccess()` takes its result for the same reason the gate does: its
 * `entitled` branch short-circuits on `role === "owner"`, which would hand an
 * operator every paid file in the app through a chat transcript.
 */
function asBuyer(viewer: ContentViewer): ContentViewer {
  return { memberId: viewer.memberId, role: null };
}

/** A unit's four slots, in the order the page lays them out. */
type SlotName = "cover" | "video" | "subtitle" | "worksheet";

interface UnitSlots {
  coverMediaId: string | null;
  videoMediaId: string | null;
  subtitleMediaId: string | null;
  worksheetMediaId: string | null;
}

function slotsOf(unit: UnitSlots): { slot: SlotName; id: string }[] {
  const slots: { slot: SlotName; id: string | null }[] = [
    { slot: "video", id: unit.videoMediaId },
    { slot: "cover", id: unit.coverMediaId },
    { slot: "worksheet", id: unit.worksheetMediaId },
    { slot: "subtitle", id: unit.subtitleMediaId },
  ];
  return slots.filter((entry): entry is { slot: SlotName; id: string } => entry.id !== null);
}

/**
 * The slots `findMedia()` may answer with — everything except the subtitle.
 *
 * A `.vtt` is a `<track>` inside the player: the page renders no element for
 * it, so `pageAnchorFor()` answers `null` and the "hit" would be a file the
 * member can neither see nor fetch. `get()` still lists it, because there it is
 * part of what the lesson IS rather than a search result standing on its own.
 */
function findableSlotsOf(unit: UnitSlots): { slot: SlotName; id: string }[] {
  return slotsOf(unit).filter((entry) => entry.slot !== "subtitle");
}

/**
 * The fragment the LESSON PAGE really renders for this slot — or `null`.
 *
 * 🚨 Only the elements `pages/unit/page.tsx` gives an `id` to, and not one
 * more. An anchor for something the page does not render scrolls nowhere,
 * which `docs/content-source.md` calls worse than no anchor at all.
 *
 *  - the video sits in `<figure id={mediaAnchor(path)} className="scroll-mt-20">`
 *  - so does the worksheet card
 *  - a COVER is the video's `poster` while there is a video, and gets an
 *    element of its own only when there is none — the page has no id on that
 *    branch, so the honest answer here is `null` either way
 *  - a SUBTITLE is a `<track>` inside the player and has no element at all
 */
function pageAnchorFor(slot: SlotName, path: string): string | null {
  return slot === "video" || slot === "worksheet" ? mediaAnchor(path) : null;
}

/**
 * What a medium is CALLED in an answer — never its storage key if we can help it.
 *
 * `||` rather than `??`: an `alt` saved as an empty string is a field somebody
 * left blank, and `??` would take it, giving the model a hit with no name at
 * all. Trimmed for the same reason.
 */
function mediaTitle(row: MediaRow, unitTitle: string): string {
  return row.alt?.trim() || row.filename?.trim() || unitTitle;
}

/**
 * When a locked block opens, as a line the MODEL reads.
 *
 * ISO, not a formatted date: `list()` output travels into a prompt, and a
 * locale-formatted date there would be one more thing that reads differently on
 * two machines. The member's own answer is in their language because the model
 * answers in their language.
 *
 * ⚠️ **The zone is named, and it is not decoration.** `toISOString()` renders
 * in UTC and `startedAt` is a `min(created_at)` out of a zoneless column, so for
 * a member in CEST whose grant was written at 23:30 local it names the day
 * before. Saying `(UTC)` is what stops the model from presenting a shifted date
 * as a local one. The course overview renders the same date since 2026-08-17 —
 * `pages/course-page.tsx` → `opensSentence()`, which pins `timeZone: "UTC"` on
 * the formatter for exactly this reason and takes the same three states this
 * function does.
 */
function lockedNote(opensAt: Date | null, startedAt: Date | null): string {
  if (startedAt === null) {
    // `unlockedAt()` answers "never" for a viewer with no ACTIVE grant.
    // Defensive rather than routine since this source stopped passing a role:
    // `courseAccessFor()` only answers `entitled: true, startedAt: null` for an
    // operator preview that is switched OFF, and no role reaches it from here
    // (header point 2). What is left is the window between `hasPlan()` and
    // `planStartedAt()` — a grant suspended between the two queries — and the
    // honest line for it is the one the page gives a paused member.
    return "not open — this member's access is paused, so no block has a clock";
  }
  // An absurd `releaseAfterDays` (an unbounded `int4`, and the admin input
  // carries no `max`) pushes the sum past the representable range, and
  // `toISOString()` THROWS on such a date. The block is locked either way —
  // `isUnlocked()` decides that, once, above — so the only open question is
  // what to call the day, and "no date" beats an error line per question.
  if (opensAt === null || !Number.isFinite(opensAt.getTime())) {
    return "not open yet — and this app cannot name the day it opens";
  }
  return `not open yet — unlocks on ${opensAt.toISOString().slice(0, 10)} (UTC)`;
}

const coursesContentSource: ContentSource = {
  id: COURSES_SOURCE_ID,
  // Model-facing, and English on purpose: no member ever sees it. It travels
  // inside the prompt (`lib/ai/tools.ts` hands it to the model in the
  // `content_list` result), which is why it is not in messages/*.json.
  label: "this app's course — its blocks and the lessons the member has unlocked",

  async search(query, viewer, limit): Promise<ContentHit[]> {
    const held = await courseAccessForViewer(viewer);
    if (held.length === 0) return [];

    const terms = searchTerms(query);
    if (terms.length === 0) return [];

    const byId = new Map(held.map((row) => [row.course.id, row]));
    const now = new Date();
    const candidates = await searchUnits(terms, CANDIDATE_LIMIT, [...byId.keys()]);

    // 🚨 Locked lessons are dropped BEFORE the ranking, not filtered out of the
    // result: a drip course sells the pacing, and an answer on day three that
    // quotes week two gives away what was sold as timed. `list()` is the one
    // method allowed to name them, and it names them as locked.
    // The unlock decision is per course: its own shape, and this member's own
    // clock in it.
    const open = candidates.filter((row) => {
      const found = byId.get(row.courseId);
      return (
        found !== undefined &&
        isUnlocked(row.releaseAfterDays, found.access.startedAt, found.course.shape!, now)
      );
    });
    const byRef = new Map(open.map((row) => [row.slug, row]));

    return rankRecords(
      open.map((row) => ({ ref: row.slug, title: row.title, body: row.body ?? "" })),
      query,
      limit,
    ).map((record) => {
      const row = byRef.get(record.ref);
      // The hit already knows its course — `searchUnits()` carries `courseId`
      // precisely so the url can be composed without a second lookup per row.
      const courseSlug = row ? (byId.get(row.courseId)?.course.slug ?? "") : "";
      return {
        sourceId: COURSES_SOURCE_ID,
        ref: record.ref,
        kind: "page" as const,
        title: record.title,
        snippet: snippetFor(record.body, terms),
        url: unitUrl(courseSlug, record.ref),
        // The text card the page renders carries `id={slugifyAnchor(slug)}` —
        // and only when there IS a text. A lesson that is a video and nothing
        // else has no element with that id, so it gets no fragment.
        anchor: row?.body ? slugifyAnchor(record.ref) : null,
      };
    });
  },

  async get(ref, viewer): Promise<ContentDocument | null> {
    const held = await courseAccessForViewer(viewer);
    if (held.length === 0) return null;

    const unit = await unitBySlug(ref);
    if (!unit) return null;
    const block = await blockById(unit.blockId);
    // A unit whose block vanished cannot be placed, exactly as on the page.
    if (!block) return null;
    // 🚨 The lesson's OWN course, and `null` when the asker is not in it. Unit
    // slugs are unique app-wide, so without this line a member of the cheap
    // course could name a lesson of the expensive one and be handed it — the
    // source-side twin of the check `pages/unit/page.tsx` makes on the URL.
    const found = held.find((row) => row.course.id === block.courseId);
    if (!found) return null;
    // `null` for "no such lesson", "not entitled" and "not open yet" ALIKE —
    // `lib/content-source/types.ts` makes that indistinguishability the
    // contract, because anything else is an existence oracle.
    if (
      !isUnlocked(block.releaseAfterDays, found.access.startedAt, found.course.shape!, new Date())
    ) {
      return null;
    }

    const rows = await mediaRowsFor([
      unit.coverMediaId,
      unit.videoMediaId,
      unit.subtitleMediaId,
      unit.worksheetMediaId,
    ]);
    const media: ContentDocument["media"] = [];
    for (const { slot, id } of slotsOf(unit)) {
      const row = rows.get(id);
      if (!row) continue;
      // Per row, refusal by skipping — the same thing `./lib/media.ts` does
      // inside the page. 🚨 And no `mediaUrlFor()` anywhere near it: a signed
      // address expires and bypasses this very check.
      if (!(await mayAccess(row, viewer))) continue;
      media.push({
        path: row.storageKey,
        kind: row.kind,
        alt: row.alt,
        anchor: pageAnchorFor(slot, row.storageKey),
      });
    }

    const body = unit.body ?? "";
    return {
      sourceId: COURSES_SOURCE_ID,
      ref: unit.slug,
      title: unit.title,
      url: unitUrl(found.course.slug, unit.slug),
      body,
      // The addressable headings the page really renders — which is the ONE
      // text card, under the unit's own slug. A lesson body is paragraphs, not
      // Markdown headings (`pages/unit/page.tsx` splits on blank lines), so
      // `headingSections()` would invent targets nothing carries.
      sections: body ? [{ anchor: slugifyAnchor(unit.slug), title: unit.title }] : [],
      media,
    };
  },

  async list(viewer): Promise<ContentTocEntry[]> {
    const held = await courseAccessForViewer(viewer);
    if (held.length === 0) return [];

    const now = new Date();
    const entries: ContentTocEntry[] = [];

    for (const { course, access } of held) {
      const shape = course.shape!;
      const blocks = await courseOutline(course.id);
      for (const block of blocks) {
      const opensAt = unlockedAt(block.releaseAfterDays, access.startedAt, shape);
      const locked = opensAt !== null && opensAt.getTime() > now.getTime();
      const where = block.summary ? `${block.title} — ${block.summary}` : block.title;

      for (const unit of block.units) {
        // 🚨 **A locked lesson MAY appear here, and only here.** That is the
        // product's own promise: the overview page shows the whole course with
        // the weeks that are still shut, so an assistant that hid them would
        // describe a smaller course than the one the member is looking at. What
        // it must not do is hand over the CONTENT — `search()` and `get()`
        // refuse it — or a link that bounces, so a locked entry carries the
        // opening date instead of a url.
        entries.push({
          sourceId: COURSES_SOURCE_ID,
          ref: unit.slug,
          title: unit.title,
          summary: locked ? lockedNote(opensAt, access.startedAt) : where,
          // The course's own summary leads, so a member in two courses can
          // tell which is which from the entry alone.
          url: locked ? null : unitUrl(course.slug, unit.slug),
        });
      }
      }
    }

    return entries;
  },

  /**
   * 🚨 **The check order here is this file's usual one, and inside it the CHEAP
   * questions come first.** Three filters stand between a question and an
   * answer, and they cost wildly different amounts:
   *
   *  1. the drip (free, in memory) — a locked lesson is out before anything else
   *  2. the text filter (free, in memory) — title, `alt`, filename
   *  3. `mayAccess()` — a `grants` query per row, awaited in sequence
   *
   * They used to run 1, 3, 2. Measured on a twelve-week course — 12 blocks × 5
   * lessons × 3 media — that was **180 awaited entitlement queries for ONE
   * question to the assistant**, where 3 answer it; the test carries both
   * numbers and fails on the order rather than on a duration. Nothing about the
   * ANSWER moved: a medium still comes out only when `mayAccess()` allowed it
   * for THIS viewer, and the rows that are no longer asked about are exactly the
   * ones that were never going to be hits.
   *
   * ⚠️ So the order of 2 and 3 is not cosmetic and may not be "tidied" back:
   * asking first is the same answer at sixty times the cost.
   */
  async findMedia(query, viewer, limit): Promise<ContentHit[]> {
    const held = await courseAccessForViewer(viewer);
    if (held.length === 0) return [];
    const byId = new Map(held.map((row) => [row.course.id, row]));

    const terms = searchTerms(query);
    const now = new Date();
    // Not `courseOutline()`: that is a `select()` of every column of every unit,
    // so it carries the whole course's lesson TEXTS — which this method never
    // reads. `unitsWithMedia()` brings the slots and the release day.
    const units = await unitsWithMedia([...byId.keys()]);

    // Locked lessons are out here for the same reason they are out of
    // `search()`: a medium hit links the LESSON page, and that page redirects a
    // member who is early. A link that bounces is the one outcome worse than no
    // link.
    // Per course: its own shape, and this member's own clock in it.
    const open = units.filter((unit) => {
      const found = byId.get(unit.courseId);
      return (
        found !== undefined &&
        isUnlocked(unit.releaseAfterDays, found.access.startedAt, found.course.shape!, now)
      );
    });

    // 🚨 `findableSlotsOf()`, never `slotsOf()` — the page renders no element
    // for a subtitle, so a hit on one is a file the member can neither see nor
    // fetch. Its row has no business in the batch either.
    const rows = await mediaRowsFor(
      open.flatMap((unit) => findableSlotsOf(unit).map((entry) => entry.id)),
    );

    const hits: ContentHit[] = [];
    for (const unit of open) {
      for (const { slot, id } of findableSlotsOf(unit)) {
        const row = rows.get(id);
        if (!row) continue;

        // No query lists what there is; a query matches the medium's own words
        // or the lesson it sits in. The storage key is deliberately NOT part of
        // the haystack: it is plumbing, and matching on it would answer
        // questions about file names.
        const haystack = `${row.alt ?? ""} ${row.filename ?? ""} ${unit.title}`.toLowerCase();
        if (terms.length > 0 && !terms.some((term) => haystack.includes(term))) continue;

        // 🚨 And only now the expensive one — per row, refusal by skipping, the
        // same thing `get()` does.
        if (!(await mayAccess(row, viewer))) continue;

        hits.push({
          sourceId: COURSES_SOURCE_ID,
          ref: unit.slug,
          kind: "media",
          title: mediaTitle(row, unit.title),
          snippet: `${row.kind} in "${unit.title}"`,
          // 🚨 The PAGE that shows it, never `mediaUrlFor(row)`. A signed URL
          // expires under the model's feet and bypasses `mayAccess()` — that is
          // how a paid file becomes a public one.
          url: unitUrl(byId.get(unit.courseId)?.course.slug ?? "", unit.slug),
          anchor: pageAnchorFor(slot, row.storageKey),
          media: { path: row.storageKey, kind: row.kind, alt: row.alt },
        });
        if (hits.length >= limit) return hits;
      }
    }

    return hits;
  },
};

export default coursesContentSource;
