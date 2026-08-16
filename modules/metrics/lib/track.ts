// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one place a milestone is written. Everything else in this module reads.
//
// ── Server-side only, and that is a legal position rather than a preference ─
// There is no pixel, no beacon and no `localStorage` anywhere in this module,
// and there must never be one. This app needs no consent banner because a
// purchase runs on Art. 6(1)(b) and nothing it puts on the device goes beyond
// what is strictly necessary (`docs/compliance.md` § 2). A tracker that wrote
// to the device would move the app under § 25 TDDDG and cost it that position
// — for a number this function already has, on the server, where the thing
// actually happened.
//
// ── It never throws, and never delays ──────────────────────────────────────
// 🚨 `track()` is called from inside real work: a purchase handler, an
// onboarding step, a form somebody just submitted. A measurement that can fail
// the thing it measures is worse than no measurement, so every error is
// swallowed after being logged. The same rule `ai_usage` follows — recording
// never fails a call.
import { db } from "@/db";
import { metricsEvents } from "../schema";
import { isMetricsEnabled, experimentById } from "./config";
import { variantFor } from "../rules.mjs";

export interface TrackOptions {
  /**
   * The split test running around this milestone, by id from
   * `modules/metrics/config.json`. The variant is derived from the member — never
   * passed in, so a caller cannot report a side the member was not on.
   */
  readonly experiment?: string;
}

/**
 * Record that a member reached a milestone.
 *
 * `memberId` may be null for something that happened before anybody signed in.
 * The row is still worth having — it is the top of the funnel — it simply
 * belongs to nobody and can never be exported or erased, because there is
 * nothing to tie it to.
 *
 * ⚠️ **Call it where the thing HAPPENS, once.** The funnel counts distinct
 * members, so a duplicate does not bend a percentage; it does widen the gap
 * between `members` and `events` in the rolled-up day, which is the signal that
 * a call site fires more often than whoever put it there believed.
 */
export async function track(
  event: string,
  memberId: string | null,
  options: TrackOptions = {},
): Promise<void> {
  if (!isMetricsEnabled()) return;

  try {
    let experiment = "";
    let variant = "";
    if (options.experiment && memberId) {
      const declared = experimentById(options.experiment);
      if (declared) {
        const side = variantFor(memberId, declared);
        // `null` means nobody can be assigned — every weight at zero, or no
        // usable variant. Recording no experiment is the honest answer; a
        // default side would put this member in a test they are not in.
        if (side) {
          experiment = declared.id;
          variant = side;
        }
      }
    }

    await db.insert(metricsEvents).values({ event, memberId, experiment, variant });
  } catch (error) {
    // Logged, not raised — see the header.
    console.error(`[metrics] could not record "${event}":`, error);
  }
}
