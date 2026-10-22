// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The consent dialog.
//
// Ships unused: `config/consent.json` declares no purposes, so nothing renders
// this. It exists so that the moment an app DOES need a consent, the shape is
// already decided — because the shape is where consent dialogs go wrong, and
// they go wrong in the same three ways every time.
//
// ── The three rules this component encodes ─────────────────────────────────
//
//  1. **Refusing is exactly as easy as agreeing.** Two buttons, side by side,
//     the same size, neither of them ghosted into the background. Art. 7(1)
//     and (4) GDPR ask whether consent was "freely given", and a grey
//     "decline" link next to a large coloured "accept" is the standard
//     illustration of it not being. That is why neither button is
//     `variant="default"` against a `variant="ghost"` — they are both real.
//
//  2. **Closing the dialog is not agreement.** It records nothing at all. The
//     person is asked again next time, which is mildly annoying and is the
//     correct trade: the alternative is a dialog where the escape key grants
//     permission.
//
//  3. **A refusal is recorded.** It stops the asking (`needsAsking` in
//     `lib/consent/rules.ts`), and it is the evidence that "no" was honoured.
//
// ── What this is NOT ──────────────────────────────────────────────────────
// A cookie banner. This asks a SIGNED-IN member about a named purpose. Consent
// for device access by an anonymous visitor (§ 25 TDDDG) is a different
// mechanism with a different store — it cannot be a row against a member who
// does not exist yet. `docs/compliance.md` §2 explains the split.
//
// And note the shipped answer to "do I need one of those?": no. This app sets
// three cookies, all strictly necessary or set by the user's own click. A
// banner where nothing is tracked is a defect, not caution.
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActionToast } from "@/hooks/use-action-toast";
import { afterOk } from "@/hooks/after-ok";
import { answerConsentAction } from "@/app/consent-actions";

const EMPTY = { error: null, ok: null };

/** A purpose still waiting for an answer from this member. */
export interface PendingConsent {
  key: string;
  /**
   * The heading and the explanation, already translated.
   *
   * Passed in rather than looked up here, because the keys are per-app:
   * `consent.<key>.title` and `consent.<key>.body` in `messages/*.json`, and
   * only the app that declared the purpose knows they exist. A client component
   * calling `t(key)` on a key that was never added renders the key itself at a
   * customer.
   */
  title: string;
  body: string;
}

export function ConsentDialog({ pending }: { pending: PendingConsent[] }) {
  const t = useTranslations("consent");

  const [answered, setAnswered] = useState<string[]>([]);
  // Take the answered one off the queue so the next question appears. The
  // server revalidates too, but the dialog is open in front of the page and
  // would otherwise re-ask the same thing until the route refreshes.
  const [state, action, busy] = useActionState(
    afterOk(answerConsentAction, () =>
      setAnswered((current) => [...current, current.length.toString()]),
    ),
    EMPTY,
  );
  useActionToast(state);

  const queue = pending.slice(answered.length);
  const current = queue[0];

  // Nothing to ask. The shipped state, and the state of any app whose members
  // have all answered.
  if (!current) return null;

  return (
    <Dialog open>
      <DialogContent
        // No close button and no dismissal by clicking away — but see rule 2:
        // this is not a trap, it is the removal of the AMBIGUOUS exit. There is
        // no way out of this dialog that is not a recorded answer, which is the
        // opposite of a banner you can escape into consent.
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>

        {queue.length > 1 && (
          <p className="text-muted-foreground text-xs">
            {t("remaining", { count: queue.length })}
          </p>
        )}

        {/* Both buttons submit the same action with a different value, so the
            refusal travels the same path as the agreement and cannot quietly
            become a no-op. */}
        <DialogFooter className="sm:justify-between">
          <form action={action} className="contents">
            <input type="hidden" name="purpose" value={current.key} />
            <Button
              type="submit"
              name="granted"
              value="false"
              variant="outline"
              disabled={busy}
              className="w-full sm:w-auto"
            >
              {t("decline")}
            </Button>
            <Button
              type="submit"
              name="granted"
              value="true"
              variant="outline"
              disabled={busy}
              className="w-full sm:w-auto"
            >
              {t("accept")}
            </Button>
          </form>
        </DialogFooter>

        <p className="text-muted-foreground text-xs">{t("withdrawHint")}</p>
      </DialogContent>
    </Dialog>
  );
}
