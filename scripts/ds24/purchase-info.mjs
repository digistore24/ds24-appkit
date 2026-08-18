#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What does Digistore24 say about this order? (read-only)
//
// `getPurchase` takes an ORDER id and returns Digistore24's own view of it: the
// status, the product, the buyer, the billing type, the next payment and the
// management links (invoice, receipt, cancel, update payment details). The API
// calls that parameter `purchase_id` and documents it as "the Digistore24 order
// id" — so passing an order id here is correct, and there is no other id to
// pass: the IPN sends no `purchase_id` field at all
// (lib/digistore/payment-event.ts).
//
// This exists so that "the purchase worked but nothing happened in the app" can
// be ANSWERED rather than guessed. There are two sides to that sentence, and
// they need different fixes:
//
//   - Digistore24 does not know the order  → the purchase did not happen, or it
//     happened in another vendor account. Nothing about this app is broken.
//   - Digistore24 knows it and the app does not → the order exists, was paid,
//     and no IPN arrived here. That is the IPN connection: wrong URL (a tunnel
//     that has since closed), a `domain_id` another project overwrote, or a
//     `product_ids` list this product is not in. `node run.mjs ds24-ipn` is the
//     fix, `node run.mjs ds24-ipn-verify` is for a signature that was rejected.
//
// Whether THIS app saw it is the second half, and the app's own answer is
// `/dashboard/admin/purchases` (or the `ipn_events` table). This script only
// asks Digistore24.
//
// Read-only: it calls no function that changes anything, so there is no
// --apply and no dry run.
//
// Usage:
//   node scripts/ds24/purchase-info.mjs --order ABC12345
//   node scripts/ds24/purchase-info.mjs --order ABC12345 --json
//   node run.mjs ds24-purchase --order ABC12345
// Env: DIGISTORE_API_KEY.
import { ds24Call, requireApiKey, parseArgs } from "./_client.mjs";

const args = parseArgs(process.argv.slice(2));
const orderId = args.order ?? args.purchase ?? args.id;

if (typeof orderId !== "string" || !orderId.trim()) {
  console.error(
    "ERROR: --order <order id> required.\n" +
      "  The order id from the thank-you page, the buyer's mail, or the\n" +
      "  orders.ds24PurchaseId column — which holds an order id.",
  );
  process.exit(2);
}

const apiKey = requireApiKey();

let data;
try {
  data = await ds24Call("getPurchase", apiKey, { purchase_id: orderId.trim() });
} catch (err) {
  // An unknown id is a normal answer here, not a crash: it is half of what this
  // script is for. Say which of the two it is instead of printing a stack.
  console.error(`✗ Digistore24 did not return this order: ${err.message}`);
  console.error(
    "  Either the id does not exist, or it belongs to a different Digistore24\n" +
      "  account than the DIGISTORE_API_KEY in this .env.",
  );
  process.exit(1);
}

const purchase = data?.purchase ?? data ?? {};

if (args.json) {
  console.log(JSON.stringify(purchase, null, 2));
  process.exit(0);
}

const show = (label, value) => {
  if (value === undefined || value === null || value === "") return;
  console.log(`  ${label.padEnd(18)} ${value}`);
};

console.log(`Digistore24 order ${purchase.purchase_id ?? purchase.id ?? orderId}`);
show("Status", purchase.status);
show("Product", `${purchase.product_name ?? "?"} (id ${purchase.product_id ?? "?"})`);
show("Buyer", purchase.email ?? purchase.buyer_email);
show("Billing", purchase.billing_type ?? purchase.billing_interval);
show("Amount", [purchase.amount, purchase.currency].filter(Boolean).join(" "));
show("Paid until", purchase.pay_until ?? purchase.paid_until);
show("Next payment", purchase.next_payment_at);
show("Cancelled", purchase.is_canceled_now);
show("API mode", purchase.api_mode);
show("Invoice", purchase.invoice_url);
show("Receipt", purchase.receipt_url);
show("Stop rebilling", purchase.rebilling_stop_url);
show("Payment details", purchase.renew_url);

console.log(
  "\nThis is what DIGISTORE24 holds. What this app made of it is\n" +
    "/dashboard/admin/purchases — if the order is here and not there, no IPN\n" +
    "arrived: check the connection with `node run.mjs ds24-ipn`.\n" +
    "Everything Digistore24 returned: --json",
);
