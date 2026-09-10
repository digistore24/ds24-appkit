// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The member's billing list: one card per purchase, each with its invoices
// (one per payment) and the Digistore24 links to update payment details or
// cancel the subscription. All three actions are just deep links to DS24's own
// pages — the data was captured from the IPN (lib/digistore/member-billing.ts).
import { useTranslations, useFormatter } from "next-intl";
import { CreditCard, Download, Receipt, RefreshCw, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { BillingOrder } from "@/lib/digistore/member-billing";

export type Row = BillingOrder & { productName: string | null };

// Order status → badge intent. Money already moved; this only colours it.
const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  paid: "default",
  paused: "secondary",
  cancelled: "outline",
  refunded: "outline",
  chargeback: "destructive",
};

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

export function BillingList({ orders }: { orders: Row[] }) {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  function money(amount: string | null, currency: string | null): string | null {
    if (!amount) return null;
    if (currency) {
      try {
        return format.number(Number(amount), { style: "currency", currency });
      } catch {
        // Unknown currency code — fall through to the plain rendering.
      }
    }
    return `${amount}${currency ? ` ${currency}` : ""}`;
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title={t("emptyTitle")}
        description={t("emptyBody")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {orders.map((order) => (
        <Card key={order.ds24OrderId}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{order.productName ?? order.ds24OrderId}</CardTitle>
                <CardDescription>
                  {format.dateTime(order.createdAt, { dateStyle: "medium" })}
                  {money(order.amount, order.currency)
                    ? ` · ${money(order.amount, order.currency)}`
                    : ""}
                </CardDescription>
              </div>
              <Badge variant={STATUS_VARIANT[order.status] ?? "secondary"}>
                {t(`status_${order.status}`)}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {/* Invoices — one per payment */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t("invoices")}</p>
              {order.invoices.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noInvoices")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {order.invoices.map((inv) => (
                    <li key={inv.id}>
                      <Button variant="outline" size="sm" asChild>
                        <a href={inv.invoiceUrl} {...EXTERNAL}>
                          <Download />
                          {t("invoice")}
                          {inv.paySequenceNo ? ` #${inv.paySequenceNo}` : ""}
                          {" · "}
                          {format.dateTime(inv.createdAt, { dateStyle: "medium" })}
                          {money(inv.amount, inv.currency)
                            ? ` · ${money(inv.amount, inv.currency)}`
                            : ""}
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Manage — DS24-hosted */}
            {(order.renewUrl ||
              order.rebillingStopUrl ||
              order.switchIntervalUrl) && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {order.renewUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={order.renewUrl} {...EXTERNAL}>
                      <CreditCard />
                      {t("updatePayment")}
                    </a>
                  </Button>
                )}
                {/* Digistore24's own interval switch. It exists only because
                    the product carries one payment plan per way to pay, and it
                    is why this app builds no upgrade flow of its own: the
                    member changes it over there and the change comes back as
                    an ordinary rebill, on the same Product Key. */}
                {order.switchIntervalUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={order.switchIntervalUrl} {...EXTERNAL}>
                      <RefreshCw />
                      {t("switchInterval")}
                    </a>
                  </Button>
                )}
                {order.rebillingStopUrl && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <XCircle />
                        {t("cancelSubscription")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("cancelTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("cancelDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                        {/* Leads to Digistore24's own cancellation page. */}
                        <AlertDialogAction
                          asChild
                          className={cn(
                            buttonVariants({ variant: "destructive" }),
                          )}
                        >
                          <a href={order.rebillingStopUrl} {...EXTERNAL}>
                            {t("cancelConfirm")}
                          </a>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
