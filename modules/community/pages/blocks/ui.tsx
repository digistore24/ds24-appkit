// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The three lists, as a control.
//
// 🚨 **ONE component, rendered in two places** — the review list here and the
// operator's rooms screen — because "an operator can do this in both places"
// was the requirement and two components would be two answers to one question.
// A second copy would drift the moment one of them grew a fourth list, a
// different confirmation or a different reason field, and the drift would be
// invisible: both would keep compiling and both would keep posting to the same
// action.
//
// ⚠️ **Nothing here decides anything.** The buttons are absent for a moderator
// and the server refuses them anyway (`requireOwner()` inside the action); the
// conflict between "protected" and "write-blocked" is refused by
// `standingProblem()` on the server, not prevented by disabling a button here.
// A hidden control is not a permission.

import * as React from "react";
import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { EyeOff, PenOff, ShieldCheck } from "lucide-react";

import { useActionToast } from "@/hooks/use-action-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MAX_MODERATION_REASON_LENGTH } from "@/modules/community/lib/rules";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";

import { setStandingAction } from "@/modules/community/admin/actions";

/** The three lists a member can be on, or `null` for somebody on none. */
export interface Standing {
  protected: boolean;
  writeBlocked: boolean;
  reportsIgnored: boolean;
}

const FIELDS = [
  { field: "protected", icon: ShieldCheck },
  { field: "writeBlocked", icon: PenOff },
  { field: "reportsIgnored", icon: EyeOff },
] as const;

/**
 * One list, one button, one reason.
 *
 * The desired VALUE travels in the form rather than being a toggle the server
 * infers: two operators pressing the same row would otherwise cancel each other
 * out, and the most recently expressed wish is the one that should win. The
 * `setBlockedAction` idiom, borrowed from the core's user administration.
 */
function ListButton({
  memberId,
  field,
  on,
  Icon,
}: {
  memberId: string;
  field: (typeof FIELDS)[number]["field"];
  on: boolean;
  Icon: (typeof FIELDS)[number]["icon"];
}) {
  const t = useTranslations("community");
  const [state, action] = useActionState(setStandingAction, EMPTY_ACTION_STATE);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  useActionToast(state);

  // A refusal keeps the dialog open with what was typed still in it — the
  // reason is prose somebody wrote, and losing it to a validation error is the
  // one thing that makes an operator stop writing reasons.
  React.useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setReason("");
    }
  }, [state.ok]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={on ? "secondary" : "outline"} size="sm">
          <Icon aria-hidden="true" />
          {t(on ? `list_${field}_off` : `list_${field}_on`)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(on ? `list_${field}_offTitle` : `list_${field}_onTitle`)}
          </DialogTitle>
          <DialogDescription>
            {t(on ? `list_${field}_offBody` : `list_${field}_onBody`)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor={`reason-${field}-${memberId}`}>
            {t("listReasonLabel")}
          </Label>
          <Textarea
            id={`reason-${field}-${memberId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MAX_MODERATION_REASON_LENGTH}
            placeholder={t("listReasonPlaceholder")}
          />
          {/* 🚨 The reason is the member's personal data: it travels in both
              exports and is emptied when they delete their account, exactly
              like a removal reason. Said here, before it is written, for the
              same reason the removal dialog says it. */}
          <p className="text-muted-foreground text-sm">{t("listReasonNote")}</p>
        </div>

        <DialogFooter>
          <Button
            disabled={pending || reason.trim() === ""}
            onClick={() => {
              const formData = new FormData();
              formData.set("memberId", memberId);
              formData.set("field", field);
              formData.set("value", on ? "false" : "true");
              formData.set("reason", reason);
              start(() => action(formData));
            }}
          >
            {t("listConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * All three lists for one member.
 *
 * `standing === null` means "not on any list" — the state of somebody who has
 * no row, which is most people. The same shape the table stores, so there is
 * no third state to explain.
 */
export function StandingControls({
  memberId,
  standing,
}: {
  memberId: string;
  standing: Standing | null;
}) {
  const current: Standing = standing ?? {
    protected: false,
    writeBlocked: false,
    reportsIgnored: false,
  };

  return (
    <>
      {FIELDS.map(({ field, icon }) => (
        <ListButton
          key={field}
          memberId={memberId}
          field={field}
          on={current[field]}
          Icon={icon}
        />
      ))}
    </>
  );
}
