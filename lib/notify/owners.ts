// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Who "the operator" is, when the app has something to say to them.
//
// Until this file the tree had exactly one owner query and it COUNTED —
// `countOwners()` in `lib/users/manage.ts`, for the last-owner rule. This is the
// other question: not how many, but which addresses.

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

export interface OperatorRecipient {
  id: string;
  /** Never null — the query drops the rows that have none. */
  email: string;
  name: string | null;
}

/**
 * Every operator this app can reach, oldest account first.
 *
 * ── Why all three conditions, one at a time ────────────────────────────────
 *
 *  · **All owners, not one.** There may legitimately be several — the tree
 *    already assumes it, or `countOwners()` and the `lastOwnerDelete` rule
 *    (`lib/users/rules.ts`) would not need to exist. "The oldest one" was
 *    considered and rejected: account age says something about the order people
 *    signed up in, not about who is responsible, so an app that changed hands
 *    would write to its previous owner for ever with nobody the wiser.
 *  · **No blocked account.** `blockedAt` is the withdrawal of access
 *    (`lib/users/blocked.ts`), and somebody whose access was withdrawn is not
 *    somebody this app still sends its operational post to.
 *  · **No row without an address.** `users.email` is nullable
 *    (`db/schema-core.ts`), and a row with no address is not a recipient with a
 *    problem — it is not a recipient.
 *
 * ── And the narrowing is in the QUERY ──────────────────────────────────────
 * Not a `filter()` afterwards. Same rule the community's moderation page writes
 * out: "a page that fetched everything and rendered a subset would have shipped
 * the rest in its own payload." Here the payload is a process's memory rather
 * than a browser's, which makes it a smaller sin and the same one.
 *
 * It takes NO argument and returns no role. Who gets written to is decided by
 * this query, never by a caller — the same shape that makes `spendTokens()`
 * impossible to point at somebody else's account.
 */
export async function operatorRecipients(): Promise<OperatorRecipient[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.role, "owner"), isNull(users.blockedAt), isNotNull(users.email)))
    .orderBy(asc(users.createdAt));

  // `isNotNull` already settled this; the map is what carries it into the type,
  // since Drizzle infers the column's nullability from the schema and not from
  // the where clause.
  return rows.map((row) => ({ id: row.id, email: row.email as string, name: row.name }));
}
