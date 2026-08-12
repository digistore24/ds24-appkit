// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's purchases, invoices and next payment — the billing page's
// reads, over HTTP.
//
// Strictly read-only: nothing here changes a subscription. The two URLs a
// client may present (`rebillingStopUrl`, `renewUrl`) are Digistore24's own
// self-service pages, the same links the billing page renders — billing state
// changes at Digistore24 and arrives back via IPN, never through this app's
// API.
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";
import { sellsPlans } from "@/lib/billing-mode";
import { listBillingForMember } from "@/lib/digistore/member-billing";
import { nextPaymentForMember } from "@/lib/digistore/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  // `sellsPlans()` mirrors the dashboard: the mode is cosmetic and MUST NOT
  // gate data a member already holds — orders are returned regardless — but a
  // "next payment" teaser in an app that sells no plans is noise.
  const [orders, nextPaymentAt] = await Promise.all([
    listBillingForMember(g.memberId),
    sellsPlans() ? nextPaymentForMember(g.memberId) : Promise.resolve(null),
  ]);

  return apiJson({
    // A plain calendar date ("2026-09-01") from Digistore24, not a timestamp —
    // passed through as-is; a client renders it pinned to UTC like the
    // dashboard does (lib/digistore/next-payment.ts → NEXT_PAYMENT_FORMAT).
    nextPaymentAt,
    orders: orders.map((order) => ({
      ds24OrderId: order.ds24OrderId,
      productKey: order.productKey,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      rebillingStopUrl: order.rebillingStopUrl,
      renewUrl: order.renewUrl,
      invoices: order.invoices.map((invoice) => ({
        id: invoice.id,
        invoiceUrl: invoice.invoiceUrl,
        amount: invoice.amount,
        currency: invoice.currency,
        paySequenceNo: invoice.paySequenceNo,
        createdAt: invoice.createdAt.toISOString(),
      })),
    })),
  });
}
