// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the OPERATOR may do to a grant by hand (Epic 3).
//
// PURE — no database, no I/O, no session. The lookups happen in
// lib/entitlements/manage.ts and the server action in
// app/dashboard/admin/users/[id]/actions.ts; their results are handed in here.
//
// DELIBERATELY SEPARATE FROM ./rules.ts. That file is the Digistore24
// ADAPTER's decision layer: it answers "what does this EVENT do to a grant" and
// it must not learn what an Operator is. Access granted because money arrived
// and access granted because a person decided so are two different authorities,
// and the moment one function answers both, a payload field can reach the
// Operator's branch.
//
// The whole reason this is a file and not a handful of `if`s inside the server
// action: handing out paid-for access without a payment is the STOP criterion of
// this story, so every refusal has to be assertable one case at a time
// (grant-rules.test.ts). There is no test database in this project — a rule that
// lives inside the action is a rule nothing asserts.
//
// LANGUAGE: this layer returns NO finished sentences, only codes
// (`"notAGrantProduct"`). Translation happens in the server action via the
// `errors` namespace in `messages/*.json`. A sentence written here would exist
// in exactly one language — and not necessarily the Operator's.

import { allProducts, type ProductDef, type ProductKind } from "@/lib/digistore/products";
import type { Actor } from "@/lib/users/rules";

/**
 * Every reason a manual grant — or its revocation (story 3.4) — is refused.
 *
 * Each code MUST have a text in `messages/*.json` under `errors`;
 * `i18n/messages.test.ts` walks THIS list alongside USER_ERROR_CODES and
 * TOKEN_ERROR_CODES and breaks the build when one is missing. Without that the
 * Operator is shown the literal key ("errors.notAGrantProduct") at the exact
 * moment something went wrong.
 */
export const GRANT_ERROR_CODES = [
  "notOwner",
  "unknownProduct",
  "notAGrantProduct",
  "reasonRequired",
  "endDateInPast",
  "invalidEndDate",
  // Story 3.4 (revoke) refuses with these. Listed here rather than in a second
  // union so the whole Operator-facing grant vocabulary has ONE home and one
  // i18n gate.
  "grantNotFound",
  "notManual",
  "alreadyEnded",
] as const;

export type GrantErrorCode = (typeof GRANT_ERROR_CODES)[number];

/**
 * An error carrying a translatable reason. The server action catches it and
 * turns it into a message in the Operator's language via `t(code)` — the same
 * contract as `UserError` (lib/users/rules.ts) and `TokenError`
 * (lib/tokens/rules.ts).
 */
export class GrantError extends Error {
  readonly code: GrantErrorCode;

  constructor(code: GrantErrorCode) {
    // The message IS the code — it belongs in logs, not in front of people.
    super(code);
    this.name = "GrantError";
    this.code = code;
  }
}

/** The longest reason `grants.note` will accept from an Operator. */
export const MAX_GRANT_REASON_LENGTH = 500;

/**
 * The reason, trimmed — or null when it is not a reason at all.
 *
 * Mirrors `normalizeEmail` in lib/users/rules.ts: normalize and validate in one
 * place, hand back the value that is actually to be stored. The database would
 * happily store `"   "`, and `grants.note` is the ONLY record of why somebody
 * was given access they did not pay for.
 *
 * Rejected, and each for a reason that has already bitten this codebase once
 * (see decideAdjustment in lib/tokens/rules.ts):
 *
 *  - empty, or blank after trimming;
 *  - no letter and no digit anywhere — `trim()` does NOT strip a zero-width
 *    space, a braille blank or a joiner, so a U+200B passes as a reason and the
 *    Operator's own grants table then shows an empty cell;
 *  - a control character, NUL above all: accepted by JS, REJECTED by Postgres,
 *    which surfaces as "unknown error" instead of a translated refusal;
 *  - longer than 500 characters — an unbounded note is pulled into every render
 *    of the grants table.
 */
export function normalizeGrantReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const reason = input.trim();
  if (reason === "" || !/[\p{L}\p{N}]/u.test(reason)) return null;
  if (reason.length > MAX_GRANT_REASON_LENGTH) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) return null;
  return reason;
}

/**
 * `access_until` for the day an Operator picked — the END of that day, in UTC.
 *
 * THE TRAP THIS FUNCTION EXISTS FOR. `<input type="date">` yields "2026-08-01",
 * and `new Date("2026-08-01")` is UTC MIDNIGHT. An Operator in Berlin who picks
 * 1 August expecting "access through the 1st" would get access ending at 02:00
 * local ON the 1st — a whole day early, with nothing in the stored value to show
 * for it.
 *
 * 23:59:59.999 UTC, so the chosen day is covered in every zone at or behind
 * UTC+00 and in the European ones this template is aimed at. It is written
 * through drizzle as a JS `Date`, never as `sql\`…\``, so the `timestamp`
 * column's own mapper holds on both directions (`db/timestamp-utc.test.ts`).
 *
 * @returns null for anything that is not an unambiguous ISO day. NULL FROM HERE
 *   IS NOT "PERMANENT" — the caller must tell the two apart, which is what the
 *   `invalidEndDate` code is for. Reading an unparseable date as "for ever" is
 *   the one failure mode this whole function is guarding.
 */
export function accessUntilFromDay(day: string): Date | null {
  if (typeof day !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);

  const end = new Date(Date.UTC(year, month - 1, date, 23, 59, 59, 999));

  // Date.UTC ROLLS OVER: month 13 becomes January of the next year and
  // 30 February becomes 2 March, silently. A grant must never end on a day
  // nobody typed, so the answer is checked back against the input. This also
  // catches Date.UTC's two-digit-year rule (year 99 -> 1999).
  if (
    end.getUTCFullYear() !== year ||
    end.getUTCMonth() !== month - 1 ||
    end.getUTCDate() !== date
  ) {
    return null;
  }
  return end;
}

/**
 * Every product an Operator may grant — that is, everything that is not a token
 * package.
 *
 * Here rather than in the dropdown, so "a token package is not grantable" is
 * asserted by a test rather than by the contents of a `<Select>`. There is no
 * "grantable kinds" helper in the registry: `productsByKind` takes exactly one
 * kind, and enumerating kinds positively would silently drop any kind added
 * later, which is the wrong direction to fail in for a list of things one may
 * hand out for free.
 */
export function grantableProducts(): ProductDef[] {
  return allProducts().filter(
    (p) => p.kind === "subscription" || p.kind === "one_time",
  );
}

/** The two columns a revocation is decided on — nothing else is read. */
export interface RevokableGrant {
  /** Provenance. `"purchase"` is refused outright — see below. */
  source: "purchase" | "manual";
  /** Terminal. Non-null means this grant is already closed (§D5). */
  endedAt: Date | null;
}

/**
 * May this Operator revoke this grant by hand (story 3.4)?
 *
 * @param grant the row as it was READ, or `null` when no row has that id.
 * @returns null when it is allowed, otherwise the reason.
 *
 * THIS IS NOT THE CONTROL — it is the assertable statement of one. The refusal
 * that holds is `AND source = 'manual' AND ended_at IS NULL` in the UPDATE
 * itself (`revokeGrantByHand`, ./manage.ts): this function decides on the grant
 * as it was loaded, and a concurrent write may have ended it since. Exactly the
 * same split as `chooseGrantTransition`'s `alreadyEnded` guard and the
 * `ended_at IS NULL` on every write in the adapter.
 *
 * Ordered guards, in the order canGrantByHand already uses:
 *
 *  1. Authorization. Somebody who may not act must not learn from the message
 *     whether the grant exists, or what kind it is. The server action calls
 *     `requireOwner()` first — this is the second, deliberately redundant
 *     layer, and the one a test can reach.
 *  2. Existence. The grant id is a CLIENT-SUBMITTED value.
 *  3. ⛔ PROVENANCE — the money gate, and the reason this whole story has a
 *     STOP criterion. AD-1 forbids the admin surface from ending a purchase
 *     grant: purchased access ends by Digistore24 EVENT (refund, chargeback,
 *     last paid day) and by nothing else. `endedAt` is terminal, so an Operator
 *     who took away access somebody paid for cannot give it back — the remedy
 *     would be a manual grant, which is a different row with a different
 *     provenance, and the refund the customer is owed would then have nothing
 *     to close.
 *
 *     Checked BEFORE `endedAt`, so an already-refunded purchase grant is
 *     refused as `notManual` and not as `alreadyEnded`: "that came from a
 *     purchase" is the answer that tells the Operator where to look.
 *  4. Terminal state. AC 4 — the second submit of the same revoke changes
 *     nothing, and is told so rather than silently reporting success.
 *
 * THERE IS NO SELF-GUARD, symmetric with `canGrantByHand`: revoking your own
 * comp locks nobody out and leaves the same record as any other revocation.
 */
export function canRevokeGrant(
  actor: Actor,
  grant: RevokableGrant | null,
): GrantErrorCode | null {
  if (actor.role !== "owner") return "notOwner";
  if (grant === null) return "grantNotFound";
  if (grant.source !== "manual") return "notManual";
  if (grant.endedAt !== null) return "alreadyEnded";
  return null;
}

export interface GrantByHandInput {
  /** The Operator. Re-checked here even though the action called requireOwner. */
  actor: Actor;
  /** What is being granted. `null` = the registry could not name the key. */
  productKind: ProductKind | null;
  /** Raw form input — the note this grant is explained by. */
  reason: unknown;
  /**
   * When access ends, or null for a permanent grant. An INVALID Date (the day
   * string could not be parsed) is refused, never treated as permanent.
   */
  accessUntil: Date | null;
  now: Date;
}

/**
 * May this Operator hand out this plan?
 *
 * @returns null when it is allowed, otherwise the reason.
 *
 * Ordered guards, in the order `chooseGrantTransition` already uses:
 *
 *  1. Authorization. Somebody who may not act must not learn from the message
 *     whether their key or their date would have been accepted.
 *  2. The product. An unknown key and a token package BOTH refuse — unknown
 *     must never guess — but they refuse DISTINCTLY, so the message can say
 *     "that key does not exist" rather than "token packages are balance".
 *  3. The reason. AC 1 says the grant records why; this, and not the form's
 *     `required` attribute, is the refusal — a server action is an HTTP
 *     endpoint of its own and can be called without the form ever rendering.
 *  4. The date.
 *
 * THERE IS NO SELF-GUARD (AC 7), deliberately, and it must not grow one by
 * pattern from lib/users/rules.ts. Deleting, demoting or blocking yourself locks
 * you out; granting yourself a plan does not, and it leaves the same record —
 * `issued_by`, `note`, `created_at` — as any other grant.
 */
export function canGrantByHand(input: GrantByHandInput): GrantErrorCode | null {
  if (input.actor.role !== "owner") return "notOwner";

  // POSITIVE, not a deny-list, and that distinction is load-bearing.
  //
  // `safeProductKind` is TYPED `ProductKind | null` but can return `undefined`
  // at runtime, and TypeScript cannot see it: the registry is a plain JSON
  // object, so `raw.products["constructor"]` resolves through Object.prototype
  // and never throws. A deny-list of null-or-token let `constructor`,
  // `__proto__`, `toString` and `valueOf` straight through to a PERMANENT
  // grant — and `hasPlan()` then answered true for them. The same shape also
  // let a hand-edited `"kind": "Token"` in the registry become an entitlement.
  //
  // Naming the two grantable kinds closes both doors at once. A token package
  // is a BALANCE, not an entitlement: `hasPlan` answers false for one no
  // matter how many grants exist, so a grant here would be a row that
  // entitles nobody to anything and a support case nobody can explain.
  if (
    input.productKind !== "subscription" &&
    input.productKind !== "one_time"
  ) {
    return input.productKind === "token" ? "notAGrantProduct" : "unknownProduct";
  }

  if (normalizeGrantReason(input.reason) === null) return "reasonRequired";

  if (input.accessUntil !== null) {
    // An unparseable day reaches here as an Invalid Date. Every comparison
    // against it is false, so WITHOUT this line it would slip past the past-date
    // guard below and be stored as… nothing, i.e. a permanent grant.
    if (Number.isNaN(input.accessUntil.getTime())) return "invalidEndDate";
    // Not `<`. `activeFor()` asks `access_until > now()`, strictly, so a grant
    // ending exactly now would be born expired — accepted by the form, invisible
    // to the Member, and a support case by lunchtime.
    if (input.accessUntil.getTime() <= input.now.getTime()) {
      return "endDateInPast";
    }
  }

  return null;
}
