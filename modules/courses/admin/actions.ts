// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

// What the operator may DO on the course's admin surface.
//
// SECURITY — every action opens with `await guard()`, and that is the switch
// (`isCourseEnabled()`) then `requireOwner()`, in that order: off beats
// operator. The function is `./authz.ts`, which carries the whole reasoning;
// it lives there rather than here because a `"use server"` module may export
// nothing but Server Actions, and three files on this surface need it.
//
// Neither half is optional and neither is enough on its own.
// `modules/courses/admin/guard.test.ts` reads this file as text and fails on an
// exported action that lost the call.
//
// 🚨 **No action in THIS file takes a member id, and none ever will.** It
// touches CONTENT rows; there is no member row anywhere near it. Its sibling
// `./submission-actions.ts` does write a row belonging to a member — and takes
// no member id either, because the row is addressed by its own id and the
// account is never named by the request.
//
// LANGUAGE: here — and only here — the codes from `../rules.ts` become
// sentences (`CLAUDE.md` → Languages). Two of them name a FILE, which is why
// this surface reads the content tree at all; that reader is `./content-claims`,
// shared with `./media-actions.ts` and carrying the reasoning for both.
import { revalidatePath } from "next/cache";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import type { ActionState } from "@/hooks/use-action-toast";

import { courseShape } from "../lib/config";
import {
  blockById,
  blockPositions,
  blockSlugTaken,
  createBlock,
  createUnit,
  deleteBlock,
  deleteUnit,
  setBlockPosition,
  setUnitPosition,
  unitById,
  unitCountFor,
  unitPositions,
  unitSlugTaken,
  unitSlugsIn,
  updateBlock,
  updateUnit,
} from "../lib/manage";
import {
  CoursesError,
  blockDeletable,
  positionAvailability,
  rowWritable,
  slugAvailability,
  type CoursesErrorCode,
  unitTextProblem,
} from "../rules";
import { guard } from "./authz";
import { claims, fileFor } from "./content-claims";

const PAGE = "/dashboard/admin/course";
/** The member's own surface — every write here changes what a learner sees. */
const COURSE = "/dashboard/course";

/** Turn an unexpected error into something the operator can read. */
async function toState(error: unknown): Promise<ActionState> {
  // `notFound()` and the redirect inside `requireOwner()` signal by THROWING —
  // that is how both guards answer. Swallowing them would turn a legitimate
  // refusal into "unknown error" and log a fake fault for `node run.mjs errors`.
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof CoursesError) return { error: t(error.code), ok: null };

  console.error("[courses] unexpected error:", error);
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

/** …the same, `null` when the operator left it empty. */
function optional(formData: FormData, key: string): string | null {
  return text(formData, key) || null;
}

/**
 * A whole number out of the form.
 *
 * Anything unparseable becomes 0, which is a legal position rather than a
 * silent failure: through the shipped `<Input type="number">` it cannot happen,
 * and through a crafted post `positionAvailability()` still judges the result.
 */
function whole(formData: FormData, key: string): number {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * How many days after the start this block opens — 0 outside a drip course.
 *
 * 🚨 **The server does not read the field unless the shape gives it a meaning**
 * (AC 5), which is the other half of the form not RENDERING it. There is
 * deliberately no `shapeForbidsReleaseAfterDays` code: a field that is not
 * there needs no error. `courseShape()` cannot throw behind `guard()` — that is
 * exactly what `isCourseEnabled()` establishes.
 */
function releaseDays(formData: FormData): number {
  return courseShape() === "drip" ? whole(formData, "releaseAfterDays") : 0;
}

/**
 * Everything a write may have changed, told to Next.
 *
 * `PAGE` and the course overview always; a lesson's own route whenever its row
 * or its block's release moved, because that page renders the lesson AND the
 * unlock decision built on `releaseAfterDays`.
 */
function revalidate(unitSlugs: readonly string[] = []) {
  revalidatePath(PAGE);
  revalidatePath(COURSE);
  for (const slug of unitSlugs) revalidatePath(`${COURSE}/${slug}`);
}

export async function createBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const slug = text(formData, "slug");
    const index = await claims();
    const problem = slugAvailability(slug, {
      claimedByContent: index.blocks.has(slug),
      takenByRow: await blockSlugTaken(slug),
    });
    if (problem) {
      return refuse(problem, { file: await fileFor(index, "blocks", slug), slug });
    }

    const position = whole(formData, "position");
    const taken = positionAvailability(position, await blockPositions());
    if (taken) return refuse(taken, { position });

    const block = await createBlock({
      slug,
      position,
      title: text(formData, "title"),
      summary: optional(formData, "summary"),
      releaseAfterDays: releaseDays(formData),
    });
    revalidate();
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("blockCreated", { slug: block.slug }) };
  } catch (error) {
    return toState(error);
  }
}

export async function updateBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const block = await blockById(text(formData, "id"));
    if (!block) return refuse("coursesNotFound");

    // 🚨 The refusal is decided HERE, where the row's origin can become a
    // sentence naming its file. The `where` in `updateBlock()` holds the same
    // rule a second time, for a caller who never came through this line.
    const locked = rowWritable(block.origin);
    if (locked) {
      const index = await claims();
      return refuse(locked, { file: await fileFor(index, "blocks", block.slug) });
    }

    await updateBlock(block.id, {
      title: text(formData, "title"),
      summary: optional(formData, "summary"),
      releaseAfterDays: releaseDays(formData),
    });
    // Its lessons too: `releaseAfterDays` is what their pages lock against.
    revalidate(await unitSlugsIn(block.id));
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("blockSaved", { slug: block.slug }) };
  } catch (error) {
    return toState(error);
  }
}

export async function deleteBlockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const block = await blockById(text(formData, "id"));
    if (!block) return refuse("coursesNotFound");

    const locked = rowWritable(block.origin);
    if (locked) {
      const index = await claims();
      return refuse(locked, { file: await fileFor(index, "blocks", block.slug) });
    }

    // The count is read before the delete and named in the refusal, the way
    // `module remove` names its rows. `on delete cascade` would fire happily;
    // it is the answer to `--drop-data`, not to a click.
    const count = await unitCountFor(block.id);
    const full = blockDeletable(count);
    if (full) return refuse(full, { count });

    await deleteBlock(block.id);
    revalidate();
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("blockDeleted", { slug: block.slug }) };
  } catch (error) {
    return toState(error);
  }
}

export async function createUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const block = await blockById(text(formData, "blockId"));
    if (!block) return refuse("coursesNotFound");

    // ⚠️ The BLOCK's origin is deliberately not checked. This inserts a lesson
    // and writes no row of the block's, so a bonus lesson under a file's week
    // one is an operator row inside a content block — lawful, and the useful
    // case. The next `content-apply` re-asserts the block and leaves it standing.
    const slug = text(formData, "slug");
    const index = await claims();
    const problem = slugAvailability(slug, {
      claimedByContent: index.units.has(slug),
      takenByRow: await unitSlugTaken(slug),
    });
    if (problem) {
      return refuse(problem, { file: await fileFor(index, "units", slug), slug });
    }

    const position = whole(formData, "position");
    const taken = positionAvailability(position, await unitPositions(block.id));
    if (taken) return refuse(taken, { position });

    const fields = {
      title: text(formData, "title"),
      body: optional(formData, "body"),
      taskPrompt: optional(formData, "taskPrompt"),
    };
    // The ceiling the member's hand-in has had since it was built. A body is
    // turned into React elements on every request, so the operator's own text
    // is the one served more often.
    const tooLong = unitTextProblem(fields);
    if (tooLong) return refuse(tooLong);

    const unit = await createUnit({ blockId: block.id, slug, position, ...fields });
    revalidate([unit.slug]);
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("unitCreated", { slug: unit.slug }) };
  } catch (error) {
    return toState(error);
  }
}

export async function updateUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const unit = await unitById(text(formData, "id"));
    if (!unit) return refuse("coursesNotFound");

    const locked = rowWritable(unit.origin);
    if (locked) {
      const index = await claims();
      return refuse(locked, { file: await fileFor(index, "units", unit.slug) });
    }

    const fields = {
      title: text(formData, "title"),
      body: optional(formData, "body"),
      taskPrompt: optional(formData, "taskPrompt"),
    };
    const tooLong = unitTextProblem(fields);
    if (tooLong) return refuse(tooLong);

    await updateUnit(unit.id, fields);
    revalidate([unit.slug]);
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("unitSaved", { slug: unit.slug }) };
  } catch (error) {
    return toState(error);
  }
}

export async function deleteUnitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await guard();
    const unit = await unitById(text(formData, "id"));
    if (!unit) return refuse("coursesNotFound");

    const locked = rowWritable(unit.origin);
    if (locked) {
      const index = await claims();
      return refuse(locked, { file: await fileFor(index, "units", unit.slug) });
    }

    await deleteUnit(unit.id);
    revalidate([unit.slug]);
    const t = await getTranslations("coursesAdmin");
    return { error: null, ok: t("unitDeleted", { slug: unit.slug }) };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Put one row at a position.
 *
 * ⚠️ **Deliberately not "up/down with a full rewrite"**, the shape
 * `reorderGroupsAction` uses for the community's rooms. That pattern writes
 * EVERY row of the list — including `origin = 'content'` ones, which breaks the
 * partition; and even if it did not, the next `content-apply` would re-assert
 * those positions and the operator's ordering would vanish after a deploy with
 * no sentence about it. A rewrite that skips the content rows produces no
 * consistent list at all. So: a number, judged against both origins.
 */
export async function moveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await guard();
    const kind = text(formData, "kind");
    const id = text(formData, "id");
    const position = whole(formData, "position");
    const t = await getTranslations("coursesAdmin");

    if (kind === "block") {
      const block = await blockById(id);
      if (!block) return refuse("coursesNotFound");
      const locked = rowWritable(block.origin);
      if (locked) {
        const index = await claims();
        return refuse(locked, { file: await fileFor(index, "blocks", block.slug) });
      }
      const taken = positionAvailability(position, await blockPositions(block.id));
      if (taken) return refuse(taken, { position });

      await setBlockPosition(block.id, position);
      revalidate(await unitSlugsIn(block.id));
      return { error: null, ok: t("moved", { slug: block.slug, position }) };
    }

    if (kind === "unit") {
      const unit = await unitById(id);
      if (!unit) return refuse("coursesNotFound");
      const locked = rowWritable(unit.origin);
      if (locked) {
        const index = await claims();
        return refuse(locked, { file: await fileFor(index, "units", unit.slug) });
      }
      const taken = positionAvailability(position, await unitPositions(unit.blockId, unit.id));
      if (taken) return refuse(taken, { position });

      await setUnitPosition(unit.id, position);
      revalidate([unit.slug]);
      return { error: null, ok: t("moved", { slug: unit.slug, position }) };
    }

    return refuse("coursesNotFound");
  } catch (error) {
    return toState(error);
  }
}
