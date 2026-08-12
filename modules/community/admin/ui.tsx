// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// Client components of the community rooms screen.
//
// Built on the blueprint next door (`app/dashboard/admin/users/`) — table, row
// menu, create dialog, `<AlertDialog>` before anything destructive, feedback
// through `useActionToast`. The logic lives in `actions.ts`; nothing here is a
// check, and every refusal this file appears to make is a courtesy on top of
// one the server makes again.
//
// **No member counts and no rosters anywhere in this file, and that is the
// one thing not to "improve".** A "12 members" column on a room card is the
// obvious next idea and it is refused by design: presence in a plan-gated room
// IS purchase information, and the template's flagship example is
// health-adjacent. `db/schema-community.ts` carries the full argument. What a
// room does show is the moderators assigned to it — a duty, not a membership.

import * as React from "react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  UserMinus,
} from "lucide-react";

// From lib/community/rules (pure, no config, no server dependency) and
// lib/roles — never from lib/authz or lib/community/config: those read the
// app's own configuration and belong nowhere near a browser bundle.
import {
  GROUP_ACCESS_LEVELS,
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  displayNameFor,
  type GroupAccessLevel,
} from "@/modules/community/lib/rules";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/hooks/use-action-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  assignModeratorAction,
  createGroupAction,
  removeModeratorAction,
  reorderGroupsAction,
  setGroupArchivedAction,
  updateGroupAction,
  type ActionState,
} from "./actions";

const EMPTY: ActionState = { error: null, ok: null };

/**
 * Submit a dialog form WITHOUT handing the form itself to React.
 *
 * ⚠️ **This exists because of a measured defect, and `<form action={…}>` is the
 * thing it is avoiding.** React resets a form once its action returns — refusal
 * included — and Radix's `<Select>` makes that worse than lost typing: it
 * registers a `reset` listener on the enclosing form and pushes its INITIAL
 * value back through `onValueChange`, so even a fully controlled select snaps
 * back. On this page that meant: choose "plan holders", forget to tick a
 * product, get refused — and the level is silently "all members" again. Press
 * create a second time and a paid room has been published open.
 *
 * Dispatching the action from an `onSubmit` handler inside a transition is the
 * same mechanism the row menus in `app/dashboard/admin/users/ui.tsx` already
 * use for actions that have no form at all. The browser still runs its own
 * `required` checks first (they happen before `submit` fires), and the
 * `FormData` is read off the real form element, so Radix's hidden native
 * controls are still what carries the value.
 *
 * A form whose fields the operator would not mind losing — the moderator
 * assign/remove ones below — keeps the plain `action={…}` shape; the reset is
 * harmless there and the simpler code is the right code.
 */
function useDialogSubmit(action: (formData: FormData) => void) {
  const [pending, start] = useTransition();
  return {
    pending,
    onSubmit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      start(() => action(formData));
    },
  };
}

/** One product a plan-gated room may name. Token packages never reach here. */
export interface PlanOption {
  key: string;
  name: string;
}

interface Moderator {
  memberId: string;
  profileName: string | null;
  accountName: string | null;
  role: string;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  accessLevel: GroupAccessLevel;
  planKeys: string[];
  archivedAt: Date | null;
  moderators: Moderator[];
}

/** The badge colour per level — closed rooms read as closed at a glance. */
const LEVEL_VARIANT: Record<
  GroupAccessLevel,
  "secondary" | "default" | "outline"
> = {
  open: "secondary",
  plan: "default",
  moderators: "outline",
  operator: "outline",
};

/**
 * The fields of a room, shared by the create and the edit dialog.
 *
 * ⚠️ **Every field is CONTROLLED, and that is a bug fix rather than a style
 * choice.** React resets an uncontrolled `<form action={…}>` once the action
 * returns — including when it returned a refusal — and Radix's `<Select>` joins
 * that reset through the hidden native control it renders for the form. So the
 * uncontrolled version of this dialog behaved like this, measured on the real
 * page: pick "plan holders", forget to tick a product, submit, get told a
 * plan-gated room needs one — and the name you typed is gone AND the level has
 * silently fallen back to "all members". Press create again and you have
 * published an OPEN room where you meant a paid one, with nothing on screen
 * having said so. A refusal that quietly widens access is worse than the
 * mistake it was refusing.
 *
 * Holding the four values in React state fixes both halves at once: the reset
 * has nothing to reset, and the level stays what the operator chose while the
 * plan-key checkboxes follow it.
 */
function GroupFields({
  plans,
  group,
}: {
  plans: PlanOption[];
  group?: GroupRow;
}) {
  const t = useTranslations("communityAdmin");
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [level, setLevel] = useState<GroupAccessLevel>(
    group?.accessLevel ?? "open",
  );
  const [planKeys, setPlanKeys] = useState<string[]>(group?.planKeys ?? []);

  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">{t("fieldName")}</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={MAX_GROUP_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("fieldNamePlaceholder")}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">{t("fieldDescription")}</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          maxLength={MAX_GROUP_DESCRIPTION_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("fieldDescriptionPlaceholder")}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="accessLevel">{t("fieldAccess")}</Label>
        <Select
          name="accessLevel"
          value={level}
          onValueChange={(value) => setLevel(value as GroupAccessLevel)}
        >
          <SelectTrigger id="accessLevel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_ACCESS_LEVELS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`level_${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* One sentence per level, right under the choice. "Plan holders" and
            "Moderators" are the two an operator can read the wrong way round,
            and the cost of that is a paid room standing open. */}
        <p className="text-muted-foreground text-sm">
          {t(`levelHint_${level}`)}
        </p>
      </div>

      {level === "plan" && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t("fieldPlans")}</legend>
          {plans.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noPlans")}</p>
          ) : (
            plans.map((plan) => (
              <label
                key={plan.key}
                className="flex items-start gap-2 text-sm"
                htmlFor={`plan-${plan.key}`}
              >
                <Checkbox
                  id={`plan-${plan.key}`}
                  name="planKeys"
                  value={plan.key}
                  checked={planKeys.includes(plan.key)}
                  onCheckedChange={(checked) =>
                    setPlanKeys((current) =>
                      checked
                        ? [...current, plan.key]
                        : current.filter((key) => key !== plan.key),
                    )
                  }
                />
                <span>
                  {plan.name}{" "}
                  <code className="text-muted-foreground">{plan.key}</code>
                </span>
              </label>
            ))
          )}
        </fieldset>
      )}
    </div>
  );
}

export function CreateGroupDialog({ plans }: { plans: PlanOption[] }) {
  const t = useTranslations("communityAdmin");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createGroupAction, EMPTY);
  const { onSubmit, pending } = useDialogSubmit(action);

  useActionToast(state);
  // Close after creating; leave open on error — and, thanks to
  // `useDialogSubmit`, with everything the operator typed still on screen.
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
        {/* `key` on the form remounts `GroupFields` on every open/close cycle,
            which is what clears its state — a cancelled room must not reappear
            half-typed the next time the dialog opens. Within one open dialog
            the state survives, which is the point: a refusal leaves everything
            the operator typed on screen. */}
        <form onSubmit={onSubmit} key={open ? "open" : "closed"}>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <GroupFields plans={plans} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {t("createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditGroupDialog({
  group,
  plans,
  onClose,
}: {
  group: GroupRow | null;
  plans: PlanOption[];
  onClose: () => void;
}) {
  const t = useTranslations("communityAdmin");
  const tCommon = useTranslations("common");
  const [state, action] = useActionState(updateGroupAction, EMPTY);
  const { onSubmit, pending } = useDialogSubmit(action);

  useActionToast(state);
  useEffect(() => {
    if (state.ok) onClose();
    // `onClose` is a fresh closure on every render of the table; depending on
    // it would fire this effect constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={group !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {group && (
          <form onSubmit={onSubmit} key={group.id}>
            <input type="hidden" name="id" value={group.id} />
            <DialogHeader>
              <DialogTitle>{t("editTitle")}</DialogTitle>
              <DialogDescription>{group.name}</DialogDescription>
            </DialogHeader>
            <GroupFields plans={plans} group={group} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {tCommon("cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who looks after this room.
 *
 * The candidate list holds the accounts with the moderator role and nobody
 * else — the operator is deliberately absent and never gets a duty row: they
 * moderate everywhere by role, so an empty list here means "the operator looks
 * after it", never "nobody does". Somebody without the role is refused by the
 * server (`communityNotModerator`) with a sentence saying where to change it.
 */
function ModeratorsDialog({
  group,
  candidates,
  onClose,
}: {
  group: GroupRow | null;
  candidates: Array<{
    memberId: string;
    accountName: string | null;
    profileName: string | null;
  }>;
  onClose: () => void;
}) {
  const t = useTranslations("communityAdmin");
  const tCommunity = useTranslations("community");
  const tCommon = useTranslations("common");
  const [assignState, assign, assigning] = useActionState(
    assignModeratorAction,
    EMPTY,
  );
  const [removeState, remove, removing] = useActionState(
    removeModeratorAction,
    EMPTY,
  );

  useActionToast(assignState);
  useActionToast(removeState);

  const placeholderLabel = tCommunity("memberPlaceholder");
  const assigned = new Set(group?.moderators.map((m) => m.memberId) ?? []);
  const free = candidates.filter((c) => !assigned.has(c.memberId));

  return (
    <Dialog open={group !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("moderatorsTitle")}</DialogTitle>
          <DialogDescription>
            {t("moderatorsDescription", { name: group?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {group && (
          <div className="grid gap-4 py-2">
            {group.moderators.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("moderatorsNone")}
              </p>
            ) : (
              <ul className="grid gap-2">
                {group.moderators.map((moderator) => (
                  <li
                    key={moderator.memberId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-sm">
                      {displayNameFor({
                        profileName: moderator.profileName,
                        accountName: moderator.accountName,
                        memberId: moderator.memberId,
                        placeholderLabel,
                      })}
                    </span>
                    <form action={remove}>
                      <input type="hidden" name="groupId" value={group.id} />
                      <input
                        type="hidden"
                        name="memberId"
                        value={moderator.memberId}
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={removing}
                      >
                        <UserMinus aria-hidden />
                        {t("moderatorRemove")}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {/* Two different situations, and one sentence for both was wrong:
                "no account holds the Moderator role" is a lie once the app's
                one moderator has been assigned to this room. The first case
                sends the operator to the users page; the second is simply
                nothing left to add. */}
            {free.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {candidates.length === 0
                  ? t("moderatorsNoCandidates")
                  : t("moderatorsAllAssigned")}
              </p>
            ) : (
              <form action={assign} className="grid gap-2">
                <input type="hidden" name="groupId" value={group.id} />
                <Label htmlFor="memberId">{t("moderatorAdd")}</Label>
                <div className="flex gap-2">
                  <Select name="memberId" defaultValue={free[0].memberId}>
                    <SelectTrigger id="memberId" className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {free.map((candidate) => (
                        <SelectItem
                          key={candidate.memberId}
                          value={candidate.memberId}
                        >
                          {displayNameFor({
                            profileName: candidate.profileName,
                            accountName: candidate.accountName,
                            memberId: candidate.memberId,
                            placeholderLabel,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={assigning}>
                    {t("save")}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupTable({
  groups,
  plans,
  candidates,
}: {
  groups: GroupRow[];
  plans: PlanOption[];
  candidates: Array<{
    memberId: string;
    accountName: string | null;
    profileName: string | null;
  }>;
}) {
  const t = useTranslations("communityAdmin");
  const tCommunity = useTranslations("community");
  const tCommon = useTranslations("common");

  // ⚠️ **Ids in state, rows looked up from the props.** Holding the row object
  // itself is the obvious version and it goes stale: assigning a moderator
  // revalidates the page, the TABLE updates, and the open dialog keeps
  // rendering the snapshot it captured when it opened — so the operator adds
  // somebody and is told "nobody assigned". Looking the row up on every render
  // means the dialog shows whatever the server last said, always.
  const [editId, setEditId] = useState<string | null>(null);
  const [moderateId, setModerateId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const byId = (id: string | null) => groups.find((group) => group.id === id) ?? null;
  const toEdit = byId(editId);
  const toModerate = byId(moderateId);
  const toArchive = byId(archiveId);

  const [archiveState, archiveAction] = useActionState(
    setGroupArchivedAction,
    EMPTY,
  );
  const [reorderState, reorderAction] = useActionState(
    reorderGroupsAction,
    EMPTY,
  );
  const [isPending, startAction] = useTransition();

  useActionToast(archiveState);
  useActionToast(reorderState);

  useEffect(() => {
    if (archiveState.ok) setArchiveId(null);
  }, [archiveState]);

  const placeholderLabel = tCommunity("memberPlaceholder");

  /**
   * Move a room one place.
   *
   * The whole ordered list is submitted, not "swap these two" — a position
   * rewrite is idempotent, so a double click or two operators on the same page
   * cannot leave the list half-swapped.
   */
  function move(index: number, delta: number) {
    const ordered = groups.map((group) => group.id);
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];

    const formData = new FormData();
    for (const id of ordered) formData.append("orderedIds", id);
    startAction(() => reorderAction(formData));
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={t("emptyTitle")}
        description={t("emptyBody")}
      />
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>{t("columnGroup")}</TableHead>
              <TableHead>{t("columnAccess")}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t("columnModerators")}
              </TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">{tCommon("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group, index) => {
              const archived = group.archivedAt !== null;
              return (
                <TableRow key={group.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span
                        className={cn(
                          "font-medium",
                          archived && "text-muted-foreground line-through",
                        )}
                      >
                        {group.name}
                      </span>
                      {group.description && (
                        <span className="text-muted-foreground text-sm">
                          {group.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={LEVEL_VARIANT[group.accessLevel]}>
                        {t(`level_${group.accessLevel}`)}
                      </Badge>
                      {group.accessLevel === "plan" &&
                        group.planKeys.map((key) => (
                          <Badge key={key} variant="outline">
                            <code>{key}</code>
                          </Badge>
                        ))}
                      {archived && (
                        <Badge variant="outline">
                          <Archive aria-hidden />
                          {t("statusArchived")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">
                    {group.moderators.length === 0
                      ? t("moderatorsNoneShort")
                      : group.moderators
                          .map((moderator) =>
                            displayNameFor({
                              profileName: moderator.profileName,
                              accountName: moderator.accountName,
                              memberId: moderator.memberId,
                              placeholderLabel,
                            }),
                          )
                          .join(", ")}
                  </TableCell>
                  <TableCell className="text-right">
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
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setEditId(group.id)}>
                          <Pencil aria-hidden />
                          {t("edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setModerateId(group.id)}>
                          <ShieldCheck aria-hidden />
                          {t("manageModerators")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === 0}
                          onSelect={() => move(index, -1)}
                        >
                          <ChevronUp aria-hidden />
                          {t("moveUp")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === groups.length - 1}
                          onSelect={() => move(index, 1)}
                        >
                          <ChevronDown aria-hidden />
                          {t("moveDown")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {archived ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              const formData = new FormData();
                              formData.set("id", group.id);
                              formData.set("archived", "false");
                              startAction(() => archiveAction(formData));
                            }}
                          >
                            <ArchiveRestore aria-hidden />
                            {t("restore")}
                          </DropdownMenuItem>
                        ) : (
                          /* Archiving hides a room from every member surface,
                             so it asks first and names the room while doing
                             it — the house rule for anything that takes
                             something away. */
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setArchiveId(group.id)}
                          >
                            <Archive aria-hidden />
                            {t("archive")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground mt-4 text-sm">
        {t("hintRowsDoNotTravel")}
      </p>

      <EditGroupDialog
        group={toEdit}
        plans={plans}
        onClose={() => setEditId(null)}
      />
      <ModeratorsDialog
        group={toModerate}
        candidates={candidates}
        onClose={() => setModerateId(null)}
      />

      <AlertDialog
        open={toArchive !== null}
        onOpenChange={(next) => !next && setArchiveId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("archiveConfirm", { name: toArchive?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!toArchive) return;
                const formData = new FormData();
                formData.set("id", toArchive.id);
                formData.set("archived", "true");
                startAction(() => archiveAction(formData));
              }}
            >
              {t("archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
