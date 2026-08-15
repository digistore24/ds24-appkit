// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Token packages (prepaid credit) — derived from the central product registry
// (`config/digistore-products.json`, kind = "token"). One package = one DS24
// product; the `productId` comes from the registry (via
// lib/digistore/products.ts).
//
// The `key` is stable and appears as "tokens:<key>" in the DS24 `custom` field,
// so the IPN handler can match a payment to a credit.
import { getProduct, isSold, productsByKind, type ProductDef } from "@/lib/digistore/products";

export interface TokenPackage {
  key: string;
  title: string;
  credits: number;
  priceCents: number;
  currency: string;
}

function toTokenPackage(p: ProductDef): TokenPackage {
  if (p.kind !== "token" || typeof p.credits !== "number") {
    throw new Error(`Product "${p.key}" is not a token package.`);
  }
  return {
    key: p.key,
    title: p.name,
    credits: p.credits,
    priceCents: p.priceCents ?? 0,
    currency: p.currency ?? "EUR",
  };
}

/**
 * The token packages ON OFFER — parked ones (`"sell": false`) are left out.
 *
 * ⚠️ `getTokenPackage()` below deliberately does NOT filter: it answers about
 * a package somebody already bought, and the automatic top-up runs on a
 * mandate that was armed while it was still on sale. Taking a package off
 * offer must not silently stop charging a member who asked to be charged.
 */
export function listTokenPackages(): TokenPackage[] {
  return productsByKind("token").filter(isSold).map(toTokenPackage);
}

/** Returns a token package, or throws (unknown, or not a token product). */
export function getTokenPackage(key: string): TokenPackage {
  return toTokenPackage(getProduct(key));
}

/** Builds the DS24 custom marker the IPN uses to match up a credit. */
export function tokenCustomMarker(key: string): string {
  return `tokens:${key}`;
}

/**
 * Parses the custom marker from an IPN payload back into a package key.
 * Returns null when it is not a token purchase.
 */
export function parseTokenCustomMarker(custom: string | undefined): string | null {
  if (!custom) return null;
  const m = /^tokens:([A-Za-z0-9_-]+)$/.exec(custom.trim());
  return m ? m[1] : null;
}
