// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// Presentation for the purchases screen: every purchase, narrowed by the four
// filters of story 3.7. All logic lives in the server action and in the pure
// module lib/digistore/purchase-filter.ts; this is the form, the table and
// useActionState for the pending state, following
// app/dashboard/admin/users/ui.tsx as the blueprint.
//
// The filter state lives in the URL, never in useState (§D4): `revalidatePath`
// re-renders the server component after an attach, and a filter held in
// component state would survive that render while the rows beneath it were
// refetched unfiltered — a table that no longer matches the form above it.
import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Receipt, SearchX } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useActionToast } from "@/hooks/use-action-toast";
import type { OrderStatus } from "@/lib/digistore/claimable";
import {
  ANY_PRODUCT,
  canAttachOrder,
  isFiltered,
  parsePurchaseFilter,
  purchaseFilterHref,
  PURCHASES_PATH,
  type PurchaseFilter,
  type RawSearchParams,
} from "@/lib/digistore/purchase-filter";
import { attachOrderAction, type ActionState } from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";


export interface Row {
  ds24OrderId: string;
  buyerEmail: string | null;
  productKey: string | null;
  amount: string | null;
  currency: string | null;
  status: OrderStatus;
  memberId: string | null;
  memberEmail: string | null;
  createdAt: Date;
}

export interface ProductOption {
  key: string;
  name: string;
}

// Badge intent per status, in the shape ipn-log-table.tsx already uses. No
// "success" variant exists, so a paid purchase is the accent (default); the two
// that took the money back are destructive, and the two reversible states are
// muted.
const STATUS_VARIANT: Record<
  OrderStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  paid: "default",
  refunded: "destructive",
  chargeback: "destructive",
  paused: "secondary",
  cancelled: "outline",
};

/** FormData as the same shape `parsePurchaseFilter` reads out of the URL. */
function formValues(form: HTMLFormElement): RawSearchParams {
  const raw: RawSearchParams = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  return raw;
}

// A plain GET form, deliberately: `useSearchParams()` would opt this route out
// of static rendering and fail the production build unless it sat inside a
// Suspense boundary, and the form needs none of it. Without JavaScript the
// browser submits it and the page still filters; with JavaScript the submit
// handler builds a cleaner address (no empty parameters, no sentinel) and — by
// leaving `page` out — always returns to the first page.
function PurchaseFilters({
  filter,
  products,
}: {
  filter: PurchaseFilter;
  products: ProductOption[];
}) {
  const t = useTranslations("purchases");
  const router = useRouter();

  return (
    <form
      method="get"
      action={PURCHASES_PATH}
      // Remount when the filter changes, so the uncontrolled fields follow the
      // URL — otherwise "reset" would clear the address but leave the form
      // showing what it no longer filters by.
      key={purchaseFilterHref(filter, 1)}
      onSubmit={(event) => {
        event.preventDefault();
        router.push(
          purchaseFilterHref(parsePurchaseFilter(formValues(event.currentTarget)), 1),
        );
      }}
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-email">{t("filterEmail")}</Label>
        <Input
          id="filter-email"
          name="email"
          type="search"
          defaultValue={filter.email ?? ""}
          placeholder={t("filterEmailPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-product">{t("filterProduct")}</Label>
        <Select name="product" defaultValue={filter.productKey ?? ANY_PRODUCT}>
          <SelectTrigger id="filter-product" className="w-full">
            <SelectValue placeholder={t("filterAnyProduct")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_PRODUCT}>{t("filterAnyProduct")}</SelectItem>
            {products.map((product) => (
              <SelectItem key={product.key} value={product.key}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-order">{t("filterOrder")}</Label>
        <Input
          id="filter-order"
          name="order"
          type="search"
          defaultValue={filter.orderId ?? ""}
          placeholder={t("filterOrderPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-assignment">{t("filterAssignment")}</Label>
        <Select name="assignment" defaultValue={filter.assignment}>
          <SelectTrigger id="filter-assignment" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("assignment_all")}</SelectItem>
            <SelectItem value="unassigned">
              {t("assignment_unassigned")}
            </SelectItem>
            <SelectItem value="assigned">{t("assignment_assigned")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit">{t("filterSubmit")}</Button>
        {isFiltered(filter) && (
          <Button type="button" variant="ghost" asChild>
            <Link href={PURCHASES_PATH}>{t("filterReset")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}

function Paging({
  filter,
  page,
  hasMore,
}: {
  filter: PurchaseFilter;
  page: number;
  hasMore: boolean;
}) {
  const t = useTranslations("purchases");
  if (page === 1 && !hasMore) return null;

  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-sm">
        {t("pageIndicator", { page })}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={purchaseFilterHref(filter, page - 1)}>
              {t("pagePrev")}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {t("pagePrev")}
          </Button>
        )}
        {hasMore ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={purchaseFilterHref(filter, page + 1)}>
              {t("pageNext")}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {t("pageNext")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PurchasesTable({
  rows,
  filter,
  products,
  members,
  page,
  hasMore,
  total,
}: {
  rows: Row[];
  filter: PurchaseFilter;
  products: ProductOption[];
  members: { id: string; email: string | null }[];
  page: number;
  hasMore: boolean;
  total: number;
}) {
  const t = useTranslations("purchases");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const [state, action] = useActionState(attachOrderAction, EMPTY_ACTION_STATE);
  const [isPending, startAction] = useTransition();
  const [toAttach, setToAttach] = useState<Row | null>(null);
  const [memberId, setMemberId] = useState("");

  useActionToast(state);

  // Close only on success — a refused attach leaves the dialog open with the
  // toast explaining why.
  useEffect(() => {
    if (state.ok) {
      setToAttach(null);
      setMemberId("");
    }
  }, [state.ok]);

  const filtered = isFiltered(filter);

  /**
   * What to call a product in the table.
   *
   * ⚠️ **The key is the FALLBACK, not the answer.** The column printed
   * `basic_monthly` at an operator until 2026-08-17 while the filter above it
   * offered "Basic (monthly)" — one page, two names for one thing, and the
   * developer-facing one in the row somebody reads while a customer is on the
   * phone.
   *
   * 🚨 And the key has to survive as a fallback rather than being resolved
   * through `getProduct()`: `orders.productKey` is what Digistore24 sent at the
   * time, the registry is a file somebody edits, and a plan that was renamed or
   * deleted leaves rows nothing can look up (`lib/digistore/products.ts` →
   * `findProduct`). Printing the raw key there is honest; throwing on a
   * five-year-old order is not.
   *
   * The map comes off the `products` prop the filter dropdown already uses, so
   * both take the same name from the same list.
   */
  const productName = (key: string) =>
    products.find((product) => product.key === key)?.name ?? key;

  // Nothing has ever been bought — the filter form would only be noise.
  if (total === 0 && !filtered) {
    return (
      <EmptyState
        icon={Receipt}
        title={t("emptyTitle")}
        description={t("emptyBody")}
      />
    );
  }

  return (
    <>
      <PurchaseFilters filter={filter} products={products} />

      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("filterEmptyTitle")}
          description={t("filterEmptyBody")}
        >
          <Button variant="outline" asChild>
            <Link href={PURCHASES_PATH}>{t("filterReset")}</Link>
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t("columnBuyer")}</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("columnAccount")}
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t("columnProduct")}
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">
                    {t("columnAmount")}
                  </TableHead>
                  <TableHead>{t("columnStatus")}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("columnDate")}
                  </TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">{tCommon("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.ds24OrderId}>
                    <TableCell className="font-medium">
                      {row.buyerEmail ?? tCommon("none")}
                      <span className="text-muted-foreground block font-mono text-xs font-normal">
                        {row.ds24OrderId}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {row.memberId === null ? (
                        <span className="text-muted-foreground">
                          {t("noAccount")}
                        </span>
                      ) : (
                        (row.memberEmail ?? row.memberId)
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {row.productKey === null ? tCommon("none") : productName(row.productKey)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {row.amount
                        ? `${row.amount} ${row.currency ?? ""}`.trim()
                        : tCommon("none")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>
                        {t(`status_${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* The same two conditions the server action enforces —
                          from the same pure function, so they cannot drift. */}
                      {canAttachOrder(row) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => setToAttach(row)}
                        >
                          {t("attach")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Paging filter={filter} page={page} hasMore={hasMore} />
        </>
      )}

      <AlertDialog
        open={toAttach !== null}
        onOpenChange={(open) => !open && setToAttach(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("attachTitle", {
                email: toAttach?.buyerEmail ?? tCommon("none"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("attachDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="attach-member">{t("attachMember")}</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="attach-member">
                <SelectValue placeholder={t("attachMemberPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.email ?? m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || !memberId}
              onClick={(event) => {
                // Do not close the dialog here — a refusal must stay visible.
                event.preventDefault();
                if (!toAttach || !memberId) return;
                const formData = new FormData();
                formData.set("orderId", toAttach.ds24OrderId);
                formData.set("memberId", memberId);
                startAction(() => action(formData));
              }}
            >
              {isPending ? tCommon("loading") : t("attachConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
