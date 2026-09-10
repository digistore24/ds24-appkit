// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's own billing view: their purchases, the invoices Digistore24
// issued for each payment, and the DS24-hosted links to cancel a subscription
// or update payment details.
//
// These links come straight from the IPN payload (invoice_url,
// rebilling_stop_url, renew_url) — no DS24 API call needed. That is separate
// from lib/digistore/billing.ts, which drives subscriptions through the API
// (createBillingOnDemand, stopRebilling); this file only stores and shows what
// the webhook already delivered.
//
// Everything here is scoped to ONE member. The page (app/dashboard/billing)
// passes the signed-in member's id, and listBillingForMember filters on
// orders.member_id — the row that carries attribution. Never widen this to a
// buyer email or an order id from the request: that is the IDOR that would let
// one customer read another's invoices.
import { db } from "@/db";
import { orders, invoices, subscriptions } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ds24HttpsUrl } from "./safe-url";

import type { IpnParams } from "./ipn";
import { findProduct } from "./products";
import { purchaseNotice, type PurchaseNotice } from "./purchase-notice";

export interface InvoiceInsert {
  ds24OrderId: string;
  ds24TransactionId: string;
  invoiceUrl: string;
  amount: string | null;
  currency: string | null;
  paySequenceNo: number | null;
}

// Pure: the invoice a payment IPN carries, or null if it carries none. A
// refund, a chargeback or a support-resumed event has no invoice_url /
// transaction_id — those return null and add no row. Split out so the mapping
// is testable without a database.
export function invoiceRowFromIpn(body: IpnParams): InvoiceInsert | null {
  const ds24OrderId = body["order_id"] || "";
  // The scheme whitelist: this URL is rendered as a download link. A value that
  // is not https is dropped here, which makes the row `null` below and the
  // invoice simply absent — see ./safe-url.
  const invoiceUrl = ds24HttpsUrl("invoice_url", body["invoice_url"]) ?? "";
  const ds24TransactionId = body["transaction_id"] || "";
  // All three are load-bearing: without the transaction id there is no
  // idempotency key, and without a URL there is nothing to download.
  if (!ds24OrderId || !invoiceUrl || !ds24TransactionId) return null;

  const seqRaw = Number(body["pay_sequence_no"]);
  return {
    ds24OrderId,
    ds24TransactionId,
    invoiceUrl,
    amount: body["transaction_amount"] || body["amount"] || null,
    currency: body["transaction_currency"] || body["currency"] || null,
    paySequenceNo: Number.isFinite(seqRaw) ? seqRaw : null,
  };
}

export interface BillingInvoice {
  id: string;
  invoiceUrl: string;
  amount: string | null;
  currency: string | null;
  paySequenceNo: number | null;
  createdAt: Date;
}

export interface BillingOrder {
  ds24OrderId: string;
  productKey: string | null;
  status: string;
  amount: string | null;
  currency: string | null;
  createdAt: Date;
  rebillingStopUrl: string | null;
  renewUrl: string | null;
  /**
   * Digistore24's own page for changing the billing interval of this
   * subscription — monthly to yearly and back.
   *
   * It comes off the `subscriptions` mirror rather than `orders`, and it leads
   * somewhere only because the product carries several PAYMENT PLANS, one per
   * way to pay (`scripts/ds24/sync-products.mjs`). Offering it saves building an
   * upgrade flow for the commonest change a subscriber makes: the switch happens
   * over there and comes back as an ordinary rebill, on the same Product Key.
   */
  switchIntervalUrl: string | null;
  /**
   * Which way to pay this subscription runs on ("monthly", "yearly").
   * DISPLAY ONLY — both are the same Product Key and the same entitlement.
   */
  paymentOption: string | null;
  invoices: BillingInvoice[];
}

// Every purchase of this member, newest first, each with its invoices (also
// newest first). Two queries and a group-by in memory — simpler than a join,
// and the invoice count per member is small.
export async function listBillingForMember(
  memberId: string,
): Promise<BillingOrder[]> {
  const orderRows = await db
    .select({
      ds24OrderId: orders.ds24OrderId,
      productKey: orders.productKey,
      status: orders.status,
      amount: orders.amount,
      currency: orders.currency,
      createdAt: orders.createdAt,
      rebillingStopUrl: orders.rebillingStopUrl,
      renewUrl: orders.renewUrl,
    })
    .from(orders)
    .where(eq(orders.memberId, memberId))
    .orderBy(desc(orders.createdAt));

  if (orderRows.length === 0) return [];

  const invoiceRows = await db
    .select({
      id: invoices.id,
      ds24OrderId: invoices.ds24OrderId,
      invoiceUrl: invoices.invoiceUrl,
      amount: invoices.amount,
      currency: invoices.currency,
      paySequenceNo: invoices.paySequenceNo,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .where(
      inArray(
        invoices.ds24OrderId,
        orderRows.map((o) => o.ds24OrderId),
      ),
    )
    .orderBy(desc(invoices.createdAt));

  // A third query rather than a join, the same trade the two above make: the
  // subscription mirror has at most one row per order and a member has few of
  // them. It is a LEFT-join in spirit — a one-off purchase has no row here and
  // simply gets nulls, which is what the UI renders as "nothing to manage".
  const subRows = await db
    .select({
      ds24OrderId: subscriptions.ds24OrderId,
      switchIntervalUrl: subscriptions.switchIntervalUrl,
      paymentOption: subscriptions.paymentOption,
    })
    .from(subscriptions)
    .where(eq(subscriptions.memberId, memberId));
  const subByOrder = new Map(
    subRows.filter((r) => r.ds24OrderId).map((r) => [r.ds24OrderId as string, r]),
  );

  const byOrder = new Map<string, BillingInvoice[]>();
  for (const row of invoiceRows) {
    const list = byOrder.get(row.ds24OrderId) ?? [];
    list.push({
      id: row.id,
      invoiceUrl: row.invoiceUrl,
      amount: row.amount,
      currency: row.currency,
      paySequenceNo: row.paySequenceNo,
      createdAt: row.createdAt,
    });
    byOrder.set(row.ds24OrderId, list);
  }

  return orderRows.map((o) => ({
    ...o,
    switchIntervalUrl: subByOrder.get(o.ds24OrderId)?.switchIntervalUrl ?? null,
    paymentOption: subByOrder.get(o.ds24OrderId)?.paymentOption ?? null,
    invoices: byOrder.get(o.ds24OrderId) ?? [],
  }));
}

/**
 * What to tell this member about one purchase of theirs — the confirmation
 * shown after they come back from checkout (`/optin/[orderId]` →
 * `/dashboard?purchase=…`). `null` when there is nothing to say.
 *
 * `ds24OrderId` COMES FROM THE REQUEST, which is exactly the case the header of
 * this file warns about. It is safe here for one reason only: the query filters
 * on `member_id` as well, so an order belonging to somebody else — or to nobody
 * yet — matches nothing and the caller says nothing. `memberId` comes from the
 * session and must never be taken from the URL beside it.
 *
 * The decision itself is a pure, tested rule (./purchase-notice.ts); this
 * function only fetches what that rule reads.
 */
export async function purchaseNoticeFor(
  memberId: string,
  ds24OrderId: string,
): Promise<PurchaseNotice | null> {
  const order = await db.query.orders.findFirst({
    columns: { status: true, productKey: true, credits: true },
    where: and(
      eq(orders.ds24OrderId, ds24OrderId),
      eq(orders.memberId, memberId),
    ),
  });

  return purchaseNotice(order, findProduct);
}
