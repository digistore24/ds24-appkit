"use client";

// The member's own data-protection controls: what they agreed to, a copy of
// everything held about them, and the way out.
//
// These are rights, not settings — Art. 7(3), Art. 15/20 and Art. 17 GDPR — and
// the difference shows in one place: none of them may be harder to use than the
// thing they undo. Withdrawing is a button next to the one that agreed;
// downloading is one click; deleting is behind a confirmation that explains
// itself and nothing more.
//
// Why they are at the bottom of the account page: somebody opens it to see what
// they have. The exit is findable, not prominent — and never absent, which is
// the state that turns a right into a support ticket.
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Download, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MODULE_ACCOUNT_NOTES } from "@/lib/modules/account-notes-registry";
import { useActionToast } from "@/hooks/use-action-toast";
import { answerConsentAction } from "@/app/consent-actions";
import { deleteOwnAccountAction } from "./actions";

const EMPTY = { error: null, ok: null };

/** One purpose as the page renders it — already translated on the server. */
export interface ConsentRow {
  key: string;
  title: string;
  /** `"granted" | "refused" | "unasked" | "stale"` from lib/consent/rules.ts. */
  state: string;
  /** Formatted on the server; the browser's idea of a date is not the app's. */
  answeredAt: string | null;
}

/**
 * What this member agreed to, with a way to change every answer.
 *
 * Renders nothing when the app declares no purposes — the shipped state. An
 * empty "Consents" card would be a heading over a blank area, and worse, it
 * would suggest the app collects consents it does not.
 */
export function ConsentCard({ rows }: { rows: ConsentRow[] }) {
  const t = useTranslations("consent");
  const [state, action, busy] = useActionState(answerConsentAction, EMPTY);
  useActionToast(state);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck aria-hidden className="text-muted-foreground size-4" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>

        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{row.title}</span>
                <span className="text-muted-foreground text-xs">
                  {t(
                    row.state === "granted"
                      ? "stateGranted"
                      : row.state === "refused"
                        ? "stateRefused"
                        : row.state === "stale"
                          ? "stateStale"
                          : "stateUnasked",
                  )}
                  {row.answeredAt ? ` — ${t("answeredAt", { date: row.answeredAt })}` : ""}
                </span>
                {/* A yes to wording that has since changed is not a yes. Saying
                    so here is the difference between a member who knows they
                    have to decide again and one who believes they already did. */}
                {row.state === "stale" && (
                  <span className="text-muted-foreground text-xs">{t("staleHint")}</span>
                )}
              </div>

              {/* Withdrawing is the same shape of control as agreeing, on the
                  same row — Art. 7(3) asks that it be as easy, and "as easy"
                  is a design claim somebody has to be able to check by looking. */}
              <form action={action} className="shrink-0">
                <input type="hidden" name="purpose" value={row.key} />
                <input
                  type="hidden"
                  name="granted"
                  value={row.state === "granted" ? "false" : "true"}
                />
                <Button type="submit" variant="outline" size="sm" disabled={busy}>
                  {row.state === "granted" ? t("withdraw") : t("grant")}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * A copy of everything held about this person — Art. 15 and Art. 20.
 *
 * A plain link, not a form: the route answers with a file
 * (`app/api/account/export/route.ts`), and `download` lets the browser save it
 * without a round trip through React. There is nothing to configure and nothing
 * to choose, which is the point — a right with a form in front of it is a right
 * with a form in front of it.
 */
export function MyDataCard() {
  const t = useTranslations("privacy");

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Download aria-hidden className="text-muted-foreground size-4" />
            {t("exportTitle")}
          </CardTitle>
          <CardDescription>{t("exportBody")}</CardDescription>
        </div>

        <Button asChild variant="outline" size="sm">
          <a href="/api/account/export" download>
            <Download aria-hidden />
            {t("exportCta")}
          </a>
        </Button>

        <div className="text-muted-foreground flex flex-col gap-1 text-xs">
          <p>{t("exportHint")}</p>
          <ModuleNotes which="export" />
          <p>{t("exportExcluded")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The sentences an installed module adds to one of these two cards.
 *
 * 🚨 **Read with a ROOT translator, and the key is fully qualified.** A module
 * owns its own namespace (`community.…`, `apiKeys.…`), so a namespaced
 * `useTranslations("privacy")` cannot reach it — and giving the core a
 * `privacy.community…` key is the coupling this whole seam removes.
 *
 * One paragraph per module, never a merged sentence: the texts are written
 * independently, in two languages, by whoever built the module, and a comma
 * splice across two of them reads as a translation bug in whichever language
 * somebody was not looking at.
 *
 * With no module installed this renders nothing at all — the shipped state, and
 * the reason the core's own sentences had to stop enumerating other people's
 * data first.
 */
function ModuleNotes({ which }: { which: "export" | "deletion" }) {
  const t = useTranslations();
  if (MODULE_ACCOUNT_NOTES.length === 0) return null;
  return (
    <>
      {MODULE_ACCOUNT_NOTES.map((note) => (
        <p key={note.module}>{t(note[which])}</p>
      ))}
    </>
  );
}

/**
 * The way out — Art. 17.
 *
 * ── The dialog says what SURVIVES, and that is the whole design ───────────
 * "Delete my account" reads as "delete everything about me", and in this app it
 * is not: orders and the AI-usage record stay, with the member link removed,
 * because they are accounting records German law requires to be kept (§ 147 AO,
 * § 257 HGB) and Art. 17(3)(b) exempts from erasure while that runs.
 *
 * A person who pressed this believing otherwise was not informed. So the text
 * names both halves — what goes and what stays — before the button, not in a
 * privacy policy they would have to go and find.
 *
 * ── A running subscription warns, it does not block ───────────────────────
 * Billing continues at Digistore24 with no account behind it, which is a real
 * problem and worth saying loudly. It is not a reason to refuse: withholding
 * erasure until the customer has tidied up would be the violation.
 */
export function DeleteAccountCard({
  hasActivePlan,
  isLastOwner,
}: {
  hasActivePlan: boolean;
  isLastOwner: boolean;
}) {
  const t = useTranslations("privacy");
  const tCommon = useTranslations("common");
  const [state, action, busy] = useActionState(deleteOwnAccountAction, EMPTY);
  useActionToast(state);

  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col items-start gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 aria-hidden className="text-muted-foreground size-4" />
            {t("deleteTitle")}
          </CardTitle>
          <CardDescription>{t("deleteBody")}</CardDescription>
        </div>

        {/* Not a disabled button with no explanation: the refusal is temporary
            and in their own hands (promote somebody, then leave), and a button
            that does nothing without saying why is the worst of both. */}
        {isLastOwner ? (
          <Callout variant="warning" title={t("deleteLastOwnerTitle")}>
            {t("deleteLastOwnerBody")}
          </Callout>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={busy}>
                <Trash2 aria-hidden />
                {t("deleteCta")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("deleteConfirmBody")}</AlertDialogDescription>
              </AlertDialogHeader>

              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="font-medium">{t("deleteGoesTitle")}</p>
                  <div className="text-muted-foreground flex flex-col gap-1">
                    <p>{t("deleteGoesBody")}</p>
                    <ModuleNotes which="deletion" />
                  </div>
                </div>
                <div>
                  <p className="font-medium">{t("deleteStaysTitle")}</p>
                  <p className="text-muted-foreground">{t("deleteStaysBody")}</p>
                </div>
                {hasActivePlan && (
                  <Callout variant="warning" title={t("deleteSubscriptionTitle")}>
                    {t("deleteSubscriptionBody")}
                  </Callout>
                )}
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <form action={action}>
                  <AlertDialogAction type="submit" variant="destructive">
                    {t("deleteConfirmCta")}
                  </AlertDialogAction>
                </form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}
