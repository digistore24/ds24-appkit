// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Does this environment hold the course this app sells?
//
// 🚨 **This is the module the whole `content-check` mechanism was built for.**
// A course's blocks and units are CONTENT: written in the repo, carried into an
// environment by `content-apply`, and carried by nothing else. An app that was
// built and filled locally and then deployed has a `/dashboard/course` that
// answers 200 and shows nothing — every gate green, `smoke` green, and the
// product missing. `docs/content.md` opens on exactly that failure.
//
// The core cannot see it: it does not know this module has blocks. That is the
// argument for asking whoever owns the rows.
//
// ⚠️ `expected` is null throughout. There is no number of lessons a course
// *should* have, and an operator who added three more has not broken anything —
// inventing an expected count turns ordinary growth into a red line. What is
// worth seeing is ZERO, and zero is reported.
import type { OriginCounts } from "../lib/manage";
import { countContent, emptyUnitSlugs } from "../lib/manage";
import type { PresenceContributor, PresenceItem, PresenceReport } from "@/lib/content/presence";

/**
 * The five lines this module contributes, from numbers it has already fetched.
 *
 * Split out so the shape can be checked without a database: what AC 7 is about
 * is not the counting but the FORM of every item, and that is a pure question.
 */
export function courseItems(
  blocks: OriginCounts,
  units: OriginCounts,
  emptyUnits: number,
): PresenceItem[] {
  return [
    // Two lines per table rather than one, because they are two questions. The
    // content rows say whether `content-apply` ever reached this database; the
    // operator's rows say what exists here and in no other environment.
    { what: "course blocks (from content files)", found: blocks.content, expected: null },
    { what: "course blocks (operator-authored)", found: blocks.operator, expected: null },
    { what: "course units (from content files)", found: units.content, expected: null },
    { what: "course units (operator-authored)", found: units.operator, expected: null },
    // 🚨 A count, and deliberately NOT `missing`. A non-empty `missing`
    // fails the run (`presenceProblems()`), and a lesson somebody has not
    // finished writing is not a broken environment — a red `content-check`
    // during ordinary authoring is a check people learn to ignore. Which
    // units they are is `node run.mjs courses-check`'s job: that one is a
    // developer's tool and may be as chatty as it likes.
    //
    // 🚨 The operator lines carry it even more strictly, and this is the reason
    // the origin column may be reported here at all: those rows exist in ONE
    // environment by design, so "there are none in PROD" is the ordinary state
    // of a healthy app, not a finding. An item with `expected: null` and no
    // `missing` cannot become a problem — `presenceProblems()` has three paths
    // and this shape reaches none of them — so a course somebody authors by
    // hand can never turn a release gate red for having done so.
    { what: "units with neither text nor video", found: emptyUnits, expected: null },
  ];
}

const contributor: PresenceContributor = {
  id: "courses",
  async check(): Promise<PresenceReport> {
    const { blocks, units } = await countContent();
    // Only worth asking once there is a course at all: on an empty environment
    // every unit would be "empty", which is noise on top of the finding.
    const empty = units.content + units.operator > 0 ? await emptyUnitSlugs() : [];

    return { owner: "courses", items: courseItems(blocks, units, empty.length) };
  },
};

export default contributor;
