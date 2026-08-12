// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module offers the server — the `ModuleEntry` the generated registry
// collects.
import { eq } from "drizzle-orm";

import type { ModuleEntry, ModuleEraseTx, ModuleViewer } from "@/lib/modules/types";
import { isOwner } from "@/lib/roles";
import privacy from "./privacy/sections";
import { coursesSubmissions } from "./schema";
import { isCourseEnabled, isCourseSwitchedOn } from "./lib/config";
import { hasWaitingSubmission } from "./lib/manage";

const courses: ModuleEntry = {
  id: "courses",
  privacy,

  /**
   * What the menu shows, and what it must not cost.
   *
   * 🚨 The switch is read FIRST, before any query. A switched-off course must
   * not put a database round-trip in front of every dashboard render, and it
   * must show nothing of itself anywhere. The early return keeps that property
   * whatever the two features below grow into.
   *
   * ⚠️ **The early return asks the NARROW question, and the two entries below
   * then disagree on purpose.** `isCourseSwitchedOn()` is true whenever the
   * operator turned the course on, including while the rest of the file does
   * not hold; `isCourseEnabled()` is false in that state. So:
   *
   *   * `courses` — the learner's entry — is false while the config is broken,
   *     exactly as it was when this returned early on `isCourseEnabled()`: a
   *     false feature is indistinguishable from an unreported one.
   *   * `coursesAdmin` is true, because the admin page DIAGNOSES the broken
   *     state instead of refusing in it. `CLAUDE.md` → UI, rule 3: a diagnosis
   *     page keeps its entry for the operator, or the menu leads the one person
   *     who can fix it to a 404.
   *
   * Role plays no part here, deliberately — `ownerOnly` on the nav entry is
   * what keeps the admin item away from a member, the same division
   * `communityAdmin` makes. Forking on the viewer here would be a second place
   * where the answer could differ from the page's own guard.
   *
   * ⚠️ **The DOT below does fork on the viewer, and the two features above
   * still do not.** The fork is a question of COST rather than of permission:
   * a member is never shown the operator's entry — `ownerOnly` on it is still
   * the only thing keeping it away — so asking the database on their behalf
   * would buy a signal nobody can see, on every protected page they open.
   * `badges` are HREFS and not numbers (`components/app-shell.tsx` turns them
   * into a `Set` and renders a dot), so the string here has to be byte-identical
   * to the one in `nav.ts` or the dot lands on nothing. And an impersonated
   * session IS the member: `role` reads `member` inside one, the short-circuit
   * declines to ask, and no carve-out on `viewer.impersonating` is needed —
   * unlike the community's private-message surfaces, which show an operator
   * something a member would rather they did not read.
   */
  async shellState(viewer: ModuleViewer) {
    if (!isCourseSwitchedOn()) return {};
    // Short-circuit, not an `if` above the query: the role check IS the cost
    // brake, and writing it as one expression is what keeps the two from
    // drifting apart.
    const waiting = isOwner(viewer.role) && (await hasWaitingSubmission());
    return {
      features: { courses: isCourseEnabled(), coursesAdmin: true },
      badges: waiting ? ["/dashboard/admin/course"] : [],
    };
  },

  /**
   * What a member wrote here, emptied when they delete their account.
   *
   * 🚨 **NOTHING of this module survives the account, answered or not.** Both
   * tables carry `member_id … on delete cascade` (`schema.ts`), so the
   * completions and every hand-in leave with the `users` row — and the reply
   * written to that person leaves with the hand-in it was written on.
   *
   * That is the ruling rather than an accident of the foreign keys, and
   * `lib/users/manage.ts` states the criterion a row has to meet to outlive its
   * author: *a post that is one turn in a conversation other people are still
   * having, a message that is one half of a correspondence whose other
   * participant keeps their own side.* A hand-in is neither. It is 1:1 between
   * one member and the operator, and the answer to it is written to that one
   * person — strip the text and what is left is a sentence about nothing.
   * `modules/activity/module.ts` shows the other case, where the remainder of
   * the row is a NUMBER about an attempt and the app would lose its own record
   * by dropping it. There is no such remainder here.
   *
   * ⚠️ **So why does this run at all?** For the reason `modules/api/module.ts`
   * gives for the same shape: it runs BEFORE the cascade, inside the same
   * transaction, and costs one statement. It takes out the one thing on the row
   * the member typed themselves, and if a later change ever lets a hand-in
   * survive its author — a retention rule, an audit copy of the workshop's own
   * record — the text does not survive with it. `ModuleEraseTx` is deliberately
   * `update` and nothing else, so this cannot delete rows out from under the
   * cascade even if somebody wanted it to.
   *
   * Runs whether or not the course is switched on: an erasure request is about
   * the DATA, not about which features are currently enabled.
   */
  async eraseFor(tx: ModuleEraseTx, memberId: string) {
    await tx
      .update(coursesSubmissions)
      .set({ body: "" })
      .where(eq(coursesSubmissions.memberId, memberId));
  },
};

export default courses;
