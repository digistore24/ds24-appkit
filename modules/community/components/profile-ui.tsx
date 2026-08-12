"use client";

// The member's own community profile, edited from their account page.
//
// Why it lives HERE and not on a community page: this is the one place in the
// app a member manages what is theirs, and a second "your settings" surface
// inside the community would be a second place to look for the same thing. The
// community shows the profile; the account owns it.
//
// The preview is not decoration. What a member types is a display name, but
// what they are deciding is how they will appear beside everything they ever
// write — so the card renders the real result, through the same
// `displayNameFor()` fallback chain and the same `<RoleBadge>` the profile page
// uses. Without it, the fallback (the common case on a magic-link account, which
// has no name at all) is invisible until somebody else sees it.
import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaUpload } from "@/components/ui/media-upload";
import { Textarea } from "@/components/ui/textarea";
import { RoleBadge } from "@/components/role-badge";
import { formatBytes } from "@/lib/media/rules";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  COMMUNITY_PROFILE_ANCHOR,
  MAX_COMMUNITY_ABOUT_LENGTH,
  MAX_COMMUNITY_DISPLAY_NAME_LENGTH,
} from "@/modules/community/lib/rules";
import { saveCommunityProfileAction } from "../profile-actions";

const EMPTY = { error: null, ok: null };

/**
 * What a profile picture may be.
 *
 * A LIST rather than the comma-joined string it was, because `<MediaUpload>`
 * composes `accept` from media types plus optional extensions — one place doing
 * that join instead of two spellings of it.
 */
const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface CommunityProfileCardProps {
  /** The name already stored on the profile, or "" when there is none yet. */
  displayName: string;
  /** The about text already stored, or "" when there is none yet. */
  about: string;
  /**
   * What the community would call this member RIGHT NOW — resolved on the
   * server through the fallback chain, so the preview is honest before the
   * member has typed anything.
   */
  resolvedName: string;
  /** Their role, for the badge — the same one the profile page shows. */
  role: string;
  /**
   * The address of the avatar they already have, or `null`.
   *
   * Resolved on the SERVER through `avatarUrlFor()`, which does the
   * `mayAccess()` check before minting anything — a raw storage URL must never
   * reach a client component.
   */
  avatarUrl: string | null;
  /**
   * What a profile picture may weigh here, in bytes.
   *
   * Read on the SERVER — `slotCeilingBytes(mediaConfig().kinds.image.maxBytes)`
   * — because this is a client component and `mediaConfig()` reads the
   * installation's own `config/media.json`. Until Story 8.2 this surface had no
   * number at all: no hint, no refusal, and a member over the limit met a
   * failure Next produces while decoding the request body, which nothing in
   * this app can translate.
   */
  avatarCeilingBytes: number;
  /** The same number, already through `formatBytes()` in the reader's locale. */
  avatarMax: string;
}

export function CommunityProfileCard({
  displayName,
  about,
  resolvedName,
  role,
  avatarUrl,
  avatarCeilingBytes,
  avatarMax,
}: CommunityProfileCardProps) {
  const t = useTranslations("community");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveCommunityProfileAction, EMPTY);
  useActionToast(state);

  // CONTROLLED, so the preview tracks what is being typed.
  //
  // It used to be uncontrolled, and the preview compared the stored name
  // against `resolvedName` — which is `displayNameFor()` over that same stored
  // name, so the two operands were always equal and the branch was dead. The
  // header promised a preview that shows "the real result" while it only
  // changed after a save round-trip. A member deciding how they will appear
  // beside everything they ever write should see it as they decide.
  const [typed, setTyped] = useState(displayName);

  // Told by `<MediaUpload>` when the chosen picture is over the ceiling: saving
  // would spend a rate-limit slot on a refusal.
  const [blocked, setBlocked] = useState(false);

  // Empty input → what the community would actually call them: the account
  // name if there is one, otherwise the neutral placeholder. That is the whole
  // point of showing a fallback rather than a blank.
  const previewName = typed.trim() || resolvedName;
  // `[...name][0]`, never `slice(0, 1)` — an emoji or any astral character is
  // a surrogate PAIR, and slicing one in half renders as `�`.
  const initial = [...previewName][0]?.toUpperCase() ?? "";

  return (
    // The target of the community's "choose a name first" hint. `scroll-mt-20`
    // is not decoration: the dashboard header is sticky and `h-14`, so without
    // the offset the browser parks this card's title underneath it and the
    // member arrives at a box whose heading they cannot see.
    <Card id={COMMUNITY_PROFILE_ANCHOR} className="scroll-mt-20">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound aria-hidden className="text-muted-foreground size-4" />
            {t("profileCardTitle")}
          </CardTitle>
          <CardDescription>{t("profileCardDescription")}</CardDescription>
        </div>

        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="community-display-name">{t("profileDisplayName")}</Label>
            <Input
              id="community-display-name"
              name="displayName"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              maxLength={MAX_COMMUNITY_DISPLAY_NAME_LENGTH}
              required
            />
            <p className="text-muted-foreground text-xs">{t("profileDisplayNameHint")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="community-about">{t("profileAbout")}</Label>
            <Textarea
              id="community-about"
              name="about"
              defaultValue={about}
              maxLength={MAX_COMMUNITY_ABOUT_LENGTH}
              rows={3}
            />
            <p className="text-muted-foreground text-xs">{t("profileAboutHint")}</p>
          </div>

          {/* One field, shared with the course's media slots — see
              `components/ui/media-upload.tsx`, and never a raw
              <input type="file"> of this module's own again. It brings three
              things this surface never had: the size hint WITH the number, a
              refusal before anything is sent, and the reset that used to live
              here as its own copy of the same effect. `direct` is absent on
              purpose, and it is not an omission to fix: pictures
              travel through the app so that their location data comes off
              (`docs/data-protection.md` §14), which needs the bytes in the
              process. */}
          <MediaUpload
            id="community-avatar"
            name="avatar"
            label={t("profileAvatar")}
            mimeTypes={AVATAR_MIME_TYPES}
            ceilingBytes={avatarCeilingBytes}
            tooLargeTitle={t("profileAvatarTooLargeTitle")}
            tooLarge={(picked) =>
              t("profileAvatarTooLarge", { size: formatBytes(picked, locale), max: avatarMax })
            }
            hint={t("profileAvatarHint", { max: avatarMax })}
            /* The state OBJECT, not `state.ok` — the sentence is the same
               string after every save, and `Object.is` would fire the reset
               once and never again. `useActionState` returns a fresh object
               per call, which is what makes the identity a signal. */
            resetKey={state.ok ? state : null}
            onBlocked={setBlocked}
          />

          {/* Only offered when there is one to remove. A member who regrets a
              picture should not have to find another one to be rid of it —
              and a checkbox that does nothing on an empty profile is a
              question nobody can answer. */}
          {avatarUrl && (
            <label className="text-muted-foreground -mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="removeAvatar"
                className="border-input accent-primary size-3.5 rounded-sm border"
              />
              {t("profileAvatarRemove")}
            </label>
          )}

          {/* The result, as other members see it — the saved state, so it
              shows the fallback honestly until a name has been chosen. */}
          <div className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs font-medium">
              {t("profilePreviewTitle")}
            </p>
            <div className="flex items-center gap-3">
              <Avatar>
                {avatarUrl && <AvatarImage src={avatarUrl} alt="" className="object-cover" />}
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {previewName}
                  <RoleBadge role={role} />
                </span>
              </div>
            </div>
          </div>

          {/* Disabled while pending: `upsertProfile` is not idempotent in the
              sense that matters here — a double submission is two writes and
              two toasts for one intention. */}
          <Button type="submit" size="sm" className="self-start" disabled={pending || blocked}>
            {t("profileSave")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
