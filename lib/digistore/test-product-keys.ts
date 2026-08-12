// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The product keys the TESTS need — taken from THIS app's registry, never
// written into them.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// `config/digistore-products.json` ships with five EXAMPLE products, and
// CLAUDE.md tells the operator to throw away the ones they do not sell:
// *"Deleting the sample products you do not sell is part of setting the mode."*
// Several shipped tests then read a literal out of that file — `hasPlan()`
// throws on a key the registry does not hold, `planProblem()` refuses one, and
// `courseConfigProblems()` reports one — so an operator who did exactly what
// they were told got a red suite about products they never had. Measured in the
// field test of 2026-08-11 (one one-off product, nothing else): seven failures
// across four files, in modules the app had not even installed.
//
// So the key is looked UP instead. What the tests are actually asserting is a
// property of a SHAPE — "a key `hasPlan()` can answer" against "a token
// package, which it answers false for for ever" — and the shape survives the
// operator's edit even though the example key does not.
//
// ── 🚨 And when the shape is not there, the test says so ────────────────────
//
// An app that sells one one-off product has no token package, and several of
// the tests below need BOTH shapes — they exist to prove a token package can
// never be a plan. There is no honest way to check that claim there, so those
// tests are SKIPPED with the reason written out, never quietly passed.
// "I could not look" and "there is nothing wrong" are different answers, and
// this repo keeps them apart everywhere else too (NFR-60).
//
// How a skip says so is not this file's business — `lib/test-not-checked.ts`
// owns that, and the agent-program tests use the same mechanism for the same
// reason.
//
// Nothing in the app imports this file; it is the tests' own vocabulary and it
// lives beside the registry it reads because that is the module it is about.
import { notChecked, type SkippableTest } from "@/lib/test-not-checked";

import { allProducts } from "./products";

/**
 * A key of the wanted shape, or the reason this app has none.
 *
 * Exactly one of the two is filled: `key` non-null and `reason` empty, or the
 * other way round. There is deliberately no third state — an unreadable
 * registry cannot happen here, because `products.ts` refuses to load at all
 * when the file does not parse.
 */
export interface ProductKeyPick {
  /** The key, or `null` when this app's registry holds no product of that shape. */
  readonly key: string | null;
  /** Why there is none — the sentence a skipped test prints. `""` when there is one. */
  readonly reason: string;
}

/** What the registry says, in one sentence, for the reasons below. */
function registryNote(): string {
  const products = allProducts();
  if (products.length === 0) return "it holds no products at all";
  return `it holds ${products.map((p) => `"${p.key}" (${p.kind})`).join(", ")}`;
}

function pick(
  matches: (kind: string) => boolean,
  wanted: string,
): ProductKeyPick {
  // Declaration order, which is the operator's own order in the file — stable
  // across runs, and the first entry is the one they think of as their main
  // offering. Never a sort: a rename would then silently move the key a test
  // asserts against.
  const hit = allProducts().find((product) => matches(product.kind));
  if (hit) return { key: hit.key, reason: "" };
  return {
    key: null,
    reason: `config/digistore-products.json holds no ${wanted} — ${registryNote()}`,
  };
}

/**
 * Why no key can be invented for the missing shape — said once, at the end of
 * the printed line, rather than inside every reason.
 */
const WHY_NO_STAND_IN =
  "Nothing can stand in for one: a key the registry does not hold is refused " +
  "by planProblem() and thrown on by hasPlan() — a different refusal from the " +
  "one under test, so the claim was not measured here.";

/**
 * A key `hasPlan()` can answer — a subscription or a one-off purchase.
 *
 * "Not a token package" is the whole condition, and it is the same one
 * `planProblem()` applies: a balance is not an entitlement, everything else in
 * the registry is one.
 */
export function planShapedKey(): ProductKeyPick {
  return pick(
    (kind) => kind !== "token",
    "plan-shaped product (a subscription or a one-off — anything but a token package)",
  );
}

/** A token package — a balance, which `hasPlan()` answers false for for ever. */
export function tokenKey(): ProductKeyPick {
  return pick((kind) => kind === "token", 'token package (a product of kind "token")');
}

/**
 * The keys, or a skip that says what was not checked and why.
 *
 * ```ts
 * const PLAN = planShapedKey();
 * it("…", (ctx) => {
 *   const [plan] = keysOrSkip(ctx, PLAN);   // never returns when it skips
 *   …
 * });
 * ```
 */
export function keysOrSkip<T extends readonly ProductKeyPick[]>(
  ctx: SkippableTest,
  ...picks: T
): { [K in keyof T]: string } {
  const missing = picks.filter((entry) => entry.key === null);
  if (missing.length > 0) {
    const reason = missing.map((entry) => entry.reason).join("; and ");
    notChecked(ctx, `${reason}. ${WHY_NO_STAND_IN}`);
  }
  return picks.map((entry) => entry.key) as { [K in keyof T]: string };
}
