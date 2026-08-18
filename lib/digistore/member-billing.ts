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
import { orders, invoices } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

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
  const invoiceUrl = body["invoice_url"] || "";
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
