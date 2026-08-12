// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// A lesson's four media slots, as the operator sees them.
//
// One component instantiated four times rather than four hand-built blocks:
// the slots share three controls, one size hint and one `accept` list, and a
// copy per slot is the arrangement in which three of them are subtly different
// a year from now.
//
// **The FIELD itself is no longer this module's.** `components/ui/media-upload.tsx`
// is the core's one file input (Story 8.2) — there is no raw
// `<input type="file">` in this file any more and there is not to be another
// one anywhere — and it carries what four surfaces would otherwise each carry:
// the reset, the composed `accept`, the size refusal and — for the video slot —
// the three-step upload straight to the bucket. What
// stays here is everything the story did NOT move: the actions, the columns, the
// server-decided visibility and `mayAccess()` (`docs/visuals.md`).
//
// 🚨 **Nothing here decides anything.** The form has no visibility field and no
// plan parameter — `./media-actions.ts` sets `visibility` and `requiresPlan`
// from `courseConfig()` on BOTH routes, and a `content` row is refused by the
// server whatever this file renders. `disabled` is cosmetics; the callout beside
// it is the part that helps.
//
// ⚠️ **The size refusal is a courtesy, it lives in the component now, and it
// has two different reasons.** For the cover, subtitle and worksheet it heads
// off a refusal nobody can translate: a Server Action body is capped in
// `next.config.ts` and Next refuses while it DECODES — before the action exists.
// For the video it spares an operator a two-gigabyte upload that the confirm
// step would then throw away, because a presigned PUT cannot enforce a size.
// The server asks the same question again on both routes, because a check in a
// browser is not a check.
import { useActionState, useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";

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
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaUpload } from "@/components/ui/media-upload";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { formatBytes } from "@/lib/media/rules";

import { COURSE_SLOTS, COURSE_SLOT_IDS, mayOperatorWrite, type CourseSlotId } from "../rules";
import {
  attachCoverAction,
  attachSubtitleAction,
  attachWorksheetAction,
  confirmVideoAction,
  detachSlotAction,
  mintVideoTicketAction,
} from "./media-actions";

const EMPTY: ActionState = { error: null, ok: null };

/**
 * One slot's form action — for the three that travel THROUGH the app.
 *
 * ⚠️ **No `video` entry, and its absence is the design.** A lesson recording
 * goes straight to the bucket (`mintVideoTicketAction` / `confirmVideoAction`),
 * and a second door into the same column with a different ceiling is how one of
 * the two ends up wrong. `undefined` here is what switches the field below onto
 * the direct path.
 */
const ACTIONS: Partial<Record<CourseSlotId, (prev: ActionState, data: FormData) => Promise<ActionState>>> = {
  cover: attachCoverAction,
  subtitle: attachSubtitleAction,
  worksheet: attachWorksheetAction,
};

/**
 * The action `useActionState` gets for a slot that has none.
 *
 * Hooks are unconditional, so the video slot still needs one; it returns the
 * SAME object every time, which is what keeps `useActionToast()` — an identity
 * comparison — silent for a form that is never submitted.
 */
const NO_FORM_ACTION = async (): Promise<ActionState> => EMPTY;

/**
 * Extra `accept` entries, by extension.
 *
 * The media types alone are not enough for a subtitle: many Windows machines
 * have no registry entry for `.vtt`, so a file picker filtering on `text/vtt`
 * shows the operator an empty folder. The extension makes it selectable; what
 * the file IS is still decided from its bytes, server-side.
 */
const ACCEPT_EXTENSIONS: Record<CourseSlotId, string[]> = {
  cover: [],
  video: [],
  subtitle: [".vtt"],
  worksheet: [],
};

/** What the page already knows about one filled slot. No address, no bytes. */
export interface SlotFile {
  filename: string | null;
  bytes: number;
}

export interface UnitMediaRef {
  id: string;
  slug: string;
  title: string;
  origin: string;
  /** `null` where the slot is empty. */
  slots: Record<CourseSlotId, SlotFile | null>;
  /** What may be stored per slot on THIS installation, in bytes. */
  ceilings: Record<CourseSlotId, number>;
  /** The content file that claims this lesson's slug, or `null`. */
  contentFile: string | null;
}

/**
 * The button in the lesson row, and the window behind it.
 *
 * Offered for EVERY lesson, whatever its origin — unlike the row menu, which is
 * absent for a row a file owns. A `content` lesson has media too, and the
 * question "why can I not change it" deserves an answer in the place somebody
 * looks for it rather than a missing button.
 */
export function UnitMediaDialog({ unit }: { unit: UnitMediaRef }) {
  const t = useTranslations("coursesAdmin");
  const [open, setOpen] = useState(false);
  const writable = mayOperatorWrite(unit.origin);
  const filled = COURSE_SLOT_IDS.filter((slot) => unit.slots[slot]).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("mediaTrigger", { title: unit.title })}>
          <Paperclip aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("mediaTitle", { title: unit.title })}</DialogTitle>
          <DialogDescription>{t("mediaDescription", { filled })}</DialogDescription>
        </DialogHeader>

        {!writable && (
          // A STATE, so a Callout and never a toast: it is true on every visit,
          // and it names the file — which is the only thing that turns "I
          // cannot" into "here is where I can".
          <Callout variant="info" title={t("mediaLockedTitle")}>
            {t("mediaLockedBody", {
              file: unit.contentFile
                ? `content/course/${unit.contentFile}`
                : t("originContentOrphan"),
            })}
          </Callout>
        )}

        <div className="flex flex-col gap-6 py-2">
          {COURSE_SLOT_IDS.map((slot) => (
            <Slot key={slot} slot={slot} unit={unit} writable={writable} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Slot({
  slot,
  unit,
  writable,
}: {
  slot: CourseSlotId;
  unit: UnitMediaRef;
  writable: boolean;
}) {
  const t = useTranslations("coursesAdmin");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const formAction = ACTIONS[slot];
  const [state, action, pending] = useActionState(formAction ?? NO_FORM_ACTION, EMPTY);
  const [detachState, detachAction] = useActionState(detachSlotAction, EMPTY);
  // ⚠️ The confirm button calls the action OUTSIDE a form, so it has to open its
  // own transition — `useActionState`'s dispatch called bare logs "An async
  // function with useActionState was called outside of a transition" and leaves
  // `isPending` stuck. Measured in the browser in Story 5.3, where the same
  // shape appears twice in `./ui.tsx`; nothing in this repo's gates sees it,
  // because it never reaches the server log.
  const [detachPending, startDetach] = useTransition();
  const [removing, setRemoving] = useState(false);
  // Set by `<MediaUpload>` while submitting would be pointless: the file is
  // over the ceiling, or the direct upload is still running.
  const [blocked, setBlocked] = useState(false);
  // The direct path has no form and therefore no `useActionState` — its result
  // is held here and reported through the same toast as everything else.
  const [directState, setDirectState] = useState<ActionState>(EMPTY);

  useActionToast(state);
  useActionToast(detachState);
  useActionToast(directState);

  useEffect(() => {
    if (detachState.ok) setRemoving(false);
  }, [detachState.ok]);

  const rules = COURSE_SLOTS[slot];
  // Whichever of the two routes this slot takes, this is the state that says
  // "it worked". ⚠️ The OBJECT is what `<MediaUpload>`'s `resetKey` gets, never
  // `state.ok`: the sentence is the same string after every upload, so an
  // `Object.is` comparison would fire the reset once and never again — the
  // field would keep its file from the second upload onwards. `useActionState`
  // and the direct path both return a fresh object per call.
  const succeeded = formAction ? state : directState;
  const ceiling = unit.ceilings[slot];
  const current = unit.slots[slot];
  const inputId = `slot-${slot}-${unit.id}`;
  const name = t(`slot${slot.charAt(0).toUpperCase()}${slot.slice(1)}`);

  // The three-step upload, as the three things `<MediaUpload>` asks for. It
  // never learns a route or a Server Action name — see its own header for why
  // that is a security property and not tidiness.
  const direct = formAction
    ? undefined
    : {
        mint: async (file: File) => {
          const minted = await mintVideoTicketAction({
            id: unit.id,
            // Only what the address needs. The FILE stays in the browser until
            // it goes to the bucket — sending it here would put it through the
            // very body limit this path exists to get past.
            mime: file.type,
            filename: file.name || null,
            bytes: file.size,
          });
          if (minted.error || !minted.ticketId || !minted.url) {
            return { ok: false as const, message: minted.error ?? tErrors("unknown") };
          }
          return { ok: true as const, ticketId: minted.ticketId, url: minted.url };
        },
        confirm: async (ticketId: string) => {
          const result = await confirmVideoAction({ id: unit.id, ticketId });
          // ⚠️ Only a SUCCESS is handed to the toast. A refusal goes back to
          // `<MediaUpload>` and appears as the red callout directly under the
          // field; doing both would say the same sentence twice, in two
          // mechanisms, and `CLAUDE.md` → *UI* rule 1 picks by where the result
          // has to appear rather than offering the pair.
          if (result.error) return { ok: false as const, message: result.error };
          setDirectState(result);
          // The ticket id IS the media row's id — `createUploadTicket()` mints
          // the id first and derives the key from it — so this is the handle a
          // form would carry. Here the confirm action has already set the
          // column, and the field is what makes that visible rather than
          // implied.
          return { ok: true as const, handle: ticketId };
        },
        handleName: "videoMediaId",
        progress: (percent: number) => t("slotUploadProgress", { percent }),
        ready: t("slotUploadReady"),
        transportFailed: t("slotUploadTransportFailed"),
      };

  return (
    <div className="flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0">
      <form action={action}>
        <input type="hidden" name="id" value={unit.id} />

        <div className="grid gap-2">
          {current && (
            // A filled slot shows what is in it. No `<EmptyState>` for an empty
            // one: four empty boxes in one window say nothing, and the field
            // itself is already the invitation.
            <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <ImageIcon aria-hidden className="text-muted-foreground size-4" />
              <span className="font-medium">{current.filename ?? t("slotUnnamedFile")}</span>
              <span className="text-muted-foreground text-xs">
                {formatBytes(current.bytes, locale)}
              </span>
              {writable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ms-auto"
                  onClick={() => setRemoving(true)}
                >
                  <Trash2 aria-hidden />
                  {t("slotDetach")}
                </Button>
              )}
            </div>
          )}

          <MediaUpload
            id={inputId}
            name="file"
            label={name}
            mimeTypes={rules.mimeTypes}
            extensions={ACCEPT_EXTENSIONS[slot]}
            ceilingBytes={ceiling}
            tooLargeTitle={t("slotTooLargeTitle")}
            tooLarge={(picked) =>
              t("slotTooLarge", {
                size: formatBytes(picked, locale),
                max: formatBytes(ceiling, locale),
              })
            }
            /* PERMANENT, under the field — not a message after a failed
               attempt. The number is the one that really applies to THIS door:
               the body limit for three of them, and what the bucket takes for
               the video, which is why the sentence about the other route is
               gone rather than merely unread. */
            hint={`${t("slotAccepts", {
              types: t(`slot${slot.charAt(0).toUpperCase()}${slot.slice(1)}Types`),
            })} ${t("slotCeiling", { max: formatBytes(ceiling, locale) })}`}
            disabled={!writable}
            resetKey={succeeded.ok ? succeeded : null}
            onBlocked={setBlocked}
            direct={direct}
          >
            {slot === "cover" && (
              <>
                <Label htmlFor={`${inputId}-alt`} className="mt-1 text-xs font-normal">
                  {t("slotAltLabel")}
                </Label>
                <Input
                  id={`${inputId}-alt`}
                  name="alt"
                  disabled={!writable}
                  placeholder={t("slotAltPlaceholder")}
                />
              </>
            )}
          </MediaUpload>

          {/* No button on the direct path, and that is not an omission: the
              upload starts the moment a file is chosen and the confirm step
              fills the column itself. A "upload" button after a two-gigabyte
              transfer has already finished would be a control with nothing left
              to do. */}
          {writable && formAction && (
            <Button type="submit" size="sm" className="self-start" disabled={pending || blocked}>
              {pending ? tCommon("loading") : t("slotUpload")}
            </Button>
          )}
        </div>
      </form>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("slotDetachTitle", { slot: name })}</AlertDialogTitle>
            {/* Says what really happens: the connection goes, the file stays.
                Honest in both directions — nothing is erased, and there is no
                surface here that would let them pick it again. */}
            <AlertDialogDescription>{t("slotDetachBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={detachPending}
              onClick={(event) => {
                // Never closes by itself: a refusal naming the content file is
                // the thing worth reading, and a dialog that vanished would
                // take it with it.
                event.preventDefault();
                const formData = new FormData();
                formData.set("id", unit.id);
                formData.set("slot", slot);
                startDetach(() => detachAction(formData));
              }}
            >
              {detachPending ? tCommon("loading") : t("slotDetachConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
