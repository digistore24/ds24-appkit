// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The Member's HTTP API keys — the card on the account page. The texts, the
// Server Actions and the endpoint shown ride in as props, so a second key
// surface (should one ever return) renders the same card instead of the same
// 400 lines drifting apart — the same rule as "one ChatWindow, two places".
//
// The whole design problem here is one moment: a new key is readable exactly
// once, and the person looking at it usually does not yet know that. So the
// secret is not a toast (a toast drifts past), it is a `Callout` that stays,
// with a copy button, and it says in as many words that this is the only time.
// See the three feedback mechanisms in CLAUDE.md → UI: what has to stay on
// screen is a Callout, what may drift past is a toast.
//
// Revoking runs through an AlertDialog that NAMES the key — "revoke 'Claude on
// my laptop'?" — because the list is a list of near-identical rows and the one
// thing somebody must not do by accident is kill the key their laptop is using.

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Copy, KeyRound, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { useActionToast } from "@/hooks/use-action-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * What the action module returns. Structural — `actions.ts` declares
 * its own type, and this component only cares about the shape.
 */
export interface KeyActionState {
  error: string | null;
  ok: string | null;
  secret?: string | null;
}

type KeyAction = (prev: KeyActionState, formData: FormData) => Promise<KeyActionState>;

const EMPTY: KeyActionState = { error: null, ok: null, secret: null };

export interface KeyRowView {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  state: "live" | "expired" | "revoked";
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export function KeysCard({
  namespace,
  keys,
  endpoint,
  maxLiveKeys,
  liveKeys,
  offReason,
  createAction,
  revokeAction,
}: {
  /** The message namespace the card's texts come from. */
  namespace: "apiKeys";
  keys: KeyRowView[];
  /** The absolute URL a client connects to. Built on the server. */
  endpoint: string;
  maxLiveKeys: number;
  liveKeys: number;
  /** Why the feature is off, or null when it is on. */
  offReason: "disabledInConfig" | "brokenConfig" | null;
  createAction: KeyAction;
  revokeAction: KeyAction;
}) {
  const t = useTranslations(namespace);
  const format = useFormatter();

  const [createState, createFormAction, creating] = useActionState(createAction, EMPTY);
  const [revokeState, revokeFormAction] = useActionState(revokeAction, EMPTY);
  const [open, setOpen] = useState(false);

  useActionToast(revokeState);
  // The CREATE action's toast is shown too, but the secret below is the real
  // feedback — the toast only confirms which key was made.
  useActionToast({ error: createState.error, ok: createState.ok });

  // Close the dialog once a key was actually issued, so the secret underneath
  // is not hidden behind the form that produced it.
  const lastSecret = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (createState.secret && createState.secret !== lastSecret.current) {
      lastSecret.current = createState.secret;
      setOpen(false);
    }
  }, [createState.secret]);

  if (offReason) {
    return (
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <KeyRound aria-hidden className="text-muted-foreground size-5" />
          {t("title")}
        </h2>
        <Callout variant="info" title={t("offTitle")}>
          {t(offReason === "brokenConfig" ? "offBrokenBody" : "offDisabledBody")}
        </Callout>
      </section>
    );
  }

  const atLimit = liveKeys >= maxLiveKeys;

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <KeyRound aria-hidden className="text-muted-foreground size-5" />
        {t("title")}
      </h2>
      <p className="text-muted-foreground mb-4 text-sm">
        {t("description")}
      </p>

      {/* The one moment that cannot be repeated. A Callout and not a toast:
          this has to survive a scroll, a misclick and a moment of confusion. */}
      {createState.secret && (
        <Callout variant="warning" title={t("secretTitle")}>
          <p className="mb-2">{t("secretBody")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-card min-w-0 flex-1 overflow-x-auto rounded border px-2 py-1 font-mono text-xs">
              {createState.secret}
            </code>
            <CopyButton value={createState.secret} label={t("copy")} copied={t("copied")} />
          </div>
        </Callout>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("endpointTitle")}</CardTitle>
          <CardDescription>{t("endpointBody")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded px-2 py-1 font-mono text-xs">
            {endpoint}
          </code>
          <CopyButton value={endpoint} label={t("copy")} copied={t("copied")} />
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("countHint", { live: liveKeys, max: maxLiveKeys })}
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={atLimit}>
              <Plus aria-hidden />
              {t("createCta")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form action={createFormAction}>
              <DialogHeader>
                <DialogTitle>{t("createTitle")}</DialogTitle>
                <DialogDescription>{t("createDescription")}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor={`${namespace}-name`}>{t("nameLabel")}</Label>
                  <Input
                    id={`${namespace}-name`}
                    name="name"
                    required
                    maxLength={60}
                    placeholder={t("namePlaceholder")}
                  />
                  <p className="text-muted-foreground text-xs">{t("nameHint")}</p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={`${namespace}-scope`}>{t("scopeLabel")}</Label>
                  {/* `name` makes Radix submit a hidden field, so the selection
                      lands in FormData like any other input. Defaults to
                      `read` — the safe one, and the right one for most uses. */}
                  <Select name="scope" defaultValue="read">
                    <SelectTrigger id={`${namespace}-scope`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">{t("scopeRead")}</SelectItem>
                      <SelectItem value="write">{t("scopeWrite")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">{t("scopeHint")}</p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={`${namespace}-lifetime`}>{t("lifetimeLabel")}</Label>
                  <Select name="lifetimeDays" defaultValue="90">
                    <SelectTrigger id={`${namespace}-lifetime`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">{t("lifetime30")}</SelectItem>
                      <SelectItem value="90">{t("lifetime90")}</SelectItem>
                      <SelectItem value="365">{t("lifetime365")}</SelectItem>
                      <SelectItem value="never">{t("lifetimeNever")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t("cancel")}
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={creating}>
                  {creating ? t("creating") : t("createSubmit")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {atLimit && (
        <Callout variant="info" title={t("limitTitle")} className="mt-3">
          {t("limitBody", { max: maxLiveKeys })}
        </Callout>
      )}

      {keys.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={KeyRound}
          title={t("emptyTitle")}
          description={t("emptyBody")}
        />
      ) : (
        <Card className="mt-4">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnName")}</TableHead>
                  <TableHead>{t("columnScope")}</TableHead>
                  <TableHead>{t("columnLastUsed")}</TableHead>
                  <TableHead>{t("columnState")}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className="font-medium">{key.name}</div>
                      <code className="text-muted-foreground font-mono text-xs">
                        {key.prefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.scope === "write" ? "default" : "secondary"}>
                        {key.scope === "write" ? (
                          <ShieldOff aria-hidden className="size-3" />
                        ) : (
                          <ShieldCheck aria-hidden className="size-3" />
                        )}
                        {t(key.scope === "write" ? "scopeWriteShort" : "scopeReadShort")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {key.lastUsedAt
                        ? format.dateTime(key.lastUsedAt, { dateStyle: "medium" })
                        : t("neverUsed")}
                    </TableCell>
                    <TableCell>
                      <StateBadge
                        namespace={namespace}
                        state={key.state}
                        expiresAt={key.expiresAt}
                      />
                    </TableCell>
                    <TableCell>
                      {key.state === "live" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              {t("revoke")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              {/* Names the key. The rows look alike, and the one
                                  mistake to prevent is killing the key that is
                                  currently in use. */}
                              <AlertDialogTitle>
                                {t("revokeTitle", { name: key.name })}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("revokeBody")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                              <form action={revokeFormAction}>
                                <input type="hidden" name="keyId" value={key.id} />
                                <AlertDialogAction type="submit" variant="destructive">
                                  {t("revokeSubmit")}
                                </AlertDialogAction>
                              </form>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function StateBadge({
  namespace,
  state,
  expiresAt,
}: {
  namespace: "apiKeys";
  state: KeyRowView["state"];
  expiresAt: Date | null;
}) {
  const t = useTranslations(namespace);
  const format = useFormatter();

  if (state === "revoked") return <Badge variant="destructive">{t("stateRevoked")}</Badge>;
  if (state === "expired") return <Badge variant="outline">{t("stateExpired")}</Badge>;

  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="secondary">{t("stateLive")}</Badge>
      {expiresAt && (
        <span className="text-muted-foreground text-xs">
          {t("expiresOn", { date: format.dateTime(expiresAt, { dateStyle: "medium" }) })}
        </span>
      )}
    </div>
  );
}

/**
 * Copies to the clipboard, and says so.
 *
 * `navigator.clipboard` is unavailable on an insecure origin (plain http on a
 * hostname that is not localhost), which is a normal state for a staging box
 * without TLS. The failure is caught and reported rather than swallowed — a
 * button that silently does nothing is worse than one that says it could not.
 */
function CopyButton({
  value,
  label,
  copied,
}: {
  value: string;
  label: string;
  copied: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success(copied);
        } catch {
          toast.error(label);
        }
      }}
    >
      <Copy aria-hidden />
      {label}
    </Button>
  );
}
