// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Billing models beyond one-off and recurring purchases:
//
//  - subscriptions:  a customer's recurring subscription. Holds the DS24
//                    `purchase_id` (for stopRebilling + createBillingOnDemand)
//                    and the management links DS24 supplies (change payment
//                    details, cancel, invoice). Status and interval are
//                    maintained through IPN events.
//  - tokenAccounts:  prepaid balance per customer (whole-number "tokens" /
//                    credits for usage-based AI use), including auto top-up.
//  - tokenLedger:    an append-only, immutable booking journal. Every top-up
//                    and booking is one row; top-ups are idempotent by
//                    ds24OrderId (one IPN must never credit twice).
//
// Customers are identified by `memberId` — the signed-in user, not their email
// address. An address is a mutable attribute of a person; their id is not, and
// keying money on something the owner can change is how a balance detaches
// from the person who paid for it.
import {
  pgTable,
  text,
  timestamp,
  date,
  boolean,
  integer,
  numeric,
  pgEnum,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema-core";

// Status of a subscription, driven by DS24 IPN events.
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", // on_payment(_subscription_signup) / on_rebill_resumed
  "paused", // on_payment_missed
  "cancelled", // on_rebill_cancelled / last_paid_day
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // DS24 purchase_id — the basis for stopRebilling & createBillingOnDemand.
    // Globally unique: one subscription per purchase.
    ds24PurchaseId: text("ds24_purchase_id").notNull(),
    // Original order ID (link to `orders`).
    ds24OrderId: text("ds24_order_id"),
    ds24ProductId: text("ds24_product_id"),
    // The CUSTOMER this subscription belongs to — null while unattributed.
    //
    // Added because keying the mirror on buyerEmail alone is the weak identity
    // the rest of the app has already replaced: an address is mutable, and no
    // claim path would ever repair the row. Digistore24 does not redeliver an
    // event it already acknowledged, and there is no reconciliation job (AD-8),
    // so a subscription bought while signed out would keep member_id NULL
    // forever. Filled at payment time and by both claim paths.
    //
    // `set null` to match orders.memberId: deleting a customer must not delete
    // the record that a subscription existed.
    memberId: text("member_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Customer (identical to orders.buyerEmail). KEPT: it is the mirror's
    // record of what Digistore24 actually saw. memberId answers "whose", this
    // answers "what was entered".
    buyerEmail: text("buyer_email"),
    status: subscriptionStatusEnum("status").notNull(),
    // e.g. "1_month" | "12_month". Determines monthly/yearly.
    billingInterval: text("billing_interval"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency"),
    // When the next charge falls due — DISPLAY ONLY (story 2.5). Access is
    // decided in `grants` by event, never by this date (AD-1, AD-2).
    //
    // A `date`, NOT a `timestamp`, and read back as a STRING. Digistore24 types
    // next_payment_at as a date (~/digistore-api/updatePurchase.php:26): a
    // calendar day, no time, no zone. As a timestamp, midnight UTC of
    // 2026-08-21 renders as 20 August for every viewer behind UTC — an
    // off-by-one on the one number the Member is shown. `mode: "string"` keeps
    // the day out of the Date/timezone machinery entirely; the single place
    // that has to build a Date for the formatter pins the zone back to UTC
    // (lib/digistore/next-payment.ts).
    //
    // NULLed again whenever the billing stops — see BILLING_STOPPED_EVENTS.
    // A stale date advertising a charge that will never come is worse than no
    // date at all.
    nextPaymentAt: date("next_payment_at", { mode: "string" }),
    // Management links supplied by DS24 (from the IPN or getPurchase).
    // Change payment details: renewUrl. Cancel: rebillingStopUrl.
    // Invoice: invoiceUrl.
    renewUrl: text("renew_url"),
    rebillingStopUrl: text("rebilling_stop_url"),
    invoiceUrl: text("invoice_url"),
    supportUrl: text("support_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("subscriptions_purchase").on(t.ds24PurchaseId),
    index("subscriptions_email").on(t.buyerEmail),
    index("subscriptions_member").on(t.memberId),
  ],
);

export const tokenAccounts = pgTable(
  "token_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The CUSTOMER this balance belongs to.
    //
    // `set null`, not cascade: cascading would delete the balance AND — through
    // tokenLedger's cascade on accountId — the entire append-only booking
    // journal, because an admin deleted a customer. The record that money
    // moved outlives the account it moved for.
    memberId: text("member_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Current balance in tokens/credits (never negative).
    balance: integer("balance").notNull().default(0),
    // --- Auto top-up ---------------------------------------------------------
    autoReloadEnabled: boolean("auto_reload_enabled").notNull().default(false),
    // Threshold: when balance <= threshold, a top-up is triggered.
    autoReloadThreshold: integer("auto_reload_threshold").notNull().default(0),
    // Which package (key from lib/tokens/packages.ts) gets topped up.
    autoReloadPackageKey: text("auto_reload_package_key"),
    // DS24 purchase_id charged via createBillingOnDemand.
    ds24PurchaseId: text("ds24_purchase_id"),
    // Concurrency lock against double charging: set before the
    // billing-on-demand call, released once the IPN has booked the credit (or
    // stale after the timeout).
    reloadLockedAt: timestamp("reload_locked_at"),
    lastReloadAt: timestamp("last_reload_at"),
    // How many on-demand charges have been fired since the last one that came
    // back as a booked credit.
    //
    // This column exists because the 6h stale-lock timeout above is BOTH the
    // recovery from a crashed process AND, when an IPN never arrives at all,
    // the metronome of a repeating charge: the card is billed, the balance is
    // never credited, so `shouldAutoReload` stays true, and six hours later the
    // slot is taken over and the card is billed again — four times a day, under
    // Digistore24's 10/day cap, so nothing outside this app ever stops it.
    //
    // Nothing in that sequence looks like an error. Every charge SUCCEEDS.
    // The only anomaly is a credit that does not arrive, and before this column
    // nothing watched for it.
    //
    // Incremented inside `claimReloadSlot`'s own atomic UPDATE, so it can never
    // drift from the lock it counts. Reset to 0 exactly where `lastReloadAt` is
    // set — the one event that proves the whole chain works — and when a Member
    // re-arms auto top-up themselves.
    reloadAttempts: integer("reload_attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("token_accounts_member").on(t.memberId)],
);

// Kind of booking in the journal.
export const tokenLedgerTypeEnum = pgEnum("token_ledger_type", [
  "topup", // Gutschrift nach bezahltem Paket (IPN)
  "consume", // Verbrauch (KI-Nutzung)
  "refund", // refund/reversal
  "adjust", // manuelle Korrektur
]);

export const tokenLedger = pgTable(
  "token_ledger",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => tokenAccounts.id, { onDelete: "cascade" }),
    type: tokenLedgerTypeEnum("type").notNull(),
    // Signed amount: + for topup/refund/upward adjust, − for consume.
    amount: integer("amount").notNull(),
    // Balance after this booking (audit trail).
    balanceAfter: integer("balance_after").notNull(),
    // DS24 order ID of the triggering payment — makes credits idempotent.
    ds24OrderId: text("ds24_order_id"),
    note: text("note"),
    // WHO booked this by hand. Set only for `type = 'adjust'` (story 3.2); NULL
    // for everything the IPN or a consumption writes, which has no operator.
    //
    // Named and typed after the precedent on `grants.issuedBy`, deliberately —
    // one name for one concept. Without a column of its own the Operator ends
    // up inside `note` as "Operator alice@x.de: reason", which is unjoinable,
    // loses the `set null`, and welds actor and reason into one string nobody
    // can split later.
    //
    // `set null`, and with NO constraint demanding it: deleting an Operator
    // must stay possible, and a NOT NULL CHECK would turn that delete into an
    // aborted transaction the Operator reads as "unknown error" — the trap
    // migration 0012 was written to warn about. The rule that an adjustment
    // needs a reason and an actor lives in lib/tokens/rules.ts, not here; a
    // CHECK demanding `note` would additionally let an append-only journal
    // block a GDPR erasure.
    issuedBy: text("issued_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // How the crediting purchase was initiated — "sub", "topup" or "auto" —
    // read from the `k:` pair in tracking[custom]. A NULLABLE COLUMN, not a
    // new `type` enum member: splitting `topup` in two would silently break
    // every `where type = 'topup'`. Null for a legacy or unlabelled credit.
    origin: text("origin"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // A paid package (ds24OrderId) must only ever be credited once.
    unique("token_ledger_topup_order").on(t.accountId, t.ds24OrderId),
    // ...and once GLOBALLY, not merely once per account.
    //
    // The composite key above is only as stable as the ACCOUNT is, and it is
    // not: both `tokenAccounts.memberId` and `orders.memberId` are `set null`
    // on delete. Delete a Member and let them register again under the same
    // address, and the sign-in claim re-attributes their orders into a SECOND
    // account — where (newAccount, sameOrder) collides with nothing and every
    // top-up they ever bought is credited a second time.
    //
    // One Digistore24 order is one payment and is bookable once, whichever
    // account it lands in. Partial because only top-ups carry an order id.
    //
    // The migration for this is HAND-WRITTEN (0016): drizzle emits the
    // predicate with qualified column names, which Postgres rejects in a
    // CREATE INDEX — and `db:migrate` prints the error and then reports
    // success, so the index silently does not exist and every credit 500s on
    // an unmatched ON CONFLICT.
    uniqueIndex("token_ledger_topup_order_global")
      .on(t.ds24OrderId)
      .where(sql`${t.ds24OrderId} is not null and ${t.type} = 'topup'`),
    // The read path is always "this account, newest first" — the Tokens tab
    // (`listLedgerFor`) and the Operator's member page both order by
    // `createdAt DESC` and take a page. With `accountId` alone Postgres finds
    // the account's rows and then sorts them; carrying `createdAt` means it
    // reads them already in order and stops at the page size. Journals are the
    // one kind of table where that difference grows for ever.
    index("token_ledger_account_created").on(t.accountId, t.createdAt),
  ],
);
