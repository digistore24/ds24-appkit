// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Charging a Member for what they used — the call a feature makes.
//
// ── Why this exists next to consumeTokens ──────────────────────────────────
// `consumeTokens({ memberId, … })` is the primitive: it names whose balance
// moves, which is right for the IPN and for an Operator acting on somebody
// else. It is exactly wrong as the thing a feature calls, because the shape it
// invites is this:
//
//     await consumeTokens({ memberId: String(formData.get("memberId")), … })
//
// — an IDOR that drains another customer's balance. A Server Action is an HTTP
// endpoint of its own; the button rendering only for the right person protects
// nothing.
//
// `spendTokens` closes that by construction: it has NO parameter that could
// carry a member id. The account acted on is always the session's own, the
// same treatment `app/dashboard/account/actions.ts` gives every action there.
//
// ⛔ Do not "improve" this into an optional `memberId` defaulting to the
// session. A default means "debits the session owner UNLESS somebody passes
// something else", where what is needed is "CANNOT debit anybody else" — and
// the bad call above compiles again the moment the parameter exists. There is a
// second, quieter cost: such a default has to read
// `args.memberId ?? (await requireActiveUser())…`, so the session is consulted
// only when nothing was passed — and `requireActiveUser()` is also what turns
// away BLOCKED accounts. If cross-member spending is ever genuinely needed (a
// team seat billed to the owner's balance), it is a NEW function —
// `spendTokensFor({ actor, memberId })` opening with `requireOwner()`, named so
// the authority requirement is visible at the call site. That is the same deal
// `adjustTokens` already makes: name somebody else, and you must name and prove
// who you are.
import { after } from "next/server";

import { requireActiveUser } from "@/lib/authz";
import { ds24ApiKey, hasDigistoreApiKey } from "@/lib/digistore/settings";
import {
  autoReloadIfNeeded,
  consumeTokens,
  InsufficientTokensError,
} from "./account";
import { MAX_TOKEN_AMOUNT, TokenError } from "./rules";

/**
 * Is this a price this app may charge?
 *
 * Whole, positive, and inside the ledger's `integer` column. Pure, so the
 * boundaries are covered by a test rather than by whatever the first caller
 * happens to pass.
 */
export function isSpendableAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= MAX_TOKEN_AMOUNT;
}

/**
 * The one error a Member is meant to read, as a translatable code — everything
 * else stays itself.
 *
 * Returns `null` for errors this layer has no opinion about. Swallowing them
 * into "not enough tokens" would tell somebody with a full balance that they
 * are broke, and would hide a database outage behind a billing message.
 */
export function spendErrorFor(err: unknown): TokenError | null {
  if (err instanceof InsufficientTokensError) {
    return new TokenError("insufficientBalance");
  }
  return null;
}

/**
 * Charges the signed-in Member for something they just used. Returns the
 * balance that is left.
 *
 * ```ts
 * // In a Server Action, after doing the work:
 * import { spendTokens } from "@/lib/tokens/spend";
 *
 * const left = await spendTokens({ amount: 5, note: "report generation" });
 * ```
 *
 * **`amount` is YOUR price, never a number from the request.** Reading it from
 * a form lets the customer set it to 1 — or to 0 — and use the app for free.
 * Derive it from what was done, in code.
 *
 * **`note` ends up in a subject access request** (`node run.mjs data-export`)
 * and is covered by `docs/data-protection.md`. Keep it a short label for WHAT
 * was charged ("report generation"), never the content the Member submitted.
 *
 * **Order of operations: check → work → charge.** Charging first bills for work
 * that then fails; charging after work with no check in front hands the result
 * to somebody who cannot pay, because by the time this throws the expensive
 * part has already run. So gate on `hasSufficientBalance` BEFORE starting, and
 * charge once it worked:
 *
 * ```ts
 * const account = await getTokenAccount(memberId);
 * if (!hasSufficientBalance(account?.balance ?? 0, COST)) return { error: … };
 * const result = await doTheExpensiveThing();
 * await spendTokens({ amount: COST, note: "…" });
 * ```
 *
 * The gap between the check and the charge is real but bounded: the worst case
 * is one operation's worth, and the row lock still stops the balance going
 * negative. Closing it properly means reserving up front, which this template
 * deliberately does not do.
 *
 * **Not idempotent.** Two submissions charge twice — there is no key to
 * deduplicate on, exactly as with `adjustTokens` (and unlike `creditTokens`,
 * which keys on the Digistore24 order id). Keep a double-click off with
 * `disabled={isPending}` in the UI; do not build a retry that calls this again
 * blindly.
 *
 * Throws:
 *  - `TokenError("insufficientBalance")` — the Member cannot afford it. Nothing
 *    is written; catch it in the Server Action and translate it (AD-10).
 *  - a plain `Error` — the amount is not a legal price. That is a bug in YOUR
 *    pricing, not something the Member did, so it is not dressed up as a
 *    message to them; it belongs in `node run.mjs logs`.
 *
 * Concurrency is already handled: `consumeTokens` runs in a transaction with a
 * row lock, so two requests racing at the same balance are serialised and
 * neither can drive it below zero.
 *
 * NOT gated on `sellsTokens()`, deliberately — see the note below the code.
 */
export async function spendTokens(args: {
  amount: number;
  note?: string;
}): Promise<number> {
  // First line, and the whole authorisation: signed out → /login, blocked →
  // /login. Nothing downstream re-derives who this is.
  const session = await requireActiveUser();
  const memberId = session.user.id;

  // ── The one carve-out to "an impersonated session IS the member" ──────────
  // An Operator signed in as a customer can do everything that customer can,
  // deliberately — including spending their tokens, which is what makes a
  // support session useful. It stops at their CARD.
  //
  // `autoReloadIfNeeded` calls `createBillingOnDemand`, which charges a stored
  // payment method with nobody present to agree to it. Left armed, an Operator
  // clicking around a customer's account to reproduce a bug can bill that
  // customer real money — a support session turning into a charge on somebody's
  // statement, with no way to tell it apart from one they made themselves.
  //
  // Suppressed here, at the spend, and NOT in whichever page happened to call
  // it: applications built on this template will call `spendTokens()` without
  // knowing this feature exists. The spend itself still goes through, and a
  // shortfall still throws `insufficientBalance` — which is exactly what a real
  // member with an empty balance and no top-up armed would see.
  const impersonating = Boolean(session.user.impersonation);

  if (!isSpendableAmount(args.amount)) {
    // Deliberately NOT a TokenError. A translatable code is a sentence shown to
    // the Member, and "please enter a whole number" is nonsense to somebody who
    // entered nothing — the app computed this. Surfacing it as a programming
    // error is the same choice `getProduct()` makes on an unknown key.
    throw new Error(
      `spendTokens: ${args.amount} is not a legal price (whole, > 0, <= ${MAX_TOKEN_AMOUNT}).`,
    );
  }

  let balance: number;
  try {
    balance = await consumeTokens({
      memberId,
      amount: args.amount,
      note: args.note,
    });
  } catch (err) {
    const mapped = spendErrorFor(err);
    if (mapped) {
      // A SHORTFALL is the strongest possible signal that a top-up is due, and
      // it used to be the one case that never triggered one: the throw left
      // before the trigger below ever ran. An armed account could then strand
      // for good — balance above the threshold but below the next price, so no
      // successful spend ever crosses the line either, and nothing tops it up.
      if (!impersonating) scheduleTopUp(memberId);
      throw mapped;
    }
    throw err;
  }

  // The debit is COMMITTED at this point. Everything below is best-effort and
  // must not be able to turn a successful operation into an error the Member
  // sees — they did their work, they paid for it, and whether their card could
  // be charged for the NEXT batch is not their problem right now.
  if (!impersonating) scheduleTopUp(memberId);
  return balance;
}

/**
 * Starts an auto top-up if this account is armed and has fallen to its
 * threshold — and swallows every way that can fail.
 *
 * Separate from `spendTokens` so the swallowing is visible rather than being a
 * bare `catch {}` inside the main path, and so the reason is written down once:
 *
 *  - **A failed charge must not fail the spend.** `autoReloadIfNeeded` throws
 *    when Digistore24 rejects the charge. Letting that through would report a
 *    failure for an operation that already succeeded and was already paid for.
 *    It releases its own lock on the way out, so there is nothing to clean up
 *    here.
 *  - **No API key is a normal state**, not an error. A local app that has never
 *    run `ds24-connect` would otherwise throw on every single spend.
 *
 * The credit is NOT applied here and must never be: `createBillingOnDemand`
 * charges, and the balance moves only once the IPN confirms the payment. Doing
 * it synchronously would credit a payment that later fails.
 */
/**
 * Runs the top-up AFTER the response has been sent.
 *
 * `next/server`'s `after()` is what keeps an outbound payment call out of the
 * Member's request. Awaiting it added up to the client's 10s timeout to a
 * request that had already succeeded — and slow responses are what make people
 * press the button again, against a debit this very file documents as not
 * idempotent.
 *
 * Falls back to a detached promise where there is no request context (a script,
 * a test), because `after()` throws outside one and a top-up must never be the
 * reason a spend fails.
 */
export function scheduleTopUp(memberId: string): void {
  try {
    after(() => topUpQuietly(memberId));
  } catch {
    void topUpQuietly(memberId);
  }
}

async function topUpQuietly(memberId: string): Promise<void> {
  // Asked BEFORE `ds24ApiKey()`, which throws by design when unset. Without
  // this an app that has never run `ds24-connect` would log an error on every
  // single spend — noise that trains people to ignore the log.
  if (!hasDigistoreApiKey()) return;
  try {
    await autoReloadIfNeeded({ memberId, apiKey: ds24ApiKey() });
  } catch (err) {
    // Visible in `node run.mjs logs`. An operator watching a Member sit at a
    // low balance needs this line to exist; the Member does not need to see it.
    console.error("[tokens] auto top-up failed:", err);
  }
}

// ── Why there is no `sellsTokens()` check here ──────────────────────────────
// `adjustTokens` refuses in a subscriptions-only app, and mirroring that here
// is the obvious next idea. It is wrong. `billingMode` is COSMETIC
// (lib/billing-mode.ts): it may hide an empty thing, never a non-empty one.
// `adjustTokens` is the single exception because it MINTS tokens out of
// nothing. A spend does the opposite — it consumes what somebody already paid
// for. Gating it would strand every customer holding a paid balance the moment
// a vendor flips a display switch, which is a refund request, not a layout
// change. `lib/billing-mode.test.ts` asserts this stays true.
