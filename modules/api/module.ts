// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module offers the server — the `ModuleEntry` the generated registry
// collects.
import { eq } from "drizzle-orm";

import type { ModuleEntry, ModuleEraseTx } from "@/lib/modules/types";
import privacy from "./privacy/sections";
import { apiKeys } from "./schema";

const api: ModuleEntry = {
  id: "api",
  privacy,

  /**
   * What a member wrote here, emptied when they delete their account.
   *
   * ⚠️ **This one looks pointless and is not.** `api_keys.member_id` cascades,
   * so the row is on its way out anyway — but the cascade fires when the `users`
   * row goes, and this runs BEFORE it, inside the same transaction. What it
   * removes is the one thing on the row the member wrote themselves: the name
   * ("Claude on my laptop"). Between the two there is no window, and if a later
   * change ever makes a key survive its owner — a retention rule, an audit
   * copy — the sentence they typed does not survive with it.
   *
   * `ModuleEraseTx` is deliberately `update` and nothing else, so this cannot
   * delete rows out from under the cascade even if somebody wanted it to.
   *
   * Runs whether or not the API is switched ON: an erasure request is about the
   * DATA, not about which features are currently enabled.
   */
  async eraseFor(tx: ModuleEraseTx, memberId: string) {
    await tx.update(apiKeys).set({ name: "" }).where(eq(apiKeys.memberId, memberId));
  },
};

export default api;
