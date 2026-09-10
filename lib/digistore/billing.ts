// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Usage-based and subscription billing through Digistore24, beyond
// createBuyUrl:
//
//  - createBillingOnDemand: charges another payment against an EXISTING
//    purchase_id (the customer's payment method is already authorized). This is
//    how prepaid token packages are repurchased / auto-topped-up — WITHOUT a
//    new checkout.
//  - stopRebilling: cancels a subscription (stops the recurring payments).
//  - getPurchase / listPurchases: fetch subscription status and management
//    links (change payment details, view invoice).
//
// Prerequisites for createBillingOnDemand (see docs/digistore-billing-modes.md):
//   1. The initial purchase must have been created with
//      settings[force_rebilling]=Y (Offer.forceRebilling in buyUrl.ts) OR be an
//      active subscription.
//   2. A writable API key + the "billing on demand" right in the DS24 account.
//   3. DS24 limits: 10 charges/day and 1/minute per purchase_id (production).
//
// Like createBuyUrl: errors throw — NO silent mock fallback (a failed charge
// must never count as a success).
import { ds24Post } from "./client";
import { ds24HttpsUrl } from "./safe-url";

export interface BillOnDemandArgs {
  /** The customer's DS24 purchase_id being charged. */
  purchaseId: string;
  /** DS24 product ID of the (token) package being billed. */
  productId: string;
  /** Price in cents. */
  priceCents: number;
  /** Currency, default "EUR". */
  currency?: string;
  /** Quantity (e.g. several packages at once), default 1. */
  quantity?: number;
  /**
   * Context that arrives in the IPN under `custom` — e.g.
   * "tokens:<packageKey>", so the IPN handler can match up the credit.
   */
  custom?: string;
  affiliate?: string;
}

export interface BillOnDemandResult {
  /** New purchase ID of the created charge. */
  createdPurchaseId: string;
  /** DS24 payment status (e.g. "paid"). */
  paymentStatus: string;
  /** DS24 billing status (e.g. "completed"). */
  billingStatus: string;
  paidAmount?: string;
  currency?: string;
  /** Empty when paid immediately; otherwise a payment link for open amounts. */
  payUrl: string;
}

function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Builds the x-www-form-urlencoded body for createBillingOnDemand (pure,
 * testable). number_of_installments=1 → a one-off extra charge (not a new
 * subscription).
 */
export function buildBillOnDemandBody(args: BillOnDemandArgs): URLSearchParams {
  const body = new URLSearchParams();
  body.set("purchase_id", args.purchaseId);
  body.set("product_id", args.productId);

  const price = euros(args.priceCents);
  body.set("payment_plan[first_amount]", price);
  // One-off extra charge: no follow-up amounts.
  body.set("payment_plan[other_amounts]", "0.00");
  body.set("payment_plan[currency]", args.currency ?? "EUR");
  body.set("payment_plan[number_of_installments]", "1");

  body.set("settings[quantity]", String(args.quantity ?? 1));

  if (args.custom) body.set("tracking[custom]", args.custom);
  if (args.affiliate) body.set("tracking[affiliate]", args.affiliate);

  return body;
}

/**
 * Charges a payment against an existing purchase_id via createBillingOnDemand.
 * Throws on error. The token credit does NOT happen here but only once DS24
 * confirms the purchase via IPN (on_payment) — just like a normal purchase.
 */
export async function createBillingOnDemand(
  apiKey: string,
  args: BillOnDemandArgs,
): Promise<BillOnDemandResult> {
  const params = Object.fromEntries(buildBillOnDemandBody(args).entries());
  const res = await ds24Post("createBillingOnDemand", apiKey, params);
  const d = (res.data ?? {}) as Record<string, unknown>;
  const createdPurchaseId = String(d.created_purchase_id ?? "");
  if (!createdPurchaseId) {
    throw new Error("Digistore24 returned no created_purchase_id.");
  }
  return {
    createdPurchaseId,
    paymentStatus: String(d.payment_status ?? ""),
    billingStatus: String(d.billing_status ?? ""),
    paidAmount: d.paid_amount != null ? String(d.paid_amount) : undefined,
    currency: d.currency != null ? String(d.currency) : undefined,
    payUrl: String(d.pay_url ?? ""),
  };
}

/**
 * Cancels a subscription: stops the recurring payments (rebilling) for a
 * purchase_id. Access usually remains until the end of the paid period (DS24
 * then sends `last_paid_day`). Throws on error.
 */
export async function stopRebilling(
  apiKey: string,
  purchaseId: string,
): Promise<void> {
  await ds24Post("stopRebilling", apiKey, { purchase_id: purchaseId });
}

/** Raw data of a DS24 purchase (subset). */
export interface PurchaseInfo {
  purchaseId: string;
  productId?: string;
  buyerEmail?: string;
  /** "Y" when the subscription is cancelled. */
  isCanceledNow: boolean;
  /** e.g. "1_month" | "12_month". */
  billingInterval?: string;
  amount?: string;
  currency?: string;
  // Management links (to link to the customer).
  renewUrl?: string;
  rebillingStopUrl?: string;
  invoiceUrl?: string;
  receiptUrl?: string;
  supportUrl?: string;
}

function toPurchaseInfo(d: Record<string, unknown>): PurchaseInfo {
  const s = (k: string): string | undefined =>
    d[k] != null && d[k] !== "" ? String(d[k]) : undefined;

  // Every URL-shaped field of a purchase, whitelisted to `https:` HERE — at
  // the point where a foreign system's answer becomes one of our own values,
  // not at the point where somebody renders it.
  //
  // 🚨 **Why here and not in the UI.** All five of these are management deep
  // links that end up as an `href` a customer clicks
  // (`app/dashboard/billing/ui.tsx`), and a `javascript:` in `renew_url` would
  // run on that click. Today exactly one page renders them; the whitelist
  // belongs at the reader because the SECOND page to render them will not
  // remember to bring one, and nothing goes red when it does not. That is the
  // tree's stated doctrine for hrefs — see the comment in
  // `modules/community/components/post-body.tsx`, which says every `href` gets
  // a scheme whitelist.
  //
  // ⚠️ **All five, not the three that were reported.** `receipt_url` and
  // `support_url` reach the same kind of sink through the same answer; a
  // whitelist that covers three of five fields is not a rule, it is a list
  // somebody has to keep current, and the two left out are exactly the ones a
  // later page will render.
  //
  // This is gated behind the SHA512 signature check / an API key over HTTPS,
  // so exploiting it needs a compromise on Digistore24's side — it is a LOW
  // finding, fixed because the cost is four lines and the alternative is
  // trusting a third party's string all the way into an anchor tag.
  //
  // Dropped, not thrown: the UI renders each of these conditionally, so an
  // `undefined` hides the button cleanly, whereas a throw would take out the
  // whole billing page over a cosmetic link. The log line is what keeps that
  // from being silent — a missing "cancel subscription" button otherwise looks
  // exactly like Digistore24 not having sent one.
  // The scheme whitelist lives in `./safe-url` because the IPN writes the same
  // three columns through a different door — see that file's header.
  const httpUrl = (k: string): string | undefined => ds24HttpsUrl(k, s(k));

  return {
    purchaseId: String(d.purchase_id ?? d.id ?? ""),
    productId: s("product_id"),
    buyerEmail: s("email") ?? s("buyer_email"),
    isCanceledNow: String(d.is_canceled_now ?? "") === "Y",
    billingInterval: s("other_billing_intervals") ?? s("billing_interval"),
    amount: s("amount"),
    currency: s("currency"),
    renewUrl: httpUrl("renew_url"),
    rebillingStopUrl: httpUrl("rebilling_stop_url"),
    invoiceUrl: httpUrl("invoice_url"),
    receiptUrl: httpUrl("receipt_url"),
    supportUrl: httpUrl("support_url"),
  };
}

/**
 * Reads a single purchase (subscription status + management links). Useful for
 * fetching missing renew_url/rebilling_stop_url/invoice_url, which do not
 * always come along in the IPN.
 */
export async function getPurchase(
  apiKey: string,
  purchaseId: string,
): Promise<PurchaseInfo> {
  const res = await ds24Post("getPurchase", apiKey, { purchase_id: purchaseId });
  return toPurchaseInfo((res.data ?? {}) as Record<string, unknown>);
}

/**
 * Lists purchases/subscriptions (paginated). For "view invoices" and
 * subscription overviews. `filter` accepts DS24 filters such as
 * { email, billing_type: "subscription" }.
 */
export async function listPurchases(
  apiKey: string,
  filter: Record<string, string> = {},
): Promise<PurchaseInfo[]> {
  const res = await ds24Post("listPurchases", apiKey, filter);
  const data = (res.data ?? {}) as Record<string, unknown>;
  const rows = (data.purchases ?? data.list ?? []) as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => toPurchaseInfo(r as Record<string, unknown>));
}
