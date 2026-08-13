// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// May this person into the course, and since when?
//
// 🚨 **ONE function, called by every surface.** `docs/content-source.md` states
// the rule and the failure it prevents: a source more permissive than its page
// turns the assistant into an existence oracle — it tells a non-buyer that
// "Lektion 7" exists and hands them a link that bounces them. Two `hasPlan()`
// calls that agree today are how that arrives, so the overview page, the lesson
// page, every server action and any content source this module later registers
// all ask here.
//
// It answers two things at once because they are one question: whether they are
// in, and what their clock reads. Separating them invites a caller to take the
// first and forget the second, which in a drip course renders week ten.
import { planStartedAt } from "@/lib/entitlements/manage";
import { isOwner } from "@/lib/roles";

import { courseConfig } from "./config";
import type { Course } from "./courses";

export interface CourseAccess {
  /** May they see the course at all? */
  readonly entitled: boolean;
  /**
   * When their clock started — what `unlockedAt()` measures against.
   *
   * `null` means no ACTIVE grant. A SUSPENDED grant (missed payment) is not
   * active, so a paused member reads `null` here and nothing is open: the page
   * says "your access is paused" rather than quietly rendering week one.
   */
  readonly startedAt: Date | null;
  /** Are they seeing it as the operator rather than as a buyer? */
  readonly asOperator: boolean;
}

/**
 * ⚠️ An operator holds no grant, so without a preview they could never look at
 * the last week of their own product. `operatorPreviewsUnlocked` (on by
 * default) gives them a clock at the beginning of time — everything open, and
 * the page says so. Switching it off makes them see exactly what a fresh buyer
 * sees, which is the other legitimate thing to want.
 */
export async function courseAccessFor(
  memberId: string,
  role: string | null,
  course: Pick<Course, "planKeys">,
): Promise<CourseAccess> {
  // 🚨 **The COURSE is a parameter now, not a config read.** An app may hold
  // several, each sold on its own, so "may this person in" has no answer
  // without saying in to WHAT. A default would have let every existing caller
  // keep the old meaning silently, and the old meaning is "whoever passed one
  // course's gate passes them all".
  const { planKeys } = course;
  const { operatorPreviewsUnlocked } = courseConfig();
  const owner = isOwner(role);

  if (owner) {
    return {
      entitled: true,
      startedAt: operatorPreviewsUnlocked ? new Date(0) : await earliestStart(memberId, planKeys),
      asOperator: true,
    };
  }

  // No plan key at all is a broken config, which `courseConfigProblems()`
  // already reports and `gate.ts` leaves reachable for the operator. Answering
  // "not entitled" here rather than throwing keeps a member on the honest path.
  if (planKeys.length === 0) return { entitled: false, startedAt: null, asOperator: false };

  // 🚨 **ANY of them, never all of them.** One offering is one Digistore24
  // product per billing interval, so a course sold monthly and yearly is two
  // keys — and asking only the first would leave the yearly buyer outside a
  // course they paid for. Same sentence as `mayEnterGroup()` in the community
  // and `mayAccess()` in the media layer.
  //
  // 🚨 `hasPlan()` throws on a key the product registry does not know. That is
  // deliberate and it is why every key is validated when the config is read: an
  // unchecked value takes the page down rather than meaning "no access".
  const startedAt = await earliestStart(memberId, planKeys);
  return { entitled: startedAt !== null, startedAt, asOperator: false };
}

/**
 * When this member's clock started — the EARLIEST active grant across the
 * course's keys, or `null` when they hold none of them.
 *
 * ⚠️ **Earliest, and it decides the drip.** A member who bought monthly in
 * January and switched to yearly in June holds two keys, and their week ten is
 * ten weeks after JANUARY: they have been in the course since then, and a
 * clock restarted by an upgrade would take back nine weeks somebody already
 * paid for. `planStartedAt()` answers `null` for a key with no ACTIVE grant, so
 * a suspended plan drops out of the comparison rather than pinning the clock.
 *
 * It doubles as the entitlement answer, which is why there is no separate
 * `hasPlan()` loop: holding a key and having a start are the same fact here,
 * and two walks over the same list are two chances for them to disagree.
 */
async function earliestStart(
  memberId: string,
  planKeys: readonly string[],
): Promise<Date | null> {
  let earliest: Date | null = null;
  for (const key of planKeys) {
    const startedAt = await planStartedAt(memberId, key);
    if (startedAt && (earliest === null || startedAt < earliest)) earliest = startedAt;
  }
  return earliest;
}
