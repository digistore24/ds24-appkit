// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The keys screen.
//
// Two things about the shape are decisions rather than styling:
//
//  * The new key is a `Callout`, not a toast. A toast drifts past, and this is
//    the only moment the secret exists — there is no "show it again".
//  * Revoking runs through an `AlertDialog` that NAMES the key, because
//    "revoke" on the wrong row is not recoverable and the rows look alike.

import { useActionState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  createSetupKeyAction,
  revokeSetupKeyAction,
  type SetupKeyActionState,
} from "./actions";

export interface KeyRowView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const EMPTY: SetupKeyActionState = { error: null, ok: null, secret: null };

export function SetupKeys({ rows }: { rows: KeyRowView[] }) {
  const t = useTranslations("setupKeys");
  const format = useFormatter();

  const [createState, create, creating] = useActionState(createSetupKeyAction, EMPTY);
  const [revokeState, revoke] = useActionState(revokeSetupKeyAction, EMPTY);

  useActionToast(revokeState);
  // The create action's toast fires too, but the secret below is the real
  // feedback — hence only the error/ok half here.
  useActionToast({ error: createState.error, ok: createState.ok });

  const day = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium" }) : "—";

  return (
    <div className="space-y-6">
      {createState.secret ? (
        <Callout variant="success" title={t("secretTitle")}>
          <p className="mb-2">{t("secretOnce")}</p>
          <code className="block break-all rounded-md bg-muted p-3 font-mono text-sm">
            {createState.secret}
          </code>
          <p className="mt-2 text-sm">{t("secretWhere")}</p>
        </Callout>
      ) : null}

      <div className="flex justify-end">
        <Dialog>
          <DialogTrigger asChild>
            <Button>{t("create")}</Button>
          </DialogTrigger>
          <DialogContent>
            <form action={create}>
              <DialogHeader>
                <DialogTitle>{t("createTitle")}</DialogTitle>
                <DialogDescription>{t("createHint")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("name")}</Label>
                  <Input id="name" name="name" placeholder={t("namePlaceholder")} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lifetimeDays">{t("lifetime")}</Label>
                  <Input
                    id="lifetimeDays"
                    name="lifetimeDays"
                    type="number"
                    min={0}
                    max={3650}
                    placeholder={t("lifetimePlaceholder")}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={creating}>
                  {t("create")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={KeyRound} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("key")}</TableHead>
              {/* `created_col`, not `created` — the latter is the confirmation
                  sentence `actions.ts` returns ("Key minted."), and it read as a
                  column heading, full stop and all, until 2026-08-12. Two keys
                  that both sound right is exactly what `i18n/messages.test.ts`
                  cannot see: it compares the two languages' key SETS, and a
                  wrong call site is equally wrong in both. */}
              <TableHead>{t("created_col")}</TableHead>
              <TableHead>{t("lastUsed")}</TableHead>
              <TableHead>{t("state")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const revoked = row.revokedAt !== null;
              const expired =
                !revoked && row.expiresAt !== null && new Date(row.expiresAt) <= new Date();
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{row.prefix}…</TableCell>
                  <TableCell>{day(row.createdAt)}</TableCell>
                  {/* Never used is a real answer, and the one worth seeing: a key
                      nobody ever used is a key nobody will miss. */}
                  <TableCell>{row.lastUsedAt ? day(row.lastUsedAt) : t("never")}</TableCell>
                  <TableCell>
                    <Badge variant={revoked || expired ? "secondary" : "default"}>
                      {revoked ? t("revokedState") : expired ? t("expired") : t("live")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {revoked ? null : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {t("revoke")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("revokeTitle")}</AlertDialogTitle>
                            {/* Names the key. The rows look alike, and this is
                                not recoverable. */}
                            <AlertDialogDescription>
                              {t("revokeConfirm", { name: row.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                            <form action={revoke}>
                              <input type="hidden" name="id" value={row.id} />
                              <AlertDialogAction type="submit" variant="destructive">
                                {t("revoke")}
                              </AlertDialogAction>
                            </form>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
