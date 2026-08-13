// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The writing half of the course's admin surface.
//
// The decisions are not here. Every refusal lives in `../rules.ts` and is
// enforced in `./actions.ts`; this file only shows what is possible and reports
// what came back. That split is why a hidden menu is never a permission:
//
// 🚨 **A `content` row gets no edit and no delete entry — AND the server refuses
// it anyway.** Both, never one. The menu is what stops the operator making the
// mistake; the action is what makes the mistake impossible, including for a
// request that never went past this file.
//
// ⚠️ **`releaseAfterDays` is rendered CONDITIONALLY, never disabled.** Outside a
// drip course the field is not in the DOM at all, and the server does not read
// it either (`releaseDays()` in the actions). A disabled field is a setting
// somebody believes they made; an absent one is honest, and it is why there is
// deliberately no `shapeForbidsReleaseAfterDays` code.
//
// Feedback is `useActionState` + `useActionToast(state)` throughout — the
// mechanism `app/dashboard/admin/users/ui.tsx` established, and no action here
// ends silently or redirects.

import * as React from "react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ListTree, MoveVertical, Pencil, Plus, Trash2 } from "lucide-react";

import { useActionToast } from "@/hooks/use-action-toast";
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
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { mayOperatorWrite } from "../rules";
import {
  createBlockAction,
  createUnitAction,
  deleteBlockAction,
  deleteUnitAction,
  moveAction,
  updateBlockAction,
  updateUnitAction,
} from "./actions";

const EMPTY = { error: null, ok: null };

/** What the page hands over about a block. Deliberately not the DB row. */
export interface BlockRef {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  position: number;
  releaseAfterDays: number;
  origin: string;
}

/** …and about a lesson. */
export interface UnitRef {
  id: string;
  slug: string;
  title: string;
  position: number;
  origin: string;
  body: string | null;
  taskPrompt: string | null;
}

/** A labelled field with an optional hint underneath. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * The days field, and the whole of AC 5 in one line: outside a drip course this
 * component renders NOTHING, so the field is not in the form and the value
 * never reaches the server.
 */
function ReleaseField({
  shape,
  id,
  defaultValue,
}: {
  shape: string;
  id: string;
  defaultValue?: number;
}) {
  const t = useTranslations("coursesAdmin");
  if (shape !== "drip") return null;
  return (
    <Field id={id} label={t("fieldReleaseAfterDays")} hint={t("fieldReleaseAfterDaysHint")}>
      <Input
        id={id}
        name="releaseAfterDays"
        type="number"
        min={0}
        defaultValue={defaultValue ?? 0}
      />
    </Field>
  );
}

export function CreateBlockDialog({
  courseSlug,
  shape,
  nextPosition,
}: {
  /** Which course the new block joins — a hidden field, resolved by the action. */
  courseSlug: string;
  shape: string;
  nextPosition: number;
}) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createBlockAction, EMPTY);

  useActionToast(state);
  // Close on success only — a rejected slug stays in the field rather than
  // having to be typed again.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("createBlockTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{t("createBlockTitle")}</DialogTitle>
            <DialogDescription>{t("createBlockDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* 🚨 Which course the block joins. A hidden field is lawful HERE
                and not on the member surface: the actor is the operator,
                `guard()` has already answered `requireOwner()`, and they may
                write into any course they own — so the action RESOLVES this
                value rather than trusting it, and refuses when it names
                nothing. */}
            <input type="hidden" name="course" value={courseSlug} />
            <Field id="block-slug" label={t("fieldSlug")} hint={t("fieldSlugHint")}>
              <Input id="block-slug" name="slug" required autoComplete="off" />
            </Field>
            <Field id="block-title" label={t("fieldTitle")}>
              <Input id="block-title" name="title" required />
            </Field>
            <Field id="block-summary" label={`${t("fieldSummary")} (${t("fieldOptional")})`}>
              <Input id="block-summary" name="summary" />
            </Field>
            <Field id="block-position" label={t("fieldPosition")}>
              <Input
                id="block-position"
                name="position"
                type="number"
                min={0}
                defaultValue={nextPosition}
              />
            </Field>
            <ReleaseField shape={shape} id="block-release" />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("loading") : t("createBlockTrigger")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Add a lesson here" — offered under EVERY block, whatever its origin.
 *
 * ⚠️ Deliberate: this writes a lesson row and no row of the block's, so a bonus
 * lesson under a file's week one is an operator row inside a content block. The
 * next `content-apply` re-asserts the block and leaves the lesson standing.
 */
export function CreateUnitDialog({
  block,
  nextPosition,
}: {
  block: { id: string; title: string };
  nextPosition: number;
}) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createUnitAction, EMPTY);

  useActionToast(state);
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus aria-hidden />
          {t("createUnitTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="blockId" value={block.id} />
          <DialogHeader>
            <DialogTitle>{t("createUnitTitle", { block: block.title })}</DialogTitle>
            <DialogDescription>{t("createUnitDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <Field id="unit-slug" label={t("fieldSlug")} hint={t("fieldSlugHint")}>
              <Input id="unit-slug" name="slug" required autoComplete="off" />
            </Field>
            <Field id="unit-title" label={t("fieldTitle")}>
              <Input id="unit-title" name="title" required />
            </Field>
            <Field id="unit-position" label={t("fieldPosition")}>
              <Input
                id="unit-position"
                name="position"
                type="number"
                min={0}
                defaultValue={nextPosition}
              />
            </Field>
            <Field id="unit-body" label={`${t("fieldBody")} (${t("fieldOptional")})`}>
              <Textarea id="unit-body" name="body" rows={6} />
            </Field>
            <Field
              id="unit-task"
              label={t("fieldTaskPrompt")}
              hint={t("fieldTaskPromptHint")}
            >
              <Textarea id="unit-task" name="taskPrompt" rows={2} />
            </Field>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("loading") : t("createUnitTrigger")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The row menu of one block — absent entirely for a row a content file owns.
 *
 * 🚨 The test is `mayOperatorWrite()`, never `origin === "content"`: only a row
 * that says literally `operator` is this surface's. An origin nobody planned
 * for is somebody else's, which is the safe direction for a menu that writes.
 */
export function BlockMenu({ block, shape }: { block: BlockRef; shape: string }) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editState, editAction, editPending] = useActionState(updateBlockAction, EMPTY);
  const [deleteState, deleteAction] = useActionState(deleteBlockAction, EMPTY);
  // ⚠️ The confirm button calls the action OUTSIDE a form, so it has to open
  // its own transition — `useActionState`'s dispatch called bare logs
  // "An async function with useActionState was called outside of a transition"
  // and leaves `isPending` stuck. Measured in the browser; the shape is
  // `app/dashboard/admin/users/ui.tsx`'s `run()`.
  const [deletePending, startDelete] = useTransition();

  useActionToast(editState);
  useActionToast(deleteState);
  useEffect(() => {
    if (editState.ok) setEditing(false);
  }, [editState]);
  // Stays open on a refusal — that is where the sentence naming the lesson
  // count is worth reading.
  useEffect(() => {
    if (deleteState.ok) setDeleting(false);
  }, [deleteState]);

  if (!mayOperatorWrite(block.origin)) {
    return <span className="text-muted-foreground text-xs">{t("lockedHint")}</span>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tCommon("actions")}>
            <ListTree aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{block.slug}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("actionEdit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <MoveVertical aria-hidden />
            {t("actionMove")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden />
            {t("actionDelete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <form action={editAction} key={block.id}>
            <input type="hidden" name="id" value={block.id} />
            <DialogHeader>
              <DialogTitle>{t("editBlockTitle", { slug: block.slug })}</DialogTitle>
              {/* The slug is shown and never editable: it is a route segment,
                  and `courses_completions.unitSlug` is an opaque key rather
                  than a foreign key — a rename orphans every completion. */}
              <DialogDescription>{t("fieldSlugFixed")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Field id={`edit-title-${block.id}`} label={t("fieldTitle")}>
                <Input
                  id={`edit-title-${block.id}`}
                  name="title"
                  required
                  defaultValue={block.title}
                />
              </Field>
              <Field
                id={`edit-summary-${block.id}`}
                label={`${t("fieldSummary")} (${t("fieldOptional")})`}
              >
                <Input
                  id={`edit-summary-${block.id}`}
                  name="summary"
                  defaultValue={block.summary ?? ""}
                />
              </Field>
              <ReleaseField
                shape={shape}
                id={`edit-release-${block.id}`}
                defaultValue={block.releaseAfterDays}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {tCommon("cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={editPending}>
                {editPending ? tCommon("loading") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <MoveDialog
        open={moving}
        onOpenChange={setMoving}
        kind="block"
        id={block.id}
        slug={block.slug}
        position={block.position}
      />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteBlockTitle", { title: block.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBlockBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePending}
              onClick={(event) => {
                // Never closes by itself: the refusal naming the lesson count
                // is the thing worth reading, and a dialog that vanished would
                // take it with it.
                event.preventDefault();
                const formData = new FormData();
                formData.set("id", block.id);
                startDelete(() => deleteAction(formData));
              }}
            >
              {deletePending ? tCommon("loading") : t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The row menu of one lesson. Same rule, same shape. */
export function UnitMenu({ unit }: { unit: UnitRef }) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editState, editAction, editPending] = useActionState(updateUnitAction, EMPTY);
  const [deleteState, deleteAction] = useActionState(deleteUnitAction, EMPTY);
  // Same reason as in `BlockMenu` — see the comment there.
  const [deletePending, startDelete] = useTransition();

  useActionToast(editState);
  useActionToast(deleteState);
  useEffect(() => {
    if (editState.ok) setEditing(false);
  }, [editState]);
  useEffect(() => {
    if (deleteState.ok) setDeleting(false);
  }, [deleteState]);

  if (!mayOperatorWrite(unit.origin)) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tCommon("actions")}>
            <Pencil aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{unit.slug}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("actionEdit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <MoveVertical aria-hidden />
            {t("actionMove")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden />
            {t("actionDelete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <form action={editAction} key={unit.id}>
            <input type="hidden" name="id" value={unit.id} />
            <DialogHeader>
              <DialogTitle>{t("editUnitTitle", { slug: unit.slug })}</DialogTitle>
              <DialogDescription>{t("fieldSlugFixed")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Field id={`unit-edit-title-${unit.id}`} label={t("fieldTitle")}>
                <Input
                  id={`unit-edit-title-${unit.id}`}
                  name="title"
                  required
                  defaultValue={unit.title}
                />
              </Field>
              <Field
                id={`unit-edit-body-${unit.id}`}
                label={`${t("fieldBody")} (${t("fieldOptional")})`}
              >
                <Textarea
                  id={`unit-edit-body-${unit.id}`}
                  name="body"
                  rows={8}
                  defaultValue={unit.body ?? ""}
                />
              </Field>
              <Field
                id={`unit-edit-task-${unit.id}`}
                label={t("fieldTaskPrompt")}
                hint={t("fieldTaskPromptHint")}
              >
                <Textarea
                  id={`unit-edit-task-${unit.id}`}
                  name="taskPrompt"
                  rows={2}
                  defaultValue={unit.taskPrompt ?? ""}
                />
              </Field>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {tCommon("cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={editPending}>
                {editPending ? tCommon("loading") : t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <MoveDialog
        open={moving}
        onOpenChange={setMoving}
        kind="unit"
        id={unit.id}
        slug={unit.slug}
        position={unit.position}
      />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteUnitTitle", { title: unit.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteUnitBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletePending}
              onClick={(event) => {
                event.preventDefault();
                const formData = new FormData();
                formData.set("id", unit.id);
                startDelete(() => deleteAction(formData));
              }}
            >
              {deletePending ? tCommon("loading") : t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Set one row's position.
 *
 * A number, not an up/down pair: the pair's shape rewrites every row of the
 * list, which would touch `content` rows — and even where it did not, the next
 * `content-apply` would re-assert their positions and the operator's ordering
 * would vanish after a deploy with nothing said about it.
 */
function MoveDialog({
  open,
  onOpenChange,
  kind,
  id,
  slug,
  position,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "block" | "unit";
  id: string;
  slug: string;
  position: number;
}) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(moveAction, EMPTY);

  useActionToast(state);
  useEffect(() => {
    if (state.ok) onOpenChange(false);
    // `onOpenChange` is recreated on every render of the row and would fire
    // this effect on results that have not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={action} key={id}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <DialogHeader>
            <DialogTitle>{t("moveTitle", { slug })}</DialogTitle>
            <DialogDescription>{t("moveDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field id={`move-${id}`} label={t("fieldPosition")}>
              <Input
                id={`move-${id}`}
                name="position"
                type="number"
                min={0}
                defaultValue={position}
              />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("loading") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
