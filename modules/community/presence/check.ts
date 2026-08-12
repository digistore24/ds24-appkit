// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Does this environment hold the community this app is supposed to have?
//
// `CLAUDE.md` states the problem this answer belongs to: **"Rooms are rows, and
// rows do not travel with a deploy."** A community built on a laptop and
// deployed is a `/dashboard/community` that answers 200 and shows nothing — the
// exact failure `content-check` exists for, and one the CORE cannot see,
// because the core does not know this module has rooms. That is the whole
// argument for delegating the question rather than centralising it.
//
// ⚠️ `expected` is null. There is no number of rooms an app *should* have, and
// an operator who added three more has not broken anything — inventing an
// expected count would turn ordinary growth into a red line. What is worth
// seeing is ZERO, and zero is reported: a switched-on community with no rooms
// is an empty page for every member.

import { listGroups } from "../lib/manage";
import type { PresenceContributor, PresenceReport } from "@/lib/content/presence";

const contributor: PresenceContributor = {
  id: "community",
  async check(): Promise<PresenceReport> {
    const groups = await listGroups();
    const live = groups.filter((group) => group.archivedAt === null);

    return {
      owner: "community",
      items: [
        // Archived rooms are counted apart rather than folded in: an environment
        // whose every room is archived looks identical to an empty one from a
        // member's side, and that difference is worth its own line.
        { what: "rooms", found: live.length, expected: null },
        { what: "rooms (archived)", found: groups.length - live.length, expected: null },
      ],
    };
  },
};

export default contributor;
