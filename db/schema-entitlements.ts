// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Entitlements — the app's own answer to "may this person use this".
//
// Deliberately NOT in schema-digistore.ts. That file is the Digistore24
// MIRROR: rows that exist because Digistore24 told us something. `grants` is
// the opposite — the app owns access, Digistore24 owns money (AD-1). A grant
// outlives the event that created it, and Epic 3 issues grants that never had
// a Digistore24 event at all. Putting them beside the mirror would blur exactly
// the line that keeps `entitlementsFor()` reading ONE table.
//
// Re-exported from db/schema.ts like the other domain files, so `@/db/schema`
// stays the single import path and drizzle-kit sees everything.
import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema-core";

// Where a grant came from. Never changes for the life of a row — which is what
// makes it safe for the provenance CHECK to constrain on it (see the migration).
export const grantSourceEnum = pgEnum("grant_source", [
  "purchase", // written by the Digistore24 adapter, from a paid purchase
  "manual", // issued by the Operator (Epic 3)
]);

export const grants = pgTable(
  "grants",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The customer this entitlement belongs to.
    //
    // `cascade`, NOT `set null` — unlike orders.memberId. The column is
    // notNull (AD-3: an unattributed purchase lives in `orders` and nowhere
    // else), and notNull + set null is a contradiction Postgres does not
    // reject at migration time: it rejects it at DELETE time, with a 23502 the
    // Operator sees as "deleting this user failed" and cannot explain. Epic 3
    // deletes users. A grant without its member entitles nobody anyway.
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A key from config/digistore-products.json. Stored, never reverse-looked-up
    // at read time: the registry is editable and its product ids are null until
    // `node run.mjs ds24-sync` has run.
    productKey: text("product_key").notNull(),
    source: grantSourceEnum("source").notNull(),
    // Provenance for source = 'purchase'. The DS24 purchase id, so a later
    // refund/cancellation event finds the grant it must close.
    ds24PurchaseId: text("ds24_purchase_id"),
    // Provenance for source = 'manual' — history, not a constraint. `set null`
    // so deleting the Operator who issued it stays possible; the CHECK in the
    // migration therefore constrains on `source`, not on this column.
    issuedBy: text("issued_by").references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    // NULL for EVERY purchase grant, without exception (AD-2): purchased
    // access ends by event, never by date. Manual grants may set it.
    accessUntil: timestamp("access_until"),
    // Missed payment — reversible, cleared on resume (Story 2.4).
    suspendedAt: timestamp("suspended_at"),
    // Refund · chargeback · last_paid_day · revoke. Terminal for the adapter:
    // no Digistore24 event ever clears it (Stories 2.2, 2.3).
    endedAt: timestamp("ended_at"),
    // WHY it ended — `refund` | `chargeback` | `lastPaidDay` | (Epic 3)
    // `revoked`. Not decoration, and not reconstructible after the fact:
    //
    //   - "ended" alone cannot tell a refund from a normal expiry, and the two
    //     call for opposite support responses (Epic 3's Operator view);
    //   - `endedAt` is terminal (see above), so a WRONGLY ended grant can only
    //     be diagnosed from the reason;
    //   - `last_paid_day` after a refund is a legitimate sequence, and the
    //     first-writer-wins rule in lib/entitlements/manage.ts would otherwise
    //     silently discard which of the two closed it.
    //
    // Nullable because a LIVE grant has none — not because it is optional when
    // ending. Deliberately plain text, not an enum: Epic 3 and any later
    // reason would each need a migration of the enum type, and this column is
    // read by people, never branched on by access logic.
    endedReason: text("ended_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // One grant per purchase and Product Key — the idempotency key that lets
    // the IPN and the claim pass both offer the same grant safely.
    //
    // PARTIAL on purpose. ds24PurchaseId is NULL for every manual grant, and
    // Postgres treats NULLs as distinct: without the WHERE the index would be
    // silently vacuous for manual grants while still being the only thing AC 5
    // promises. Same trap as migration 0011.
    uniqueIndex("grants_purchase_product")
      .on(t.ds24PurchaseId, t.productKey)
      .where(sql`${t.ds24PurchaseId} is not null`),
    // The read path: entitlementsFor(memberId), and listGrantsFor on the
    // Operator's member page.
    index("grants_member").on(t.memberId),
    // `hasPlan(memberId, productKey)` — the check on every gated page and in
    // every gated route handler. It is the most-called query in the app after
    // the session lookup, and it names both columns.
    index("grants_member_product").on(t.memberId, t.productKey),
  ],
);
