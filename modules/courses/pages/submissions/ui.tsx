// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The writing half of the answering surface.
//
// The decisions are not here. Every refusal lives in `../../rules.ts` and is
// enforced in `../../admin/submission-actions.ts`; this file shows what is
// possible and reports what came back. A disabled button is not a permission —
// the action re-asks the switch and `requireOwner()` per request, and refuses an
// empty reply itself.
//
// 🚨 **It asks before it writes, both times, and the two questions differ.**
// Sending the first reply FREEZES the member's hand-in — they can no longer
// revise their text — and rewriting one is irreversible, because there is no
// version history and there is not to be one (a history of what a coach wrote
// ABOUT a member is a second body of member-adjacent prose with its own
// retention question). Both dialogs name the learner and the lesson rather than
// asking "are you sure?" (`CLAUDE.md` → UI, rule 2).
//
// The form carries a SUBMISSION id, never a member id — the row is addressed by
// its own id and the account it belongs to is never named by the request.
//
// Feedback is `useActionState` + `useActionToast(state)`, the mechanism
// `app/dashboard/admin/users/ui.tsx` established. Nothing here ends silently.

import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { replyToSubmissionAction } from "../../admin/submission-actions";

const EMPTY = { error: null, ok: null };

export function ReplyForm({
  submissionId,
  defaultValue,
  maxChars,
  learner,
  lesson,
  rewriting,
}: {
  submissionId: string;
  defaultValue: string;
  maxChars: number;
  learner: string;
  lesson: string;
  /** Is there already a reply? Decides the wording and the question asked. */
  rewriting: boolean;
}) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const [state, send] = useActionState(replyToSubmissionAction, EMPTY);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState(defaultValue);
  // Its own transition: `useActionState`'s dispatch called bare logs "An async
  // function with useActionState was called outside of a transition" and the
  // pending flag never moves — the same reason `../../admin/ui.tsx` has one.
  const [pending, startSending] = useTransition();

  useActionToast(state);

  // Close the dialog once the write has SUCCEEDED, never on the click. A
  // refusal is the thing worth reading, and a dialog that vanished with it
  // would leave the toast explaining a screen that had already changed.
  useEffect(() => {
    if (state.ok) setAsking(false);
  }, [state]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="reply">{t("submissionReplyLabel")}</Label>
        <Textarea
          id="reply"
          name="reply"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          {t("submissionReplyHint", { max: maxChars })}
        </p>
      </div>

      <div>
        <Button type="button" onClick={() => setAsking(true)} disabled={pending}>
          {rewriting ? t("submissionReplyRewrite") : t("submissionReplySend")}
        </Button>
      </div>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {rewriting
                ? t("submissionRewriteTitle", { learner, lesson })
                : t("submissionSendTitle", { learner, lesson })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {rewriting ? t("submissionRewriteBody") : t("submissionSendBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              // 🚨 Red for the REWRITE and not for the first reply, and the
              // difference is real rather than decorative. Sending an answer is
              // what this surface is for; replacing one destroys a text with no
              // version history behind it, and `CLAUDE.md` → UI, rule 2 asks for
              // the destructive variant exactly there. Measured in the browser:
              // both dialogs looked identical in the accent colour, which made
              // the irreversible one read as routine.
              variant={rewriting ? "destructive" : undefined}
              disabled={pending}
              onClick={(event) => {
                // Never closes by itself — see the effect above.
                event.preventDefault();
                const formData = new FormData();
                formData.set("submissionId", submissionId);
                formData.set("reply", text);
                startSending(() => send(formData));
              }}
            >
              {pending
                ? tCommon("loading")
                : rewriting
                  ? t("submissionRewriteConfirm")
                  : t("submissionSendConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
