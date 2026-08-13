// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The outline an agent reads before it publishes — and the one value in it that
// makes a difference VISIBLE without downloading the course.
//
// ── Where the fingerprint went, and why ────────────────────────────────────
// `unitFingerprint()` is not in this file any more: it lives in
// `./fingerprint.mjs`, bare Node, and is re-exported here so that every existing
// reader keeps its import. The move is the whole of Story 35.2's first task and
// the reason is one sentence — the LOCAL side of a comparison is computed by
// `node run.mjs courses-diff`, which is bare Node with no bundler, and a
// bare-Node command cannot import a `.ts` file. **The alternative was a second
// implementation of the hash**, which is precisely the defect this surface was
// built against: there is one definition of what "changed" means rather than two
// that agree today.
//
// Everything the fingerprint is, is not, hashes and deliberately does not hash —
// including why each media slot is hashed as its STORAGE KEY, which is what
// makes a swapped video visible — is argued in that file's header, once. What
// stays here is the argument about the PAYLOAD: the leak refusal, the key set,
// `unitCount`, and the one field that is not about the course at all
// (`fingerprintVersion`).
import { FINGERPRINT_VERSION, unitFingerprint } from "./fingerprint.mjs";
import type { BlockWithUnits } from "./manage";

/**
 * The comparison key, re-exported from where it is now computed.
 *
 * ⚠️ A re-export rather than a moved import in every caller, and that is
 * deliberate: `outline.test.ts` — 33 tests, the leak assertion among them — asks
 * this module for it, and a move that made those tests edit their import would
 * have been a move that changed something. It did not.
 */
export { unitFingerprint };

/** One lesson, as `courses_outline` reports it. No body, ever. */
export interface OutlineUnit {
  readonly slug: string;
  readonly title: string;
  readonly position: number;
  readonly hasBody: boolean;
  readonly hasVideo: boolean;
  readonly hasWorksheet: boolean;
  readonly asksForSubmission: boolean;
  readonly fingerprint: string;
  /**
   * Which WRITER owns this row — `content` (the applier's) or anything else.
   *
   * 🚨 **Not in the fingerprint, and it must never be.** It says who may write
   * the row, not what the lesson says; folding it into the canonical string
   * would move every fingerprint in every environment for nothing. It is on the
   * payload because a comparison needs it to answer a question the fingerprint
   * cannot: a local slug sitting on a row this applier does not own is not a
   * change a publish would make — it is a publish that **refuses entirely**
   * (`content/appliers/course.mjs` → `refuseClaimedSlugs()`, which throws with
   * every collision collected and applies nothing). `manage.ts`'s own docblock
   * argues that `origin` travelling without being DECLARED was the defect;
   * exposing it deliberately is that argument continued.
   */
  readonly origin: string;
}

/** One block, as `courses_outline` reports it. */
export interface OutlineBlock {
  readonly slug: string;
  readonly title: string;
  /**
   * The applier writes it, so a publish can change it, so it is reported.
   *
   * A block has no fingerprint — its four applied fields are compared one by one
   * (`./diff.mjs`), and leaving `summary` off this surface would hide a change a
   * publish would make, which is the exact defect the fingerprint's field list
   * was chosen to avoid. One nullable string per block, and no lesson text.
   */
  readonly summary: string | null;
  readonly position: number;
  readonly releaseAfterDays: number;
  readonly unitCount: number;
  /** Whose row it is over there — see `OutlineUnit.origin`. */
  readonly origin: string;
  readonly units: readonly OutlineUnit[];
}

/**
 * Every media id the four slots of every lesson hold — what `mediaKeysFor()` is
 * asked for.
 *
 * Pure and here rather than spelled out at the call site: the tool would
 * otherwise carry a four-name list that has to stay in step with the one
 * `unitFingerprint()` hashes, in a file whose job is neither. A fifth slot is
 * then one edit in this file and none in `setup/tools.ts`.
 */
export function mediaIdsIn(blocks: readonly BlockWithUnits[]): (string | null)[] {
  return blocks.flatMap((block) =>
    block.units.flatMap((unit) => [
      unit.coverMediaId,
      unit.videoMediaId,
      unit.subtitleMediaId,
      unit.worksheetMediaId,
    ]),
  );
}

/**
 * The whole `data` payload of `courses_outline`, from rows already loaded.
 *
 * 🚨 **`mediaKeys` is REQUIRED, and its absence must never be spellable.** It
 * maps each of `mediaIdsIn(blocks)` to that row's `media.storageKey`, which is
 * what the fingerprint hashes per slot. An optional parameter defaulting to an
 * empty map would make "the caller forgot the join" and "this course has no
 * media" the same input — and the second is ordinary, so the mistake would ship
 * looking like the ordinary case: every lesson's fingerprint computed as though
 * its slots were empty, agreeing with nothing, reported as `untouched`
 * everywhere. That is precisely the defect the storage key was introduced to
 * remove. `unitFingerprint()` throws on an occupied slot with no key, so a map
 * that is merely INCOMPLETE fails loudly too.
 *
 * 🚨 **This mapping is the only thing keeping the lesson prose off the setup
 * surface.** `courseOutline()` is a `select()` — every column of every unit,
 * `body` included — so a field added carelessly here publishes the course. The
 * unit object's key set is asserted in `outline.test.ts` for exactly that
 * reason.
 *
 * Pure: rows in, payload out, no database and no clock — the same split
 * `presence/check.ts` made for `courseItems()`, and for the same stated reason.
 * Story 35.2 computes the LOCAL side of a comparison by calling
 * `unitFingerprint()` on a `content/course/*.json` unit, so there is one
 * definition of what "changed" means rather than two that agree today.
 */
export function outlinePayload(
  blocks: readonly BlockWithUnits[],
  mediaKeys: ReadonlyMap<string, string>,
): { fingerprintVersion: string; blocks: OutlineBlock[] } {
  const keyOf = (id: string | null): string | null => (id === null ? null : (mediaKeys.get(id) ?? null));

  return {
    // 🚨 The one field on this payload that is not about the course. It is what
    // lets `compareCourse()` tell "these lessons differ" apart from "that app
    // computes a different fingerprint version, so nothing was comparable" —
    // and the second is the ORDINARY state right after a template update, when
    // the repo has moved and the environment has not. Without it every lesson
    // reads as changed and nothing anywhere says why (NFR-60).
    fingerprintVersion: FINGERPRINT_VERSION,
    blocks: blocks.map((block) => ({
      slug: block.slug,
      title: block.title,
      // The fourth field the applier writes on conflict, and the only one that
      // was not on this surface — a renamed block is a change a publish makes.
      summary: block.summary,
      position: block.position,
      // The one number an agent needs to reason about shape 2 without knowing
      // which shape this app sells.
      releaseAfterDays: block.releaseAfterDays,
      // Redundant with `units.length` to a reader of the JSON, and not to an
      // agent deciding whether to read the array at all.
      unitCount: block.units.length,
      // Whose row it is — one string, and the only field on this surface that
      // answers "would a publish be allowed to touch this at all".
      origin: block.origin,
      units: block.units.map((unit) => ({
        slug: unit.slug,
        title: unit.title,
        position: unit.position,
        origin: unit.origin,
        // Whether there is anything to read, not the text itself: a course is
        // long, and an outline that returned every lesson body would spend a
        // context window saying what one flag says.
        hasBody: Boolean(unit.body),
        hasVideo: Boolean(unit.videoMediaId),
        hasWorksheet: Boolean(unit.worksheetMediaId),
        asksForSubmission: Boolean(unit.taskPrompt),
        // The row plus its four resolved keys. ⚠️ The `*MediaId` fields travel
        // INTO the hash function and are not hashed — they are what its guard
        // reads to tell an empty slot from an unresolved one. Nothing of either
        // reaches the payload: the key set above is asserted in `outline.test.ts`.
        fingerprint: unitFingerprint({
          ...unit,
          coverKey: keyOf(unit.coverMediaId),
          videoKey: keyOf(unit.videoMediaId),
          subtitleKey: keyOf(unit.subtitleMediaId),
          worksheetKey: keyOf(unit.worksheetMediaId),
        }),
      })),
    })),
  };
}
