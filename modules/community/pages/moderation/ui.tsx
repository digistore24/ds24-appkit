// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The moderator's controls, where the content is.
//
// ⚠️ **Nothing here decides anything.** Whether these appear is cosmetics on
// top of an authority the server re-reads from the database on every submit
// (AD-63) — a rendered button is not a permission, and a missing one is not a
// guard.

import * as React from "react";
import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Lock, LockOpen, ShieldX } from "lucide-react";

import { useActionToast } from "@/hooks/use-action-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { MAX_MODERATION_REASON_LENGTH } from "@/modules/community/lib/rules";

import type { ActionState } from "../actions";
import { removePostAction, setLockedAction } from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";


/**
 * Remove somebody else's post.
 *
 * A `<Dialog>` rather than an `<AlertDialog>`, and the difference is not
 * cosmetic: the reason is REQUIRED, so the confirmation has a form in it. What
 * an alert dialog buys — "are you sure" — the reason field buys better, by
 * making the moderator write the sentence they will be asked about.
 */
export function RemovePostButton({ postId }: { postId: string }) {
  const t = useTranslations("community");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(removePostAction, EMPTY_ACTION_STATE);
  const [pending, start] = useTransition();

  useActionToast(state);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldX aria-hidden />
          {t("removeByModerator")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          key={open ? "open" : "closed"}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            start(() => action(formData));
          }}
        >
          <input type="hidden" name="postId" value={postId} />
          <DialogHeader>
            <DialogTitle>{t("removeByModeratorTitle")}</DialogTitle>
            {/* Says where the reason ends up, before it is written. A
                moderator who learns afterwards that their sentence was in
                somebody's data export learns it at the worst moment. */}
            <DialogDescription>
              {t("removeByModeratorConfirm")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="reason">{t("removeReasonLabel")}</Label>
            <Textarea
              id="reason"
              name="reason"
              required
              rows={3}
              maxLength={MAX_MODERATION_REASON_LENGTH}
              placeholder={t("removeReasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {t("removeByModerator")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Close a thread, or open it again. */
export function LockDiscussionButton({
  discussionId,
  locked,
}: {
  discussionId: string;
  locked: boolean;
}) {
  const t = useTranslations("community");
  const [state, action] = useActionState(setLockedAction, EMPTY_ACTION_STATE);
  const [pending, start] = useTransition();

  useActionToast(state);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set("discussionId", discussionId);
        formData.set("locked", String(!locked));
        start(() => action(formData));
      }}
    >
      {locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
      {locked ? t("unlockDiscussion") : t("lockDiscussion")}
    </Button>
  );
}
