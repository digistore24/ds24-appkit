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
//
// ── Only ONE of the two tables is here, and that is not an omission ─────────
// `metrics_daily` carries no member column and no way back to a person: it is
// the count of a day, kept after the events behind it have been pruned. There
// is nothing in it to hand anybody, which is exactly why it may outlive them.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import type { ModulePrivacy } from "@/lib/modules/privacy";
import { metricsEvents } from "../schema";

const privacy: ModulePrivacy = {
  sections: ["metricsEvents"],

  async build(memberId: string) {
    // Behavioural data — when this person reached which milestone, and which
    // side of a split test they were on while doing it. They are entitled to
    // see the variant: being sorted into an experiment is something that
    // happened TO them, and an export that hid it would answer a narrower
    // question than the one that was asked.
    const rows = await db
      .select({
        event: metricsEvents.event,
        experiment: metricsEvents.experiment,
        variant: metricsEvents.variant,
        occurredAt: metricsEvents.occurredAt,
      })
      .from(metricsEvents)
      .where(eq(metricsEvents.memberId, memberId))
      .orderBy(asc(metricsEvents.occurredAt));

    // The key is always present — an empty array for a member who triggered
    // nothing, never an absent heading. An absent heading reads as "this
    // application has no such thing", which is a claim about the data rather
    // than about this member.
    return { metricsEvents: rows };
  },
};

export default privacy;
