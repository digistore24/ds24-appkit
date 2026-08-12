// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module offers the server — the `ModuleEntry` the generated registry
// collects.
import { eq } from "drizzle-orm";

import type { ModuleEntry, ModuleEraseTx } from "@/lib/modules/types";
import privacy from "./privacy/sections";
import { activityResults } from "./schema";

const activity: ModuleEntry = {
  id: "activity",
  privacy,

  /**
   * What a member wrote here, emptied when they delete their account.
   *
   * 🚨 The row itself is NOT deleted, and that is the difference between this
   * and the cascade `schema.ts` already carries. `state` is the learner's own
   * work — their answers, their resume point — and it is theirs. The rest of
   * the row is a number about an attempt, and an app that dropped it would lose
   * its own record of how an activity performed.
   *
   * Runs whether or not the module is switched on: an erasure request is about
   * the DATA, not about which features are currently enabled.
   */
  async eraseFor(tx: ModuleEraseTx, memberId: string) {
    await tx
      .update(activityResults)
      .set({ state: null, subject: "" })
      .where(eq(activityResults.memberId, memberId));
  },
};

export default activity;
