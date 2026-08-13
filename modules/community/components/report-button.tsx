// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// *Report as spam* — one component, on every post and every private message.
//
// ⚠️ **Not an `<AlertDialog>`.** Reporting is not destructive: nothing of the
// member's own disappears, and the house rule about confirming destructive
// actions is about deletions. What the dialog exists for is the optional
// reason — and, on a private message, one sentence of honesty.
//
// 🚨 **The DM variant says that anonymity cannot be delivered.** In a
// conversation with exactly two people, the reported member can work out who
// reported them by elimination. The module does not pretend otherwise: it says
// so at the moment somebody is deciding whether to report, which is the only
// moment the sentence is worth anything.

import * as React from "react";
import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";

import { useActionToast } from "@/hooks/use-action-toast";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
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

import type { ActionState } from "@/modules/community/pages/actions";
import { reportAction } from "@/modules/community/pages/reports/actions";

const EMPTY: ActionState = { error: null, ok: null };

export function ReportButton({
  postId,
  messageId,
  siblings = [],
  attachmentMax = 5,
}: {
  /** Exactly one of the two — the table's check constraint, in the props. */
  postId?: string;
  messageId?: string;
  /**
   * Other messages in the SAME conversation, offered as context.
   *
   * ⚠️ Only ever the reporter's own conversation, and only ever the ones
   * already on their screen. The server re-checks every id against the
   * reported message's conversation and drops anything else, so this list is
   * a convenience and never a permission.
   */
  siblings?: Array<{ id: string; preview: string }>;
  attachmentMax?: number;
}) {
  const t = useTranslations("community");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(reportAction, EMPTY);
  const [pending, start] = useTransition();

  useActionToast(state);

  const isMessage = messageId !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closes on its own once the report landed — the toast is the
        // feedback, and a dialog left open invites a second tap that the
        // unique index would absorb silently.
        if (!next) return;
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("report")}>
          <Flag aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          key={open ? "open" : "closed"}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            start(() => {
              action(formData);
              setOpen(false);
            });
          }}
        >
          {isMessage ? (
            <input type="hidden" name="messageId" value={messageId} />
          ) : (
            <input type="hidden" name="postId" value={postId} />
          )}
          <DialogHeader>
            <DialogTitle>{t("reportTitle")}</DialogTitle>
            <DialogDescription>
              {isMessage ? t("reportDmDescription") : t("reportDescription")}
            </DialogDescription>
          </DialogHeader>

          {isMessage && (
            <Callout variant="warning" title={t("reportTitle")} className="mt-2">
              <p>{t("reportDmHonesty")}</p>
            </Callout>
          )}

          {isMessage && siblings.length > 0 && (
            <div className="grid gap-2 py-4">
              <Label>{t("reportAttachTitle")}</Label>
              <p className="text-muted-foreground text-xs">
                {t("reportAttachHint", { max: attachmentMax })}
              </p>
              <ul className="grid max-h-48 gap-1 overflow-y-auto">
                {siblings.map((sibling) => (
                  <li key={sibling.id} className="flex items-start gap-2">
                    {/* The kit's <Checkbox>, and it still posts a REPEATED field
                        name — `reports/actions.ts` reads `formData.getAll(
                        "attached")` and gets its list, because Radix renders its
                        own bubble input inside the form.

                        ⚠️ It was a native <input> until 2026-08-13, on the
                        argument that a repeated name is a native form's own
                        mechanism. That argument is about a form which must work
                        WITHOUT JavaScript, and this one cannot: it lives in a
                        Radix <Dialog> that only JavaScript opens, and its
                        onSubmit calls preventDefault(). So the exception never
                        applied here, and the kit's focus ring, dark mode and
                        keyboard behaviour were being given up for nothing. */}
                    <Checkbox
                      id={`attach-${sibling.id}`}
                      name="attached"
                      value={sibling.id}
                      className="mt-1"
                    />
                    <label
                      htmlFor={`attach-${sibling.id}`}
                      className="text-muted-foreground line-clamp-2 text-xs"
                    >
                      {sibling.preview}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-2 py-4">
            <Label htmlFor="reportReason">{t("reportReasonLabel")}</Label>
            {/* Optional, and it says so: demanding a sentence would cost the
                taps that make a spam loop work at all. */}
            <Textarea
              id="reportReason"
              name="reason"
              rows={3}
              maxLength={MAX_MODERATION_REASON_LENGTH}
              placeholder={t("reportReasonPlaceholder")}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {t("reportSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
