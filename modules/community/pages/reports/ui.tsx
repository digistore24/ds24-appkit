// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The queue's one control: this report has been looked at.
//
// ⚠️ **Consuming is what lifts the automatic send-block** (AD-64). The block is
// derived from UNCONSUMED reports, so a moderator deciding a report was noise
// takes it out of the derivation by pressing this — there is no separate block
// state to clear, and nothing that could fall out of step with it.

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";

import { useActionToast } from "@/hooks/use-action-toast";
import { Button } from "@/components/ui/button";

import type { ActionState } from "../actions";
import { consumeReportAction, liftBlockAction } from "./actions";

const EMPTY: ActionState = { error: null, ok: null };

export function ConsumeReportButton({
  reportId,
  conflicted = false,
}: {
  reportId: string;
  /**
   * Is this moderator conflicted on this report? Cosmetics — `consumeReport()`
   * re-decides it on the server from the database, the same way the lift does.
   * Shown so a conflicted moderator meets the rule rather than an error.
   */
  conflicted?: boolean;
}) {
  const t = useTranslations("community");
  const [state, action] = useActionState(consumeReportAction, EMPTY);
  const [pending, start] = useTransition();

  useActionToast(state);

  if (conflicted) {
    return (
      <p className="text-muted-foreground text-sm">{t("reportConflict")}</p>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set("reportId", reportId);
        start(() => action(formData));
      }}
    >
      <Check aria-hidden />
      {t("reportConsume")}
    </Button>
  );
}

/**
 * Lift a standing automatic block.
 *
 * Disabled for a moderator who is among the counted reporters — and the server
 * refuses too, from the same core decision, so the disabled state is a
 * courtesy rather than the guard.
 */
export function LiftBlockButton({
  memberId,
  conflicted,
}: {
  memberId: string;
  conflicted: boolean;
}) {
  const t = useTranslations("community");
  const [state, action] = useActionState(liftBlockAction, EMPTY);
  const [pending, start] = useTransition();

  useActionToast(state);

  if (conflicted) {
    return (
      <p className="text-muted-foreground text-sm">{t("blockConflict")}</p>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set("memberId", memberId);
        start(() => action(formData));
      }}
    >
      {t("blockLift")}
    </Button>
  );
}
