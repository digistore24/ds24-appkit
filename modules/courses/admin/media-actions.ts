// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// The four media slots of a lesson the operator authored — attach and detach.
//
// SECURITY — every action opens with the SAME two lines, in this order, and for
// the reasons `./actions.ts` spells out at length:
//
//   1. `notFound()` when the course is not running on this installation.
//   2. `requireOwner()`. A Server Action is an HTTP endpoint in its own right.
//
// 🚨 **BOTH HALVES OF THE UPLOAD DOOR, IN THIS ORDER: `guardUploadEntry()`
// BEFORE `acceptUpload()`.** The second is the shipped pipeline — bytes sniffed
// rather than believed, the role's ceiling, EXIF stripped, no SVG. The first is
// the other half — is media switched on, is the store usable, has this account
// had its share of the hour. A door that calls only the second is an upload
// path with no rate limit and a kill switch that does nothing, which is
// `CLAUDE.md` → *Media*'s words for a bug this template has already shipped
// once. `lib/media/manage.test.ts` reads this file and fails on the order.
//
// 🚨 **THE SERVER DECIDES WHO MAY SEE THE FILE, AND THE FORM HAS NO SAY.**
// `visibility` and `planKeys` are set HERE, from `courseConfig()`. There is
// no visibility field, no hidden input and no plan parameter — `CLAUDE.md` →
// *Media* says "a form may never choose `public` or `entitled`", and the
// documented way to an `entitled` row is exactly this: `acceptUpload()` from a
// Server Action with an operator check in front of it
// (`lib/media/upload-endpoint.ts` names it). A crafted post carrying
// `visibility=public` changes nothing, because nothing here reads one.
//
// ⚠️ **THREE slots reach a ceiling of 10 MB, and the video slot does not.**
// A Server Action body is capped by `next.config.ts` →
// `experimental.serverActions.bodySizeLimit`, and Next refuses while it decodes
// the payload — BEFORE this file runs — so an oversized file produces nothing to
// catch and no number to show. `slotCeilingFor()` (`./ceilings.ts`) is that
// number made readable, and the cover, subtitle and worksheet doors below refuse
// against it. It lives in a file of its own because `./page.tsx` shows the same
// four numbers and the two used to compute them separately — which is how the
// video slot came to be advertised at 2 GB and refused at 10 MB.
//
// The VIDEO slot travels the other way since Story 8.2: `mintVideoTicketAction`
// hands the browser a short-lived address, the bytes go straight to the bucket,
// and `confirmVideoAction` reads back what really landed. Its ceiling is
// `kinds.video.maxBytes` (2 GB), because no request body carries it. That is why
// there is no `attachVideoAction` any more: two ways into one slot with two
// different lids is the arrangement in which one of them is wrong.
//
// LANGUAGE: here — and only here — the codes from `../rules.ts` and
// `lib/media/rules.ts` become sentences (`CLAUDE.md` → Languages).
import { revalidatePath } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import type { ActionState } from "@/hooks/use-action-toast";
import { requireOwner } from "@/lib/authz";
import { acceptUpload, confirmUpload, createUploadTicket } from "@/lib/media/manage";
import { MediaError, formatBytes } from "@/lib/media/rules";
import { guardUploadConfirm, guardUploadEntry } from "@/lib/media/upload-endpoint";

import { courseByIdForOperator } from "../lib/courses";
import { blockById, setUnitMedia, unitById } from "../lib/manage";
import { guard } from "./authz";
import { slotCeilingFor } from "./ceilings";
import {
  COURSE_SLOTS,
  CoursesError,
  isCourseSlotId,
  rowWritable,
  slotUploadProblem,
  type CourseSlotId,
  type CoursesErrorCode,
} from "../rules";
import { claims, fileFor } from "./content-claims";

const PAGE = "/dashboard/admin/course";
/** The member's own surface — a slot change is a change to what a learner gets. */
const COURSE = "/dashboard/course";

/** Turn an unexpected error into something the operator can read. */
async function toState(error: unknown): Promise<ActionState> {
  // `notFound()` and the redirect inside `requireOwner()` signal by THROWING —
  // that is how both guards answer. Swallowing them would turn a legitimate
  // refusal into "unknown error" and log a fake fault for `node run.mjs errors`.
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof CoursesError) return { error: t(error.code), ok: null };
  // A refusal from the media pipeline is an operator mistake, not a fault, and
  // every one of its codes already has a sentence in both languages.
  if (error instanceof MediaError) return { error: t(error.code), ok: null };

  console.error("[courses] unexpected media error:", error);
  return { error: t("unknown"), ok: null };
}

/** A refusal, translated where the values it needs are known. */
async function refuse(
  code: CoursesErrorCode,
  values?: Record<string, string | number>,
): Promise<ActionState> {
  const t = await getTranslations("errors");
  return { error: t(code, values), ok: null };
}

/** One field of the form, trimmed. */
function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Everything a slot change may have altered, told to Next. */
function revalidate(unitSlug: string) {
  revalidatePath(PAGE);
  revalidatePath(COURSE);
  revalidatePath(`${COURSE}/${unitSlug}`);
}

/**
 * Attach one file to one slot — the body the three through-the-app doors share.
 *
 * They are three exported actions rather than one taking the slot from the form
 * because each is a door of its own with its own accepted types, and a door is
 * easier to reason about than a switch inside one. (The fourth slot, the video,
 * does not come through here at all — see the pair below.) The order of the work
 * is the part worth keeping:
 *
 *   the row → is it the operator's, and is the file small enough (both pure,
 *   both before a single byte is read) → the outer guard → the inner one →
 *   the column → revalidate.
 *
 * The size refusal sits before `guardUploadEntry()` deliberately: it costs
 * nothing, and metering a request that is refused for a reason nobody had to
 * look at the bytes for would spend an hourly slot on a mistake.
 */
async function attach(
  slot: CourseSlotId,
  session: Awaited<ReturnType<typeof requireOwner>>,
  formData: FormData,
): Promise<ActionState> {
  const unit = await unitById(text(formData, "id"));
  if (!unit) return refuse("coursesNotFound");

  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size === 0) {
    const t = await getTranslations("errors");
    return { error: t("noFile"), ok: null };
  }

  const ceiling = slotCeilingFor(slot);
  const problem = slotUploadProblem(slot, {
    origin: unit.origin,
    // Nobody has decided the TYPE yet, and that is deliberate: `File.type` is
    // the sending machine's registry talking, and the pipeline decides from the
    // bytes. `onlyMimes` below is that decision, off the same constant.
    mime: null,
    bytes: upload.size,
    ceilingBytes: ceiling,
  });
  if (problem) return slotRefusal(problem, slot, unit.slug, ceiling);

  // Both halves of the door, in this order. See the header.
  const memberId = session.user.id;
  guardUploadEntry(memberId);

  const rules = COURSE_SLOTS[slot];
  let stored;
  try {
    stored = await acceptUpload({
      ownerId: memberId,
      // ── Whose object this is, and what it is for ──────────────────────────
      // This module's own id as the namespace — `modules/boundary.test.ts`
      // refuses any other — and the SLOT as the category, so a bucket says
      // `courses/cover/…` against `courses/worksheet/…` and a lifecycle rule
      // can reach one without reaching the other. The slot id is already held
      // to `COURSE_SLOT_IDS` above, all four of which are usable path segments.
      namespace: "courses",
      category: slot,
      // The session's own role, never an assumed one. `requireOwner()` has
      // already established what it is; a missing value falls to "" and
      // `mayUpload[""]` is nothing at all, which is the safe direction.
      role: String(session.user.role ?? ""),
      bytes: new Uint8Array(await upload.arrayBuffer()),
      claimedMime: upload.type || null,
      filename: upload.name || null,
      // ── The two fields the form does not have ────────────────────────────
      // What a lesson's media IS: the product, sold under the course's own
      // Product Keys. Read from `courseConfig()`, never from the request.
      visibility: "entitled",
      planKeys: await requiredPlanKeys(unit),
      // The kind, and — for the two slots whose kind holds more than one type —
      // the type. `text/vtt`, `application/pdf` and `application/zip` are all
      // `file`, so a subtitle door described by its kind alone would take a PDF.
      onlyKinds: [rules.kind],
      onlyMimes: rules.mimeTypes,
      // A cover is an image, and an image needs alternative text. It comes from
      // its own field and is never derived from the filename or the lesson
      // title: a file name is not a description, and a title is what stands
      // beside the picture rather than instead of it.
      alt: slot === "cover" ? text(formData, "alt") || null : null,
    });
  } catch (error) {
    unstable_rethrow(error);
    // On these doors `typeNotAllowed` can only mean "not what this slot takes",
    // and the core's sentence is the general one. The course can say which
    // three letters it wanted, which is the difference between a refusal
    // somebody can act on and one they argue with.
    if (error instanceof MediaError && error.code === "typeNotAllowed") {
      return slotRefusal("coursesSlotNotAttachable", slot, unit.slug, ceiling);
    }
    throw error;
  }

  await setUnitMedia(unit.id, slot, stored.id);
  revalidate(unit.slug);
  const t = await getTranslations("coursesAdmin");
  return { error: null, ok: t("slotAttached", { slot: t(`slot${label(slot)}`) }) };
}

/**
 * The course's Product Keys, or a fault.
 *
 * ⚠️ **Unreachable on this surface, and written out anyway.** A course with no
 * `planKeys` is `brokenConfig` (`courseConfigProblems()`), so
 * `isCourseEnabled()` is false and `guard()` has already answered `notFound()`.
 * It throws rather than passing an empty list on, because `acceptUpload()`
 * would then refuse with `MediaError("noAccess")` — "no access" is a sentence
 * about the viewer, and this would be a sentence about the config.
 */
async function requiredPlanKeys(unit: { blockId: string }): Promise<readonly string[]> {
  // 🚨 **The LESSON's own course, walked rather than assumed.** A file attached
  // to a lesson in course B must carry course B's keys — the media row is what
  // `mayAccess()` decides on, so keys from the wrong course make the file
  // unfetchable for exactly the people who bought it, behind a page that
  // renders. Lesson → block → course, the same walk `pages/actions.ts` makes.
  const block = await blockById(unit.blockId);
  const course = block ? await courseByIdForOperator(block.courseId) : null;
  if (!course || course.planKeys.length === 0) {
    throw new Error(
      "this lesson's course has no planKeys, so its media could never be fetched by " +
        "anybody — courseProblems() should have kept this course off the workbench",
    );
  }
  return course.planKeys;
}

/**
 * Do two key lists say the same thing? Order-insensitive, because the list is a
 * SET — `mayAccess()` asks whether the viewer holds any one of them, and two
 * orderings of the same keys open the same doors.
 *
 * ⚠️ The comparison is what stops a ticket minted at another door being
 * confirmed here; a `===` on a joined string would refuse a ticket that is
 * identical but written the other way round, which is a refusal of something
 * lawful rather than of the attack.
 */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
}

/** A slot refusal with the values its sentence needs. */
async function slotRefusal(
  code: CoursesErrorCode,
  slot: CourseSlotId,
  unitSlug: string,
  ceiling: number,
): Promise<ActionState> {
  if (code === "coursesContentRowLocked") {
    return refuse(code, { file: await fileFor(await claims(), "units", unitSlug) });
  }
  if (code === "coursesUploadTooLarge") {
    // The number, in the reader's own notation. ⚠️ The sentence no longer
    // offers a way past the lid, and it should not: since Story 8.2 the one
    // route past a body limit is the direct upload, and the only slot that
    // needed it — the video — does not come through this door at all. For the
    // other three "pick a smaller one" IS the answer.
    return refuse(code, { max: formatBytes(ceiling, await getLocale()) });
  }
  if (code === "coursesUploadTicketMismatch") return refuse(code);
  const t = await getTranslations("coursesAdmin");
  return refuse(code, { types: t(`slot${label(slot)}Types`) });
}

/** `cover` → `Cover`, so one message key can be built per slot. */
function label(slot: CourseSlotId): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

export async function attachCoverAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard();
    return await attach("cover", session, formData);
  } catch (error) {
    return toState(error);
  }
}

// ── The video slot: straight to the bucket, in two acts ────────────────────
//
// 🚨 **This is the seam Story 8.1 left open, and it is a Server Action rather
// than the HTTP route on purpose.** `POST /api/media/upload-url` pins
// `visibility: "owner"` — the same rule `handleUpload()` keeps, and for the same
// reason: a request may not choose who gets to see a row. A lesson recording is
// the operator's PRODUCT and needs `entitled` plus the course's own Product Key,
// and the one documented way to that is exactly this — `createUploadTicket()`
// called behind `requireOwner()`, with both values read from `courseConfig()`.
// There is no visibility field and no plan parameter here either; a crafted post
// carrying `visibility=public` changes nothing, because nothing reads one.
//
// The two acts are separate because the bytes travel BETWEEN them, and neither
// half is optional: minting spends the hourly slot (`guardUploadEntry`),
// confirming spends none (`guardUploadConfirm` — the slot was already taken, and
// charging twice would halve the operator's allowance) and is where the object's
// own first bytes decide what it is.

/** What `mintVideoTicketAction()` answers — an address, or a sentence. */
export interface VideoTicketState {
  ticketId: string | null;
  url: string | null;
  error: string | null;
}

/**
 * Promise the bucket a lesson recording, and hand the browser the address.
 *
 * The order is the one every neighbour on this surface keeps: the switch and
 * `requireOwner()` (both inside `guard()`), the row, whether the row is the
 * operator's at all, and only then the outer half of the upload door.
 */
export async function mintVideoTicketAction(input: {
  id: string;
  mime: string;
  filename: string | null;
  bytes: number;
}): Promise<VideoTicketState> {
  const asTicket = async (state: Promise<ActionState>): Promise<VideoTicketState> => {
    const { error } = await state;
    return { ticketId: null, url: null, error };
  };

  try {
    const session = await guard();
    const unit = await unitById(String(input.id ?? "").trim());
    if (!unit) return asTicket(refuse("coursesNotFound"));

    const locked = rowWritable(unit.origin);
    if (locked) return asTicket(slotRefusal(locked, "video", unit.slug, slotCeilingFor("video")));

    // ⚠️ **The claim is narrowed here because nothing later can narrow it to
    // this SLOT.** `confirmUpload()` reads the object's own first bytes and
    // refuses anything that disagrees with the claim — but a ticket claiming
    // `application/pdf` would agree with a PDF, and `setUnitMedia()` would put
    // it in the video column. Unlike the subtitle slot, a browser reliably
    // names `.mp4` and `.webm`, so demanding one of the two costs nobody an
    // upload they should have been allowed to make.
    const claimed = String(input.mime ?? "").split(";")[0].trim().toLowerCase();
    if (!COURSE_SLOTS.video.mimeTypes.includes(claimed)) {
      return asTicket(slotRefusal("coursesSlotNotAttachable", "video", unit.slug, 0));
    }

    const memberId = session.user.id;
    guardUploadEntry(memberId);

    const ticket = await createUploadTicket({
      ownerId: memberId,
      role: String(session.user.role ?? ""),
      // This module's namespace and the video slot — recorded ON the ticket, so
      // the confirm half below has to name the same pair to redeem it. That is
      // what stops the generic `POST /api/media/upload-url` door, which mints
      // for `core`/`upload`, from being confirmed here.
      namespace: "courses",
      category: "video",
      claimedMime: claimed,
      filename: input.filename,
      // A courtesy refusal against what the browser SAYS it will send. The
      // measured length is checked again at confirm time, because a presigned
      // PUT cannot enforce one.
      declaredBytes: Number(input.bytes) || 0,
      // ── The two fields the form does not have ────────────────────────────
      visibility: "entitled",
      planKeys: await requiredPlanKeys(unit),
    });

    return { ticketId: ticket.ticketId, url: ticket.url, error: null };
  } catch (error) {
    return asTicket(toState(error));
  }
}

/**
 * The bytes have landed — read back what really did, and fill the slot.
 *
 * `guardUploadConfirm()` and not `guardUploadEntry()`: the hourly slot was
 * spent when the address was minted, and taking a second one would count every
 * upload twice. It still asks the two questions that matter here — is media
 * switched on, and is the store usable.
 */
export async function confirmVideoAction(input: {
  id: string;
  ticketId: string;
}): Promise<ActionState> {
  try {
    const session = await guard();
    const unit = await unitById(String(input.id ?? "").trim());
    if (!unit) return refuse("coursesNotFound");

    const locked = rowWritable(unit.origin);
    if (locked) return slotRefusal(locked, "video", unit.slug, slotCeilingFor("video"));

    guardUploadConfirm();

    const stored = await confirmUpload({
      ticketId: String(input.ticketId ?? "").trim(),
      memberId: session.user.id,
      role: String(session.user.role ?? ""),
      // The pair the mint half above recorded. A ticket minted anywhere else —
      // the generic HTTP door pins `core`/`upload` — is `uploadTicketInvalid`
      // here, which is the same shape as the visibility re-check below and
      // covers the half that one cannot: WHERE the bytes end up.
      namespace: "courses",
      category: "video",
    });

    // ⚠️ Unreachable today, and written out anyway. `agreedMime()` has no alias
    // that turns a `video/mp4` claim into another type, so what comes back is
    // one of the two above. It is asserted because the slot's promise is about
    // the COLUMN, and an alias added to `lib/media/sniff.ts` a year from now
    // must not quietly widen what a video slot holds.
    if (!COURSE_SLOTS.video.mimeTypes.includes(stored.mime)) {
      return slotRefusal("coursesSlotNotAttachable", "video", unit.slug, 0);
    }

    // 🚨 **And the two fields the form has no say over, asked again about the
    // ROW rather than about the call.** They are chosen when a ticket is
    // minted, travel on the ticket and are copied into the `media` row by
    // `confirmUpload()`, which validates the owner and the expiry and not
    // these. There is a SECOND door minting tickets for the same owner —
    // `POST /api/media/upload-url`, which pins `visibility: "owner"` — so
    // without this line an operator could mint there, confirm here, and put a
    // row into the video column that `mayAccess()` gives to nobody but them:
    // the lesson page answers a clean 200 with the video missing for every
    // buyer, which is the class `CLAUDE.md` → *Never ship a broken page* is
    // about. The header of this file promises that the documented way to an
    // `entitled` row is exactly this one; up to here that was enforced only
    // where a ticket is WRITTEN.
    if (stored.visibility !== "entitled" || !sameKeys(stored.planKeys, await requiredPlanKeys(unit))) {
      return slotRefusal("coursesUploadTicketMismatch", "video", unit.slug, 0);
    }

    await setUnitMedia(unit.id, "video", stored.id);
    revalidate(unit.slug);
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("slotAttached", { slot: t("slotVideo") }) };
  } catch (error) {
    return toState(error);
  }
}

export async function attachSubtitleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard();
    return await attach("subtitle", session, formData);
  } catch (error) {
    return toState(error);
  }
}

export async function attachWorksheetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await guard();
    return await attach("worksheet", session, formData);
  } catch (error) {
    return toState(error);
  }
}

/**
 * Empty one slot.
 *
 * 🚨 **The column goes to `null` and NOTHING is deleted** — no `deleteMedia()`,
 * not here and not later. The four reasons are on `setUnitMedia()` in
 * `../lib/manage.ts`, and the short version is: one file can hang on two
 * lessons, the delete takes the object before the row and is irreversible, a
 * lesson cover is the PRODUCT rather than the person (which is the line
 * `OWNED_MEDIA_VISIBILITIES` draws), and the price — an orphaned object in the
 * bucket — is named rather than hidden. This app has no surface that really
 * deletes product files, and building one was not this story's job.
 */
export async function detachSlotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const unit = await unitById(text(formData, "id"));
    if (!unit) return refuse("coursesNotFound");

    const locked = rowWritable(unit.origin);
    if (locked) {
      return refuse(locked, { file: await fileFor(await claims(), "units", unit.slug) });
    }

    const slot = text(formData, "slot");
    if (!isCourseSlotId(slot)) return refuse("coursesSlotNotAttachable", { types: "" });

    await setUnitMedia(unit.id, slot, null);
    revalidate(unit.slug);
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("slotDetached", { slot: t(`slot${label(slot)}`) }) };
  } catch (error) {
    return toState(error);
  }
}
