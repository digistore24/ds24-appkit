// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module offers the server — the `ModuleEntry` the generated registry
// collects.
import { eq } from "drizzle-orm";

import type { ModuleEntry, ModuleEraseTx, ModuleViewer } from "@/lib/modules/types";
import { isOwner } from "@/lib/roles";
import privacy from "./privacy/sections";
import { isMetricsSwitchedOn } from "./lib/config";
import { metricsEvents } from "./schema";

const metrics: ModuleEntry = {
  id: "metrics",
  privacy,

  /**
   * Whether the sidebar shows the operator's entry.
   *
   * Costs nothing: a config read and a role check, no database. A module that
   * ships off has to be free, or "off" is only a word.
   *
   * ⚠️ The WIDE question (`isMetricsSwitchedOn()`), not `isMetricsEnabled()`.
   * The page diagnoses a broken config, so an entry that vanished in exactly
   * that state would take away the door to the only screen naming the bad
   * value — `CLAUDE.md` → UI, rule 3.
   */
  async shellState(viewer: ModuleViewer) {
    if (!isMetricsSwitchedOn()) return {};
    return { features: { metricsAdmin: isOwner(viewer.role) } };
  },

  /**
   * Take the person out of the record, and leave the record.
   *
   * 🚨 The row survives, and that is the decision rather than an oversight.
   * "Eleven people reached step two in March" is a fact about the PRODUCT; the
   * eleven names are what the member is entitled to have removed. Nulling the
   * link does exactly that: the count keeps working, the person is gone, and
   * nothing in either table can point back at them.
   *
   * The FK is already `set null`, so the database would do this by itself when
   * the user row goes. It is written out anyway because relying on that would
   * be relying on the ORDER of two statements inside somebody else's
   * transaction — and because an erasure that only happens as a side effect is
   * one nobody can point at when asked.
   *
   * Runs whether or not the module is switched on: an erasure request is about
   * the DATA, not about which features are currently enabled.
   */
  async eraseFor(tx: ModuleEraseTx, memberId: string) {
    await tx
      .update(metricsEvents)
      .set({ memberId: null })
      .where(eq(metricsEvents.memberId, memberId));
  },
};

export default metrics;
