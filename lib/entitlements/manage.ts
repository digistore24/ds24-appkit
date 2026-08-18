// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The entitlement layer — the ONE call an app makes to ask what a Member may
// use.
//
// This is the imperative shell: it owns the writes and the queries. The
// decision "what does this event do to a grant" is not made here — it is the
// pure function in ./rules.ts, because it governs access on the strength of a
// payment and has to be testable one case at a time. Nothing in this repo can
// test a DB-bound function; there is no test database.
//
// AD-1: `grants` is the source of truth for access. `entitlementsFor()` reads
// that ONE table. It never consults `subscriptions` (a Digistore24 mirror) or
// `orders` (a financial record). Two answers to "may this person use this"
// drift apart; one does not.
//
// AD-8: entitlement is DERIVED at read time, never cached as a boolean. A
// stored yes/no survives the chargeback that should have revoked it.

import { db } from "@/db";
import { grants, orders } from "@/db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, or, gt, sql } from "drizzle-orm";

import { getProduct, type ProductKind } from "@/lib/digistore/products";
import type { Actor } from "@/lib/users/rules";
import {
  canGrantByHand,
  canRevokeGrant,
  GrantError,
  normalizeGrantReason,
} from "./grant-rules";
import type { GrantEndReason, GrantTransition } from "./rules";

/** One thing a Member may use, and what put it there. */
export interface Entitlement {
  productKey: string;
  source: "purchase" | "manual";
  /**
   * The instant access runs out, or NULL for access with NO END DATE.
   *
   * NULL is the normal case and it means two different things depending on
   * `source`. A PURCHASE grant is always NULL (AD-2): purchased access ends by
   * Digistore24 EVENT — `last_paid_day` — never by a stored date, so there is
   * no end date to show. `subscriptions.nextPaymentAt` is NOT one and must
   * never be substituted: it is a billing mirror, it says when money moves
   * next, and AD-1 forbids the read outright. A MANUAL grant is NULL when the Operator issued
   * it permanently, and otherwise carries the last millisecond of the day they
   * picked, IN UTC — render it with an explicit `timeZone: "UTC"` or every
   * viewer ahead of UTC reads the following day.
   *
   * Added in story 3.5 so the Member's own account page can say when access
   * ends. Widening the interface is additive; nothing that reads
   * `{ productKey, source }` breaks.
   */
  accessUntil: Date | null;
}

/**
 * The active-grant filter, AD-8 verbatim.
 *
 * `endedAt`   refund · chargeback · last_paid_day · revoke — terminal.
 * `suspendedAt` missed payment — reversible, cleared on resume.
 * `accessUntil` NULL for every purchase grant; manual grants may set it.
 *
 * Written once and shared, so `entitlementsFor` and `hasPlan` cannot answer
 * the same question differently.
 *
 * EXPORTED as the named counterpart of `grantState()` in ./rules.ts (story
 * 3.1). A loaded row cannot be filtered by a SQL predicate, so the Operator
 * view derives its state in TypeScript — and the two answers to "is this grant
 * active" are only safe while they are visibly the same three conditions.
 * rules.test.ts asserts they agree, boundary included.
 *
 * `now() at time zone 'utc'`, NOT bare `now()` (story 3.3 §D2). `access_until`
 * is `timestamp` WITHOUT time zone and `now()` returns `timestamptz`; Postgres
 * resolves `timestamp > timestamptz` by casting the LEFT side using the session
 * `TimeZone`, which nothing in this project sets — db/index.ts passes only
 * `{ max }` and docker-compose.yml sets no `TZ`. ⚠️ Nothing STOPS an operator's
 * managed Postgres from being set to one, either, which is what makes this a
 * property of the query rather than of our luck (story A76 measured a retention
 * boundary deleting the wrong rows on a database at `timezone='Europe/Berlin'`).
 * Meanwhile the column MEANS UTC — drizzle's `timestamp` column mapper converts
 * both ways, `db/timestamp-utc.test.ts`. Left alone,
 * two zones meet in one comparison and a host at UTC+2 hands two extra hours of
 * access to every dated grant — or takes two away, depending which way the
 * session leans.
 *
 * `at time zone 'utc'` turns the right side into a plain `timestamp`, so both
 * sides are zone-free and no session setting can move the answer.
 *
 * This was invisible before this story: `access_until` is NULL on EVERY
 * purchase grant (AD-2), so the branch was never taken. Manual grants are the
 * first rows that set it.
 */
export function activeFor(memberId: string) {
  return and(
    eq(grants.memberId, memberId),
    isNull(grants.endedAt),
    isNull(grants.suspendedAt),
    withinTerm(),
  );
}

/**
 * "The grant's term has not run out" — the third of `activeFor`'s conditions,
 * on its own.
 *
 * A FUNCTION, and shared, because it is the one condition with a subtlety in it
 * (the `at time zone 'utc'` above) and because `suspendedFor()` below needs two
 * of the same three. Restating it there would be a second, silently divergent
 * answer to "has this run out" — and the divergence would appear only on a host
 * whose session zone is not UTC, which is the case nobody tests on.
 *
 * Fresh on every call rather than a module constant: a drizzle condition is an
 * AST node, and one shared instance appearing in two live queries is a
 * needless coupling for no gain.
 */
function withinTerm() {
  return or(
    isNull(grants.accessUntil),
    gt(grants.accessUntil, sql`(now() at time zone 'utc')`),
  );
}

/**
 * Product keys ordered so the winning row per key comes first.
 *
 * When a Member holds the same key through both a purchase and a manual grant
 * we report `purchase` — it is the one backed by money, and it is the one an
 * Operator revoking the comp must not appear to take away.
 *
 * NOT `order by source desc`. `source` is a Postgres ENUM, and enums sort by
 * DECLARATION order, not alphabetically — 'purchase' is declared first, so
 * DESC would put 'manual' first and quietly invert the rule. The explicit
 * boolean says what is meant and survives somebody reordering the enum.
 */
const PURCHASE_FIRST = sql`(${grants.source} = 'purchase') desc`;

/**
 * The ORDER BY of `entitlementsFor` — which of a key's rows DISTINCT ON keeps.
 *
 * EXPORTED so a test can read the statement it produces, for the same reason
 * `activeFor` is: the third term below is invisible in the result and wrong only
 * for Members who hold one key twice, so nothing short of asserting the SQL
 * notices it going missing.
 *
 *  1. `productKey` — DISTINCT ON requires its expressions to lead the ORDER BY.
 *  2. `PURCHASE_FIRST` — money beats a comp (see above).
 *  3. `accessUntil DESC` — THE TIEBREAK, and it became load-bearing the moment
 *     the projection started carrying the column (story 3.5 §D2). Two manual
 *     grants on the same key satisfy terms 1 and 2 identically, so DISTINCT ON
 *     kept whichever row the planner happened to return first: a Member holding
 *     a key until 1 August AND until 1 September could be told "ends 1 August"
 *     while their access actually ran to September. Postgres sorts DESC as
 *     NULLS FIRST, which is exactly right — a permanent grant beats every
 *     bounded one, and the surviving row is always the one reaching furthest.
 *
 * Note what term 2 costs and why it stays: a purchase grant's `accessUntil` is
 * NULL by AD-2, so when a Member holds a key through BOTH a purchase and a
 * dated comp, the purchase row wins and the comp's end date does not appear.
 * That is correct — the purchase is the access that is not about to lapse — but
 * it does mean AC 2 of story 3.5 is false in that one case. Documented here so
 * nobody "fixes" it by reordering: putting `accessUntil DESC` first would report
 * a comp as the source of access somebody paid for.
 */
/**
 * What the Member's entitlement read projects — exported so the query and the
 * test that pins it share ONE definition.
 *
 * Widening this is how the Operator's typed reason would reach a Member's
 * screen: `grants.note` and `grants.issuedBy` are on the same table, one line
 * away. The leak guard asserts against this constant, so adding either fails
 * the suite rather than a later review.
 */
export const ENTITLEMENT_COLUMNS = {
  productKey: grants.productKey,
  source: grants.source,
  accessUntil: grants.accessUntil,
};

export const ENTITLEMENT_ORDER = [
  grants.productKey,
  PURCHASE_FIRST,
  desc(grants.accessUntil),
];

/**
 * Everything this Member may currently use.
 *
 * ONE query, no Digistore24 call, no scheduled job. A Product Key held through
 * several grants appears ONCE — deduped in SQL with `DISTINCT ON`, not in JS:
 * dedupe in JS would make "resolves in a single query" false the moment a
 * Member holds two grants, which is exactly the case the dedupe exists for.
 * The grant rows stay separate in storage so one ending does not revoke while
 * another still holds.
 */
export async function entitlementsFor(
  memberId: string,
): Promise<Entitlement[]> {
  const rows = await db
    .selectDistinctOn([grants.productKey], ENTITLEMENT_COLUMNS)
    .from(grants)
    .where(activeFor(memberId))
    // Three terms, and the third is the one that is easy to lose — see
    // ENTITLEMENT_ORDER above.
    .orderBy(...ENTITLEMENT_ORDER);

  return rows.map((r) => ({
    productKey: r.productKey,
    source: r.source,
    accessUntil: r.accessUntil,
  }));
}

/**
 * The paused-grant filter — `activeFor` with `suspended_at` inverted.
 *
 * EXPORTED for the same reason `activeFor` is: it is the counterpart of
 * `grantState()`'s `"suspended"` branch, and the two answers to "is this grant
 * paused" are only safe while they are visibly the same conditions.
 *
 * Why the other two conditions come along unchanged:
 *
 *  - `ended_at IS NULL` — a refunded or expired-by-event grant is OVER, not
 *    paused. Telling that customer "your access is paused, fix your card" is a
 *    promise nothing can keep: `endedAt` is terminal (AD-2) and no payment
 *    reopens it.
 *  - `withinTerm()` — shared verbatim with `activeFor`, UTC fix included. A
 *    suspended manual grant whose day has passed has simply run out.
 *
 * DISPLAY ONLY. `activeFor` remains the sole predicate anything is gated on,
 * and a key this matches is a key the Member may NOT currently use.
 */
export function suspendedFor(memberId: string) {
  return and(
    eq(grants.memberId, memberId),
    isNull(grants.endedAt),
    isNotNull(grants.suspendedAt),
    withinTerm(),
  );
}

/**
 * The Product Keys whose access is PAUSED by a missed payment (story 3.5, AC 4).
 *
 * WHY THIS EXISTS AT ALL. `entitlementsFor` filters suspended grants out
 * entirely (AD-8), so a customer whose card expired over a weekend sees an
 * EMPTY list and is told nothing. `docs/entitlements.md` is emphatic that this
 * is not an account closure and that the app should say "your access is
 * paused" — but until this function there was no supported way to read that
 * state, and the doc's own advice ("read the billing state for the message")
 * pointed at the tables AD-1 forbids.
 *
 * A NARROW READER, deliberately, and NOT `listGrantsFor`. That one is the
 * Operator's read: it carries `note` — the Operator's own words about this
 * customer, "comped, angry on the phone" — and `issuedBy`. Neither may reach a
 * Member component, and a shape shared between the two surfaces is one careless
 * spread away from the leak (§D5). This returns Product Keys and NOTHING ELSE,
 * so there is nothing on it to leak.
 *
 * Ordered and deduped in SQL, so the warning does not reshuffle itself between
 * two loads and a key held through two suspended grants is named once.
 *
 * The result is not the message. A key can be suspended through one grant and
 * live through another — `pausedKeys()` in ./rules.ts does that subtraction,
 * purely and under test.
 */
export async function suspendedKeysFor(memberId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ productKey: grants.productKey })
    .from(grants)
    .where(suspendedFor(memberId))
    .orderBy(grants.productKey);

  return rows.map((r) => r.productKey);
}

/**
 * May this Member use `productKey`?
 *
 * THROWS on a key the product registry does not know. That is deliberate and
 * it is an acceptance criterion: a typo'd key silently returning `false` is a
 * locked-out paying customer that nobody can reproduce — the feature simply
 * never appears, and no log line says why. A programming error must look like
 * one.
 *
 * Note the asymmetry with the IPN handler, which deliberately SWALLOWS an
 * unknown key (`safeProduct`): there, a throw would 500 the webhook and
 * Digistore24 would redeliver forever. Here the caller is the app's own code
 * and the throw reaches a developer.
 */
export async function hasPlan(
  memberId: string,
  productKey: string,
): Promise<boolean> {
  getProduct(productKey); // throws on an unknown key — see above

  const [row] = await db
    .select({ id: grants.id })
    .from(grants)
    .where(and(activeFor(memberId), eq(grants.productKey, productKey)))
    .limit(1);

  return Boolean(row);
}

/**
 * `min(created_at)` over a Member's active grants for one key — the aggregate
 * `planStartedAt` runs.
 *
 * 🚨 `.mapWith(grants.createdAt)` is not decoration. A raw ``sql`…` `` has no
 * mapper, so the driver's Postgres string is handed straight on: `sql<Date>`
 * here would be a string wearing a `Date`'s clothes, and `db/sql-cast.test.ts`
 * fails on it for exactly this reason. Borrowing the column's own mapper is the
 * first of the three ways out that `docs/troubleshooting.md` → *Dates and raw
 * SQL* names, and the only one that keeps the value a real `Date`. ⚠️ Never
 * "fix" a wrong-looking result with `new Date(value)` — `created_at` is
 * `timestamp` without a zone marker, so that shifts it by the host's offset.
 *
 * EXPORTED for the reason `ENTITLEMENT_ORDER` is: what this produces is
 * invisible in a type and testable only by reading the statement.
 */
export const PLAN_START = sql`min(${grants.createdAt})`.mapWith(
  grants.createdAt,
);

/**
 * When did this Member's access to `productKey` START?
 *
 * The one question a course that unlocks week by week asks —
 * `docs/courses.md` shape 2 — and the answer is the EARLIEST active grant for
 * that key, so a Member who upgraded mid-programme keeps the week they are on
 * instead of being sent back to week one.
 *
 * 🚨 **This is a query of its own, and the obvious alternative is wrong.** The
 * tempting version is to add `grants.createdAt` to `ENTITLEMENT_COLUMNS` and
 * take "the earliest `grantedAt` among the rows `entitlementsFor()` returns" —
 * which is what `docs/courses.md` used to instruct. `entitlementsFor()` is a
 * `DISTINCT ON (product_key)` ordered by `ENTITLEMENT_ORDER`, so it returns
 * exactly ONE row per key and picks it by *purchase-beats-comp, then furthest
 * `accessUntil`* — never by age. "The earliest among them" is therefore vacuous
 * over a one-element set, and the date it would carry belongs to whichever row
 * won a contest about something else. A Member who bought, refunded and bought
 * again would have their programme clock started on the wrong grant, silently,
 * and the failure surfaces as a week that opens on the wrong day.
 *
 * `null` means no ACTIVE grant for that key — never "no such product": an
 * unknown key throws, exactly as `hasPlan()` does and for the same reason.
 * A suspended grant (missed payment) is not active, so a paused Member's clock
 * reads `null` rather than running on; say "your access is paused"
 * (`suspendedKeysFor`), never silently show week one.
 */
export async function planStartedAt(
  memberId: string,
  productKey: string,
): Promise<Date | null> {
  getProduct(productKey); // throws on an unknown key — see hasPlan() above

  const [row] = await db
    .select({ startedAt: PLAN_START })
    .from(grants)
    .where(and(activeFor(memberId), eq(grants.productKey, productKey)));

  return row?.startedAt ?? null;
}

/**
 * One grant row, whole — what the Operator view needs (story 3.1).
 *
 * Deliberately NOT `Entitlement`. That one is the app-facing access answer and
 * carries exactly what a feature gate needs; this one is the support answer and
 * carries what a person has to read in order to explain what happened.
 */
export interface GrantRow {
  /** The row's own id — what story 3.4 submits in order to revoke it. */
  id: string;
  productKey: string;
  source: "purchase" | "manual";
  /** The Operator who issued a manual grant; NULL for a purchase grant, and
   *  NULL again once that Operator's account is deleted (`set null`). */
  issuedBy: string | null;
  note: string | null;
  accessUntil: Date | null;
  suspendedAt: Date | null;
  endedAt: Date | null;
  endedReason: string | null;
  createdAt: Date;
}

/**
 * EVERY grant this Member has ever held — no dedupe, no active filter.
 *
 * A separate reader, and NOT `entitlementsFor()` with more columns, because
 * the access API is wrong for this page in three ways and right for its own
 * job in all three:
 *
 *  1. It hides the manual grant. `DISTINCT ON (product_key)` with
 *     PURCHASE_FIRST collapses a Member who holds a key through both a
 *     purchase and an Operator comp into ONE row reading `source: "purchase"`.
 *     The Operator cannot see the comp they just issued, and story 3.4 would
 *     have nothing to revoke.
 *  2. It drops suspended and ended grants. "Why did my access stop?" is THE
 *     support question, and `endedReason` exists precisely so a refund can be
 *     told from an expiry — hiding those rows ships a support page that cannot
 *     answer what support is asked.
 *  3. It returns no `id`, no `accessUntil`, no `issuedBy` and no `note`.
 *
 * This does not breach AD-1: it still reads `grants` and nothing else, and it
 * decides nothing about access — `grantState()` labels the rows, `activeFor()`
 * remains the only predicate anything is gated on.
 *
 * Newest first, `id` as the tiebreak: `created_at` defaults to `now()`, which
 * in Postgres is the TRANSACTION timestamp, and the claim path creates several
 * grants inside one transaction. Without the second key their order is
 * whatever the planner returns, which is not an audit view.
 */
export async function listGrantsFor(memberId: string): Promise<GrantRow[]> {
  return db
    .select({
      id: grants.id,
      productKey: grants.productKey,
      source: grants.source,
      issuedBy: grants.issuedBy,
      note: grants.note,
      accessUntil: grants.accessUntil,
      suspendedAt: grants.suspendedAt,
      endedAt: grants.endedAt,
      endedReason: grants.endedReason,
      createdAt: grants.createdAt,
    })
    .from(grants)
    .where(eq(grants.memberId, memberId))
    .orderBy(desc(grants.createdAt), desc(grants.id));
}

// --- The Operator's own write path (story 3.3) -------------------------------

/**
 * What the registry calls this key, or `null` when it cannot name it.
 *
 * `getProduct` THROWS on an unknown key, with a hard-coded GERMAN message
 * ("Unbekanntes Produkt: …", products.ts). Letting that reach the Operator
 * breaks AD-10 — it would be the one sentence in the app that is not in their
 * language, and it appears exactly when something has gone wrong. Caught here
 * and turned into `null`, which `canGrantByHand` refuses as `unknownProduct`.
 *
 * The same shape as `safeProduct()` in lib/digistore/payment-event.ts, for a
 * different reason: there a throw would 500 the webhook, here it would show
 * German to an English Operator.
 */
function safeProductKind(productKey: string): ProductKind | null {
  try {
    return getProduct(productKey).kind;
  } catch {
    return null;
  }
}

/** A manual grant, as it was written. */
export interface ManualGrant {
  id: string;
  productKey: string;
  accessUntil: Date | null;
}

/**
 * The Operator hands a Member a plan — no payment behind it (story 3.3).
 *
 * The imperative half. Nothing about WHETHER it is allowed is decided here:
 * that is `canGrantByHand` in ./grant-rules.ts, called immediately before the
 * write with the kind this function resolved. The action above it only proves
 * the caller is an Operator and translates what comes back — so the rule is
 * evaluated in exactly one place and asserted by tests that need no database.
 *
 * A PLAIN INSERT, deliberately, and it must not grow an `onConflictDoNothing`
 * by pattern from `activateGrant`. That arbiter is the PARTIAL unique index on
 * (ds24_purchase_id, product_key) WHERE ds24_purchase_id IS NOT NULL — and a
 * manual row has `ds24_purchase_id` NULL by the `grants_provenance` CHECK, so
 * the predicate is never satisfied and the clause could never fire. It would be
 * dead code that reads like a safety net. A BARE `.onConflictDoNothing()` would
 * be worse still: it would swallow a genuine constraint failure and report a
 * grant that was never written.
 *
 * TWO IDENTICAL MANUAL GRANTS ARE LEGAL, and there is deliberately no unique
 * index on (member_id, product_key) to stop them. `endedAt` is terminal — there
 * is no un-revoke — so issuing a fresh grant is the ONLY remedy for a mistaken
 * revocation, and such an index would forbid exactly that. The Member's
 * entitlement list is unaffected either way: `entitlementsFor`'s
 * `DISTINCT ON (product_key)` reports the key once however many grants carry it.
 *
 * `ds24PurchaseId: null` is set EXPLICITLY rather than left to the column
 * default or to the CHECK: provenance is the one thing separating a comp from a
 * payment, and it should be readable at the call site.
 */
export async function grantByHand(args: {
  /** The Operator. Re-checked in canGrantByHand — actions are endpoints. */
  actor: Actor;
  memberId: string;
  productKey: string;
  /** Raw form input; validated in canGrantByHand, never trusted here. */
  reason: unknown;
  /** End of access, or null for a permanent grant. */
  accessUntil: Date | null;
  now?: Date;
}): Promise<ManualGrant> {
  const denial = canGrantByHand({
    actor: args.actor,
    productKind: safeProductKind(args.productKey),
    reason: args.reason,
    accessUntil: args.accessUntil,
    now: args.now ?? new Date(),
  });
  if (denial) throw new GrantError(denial);

  // Non-null past the guard above — `canGrantByHand` refuses whatever this
  // returns null for. Normalized rather than raw: what is stored is the trimmed
  // reason, exactly as `normalizeEmail` decides what lands in `users.email`.
  const note = normalizeGrantReason(args.reason) as string;

  const [row] = await db
    .insert(grants)
    .values({
      memberId: args.memberId,
      productKey: args.productKey,
      source: "manual",
      ds24PurchaseId: null,
      // WHO handed it out. `set null` on delete, so this survives as history
      // and disappears with the Operator's account rather than blocking it.
      issuedBy: args.actor.id,
      note,
      // A JS Date, NEVER sql`…`. Drizzle's `timestamp` column mapper writes
      // `toISOString()` and reads it back as UTC, so the value that comes out
      // is the instant that went in — and a raw template has no column on the
      // value's side, which is the whole of `db/sql-date-param.test.ts`.
      // `sql\`now()\`` would store the
      // SESSION's wall-clock digits instead — the bug endGrant/suspendGrant
      // still carry.
      accessUntil: args.accessUntil,
    })
    .returning({ id: grants.id });

  return {
    id: row.id,
    productKey: args.productKey,
    accessUntil: args.accessUntil,
  };
}

// --- The Operator takes it away again (story 3.4) ----------------------------

/**
 * What `grants.endedReason` records for a hand-revocation.
 *
 * A LOCAL literal, and it must stay one. `GrantEndReason` in ./rules.ts is the
 * ADAPTER's type and deliberately does NOT contain `"revoked"` (§D4): adding it
 * there would make `{ kind: "end", reason: "revoked" }` a type-legal return of
 * `chooseGrantTransition` — a Digistore24 event able to record a
 * hand-revocation, which is the exact confusion `endedReason` exists to
 * prevent. The column is plain `text`, so no enum and no migration is involved.
 */
const REVOKED = "revoked";

/** A revoked grant, as it was closed. */
export interface RevokedGrant {
  id: string;
  /** Read back from the ROW, never from the form — see below. */
  memberId: string;
  productKey: string;
  /** The instant the revocation was recorded, in UTC. */
  endedAt: Date | null;
}

/**
 * The Operator ends a grant they issued by hand (story 3.4).
 *
 * ⛔ THIS TAKES ACCESS AWAY, AND IT IS IRREVERSIBLE. `endedAt` is terminal
 * (AD-2, §D5): there is no un-revoke and there must not be one. A mistaken
 * revocation is repaired by issuing a NEW manual grant — which is why
 * `grantByHand` above deliberately allows two identical manual grants and why
 * there is no unique index on (member_id, product_key).
 *
 * A SEPARATE FUNCTION, not a case in `applyGrantTransition` (§D2). That one is
 * keyed on `PurchaseGrantRef` and every branch bails without a
 * `ds24PurchaseId`; a manual grant has none by the `grants_provenance` CHECK,
 * so it could not reach one anyway. `endGrant` stays UNEXPORTED, and its only
 * caller stays `applyGrantTransition` — that is what makes "an admin path
 * cannot end a purchase grant" a structural property rather than a promise.
 *
 * The read decides, the STATEMENT is what makes it true:
 *
 *  - `eq(grants.source, "manual")` — AC 2, in the SQL. NOT left to the
 *    `grants_provenance` CHECK: that CHECK is hand-written into migration 0012
 *    and absent from drizzle's snapshots, so a database built with `db:push`
 *    does not have it. `endGrant` and `suspendGrant` both carry the filter
 *    explicitly for the same reason. Hiding the menu entry is not a control at
 *    all — the server action is an HTTP endpoint of its own and the grant id
 *    arrives from the client.
 *  - `isNull(grants.endedAt)` — AC 4, first writer wins. Without it a
 *    double-submit MOVES THE RECORDED REVOKE TIME LATER: invisible to a smoke
 *    test, permanent in the data, and the one thing AC 3 promises support can
 *    read afterwards.
 *
 * `(now() at time zone 'utc')`, not bare `now()`: `ended_at` is `timestamp`
 * WITHOUT time zone while `now()` returns `timestamptz`, so Postgres would
 * store the SESSION's wall-clock digits — and this story is the first that
 * DISPLAYS one of these values, so a host at UTC+2 would show a revocation two
 * hours in the future. (`endGrant` and `suspendGrant` still write bare `now()`.
 * Noted, deliberately NOT changed here: they are the adapter's writes, they are
 * covered by their own harness cases, and correcting them belongs in a change
 * that can re-verify Epic 2 rather than in this one.)
 *
 * The Member is read back OUT OF THE ROW rather than taken from the form. The
 * row names its own owner, so the page that has to be revalidated is decided by
 * what was actually closed and not by a client-submitted field — the same
 * reasoning `openPurchaseGrantByPurchase` gives for the refund path.
 *
 * @throws GrantError with the code `canRevokeGrant` returned, or
 *   `alreadyEnded` when a concurrent write closed the grant between the read
 *   and the UPDATE.
 */
/**
 * Whose grant this is, or null — for the setup trail's `subject_member_id`.
 *
 * 🚨 A read of ONE column, and it lives here rather than in `lib/setup/tools.ts`
 * because that file is a thin caller of a domain and this is the domain that
 * owns `grants`. It exists for the half of `grant_revoke` that has not written
 * anything yet: a PLAN names a grant, the trail has to name the person, and
 * `revokeGrantByHand()` — which reads the member out of the row it closed — has
 * not run. Without it the first act of the two-act protocol would be the one act
 * missing from that member's Art. 15 export.
 *
 * `grants.id` is `text`, so an unknown or malformed id matches nothing and
 * answers null rather than raising a 22P02.
 */
export async function memberOfGrant(grantId: string): Promise<string | null> {
  const [row] = await db
    .select({ memberId: grants.memberId })
    .from(grants)
    .where(eq(grants.id, grantId))
    .limit(1);
  return row?.memberId ?? null;
}

export async function revokeGrantByHand(args: {
  /** The Operator. Re-checked in canRevokeGrant — actions are endpoints. */
  actor: Actor;
  /** The grant row's own id, as submitted. Never trusted. */
  grantId: string;
}): Promise<RevokedGrant> {
  // `grants.id` is `text`, so an id that is not a UUID — or an empty string —
  // simply matches nothing. It cannot raise a 22P02 the Operator would read as
  // "unknown error".
  const [existing] = await db
    .select({ source: grants.source, endedAt: grants.endedAt })
    .from(grants)
    .where(eq(grants.id, args.grantId))
    .limit(1);

  const denial = canRevokeGrant(args.actor, existing ?? null);
  if (denial) throw new GrantError(denial);

  const [row] = await db
    .update(grants)
    .set({
      endedAt: sql`(now() at time zone 'utc')`,
      endedReason: REVOKED,
      updatedAt: sql`(now() at time zone 'utc')`,
    })
    .where(
      and(
        eq(grants.id, args.grantId),
        // ⛔ The refusal that actually holds. See the header — this is AC 2,
        // and it is here rather than in the CHECK on purpose.
        eq(grants.source, "manual"),
        // AC 4 — first writer wins, and the recorded time never moves.
        isNull(grants.endedAt),
      ),
    )
    .returning({
      id: grants.id,
      memberId: grants.memberId,
      productKey: grants.productKey,
      endedAt: grants.endedAt,
    });

  // Zero rows past a read that said yes means another writer got there first.
  // Reported as `alreadyEnded` rather than swallowed: a revocation that
  // silently reports success while changing nothing is the failure mode this
  // whole story is built to make impossible.
  if (!row) throw new GrantError("alreadyEnded");

  return row;
}

/** What a purchase-sourced grant is made of. */
export interface PurchaseGrantRef {
  memberId: string;
  productKey: string;
  /**
   * The Digistore24 ORDER id. Provenance — and the idempotency key.
   *
   * Named after the column (`ds24_purchase_id`), not after its content; the
   * IPN field `purchase_id` this once read does not exist. The value matters
   * more than the name: every transaction of one order carries the same order
   * id, so the refund finds what the payment created.
   */
  ds24PurchaseId: string | null;
}

/**
 * Carries out what `chooseGrantTransition` decided.
 *
 * ONE write entry point beside the one decision point, so stories 2.2–2.4 add
 * a `case` here rather than a second place that writes `grants`.
 *
 * Every kind is idempotent: Digistore24 redelivers an IPN until it gets a 200,
 * and the claim pass reconsiders every order on every sign-in.
 *
 * @returns whether this call actually changed anything — so a caller counting
 *   "grants created" reports the truth on a re-run instead of counting the
 *   rows it looked at.
 */
export async function applyGrantTransition(
  transition: GrantTransition,
  ref: PurchaseGrantRef,
): Promise<boolean> {
  switch (transition.kind) {
    case "activate":
      return activateGrant(ref);
    case "end":
      return endGrant(transition.reason, ref);
    case "suspend":
      return suspendGrant(ref);
    case "resume":
      return resumeGrant(ref);
    case "none":
      return false;
  }
}

/**
 * The grant behind a purchase, or null. What `chooseGrantTransition` needs in
 * order to see that a grant is already closed.
 *
 * Keyed on (purchase id, Product Key) — the partial unique index — so it reads
 * at most one row and never needs the Member. That is the point: a refund
 * event whose attribution no longer resolves (a rotated checkout token, a
 * purchase the Operator attached by hand to an address the buyer never used)
 * must still find the grant it has to close. The row names its own owner.
 */
export async function purchaseGrant(
  ds24PurchaseId: string,
  productKey: string,
): Promise<{
  memberId: string;
  suspendedAt: Date | null;
  endedAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      memberId: grants.memberId,
      suspendedAt: grants.suspendedAt,
      endedAt: grants.endedAt,
    })
    .from(grants)
    .where(
      and(
        eq(grants.ds24PurchaseId, ds24PurchaseId),
        eq(grants.productKey, productKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The open purchase grant behind a purchase id, WITHOUT needing to know what
 * was bought.
 *
 * `purchaseGrant()` above needs the Product Key because it identifies one row
 * of a pair. This one does not, and that is the point: the normal end-of-life
 * of every subscription — `last_paid_day` — arrives through a gate that first
 * has to resolve the product from the payload, and that resolution fails
 * whenever `custom` is stale and the DS24 product id is unsynced, absent, or
 * ambiguous. The grant then never ends: `accessUntil` is NULL by AD-2,
 * Digistore24 does not redeliver an acknowledged event, and AD-8 rules out a
 * job. Free access forever, with not one log line.
 *
 * A failed refund is visible — the customer complains. A failed EXPIRY is
 * invisible to everyone.
 *
 * The grant row names its own owner and its own Product Key, so ending it
 * needs no registry lookup at all.
 */
export async function openPurchaseGrantByPurchase(ds24PurchaseId: string): Promise<{
  memberId: string;
  productKey: string;
  suspendedAt: Date | null;
  endedAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      memberId: grants.memberId,
      productKey: grants.productKey,
      suspendedAt: grants.suspendedAt,
      endedAt: grants.endedAt,
    })
    .from(grants)
    .where(
      and(
        eq(grants.ds24PurchaseId, ds24PurchaseId),
        eq(grants.source, "purchase"),
        isNull(grants.endedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Closes the grant behind this purchase — refund, chargeback (story 2.2), and
 * the end of the paid period after a cancellation (`lastPaidDay`, story 2.3).
 * All three are the same write; only the recorded reason differs.
 *
 * A CONDITIONAL update, and `AND ended_at IS NULL` is what makes the
 * redelivery harmless (AC 4). Without it a second delivery of the same refund
 * still leaves access correctly gone — but it MOVES THE RECORDED END TIME
 * LATER every time it arrives. That failure is invisible to a smoke test and
 * permanent in the data. Same idiom, same class of race, as the conditional
 * `member_id IS NULL` updates in lib/digistore/claim.ts.
 *
 * Nothing is deleted (AC 3): the row stays, and `activeFor()` above filters on
 * `ended_at IS NULL` rather than on the row's existence.
 *
 * Keyed on the PURCHASE, not on the Member — a refund closes the grant for the
 * purchase that was refunded, whoever ended up owning it. It cannot reach a
 * manual grant even so: the `grants_provenance` CHECK makes
 * `ds24_purchase_id` NULL for every `source='manual'` row, so the key simply
 * does not match one. AD-1's write split holds without a second condition.
 */
async function endGrant(
  reason: GrantEndReason,
  ref: PurchaseGrantRef,
): Promise<boolean> {
  // No purchase id, no key to end on. A purchase grant always has one (the
  // CHECK), so this is the "the event carried none" case, not a missing row.
  if (!ref.ds24PurchaseId) return false;

  const ended = await db
    .update(grants)
    .set({
      // Database time, not the app's: `created_at`/`updated_at` default to
      // now() too, and a clock-skewed app server must not be able to record an
      // end that precedes the grant's own creation.
      // `(now() at time zone 'utc')`, not `now()`. The column is `timestamp`
      // WITHOUT zone and drizzle's column mapper reads it back as UTC, so a bare now()
      // stores session-local wall-clock digits that are then interpreted as
      // UTC — and story 3.4 puts those digits on screen under a "UTC" label.
      // Invisible here only because this machine's session zone is Etc/UTC.
      endedAt: sql`(now() at time zone 'utc')`,
      endedReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(grants.ds24PurchaseId, ref.ds24PurchaseId),
        // NOT also on productKey. The unique index is on the PAIR, so one
        // purchase id can legitimately hold grants for two Product Keys — the
        // claim path keys on the frozen `orders.productKey` while the IPN path
        // resolves the key live per delivery, so a registry edit between two
        // billing periods of the same subscription produces a second row.
        // Keyed on the pair, a refund closed one and left the other live.
        // "One row per purchase" is a property the CREATE path needs; the
        // revoke path must close everything that purchase paid for.
        //
        // `source` explicitly, not by relying on the grants_provenance CHECK:
        // that CHECK is hand-written into 0012 and absent from drizzle's
        // snapshots, so a database built with `db:push` does not have it. The
        // invariant that a refund can never reach a manual grant belongs here,
        // where it is local and cannot be lost.
        eq(grants.source, "purchase"),
        // AC 4, and the first-writer-wins rule for `endedReason`: a
        // `last_paid_day` arriving after a refund is a legitimate sequence,
        // and the REFUND is what closed it.
        isNull(grants.endedAt),
      ),
    )
    // Empty when it was already ended — i.e. this delivery changed nothing.
    .returning({ id: grants.id });

  // Revocation is the dangerous direction, so it must not fail quietly. A
  // zero-row result means one of: already ended (benign), or no grant for this
  // purchase at all (NOT benign — money was returned and something may still
  // be open). The activate path warns on its analogous case; this one did not,
  // which is what made the whole class undiagnosable in production.
  if (ended.length === 0) {
    console.warn(
      `[entitlements] ${reason} for purchase ${ref.ds24PurchaseId} closed nothing — already ended, or no grant exists`,
    );
  }

  return ended.length > 0;
}

/**
 * Takes access away REVERSIBLY — a payment that genuinely failed (story 2.4).
 *
 * `suspendedAt` and `updatedAt`, AND NOTHING ELSE, on the left of the
 * assignment. `endedAt` is written in exactly ONE place in this whole adapter
 * — `endGrant` above — and that is a property a reviewer checks by grepping
 * for it, so keep it true. Suspension that ends a grant is not a suspension:
 * `endedAt` is terminal for this adapter (AD-2), so nothing could ever lift it
 * again, and the customer whose card expired would be treated as refunded.
 *
 * Two conditions, and both earn their place:
 *
 * - `ended_at IS NULL` — never suspend a grant that is already over. Without
 *   it the `on_payment_missed` that follows every cancellation (§D1) stamps
 *   `suspendedAt` onto a grant `last_paid_day` closed days earlier, and the
 *   Operator's history then shows an expired grant as "suspended". It is also
 *   the write half of the terminal-`endedAt` rule: the decision was made on
 *   the grant as it was READ, and a concurrent delivery may have ended it
 *   since.
 * - `suspended_at IS NULL` — keep the FIRST time. Digistore24 retries a
 *   failing charge over several days and sends this event each time, so
 *   without it the recorded suspension creeps forward on every delivery.
 *   Exactly the reason `endGrant` carries the same guard for `endedAt`.
 *
 * Keyed on (purchase, Product Key), unlike `endGrant`, which deliberately
 * drops the key. Ending must be total — a refund closes everything that
 * purchase paid for. Suspension acts on the item the payload names, which is
 * the narrower and therefore safer half of that asymmetry.
 *
 * Zero rows is NOT worth a warning here, and that is the difference from
 * `endGrant`: "already suspended" is the ordinary case for an event that
 * arrives once per retry, so a warning would fire on healthy traffic and
 * teach the Operator to ignore the log.
 */
async function suspendGrant(ref: PurchaseGrantRef): Promise<boolean> {
  if (!ref.ds24PurchaseId) return false;

  const suspended = await db
    .update(grants)
    .set({
      // Database time, for the reason endGrant gives: a clock-skewed app
      // server must not record a suspension that precedes the grant.
      // See endGrant above — same column type, same reason.
      suspendedAt: sql`(now() at time zone 'utc')`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(grants.ds24PurchaseId, ref.ds24PurchaseId),
        eq(grants.productKey, ref.productKey),
        // Explicitly, not by relying on the `grants_provenance` CHECK — it is
        // hand-written into 0012 and absent from drizzle's snapshots, so a
        // database built with `db:push` does not have it. A missed payment
        // must never reach a manual grant.
        eq(grants.source, "purchase"),
        isNull(grants.endedAt),
        isNull(grants.suspendedAt),
      ),
    )
    // Empty when it was already suspended, already ended, or never existed.
    .returning({ id: grants.id });

  return suspended.length > 0;
}

/**
 * Gives access back — the payment succeeded, or support restarted the
 * rebilling (story 2.4).
 *
 * The SET list is `suspendedAt` and `updatedAt` and nothing else, for the same
 * reason as above. In particular it does NOT clear `endedAt`: `ended_at IS
 * NULL` in the WHERE is what makes AC 5 true in the data, so a support click
 * months after expiry — or an `on_payment` redelivered after a refund — finds
 * no row to lift.
 *
 * An UPDATE, never an INSERT. "Suspend = set endedAt, resume = insert a fresh
 * grant" fails twice over: it contradicts AC 3 in words, and story 2.1's
 * partial unique index forbids the second row outright.
 *
 * No `suspended_at IS NOT NULL` condition, deliberately: writing NULL over
 * NULL changes nothing anybody can observe, and the missing condition means a
 * resume cannot be defeated by a stale read of the suspension state.
 */
async function resumeGrant(ref: PurchaseGrantRef): Promise<boolean> {
  if (!ref.ds24PurchaseId) return false;

  const resumed = await db
    .update(grants)
    .set({
      suspendedAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(grants.ds24PurchaseId, ref.ds24PurchaseId),
        eq(grants.productKey, ref.productKey),
        eq(grants.source, "purchase"),
        // Terminal. Nothing here may reopen a grant a refund, a chargeback or
        // the last paid day closed.
        isNull(grants.endedAt),
      ),
    )
    .returning({ id: grants.id });

  return resumed.length > 0;
}

async function activateGrant(ref: PurchaseGrantRef): Promise<boolean> {
  // Provenance is a CHECK constraint: source='purchase' requires a purchase
  // id. Inserting without one would raise 23514, and an uncaught throw inside
  // the IPN handler 500s the webhook — Digistore24 would then redeliver the
  // same unfixable payload forever. Refuse loudly instead. The order row is
  // written either way, so the Operator can still attach it by hand.
  if (!ref.ds24PurchaseId) {
    // 🚨 A paid purchase that hands out no access. This branch was reached by
    // EVERY purchase in every app while the read point looked for an IPN field
    // Digistore24 does not send, and the line below is all it said — invisible
    // to `node run.mjs errors`, which needs an error object (lib/diagnostics/
    // parse.mjs). `console.error` so the app's own diagnostics see it: the one
    // failure here that a customer notices before the operator does.
    console.error(
      `[entitlements] paid purchase of "${ref.productKey}" carries no order id — no grant created:`,
      new Error("no ds24PurchaseId on the payment event"),
    );
    return false;
  }

  // A refund can arrive BEFORE the payment it reverses — an `on_payment` that
  // failed and is being retried, while `on_refund` lands first and gets its
  // 200. The grant row then does not exist yet, so `endedAt` — the state the
  // `alreadyEnded` guard reads — was never written, the refund closes nothing,
  // and this insert would create a LIVE grant for a refunded purchase. Nothing
  // would ever close it: Digistore24 does not redeliver an event it already
  // acknowledged.
  //
  // `orders.status` is terminal for refunded/chargeback and was written
  // earlier in this same request, so it is the one piece of state that
  // survives the missing grant row. Note this makes the WRITE path read
  // `orders`; AD-1 constrains the READ path (`entitlementsFor`), which still
  // reads `grants` alone.
  const [reversed] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(
      and(
        eq(orders.ds24PurchaseId, ref.ds24PurchaseId),
        inArray(orders.status, ["refunded", "chargeback"]),
      ),
    )
    .limit(1);
  if (reversed) {
    console.warn(
      `[entitlements] purchase ${ref.ds24PurchaseId} is ${reversed.status} — no grant created`,
    );
    return false;
  }

  const created = await db
    .insert(grants)
    .values({
      memberId: ref.memberId,
      productKey: ref.productKey,
      source: "purchase",
      ds24PurchaseId: ref.ds24PurchaseId,
      // NULL for every purchase grant, without exception (AD-2). Purchased
      // access ends by event, never by date.
      accessUntil: null,
    })
    // The partial unique index (ds24_purchase_id, product_key) WHERE
    // ds24_purchase_id IS NOT NULL. `where` here is the index PREDICATE, not a
    // row filter — without it Postgres cannot tell which index arbitrates.
    //
    // DO NOTHING, never DO UPDATE: a redelivered on_payment must not create a
    // second grant AND must not resurrect one a refund ended. `endedAt` is
    // terminal for the adapter (AD-2).
    //
    // AD-2 asks every activate statement to carry `AND ended_at IS NULL`. This
    // one carries no such clause because it has no UPDATE branch to attach it
    // to — DO NOTHING is strictly stronger: it writes no column of the
    // existing row at all, so there is nothing for it to un-end. Turning this
    // into DO UPDATE for any reason reintroduces the requirement.
    .onConflictDoNothing({
      target: [grants.ds24PurchaseId, grants.productKey],
      where: sql`${grants.ds24PurchaseId} is not null`,
    })
    // Empty when the conflict fired — i.e. the grant was already there.
    .returning({ id: grants.id });

  return created.length > 0;
}
