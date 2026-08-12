// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **Whether a session has any direct-message presence at all — for the pages
// that are not DM surfaces but carry one thing that is.**
//
// ── The third kind of surface, and why the taxonomy needed it ─────────────
// `lib/community/impersonation-guard.test.ts` enumerates two kinds: a DM
// surface, which must obtain its actor from `dm-actor.ts`, and a room surface,
// which must not name the carve-out at all — because under an impersonation
// the rooms go on acting AS THE MEMBER, and a group page that consulted the
// seam would make a support session look like a suspended account.
//
// Three files fit neither. The community landing page is a room surface that
// also shows a "New" badge on its Messages tile; the dashboard shell's sidebar
// dot is `rooms || inbox`; a member's profile is a room surface that offers a
// "write to them" button. Each is mostly room and carries exactly one thing
// derived from private correspondence.
//
// While there was no third kind, all three took the room's rule and read the
// inbox directly. So an operator impersonating a member saw a truthful badge —
// **"this member has unread private correspondence"** — on a page whose sibling
// route answers 404 to the same session. That is precisely the disclosure
// FR-209 removes the capability to make, arrived at by the one door nobody
// classified. It was found by the SM-17 gateway pass on 2026-08-06 and sat in
// the ledger until the taxonomy could hold it.
//
// ── What this module is ───────────────────────────────────────────────────
// The seam, applied once, for presence questions rather than for acts. It
// answers "is there a DM surface for this session at all", and for an
// impersonated session the answer is no — so a mixed page renders the room
// half unchanged and simply has nothing to show for the other one.
//
// ⚠️ **It lives here rather than in `manage.ts` on purpose.** `manage.ts` is a
// room file in that test's enumeration and may not name the carve-out; the
// readers there answer about a MEMBER, and who the member of this request is
// stays a question for the seam. One module, one direction.
import { unreadMessagesFor } from "./manage";
import { dmActorFrom, type DmActor } from "./dm-actor";

/** The session shape both readers need — `auth.ts`'s, narrowed. */
type Session = Parameters<typeof dmActorFrom>[0];

/**
 * May this session be offered a direct-message surface at all?
 *
 * `false` under an impersonation, and that is the whole of it: a button that
 * leads somewhere the same session answers 404 for is a door painted on a
 * wall. The member's own session is unaffected.
 */
export function mayUseDmSurfaces(session: Session): boolean {
  const actor: DmActor = dmActorFrom(session);
  return actor.state === "actor";
}

/**
 * Does this session have unread private correspondence?
 *
 * ⚠️ **`false` under an impersonation, before any query runs.** The refusal is
 * not "hide the badge after asking" — asking is the disclosure. An operator
 * who could tell a member with an unread message from one with none has
 * learned something about that member's correspondence, which is what FR-209
 * removes rather than logs.
 */
export async function hasUnreadMessages(session: Session): Promise<boolean> {
  const actor = dmActorFrom(session);
  if (actor.state !== "actor") return false;
  return unreadMessagesFor(actor.memberId);
}

/**
 * The same question, asked of a `ModuleViewer` instead of a session.
 *
 * 🚨 **A second entry point, not a second rule.** `shellState()` is handed a
 * viewer — `{ memberId, role, impersonating }` — and has no session to give
 * `hasUnreadMessages()`. The tempting shortcut is for `module.ts` to call
 * `unreadMessagesFor()` itself and check the flag inline; that is exactly what
 * `impersonation-guard.test.ts` refuses, because it puts the carve-out in a
 * second place and the second place is the one that gets forgotten when
 * somebody adds a third surface.
 *
 * So the carve-out stays here, once, and the refusal is still BEFORE any query:
 * asking is the disclosure.
 */
export async function hasUnreadMessagesForViewer(viewer: {
  memberId: string;
  impersonating: boolean;
}): Promise<boolean> {
  if (viewer.impersonating) return false;
  return unreadMessagesFor(viewer.memberId);
}
