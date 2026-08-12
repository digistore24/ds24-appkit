// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module offers the server — the `ModuleEntry` the generated registry
// collects.
import type { ModuleEntry, ModuleEraseTx, ModuleViewer } from "@/lib/modules/types";
import privacy from "./privacy/sections";
import { isCommunityEnabled } from "./lib/config";
import { communityNavVisible } from "./lib/rules";
import { scrubCommunityContentFor, unreadFor } from "./lib/manage";
import { hasUnreadMessagesForViewer } from "./lib/dm-presence";
import { isOwner } from "@/lib/roles";

const community: ModuleEntry = {
  id: "community",
  privacy,

  /**
   * What the sidebar shows this viewer.
   *
   * ⚠️ **Runs on every protected page load, so the switched-off case costs
   * nothing**: the first line returns before any query. That property used to
   * live in `app/dashboard/layout.tsx` as `isCommunityEnabled() ? … : false`
   * and is the one to preserve rather than the shape of the code around it.
   */
  async shellState(viewer: ModuleViewer) {
    if (!isCommunityEnabled()) return {};

    // Rooms first, private messages only if the rooms said no — the
    // short-circuit is what keeps the common case inside its budget. A member
    // with nothing new in any room but one unread message must still see the
    // dot, or the indicator answers a narrower question than it appears to.
    const unread =
      (await unreadFor({ memberId: viewer.memberId, role: viewer.role })) ||
      // 🚨 Through the presence module, never around it. That is where the
      // impersonation carve-out lives, and `impersonation-guard.test.ts`
      // refuses a surface that applies it a second time by hand. An operator
      // inside somebody's account gets no signal about their mail at all — not
      // the message, not its existence, not a dot.
      (await hasUnreadMessagesForViewer(viewer));

    return {
      features: {
        // Deliberately TRUE for the operator while the module is on-but-broken,
        // so the diagnosis page keeps a way in.
        community: communityNavVisible(true, isCommunityEnabled(), isOwner(viewer.role)),
        // The plain "is the module running" answer — the admin page refuses in
        // the broken state, so an entry there would lead the one person who
        // needs it to a 404.
        communityAdmin: true,
      },
      badges: unread ? ["/dashboard/community"] : [],
    };
  },

  /**
   * What a member wrote here, emptied when they delete their account.
   *
   * The row itself survives where other people replied to it — that is the
   * difference between this and a cascade, and `scrubCommunityContentFor()`
   * carries the whole argument. Runs whether or not the community is switched
   * on: an erasure request is about the DATA.
   */
  async eraseFor(tx: ModuleEraseTx, memberId: string) {
    await scrubCommunityContentFor(tx, memberId);
  },
};

export default community;
