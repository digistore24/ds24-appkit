// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// THE PAYMENT PLANS OF A PRODUCT — one per way to pay, written from the same
// registry entry the product itself is written from.
//
// ── Why the plans exist at all ─────────────────────────────────────────────
// For a long time this template kept every price out of Digistore24 and sent
// it with each `createBuyUrl` call instead. That is still how an upgrade is
// priced, and the reasoning ("one price, one place") was never wrong. What it
// missed is that our checkout link is not the only way into the product:
//
//   - the product has an ORDER FORM of its own, which no link of ours touches;
//   - an affiliate can send traffic straight to it;
//   - the buyer can change their billing interval from inside their purchase
//     (`switch_pay_interval_url`, on every IPN) — and that switches to another
//     stored plan, so with none there is nothing to switch to;
//
// and all three charge whatever plans hang on the product. A product with no
// plan of ours does not have none: it has Digistore24s own default, about
// 27 EUR, and on a subscription such an order grants access for ever
// (docs/digistore-integration.md). Writing the plans is what closes that.
//
// ── So where does the price live now? ──────────────────────────────────────
// In the registry, still and only. This file COPIES it to Digistore24, the
// same way the product name and description are copied. The copy is what the
// buyer is charged, so the registry also records what each plan was written
// with (`setPayplan`) — and when the two drift apart, the checkout goes back
// to pricing itself inline rather than selling at a number nobody refreshed
// (lib/digistore/products.ts → payplanMatches).
//
// ── The one thing that is NOT symmetrical ──────────────────────────────────
// A plan is created, updated and DEACTIVATED, but only ever deleted under
// `--prune`. An active subscription is billed against the plan it was bought
// on; deleting that plan because somebody renamed a key in the registry would
// be a rebilling that stops. Deactivation takes it off the order form and
// leaves the money path alone.

import { isYes } from "./_client.mjs";

/** cents -> the two-decimal string Digistore24 expects. */
function euros(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * `data[...]` for createPaymentplan / updatePaymentplan from one way to pay.
 *
 * The installment rule is the same one `lib/digistore/buyUrl.ts` applies to
 * the inline plan, and it has to be: 0 means an open-ended subscription and 1
 * a single payment, so an interval that did not reach this function turns a
 * membership into a one-off sale — the buyer pays once and keeps the access.
 *
 * `position` carries the registry's declaration order onto the order form, so
 * the ways to pay are listed the way the vendor wrote them. `is_switching_
 * allowed` is what makes Digistore24s own interval switch work at all, and it
 * is only meaningful where there IS something to switch to.
 */
export function planData(option, { active = true, switchable = false } = {}) {
  const data = {
    "data[currency]": option.currency || "EUR",
    "data[position]": String(option.position ?? 0),
    "data[is_active]": active ? "Y" : "N",
  };
  if (option.priceCents != null) {
    data["data[first_amount]"] = euros(option.priceCents);
  }
  if (option.billingInterval) {
    data["data[other_amounts]"] = euros(option.priceCents ?? 0);
    data["data[first_billing_interval]"] = option.billingInterval;
    data["data[other_billing_intervals]"] = option.billingInterval;
    data["data[number_of_installments]"] = "0";
  } else {
    data["data[number_of_installments]"] = "1";
  }
  if (switchable) data["data[is_switching_allowed]"] = "Y";
  return data;
}

/**
 * Was this write accepted? Digistore24 answers every boolean as the STRING
 * "Y"/"N", both of which are truthy — `_client.test.ts` scans this folder for
 * anybody comparing one against `true`.
 */
export function planWasWritten(response) {
  if (!response || typeof response !== "object") return false;
  if (response.paymentplan_id || response.id) return true;
  return isYes(response.updated) || isYes(response.created);
}

/** The plan id out of a createPaymentplan answer. */
export function planIdOf(response) {
  return response?.paymentplan_id ?? response?.id ?? null;
}

/**
 * The plan work for ONE Digistore24 product, as a list of rows — pure, so the
 * decision of what to do is testable without an account.
 *
 * `recorded` is what the registry remembers for this product (option key ->
 * `{ id, … }`), `options` what it currently declares. Three kinds of row come
 * out, and the third is the one that needs the care:
 *
 *   create      a declared way to pay with no plan yet
 *   update      a declared way to pay that has one
 *   deactivate  a plan whose way to pay is GONE from the registry
 *
 * A deactivation is never a delete here. Somebody is being billed against that
 * plan, and this script cannot see who.
 */
export function planRows(options, recorded) {
  const rows = [];
  const switchable = options.length > 1;
  for (const option of options) {
    const existing = recorded?.[option.key] ?? null;
    rows.push({
      action: existing?.id ? "update" : "create",
      option,
      payplanId: existing?.id ?? null,
      switchable,
    });
  }
  const declared = new Set(options.map((o) => o.key));
  for (const [key, ref] of Object.entries(recorded ?? {})) {
    if (declared.has(key) || !ref?.id) continue;
    rows.push({
      action: "deactivate",
      option: { key, position: 0 },
      payplanId: String(ref.id),
      switchable,
    });
  }
  return rows;
}

/**
 * Applies the rows for one product. `call` is `ds24Call` bound to the API key;
 * `record` is how a fresh id gets back into the registry.
 *
 * Returns `{ created, updated, deactivated, skipped }` — skipped counts the
 * ways to pay that carry no price, which cannot become a plan and which
 * `checkDefinition` has already warned about by the time this runs.
 */
export async function applyPlanRows(
  rows,
  productId,
  { call, record, log = () => {} },
) {
  const result = { created: 0, updated: 0, deactivated: 0, skipped: 0 };
  for (const row of rows) {
    if (row.action !== "deactivate" && row.option.priceCents == null) {
      result.skipped += 1;
      log(
        `  · payment option "${row.option.key}" has no priceCents — no plan written`,
      );
      continue;
    }
    if (row.action === "deactivate") {
      await call("updatePaymentplan", {
        paymentplan_id: row.payplanId,
        ...planData(row.option, { active: false }),
      });
      result.deactivated += 1;
      log(
        `  · deactivated plan ${row.payplanId} ("${row.option.key}" is no longer in the registry)`,
      );
      continue;
    }
    const data = planData(row.option, { switchable: row.switchable });
    if (row.action === "update") {
      await call("updatePaymentplan", {
        paymentplan_id: row.payplanId,
        ...data,
      });
      result.updated += 1;
      record(row.option, row.payplanId);
      log(`  · plan ${row.payplanId} updated ("${row.option.key}")`);
      continue;
    }
    const created = await call("createPaymentplan", {
      product_id: String(productId),
      ...data,
    });
    const id = planIdOf(created);
    if (!id) {
      throw new Error(
        `createPaymentplan returned no paymentplan_id for "${row.option.key}".`,
      );
    }
    result.created += 1;
    record(row.option, id);
    log(`  · plan ${id} created ("${row.option.key}")`);
  }
  return result;
}
