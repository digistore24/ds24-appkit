// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The app's door to the DEV preview grants — the two lines a sign-in path calls.
//
// The decision lives next door in `preview.mjs` (why the owner needs a real
// grant, and when she does not get one). This file is the adapter and nothing
// else: it hands that function the app's database client and the Product Keys
// the registry declares, and it makes a failure NON-FATAL.
//
// It exists so that `auth.ts` and `lib/auth/dev-login.ts` — the two places an
// account comes into being — say the same thing. The two used to be the classic
// pair that drifts: the magic link creates its row through the Auth.js adapter,
// the development login inserts its own, and a rule written twice is a rule
// that is soon written differently.
//
// 🚨 Why the keys are handed IN rather than read inside `preview.mjs`: a
// bundled module cannot resolve a path relative to its own source file, so the
// registry read that works for the setup scripts would be looking inside
// `.next/` here. `sellableProducts()` is the app's own reader and applies the
// same `sell !== false` rule.
import { db } from "@/db";
import { appEnv } from "@/lib/env-guard";

/**
 * Give the owner a manual grant for everything this app sells — DEV only, and
 * never at the cost of a sign-in.
 *
 * ⚠️ AWAITED by its callers, deliberately: fire-and-forget would let the first
 * page render before the grants exist, and the first page an owner opens after
 * the account is created is exactly the one that would then say "no access" —
 * the defect this was written for, reproduced by the fix.
 *
 * The try/catch is the same shape as the purchase claim in `auth.ts`: this runs
 * inside account creation, and a database hiccup here must degrade to "no
 * preview grants yet, try the next sign-in", never to "cannot sign in".
 */
export async function grantDevPreviewGrants(memberId: string): Promise<void> {
  // Called on account creation AND on every owner sign-in through the
  // development login: an owner made by `db-seed`, by `user-create` before
  // this existed, or promoted in the admin area has no creation moment this
  // code saw, and a product added to the registry after her first sign-in
  // needs topping up. Idempotent, one cheap query per product, DEV only —
  // reviewed 2026-09-15, the first cut ran on creation alone.
  try {
    const { ensureOperatorPreviewGrants } = await import("./preview.mjs");
    const { sellableProducts } = await import("@/lib/digistore/products");

    // The app classifies its own APP_ENV with the one reader it has; the
    // decision is not repeated inside preview.mjs (its header says why).
    const result = await ensureOperatorPreviewGrants({
      memberId,
      dev: appEnv(process.env.APP_ENV) === "development",
      db,
      productKeys: sellableProducts().map((p) => p.key),
    });

    // Only when something was actually written. A line on every sign-in would
    // train the reader to skip it, and the interesting event is the first one.
    // ("granted" in result) is also the STAGING/PROD exit: there the call
    // answers `{ skipped: "not-dev" }` and nothing is said at all.
    if ("granted" in result && result.granted.length > 0) {
      console.info(
        `[dev-preview] member=${memberId} granted=${result.granted.join(",")} — the owner can use what she sells; revoke under Users → that account`,
      );
    }
  } catch (error) {
    console.error(
      `[dev-preview] FAILED for member=${memberId} — the owner may see "no access" on her own chat, activities, rooms and courses:`,
      error,
    );
  }
}
