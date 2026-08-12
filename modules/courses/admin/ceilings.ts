// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What may go into each of a lesson's four slots on THIS installation.
//
// 🚨 **One function, because the answer is not the same for all four and there
// are two readers.** Three slots travel THROUGH the app, so their ceiling is
// the lower of the kind's number and what a Server Action body may carry —
// `slotCeilingBytes()`, which is `next.config.ts`'s body limit rather than
// anything in `config/media.json`. The VIDEO goes straight to the bucket
// (Story 8.2), where no request body is involved at all, so its ceiling is the
// kind's own `maxBytes` — 2 GB, which is what a lesson recording needs.
//
// ⚠️ **It lives in a file of its own so that the page and the actions cannot
// disagree.** They did: `./page.tsx` made the fork and `./media-actions.ts`
// did not, so `ceilingFor("video")` answered 10 MB where the page showed 2 GB.
// It was harmless only because the number reaches exactly one sentence today —
// which is the shape `./media-actions.ts` condemns in its own header ("two ways
// into one slot with two different lids is the arrangement in which one of them
// is wrong"), waiting for whoever adds a second size refusal.
//
// `media-actions.ts` is `"use server"` and can export nothing but async
// functions, and `page.tsx` is a page — neither can hold this for the other.
import { mediaConfig } from "@/lib/media/config";
import { slotCeilingBytes } from "@/lib/media/rules";

import { COURSE_SLOTS, COURSE_SLOT_IDS, type CourseSlotId } from "../rules";

/** The ceiling for one slot, in bytes, on this installation. */
export function slotCeilingFor(slot: CourseSlotId): number {
  const kindMax = mediaConfig().kinds[COURSE_SLOTS[slot].kind].maxBytes;
  return slot === "video" ? kindMax : slotCeilingBytes(kindMax);
}

/** All four, for the surface that renders all four. */
export function slotCeilings(): Record<CourseSlotId, number> {
  return Object.fromEntries(COURSE_SLOT_IDS.map((slot) => [slot, slotCeilingFor(slot)])) as Record<
    CourseSlotId,
    number
  >;
}
