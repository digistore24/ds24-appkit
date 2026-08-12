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
import { hasPlan, planStartedAt } from "@/lib/entitlements/manage";
import { isOwner } from "@/lib/roles";

import { courseConfig } from "./config";

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
export async function courseAccessFor(memberId: string, role: string | null): Promise<CourseAccess> {
  const { productKey, operatorPreviewsUnlocked } = courseConfig();
  const owner = isOwner(role);

  if (owner) {
    return {
      entitled: true,
      startedAt: operatorPreviewsUnlocked
        ? new Date(0)
        : productKey
          ? await planStartedAt(memberId, productKey)
          : null,
      asOperator: true,
    };
  }

  // No product key is a broken config, which `courseConfigProblems()` already
  // reports and `gate.ts` leaves reachable for the operator. Answering "not
  // entitled" here rather than throwing keeps a member on the honest path.
  if (!productKey) return { entitled: false, startedAt: null, asOperator: false };

  // 🚨 `hasPlan()` throws on a key the product registry does not know. That is
  // deliberate and it is why the key is validated when the config is read: an
  // unchecked value takes the page down rather than meaning "no access".
  const entitled = await hasPlan(memberId, productKey);
  return {
    entitled,
    startedAt: entitled ? await planStartedAt(memberId, productKey) : null,
    asOperator: false,
  };
}
