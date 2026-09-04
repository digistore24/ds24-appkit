// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// Why a member is standing on the plans page. A gated page sends the member
// who is not entitled here — `redirect("/plans?needs=<productKey>")` — and
// without a word the page reads as "the price list", not as "this is what the
// page you clicked is waiting for". Measured on a field-test app: the two core
// pages redirected here silently, and the customer had to guess.
//
// The parameter carries a REFERENCE the registry knows, never a sentence
// (`docs/ux.md` § 2 — a URL carrying words is a URL anybody can hand somebody
// else to make the app say whatever they typed). A key the registry does not
// hold, or one that is parked, says nothing at all.

import { findProduct, isSold, type ProductDef } from "@/lib/digistore/products";

/** The query parameter a gated page sets when it sends the member here. */
export const PLANS_NEEDS_PARAM = "needs";

/** Product Keys are the registry's own identifiers — lowercase, digits, underscores. */
const KEY_SHAPE = /^[a-z0-9_]{1,64}$/;

/**
 * The product the page should name, or `null` when there is nothing to say.
 *
 * `lookup` is injectable so the rule is testable without the registry; the
 * page passes nothing and gets the real one.
 */
export function neededProduct(
  raw: string | string[] | undefined,
  lookup: (key: string) => ProductDef | null = findProduct,
): ProductDef | null {
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !KEY_SHAPE.test(key)) return null;
  const def = lookup(key);
  return def && isSold(def) ? def : null;
}
