// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Digistore24-specific tables (kept domain-neutral).
//
// orders:           every order billed through Digistore24 plus its status
//                   (driven by IPN events). ds24OrderId is unique →
//                   idempotency.
// buyUrlCache:      generated checkout URLs, shared and time-limited.
//
// The Digistore24 credentials are NOT here but in the environment
// (DIGISTORE_API_KEY, DIGISTORE_IPN_PASSPHRASE) — see
// lib/digistore/settings.ts. The app bills through exactly one Digistore24
// account. Customer-owned rows reference `users` as `memberId` (the buyer);
// there is no operator column — one installation bills through one Digistore24
// account, so namespacing rows by vendor bought nothing but a trap.
import {
  pgTable,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  pgEnum,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./schema-core";

// Status machine of an order, driven by Digistore24 IPN events.
export const orderStatusEnum = pgEnum("order_status", [
  "paid", // on_payment / on_payment_subscription_signup
  "refunded", // on_refund
  "chargeback", // on_chargeback
  "paused", // on_payment_missed
  "cancelled", // last_paid_day / on_rebill_cancelled
]);

export const orders = pgTable("orders", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // The CUSTOMER this purchase belongs to — null while unattributed.
  //
  // Deliberately NOT `cascade`, unlike every other reference to `users` in this
  // schema: deleting a customer must not delete their orders. Those rows are
  // financial records with refund history and GDPR consent timestamps, and
  // deleting a user is one click away in the admin UI. `set null` leaves the
  // order behind as unattributed, which is a state the system handles anyway.
  memberId: text("member_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // Digistore24 order ID — unique, for idempotency of incoming IPN calls.
  ds24OrderId: text("ds24_order_id").notNull().unique(),
  ds24ProductId: text("ds24_product_id"),
  // The handle createBillingOnDemand charges against, and the key a grant is
  // keyed on. Without it a later claim could credit the balance but could never
  // restore the auto top-up mandate the customer paid for.
  //
  // It holds the Digistore24 **order id** — the API's own `purchase_id`
  // parameter is documented as "the Digistore24 order id", and the IPN sends
  // no other. See lib/digistore/payment-event.ts for why the column is not
  // named after what it carries.
  ds24PurchaseId: text("ds24_purchase_id"),
  // WHAT was bought, resolved at payment time and stored — never reconstructed
  // later. The registry cannot be reverse-looked-up: product ids are null
  // until `node run.mjs ds24-sync` runs, so matching on them resolves the first
  // unsynced product, and `credits` is read live so a later edit would change
  // what a claim credits.
  productKey: text("product_key"),
  credits: integer("credits"),
  status: orderStatusEnum("status").notNull(),
  // Buyer data from the IPN payload.
  buyerEmail: text("buyer_email"),
  buyerFirstName: text("buyer_first_name"),
  buyerLastName: text("buyer_last_name"),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  currency: text("currency"),
  // Whether Digistore24 placed this buyer in a GDPR country (`is_gdpr_country`
  // in the IPN body, Y/N, `null` when the field was absent). Written from the
  // payload; nothing in the app decides anything on it today. It is worth
  // keeping because it answers "was this person in the EEA at the time of the
  // purchase" from the record itself rather than from a guess about the address.
  //
  // There used to be a `gdpr_consent_at` beside it, described as "set once the
  // opt-in happened". Nothing ever set it: this template's thank-you page is a
  // router and deliberately prompts for nothing (`app/optin/[orderId]/page.tsx`).
  // A consent now belongs in `consent_records` (`db/schema-consent.ts`), which
  // records WHICH purpose and WHICH text version was agreed to and can be
  // withdrawn — none of which a lone timestamp on an order can express. Two
  // stores for one question is how they end up disagreeing.
  isGdprCountry: boolean("is_gdpr_country"),
  // Digistore24-hosted management links from the IPN payload, shown to the
  // member on /dashboard/billing. Per-order (per-subscription) and stable-ish;
  // the latest non-empty value wins. NOT money and NOT an access decision —
  // just deep links back to Digistore24's own pages.
  rebillingStopUrl: text("rebilling_stop_url"), // cancel the subscription
  renewUrl: text("renew_url"), // update the payment details
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // The claim and the Operator's unattributed-list both filter on member_id.
  // (The claim's hot path is a PARTIAL expression index added by hand in the
  // migration, on lower(btrim(buyer_email)) where member_id is null — drizzle's
  // DSL cannot express it.)
  index("orders_member").on(t.memberId),
  // Read on every activate: the entitlement layer checks whether this purchase
  // was already refunded before creating a grant (lib/entitlements/manage.ts).
  // Without this the IPN seq-scans `orders` on every payment.
  index("orders_purchase").on(t.ds24PurchaseId),
  // The Operator's purchase list: `createdAt DESC, ds24OrderId DESC`, one page
  // at a time (`listOrders`). Unfiltered, that is the whole table sorted to
  // show twenty rows — this makes it read twenty.
  index("orders_created").on(t.createdAt),
]);

// Every IPN Digistore24 delivers, recorded at the edge for the Operator's
// "IPN-Log" (app/dashboard/admin/purchases). Deliberately a DIAGNOSTIC log, not
// a financial record — the order is that (see `orders`). It answers "did the
// webhook arrive and what did we do with it?", which the order table cannot,
// because a rejected or malformed IPN never becomes an order.
//
// The indexed columns (event, order/purchase id, result) are PII-free and safe
// to show. `payload` is the exception: it holds the FULL raw IPN body verbatim,
// buyer PII and all, so a rejected or mis-signed webhook can be diagnosed after
// the fact (recompute the signature, see exactly what arrived). It never holds
// a SECRET — the passphrase is not in the payload, and `sha_sign` is a hash,
// not a key. Because it is PII, retention is bounded: the prune job deletes rows
// older than 60 days (scripts/db/prune-ipn-log.mjs, /api/cron/prune-ipn-log).
export const ipnResultEnum = pgEnum("ipn_result", [
  "accepted", // signature valid, handed to onPaymentEvent, processed OK
  "invalid_signature", // SHA512 check failed — rejected with 403
  "connection_test", // Digistore24's setup/connection probe — answered OK
  "not_configured", // no passphrase set yet — rejected with 403
  "error", // valid signature, but processing threw → 500 (DS24 will retry)
]);

export const ipnEvents = pgTable(
  "ipn_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    // The event name from the payload — UNTRUSTED and informational. Recorded
    // even for a rejected signature, where it is whatever the caller claimed.
    event: text("event"),
    ds24OrderId: text("ds24_order_id"),
    ds24PurchaseId: text("ds24_purchase_id"),
    signatureValid: boolean("signature_valid").notNull(),
    result: ipnResultEnum("result").notNull(),
    // Short, human-readable note (e.g. an error message). Never PII or secrets.
    detail: text("detail"),
    // The FULL raw request body (application/x-www-form-urlencoded), verbatim.
    // The one field that lets a bad signature be diagnosed: recompute over
    // exactly what arrived. Contains buyer PII → pruned after 60 days.
    payload: text("payload"),
  },
  (t) => [
    // The log is read newest-first; the list query orders by received_at desc.
    index("ipn_events_received").on(t.receivedAt),
  ],
);

// One row per PAYMENT, not per order: a subscription bills repeatedly and
// Digistore24 issues a fresh invoice (invoice_url) for every charge. Keyed by
// the DS24 transaction id so a retried IPN can never double a row.
//
// It references the order by `ds24OrderId` and carries NO member column on
// purpose: the member is found through orders.member_id, so an invoice needs no
// backfill when an unattributed purchase is later claimed. The member's billing
// page joins the two (lib/digistore/billing.ts) and scopes on the order.
export const invoices = pgTable(
  "invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ds24OrderId: text("ds24_order_id").notNull(),
    // Digistore24's per-payment transaction id — the idempotency key.
    ds24TransactionId: text("ds24_transaction_id").notNull().unique(),
    invoiceUrl: text("invoice_url").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency"),
    // Digistore24's rebill counter: 1 = the initial payment, 2+ = each rebill.
    paySequenceNo: integer("pay_sequence_no"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The billing page fetches all invoices for a member's orders at once.
    index("invoices_order").on(t.ds24OrderId),
  ],
);

// Cache for generated checkout URLs (createBuyUrl).
// Key = offerKey. offerHash detects offer changes: if the offering changes, a
// new hash results → a new URL. Plus a TTL.
export const buyUrlCache = pgTable(
  "buy_url_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Stable offer key (e.g. "gold", "pro_yearly").
    offerKey: text("offer_key").notNull(),
    // sha256 over the DS24-relevant offer fields.
    offerHash: text("offer_hash").notNull(),
    url: text("url").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("buy_url_cache_offer").on(t.offerKey)],
);
