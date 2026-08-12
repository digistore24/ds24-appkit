// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { RoleBadge } from "@/components/role-badge";
import { requireActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";
import {
  avatarUrlFor,
  isFollowing,
  memberWithProfile,
} from "@/modules/community/lib/manage";
import { displayNameFor } from "@/modules/community/lib/rules";
import { DmEntryPoint } from "@/modules/community/components/dm-entry-point";
import { FollowButton } from "../../people/ui";

// One member, as the community sees them.
//
// ── The check order is the module's contract, and it is not interchangeable ──
// Enablement FIRST, before any session work, exactly as `/dashboard/community`
// does it: while the community is off this route answers the framework's
// not-found for everyone — members, the operator, all of them. `proxy.ts`
// rewrites `/dashboard/community/*` before the request ever arrives here when
// the switch is off; this branch is the defense in depth behind it, because
// hiding is never guarding and a matcher edit must not open the page (AD-67).
//
// Unlike `/dashboard/community` there is NO operator fork here. That page is
// the module's one diagnosis surface; this one is a member's face, and an
// operator looking at a broken installation has nothing to diagnose on it.
//
// ── What it may show, and what it may never show ────────────────────────────
// The name they chose, what they wrote about themselves, their picture and
// their role badge. **Never the email address, never purchases, never anything
// from the account** (FR-184) — and the enforcement is structural rather than
// careful: `memberWithProfile()` does not SELECT the email at all, so there is
// no field on this page's data for a future edit to render by accident.
//
// ── Anonymous visitors ──────────────────────────────────────────────────────
// Nothing special is needed and nothing special is done: the route lives under
// `/dashboard`, so a request with no session is the same 307 to `/login` every
// protected page gives. Nothing is revealed and nothing is indexable (FR-185).
//
// ⚠️ DYNAMIC route — `node run.mjs smoke` skips it. It was called up by hand
// with a real member id, and `node run.mjs errors` read afterwards; that is the
// routine `template/CLAUDE.md` prescribes for exactly this gap.

export async function generateMetadata() {
  const t = await getTranslations("community");
  return { title: t("title") };
}

export default async function CommunityMemberPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  if (!isCommunityEnabled()) {
    notFound();
  }

  const session = await requireActiveUser();

  const { memberId } = await params;
  const member = await memberWithProfile(memberId);

  // No such account. `notFound()` rather than a sentence: an id somebody typed
  // or an account deleted since the link was made are the same thing to the
  // person looking, and neither is worth a page that explains itself.
  if (!member) {
    notFound();
  }

  const t = await getTranslations("community");

  // The fallback chain. A member with no profile row still renders — that is
  // the point of the chain, and it is the common case on a fresh app whose
  // sign-up is a magic link. The placeholder word comes from the request's
  // language: it is the most-rendered string this module produces, and it may
  // not be born in `lib/` (AD-10).
  const name = displayNameFor({
    profileName: member.profile?.displayName ?? null,
    accountName: member.accountName,
    memberId: member.memberId,
    placeholderLabel: t("memberPlaceholder"),
  });
  // A surrogate pair must not be sliced in half — see the account card.
  const initial = [...name][0]?.toUpperCase() ?? "";

  // The picture, through the one door that checks before it mints. A
  // `members`-visible row is delivered to any active session — which this
  // request has, or `requireActiveUser()` would have redirected it — and
  // `avatarUrlFor()` answers null for a row that has since been deleted, which
  // renders as the initial exactly like a member who never uploaded one.
  const avatarUrl = await avatarUrlFor(member.profile?.avatarMediaId ?? null, {
    memberId: session.user.id ?? null,
    role: session.user.role ?? "member",
  });

  return (
    <>
      <PageHeader title={name} />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            {/* A member who uploaded no picture keeps the initial-based
                placeholder, which is the same one the app shell uses — so the
                two states occupy the same space and the layout does not move. */}
            <Avatar className="size-16">
              {/* `alt=""` on purpose: the name is rendered right beside it, so
                  a screen reader announcing the picture too would say it
                  twice. The stored `alt` on the media row is the name, which
                  is what a download or a bucket listing needs. */}
              {/* `object-cover`, not the default `fill`: `AvatarImage` sets only
                  `aspect-square size-full`, so a 3:4 portrait would be squashed
                  horizontally into the circle. */}
              {avatarUrl && <AvatarImage src={avatarUrl} alt="" className="object-cover" />}
              <AvatarFallback className="text-lg">{initial}</AvatarFallback>
            </Avatar>

            {/* Name and badge, and deliberately nothing else. A "member since"
                line stood here and was removed by review: it formatted the
                PROFILE row's `createdAt`, so a customer who bought in 2024 and
                named themselves today read "member since today". The honest
                column is `users.createdAt` — which is account data, on a page
                whose whole point is that it carries none. AC 4 enumerates name,
                about, avatar and badge; this was not in it. */}
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-lg font-medium">
                {name}
                <RoleBadge role={member.role} />
              </span>
            </div>
          </div>

          <p className="text-sm whitespace-pre-line">
            {member.profile?.about ?? (
              <span className="text-muted-foreground">{t("profileNoAbout")}</span>
            )}
          </p>

          {/* ⚠️ **The only door into a new conversation**, and it is on the page
              you reach by meeting somebody in a room. There is deliberately no
              member directory and no search by name — the no-roster rule
              (`db/schema-community.ts`) applied to the inbox, because a way to
              enumerate members is a way to message all of them.

              It is not shown on one's own profile, and that is cosmetics: the
              server refuses a conversation with oneself either way, with the
              same `communityNotDeliverable` every other undeliverable message gets. */}
          {/* ⚠️ **A state, never a count.** The button says whether the
              viewer follows this person; nothing on this page says how many
              do. FR-222 forbids the aggregate everywhere, operator surfaces
              included — a follower number is a fact about the followers, and
              in a plan-gated community it starts describing who bought what.

              Not shown on one's own profile, and that is cosmetics: the core
              refuses a self-follow with the same `communityNotDeliverable` a block
              gets, and the CHECK constraint refuses the row. */}
          {member.memberId !== session.user.id && (
            <div className="flex flex-wrap gap-2">
              {/* The gate lives inside `DmEntryPoint`, so this page cannot
                  get it subtly wrong and a structural test can prove it. */}
              <DmEntryPoint memberId={member.memberId} />
              <FollowButton
                memberId={member.memberId}
                following={await isFollowing(
                  session.user.id as string,
                  member.memberId,
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
