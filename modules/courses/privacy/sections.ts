// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module answers about one person, for the member's own download.
//
// The twin is `sections.mjs` — the operator's command is bare Node and cannot
// import TypeScript, so the same query exists twice. Both declare the same
// `sections`, and `scripts/modules/privacy.test.ts` compares them with the
// manifest: two files answering one Art. 15 question is the shape that drifts.
//
// 🚨 Neither half asks whether the course is switched on. Switching a module off
// deletes nothing, and an export says what the app HOLDS.
//
// ⚠️ The course's CONTENT is not here, and that is not an omission. Blocks and
// units are the operator's material — they say nothing about the member. What
// belongs to the person is where they got to and what they handed in.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import type { ModulePrivacy } from "@/lib/modules/privacy";
import { coursesCompletions, coursesSubmissions } from "../schema";

const privacy: ModulePrivacy = {
  sections: ["coursesCompletions", "coursesSubmissions"],

  async build(memberId: string) {
    const completions = await db
      .select({
        unitSlug: coursesCompletions.unitSlug,
        completedAt: coursesCompletions.completedAt,
      })
      .from(coursesCompletions)
      .where(eq(coursesCompletions.memberId, memberId))
      .orderBy(asc(coursesCompletions.completedAt));

    // Their own text AND the answer they were given: a workshop's reply is
    // written to this person and is part of what the app holds about them.
    // `repliedBy` is NOT included — who the coach was is a third party's
    // identity, and Art. 15(4) is the reason the raw IPN bodies are out of the
    // member's copy too.
    const submissions = await db
      .select({
        unitSlug: coursesSubmissions.unitSlug,
        body: coursesSubmissions.body,
        submittedAt: coursesSubmissions.submittedAt,
        reply: coursesSubmissions.reply,
        repliedAt: coursesSubmissions.repliedAt,
      })
      .from(coursesSubmissions)
      .where(eq(coursesSubmissions.memberId, memberId))
      .orderBy(asc(coursesSubmissions.submittedAt));

    // Both keys always present — an empty array for somebody who never started,
    // never an absent heading. An absent heading reads as "this application has
    // no such thing", which is a claim about the app rather than this member.
    return { coursesCompletions: completions, coursesSubmissions: submissions };
  },
};

export default privacy;
