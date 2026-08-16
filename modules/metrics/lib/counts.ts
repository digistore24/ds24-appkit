// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How many rows this module holds — nothing else.
//
// 🚨 **NARROW on purpose, and the narrowness is enforced.** The presence
// contributor next door is composed into `lib/modules/presence-registry.ts`,
// which the content plan reaches, and `lib/content/applier-plan.test.ts`
// asserts over that whole import closure that a plan can call nothing which
// WRITES an object. A counting helper pulled out of a module's general
// `manage.ts` drags the media store's `put`/`copy`/`remove` onto that path —
// which the community module shipped once, leaving every app that installed it
// with a permanently red test suite.
//
// So: `@/db`, drizzle, this module's schema. Nothing else, ever.
import { count } from "drizzle-orm";

import { db } from "@/db";
import { metricsEvents, metricsDaily } from "../schema";

/** How many milestone rows exist at all. */
export async function countEvents(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(metricsEvents);
  return row?.n ?? 0;
}

/** How many rolled-up day rows exist at all. */
export async function countDaily(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(metricsDaily);
  return row?.n ?? 0;
}
