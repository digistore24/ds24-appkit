// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { and, sql } from "drizzle-orm";
import { db } from "@/db";
import { communityPosts } from "../schema";

/**
 * When a post last CHANGED state — the ordering key of a live answer's second
 * half, as SQL.
 *
 * `'epoch'` rather than `NULL` for the untouched case, because `GREATEST`
 * ignores NULLs in Postgres but a row that has never changed still has to sort
 * somewhere, and before everything is the only honest place.
 *
 * ⚠️ **Used in `WHERE` and `ORDER BY` only, never selected.** A `sql<Date>`
 * comes back from the driver as a string wearing a `Date`'s type
 * (`db/sql-cast.test.ts` measures exactly that), so the value that becomes a
 * cursor is computed by {@link changedAt} from the typed columns instead. Two
 * restatements of one rule, which is why `live-parity.test.ts` runs both over
 * the same matrix.
 */
export const CHANGED_AT = sql`greatest(coalesce(${communityPosts.deletedAt}, 'epoch'), coalesce(${communityPosts.editedAt}, 'epoch'), coalesce(${communityPosts.hiddenAt}, 'epoch'))`;

/**
 * A `Date` bound against {@link CHANGED_AT}, carrying a column's own converter.
 *
 * 🚨 The WRITE side of the rule the comment above states for reads, and it is
 * not symmetry for its own sake: a raw `sql\`${CHANGED_AT} > ${someDate}\``
 * hands postgres.js the `Date` OBJECT — there is no column on that side of the
 * comparison to convert it, and `drizzle()` has replaced the driver's own date
 * serialisers with `(val) => val` because it means to convert at the column —
 * so the object travels straight into a function that wants a string and throws
 * `TypeError: The "string" argument must be … Received an instance of Date`.
 * Measured on Postgres 16 with Node 22.22.1, postgres 3.4.9, drizzle-orm 0.45.2:
 * the same shape that took the setup surface's two-act apply down (A71).
 * `CHANGED_AT` is `greatest(deletedAt, editedAt)`, so `editedAt` is the column
 * whose converter is the right one to borrow — the same trick `.mapWith()` is
 * for reads. `db/sql-date-param.test.ts` keeps the raw shape out.
 */
export const changedAtParam = (at: Date) => sql.param(at, communityPosts.editedAt);
