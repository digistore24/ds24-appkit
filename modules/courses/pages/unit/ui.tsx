"use client";
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The interactive controls on a lesson page.
//
// Every action reports back — `useActionToast` is the mechanism for a result
// that comes from a server action on the same page (`CLAUDE.md` → UI). A button
// that changes state and says nothing feels like an error.
//
// ⚠️ Neither component here receives a submission ROW. What crosses into the
// browser bundle is one string the member typed themselves; `id`, `memberId` and
// `repliedBy` stay on the server, the last of them because it is a third party's
// identity and is deliberately out of both Art. 15 exports
// (`../../privacy/sections.ts`). The states around this form are rendered by
// `./page.tsx`, which is a server component and already holds the row.
import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";

import { setCompletedAction, submitTaskAction } from "../actions";

const EMPTY: ActionState = { error: null, ok: null };

export function CompletionToggle({
  unitSlug,
  done,
  labelDone,
  labelOpen,
}: {
  unitSlug: string;
  done: boolean;
  labelDone: string;
  labelOpen: string;
}) {
  const [state, setState] = useState<ActionState>({ error: null, ok: null });
  const [pending, startTransition] = useTransition();
  useActionToast(state);

  return (
    <Button
      type="button"
      variant={done ? "outline" : "default"}
      // Disabled while it runs: this action is not idempotent in the sense that
      // matters — a double click would toggle twice and land back where it
      // started, which reads as the button not working.
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setState(await setCompletedAction(unitSlug, !done));
        })
      }
    >
      {done ? labelDone : labelOpen}
    </Button>
  );
}

/**
 * The hand-in form — shape 3's one interactive control for a member.
 *
 * Rendered while the row is still open: never handed in, or handed in and not
 * yet answered (then `defaultValue` carries the member's own text back, so
 * "revise" means revise rather than retype). An ANSWERED hand-in gets no form at
 * all, and that fork is `./page.tsx`'s — a component that could be told "you are
 * frozen" by a prop would be a second place the freeze is decided.
 *
 * Uncontrolled on purpose: `defaultValue` seeds the field once and the browser
 * owns it afterwards, so a re-render triggered by the toast cannot take away
 * what somebody is in the middle of typing.
 */
export function TaskForm({
  unitSlug,
  defaultValue,
  maxChars,
  label,
  hint,
  submitLabel,
}: {
  unitSlug: string;
  defaultValue: string;
  maxChars: number;
  label: string;
  hint: string;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(submitTaskAction, EMPTY);
  useActionToast(state);

  const fieldId = `course-task-${unitSlug}`;
  const hintId = `${fieldId}-hint`;

  return (
    <form action={action} className="flex flex-col gap-3">
      {/* The lesson, not the member — the account is the session's and this
          action reads no id out of its form. */}
      <input type="hidden" name="unitSlug" value={unitSlug} />

      <Label htmlFor={fieldId}>{label}</Label>
      <Textarea
        id={fieldId}
        name="body"
        rows={10}
        required
        // The same number the rule enforces (`MAX_SUBMISSION_CHARS`), so the
        // field cannot accept what the action would then refuse.
        maxLength={maxChars}
        defaultValue={defaultValue}
        aria-describedby={hintId}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>

      <div>
        {/* Disabled while it runs: handing in is not idempotent in the sense
            that matters — a double click sends the same text twice and the
            second one lands on a row the first has just written. */}
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
