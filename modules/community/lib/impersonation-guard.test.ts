// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The carve-out is enforced, not documented.**
//
// FR-209: while an operator is signed in as a member, group surfaces act as
// that member — and the private-message surfaces refuse entirely. No read, no
// send, no report. The reasoning is in `modules/community/lib/dm-actor.ts`; what this
// file does is make it a build failure to stop doing it.
//
// Two halves, and neither replaces the other:
//
//   **Behavioural** — the decision itself, driven with session fixtures for
//   the three states `lib/impersonation/claim.ts` describes (none, running,
//   expired). It proves the condition is right.
//
//   **Structural** — every DM surface file is read and asserted to obtain its
//   actor through the seam. It proves the condition is REACHED, which a
//   behavioural test of one surface never can: the realistic failure is not a
//   wrong condition, it is a seventh surface written next year by somebody who
//   copied the sixth. The mould is `app/api/v1/guard-presence.test.ts`, which
//   solves exactly this problem for the HTTP API's own door.
//
// ⚠️ **Epic 23's report surfaces join the enumeration below.** FR-209 names
// read, send AND report; the report path does not exist yet, and when it does
// it comes through `requireDmActor()` / `dmActorFrom()` like everything else.
// Its story's AC already cites FR-209 — this list is where the obligation is
// written down so that it is one line of work rather than a rediscovery.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { dmActorFrom } from "./dm-actor";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// ── Behavioural: the three session states ──────────────────────────────────

describe("the DM actor refuses an impersonated session", () => {
  const member = { id: "member-1", role: "member" };

  it("lets an ordinary session act", () => {
    expect(dmActorFrom({ user: member })).toEqual({
      state: "actor",
      memberId: "member-1",
      role: "member",
    });
  });

  it("refuses while an impersonation is running", () => {
    // The shape `auth.ts` puts on the session: `impersonation` is set while an
    // operator is signed in as this member, and only then. `id` and `role`
    // describe the MEMBER, which is why the refusal cannot be a role check.
    const impersonated = {
      user: {
        ...member,
        impersonation: {
          id: "imp-1",
          operatorId: "owner-1",
          startedAt: new Date().toISOString(),
        },
      },
    };

    expect(dmActorFrom(impersonated)).toEqual({ state: "impersonated" });
  });

  it("lets an EXPIRED impersonation through — because it is no longer one", () => {
    // `lib/impersonation/claim.ts` resolves expiry on every read, so by the
    // time a session carries these fields an expired claim already presents as
    // the operator with `impersonation: null` and `impersonationEnded: true`.
    // Re-implementing the arithmetic here would be a second copy of a decision
    // that has already been made — this asserts the guard does NOT.
    const ended = {
      user: { ...member, impersonation: null, impersonationEnded: true },
    };

    expect(dmActorFrom(ended)).toEqual({
      state: "actor",
      memberId: "member-1",
      role: "member",
    });
  });

  it("refuses a session with no member id", () => {
    expect(dmActorFrom({ user: {} })).toEqual({ state: "unavailable" });
    expect(dmActorFrom({})).toEqual({ state: "unavailable" });
  });

  it("does not decide by role", () => {
    // An owner acting as themselves may use their own inbox — they are a
    // member of their own community. The carve-out is about the SESSION being
    // somebody else's, not about who the person is.
    expect(dmActorFrom({ user: { id: "owner-1", role: "owner" } })).toEqual({
      state: "actor",
      memberId: "owner-1",
      role: "owner",
    });
  });
});


// ── The wrapper, not only the decision ─────────────────────────────────────
//
// `dmActorFrom()` is the condition; `requireDmActor()` is what a page actually
// calls, and between them sit three more checks and a `notFound()`. Asserting
// the condition alone would leave the wrapper — the part that has to REFUSE —
// untested, which is the half a page depends on.
//
// `vi.doMock` + dynamic import, the idiom `modules/community/lib/config.test.ts` uses:
// the module reads its dependencies at call time, so the mock has to be in
// place before the import.

describe("requireDmActor refuses before a page reads anything", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/authz");
    vi.doUnmock("@/modules/community/lib/config");
  });

  async function load(session: unknown) {
    vi.resetModules();
    vi.doMock("@/modules/community/lib/config", () => ({
      isCommunityEnabled: () => true,
    }));
    vi.doMock("@/lib/authz", () => ({
      ACCESS_DENIED: "AccessDenied",
      currentActiveUser: async () => ({ state: "active", session }),
    }));
    // `notFound()` and `redirect()` signal by throwing, which is exactly what
    // a page relies on — so the mock throws a value the assertion can name.
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("NOT_FOUND");
      },
      redirect: (to: string) => {
        throw new Error(`REDIRECT:${to}`);
      },
    }));
    return import("./dm-actor");
  }

  it("hands an ordinary session its member id", async () => {
    const { requireDmActor } = await load({
      user: { id: "member-1", role: "member" },
    });
    await expect(requireDmActor()).resolves.toEqual({
      memberId: "member-1",
      role: "member",
    });
  });

  it("answers not-found for an impersonated session", async () => {
    // The same answer a disabled surface gives (19.1), and deliberately not a
    // sentence: an operator inside a member's account must not learn whether
    // that member has any correspondence at all.
    const { requireDmActor } = await load({
      user: {
        id: "member-1",
        role: "member",
        impersonation: { id: "imp-1", operatorId: "owner-1" },
      },
    });
    await expect(requireDmActor()).rejects.toThrow("NOT_FOUND");
  });

  it("answers not-found when the module is switched off", async () => {
    vi.resetModules();
    vi.doMock("@/modules/community/lib/config", () => ({
      isCommunityEnabled: () => false,
    }));
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("NOT_FOUND");
      },
      redirect: () => {
        throw new Error("REDIRECT");
      },
    }));
    const { requireDmActor } = await import("./dm-actor");
    await expect(requireDmActor()).rejects.toThrow("NOT_FOUND");
  });
});

// ── Structural: every DM surface goes through the seam ─────────────────────

/**
 * The direct-message surfaces, pinned.
 *
 * Every one of them obtains its actor from `modules/community/lib/dm-actor.ts`. The
 * list is the enumeration FR-209 is measured against, and adding a surface
 * without adding it here is what the last assertion in this file is for.
 */
const DM_SURFACES: Record<string, string> = {
  "modules/community/pages/messages/page.tsx": "the inbox",
  "modules/community/pages/messages/[conversationId]/page.tsx":
    "the conversation view",
  "modules/community/pages/messages/actions.ts":
    "open, send, block/unblock, and the conversation-leg marker acknowledgment",
  "modules/community/routes/live.ts": "the live endpoint's conversation scope",
  // FR-209 names read, send AND report. The report path's DM leg arrived with
  // Story 23.2 and joined the seam rather than repeating the check — which is
  // what the enumeration in the header of `dm-actor.ts` promised would happen.
  "modules/community/pages/reports/actions.ts":
    "reporting a private message — the report third of FR-209",
  "modules/community/components/dm-entry-point.tsx":
    "the way into a conversation, offered only where there is one",
};

/**
 * The MIXED surfaces: mostly room, carrying exactly one thing derived from
 * private correspondence.
 *
 * ⚠️ **This list is the taxonomy's third kind, and its absence was a defect
 * rather than a simplification.** A file was either a DM surface (obtains its
 * actor from the seam) or a room file (must not name the carve-out at all) —
 * and three files were neither. Taking the room's rule, they read the inbox
 * directly, so an operator impersonating a member saw a truthful "you have
 * unread messages" badge on a page whose sibling route answers 404 to the same
 * session. Found by the SM-17 gateway pass on 2026-08-06; it sat in the ledger
 * because the fix was forbidden by the very test meant to prevent it.
 *
 * The rule for this kind: the room half is untouched, and the DM half goes
 * through `modules/community/lib/dm-presence.ts` — one module, so the carve-out is
 * applied once rather than at each call site, and so a room page never has to
 * name the seam to obey it.
 */
const MIXED_SURFACES: Record<string, string> = {
  // ⚠️ `app/dashboard/layout.tsx` was HERE, and its removal is the one entry in
  // this file worth reading twice.
  //
  // It earned its place the hard way: it read the inbox for eighteen commits
  // and appeared in neither list, so nothing asked about it — the file was not
  // wrong according to this test, it was invisible to it. That is why the
  // completeness walk below exists.
  //
  // It is gone now because the layout no longer reads anything of this
  // module's. The sidebar dot is resolved in `modules/community/module.ts`
  // (`shellState()`), which asks `hasUnreadMessagesForViewer()` — the same
  // presence module, the same single carve-out. So the surface did not stop
  // being mixed; it stopped being the CORE's. Had the badge been left in the
  // layout, a module-owned test would be asserting over a core file, and this
  // list would be the place that quietly rotted.
  //
  // The walk still covers `app/`, so a core file that starts reading DMs again
  // is caught rather than invisible — which is the property the eighteen
  // commits paid for.
  "modules/community/pages/page.tsx": "the New badge on the Messages tile",
  "modules/community/pages/members/[memberId]/page.tsx":
    "the write-to-them button on a member's profile",
};

/** The names that count as going through the seam. */
const SEAM_CALLS = ["requireDmActor(", "currentDmActor(", "dmActorFrom("];

/**
 * The seam, applied once, for presence rather than for acts.
 *
 * These count as going through it: `dm-presence.ts` calls `dmActorFrom()` and
 * nothing else does the deciding. A surface that asks one of these has asked
 * the seam, one indirection later and in one place.
 */
const PRESENCE_CALLS = ["hasUnreadMessages(", "mayUseDmSurfaces("];

/** Delegating the whole element counts too — the gate is inside it. */
const DELEGATES = ["DmEntryPoint"];

/**
 * Readers that ASK about a member's private correspondence.
 *
 * Forbidden outright in a mixed surface, because asking is the disclosure: an
 * operator who can tell a member with an unread message from one without has
 * learned the thing FR-209 removes. The refusal has to happen before the query,
 * which is what `dm-presence.ts` is for.
 */
const RAW_DM_READERS = ["unreadMessagesFor("];

/**
 * Things that OFFER a direct-message surface.
 *
 * ⚠️ **Forbidden in a mixed surface, and that is a stronger rule than the one
 * this list started with.** The first version allowed the profile page to
 * render the button behind a condition of its own and checked source ORDER —
 * which is a heuristic, and a measured one: deleting the wrapper left the
 * presence call standing above the render and the guard stayed green. The gate
 * now lives inside `modules/community/components/dm-entry-point.tsx`, so there is a
 * fact to assert instead of a proximity.
 */
const DM_ELEMENTS = ["StartConversationButton"];

// A file with its comments taken out.
//
// `lib/impersonation/guard.test.ts`'s move, with one correction it is worth
// knowing about: **line comments go FIRST.** This module's prose quotes paths
// with a star in them, and a block-comment OPENER inside a `//` line opens the
// block regex — which then runs to the next closer, in a JSX comment forty
// lines later, and silently eats the code in between. Measured: with the other
// order, the inbox page's whole body disappeared and this guard read a file it
// had effectively not read.
function source(path: string): string {
  return blankComments(readFileSync(join(ROOT, path), "utf8"));
}

describe("every direct-message surface goes through the seam", () => {
  it("holds for each of them", () => {
    const offenders = Object.keys(DM_SURFACES).filter(
      (path) =>
        ![...SEAM_CALLS, ...PRESENCE_CALLS].some((call) =>
          source(path).includes(call),
        ),
    );

    expect(
      offenders,
      "FR-209: an impersonated session must find no direct-message surface at " +
        "all. Every one of them obtains its actor from lib/community/" +
        `dm-actor.ts (${SEAM_CALLS.join(" / ")}):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("reads real files, so an empty result means something", () => {
    // Non-vacuity: a renamed file would otherwise make the assertion above
    // pass over nothing. Each surface has to exist and have content.
    expect(Object.keys(DM_SURFACES).length).toBeGreaterThanOrEqual(4);
    for (const path of Object.keys(DM_SURFACES)) {
      expect(source(path).length, path).toBeGreaterThan(200);
    }
  });

  it("routes every mixed surface through the presence module", () => {
    const offenders = Object.entries(MIXED_SURFACES).filter(
      ([path]) =>
        ![...PRESENCE_CALLS, ...DELEGATES].some((call) =>
          source(path).includes(call),
        ),
    );
    expect(
      offenders.map(([path, what]) => `${path} (${what})`),
      "a page that is mostly a room but carries one DM-derived element asks " +
        "modules/community/lib/dm-presence.ts, so the carve-out is applied once and " +
        "the room half never names the seam",
    ).toEqual([]);
  });

  it("lets no mixed surface reach a raw DM reader", () => {
    // The point of routing through the presence module is that the refusal
    // happens BEFORE the query. A page that kept the direct call would still
    // be asking the question the carve-out removes.
    const offenders: string[] = [];
    for (const path of Object.keys(MIXED_SURFACES)) {
      const text = source(path);
      for (const reader of RAW_DM_READERS) {
        if (text.includes(reader)) offenders.push(`${path} names ${reader}`);
      }
      // A mixed surface offers the way in through `DmEntryPoint`, which
      // carries the gate itself. Naming the button here would put the
      // condition back at the call site, where it cannot be proven.
      for (const element of DM_ELEMENTS) {
        if (text.includes(element)) {
          offenders.push(`${path} renders ${element} instead of DmEntryPoint`);
        }
      }
    }
    expect(offenders, "asking is the disclosure:\n  " + offenders.join("\n  ")).toEqual(
      [],
    );
  });

  it("obtains the actor before it reads anything", () => {
    // The order matters on the pages: a surface that queried first and guarded
    // afterwards would have done the reading the carve-out exists to prevent,
    // even if it then rendered nothing.
    for (const path of [
      "modules/community/pages/messages/page.tsx",
      "modules/community/pages/messages/[conversationId]/page.tsx",
    ]) {
      const text = source(path);
      const guard = text.indexOf("requireDmActor(");
      const firstRead = Math.min(
        ...["listConversations(", "listMessages(", "conversationHeaderFor("]
          .map((call) => text.indexOf(call))
          .filter((at) => at > -1),
      );
      expect(guard, `${path} should call the seam`).toBeGreaterThan(-1);
      expect(guard, `${path} guards before it reads`).toBeLessThan(firstRead);
    }
  });
});

// ── Completeness: no fourth kind, unclassified ─────────────────────────────
//
// 🚨 **This is the check the structural half was always FOR, and it did not
// exist.** The stated risk was "a seventh surface written next year by
// somebody who copied the sixth"; what the two enumerations actually caught
// was a surface somebody remembered to list. `app/dashboard/layout.tsx` read
// the inbox for eighteen commits and appeared in neither list, so nothing
// asked about it — the file was not wrong according to the test, it was
// invisible to it.
//
// So the lists are now measured against the tree rather than against
// themselves: anything that asks about private correspondence, or offers a way
// into it, has to be classified. Being unclassified is the failure.

describe("every DM-touching file is classified", () => {
  /** Where a surface could live. Deliberately wide. */
  const TREES = ["app", "components", "modules/community/lib"];

  function walk(dir: string): string[] {
    const full = join(ROOT, dir);
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(rel);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [rel]
        : [];
    });
  }

  it("leaves nothing that touches a DM reader or element unlisted", () => {
    const classified = new Set([
      ...Object.keys(DM_SURFACES),
      ...Object.keys(MIXED_SURFACES),
      // The DM machinery itself, and the one module that applies the seam for
      // presence questions. These are where the answers come FROM.
      // The DM machinery, one file per domain since `manage.ts` was split into
      // eleven — the same set as before, named rather than lumped.
      "modules/community/lib/messages.ts",
      "modules/community/lib/unread.ts",
      "modules/community/lib/live.ts",
      "modules/community/lib/reports.ts",
      "modules/community/lib/_blocks.ts",
      "modules/community/lib/dm-presence.ts",
      "modules/community/lib/dm-actor.ts",
      "modules/community/pages/messages/ui.tsx",
      "modules/community/components/dm-entry-point.tsx",
    ]);

    const unclassified: string[] = [];
    for (const tree of TREES) {
      for (const file of walk(tree)) {
        if (classified.has(file)) continue;
        const text = source(file);
        const touch = [...RAW_DM_READERS, ...DM_ELEMENTS].find((needle) =>
          text.includes(needle),
        );
        if (touch) unclassified.push(`${file} touches ${touch}`);
      }
    }

    expect(
      unclassified,
      "a file that asks about private correspondence — or offers a door into " +
        "it — is a DM surface or a mixed one. Being in neither list is how a " +
        "truthful unread badge survived an impersonation for eighteen " +
        `commits:\n  ${unclassified.join("\n  ")}`,
    ).toEqual([]);
  });

  it("walks a real tree", () => {
    // Non-vacuity: a broken walk would report nothing and pass. Measured
    // against the tree rather than guessed — `lib/community` holds six
    // non-test modules today, and `app` is where the surfaces live.
    expect(walk("modules/community/lib").length).toBeGreaterThanOrEqual(6);
    expect(walk("app").length).toBeGreaterThan(40);
    // …and the needles have to be findable at all, or every check above is a
    // green that means nothing.
    expect(source("modules/community/pages/page.tsx")).toContain(
      "hasUnreadMessages(",
    );
  });
});

// ── And the carve-out does not creep into the rooms ────────────────────────
//
// The other half of AC 3. Under an impersonation the group surfaces keep
// working AS THE MEMBER — posts are authored by the member, no moderator
// powers appear. That is a promise about what the room's code does NOT
// consult, so it is asserted the same way the block's non-effect is: on the
// source, which proves it cannot start rather than that it has not yet.

describe("group surfaces are untouched by the carve-out", () => {
  const ROOM_FILES = [
    "modules/community/pages/actions.ts",
    "modules/community/pages/groups/[groupId]/page.tsx",
    "modules/community/pages/discussions/[discussionId]/page.tsx",
    "modules/community/components/embedded-discussion.tsx",
    // The ROOM half of the old `manage.ts`. The DM files are deliberately not
    // here — they are the carve-out, and this block is about what it must not
    // reach.
    "modules/community/lib/groups.ts",
    "modules/community/lib/talk.ts",
    "modules/community/lib/embedded.ts",
    "modules/community/lib/moderation.ts",
  ];

  it("consults neither the seam nor the impersonation state", () => {
    const offenders: string[] = [];

    for (const path of ROOM_FILES) {
      const text = source(path);
      for (const needle of [...SEAM_CALLS, "impersonation"]) {
        if (text.includes(needle)) offenders.push(`${path} names ${needle}`);
      }
    }

    expect(
      offenders,
      "under an impersonation the rooms act as the member — that is FR-209's " +
        "other half. A group surface that consulted the carve-out would make " +
        "an operator's support session look like a suspended account:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("reads real files", () => {
    for (const path of ROOM_FILES) {
      expect(source(path).length, path).toBeGreaterThan(200);
    }
  });
});
