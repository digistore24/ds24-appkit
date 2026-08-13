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

// 🚨 **`countRooms()` from `../lib/room-counts`, never `listGroups()` from
// `../lib/manage`.** This file is on the CONTENT PLAN's code path: the core
// composes it into `lib/modules/presence-registry.ts`, `lib/content/presence.ts`
// imports that registry, and `lib/content/applier-plan.test.ts` asserts over
// that whole closure that a plan **can reach no method that writes an object**.
// `lib/manage.ts` is 5900 lines and imports `@/lib/media/manage`, which calls
// `store.copy()` and `store.remove()` — so one convenience import put the media
// store's writing half one keystroke away from a tool whose entire claim is that
// it only ever reads. It shipped that way and turned every app that installs
// this module red (reported 2026-08-12); `scripts/modules/presence-purity.test.ts`
// is what now asks the question for EVERY module rather than only for the core.
//
// ⚠️ And the query does NOT move in here to fix that. A contributor is a thin
// caller — `lib/setup/module-boundary.test.ts` (spine AD-81) refuses a `@/db`
// import in this file, because the second implementation of a read is the one
// nobody looks at. `../lib/room-counts` is the module's own lib, owning the
// module's own table and reaching nothing else; the reasoning is in its header.
import { countRooms } from "../lib/room-counts";
import type { PresenceContributor, PresenceReport } from "@/lib/content/presence";

const contributor: PresenceContributor = {
  id: "community",
  async check(): Promise<PresenceReport> {
    const rooms = await countRooms();

    return {
      owner: "community",
      items: [
        // Archived rooms are counted apart rather than folded in: an environment
        // whose every room is archived looks identical to an empty one from a
        // member's side, and that difference is worth its own line.
        { what: "rooms", found: rooms.live, expected: null },
        { what: "rooms (archived)", found: rooms.archived, expected: null },
      ],
    };
  },
};

export default contributor;
