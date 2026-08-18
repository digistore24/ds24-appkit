// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Prepaid token accounts: keep a balance, subtract consumption, credit after a
// paid purchase and top up automatically when needed (auto-recharge).
//
// Layout:
//   - Pure decision logic (first, below) — no database, directly testable.
//   - Database operations (transactions, row locks) for balance and ledger.
//   - autoReloadIfNeeded(): orchestration (check → lock → billing-on-demand).
//     The credit itself does NOT happen here but in the IPN handler, once DS24
//     confirms the payment (on_payment).
//
// The Operator's manual correction (adjustTokens) decides nothing itself: its
// whole rule set is the pure `decideAdjustment` in ./rules.ts, which is where
// this domain's decisions go — there is no test database, so anything worth
// asserting has to be assertable without one.
import { db } from "@/db";
import { tokenAccounts, tokenLedger } from "@/db/schema";
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { createBillingOnDemand, type BillOnDemandArgs } from "@/lib/digistore/billing";
import { productId } from "@/lib/digistore/products";
import { runtimeSyncEnv } from "@/lib/digistore/runtime-env";
import { getTokenPackage } from "./packages";
import { buildIdentity } from "@/lib/digistore/custom";
import { ensureCheckoutToken } from "@/lib/users/checkout-token";
import { clampThreshold, decideAdjustment, TokenError } from "./rules";
import { sellsTokens } from "@/lib/billing-mode";
import type { Actor } from "@/lib/users/rules";

/** Thrown when a consumption would exceed the balance. */
export class InsufficientTokensError extends Error {
  constructor(
    public readonly balance: number,
    public readonly requested: number,
  ) {
    super(`Not enough tokens: balance ${balance}, required ${requested}.`);
    this.name = "InsufficientTokensError";
  }
}

// Stale-lock timeout: a reload lock that got stuck is released again after
// this many hours (in case an IPN never arrived).
//
// ⚠️ Read this together with RELOAD_ATTEMPT_LIMIT below. This timeout recovers
// a CRASHED process that still holds the lock — that is what it was written
// for and it does it correctly. It does not recover a permanently missing IPN:
// there it is the interval at which the same charge repeats.
const RELOAD_LOCK_TIMEOUT_HOURS = 6;

/**
 * How many on-demand charges may go out without a single one coming back as a
 * booked credit, before auto top-up stops charging.
 *
 * Two, not one, and not unlimited:
 *
 * - **Not unlimited** — that is the loop this constant exists to close. A lost
 *   IPN billed the card every `RELOAD_LOCK_TIMEOUT_HOURS` for as long as the
 *   Member's balance stayed low, which is for ever, because the credit that
 *   would raise it is the thing that never arrived.
 * - **Not one** — Digistore24 can be slow, and a credit arriving after the
 *   stale timeout is a working installation, not a broken one. Refusing after
 *   a single unconfirmed charge would stop healthy accounts.
 *
 * Two lets one charge go unconfirmed and stops at the second. By then the
 * Member has been billed twice with nothing delivered, which is already more
 * than anybody should have to notice for themselves.
 */
export const RELOAD_ATTEMPT_LIMIT = 2;

// --- Pure decision logic -----------------------------------------------------

/** Is the balance enough for a consumption? */
export function hasSufficientBalance(balance: number, cost: number): boolean {
  return cost >= 0 && balance >= cost;
}

/** Should we auto top up? (enabled AND balance <= threshold) */
export function shouldAutoReload(account: {
  balance: number;
  autoReloadEnabled: boolean;
  autoReloadThreshold: number;
}): boolean {
  return account.autoReloadEnabled && account.balance <= account.autoReloadThreshold;
}

/**
 * Has auto top-up charged this card too often without a credit coming back?
 *
 * PURE, and separate from `shouldAutoReload` on purpose. That function answers
 * *"does this account want a top-up"* — a question about the Member's settings
 * and balance. This one answers *"may we still charge for it"* — a question
 * about whether the last charges worked. Keeping them apart is what lets the
 * caller tell a paused account from a disabled one, and say so.
 *
 * PAUSED, NOT DISABLED. `autoReloadEnabled` stays true and the stored mandate
 * (`ds24PurchaseId`) is untouched, because nothing about the Member's intent
 * changed — only our confidence that the charge reaches them. The moment a
 * credit books, `reloadAttempts` returns to 0 and top-ups resume by themselves,
 * with nobody having to press anything.
 */
export function reloadIsPaused(
  account: { reloadAttempts: number },
  limit: number = RELOAD_ATTEMPT_LIMIT,
): boolean {
  return account.reloadAttempts >= limit;
}

/**
 * How many accounts have stopped charging because nothing came back.
 *
 * Reads, never writes. This is the number `check-stuck-reloads` reports, and
 * the reason it is a scheduled job rather than something the spend path
 * notices: a paused account is one nobody is spending on any more. If the
 * Member's balance is stuck at zero they stop using the app, `spendTokens()`
 * is never called again, and the code path that would log the pause never
 * runs. Nothing would ever ask the question unless something asks it on a
 * timer.
 */
export async function countPausedReloads(
  limit: number = RELOAD_ATTEMPT_LIMIT,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tokenAccounts)
    .where(
      and(
        eq(tokenAccounts.autoReloadEnabled, true),
        sql`${tokenAccounts.reloadAttempts} >= ${limit}`,
      ),
    );
  return row?.n ?? 0;
}

/** Is a set reload lock stale (timeout exceeded)? */
export function isReloadLockStale(
  lockedAt: Date | null,
  now: Date,
  timeoutHours: number = RELOAD_LOCK_TIMEOUT_HOURS,
): boolean {
  if (!lockedAt) return true; // kein Lock = frei
  return lockedAt.getTime() < now.getTime() - timeoutHours * 3_600_000;
}

// --- Database operations -----------------------------------------------------

export async function getTokenAccount(memberId: string) {
  return db.query.tokenAccounts.findFirst({
    where: eq(tokenAccounts.memberId, memberId),
  });
}

/** How many ledger rows the Operator view asks for at once. */
export const LEDGER_PAGE_SIZE = 100;

/** One booking, as the Operator reads it (story 3.1). */
export interface LedgerRow {
  id: string;
  /** All four are rendered. Nothing writes `refund` today — see below. */
  type: "topup" | "consume" | "refund" | "adjust";
  /** SIGNED: + for topup/refund/upward adjust, − for consume. */
  amount: number;
  balanceAfter: number;
  note: string | null;
  /** "sub" | "topup" | "auto" — how the crediting purchase was initiated. */
  origin: string | null;
  createdAt: Date;
}

/**
 * The Member's bookings, newest first — the audit trail behind the balance.
 *
 * A JOIN over `token_accounts`, not a lookup of the account id first: a Member
 * who never bought tokens HAS no account row (see `getTokenAccount` above),
 * and a join simply yields nothing where a two-step read would have to handle
 * the `undefined` — the single most likely 500 on the Operator page.
 *
 * `id` as the tiebreak on `created_at`, and it is load-bearing: `created_at`
 * defaults to `now()`, which in Postgres is the TRANSACTION timestamp, so the
 * several credits the claim path books in one transaction share it EXACTLY.
 * Ordered on the timestamp alone, an audit view would list them in whatever
 * order the planner felt like — differently on two consecutive loads.
 *
 * Capped, because an account that has consumed tokens per request has an
 * unbounded number of rows and an Operator page must not try to render them
 * all. The caller is told when it hit the cap (`rows.length === limit`) so it
 * can say so rather than quietly present a slice as the whole story.
 */
export async function listLedgerFor(
  memberId: string,
  limit: number = LEDGER_PAGE_SIZE,
): Promise<LedgerRow[]> {
  // A caller passing 0 would render "nothing was ever credited" over a full
  // account; a negative one raises a Postgres error the Operator reads as
  // "unknown error". Neither is reachable today — that is exactly when it is
  // cheap to close.
  const take = Math.max(1, Math.trunc(limit));
  return db
    .select({
      id: tokenLedger.id,
      type: tokenLedger.type,
      amount: tokenLedger.amount,
      balanceAfter: tokenLedger.balanceAfter,
      note: tokenLedger.note,
      origin: tokenLedger.origin,
      createdAt: tokenLedger.createdAt,
    })
    .from(tokenLedger)
    .innerJoin(tokenAccounts, eq(tokenLedger.accountId, tokenAccounts.id))
    .where(eq(tokenAccounts.memberId, memberId))
    .orderBy(desc(tokenLedger.createdAt), desc(tokenLedger.id))
    .limit(take);
}

/** Creates an (empty) account if needed and returns it. */
export async function getOrCreateTokenAccount(memberId: string) {
  await db
    .insert(tokenAccounts)
    .values({ memberId })
    .onConflictDoNothing({ target: tokenAccounts.memberId });
  const acct = await getTokenAccount(memberId);
  if (!acct) throw new Error("Token-Konto konnte nicht angelegt werden.");
  return acct;
}

/**
 * Subtracts tokens (consumption). A transaction plus a row lock (FOR UPDATE)
 * prevents race conditions on concurrent requests. Throws
 * InsufficientTokensError when the balance is not enough. Returns the new
 * balance.
 */
export async function consumeTokens(args: {
  memberId: string;
  amount: number;
  note?: string;
  now?: Date;
}): Promise<number> {
  if (args.amount <= 0) throw new Error("amount muss > 0 sein.");
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [acct] = await tx
      .select()
      .from(tokenAccounts)
      .where(eq(tokenAccounts.memberId, args.memberId))
      .for("update");
    if (!acct) throw new InsufficientTokensError(0, args.amount);
    if (!hasSufficientBalance(acct.balance, args.amount)) {
      throw new InsufficientTokensError(acct.balance, args.amount);
    }
    const newBalance = acct.balance - args.amount;
    await tx
      .update(tokenAccounts)
      .set({ balance: newBalance, updatedAt: now })
      .where(eq(tokenAccounts.id, acct.id));
    await tx.insert(tokenLedger).values({
      accountId: acct.id,
      type: "consume",
      amount: -args.amount,
      balanceAfter: newBalance,
      note: args.note,
    });
    return newBalance;
  });
}

/**
 * Credits tokens after a confirmed payment. Idempotent by
 * (accountId, ds24OrderId): a second IPN with the same order ID does NOT book
 * again. Optionally releases the auto-reload lock. Returns whether a credit
 * happened, plus the (possibly unchanged) balance.
 */
export async function creditTokens(args: {
  memberId: string;
  credits: number;
  ds24OrderId: string;
  note?: string;
  /**
   * Release the lock after a successful auto reload.
   *
   * Released ONLY when it is still the lock the outstanding charge set — see
   * the `reloadLockedAt` guard at both write sites below. An unconditional
   * clear here is the same defect `releaseReloadSlot` was fixed for in story
   * 1.5: a late IPN wipes a successor's lock and the next spend fires a third
   * charge against the customer's card.
   */
  releaseReloadLock?: boolean;
  /**
   * The lock timestamp this credit is allowed to clear. Defaults to clearing
   * whatever is there — kept only so existing callers compile; the IPN passes
   * the account's current `reloadLockedAt`.
   */
  releaseLockedAt?: Date | null;
  /** How the purchase was initiated (from the k: pair). Stored on the ledger
   *  row so a top-up is distinguishable from a manual purchase. */
  origin?: string | null;
  /**
   * The ORDER id of the purchase — remembered as the charge target for auto
   * top-ups if the account does not have one yet (e.g. on the first token
   * purchase with force_rebilling). It is the value createBillingOnDemand
   * later passes as its `purchase_id` parameter; the column it lands in is
   * still called `ds24_purchase_id` and holds an order id
   * (lib/digistore/payment-event.ts).
   */
  linkPurchaseId?: string;
  now?: Date;
}): Promise<{ credited: boolean; balance: number }> {
  if (args.credits <= 0) throw new Error("credits muss > 0 sein.");
  const now = args.now ?? new Date();
  // Make sure the account exists (outside the transaction, idempotent).
  await getOrCreateTokenAccount(args.memberId);
  return db.transaction(async (tx) => {
    const [acct] = await tx
      .select()
      .from(tokenAccounts)
      .where(eq(tokenAccounts.memberId, args.memberId))
      .for("update");
    if (!acct) throw new Error("Token-Konto verschwunden.");

    const newBalance = acct.balance + args.credits;
    // Ledger row first — if it collides (same ds24OrderId), the purchase was
    // already booked → do nothing.
    const inserted = await tx
      .insert(tokenLedger)
      .values({
        accountId: acct.id,
        type: "topup",
        amount: args.credits,
        balanceAfter: newBalance,
        ds24OrderId: args.ds24OrderId,
        note: args.note,
        origin: args.origin ?? null,
      })
      // Conflict on the PAYMENT, not on (account, payment).
      //
      // Keying on the account let one payment be booked twice: both
      // `orders.memberId` and `tokenAccounts.memberId` are `set null` on
      // delete, so deleting a Member and re-registering under the same address
      // produces a SECOND account, the sign-in claim re-attributes the order,
      // and (newAccount, sameOrder) collides with nothing. The customer ends
      // up with twice the tokens one purchase paid for.
      //
      // The `where` is the partial index's PREDICATE, not a row filter —
      // without it Postgres cannot tell which index arbitrates and raises
      // 42P10 instead, which 500s the webhook. See migration 0016 for why that
      // index has to be hand-written.
      .onConflictDoNothing({
        target: tokenLedger.ds24OrderId,
        where: sql`${tokenLedger.ds24OrderId} is not null and ${tokenLedger.type} = 'topup'`,
      })
      .returning({ id: tokenLedger.id });

    if (inserted.length === 0) {
      // Already booked — but the purchase LINKAGE and the lock release are not
      // the booking, and returning here dropped both. A claim credits first
      // with no order id (orders.ds24PurchaseId was still NULL), the IPN
      // redelivery then carries the real one and lost it, so the auto top-up
      // mandate stayed unlinked and `autoReloadIfNeeded` answered
      // "not-configured" forever, silently.
      if ((args.linkPurchaseId && !acct.ds24PurchaseId) || args.releaseReloadLock) {
        await tx
          .update(tokenAccounts)
          .set({
            ...(args.linkPurchaseId && !acct.ds24PurchaseId
              ? { ds24PurchaseId: args.linkPurchaseId }
              : {}),
            ...(args.releaseReloadLock && ownsLock(acct, args)
              ? { reloadLockedAt: null, lastReloadAt: now, reloadAttempts: 0 }
              : {}),
            updatedAt: now,
          })
          .where(eq(tokenAccounts.id, acct.id));
      }
      return { credited: false, balance: acct.balance };
    }
    await tx
      .update(tokenAccounts)
      .set({
        balance: newBalance,
        // Only remember the order id if none is stored yet.
        ...(args.linkPurchaseId && !acct.ds24PurchaseId
          ? { ds24PurchaseId: args.linkPurchaseId }
          : {}),
        ...(args.releaseReloadLock && ownsLock(acct, args)
          // `reloadAttempts: 0` rides with the lock release, under the same
          // `ownsLock` guard and for the same reason. A credit that may clear
          // this charge's lock is a credit that proves the chain — checkout,
          // charge, IPN, booking — works end to end. That is the only evidence
          // worth resetting the counter on, and it is why the counter is not
          // reset when a charge merely returns 200 from Digistore24.
          ? { reloadLockedAt: null, lastReloadAt: now, reloadAttempts: 0 }
          : {}),
        updatedAt: now,
      })
      .where(eq(tokenAccounts.id, acct.id));
    return { credited: true, balance: newBalance };
  });
}

/**
 * The Operator corrects a balance by hand (story 3.2). Returns the resulting
 * balance and the delta that was booked; throws `TokenError` with a
 * translatable code when the correction is refused, and then writes NOTHING —
 * the throw happens inside the transaction, so the balance stays as it was.
 *
 * A function of its own, NOT an extra flag on `creditTokens`, for four
 * independent reasons:
 *
 *  1. `creditTokens` throws on `credits <= 0`; a negative correction cannot
 *     pass it at all.
 *  2. It hard-codes `type: "topup"` — the one thing an adjustment must not be
 *     mistaken for in the journal.
 *  3. Its `ds24OrderId` is required and load-bearing for idempotency.
 *  4. Its `onConflictDoNothing` targets the PARTIAL index
 *     `where ds24_order_id is not null and type = 'topup'`. An adjust row
 *     satisfies neither half, so the clause would be silently vacuous — an
 *     "idempotent" write with no idempotency.
 *
 * A plain INSERT with no `onConflict` is what is correct here: Postgres treats
 * NULLs as distinct in `unique(account_id, ds24_order_id)`, so any number of
 * adjust rows per account is fine — every `consume` row is written that way
 * already.
 *
 * `ds24OrderId` stays NULL, deliberately. Setting it to "link the correction to
 * the purchase" would hit the NON-partial unique against the existing `topup`
 * row for that order — a 23505 the Operator reads as "unknown error".
 *
 * An adjustment is NOT idempotent and must not be: two identical corrections
 * are two legitimate corrections. A double-click is kept off by
 * `disabled={isPending}` in the UI, not by a key here.
 */
export async function adjustTokens(args: {
  /** The Operator. Checked again in decideAdjustment — actions are endpoints. */
  actor: Actor;
  memberId: string;
  /** Raw form input; validated in decideAdjustment, never trusted here. */
  amount: unknown;
  reason: unknown;
  now?: Date;
}): Promise<{ balance: number; delta: number }> {
  // An app that sells no tokens carries no endpoint that mints them
  // (config/digistore-products.json -> "billingMode"; lib/billing-mode.ts).
  // HERE rather than in the server action, because this is the only by-hand
  // mint in the app and every caller has to meet the same refusal — the form
  // being gone from the page protects nothing.
  //
  // Deliberately the one place the mode does more than hide a card: everything
  // else about a legacy balance keeps working — it is displayed, it is
  // consumed, an IPN still credits it. Only creating tokens out of nothing
  // stops. To correct a legacy balance, set the mode back.
  if (!sellsTokens()) throw new TokenError("tokensNotSold");

  const now = args.now ?? new Date();
  // Outside the transaction, exactly as creditTokens does it: `FOR UPDATE`
  // cannot lock a row that does not exist, and a Member who never bought
  // tokens HAS no account row.
  await getOrCreateTokenAccount(args.memberId);
  return db.transaction(async (tx) => {
    // The lock is the whole answer to AC 7. Without it two Operators both read
    // 100, one writes 150 and the other 50 — one correction vanishes AND both
    // ledger rows record a `balanceAfter` that was never true. The journal is
    // the one artifact that must not lie, and no unit test would see it.
    const [acct] = await tx
      .select()
      .from(tokenAccounts)
      .where(eq(tokenAccounts.memberId, args.memberId))
      .for("update");
    if (!acct) throw new Error("Token-Konto verschwunden.");

    // Decided against the LOCKED balance — the reason the decision is not made
    // before the transaction opens.
    const decision = decideAdjustment({
      actor: args.actor,
      balance: acct.balance,
      amount: args.amount,
      reason: args.reason,
    });
    if (!decision.ok) throw new TokenError(decision.code);

    await tx
      .update(tokenAccounts)
      .set({ balance: decision.balanceAfter, updatedAt: now })
      .where(eq(tokenAccounts.id, acct.id));
    await tx.insert(tokenLedger).values({
      accountId: acct.id,
      type: "adjust",
      amount: decision.delta,
      balanceAfter: decision.balanceAfter,
      note: decision.reason,
      // WHO corrected it. The whole point of the column: without it the
      // Operator would have to be smuggled into `note`.
      issuedBy: args.actor.id,
    });
    return { balance: decision.balanceAfter, delta: decision.delta };
  });
}

/**
 * Does this credit still own the lock it is about to clear?
 *
 * The row is read `FOR UPDATE` inside the transaction, so `acct.reloadLockedAt`
 * is the live value. When the caller names the timestamp it expects, clearing
 * a DIFFERENT one is refused: a charge whose IPN arrives after its lock went
 * stale and was taken over must not release the successor's lock, or the next
 * spend claims a fresh slot and fires a third charge. Same rule, same reason as
 * `releaseReloadSlot` (story 1.5 §D2) — that one guarded its own UPDATE and
 * this twin was missed.
 *
 * A caller that names nothing keeps the old behaviour, so nothing that does not
 * know about locks changes.
 */
function ownsLock(
  acct: { reloadLockedAt: Date | null },
  args: { releaseLockedAt?: Date | null },
): boolean {
  if (args.releaseLockedAt === undefined) return true;
  if (args.releaseLockedAt === null) return acct.reloadLockedAt === null;
  return acct.reloadLockedAt?.getTime() === args.releaseLockedAt.getTime();
}

/**
 * Atomically tries to take the auto-reload slot (lock). Only ONE concurrent
 * call wins — this prevents double charging. A stale lock (timeout) is taken
 * over in the process. Returns true if the lock was won.
 */
export async function claimReloadSlot(
  memberId: string,
  now: Date = new Date(),
  timeoutHours: number = RELOAD_LOCK_TIMEOUT_HOURS,
  attemptLimit: number = RELOAD_ATTEMPT_LIMIT,
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - timeoutHours * 3_600_000);
  const claimed = await db
    .update(tokenAccounts)
    .set({
      reloadLockedAt: now,
      // Counted HERE rather than after the charge returns, and that ordering is
      // the point: taking the slot is the commitment to bill. A counter written
      // after `createBillingOnDemand` would miss exactly the case this exists
      // for — a charge that goes out and whose answer never comes back.
      reloadAttempts: sql`${tokenAccounts.reloadAttempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(tokenAccounts.memberId, memberId),
        eq(tokenAccounts.autoReloadEnabled, true),
        or(
          isNull(tokenAccounts.reloadLockedAt),
          lt(tokenAccounts.reloadLockedAt, staleBefore),
        ),
        // The limit again, in the same statement that takes the slot. The
        // caller already refused above; this is the second line of defence, in
        // the shape `pruneImpersonations` uses for its retention window. Two
        // spends landing at the same moment both read an account at
        // `attemptLimit - 1` and both pass a check made outside this UPDATE —
        // only one of them can win it.
        lt(tokenAccounts.reloadAttempts, attemptLimit),
      ),
    )
    .returning({ id: tokenAccounts.id });
  return claimed.length === 1;
}

/**
 * Releases the reload lock — but only the one WE set.
 *
 * The `reloadLockedAt = lockedAt` guard is load-bearing. Without it: request A
 * claims and hangs; 6h later the lock is stale and request B takes it over and
 * starts a charge; A's socket finally errors and A clears B's lock; request C
 * claims and fires a THIRD charge against the customer's card. Releasing only
 * the timestamp we set closes that. `lockedAt` is the same `now` passed to
 * claimReloadSlot at the call site.
 */
export async function releaseReloadSlot(
  accountId: string,
  lockedAt: Date,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(tokenAccounts)
    .set({ reloadLockedAt: null, updatedAt: now })
    .where(
      and(
        eq(tokenAccounts.id, accountId),
        eq(tokenAccounts.reloadLockedAt, lockedAt),
      ),
    );
}

/**
 * The threshold this package can actually be topped up past.
 *
 * Resolving the package here rather than in `rules.ts` keeps that file pure —
 * the registry lookup is I/O-shaped and throws on an unknown key. An unknown or
 * absent package cannot be reasoned about, so the threshold is refused
 * outright: 0 means "only when empty", which is the safe direction. A wrong
 * high threshold is a repeating card charge.
 */
function safeReloadThreshold(threshold: number, packageKey: string | null): number {
  if (!packageKey) return 0;
  try {
    return clampThreshold(threshold, getTokenPackage(packageKey).credits);
  } catch {
    return 0;
  }
}

/**
 * Sets an account's auto-reload settings.
 *
 * The threshold is CLAMPED against the package it tops up with
 * (`safeReloadThreshold`). `shouldAutoReload` is `balance <= threshold`, so a
 * threshold at or above the package's credits means the balance is still at or
 * below it right after a successful top-up — and the next spend fires another
 * charge, and the next, until Digistore24's 10-per-day cap stops it. Clamping
 * here rather than at the call sites is deliberate: this is the only writer of
 * those columns, and the documented cron-sweep path calls it directly.
 */
export async function setAutoReload(args: {
  memberId: string;
  enabled: boolean;
  threshold: number;
  packageKey: string | null;
  ds24PurchaseId: string | null;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  await getOrCreateTokenAccount(args.memberId);
  await db
    .update(tokenAccounts)
    .set({
      autoReloadEnabled: args.enabled,
      autoReloadThreshold: safeReloadThreshold(args.threshold, args.packageKey),
      autoReloadPackageKey: args.packageKey,
      ds24PurchaseId: args.ds24PurchaseId,
      // A fresh mandate starts with a clean count. This runs when a purchase
      // arms auto top-up (story 5.3), and the charges counted before it belong
      // to a mandate that is being replaced.
      reloadAttempts: 0,
      updatedAt: now,
    })
    .where(eq(tokenAccounts.memberId, args.memberId));
}

/**
 * Stops unattended charging for one account, and forgets the mandate when the
 * mandate itself is what went wrong.
 *
 * Called from two places that have nothing to do with each other and everything
 * to do with the same rule — **the app must never charge a card it has been
 * told to stop charging**:
 *
 *  - a refund or chargeback of the purchase the mandate points at. Continuing
 *    to charge a payment the customer has just reversed is the single worst
 *    thing this feature can do.
 *  - blocking the account. A blocked Member is redirected out of `/dashboard`,
 *    so their own off switch is unreachable — leaving them armed would charge a
 *    card belonging to somebody the Operator has just locked out.
 *
 * `clearMandate` distinguishes the two: a reversed purchase must not be
 * re-armable, so its `ds24PurchaseId` goes; a blocked account may be unblocked
 * tomorrow and keeps its mandate.
 *
 * Idempotent, and silent when there is no account — both callers run on paths
 * where most accounts have never touched tokens.
 */
export async function disarmAutoReload(args: {
  memberId: string;
  clearMandate?: boolean;
  /** Only disarm when the mandate is this purchase. Omit to disarm regardless. */
  onlyForPurchaseId?: string;
  now?: Date;
}): Promise<boolean> {
  const now = args.now ?? new Date();
  const acct = await getTokenAccount(args.memberId);
  if (!acct) return false;
  if (args.onlyForPurchaseId && acct.ds24PurchaseId !== args.onlyForPurchaseId) {
    return false;
  }
  if (!acct.autoReloadEnabled && !args.clearMandate) return false;
  await db
    .update(tokenAccounts)
    .set({
      autoReloadEnabled: false,
      // The lock goes too. `claimReloadSlot` only ever takes a slot on an
      // ENABLED account, so a lock left behind here could never be cleared by
      // anything — and would silently swallow the first 6h of a later re-arm.
      reloadLockedAt: null,
      ...(args.clearMandate ? { ds24PurchaseId: null, autoReloadPackageKey: null } : {}),
      updatedAt: now,
    })
    .where(eq(tokenAccounts.id, acct.id));
  return true;
}

/**
 * Flips ONLY the on/off switch, leaving threshold, package and mandate alone.
 *
 * A single conditional UPDATE rather than a read-then-write: the Member's own
 * switch and the IPN's arming touch the same row, and a read-modify-write there
 * hands back a stale snapshot that clobbers a mandate the IPN has just linked.
 *
 * Enabling REQUIRES a stored mandate and a package. It cannot invent one — the
 * chargeable order only comes into being through a purchase — so this
 * returns false rather than arming something that would answer
 * "not-configured" for ever, silently.
 *
 * Returns whether the row was actually changed.
 */
export async function setAutoReloadEnabled(args: {
  memberId: string;
  enabled: boolean;
  now?: Date;
}): Promise<boolean> {
  const now = args.now ?? new Date();
  const changed = await db
    .update(tokenAccounts)
    .set({
      autoReloadEnabled: args.enabled,
      // Turning off clears the lock: `claimReloadSlot` only takes a slot on an
      // enabled account, so a lock left here could never be released by
      // anything, and would silently swallow the first 6h of a later re-arm.
      ...(args.enabled ? {} : { reloadLockedAt: null }),
      // Touching the switch at all resets the unconfirmed-charge counter, in
      // either direction. This is the Member's own control, and off-then-on is
      // the gesture anybody makes when something looks stuck — it should
      // actually unstick it. Resetting on BOTH directions rather than only on
      // `enabled` keeps that true no matter which half they do first.
      reloadAttempts: 0,
      updatedAt: now,
    })
    .where(
      args.enabled
        ? and(
            eq(tokenAccounts.memberId, args.memberId),
            isNotNull(tokenAccounts.ds24PurchaseId),
            isNotNull(tokenAccounts.autoReloadPackageKey),
          )
        : eq(tokenAccounts.memberId, args.memberId),
    )
    .returning({ id: tokenAccounts.id });
  return changed.length === 1;
}

export interface AutoReloadResult {
  triggered: boolean;
  reason?:
    | "no-account"
    | "disabled-or-above-threshold"
    | "not-configured"
    /**
     * Charged `RELOAD_ATTEMPT_LIMIT` times with no credit coming back, so
     * charging has stopped. Distinct from `"locked"` — that one means another
     * charge is in flight right now and this spend should simply skip. This
     * one means the last charges went out and nothing answered, and it does
     * not clear itself with time. It clears when a credit books, or when the
     * Member touches their own switch.
     */
    | "paused-unconfirmed"
    | "locked";
}

/**
 * Checks an account and starts an auto top-up if needed: take the lock →
 * createBillingOnDemand against the stored order id (which the API takes as
 * its `purchase_id` parameter). The credit follows via IPN (which also releases
 * the lock). If the charge fails, the lock is released immediately and the
 * error is thrown.
 *
 * Call it e.g. right after consumeTokens, or from a cron job across all
 * accounts with a low balance.
 */
export async function autoReloadIfNeeded(args: {
  memberId: string;
  apiKey: string;
  now?: Date;
  /** Injectable for tests; default: the real createBillingOnDemand. */
  bill?: (apiKey: string, a: BillOnDemandArgs) => Promise<unknown>;
}): Promise<AutoReloadResult> {
  const now = args.now ?? new Date();
  const acct = await getTokenAccount(args.memberId);
  if (!acct) return { triggered: false, reason: "no-account" };
  if (!shouldAutoReload(acct)) {
    return { triggered: false, reason: "disabled-or-above-threshold" };
  }
  if (!acct.autoReloadPackageKey || !acct.ds24PurchaseId) {
    return { triggered: false, reason: "not-configured" };
  }
  if (reloadIsPaused(acct)) {
    // The one place in this file that logs. Everything else here is a quiet
    // "no" that happens thousands of times a day; this is the state where a
    // card has been billed more than once and nothing came back, and it is
    // invisible from every other angle — no exception was thrown, no charge
    // failed, the Member's switch still reads "on". `check-stuck-reloads`
    // reports the same accounts as a count, and the Operator's member page
    // shows it per Member; this line is what puts it in `node run.mjs logs`.
    console.error(
      `[tokens] auto top-up paused for member ${args.memberId}: ` +
        `${acct.reloadAttempts} charge(s) with no credit booked. ` +
        `The card was billed and the IPN never arrived — check the Digistore24 ` +
        `IPN configuration before re-arming.`,
    );
    return { triggered: false, reason: "paused-unconfirmed" };
  }
  const claimed = await claimReloadSlot(args.memberId, now);
  if (!claimed) return { triggered: false, reason: "locked" };
  try {
    const pkg = getTokenPackage(acct.autoReloadPackageKey);
    const bill = args.bill ?? createBillingOnDemand;
    // The identity travels with an unattended charge exactly as it does with a
    // checkout. Without it this payment would be attributed by buyer email
    // alone — and when that address does not match the app account, the charge
    // succeeds, the credit is suppressed, and the reload lock holds the account
    // at a zero balance for hours.
    const checkoutToken = await ensureCheckoutToken(args.memberId);
    await bill(args.apiKey, {
      purchaseId: acct.ds24PurchaseId,
      // The registry product id of THIS instance's environment — an auto
      // top-up in a dev app recharges against the dev product, live against
      // the live one.
      productId: productId(pkg.key, undefined, runtimeSyncEnv()),
      priceCents: pkg.priceCents,
      currency: pkg.currency,
      custom: buildIdentity({
        memberId: args.memberId,
        checkoutToken,
        productKey: pkg.key,
        kind: "auto",
      }),
    });
    return { triggered: true };
  } catch (err) {
    // Release the slot WE claimed (now), and never let a release failure
    // replace the original error the caller needs to see.
    await releaseReloadSlot(acct.id, now, now).catch(() => {});
    throw err;
  }
}
