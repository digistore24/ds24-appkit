// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// Presentation for one Member's billing state. The page (page.tsx) does the
// reading and hands finished rows down; the one thing that WRITES is the
// balance correction below, and it writes through the server action in
// ./actions.ts — following app/dashboard/admin/users/ui.tsx as the blueprint.

import * as React from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Ban, CircleCheck, CirclePause, CircleSlash, Clock, Coins, KeyRound, Pencil } from "lucide-react";

import type { GrantState } from "@/lib/entitlements/rules";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/hooks/use-action-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adjustTokensAction,
  grantPlanAction,
  revokeGrantAction,
  type ActionState,
} from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";


/** One booking. Mirrors LedgerRow in lib/tokens/account.ts. */
export interface LedgerRow {
  id: string;
  type: "topup" | "consume" | "refund" | "adjust";
  /** Signed: + for topup/refund/upward adjust, − for consume. */
  amount: number;
  balanceAfter: number;
  note: string | null;
  origin: string | null;
  createdAt: Date;
}

/** One grant, with the state page.tsx derived for it. */
export interface GrantRow {
  id: string;
  productKey: string;
  source: "purchase" | "manual";
  note: string | null;
  accessUntil: Date | null;
  /** WHEN it was closed — AC 3 of story 3.4. Null while the grant is open. */
  endedAt: Date | null;
  endedReason: string | null;
  createdAt: Date;
  state: GrantState;
}

/**
 * All four ledger kinds get a label — including `refund`, which nothing writes
 * today. Rendering only the three that occur would show the first one ever
 * written as a blank cell, and by then nobody remembers why.
 */
const KIND_LABEL: Record<LedgerRow["type"], string> = {
  topup: "kindTopup",
  consume: "kindConsume",
  refund: "kindRefund",
  adjust: "kindAdjust",
};

/**
 * The four states of §D5, each with its own badge AND its own icon: colour
 * alone does not distinguish them for everybody, and "why did my access stop"
 * is answered by which of the three non-active ones this is.
 */
const STATE_STYLE: Record<
  GrantState,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof CircleCheck }
> = {
  active: { label: "stateActive", variant: "default", icon: CircleCheck },
  suspended: { label: "stateSuspended", variant: "secondary", icon: CirclePause },
  expired: { label: "stateExpired", variant: "outline", icon: Clock },
  ended: { label: "stateEnded", variant: "destructive", icon: Ban },
};

/**
 * `grants.endedReason` is plain text, deliberately (schema-entitlements.ts):
 * every new reason would otherwise need a migration of an enum. So the known
 * ones are translated and anything else falls through to the stored value —
 * an unknown reason must still be readable, never blank.
 */
const REASON_LABEL: Record<string, string> = {
  refund: "reasonRefund",
  chargeback: "reasonChargeback",
  lastPaidDay: "reasonLastPaidDay",
  revoked: "reasonRevoked",
};

/**
 * The Operator corrects the balance by hand (story 3.2).
 *
 * A REAL `<form action={…}>`, not a button wired to a transition: that keeps
 * the correction working without JavaScript, and it is the same submission the
 * browser makes either way.
 *
 * The confirmation is an interception, not a second form. `onSubmit` stops the
 * first submit and opens the AlertDialog, which names the Member and the
 * amount; confirming re-submits through `requestSubmit()` with the ref set, and
 * the second pass falls through. HTML validation therefore runs BEFORE the
 * confirmation appears — the Operator is not asked to confirm an empty field.
 *
 * None of the validation here is the refusal. `required` and `type="number"`
 * are convenience; the binding checks are in lib/tokens/rules.ts, on the server.
 */
function AdjustBalance({
  memberId,
  memberLabel,
}: {
  memberId: string;
  /** What the confirmation calls this Member — their email, or their id. */
  memberLabel: string;
}) {
  const t = useTranslations("memberBilling");
  const tCommon = useTranslations("common");
  const [state, formAction, isPending] = useActionState(
    adjustTokensAction,
    EMPTY_ACTION_STATE,
  );
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  useActionToast(state);

  // The confirmation closes only once the server has confirmed. On a refusal it
  // stays up with the input intact — the toast says why, and the Operator can
  // correct the amount instead of typing everything again.
  useEffect(() => {
    if (state.ok) {
      setConfirming(false);
      setAmount("");
      setReason("");
    }
  }, [state]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (confirmed.current) {
      confirmed.current = false;
      return; // second pass — let the server action run
    }
    event.preventDefault();
    setConfirming(true);
  }

  const parsed = Number(amount);
  const signedAmount =
    Number.isFinite(parsed) && parsed > 0 ? `+${amount}` : amount;

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="memberId" value={memberId} />
        <div className="grid gap-2 sm:w-40">
          <Label htmlFor="adjust-amount">{t("adjustAmount")}</Label>
          <Input
            id="adjust-amount"
            name="amount"
            type="number"
            step="1"
            required
            inputMode="numeric"
            placeholder={t("adjustAmountPlaceholder")}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="grid flex-1 gap-2">
          <Label htmlFor="adjust-reason">{t("adjustReason")}</Label>
          <Input
            id="adjust-reason"
            name="reason"
            required
            placeholder={t("adjustReasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isPending}>
          <Pencil aria-hidden />
          {isPending ? tCommon("loading") : t("adjustSubmit")}
        </Button>
      </form>
      <p className="text-muted-foreground text-sm">{t("adjustHint")}</p>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* Names the Member AND the amount: an Operator with several tabs
                open has no other way to tell whose balance is about to move. */}
            <AlertDialogTitle>
              {t("adjustConfirmTitle", {
                amount: signedAmount,
                email: memberLabel,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adjustConfirmBody", { reason })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              // Red: this moves customer money, and taking tokens away cannot
              // be undone except by another correction.
              variant="destructive"
              disabled={isPending}
              onClick={(event) => {
                // Do not close automatically — the confirmation disappears only
                // once the server has confirmed (see the useEffect above).
                event.preventDefault();
                confirmed.current = true;
                formRef.current?.requestSubmit();
                // `requestSubmit` dispatches the submit event synchronously, so
                // by here handleSubmit has run. Clearing the flag anyway means
                // a submission the browser refused (constraint validation)
                // cannot leave the NEXT correction un-confirmed.
                confirmed.current = false;
              }}
            >
              {isPending ? tCommon("loading") : t("adjustConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** One plan the Operator may hand out. Product names are NOT translated —
 *  that is the seller's own product copy, and Digistore24 holds the same text. */
export interface GrantableProduct {
  key: string;
  name: string;
}

/**
 * The Operator hands out a plan (story 3.3).
 *
 * ⛔ This form gives away paid-for access without a payment. None of the
 * validation here is the refusal: `required` on the reason and the picker's
 * contents are convenience. The binding checks are `canGrantByHand`
 * (lib/entitlements/grant-rules.ts), on the server — a server action is an HTTP
 * endpoint of its own and can be called without this form ever rendering.
 *
 * The picker is fed from `grantableProducts()` on the SERVER (page.tsx), so a
 * token package cannot even be offered — but the rule that says so is asserted
 * by grant-rules.test.ts, not by the fact that this list happens to be short.
 *
 * A REAL `<form action={…}>`, like the balance correction above.
 */
function GrantPlan({
  memberId,
  products,
}: {
  memberId: string;
  products: GrantableProduct[];
}) {
  const t = useTranslations("memberBilling");
  const tCommon = useTranslations("common");
  const [state, formAction, isPending] = useActionState(grantPlanAction, EMPTY_ACTION_STATE);
  const [productKey, setProductKey] = useState(products[0]?.key ?? "");
  const [reason, setReason] = useState("");
  const [day, setDay] = useState("");

  useActionToast(state);

  // Cleared only once the server has confirmed. On a refusal the input stays —
  // the toast says why, and the Operator corrects one field instead of all of
  // them.
  useEffect(() => {
    if (state.ok) {
      setReason("");
      setDay("");
    }
  }, [state]);

  // Nothing to grant: a registry that declares only token packages. Saying so
  // beats a picker with no options and a form that refuses every submission.
  if (products.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("grantNoProducts")}</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{t("grantTitle")}</h3>
        <p className="text-muted-foreground text-sm">{t("grantHint")}</p>
      </div>
      <form
        action={formAction}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="memberId" value={memberId} />
        <div className="grid gap-2 sm:w-56">
          <Label htmlFor="grant-product">{t("grantProduct")}</Label>
          <Select
            name="productKey"
            value={productKey}
            onValueChange={setProductKey}
          >
            <SelectTrigger id="grant-product" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.key} value={product.key}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid flex-1 gap-2">
          <Label htmlFor="grant-reason">{t("grantReason")}</Label>
          <Input
            id="grant-reason"
            name="reason"
            required
            placeholder={t("grantReasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:w-48">
          {/* "through and including", in words. The whole point of §D2: an
              Operator picking 1 August gets access to the END of the 1st, and
              the label has to say so or the off-by-one lives on in their head
              instead of in the data. */}
          <Label htmlFor="grant-until">{t("grantUntil")}</Label>
          <Input
            id="grant-until"
            name="accessUntilDay"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isPending}>
          <KeyRound aria-hidden />
          {isPending ? tCommon("loading") : t("grantSubmit")}
        </Button>
      </form>
      {/* The hazard §D4 names: a manual grant for a key the registry later
          drops makes `hasPlan` throw for that Member. Removing a product is a
          migration from then on, not an edit. */}
      <p className="text-muted-foreground text-sm">{t("grantKeyHint")}</p>
    </div>
  );
}

/**
 * The confirmation, and the submission, for revoking a manual grant (3.4).
 *
 * ⛔ IRREVERSIBLE. `endedAt` is terminal — there is no un-revoke, and the copy
 * says so (§D5): an Operator who believes revoke is reversible will use it to
 * "test". The remedy for a mistake is a NEW grant, which is why two identical
 * manual grants are deliberately legal.
 *
 * Controlled from outside (`target` = the grant to revoke, `null` = closed), so
 * the table has ONE dialog and ONE form rather than one per row — the same
 * shape as `EditEmailDialog` on the user list.
 *
 * THE FORM IS ALWAYS RENDERED, hidden, and that is deliberate rather than
 * tidy. `<form action={serverAction}>` emits its progressive-enhancement fields
 * into the server HTML; a form living inside `<AlertDialogContent>` would only
 * exist once the dialog is open (Radix portals its content), so the revocation
 * would depend on JavaScript and could not be driven the way a browser drives
 * it. Confirming calls `requestSubmit()` on it.
 *
 * None of this is the refusal. Which rows offer the button is convenience; the
 * binding checks are `canRevokeGrant` and the `source = 'manual' AND
 * ended_at IS NULL` on the UPDATE — a server action is an HTTP endpoint of its
 * own and the grant id travels from the client.
 */
function RevokeGrant({
  memberLabel,
  target,
  onClose,
}: {
  /** What the confirmation calls this Member — their email, or their id. */
  memberLabel: string;
  target: GrantRow | null;
  onClose: () => void;
}) {
  const t = useTranslations("memberBilling");
  const tCommon = useTranslations("common");
  const [state, formAction, isPending] = useActionState(
    revokeGrantAction,
    EMPTY_ACTION_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useActionToast(state);

  // Closes only once the server has confirmed. On a refusal — a purchase row
  // submitted anyway, a grant somebody else just revoked — it stays up and the
  // toast says why.
  useEffect(() => {
    if (state.ok) onClose();
    // `onClose` deliberately left out: it is recreated on every render of the
    // table and would otherwise fire the effect on results that have not
    // changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="grantId" value={target?.id ?? ""} />
      </form>

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => !open && onClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* AC 5 — names the Member AND the plan. An Operator with several
                support tabs open has no other way to tell whose access is
                about to end. */}
            <AlertDialogTitle>
              {t("revokeConfirmTitle", {
                product: target?.productKey ?? "",
                email: memberLabel,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              // Red: this takes access away and there is no way back.
              variant="destructive"
              disabled={isPending}
              onClick={(event) => {
                // Do not close automatically — the confirmation disappears
                // only once the server has confirmed (see the effect above).
                event.preventDefault();
                formRef.current?.requestSubmit();
              }}
            >
              {isPending ? tCommon("loading") : t("revokeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function MemberBilling({
  memberId,
  memberLabel,
  balance,
  hasAccount,
  pausedReloadCharges,
  showTokens,
  canAdjust,
  ledger,
  ledgerLimit,
  ledgerTruncated,
  grants,
  grantableProducts,
}: {
  memberId: string;
  memberLabel: string;
  balance: number;
  /** false = the Member never bought tokens, so there is no account row at
   *  all. Different from a balance of 0, and the Operator should see which. */
  hasAccount: boolean;
  /**
   * How many charges went out unanswered — **`null` unless auto top-up has
   * actually stopped charging.** The threshold lives in `reloadIsPaused()` on
   * the server (see page.tsx); one unconfirmed charge is the normal in-flight
   * state and must not raise anything here.
   *
   * When it is a number, this page is the only screen that says WHOSE account
   * it happened to: `check-stuck-reloads` reports a bare count and
   * `node run.mjs logs` a member id, neither of which an Operator reads with a
   * customer on the phone.
   */
  pausedReloadCharges: number | null;
  /** Show the balance and the ledger at all — false only in an app that sells
   *  no tokens AND for a Member who holds none. Resolved on the server from
   *  `billingMode`; see page.tsx. */
  showTokens: boolean;
  /** May a correction be booked? Follows the mode ALONE, because a correction
   *  mints tokens. The action re-checks it — this only removes the form. */
  canAdjust: boolean;
  ledger: LedgerRow[];
  ledgerLimit: number;
  /** True only when MORE rows exist than were fetched — see page.tsx. */
  ledgerTruncated: boolean;
  grants: GrantRow[];
  /** Everything that is not a token package — resolved on the server. */
  grantableProducts: GrantableProduct[];
}) {
  const t = useTranslations("memberBilling");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  // The grant whose revoke confirmation is open (null = none), exactly as the
  // user list holds `toDelete`.
  const [toRevoke, setToRevoke] = useState<GrantRow | null>(null);

  return (
    <div className="flex flex-col gap-8">
      {showTokens && (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardDescription>{t("balanceTitle")}</CardDescription>
            <CardTitle className="text-3xl">{format.number(balance)}</CardTitle>
            {!hasAccount && (
              <p className="text-muted-foreground text-sm">
                {t("balanceEmpty")}
              </p>
            )}
          </div>
          {/* Auto top-up billed the card and no credit ever came back.
              Deliberately loud and deliberately HERE: this is the page an
              Operator opens when a customer writes in about their balance, and
              the customer's own screen still says auto top-up is on — because
              it is. What stopped is the charging, not their setting. */}
          {pausedReloadCharges !== null && (
            <Callout variant="warning" title={t("reloadPausedTitle")}>
              {t("reloadPausedBody", { count: pausedReloadCharges })}
            </Callout>
          )}
          {/* Rendered even without an account row: the first correction
              creates the account, which is exactly what an Operator crediting
              a Member who never bought tokens needs. Gone entirely in an app
              that sells no tokens — see `canAdjust` above. */}
          {canAdjust && (
            <AdjustBalance memberId={memberId} memberLabel={memberLabel} />
          )}
        </CardContent>
      </Card>
      )}

      {showTokens && (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("ledgerTitle")}</h2>
        {ledger.length === 0 ? (
          <EmptyState
            icon={Coins}
            title={t("ledgerEmptyTitle")}
            description={t("ledgerEmptyBody")}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>{t("ledgerColumnDate")}</TableHead>
                    <TableHead>{t("ledgerColumnKind")}</TableHead>
                    <TableHead className="text-right">
                      {t("ledgerColumnAmount")}
                    </TableHead>
                    <TableHead className="hidden text-right sm:table-cell">
                      {t("ledgerColumnBalance")}
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      {t("ledgerColumnNote")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {format.dateTime(row.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{KIND_LABEL[row.type] ? t(KIND_LABEL[row.type]) : row.type}</span>
                          {/* "sub" | "topup" | "auto" — raw data from the
                              purchase, not a sentence: it says whether a
                              credit was bought by hand or charged
                              automatically. */}
                          {row.origin && (
                            <span className="text-muted-foreground text-xs">
                              {t(`origin_${row.origin}`)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          row.amount > 0 && "text-success-foreground",
                          row.amount < 0 && "text-danger-foreground",
                        )}
                      >
                        {/* The sign is the point of a journal — a "50" that
                            might be a credit or a spend explains nothing. */}
                        {format.number(row.amount, {
                          signDisplay: "exceptZero",
                        })}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                        {format.number(row.balanceAfter)}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">
                        {row.note ?? tCommon("none")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Say it when the list is a slice. An audit view that silently
                stops at 100 rows is worse than one that admits it does. */}
            {/* `length >= limit` could not tell "exactly 100 rows" from "more than
                100", so an account with exactly 100 bookings was told its
                complete history was a slice. The page fetches limit + 1 and
                passes the answer down. */}
            {ledgerTruncated && (
              <p className="text-muted-foreground text-sm">
                {t("ledgerTruncated", { count: ledgerLimit })}
              </p>
            )}
          </>
        )}
      </section>
      )}

      {/* The mirror of `showTokens`: nothing to hand out and nothing ever
          handed out means there is nothing to say. Derived from the registry,
          not from the mode — in a tokens-only app `grantableProducts()` is
          empty by construction, so the flag is not consulted here at all. A
          Member who HOLDS a grant keeps it on screen either way. */}
      {(grantableProducts.length > 0 || grants.length > 0) && (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("grantsTitle")}</h2>
        {/* No dropdown without something to put in it. */}
        {grantableProducts.length > 0 && (
          <GrantPlan memberId={memberId} products={grantableProducts} />
        )}
        {grants.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("grantsEmptyTitle")}
            description={t("grantsEmptyBody")}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t("grantsColumnProduct")}</TableHead>
                  <TableHead>{t("grantsColumnSource")}</TableHead>
                  <TableHead>{t("grantsColumnState")}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("grantsColumnUntil")}
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t("grantsColumnCreated")}
                  </TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">{tCommon("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((row) => {
                  const state = STATE_STYLE[row.state];
                  const StateIcon = state.icon;
                  const reason =
                    row.endedReason === null
                      ? null
                      : (REASON_LABEL[row.endedReason] ?? null);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          {/* The Product Key verbatim — it is what the
                              registry and every grant row call this plan, and
                              translating it would hide the value support has
                              to quote. */}
                          <span className="font-medium">{row.productKey}</span>
                          {row.note && (
                            <span className="text-muted-foreground text-sm">
                              {row.note}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.source === "purchase" ? "secondary" : "outline"
                          }
                        >
                          {row.source === "purchase"
                            ? t("sourcePurchase")
                            : t("sourceManual")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={state.variant}>
                            <StateIcon aria-hidden />
                            {t(state.label)}
                          </Badge>
                          {row.endedReason && (
                            <span className="text-muted-foreground text-xs">
                              {reason ? t(reason) : row.endedReason}
                            </span>
                          )}
                          {/* AC 3 of story 3.4 — WHEN it was closed, beside
                              WHY. "Ended" alone cannot answer the support
                              question, and `endedAt` is the one value nothing
                              can reconstruct afterwards.

                              UTC, pinned. `ended_at` is `timestamp` WITHOUT
                              zone and is WRITTEN as UTC — rendering it in the
                              browser's zone shows a revocation two hours in
                              the future on a machine at UTC+2, and around
                              midnight on the wrong day. The suffix says which
                              zone is on screen rather than leaving the
                              Operator to guess. */}
                          {row.endedAt && (
                            <span className="text-muted-foreground text-xs">
                              {t("grantsEndedAt", {
                                date: format.dateTime(row.endedAt, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                  timeZone: "UTC",
                                }),
                              })}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden whitespace-nowrap md:table-cell">
                        {/* UTC, and load-bearing — the same trap story 3.3's
                            confirmation message already pins. `access_until`
                            is stored as the LAST MILLISECOND of the chosen day
                            in UTC, so rendering it in the display zone shows
                            the NEXT day: an Operator who granted "through
                            1 August" reads "2. Aug." here while the toast that
                            confirmed it said "1. Aug.". */}
                        {row.accessUntil
                          ? format.dateTime(row.accessUntil, {
                              dateStyle: "medium",
                              timeZone: "UTC",
                            })
                          : tCommon("none")}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden whitespace-nowrap sm:table-cell">
                        {format.dateTime(row.createdAt, {
                          // UTC like the two cells beside it. Unpinned, a comp
                          // created 23:30 UTC and revoked 23:45 UTC rendered as
                          // "created 22 July" next to "revoked 21 July … UTC" —
                          // revoked the day before it was issued.
                          dateStyle: "medium",
                          timeZone: "UTC",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* AC 2 — offered on MANUAL, still-open rows only.
                            The same two conditions the UPDATE carries, so the
                            interface and the statement cannot drift: a
                            purchase grant ends by Digistore24 event and by
                            nothing an Operator clicks (AD-1).

                            This is not the control. Hiding a button protects
                            nothing — see RevokeGrant above. */}
                        {row.source === "manual" && row.endedAt === null && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setToRevoke(row)}
                          >
                            <CircleSlash aria-hidden />
                            {t("revokeAction")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* OUTSIDE the `grants.length` branch on purpose: the component holds
            the always-rendered form whose action fields have to exist in the
            server HTML, and a page with no grants must still ship the same
            markup as one with them. */}
        <RevokeGrant
          memberLabel={memberLabel}
          target={toRevoke}
          onClose={() => setToRevoke(null)}
        />
      </section>
      )}
    </div>
  );
}
