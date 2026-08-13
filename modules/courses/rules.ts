// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's arithmetic — pure, and the reason this module is worth having.
//
// Nothing here touches a database, a request or a config file. That is what
// makes it testable one case at a time, and it is why `coreExport` carries this
// file: a mobile companion computes the same answers from the same rules rather
// than a second implementation that agrees today.
//
// 🚨 **The unlock rule is compare-on-read, and it needs no scheduler.**
// `docs/courses.md` is emphatic about it: a job that "opens" a week is how a
// simple product acquires a cron, and the comparison below is what
// `grants.accessUntil` already does from the other direction. A scheduled job
// belongs here only if the vendor wants a MESSAGE sent when a week opens.

import { COURSE_SHAPES as SHAPES } from "./shapes.mjs";

/**
 * The three products `docs/courses.md` names — each COURSE chooses one, and the
 * choice is a column on `courses_courses` rather than a line in a config file:
 * an app with a self-study primer and an accompanied workshop needs both
 * answers at once.
 *
 * ⚠️ **Re-exported, not restated.** The list itself is `../shapes.mjs`, because
 * the applier is bare Node and cannot import this file. Writing it out here
 * again is how the two stopped agreeing before that file existed.
 */
export type CourseShape = "self-study" | "drip" | "workshop";

export const COURSE_SHAPES: readonly CourseShape[] = SHAPES as readonly CourseShape[];

/**
 * Who owns a block or lesson row — the discriminator that lets two lawful
 * writers exist without either overwriting the other (spine AD-82).
 *
 * `content` is the applier's: the row came from `content/course/*.json` and
 * every `content-apply` re-asserts it. `operator` is the admin surface's: the
 * row was made in ONE environment, travels with no deploy, and no applier ever
 * touches it.
 *
 * The column lives on `courses_blocks` and `courses_units`; the applier's half
 * of the rule is SQL (`modules/courses/content/appliers/course.mjs`), because
 * that file is bare Node and cannot import this one — `lib/content/writers.test.ts`
 * is what holds the two halves together mechanically.
 */
export type CourseRowOrigin = "content" | "operator";

export const COURSE_ROW_ORIGINS: readonly CourseRowOrigin[] = ["content", "operator"];

/**
 * May the operator's own surface write this row?
 *
 * ⚠️ The parameter is `string` on purpose. The value arrives from a `text`
 * column, so the one dangerous case is a value nobody planned for — a signature
 * of `CourseRowOrigin` would turn that into a compile error at the call site
 * that happens to be typed and make the run-time check look redundant, which is
 * how it would eventually be deleted. Anything that is not literally
 * `"operator"` answers `false`: an unknown origin is somebody else's row.
 */
export function mayOperatorWrite(origin: string): boolean {
  return origin === "operator";
}

/**
 * Every reason the course refuses something. Each code MUST have a text in
 * `messages/*.json` under `errors` — `i18n/messages.test.ts` reads this union
 * through the manifest and enforces it in both languages.
 *
 * 🚨 **The module's name is part of every code, and it is not decoration.**
 * `errors` is a SHARED namespace: `i18n/request.ts` merges a module's texts
 * into the core's rather than replacing it, precisely so a module can add
 * refusals — which means an unprefixed code is a claim on a key the core may
 * already hold. This list said `notFound` once, and the core holds that key:
 * giving it a course sentence would have answered every core "not found" in
 * every app that installs this module. The way out of a collision is renaming
 * the code, never writing the missing text.
 */
export const COURSES_ERROR_CODES = [
  "coursesNotFound",
  // The course a form named does not exist. Operator-only, and separate from
  // `coursesNotFound` on purpose: "no such lesson" and "no such course" send
  // somebody to different files, and one message covering both is one nobody
  // can act on.
  "coursesCourseNotFound",
  "coursesLocked",
  "coursesShapeForbidsSubmission",
  "coursesSubmissionTooLong",
  "coursesSubmissionEmpty",
  "coursesAlreadyReplied",
  // The two refusals the origin column makes possible. Both are the operator's
  // surface saying no — a member never meets either.
  "coursesContentRowLocked",
  "coursesSlugClaimedByContent",
  // The four the authoring surface adds. Also operator-only: a member has no
  // surface that could produce any of them.
  "coursesSlugTaken",
  "coursesSlugMalformed",
  // The operator's own text, which had no ceiling until 2026-08-13 while the
  // member's hand-in on the same lesson always had one.
  "coursesUnitTextTooLong",
  "coursesPositionTaken",
  "coursesBlockNotEmpty",
  // The two the media slots add. `coursesUploadTooLarge` carries the number AND
  // the way past it, because "too large" with no route onward is a dead end on
  // the one file an operator most wants to attach.
  "coursesUploadTooLarge",
  "coursesSlotNotAttachable",
  // The third, and it belongs to the direct path alone: a ticket that was
  // minted somewhere else. `POST /api/media/upload-url` pins
  // `visibility: "owner"`, and a ticket carries the two fields with it — so
  // confirming one of those at the video slot would fill a lesson's video
  // column with a row only the operator may fetch. Its own sentence rather
  // than `coursesSlotNotAttachable`, because that one talks about file types
  // and would send somebody looking for a codec problem.
  "coursesUploadTicketMismatch",
  // The two the reply surface adds. Operator-only, and unlike the hand-in's
  // pair they have NO member-side counterpart: a member never writes a reply,
  // and the surface these come from is behind `requireOwner()`.
  "coursesReplyEmpty",
  "coursesReplyTooLong",
] as const;

export type CoursesErrorCode = (typeof COURSES_ERROR_CODES)[number];

export class CoursesError extends Error {
  /**
   * @param code what a member-facing surface translates
   * @param detail a sentence for a DEVELOPER — the setup tools and the applier
   *   speak to an agent, and "coursesNotFound" alone would send it looking. It never
   *   reaches a member's screen: the pages translate `code` and ignore this.
   */
  constructor(
    public readonly code: CoursesErrorCode,
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "CoursesError";
  }
}

/**
 * What an operator may write into ONE lesson. A ceiling, not a target.
 *
 * ⚠️ There was none until 2026-08-13: `courses_units.body` is an unbounded
 * `text` and the admin form only trimmed. A body is turned into React elements
 * on EVERY request — a pasted book is thousands of nodes in every RSC payload,
 * for every learner, for ever. The hand-in on the other side of the same lesson
 * has had a ceiling since it was built; the operator's own text had none, which
 * is the wrong way round for the one that is served more often.
 *
 * Generous on purpose: a long lesson is a legitimate lesson, and this refuses a
 * paste, not a chapter.
 */


/** What a member may hand in at once. A ceiling, not a target. */
export const MAX_SUBMISSION_CHARS = 20_000;

/**
 * What the operator may write back at once. A ceiling, not a target.
 *
 * ⚠️ **Two decisions that happen to carry the same number today, not one
 * constant used twice.** They answer different questions — how much a learner
 * may hand in, and how much a coach may write back — and they are moved by
 * different arguments: a workshop whose lessons ask for essays raises the
 * first, a coach who answers in three sentences never touches the second.
 * Folding them into one would make either change silently move the other.
 */
export const MAX_REPLY_CHARS = 20_000;

/**
 * The slug grammar — a unit's route segment AND its Subject Key.
 *
 * Lower case, digits, single hyphens. ⚠️ ASCII only, deliberately: the slug
 * becomes a url, and `lib/content-source/anchors.ts` refuses a non-ASCII one, so
 * `knoten-fuer-anfaenger` is legal and `knoten-für-anfänger` is not. Refusing it
 * HERE means the applier says so about a content file, which is a sentence
 * somebody can act on, rather than a page that scrolls nowhere.
 */
/**
 * Why this lesson's own text will not do, or `null`.
 *
 * One function for BOTH writers — the admin form and the content applier — for
 * the reason `slug.mjs` states about the slug: a ceiling one of them enforces is
 * a ceiling the other walks straight past.
 */
export function unitTextProblem(input: {
  title: string;
  body?: string | null;
}): CoursesErrorCode | null {
  if (input.title.length > MAX_UNIT_TITLE_CHARS) return "coursesUnitTextTooLong";
  if ((input.body?.length ?? 0) > MAX_UNIT_BODY_CHARS) return "coursesUnitTextTooLong";
  return null;
}

// ⚠️ Re-exported from `./slug.mjs`, not declared here: the content applier is a
// `.mjs` and cannot import this file, and the docstring above used to claim it
// enforced this rule when it did not. See that file's head.
export { MAX_UNIT_BODY_CHARS, MAX_UNIT_TITLE_CHARS, slugProblem } from "./slug.mjs";
import { MAX_UNIT_BODY_CHARS, MAX_UNIT_TITLE_CHARS, slugProblem } from "./slug.mjs";

/**
 * What the operator's surface knows about a slug before it writes one.
 *
 * Two booleans rather than two lookups, because this file is `coreExport`'s and
 * therefore never touches a database or a disk. `claimedByContent` is answered
 * by reading `content/course/*.json`, `takenByRow` by asking the table.
 */
export interface SlugClaim {
  /** Does a content file name this slug — applied or not? */
  readonly claimedByContent: boolean;
  /** Does a row already hold it, whichever side of the partition wrote it? */
  readonly takenByRow: boolean;
}

/**
 * May the operator create something under this slug?
 *
 * 🚨 **The order is the decision.** Malformed first, because a slug that is not
 * a slug is wrong whoever else wanted it; then the FILE, then the row. A file's
 * claim outranks a row's for one measured reason: a file that has never been
 * applied holds no row at all, and that is the normal state between "written"
 * and "`content-apply`" — in a fresh PROD it is the state of EVERY file. Asking
 * the table first would let the operator create `woche-3` today and make
 * tomorrow's `content-apply` refuse the whole run over a slug they were never
 * told about (`content/appliers/course.mjs` → `refuseClaimedSlugs`).
 *
 * The reverse case is why the row is asked at all: a row whose content file has
 * since been deleted still holds its slug, and nothing in the tree says so.
 */
export function slugAvailability(slug: string, claim: SlugClaim): CoursesErrorCode | null {
  if (slugProblem(slug)) return "coursesSlugMalformed";
  if (claim.claimedByContent) return "coursesSlugClaimedByContent";
  if (claim.takenByRow) return "coursesSlugTaken";
  return null;
}

/**
 * Is this position free within its scope?
 *
 * 🚨 **The scope carries BOTH origins**, and that is the whole subtlety. A
 * `content` row is untouchable, but its position is occupied — two rows on
 * position 2 render in an order the database happens to return, which is not an
 * order anybody chose. The database does not hold this: `courses_blocks_position`
 * and `courses_units_block_position` are ordinary indexes, not unique ones
 * (`schema.ts`), deliberately — a unique index would turn the applier against
 * itself the moment two environments are applied to different depths.
 *
 * `taken` is global for blocks (that is how the applier counts) and per block
 * for lessons (that is how `courseOutline()` reads and `nextUnit()` sorts). The
 * row being moved is left out by the caller, so re-saving a row at its own
 * position is not a collision with itself.
 */
export function positionAvailability(
  position: number,
  taken: readonly number[],
): CoursesErrorCode | null {
  return taken.includes(position) ? "coursesPositionTaken" : null;
}

/**
 * May this block be deleted?
 *
 * ⚠️ **`on delete cascade` stays in the schema and is NOT the answer here.** It
 * is the answer to `module remove --drop-data`, which is a decision somebody
 * makes once and in writing. A click that silently takes six lessons with it is
 * a different thing entirely, and the refusal names the count for the same
 * reason `module remove` does: "there are still rows" without a number is a
 * refusal somebody argues with.
 */
export function blockDeletable(unitCount: number): CoursesErrorCode | null {
  return unitCount > 0 ? "coursesBlockNotEmpty" : null;
}

/**
 * May the operator's surface write this row?
 *
 * The refusal half of `mayOperatorWrite()` — same test, expressed as the code a
 * surface shows. It is asked of every write, including a delete and a move: a
 * hidden menu entry is not a permission, and a Server Action is an HTTP
 * endpoint of its own.
 */
export function rowWritable(origin: string): CoursesErrorCode | null {
  return mayOperatorWrite(origin) ? null : "coursesContentRowLocked";
}

// ── A lesson's four media slots ────────────────────────────────────────────

/** The four columns `courses_units` has held since the module's first commit. */
export type CourseSlotId = "cover" | "video" | "subtitle" | "worksheet";

export const COURSE_SLOT_IDS: readonly CourseSlotId[] = [
  "cover",
  "video",
  "subtitle",
  "worksheet",
];

/** What one slot takes. */
export interface CourseSlotRule {
  /** The media KIND, as `lib/media/rules.ts` names them. */
  readonly kind: "image" | "video" | "audio" | "file";
  /** The media TYPES, narrower than the kind wherever the kind holds several. */
  readonly mimeTypes: readonly string[];
}

/**
 * What each slot accepts.
 *
 * 🚨 **`mimeTypes` is not decoration beside `kind`, and the subtitle slot is
 * why.** `text/vtt`, `application/pdf` and `application/zip` are all the same
 * KIND (`file`) in `config/media.json`, so a subtitle door described by its
 * kind alone accepts a PDF and a worksheet door accepts a `.vtt`. The upload
 * pipeline can express both — `onlyKinds` and `onlyMimes` on
 * `acceptUpload()` — and a slot that named only the first would be a door
 * with a label nobody enforces.
 *
 * ⚠️ These are a SUBSET of what `config/media.json` allows, never a widening.
 * A type listed here that the installation does not accept is refused by
 * `refuseUpload()` regardless — this list can only narrow, which is the safe
 * direction for a table kept in two places.
 */
export const COURSE_SLOTS: Readonly<Record<CourseSlotId, CourseSlotRule>> = {
  cover: { kind: "image", mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
  video: { kind: "video", mimeTypes: ["video/mp4", "video/webm"] },
  subtitle: { kind: "file", mimeTypes: ["text/vtt"] },
  worksheet: { kind: "file", mimeTypes: ["application/pdf", "application/zip"] },
};

export function isCourseSlotId(value: string): value is CourseSlotId {
  return (COURSE_SLOT_IDS as readonly string[]).includes(value);
}

/**
 * May this file go into this slot of this row?
 *
 * Everything a media attachment can be refused for that does not need bytes,
 * a database or a configuration file — so the FORM can ask it before it posts
 * and the ACTION can ask it again before it stores. Two askers, one answer;
 * a check written twice is a check that disagrees with itself eventually.
 *
 * 🚨 **The ceiling is handed IN.** It is `slotCeilingBytes(kind.maxBytes)` from
 * `lib/media/rules.ts`, and importing it here would put `@/lib` in the import
 * closure of a file `coreExport` carries — `scripts/core/purity.test.ts` says
 * no, and it is right to: a companion app has no `config/media.json`.
 *
 * The order is the same one `refuseUpload()` keeps, for the same reason. The
 * row's origin first, because a locked row is locked whatever the file is; then
 * the TYPE, because "too large" is a confusing answer to somebody who picked
 * the wrong sort of file; then the size.
 */
export function slotUploadProblem(
  slot: string,
  input: { origin: string; mime: string | null; bytes: number; ceilingBytes: number },
): CoursesErrorCode | null {
  const locked = rowWritable(input.origin);
  if (locked) return locked;

  if (!isCourseSlotId(slot)) return "coursesSlotNotAttachable";
  // ⚠️ **`mime: null` means "nobody has decided yet", and it is what both
  // shipped callers pass.** The type of a file is decided from its BYTES
  // (`agreedMime()`), and neither the browser nor the Server Action has them at
  // this point: `File.type` is whatever the operating system's registry
  // answered, and on Windows a perfectly good `.vtt` arrives as `text/plain` —
  // which the upload pipeline's alias table accepts on purpose. Refusing it
  // here would undo that, so the action hands the SAME list to `acceptUpload()`
  // as `onlyMimes` and lets the bytes answer. The branch below is the rule
  // stated for a caller that really does know the type.
  if (input.mime && !COURSE_SLOTS[slot].mimeTypes.includes(input.mime.trim().toLowerCase())) {
    return "coursesSlotNotAttachable";
  }

  // `> ceiling`, so a file of exactly the ceiling goes through — the number the
  // form shows is what it promises, not one less.
  if (input.bytes > input.ceilingBytes) return "coursesUploadTooLarge";
  return null;
}

// ── What a member may hand in ──────────────────────────────────────────────

/** Everything the hand-in decision needs, and deliberately not the DB row. */
export interface SubmissionAttempt {
  /** The course's shape. Hand-ins exist under `workshop` and nowhere else. */
  readonly shape: CourseShape;
  /**
   * The lesson's prompt. Non-null IS the hand-in surface — the column is shape
   * 3, as `schema.ts` says over it — and null means this lesson has none.
   */
  readonly taskPrompt: string | null;
  /** Has somebody already replied to THIS member's row for THIS lesson? */
  readonly alreadyReplied: boolean;
  /** What the member typed, untrimmed. Trimming is this function's business. */
  readonly body: string;
}

/**
 * May this member hand this text in?
 *
 * The house form of a refusal function here (`slotUploadProblem()` above): a
 * code or `null`, no database, no request, no sentence — `coreExport` carries
 * this file, so a mobile companion asks the same question and gets the same
 * answer rather than a second implementation that agrees today.
 *
 * 🚨 **The order is the decision, and two places in it were chosen rather than
 * fallen into.**
 *
 * `alreadyReplied` sits BEFORE the two text checks. Told "that text is too
 * long", somebody goes away and shortens it — for nothing, because the row is
 * frozen and no length would have got through. A refusal that sends a person to
 * do work that cannot help is worse than a blunt one, so the true reason is
 * given first. (Frozen is a PRODUCT decision, not a technical one: the reply
 * answers a specific text, and a text that changes under its answer makes the
 * answer a lie.)
 *
 * `taskPrompt === null` answers `coursesNotFound` rather than a fifth code, and
 * rather than `coursesShapeForbidsSubmission`. That sentence — "this course
 * does not take hand-ins" — is a claim about the COURSE, and in a workshop where
 * three other lessons do ask for one it is simply untrue; an error sentence that
 * says something false about the product is worse than a terse one. The action
 * does not address a lesson here, it addresses a hand-in SURFACE, and there is
 * none — the same house form with which `lib/manage.ts` answers "no such row"
 * and "not yours" identically, and the same code `setCompletedAction` gives an
 * unknown slug. A fifth code can be added when 6.2 or a field test misses it; it
 * cannot be removed once it has shipped.
 */
export function submissionProblem(attempt: SubmissionAttempt): CoursesErrorCode | null {
  if (attempt.shape !== "workshop") return "coursesShapeForbidsSubmission";
  if (attempt.taskPrompt === null) return "coursesNotFound";
  if (attempt.alreadyReplied) return "coursesAlreadyReplied";

  // Trimmed once, and the caller stores exactly this string — a check on the
  // raw text beside a store of the trimmed one is two different texts wearing
  // one decision. Whitespace alone is empty, not "a body of length 12".
  const text = attempt.body.trim();
  if (text === "") return "coursesSubmissionEmpty";
  // `>`, so exactly `MAX_SUBMISSION_CHARS` goes through: the number the form
  // shows is what it promises, not one less. Same rule as the upload ceiling.
  if (text.length > MAX_SUBMISSION_CHARS) return "coursesSubmissionTooLong";
  return null;
}

// ── What the operator may write back ───────────────────────────────────────

/**
 * May this reply be stored?
 *
 * 🚨 **An empty reply is a REFUSAL, never a quiet undo.** There is no action in
 * this module that sets `replied_at` back to null, and this is the half of that
 * ruling a rule can carry: `replied_at` is the condition the member's own freeze
 * hangs on (`submissionProblem()` above), so a write that emptied the reply
 * while leaving the timestamp would leave a hand-in frozen against an answer
 * nobody can read — and one that cleared both would re-open somebody else's row
 * from the operator's side. Refusing the empty string is how neither happens.
 *
 * Same house form as `submissionProblem()`: a code or `null`, no I/O, no
 * sentence. Trimmed once, and the caller stores exactly this string.
 */
export function replyProblem(reply: string): CoursesErrorCode | null {
  const text = reply.trim();
  if (text === "") return "coursesReplyEmpty";
  // `>`, so exactly `MAX_REPLY_CHARS` goes through — the number the form shows
  // is what it promises, not one less. Same rule as the hand-in's ceiling.
  if (text.length > MAX_REPLY_CHARS) return "coursesReplyTooLong";
  return null;
}

/**
 * Characters that occupy no space. A "name" made only of these renders as
 * nothing, so falling through to the next step is the only answer that keeps
 * "never blank" true — `trim()` alone does not see them.
 */
const INVISIBLE = /[\s\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/gu;

/** The value if it renders as something, else `null`. */
function visible(value: string | null): string | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  return text.replace(INVISIBLE, "") === "" ? null : text;
}

/**
 * What the waiting list calls the person who handed this in.
 *
 * The chain, in order: the name on their account, else their address, else a
 * neutral, stable placeholder.
 *
 * 🚨 **The address is a step here and is deliberately NOT one in the
 * community** (`modules/community/lib/rules.ts` → `displayNameFor()`, which
 * never shows it). The difference is who reads: there, members see each other,
 * and an address beside somebody's words is a disclosure to a peer. Here the
 * only reader is `requireOwner()` — the one account that reads the same address
 * on `/dashboard/admin/users` anyway — and leaving it out would not be data
 * minimisation but an unusable surface: the template's default sign-up is a
 * magic link, which sets NO name, so the nameless case is the NORMAL one and a
 * queue of "Member a1b2c3d4e5f6" is a queue nobody can work.
 *
 * It appears as a FALLBACK only, never beside a name that exists. The third
 * branch is reachable rather than theoretical: `users.email` is nullable
 * (`db/schema-core.ts`).
 *
 * Pure, and it takes VALUES rather than a member id — fifty rows resolve fifty
 * names without fifty queries, the same reason the community's does.
 *
 * The placeholder LABEL is an input for the same reason too: this file is below
 * the delivery layer, where a sentence may not be born, and the caller passes
 * the translated word in.
 */
export function learnerLabel(input: {
  readonly name: string | null;
  readonly email: string | null;
  readonly memberId: string;
  /** The translated word for an unnamed member — e.g. "Mitglied" / "Member". */
  readonly placeholderLabel: string;
}): string {
  const name = visible(input.name);
  if (name) return name;

  const email = visible(input.email);
  if (email) return email;

  // The last TWELVE characters of the id, as the community's placeholder does
  // and for the measured reason it gives: six hex digits collide between two
  // distinct members with 50% probability at about 4,800 of them, and the
  // placeholder is the common case rather than the edge. Ids are
  // `crypto.randomUUID()`, so the tail is random and carries nothing about the
  // person.
  const suffix = input.memberId.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
  return `${input.placeholderLabel} ${suffix || "?"}`.trim();
}

/**
 * When does this block open for a learner whose access started at `startedAt`?
 *
 * `null` means "open now". Shape decides, and **config wins over data in both
 * directions**: a self-study course cannot be locked by a stray
 * `releaseAfterDays` somebody left in a content file, and a drip course whose
 * blocks are all zero behaves as self-study. Neither direction can surprise
 * anybody, which is not true of a rule that reads only the column.
 *
 * `startedAt` null means the viewer holds no ACTIVE grant — a suspended one is
 * not active. Everything is locked then, and the page says "your access is
 * paused" rather than quietly rendering week one.
 */
export function unlockedAt(
  releaseAfterDays: number,
  startedAt: Date | null,
  shape: CourseShape,
): Date | null {
  if (shape === "self-study") return null;
  // 🚨 The clock is checked BEFORE the zero shortcut, and the order is the
  // whole of it. Written the other way round, a block at `releaseAfterDays: 0`
  // opened for a viewer with no clock at all while every later block stayed
  // shut — the same question answered two ways inside one function. In a paced
  // course a missing clock means nothing is open; the page says "your access is
  // paused" rather than quietly rendering week one.
  if (!startedAt) return new Date(8.64e15); // never
  if (releaseAfterDays <= 0) return null;
  return new Date(startedAt.getTime() + releaseAfterDays * 86_400_000);
}

/** Is this block open at `now`? */
export function isUnlocked(
  releaseAfterDays: number,
  startedAt: Date | null,
  shape: CourseShape,
  now: Date,
): boolean {
  const opensAt = unlockedAt(releaseAfterDays, startedAt, shape);
  return opensAt === null || opensAt.getTime() <= now.getTime();
}

/**
 * How far through is this learner?
 *
 * Derived at read time from what they completed, never a stored number — the
 * same ruling `lib/onboarding/rules.ts` makes. A stored percentage survives the
 * lesson somebody deleted.
 *
 * Rounded, and a course with no units is 0 rather than a division by zero.
 */
export function progress(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(done, total) / total) * 100);
}

/** The shape a `nextUnit` decision needs — deliberately not the DB row. */
export interface UnitRef {
  readonly slug: string;
  /**
   * What the learner calls this lesson.
   *
   * ⚠️ It travels because the ANSWER is shown, not only followed. The card says
   * "next up: …" and a slug is an address — `was-dich-erwartet` where the person
   * wrote "Was dich erwartet". Reported 2026-08-12 as the first line a paying
   * member reads on this page. The alternative — look the title up again on the
   * page from `units` — is a second lookup keyed on the thing this function
   * already returned.
   *
   * ⚠️ There is a SECOND, unrelated `UnitRef` in this module —
   * `admin/ui.tsx`'s, for the operator's unit menu. It is a different type with
   * the same name and does not travel with this one.
   */
  readonly title: string;
  readonly blockPosition: number;
  readonly position: number;
  readonly unlocked: boolean;
}

/**
 * Where should this learner go now?
 *
 * The first uncompleted unit in block-then-unit order that is actually open.
 * It **recommends and never locks** in a self-study course — the order is shown,
 * not enforced — and in a drip course a locked unit simply cannot be the answer.
 *
 * ⚠️ Falls back to the first open unit when everything is done, rather than
 * `null`: a finished course whose "next step" card vanishes reads as broken.
 * `null` is reserved for "there is nothing open at all", which is a real state
 * (a fresh drip learner on day zero with week one at `releaseAfterDays: 7`).
 */
export function nextUnit(units: readonly UnitRef[], completed: ReadonlySet<string>): UnitRef | null {
  const ordered = [...units].sort(
    (a, b) => a.blockPosition - b.blockPosition || a.position - b.position,
  );
  const open = ordered.filter((unit) => unit.unlocked);
  return open.find((unit) => !completed.has(unit.slug)) ?? open[0] ?? null;
}

// ── The hand-in digest's window ────────────────────────────────────────────
//
// The one piece of `../cron.ts` that is arithmetic rather than I/O, and it lives
// here for the reason everything else in this file does: it can be tested one
// case at a time without pulling `@/db` into the import graph of the test.

/**
 * The digest job's id — one truth, read by the job and by the key below.
 *
 * The manifest names it a second time (`"cronJobs": ["courses-digest"]`), and
 * that is not a copy that can drift: `scripts/modules/profiles.test.ts` compares
 * the declared ids against the ones the file really exports.
 */
export const DIGEST_JOB_ID = "courses-digest";

/**
 * The idempotency key for one day's hand-in digest.
 *
 * 🚨 **It carries the WINDOW, not just the job.** `notifyOperators()` claims the
 * key before it sends and never sends twice for the same one, so a key of
 * `courses-digest` alone would be claimed on the first run and never again — the
 * channel would go quiet for ever and look like a channel with nothing to say
 * (`docs/cron.md` → *Rule 1 for a job that MAILS*).
 *
 * ⚠️ **The day is UTC, and that is deliberate even though this template renders
 * days in the operator's zone everywhere else.** This is not a day anybody
 * reads: it is the name of a window, and its only job is to be the same string
 * for two runs of one tick and a different one across the boundary. A zone read
 * from the environment would make the key depend on a variable the operator can
 * change, and changing it would silently re-open a window that had already been
 * claimed. It also could not be read here at all — this file is `coreExport`
 * and `scripts/core/purity.test.ts` refuses `process.env` in it.
 *
 * `now` comes from the tick (`CronContext`), never `new Date()` — one tick, one
 * clock, and it is what makes the job testable.
 */
export function digestKey(now: Date): string {
  // `toISOString()` is UTC by definition and always `YYYY-MM-DDTHH:mm:ss.sssZ`,
  // so the first ten characters are the UTC calendar day. The grammar
  // `claimSend()` enforces (`^[a-z0-9][a-z0-9-]*(:[a-z0-9-]+)*$`) accepts it.
  return `${DIGEST_JOB_ID}:${now.toISOString().slice(0, 10)}`;
}
