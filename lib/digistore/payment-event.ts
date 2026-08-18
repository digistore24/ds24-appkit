// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What happens when Digistore24 reports a payment event.
//
// The route (app/api/ipn/route.ts) does exactly two things before calling in
// here: it verifies the SHA512 signature and it answers the connection test.
// EVERYTHING in this file therefore runs on an ALREADY VERIFIED payload — do
// not move the signature check in here. It belongs at the edge, where it
// cannot be stubbed out by a test of the domain logic.
//
// The decision "whose payment is this?" is deliberately not made here either.
// It is a pure function in ./attribution.ts, because it governs money and has
// to be testable case by case; this file performs the lookups it needs and the
// writes that follow.
//
// Order of work:
//   1. resolve who the payment belongs to (reference first, email second)
//   2. write the order — idempotently, filling in attribution but never
//      overwriting it
//   3. credit a token package, if that is what was bought
//   4. otherwise keep the subscription mirror up to date
//   5. let the event act on the entitlement (lib/entitlements)
//
// Rule that outranks the rest: an attribution failure must never fail the
// order write. Recording that money changed hands is the more important job.
// That is why step 5 comes LAST and never before step 2.

import { db } from "@/db";
import { orders, subscriptions, users, invoices } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

import {
  mapEventToStatus,
  mapEventToSubscriptionStatus,
  type IpnParams,
} from "./ipn";
import { parseCustom, type CustomValue } from "./custom";
import { nextPaymentUpdate, type NextPaymentUpdate } from "./next-payment";
import {
  chooseAttribution,
  shouldArmAutoReload,
  shouldCreditTokens,
  type AttributionReason,
} from "./attribution";
import { getProduct, productByDs24Id, type ProductKind } from "./products";
import { chooseGrantTransition } from "@/lib/entitlements/rules";
import { applyGrantTransition, openPurchaseGrantByPurchase, purchaseGrant } from "@/lib/entitlements/manage";
import { getTokenPackage } from "@/lib/tokens/packages";
import {
  creditTokens,
  disarmAutoReload,
  getTokenAccount,
  setAutoReload,
} from "@/lib/tokens/account";
import { defaultReloadThreshold } from "@/lib/tokens/rules";
import { normalizeEmail } from "@/lib/users/rules";
import { invoiceRowFromIpn } from "./member-billing";

export async function onPaymentEvent(body: IpnParams): Promise<void> {
  // Every field read here is one Digistore24 really sends —
  // ./ipn-fields.test.ts holds that against a captured live message, so a
  // fallback onto a name nobody sends cannot creep back in. Four such names
  // used to sit in this file as `||` alternatives (`order_event`,
  // `ds24_order_id`, `ds24_product_id`, `billing_interval`); they were dead in
  // every app that has ever run, and dead alternatives are how the real defect
  // below hid in plain sight — the code LOOKED like it knew several spellings.
  const event = body["event"] || "";
  const status = mapEventToStatus(event);
  const orderId = body["order_id"];
  // The RAW address, exactly as Digistore24 sent it. Stored verbatim because
  // an order is a financial record of what the buyer actually entered; it is
  // normalised only for comparison (see below). Balances are no longer keyed
  // on it — that is `memberId` now — so do not "tidy" this into a lowercased
  // write.
  const buyerEmail = body["buyer_email"] || body["email"] || null;
  // 🚨 THE KEY EVERYTHING BELOW HANGS ON, and it is `order_id` — read here,
  // once, so that the payment, the refund, the chargeback and the end of the
  // paid period all arrive under the SAME identifier. A refund that keys
  // differently from the purchase closes nothing, and nothing goes red.
  //
  // It used to be `body["purchase_id"]`, and **Digistore24 does not send that
  // field**. It appears in no IPN parameter table Digistore24 publishes — not
  // in the current "Order Events" list, not in the IPN guide — and a captured
  // live `on_payment` carries 173 parameters without it (see
  // ./ipn-vectors.json → `captured-on-payment`, the message this line was
  // fixed against). Where Digistore24 DOES use the name it means this same
  // value: the API's `getPurchase` documents `purchase_id` as "the Digistore24
  // order id", which is why scripts/ds24/purchase-info.mjs passes an order id
  // to it.
  //
  // What that cost, measured in a real app before the fix: the order row was
  // written, the money was recorded, and `activateGrant` refused for want of a
  // key — a paid customer with no access, in EVERY app built from this
  // template, with a green test suite and a 200 on the webhook.
  //
  // ⚠️ Deliberately NOT `body["purchase_id"] || orderId`. A fallback is only
  // safe while the field is absent EVERYWHERE; the day it appears on the
  // payment and not on the refund, the two key differently again and this
  // exact defect is back. There is nothing to fall back to: the field does not
  // exist.
  //
  // The COLUMN is still called `ds24_purchase_id` (orders, grants,
  // subscriptions, token_accounts) — renaming it would be a migration in every
  // deployed app for no behavioural gain. What it holds is the order id.
  const purchaseId = orderId ?? null;

  // --- 1. Whose payment is this? --------------------------------------------
  const parsed = parseCustom(body["custom"]);

  const identified =
    parsed?.kind === "identity"
      ? await findMemberByIdentity(parsed.memberId, parsed.checkoutToken)
      : null;

  const { memberId, reason } = chooseAttribution({
    parsed,
    identifiedMemberId: identified,
    emailMatches: identified ? [] : await findMembersByEmail(buyerEmail),
  });

  logAttribution(reason, orderId, buyerEmail);

  // What was bought? The identity string names it outright; failing that, the
  // Digistore24 product id is matched against the registry. `null` means
  // UNKNOWN — never a guess.
  const product = resolveProduct(body, parsed);
  // The token-credit path, unchanged: only a token package has a balance.
  const packageKey = product?.kind === "token" ? product.key : null;
  // How it was initiated — read from the k: pair, never inferred locally. The
  // account-level reloadLockedAt says "A reload was in flight", not "THIS
  // credit is that reload", so it mislabels a manual purchase that lands while
  // an auto charge is outstanding.
  const origin = parsed?.kind === "identity" ? parsed.origin : undefined;

  // --- 2. The order ---------------------------------------------------------
  if (status && orderId) {
    const gdpr = body["is_gdpr_country"];
    await db
      .insert(orders)
      .values({
        memberId,
        ds24OrderId: orderId,
        ds24ProductId: body["product_id"] || null,
        ds24PurchaseId: purchaseId,
        // Recorded now, never reconstructed later: the credits change when the
        // operator edits the registry, and a reverse lookup is only safe while
        // the payload is in hand (resolveProduct).
        //
        // EVERY kind, not just token packages. A subscription order whose
        // product key was never recorded can never become a grant at claim
        // time — nothing says WHAT was bought — and it shows the Operator a
        // blank column in exactly the list they use to identify strays.
        productKey: product?.key ?? null,
        credits: packageKey ? (safeTokenPackage(packageKey)?.credits ?? null) : null,
        status,
        buyerEmail,
        buyerFirstName:
          body["buyer_first_name"] || body["address_first_name"] || null,
        buyerLastName:
          body["buyer_last_name"] || body["address_last_name"] || null,
        amount: body["amount"] || null,
        currency: body["currency"] || null,
        isGdprCountry: gdpr === "Y" ? true : gdpr === "N" ? false : null,
        // DS24-hosted management links, shown to the member on /dashboard/billing.
        rebillingStopUrl: body["rebilling_stop_url"] || null,
        renewUrl: body["renew_url"] || null,
      })
      .onConflictDoUpdate({
        target: orders.ds24OrderId,
        set: {
          // Money moves in ONE direction. `on_rebill_resumed` maps to "paid"
          // (ipn.ts) and is a support click with no transaction behind it, so
          // an unconditional write lets a support restart — or a redelivered
          // on_payment — flip a refunded order back to paid. That re-arms
          // claim.ts (it selects on status='paid') and, in the entitlement
          // layer, hands back access with no payment behind it.
          // The cast is load-bearing: without it the parameter binds as text
          // against an order_status column and Postgres refuses the whole
          // upsert — no order row, and therefore no credit either.
          status: sql`case when ${orders.status} in ('refunded','chargeback')
                           then ${orders.status}
                           else ${status}::order_status end`,
          updatedAt: new Date(),
          // Fill only. `orders.memberId` is the row that already exists,
          // `excluded.member_id` the one just offered — so an attribution the
          // first delivery could not make still lands on a later one, and one
          // it DID make is never overwritten and never cleared. Clearing it
          // would revoke access in the entitlement layer on, say, a refund
          // whose identity no longer resolves because the token was rotated.
          memberId: sql`coalesce(${orders.memberId}, excluded.member_id)`,
          // The same fill-only rule, for the same reason. These three were
          // INSERT-ONLY: if the first delivery could not resolve the product
          // (operator mid-edit, key renamed, IPN landing during ds24-sync),
          // the row kept product_key=NULL and credits=NULL forever — and
          // claim.ts skips exactly those rows, so the purchase became
          // uncreditable by every path, including the Operator's manual
          // attach. Money taken, permanently unbookable.
          productKey: sql`coalesce(${orders.productKey}, excluded.product_key)`,
          credits: sql`coalesce(${orders.credits}, excluded.credits)`,
          ds24PurchaseId: sql`coalesce(${orders.ds24PurchaseId}, excluded.ds24_purchase_id)`,
          // Newest-wins-if-present: a later IPN may carry a refreshed link (a
          // renew token rotates), but an event without one must not blank it.
          rebillingStopUrl: sql`coalesce(excluded.rebilling_stop_url, ${orders.rebillingStopUrl})`,
          renewUrl: sql`coalesce(excluded.renew_url, ${orders.renewUrl})`,
        },
      });
  }

  // --- 2b. The invoice ------------------------------------------------------
  // Digistore24 issues one invoice per PAYMENT (a subscription bills many
  // times), so each is stored on its own — the member downloads them all on
  // /dashboard/billing. Idempotent by transaction id; a retried IPN, or a
  // non-payment event that carries no invoice_url, adds nothing. Runs on the
  // same fail-loud path as the rest: a transient failure throws → DS24 retries,
  // and the onConflictDoNothing makes the retry harmless.
  const invoiceRow = status === "paid" ? invoiceRowFromIpn(body) : null;
  if (invoiceRow) {
    await db
      .insert(invoices)
      .values(invoiceRow)
      .onConflictDoNothing({ target: invoices.ds24TransactionId });
  }

  // --- 3. Token purchase → credit the balance (idempotent by order id) ------
  // Runs on EVERY delivery, not only the one that inserted the order: the
  // ledger's unique (accountId, ds24OrderId) is what prevents a double credit,
  // and a credit the first delivery could not place must still be placeable.
  // Resolved ONCE, so the credit branch and the warning below cannot disagree
  // about whether this package is bookable.
  const pkg = packageKey ? safeTokenPackage(packageKey) : null;
  const creditable = Boolean(pkg && pkg.credits > 0);

  // --- 2c. Money went BACK → stop charging that card -------------------------
  // A refund or a chargeback reverses the very payment whose stored details the
  // auto top-up charges against. Continuing to bill it is the worst thing this
  // feature can do, and until now nothing in the app stopped it: the only
  // writer of `autoReloadEnabled: false` was the Member's own switch.
  //
  // Scoped to the purchase that IS the mandate (`onlyForPurchaseId`), so
  // reversing an unrelated older order leaves a valid arrangement alone. The
  // mandate is cleared as well — a reversed purchase must not be re-armable.
  if ((status === "refunded" || status === "chargeback") && memberId && purchaseId) {
    try {
      const disarmed = await disarmAutoReload({
        memberId,
        onlyForPurchaseId: purchaseId,
        clearMandate: true,
      });
      if (disarmed) {
        console.warn(
          `[ipn] auto top-up disarmed for member ${memberId}: purchase ${purchaseId} was ${status}`,
        );
      }
    } catch (err) {
      // Never fail the event over this. The order write and the grant
      // transition matter more, and DS24 retries the whole delivery.
      console.error("[ipn] could not disarm auto top-up:", err);
    }
  }

  // ⚠️ `memberId &&` and `pkg &&` are in the condition so the compiler can SEE
  // what the eight `!` assertions used to assert. `shouldCreditTokens()` and
  // `creditable` already required both — a pure predicate and a boolean const
  // are simply things TypeScript cannot narrow through, so the knowledge lived
  // in `!` and in the reader's head. Same branch, same order of evaluation, no
  // behavioural change: both are pure, and the truthiness checks are exactly
  // the ones the predicate makes.
  if (memberId && pkg && creditable && shouldCreditTokens({ packageKey, status, orderId, memberId })) {
    // The lock as it stands BEFORE the credit — the one an outstanding auto
    // charge set. See `releaseLockedAt` below.
    const lockedAtBeforeCredit =
      origin === "auto" && reason === "identity"
        ? ((await getTokenAccount(memberId))?.reloadLockedAt ?? null)
        : undefined;
    const credit = await creditTokens({
      memberId,
      credits: pkg.credits,
      ds24OrderId: orderId,
      note: `Kauf ${pkg.title} (${pkg.credits} Token)`,
      origin: origin ?? null,
      // Release the reload lock ONLY when this credit answers an auto
      // top-up. A manual purchase landing while an auto charge is
      // outstanding must not clear that charge's lock — doing so lets the
      // next consumption fire a second on-demand charge.
      // ...and only when the identity RESOLVED. `origin` is read from the
      // parsed custom string, so it survives an identity that failed to
      // resolve (token rotated, member deleted) and the purchase then falls
      // back to a unique buyer-email match — a DIFFERENT Member. Clearing
      // their lock lets their next consumption fire a second card charge.
      releaseReloadLock: origin === "auto" && reason === "identity",
      // WHICH lock this credit may clear. Without it a late IPN clears whatever
      // lock it finds — including a successor's, after its own went stale and
      // was taken over — and the next spend fires a third charge. Read outside
      // the credit's transaction, which is fine: a mismatch fails closed by
      // leaving the lock in place, and the 6h stale timeout is the backstop.
      releaseLockedAt: lockedAtBeforeCredit,
      linkPurchaseId: purchaseId ?? undefined,
    });

    // --- 3b. The buyer asked for auto top-up while buying (story 5.3) --------
    // Armed HERE and nowhere earlier, because this is the first moment the
    // mandate exists: `purchase_id` comes into being when Digistore24 confirms
    // the payment, so at checkout time there was nothing to charge against.
    //
    // Three conditions, and each one is load-bearing:
    //
    //  • `armAutoReload` — they ticked the box. A purchase made before this
    //    shipped, or an anonymous one claimed later, carries no `r:` pair and
    //    must never be armed: nobody offered those buyers the choice.
    //  • `reason === "identity"` — the SAME guard the lock release above uses,
    //    for the same reason. When the identity does not resolve (token
    //    rotated, member deleted) the purchase falls back to a unique
    //    buyer-email match, which may be a DIFFERENT Member. Arming them would
    //    point an unattended card charge at somebody who never asked for one.
    //  • `purchaseId` — there is no mandate without it, and `setAutoReload`
    //    would otherwise store null and answer "not-configured" for ever.
    //
    // Not fatal on failure: the credit already happened and the money is the
    // customer's. Throwing here would make Digistore24 retry an event whose
    // financial half is complete, and the retry would credit nothing (the
    // ledger is idempotent) while still failing on this line.
    if (
      // `purchaseId &&` for the same reason: the predicate below already
      // requires it (there is no mandate without one), and saying so here is
      // what lets `ds24PurchaseId` be a string instead of an assertion.
      purchaseId &&
      shouldArmAutoReload({
        armAutoReload: parsed?.kind === "identity" && parsed.armAutoReload,
        reason,
        purchaseId,
        isTokenPackage: Boolean(packageKey),
        // Only on the delivery that actually booked. A redelivery must not
        // re-arm what the Member has since turned off.
        creditWasBooked: credit.credited,
      })
    ) {
      try {
        await setAutoReload({
          memberId,
          enabled: true,
          threshold: defaultReloadThreshold(pkg.credits),
          packageKey: pkg.key,
          ds24PurchaseId: purchaseId,
        });
      } catch (err) {
        console.error("[ipn] could not arm auto top-up:", err);
      }
    }
  } else if (status === "paid" && orderId && (packageKey || parsed?.kind === "legacyToken")) {
    // Money was taken and NOT credited. Strictly louder than "unattributed":
    // Digistore24 does not redeliver an event it already got a 200 for, so
    // unless a later event happens to arrive there is no second chance before
    // the purchase is claimed.
    //
    // This branch used to be unreachable for the WORST case. The credit was
    // nested as `if (shouldCredit) { if (pkg) {...} }`, so a package that
    // could not be resolved — left the registry, or carries no usable credits
    // figure — took the outer branch, did nothing, and skipped the warning
    // entirely. Silent, and the order row carries credits=NULL, so the claim
    // path skips it forever too.
    console.warn(
      `[ipn] order ${orderId} paid for "${packageKey ?? "?"}" but NOT credited — ` +
        `member=${memberId ?? "none"} package=${pkg ? `credits=${pkg.credits}` : "unresolvable"}`,
    );
  }

  // --- 4. Subscription mirror ------------------------------------------------
  // Real subscriptions only. A token package is a one-off booking — writing it
  // here would show it to the customer as a running subscription with cancel
  // and invoice links.
  //
  // Gated on the resolved KIND, not on "anything that is not a token package".
  // `!packageKey` was true for three different things: a real subscription, a
  // one-time purchase, and a TOKEN purchase whose key had left the registry —
  // so the last two were shown to the customer as running subscriptions with
  // cancel and invoice links, and `rebilling_stop_url` is empty for a
  // non-rebilling purchase, so the cancel link pointed nowhere.
  //
  // Story 2.5 rides along here: the next-payment date is a column of this
  // mirror, so it is written by the same upsert — with ONE exception below.
  const subStatus = mapEventToSubscriptionStatus(event);
  const nextPayment = nextPaymentUpdate(event, body["next_payment_at"]);
  if (product?.kind === "subscription" && subStatus && purchaseId) {
    await upsertSubscription(
      purchaseId,
      subStatus,
      orderId,
      buyerEmail,
      memberId,
      body,
      nextPayment,
    );
  } else if (nextPayment.kind === "clear" && purchaseId) {
    // The exception, and it is the case §D3 is about. `on_refund` and
    // `on_chargeback` have NO subscription status (mapEventToSubscriptionStatus
    // returns null for both), so the upsert above never runs for them — and a
    // refund typically arrives with no `custom` at all, so `product` does not
    // resolve either. Without this the mirror would keep advertising a next
    // charge to a customer whose money has just been given back.
    //
    // Deliberately an UPDATE, never an insert: this must not conjure a
    // subscription row for a purchase that never had one. A token purchase or
    // an unknown product simply matches nothing.
    await db
      .update(subscriptions)
      .set({ nextPaymentAt: null, updatedAt: new Date() })
      .where(eq(subscriptions.ds24PurchaseId, purchaseId));
  }

  // --- 5. Entitlement --------------------------------------------------------
  // LAST, and deliberately so: an entitlement failure must never fail the
  // order write (see the header). By here the money is recorded whatever
  // happens next.
  //
  // The decision is NOT an `if` here. It is the pure function in
  // lib/entitlements/rules.ts, which branches on the RAW event name — never on
  // `status` or `subStatus`, which collapse events that mean opposite things
  // to access (AD-2). Stories 2.2–2.4 add cases there, not here.
  //
  // The existing grant is LOADED first, because two of the rules are about the
  // state it is already in: `endedAt` is terminal (a refund must survive a
  // redelivered on_payment), and 2.3/2.4 will branch on `suspendedAt`. Without
  // the lookup the guard in rules.ts would be handed `null` forever and could
  // never fire — a rule nothing can reach.
  const existing =
    product && purchaseId ? await purchaseGrant(purchaseId, product.key) : null;

  // Whose grant is being acted on. `memberId` — this payload's attribution —
  // comes first; the grant's own owner is the fallback.
  //
  // That fallback is not a second attribution path and it never writes
  // `orders.member_id`: it only lets an ENDING event act on a grant whose
  // payload no longer identifies anybody. A refund arrives without `custom`
  // (or with a checkout token that has since been rotated, or for a purchase
  // the Operator attached by hand to an address the buyer never used), and
  // without this the refund would decide `noMember` and the refunded customer
  // would keep access. It cannot create anything either: `activate` on a
  // purchase that already has a grant hits the conflict and does nothing.
  const owner = memberId ?? existing?.memberId ?? null;

  const transition = chooseGrantTransition({
    event,
    productKind: product?.kind ?? null,
    memberId: owner,
    grant: existing
      ? { suspendedAt: existing.suspendedAt, endedAt: existing.endedAt }
      : null,
    // Story 2.4 §D1. Digistore24 sends `on_payment_missed` after EVERY
    // cancellation as well as after a failed charge, and this field — present
    // "only if a rebilling has stopped" — is the ONLY thing on the payload
    // that tells the two apart. Passed RAW, like the event name, because no
    // mapper in this codebase carries the distinction.
  });
  if (owner && product) {
    await applyGrantTransition(transition, {
      memberId: owner,
      productKey: product.key,
      ds24PurchaseId: purchaseId,
    });
    return;
  }

  // The product did not resolve — stale `custom`, and a DS24 product id that is
  // unsynced, absent, or ambiguous. The gate above then skips the transition
  // entirely, INCLUDING `endGrant`'s own "closed nothing" warning, so nothing
  // ends and nothing is logged.
  //
  // That is survivable while granting (an unknown product must grant nothing).
  // It is not survivable while ENDING: `last_paid_day` is the normal
  // end-of-life of every subscription, and a grant that misses it never ends at
  // all — `accessUntil` is NULL by AD-2, Digistore24 does not redeliver an
  // acknowledged event, and AD-8 rules out a reconciliation job.
  //
  // So fall back to the grant row itself, which names its own owner and its own
  // Product Key. ENDING ONLY — this path never creates, never resumes and never
  // guesses a kind.
  if (!product && purchaseId) {
    const orphan = await openPurchaseGrantByPurchase(purchaseId);
    if (!orphan) return;
    const byRow = chooseGrantTransition({
      event,
      productKind: "subscription",
      memberId: orphan.memberId,
      grant: { suspendedAt: orphan.suspendedAt, endedAt: orphan.endedAt },
    });
    // ENDING and RESUMING, never suspending.
    //
    // The row names its own owner and its own Product Key, so acting on it is
    // safe for any transition that GIVES or CLOSES. `suspend` is the one
    // direction that is dropped: taking access away on a key the payload never
    // named is the dangerous guess, and the missed payment simply goes
    // unrecorded until an event that does resolve arrives.
    //
    // `resume` must NOT be dropped, and the earlier comment claiming "access is
    // wrongly kept, never wrongly taken" was inverted for exactly this case:
    // `openPurchaseGrantByPurchase` filters on `ended_at IS NULL` only, so it
    // returns SUSPENDED grants too. A customer whose card failed while the
    // product still resolved, and who then fixes it after a registry edit,
    // would keep the suspension forever — no redelivery, no job, no log.
    if (byRow.kind !== "end" && byRow.kind !== "resume") return;
    console.warn(
      `[entitlements] purchase ${purchaseId} ${byRow.kind === "end" ? "ended" : "resumed"} on "${event}" via its grant row — the product no longer resolves from the payload`,
    );
    await applyGrantTransition(byRow, {
      memberId: orphan.memberId,
      productKey: orphan.productKey,
      ds24PurchaseId: purchaseId,
    });
  }
}

/**
 * The Member named by an identity string — only when BOTH the id and the
 * checkout token agree. Half an identity is not a weaker identity; it is none,
 * and the payment falls through to the buyer-email path.
 */
async function findMemberByIdentity(
  memberId: string,
  checkoutToken: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.checkoutToken, checkoutToken)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Members whose address equals the buyer's — capped at two.
 *
 * Two, not one, on purpose: "exactly one" then becomes a property of this code
 * rather than only of the unique index, and survives a mixed-case row written
 * by an OAuth provider.
 *
 * Compared against the NORMALISED address, so the index is used. A
 * `lower(email) = …` variant could not use it and would sequentially scan the
 * user table on every payment event.
 *
 * Deliberately unfiltered by role or block: the operator buys too (test
 * purchases are made by the vendor), and a block governs sign-in, not who owns
 * a payment.
 *
 * A failing query must THROW, not return empty — Digistore24 then redelivers.
 * Swallowing it here would turn a momentary database blip into a permanently
 * orphaned payment.
 */
async function findMembersByEmail(rawEmail: string | null): Promise<string[]> {
  const email = normalizeEmail(rawEmail);
  if (!email) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(2);
  return rows.map((r) => r.id);
}

/**
 * WHAT was bought — for every purchase, not just token packages.
 *
 * Two sources, in order of trust:
 *
 *   1. the identity string's `p:` pair (or the legacy `tokens:` marker) — it
 *      names what the buyer actually clicked, written by this app;
 *   2. the Digistore24 product id on the payload, matched against the
 *      registry (productByDs24Id, which carries the guard).
 *
 * Step 2 is what makes an ANONYMOUS purchase — one carrying no `custom` at all
 * — record its Product Key. Without it `orders.productKey` is NULL for every
 * anonymous purchase and for every purchase whose `custom` was missing or
 * malformed, and such an order can never become a grant when it is claimed:
 * nothing says what was bought. `ds24ProductId` was already being written one
 * line away from it; the information was in the row and simply never resolved.
 *
 * `null` means UNKNOWN — a product sold outside this registry, or one not yet
 * synced. The order still keeps its `ds24ProductId`, so it stays recoverable
 * by hand (Story 1.7) once `node run.mjs ds24-sync` has run. NEVER invent a key: for
 * an entitlement a guessed key means granting the wrong plan.
 */
function resolveProduct(
  body: IpnParams,
  parsed: CustomValue | null,
): { key: string; kind: ProductKind } | null {
  const named =
    parsed?.kind === "identity"
      ? parsed.productKey
      : parsed?.kind === "legacyToken"
        ? parsed.productKey
        : undefined;
  if (named) {
    const def = safeProduct(named);
    if (def) return { key: def.key, kind: def.kind };
  }

  const byId = productByDs24Id(body["product_id"]);
  return byId ? { key: byId.key, kind: byId.kind } : null;
}

/**
 * A product key that is no longer in the registry must not take the endpoint
 * down. Intents and Digistore24 purchases outlive edits to
 * config/digistore-products.json; an uncaught throw here would 500 the webhook
 * and Digistore24 would redeliver it forever.
 */
function safeProduct(key: string) {
  try {
    return getProduct(key);
  } catch {
    console.warn(`[ipn] product "${key}" is no longer in the registry`);
    return null;
  }
}

function safeTokenPackage(key: string) {
  try {
    return getTokenPackage(key);
  } catch {
    console.warn(`[ipn] token package "${key}" is no longer in the registry`);
    return null;
  }
}

function logAttribution(
  reason: AttributionReason,
  orderId: string | undefined,
  buyerEmail: string | null,
) {
  if (reason === "identity" || reason === "email") return;
  // An unresolved reference is more alarming than an anonymous purchase: it
  // means an intent was deleted, or the payload came from elsewhere.
  console.warn(
    `[ipn] order ${orderId ?? "?"} unattributed (${reason}) — buyer ${buyerEmail ?? "unknown"}`,
  );
}

/** Creates a subscription or updates status, interval and management links. */
async function upsertSubscription(
  purchaseId: string,
  status: "active" | "paused" | "cancelled",
  orderId: string | undefined,
  buyerEmail: string | null,
  memberId: string | null,
  body: IpnParams,
  nextPayment: NextPaymentUpdate,
): Promise<void> {
  const now = new Date();
  const billingInterval =
    body["other_billing_intervals"] || null;
  const managementUrls = {
    renewUrl: body["renew_url"] || null,
    rebillingStopUrl: body["rebilling_stop_url"] || null,
    invoiceUrl: body["invoice_url"] || body["receipt_url"] || null,
    supportUrl: body["support_url"] || null,
  };
  await db
    .insert(subscriptions)
    .values({
      ds24PurchaseId: purchaseId,
      ds24OrderId: orderId ?? null,
      ds24ProductId: body["product_id"] || null,
      memberId,
      buyerEmail,
      status,
      billingInterval,
      amount: body["amount"] || null,
      currency: body["currency"] || null,
      // On INSERT `keep` and `clear` mean the same thing: there is nothing to
      // keep and nothing to clear, so the row starts without a date.
      nextPaymentAt: nextPayment.kind === "set" ? nextPayment.date : null,
      ...managementUrls,
    })
    .onConflictDoUpdate({
      target: subscriptions.ds24PurchaseId,
      set: {
        status,
        billingInterval,
        // §D3, and the ONE field of this mirror that is deliberately NOT
        // fill-only. `clear` writes NULL over a date that is already there —
        // after a cancellation the stored day names a charge that will never be
        // taken, and showing that to the customer who just cancelled is worse
        // than showing nothing. `keep` is the ordinary case: a rebill that does
        // not carry the field must not wipe a day an earlier delivery did.
        ...(nextPayment.kind === "set"
          ? { nextPaymentAt: nextPayment.date }
          : nextPayment.kind === "clear"
            ? { nextPaymentAt: null }
            : {}),
        // Fill only — the same idiom as orders.memberId above, and for the
        // same reason. A later event that fails to attribute (a rotated
        // checkout token, a rebill without `custom`) must not clear an
        // attribution an earlier one made.
        memberId: sql`coalesce(${subscriptions.memberId}, excluded.member_id)`,
        // Do not write empty values over links that are already set.
        ...(managementUrls.renewUrl ? { renewUrl: managementUrls.renewUrl } : {}),
        ...(managementUrls.rebillingStopUrl
          ? { rebillingStopUrl: managementUrls.rebillingStopUrl }
          : {}),
        ...(managementUrls.invoiceUrl
          ? { invoiceUrl: managementUrls.invoiceUrl }
          : {}),
        ...(managementUrls.supportUrl
          ? { supportUrl: managementUrls.supportUrl }
          : {}),
        updatedAt: now,
      },
    });
}
