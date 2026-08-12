// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's card on `/dashboard/account` — the slot's filling.
//
// A SERVER component that fetches its own rows, which is the slot contract
// (`lib/modules/slots.ts`). Before the move, the account page itself held three
// imports, three awaited values and a `getTranslations("community")` for a
// feature most apps do not switch on; now it holds one `<ModuleSlots>` and does
// not know what filled it.
//
// The client half (`profile-ui.tsx`) and the action (`../profile-actions.ts`)
// moved unchanged.
import { getLocale, getTranslations } from "next-intl/server";

import { mediaConfig } from "@/lib/media/config";
import { formatBytes, slotCeilingBytes } from "@/lib/media/rules";
import type { ModuleSlotProps } from "@/lib/modules/slots";
import { isCommunityEnabled } from "../lib/config";
import { avatarUrlFor, profileFor } from "../lib/manage";
import { displayNameFor } from "../lib/rules";
import { CommunityProfileCard } from "./profile-ui";

export default async function CommunityAccountCard({ viewer }: ModuleSlotProps) {
  // ⚠️ The module's own SWITCH, not its installation. An uninstalled module is
  // never rendered at all — it is not in the slot registry. This is
  // `config/community.json`, and the two questions stay separate here exactly
  // as they do everywhere else.
  //
  // Unlike the API's card there is no "…but show it if they already have one":
  // a profile is not a credential somebody may still need to revoke, and a
  // switched-off community shows nothing of itself anywhere.
  if (!isCommunityEnabled()) return null;

  const profile = await profileFor(viewer.memberId);
  const avatarUrl = profile
    ? await avatarUrlFor(profile.avatarMediaId, {
        memberId: viewer.memberId,
        role: viewer.role,
      })
    : null;

  const t = await getTranslations("community");

  // ⚠️ **Read here and not in `profile-ui.tsx`.** That file is a client
  // component and `mediaConfig()` reads this installation's own
  // `config/media.json`; this one is a server component and may. The number is
  // `slotCeilingBytes()` rather than the kind's raw ceiling because a profile
  // picture travels THROUGH the app — the lower of the two is what a Server
  // Action body carries, and it is the number a member's field should promise.
  const avatarCeilingBytes = slotCeilingBytes(mediaConfig().kinds.image.maxBytes);

  return (
    <CommunityProfileCard
      avatarCeilingBytes={avatarCeilingBytes}
      avatarMax={formatBytes(avatarCeilingBytes, await getLocale())}
      displayName={profile?.displayName ?? ""}
      about={profile?.about ?? ""}
      resolvedName={displayNameFor({
        profileName: profile?.displayName ?? null,
        // 🚨 The account name is deliberately NOT read here any more.
        //
        // The page used to pass `session.user.name`, and a slot component has
        // no session — it is handed a viewer and nothing else. That looks like
        // a loss and is not: `displayNameFor()` falls through to the
        // placeholder, which is what a member with no community profile SHOULD
        // be shown, and the account name is the one thing the community is
        // built never to expose on its own (`memberWithProfile()` does not even
        // select the address). Handing it in here would have been the one place
        // that reintroduced it.
        accountName: null,
        memberId: viewer.memberId,
        placeholderLabel: t("memberPlaceholder"),
      })}
      role={viewer.role}
      avatarUrl={avatarUrl}
    />
  );
}
