// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// Client components of the user management screen.
//
// The actual logic lives in the server actions (actions.ts) — all that is here
// is the presentation plus useActionState for the pending state. Feedback goes
// through `useActionToast`, deleting through a confirmation (AlertDialog): a
// click that removes an account for good must not be the last one.
//
// This page doubles as the blueprint for your own management screens — table,
// row menu, dialog and short message in the combination that applies
// throughout the template.

import * as React from "react";
import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import {
  MoreHorizontal,
  Trash2,
  Shield,
  ShieldCheck,
  UserIcon,
  Plus,
  Users,
  Mail,
  AtSign,
  Ban,
  CircleCheck,
  LogIn,
  SearchX,
  type LucideIcon,
} from "lucide-react";

// Deliberately from lib/roles (not lib/authz): authz depends on auth.ts and
// therefore on mail sending — that does not belong in the browser bundle.
import { ROLES, type Role } from "@/lib/roles";
import {
  ANY_ROLE,
  USERS_PATH,
  isFiltered,
  parseUserFilter,
  userFilterHref,
  type RawSearchParams,
  type UserFilter,
} from "@/lib/users/list-filter";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/hooks/use-action-toast";
import { RoleBadge } from "@/components/role-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createUserAction,
  setRoleAction,
  setBlockedAction,
  setEmailAction,
  sendLoginLinkAction,
  deleteUserAction,
  startImpersonationAction,
  type ActionState,
} from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";


// One icon per role, for the row menu's "make …" entries. Same order of ideas
// as the badge variants: the owner filled, the moderator marked but not the
// operator, the member plain.
const ROLE_ICONS: Record<Role, LucideIcon> = {
  owner: ShieldCheck,
  moderator: Shield,
  member: UserIcon,
};

export function CreateUserDialog() {
  const t = useTranslations("users");
  const tRoles = useTranslations("roles");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createUserAction, EMPTY_ACTION_STATE);

  useActionToast(state);
  // Close after creating; leave open on error so the input is not lost.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("createTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-email">{t("email")}</Label>
              <Input
                id="new-email"
                name="email"
                type="email"
                required
                placeholder={t("emailPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-name">
                {t("name")}{" "}
                <span className="text-muted-foreground font-normal">
                  ({t("nameOptional")})
                </span>
              </Label>
              <Input id="new-name" name="name" autoComplete="name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-role">{t("role")}</Label>
              {/* `name` makes Radix submit a hidden field — the selection thus
                  lands in FormData like any other input. */}
              <Select name="role" defaultValue="member">
                <SelectTrigger id="new-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Derived from ROLES, so a new role appears here by itself
                      the moment lib/roles.ts and the message files know it. */}
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {tRoles(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("loading") : t("createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Row {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  createdAt: Date;
  /** Blocked since — null means "not blocked". */
  blockedAt: Date | null;
}

/** FormData as the same shape `parseUserFilter` reads out of the URL. */
function formValues(form: HTMLFormElement): RawSearchParams {
  const raw: RawSearchParams = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  return raw;
}

// A plain GET form, deliberately — the same shape and the same reason as the
// purchases screen's: `useSearchParams()` would opt this route out of static
// rendering and fail the production build unless it sat inside a Suspense
// boundary, and the form needs none of it. Without JavaScript the browser
// submits it and the page still filters; with JavaScript the submit handler
// builds a cleaner address and — by leaving `page` out — always returns to the
// first page, because page 7 of the old filter is nobody's answer to a new one.
function UserFilters({ filter }: { filter: UserFilter }) {
  const t = useTranslations("users");
  const tRoles = useTranslations("roles");
  const router = useRouter();

  return (
    <form
      method="get"
      action={USERS_PATH}
      // Remount when the filter changes, so the uncontrolled fields follow the
      // URL — otherwise "reset" would clear the address but leave the form
      // showing what it no longer filters by.
      key={userFilterHref(filter, 1)}
      onSubmit={(event) => {
        event.preventDefault();
        router.push(userFilterHref(parseUserFilter(formValues(event.currentTarget)), 1));
      }}
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-q">{t("filterQuery")}</Label>
        <Input
          id="filter-q"
          name="q"
          type="search"
          defaultValue={filter.query ?? ""}
          placeholder={t("filterQueryPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-role">{t("filterRole")}</Label>
        <Select name="role" defaultValue={filter.role ?? ANY_ROLE}>
          <SelectTrigger id="filter-role" className="w-full">
            <SelectValue placeholder={t("filterAnyRole")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_ROLE}>{t("filterAnyRole")}</SelectItem>
            {/* The roles from `lib/roles.ts`, never a list typed again here —
                a fourth role would otherwise be filterable everywhere except
                in the one place an operator looks for it. */}
            {ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {tRoles(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filter-blocked">{t("filterBlocked")}</Label>
        <Select name="blocked" defaultValue={filter.blocked}>
          <SelectTrigger id="filter-blocked" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("blocked_all")}</SelectItem>
            <SelectItem value="active">{t("blocked_active")}</SelectItem>
            <SelectItem value="blocked">{t("blocked_blocked")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit">{t("filterSubmit")}</Button>
        {isFiltered(filter) && (
          <Button type="button" variant="ghost" asChild>
            <Link href={USERS_PATH}>{t("filterReset")}</Link>
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
  filter: UserFilter;
  page: number;
  hasMore: boolean;
}) {
  const t = useTranslations("users");
  if (page === 1 && !hasMore) return null;

  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-sm">{t("pageIndicator", { page })}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={userFilterHref(filter, page - 1)}>{t("pagePrev")}</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {t("pagePrev")}
          </Button>
        )}
        {hasMore ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={userFilterHref(filter, page + 1)}>{t("pageNext")}</Link>
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

export function UserTable({
  users,
  filter,
  page,
  hasMore,
  total,
  currentUserId,
  impersonationEnabled,
}: {
  users: Row[];
  filter: UserFilter;
  page: number;
  hasMore: boolean;
  /** Matches for this filter, ignoring the page — decides the empty state. */
  total: number;
  currentUserId: string;
  /**
   * Whether `config/impersonation.json` has the feature switched on. Passed in
   * from the page rather than read here: the config module is server-side.
   *
   * It hides the menu entry and NOTHING else — the server action refuses on its
   * own (FR-75). A hidden menu is cosmetics; a Server Action is an HTTP
   * endpoint of its own.
   */
  impersonationEnabled: boolean;
}) {
  const t = useTranslations("users");
  const tRoles = useTranslations("roles");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const [roleState, roleAction] = useActionState(setRoleAction, EMPTY_ACTION_STATE);
  const [blockState, blockAction] = useActionState(setBlockedAction, EMPTY_ACTION_STATE);
  const [linkState, linkAction] = useActionState(sendLoginLinkAction, EMPTY_ACTION_STATE);
  const [deleteState, deleteAction] = useActionState(deleteUserAction, EMPTY_ACTION_STATE);
  const [impersonateState, impersonateAction] = useActionState(
    startImpersonationAction,
    EMPTY_ACTION_STATE,
  );
  const [isPending, startAction] = useTransition();
  // The user whose delete confirmation is open (null = none).
  const [toDelete, setToDelete] = useState<Row | null>(null);
  // …the same for the block confirmation and the email dialog.
  const [toBlock, setToBlock] = useState<Row | null>(null);
  const [toEdit, setToEdit] = useState<Row | null>(null);
  // …and for "sign in as this user", which is consequential enough to confirm:
  // the mis-click it prevents is picking the wrong row on a long list.
  const [toImpersonate, setToImpersonate] = useState<Row | null>(null);

  useActionToast(roleState);
  useActionToast(blockState);
  useActionToast(linkState);
  useActionToast(deleteState);
  useActionToast(impersonateState);

  // The confirmation only closes once the delete succeeded. If it fails (e.g.
  // last admin) it stays up — the message explains why.
  useEffect(() => {
    if (deleteState.ok) setToDelete(null);
  }, [deleteState]);

  useEffect(() => {
    if (blockState.ok) setToBlock(null);
  }, [blockState]);

  /** Call a server action outside a form (menu entry / button). */
  function run(
    action: (formData: FormData) => void,
    fields: Record<string, string>,
  ) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    startAction(() => action(formData));
  }

  // 🚨 **Two empty states, and telling them apart is the point.** "This app has
  // no users" and "your search matched nobody" are different situations with
  // different next steps, and the second one needs the filter form to stay on
  // screen — an operator who mistyped an address must be able to correct it
  // rather than wonder where their customers went.
  if (total === 0 && !isFiltered(filter)) {
    return <EmptyState icon={Users} title={t("emptyTitle")} description={t("emptyBody")} />;
  }

  return (
    <>
      <UserFilters filter={filter} />

      {users.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("filterEmptyTitle")}
          description={t("filterEmptyBody")}
        >
          <Button variant="outline" size="sm" asChild>
            <Link href={USERS_PATH}>{t("filterReset")}</Link>
          </Button>
        </EmptyState>
      ) : (
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>{t("columnUser")}</TableHead>
              <TableHead>{t("columnRole")}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t("columnCreated")}
              </TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">{tCommon("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const isBlocked = user.blockedAt !== null;
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      {/* The address is the way into the Member's billing
                          state (Epic 3) — deliberately the CELL and not an
                          entry in the row menu: the signed-in Operator's own
                          row has no menu at all (see below), and an Operator
                          correcting their own balance has to get there too.
                          Blocked rows are dimmed: the state has to register
                          while scrolling past, not only once you read the
                          badge. */}
                      <Link
                        href={`/dashboard/admin/users/${encodeURIComponent(user.id)}`}
                        className={cn(
                          "font-medium hover:underline",
                          isBlocked && "text-muted-foreground line-through",
                        )}
                      >
                        {user.email ?? tCommon("none")}
                        {isSelf && (
                          <span className="text-muted-foreground font-normal no-underline">
                            {" "}
                            · {t("you")}
                          </span>
                        )}
                      </Link>
                      {user.name && (
                        <span className="text-muted-foreground text-sm">
                          {user.name}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RoleBadge role={user.role} />
                      {isBlocked && (
                        <Badge variant="destructive">
                          <Ban aria-hidden />
                          {t("statusBlocked")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">
                    {format.dateTime(user.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Self-demotion and self-deletion are forbidden server
                        side — here we additionally hide the buttons. */}
                    {isSelf ? (
                      <span className="text-muted-foreground">
                        {tCommon("none")}
                      </span>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={isPending}
                            aria-label={tCommon("actions")}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel>
                            {user.email ?? tCommon("none")}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {/* One entry per role the user does not hold —
                              derived from ROLES like the create dialog, so
                              the menu and the rule layer can never disagree
                              about which roles exist. */}
                          {ROLES.filter((role) => role !== user.role).map(
                            (role) => {
                              const Icon = ROLE_ICONS[role];
                              return (
                                <DropdownMenuItem
                                  key={role}
                                  onSelect={() =>
                                    run(roleAction, { id: user.id, role })
                                  }
                                >
                                  <Icon aria-hidden />
                                  {t("setRole", { role: tRoles(role) })}
                                </DropdownMenuItem>
                              );
                            },
                          )}
                          <DropdownMenuItem onSelect={() => setToEdit(user)}>
                            <AtSign aria-hidden />
                            {t("changeEmail")}
                          </DropdownMenuItem>
                          {/* No password reset here — and not because there are
                              no passwords (a Member may set one on themselves
                              under /dashboard/account). There is no reset for
                              anyone to run: whoever forgets their password
                              signs in with a link and sets a new one. This
                              entry IS that link, from the Operator's side.
                              Blocked users get none — it would lead nowhere. */}
                          <DropdownMenuItem
                            disabled={isBlocked || !user.email}
                            onSelect={() => run(linkAction, { id: user.id })}
                          >
                            <Mail aria-hidden />
                            {t("sendLoginLink")}
                          </DropdownMenuItem>
                          {/* Sign in as this user.
                              Offered for MEMBERS only — absent for an admin, a
                              moderator and a blocked account rather than
                              offered and then refused, the same treatment the
                              sign-in link above gets. All three refusals also
                              live in canImpersonate(), because a request that
                              never passed through this menu has to be refused
                              identically: an owner target would hand over
                              every right that owner holds, and a moderator's
                              badge must never be an operator in disguise. */}
                          {impersonationEnabled &&
                            user.role === "member" &&
                            !isBlocked && (
                              <DropdownMenuItem
                                onSelect={() => setToImpersonate(user)}
                              >
                                <LogIn aria-hidden />
                                {t("impersonate")}
                              </DropdownMenuItem>
                            )}
                          <DropdownMenuSeparator />
                          {isBlocked ? (
                            // Unblocking takes nothing away from anyone — that
                            // may go without a confirmation. Blocking may not
                            // (see below).
                            <DropdownMenuItem
                              onSelect={() =>
                                run(blockAction, {
                                  id: user.id,
                                  blocked: "false",
                                })
                              }
                            >
                              <CircleCheck aria-hidden />
                              {t("unblock")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setToBlock(user)}
                            >
                              <Ban aria-hidden />
                              {t("block")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setToDelete(user)}
                          >
                            <Trash2 aria-hidden />
                            {t("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      )}

      <Paging filter={filter} page={page} hasMore={hasMore} />

      {/* Signing in as somebody asks first, and names the address while doing
          so. Not because it is destructive — it takes nothing away — but
          because it is consequential and leaves a permanent record, and the
          mistake it prevents is the ordinary one: the wrong row on a long list.

          The confirm button is NOT `variant="destructive"`. Red is reserved
          here for actions that remove something; using it for every serious
          action is how it stops meaning anything. */}
      <AlertDialog
        open={toImpersonate !== null}
        onOpenChange={(open) => !open && setToImpersonate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("impersonateTitle", {
                email: toImpersonate?.email ?? tCommon("none"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("impersonateBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                if (toImpersonate) {
                  run(impersonateAction, { id: toImpersonate.id });
                }
              }}
            >
              {isPending ? tCommon("loading") : t("impersonateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blocking asks first: it throws someone out of their running session
          immediately. Being reversible does not make it casual. */}
      <AlertDialog
        open={toBlock !== null}
        onOpenChange={(open) => !open && setToBlock(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("blockTitle", { email: toBlock?.email ?? tCommon("none") })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("blockBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                if (toBlock) {
                  run(blockAction, { id: toBlock.id, blocked: "true" });
                }
              }}
            >
              {isPending ? tCommon("loading") : t("blockConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditEmailDialog user={toEdit} onClose={() => setToEdit(null)} />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deleteTitle", {
                email: toDelete?.email ?? tCommon("none"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              // Red, not the accent color: the button that removes something
              // for good has to look different from the one that creates.
              variant="destructive"
              disabled={isPending}
              // Do not close automatically: the confirmation disappears only
              // once the server has confirmed (see useEffect above).
              onClick={(event) => {
                event.preventDefault();
                if (toDelete) run(deleteAction, { id: toDelete.id });
              }}
            >
              {isPending ? tCommon("loading") : t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Change a user's email address.
 *
 * This is more than a profile field: here the address IS the identity — it is
 * where the sign-in link goes. After the change, whoever held the old address
 * can no longer get in, and whoever holds the new one can. That is why the
 * warning sits in the dialog and not only in the documentation.
 *
 * Controlled from outside (`user` = open for this user, `null` = closed), so
 * the table has one dialog rather than one per row.
 */
function EditEmailDialog({
  user,
  onClose,
}: {
  user: { id: string; email: string | null } | null;
  onClose: () => void;
}) {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(setEmailAction, EMPTY_ACTION_STATE);

  useActionToast(state);
  // Close on success only — otherwise the rejected address (e.g. already
  // taken) would be gone and would have to be typed again.
  useEffect(() => {
    if (state.ok) onClose();
    // onClose deliberately left out of the dependencies: it is recreated on
    // every render of the table and would otherwise fire the effect even when
    // the result has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* `key` forces a fresh form per user — without it, opening the
            dialog a second time would still show the first one's address. */}
        <form action={action} key={user?.id}>
          <input type="hidden" name="id" value={user?.id ?? ""} />
          <DialogHeader>
            <DialogTitle>{t("changeEmailTitle")}</DialogTitle>
            <DialogDescription>{t("changeEmailDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="edit-email">{t("email")}</Label>
            <Input
              id="edit-email"
              name="email"
              type="email"
              required
              defaultValue={user?.email ?? ""}
              placeholder={t("emailPlaceholder")}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("loading") : t("changeEmailSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
