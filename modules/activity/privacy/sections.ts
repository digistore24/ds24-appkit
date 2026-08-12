// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module answers about one person, for the member's own download.
//
// The twin is `sections.mjs` — the operator's command is bare Node and cannot
// import TypeScript, so the same query exists twice, in Drizzle and in raw SQL.
// Both declare the same `sections`, and `scripts/modules/privacy.test.ts`
// compares them with the manifest: two files answering one Art. 15 question is
// the shape that drifts, and it has drifted in this app before.
//
// 🚨 Neither half asks whether this module is switched on. Switching a module
// off deletes nothing, and an export says what the app HOLDS. The only thing
// that may make this section absent is the MODULE being absent — and
// `module remove` refuses while these tables still hold rows.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import type { ModulePrivacy } from "@/lib/modules/privacy";
import { activityResults } from "../schema";

const privacy: ModulePrivacy = {
  sections: ["activityResults"],

  async build(memberId: string) {
    // Learning performance — data about a person's ABILITY, which is why it is
    // in this file at all (docs/data-protection.md §8b). The resume `state` is
    // included: it is the server's record of THEIR work.
    const rows = await db
      .select({
        activityId: activityResults.activityId,
        subject: activityResults.subject,
        state: activityResults.state,
        score: activityResults.score,
        maxScore: activityResults.maxScore,
        passed: activityResults.passed,
        attempts: activityResults.attempts,
        startedAt: activityResults.startedAt,
        updatedAt: activityResults.updatedAt,
        completedAt: activityResults.completedAt,
      })
      .from(activityResults)
      .where(eq(activityResults.memberId, memberId))
      .orderBy(asc(activityResults.startedAt));

    // The key is always present — an empty array for a member who never
    // attempted anything, never an absent heading. An absent heading reads as
    // "this application has no such thing", which is a claim about the data
    // rather than about this member.
    return { activityResults: rows };
  },
};

export default privacy;
