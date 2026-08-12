// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 **The one seam that decides whether a session may act on a private
// conversation — and the one that carves impersonation out of them entirely.**
//
// ── Why "private" has to survive the person who runs the app ──────────────
// Impersonation exists because the alternative is worse (`template/CLAUDE.md`
// carries that argument), and four properties make it defensible: it is
// narrow, visible, bounded and **recorded**. The record is the part that
// breaks here. `impersonations` records that an operator entered an account
// and when they left — it records ACCESS, and deliberately not what was done
// inside, because nothing in this app captures that. For every other surface
// that is a fair trade: what the operator CHANGED shows up in the ledger, the
// grants, the address history.
//
// A private conversation has nothing like that. Reading somebody's mail
// changes nothing, leaves no second trace, and is invisible to the one person
// it is about — so "recorded" would mean "an operator was in the account for
// thirty minutes", which is not an answer to "did anybody read my messages".
// FR-209 closes that by removing the capability rather than by logging it:
// under an impersonation the DM surfaces are not there at all.
//
// ── What this seam is, exactly ────────────────────────────────────────────
// It answers ONE question — "which member may act on a direct-message surface
// in this request" — and it answers `null` (or refuses) for an impersonated
// session. Every DM surface obtains its actor here and by no other route;
// `lib/community/impersonation-guard.test.ts` reads the files and fails the
// build when one of them stops doing so, the same mechanism
// `app/api/v1/guard-presence.test.ts` uses for the API's own door.
//
// ⚠️ **Epic 23's report path joins this seam.** FR-209 names read, send AND
// report; the report surfaces do not exist yet, and when they do they come
// through here rather than repeating the check. The structural test's
// enumeration is where that obligation is written down.
//
// ── Detecting the impersonation: read the session, and nothing else ───────
// `session.user.impersonation` is set while an operator is signed in as this
// member **and only then** (`auth.ts`, the session augmentation). Expiry is
// resolved on every read in `lib/impersonation/claim.ts`, so by the time the
// session callback has run, an expired claim already presents as the operator
// with `impersonation: null`. The condition here is therefore simply "is it
// set" — no token parsing, no database query, no expiry arithmetic. Any of
// those would be a second implementation of a decision that has already been
// made, and the second one is the one that drifts.
//
// ── Why the guard lives here and not in `manage.ts` ───────────────────────
// AD-59 gives the manage layer its shape: its readers take a participant id
// and never see a session, because a session is a delivery concern
// (`lib/authz.ts` is the precedent). Threading session objects down into every
// DM function would re-decide the layering the whole template uses. What makes
// a delivery-layer guard structural rather than hopeful is that a test reads
// the surfaces and counts them.
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

import { ACCESS_DENIED, currentActiveUser } from "@/lib/authz";
import { isCommunityEnabled } from "@/modules/community/lib/config";

/** Who may act on a direct-message surface — and if nobody, why not. */
export type DmActor =
  | { state: "actor"; memberId: string; role: string }
  /** No session, a blocked account, or the module is not running here. */
  | { state: "unavailable" }
  /**
   * An operator is signed in as this member.
   *
   * ⚠️ **Its own state below the delivery layer, and ONE rendering above it.**
   * The distinction exists here because the code has to be able to say what it
   * refused; it must never reach a screen. A sentence saying "not available
   * during a support session" would tell the operator which of their customers
   * has private conversations, and would tell the member — if they ever saw it
   * — nothing they can act on. AD-10 exactly: the code lives below, the
   * surface shows what a disabled surface shows.
   */
  | { state: "impersonated" };

/**
 * The decision itself, over a session that has already been established.
 *
 * Its own function because the live endpoint has already read the session — it
 * serves discussion scopes as well, and those keep working under an
 * impersonation (group surfaces act as the member, FR-209). Reading the
 * session a second time there would cost an extra query on a request that
 * repeats every five seconds, and would put a second copy of the condition in
 * the tree. So the condition lives here, once, and both variants below it are
 * wrappers.
 *
 * Pure and synchronous, which is what lets the behavioural test drive it with
 * a session fixture instead of a database.
 */
export function dmActorFrom(session: {
  user?: {
    id?: string | null;
    role?: unknown;
    impersonation?: unknown;
  };
}): DmActor {
  const user = session.user;
  if (!user?.id) return { state: "unavailable" };
  // The carve-out. ONE condition, because expiry has already been resolved by
  // the time a session carries this field — see the header.
  if (user.impersonation) return { state: "impersonated" };
  return { state: "actor", memberId: user.id, role: user.role as string };
}

/**
 * The handler-shaped variant — for route handlers, which answer rather than
 * redirect.
 *
 * `currentActiveUser()`'s twin: a `redirect()` inside a route handler answers
 * a `fetch()` with an HTML sign-in page, and the caller parses HTML as JSON.
 *
 * Enablement is checked here too, and first: every community surface signs
 * that contract per request, and a seam that answered "who may act" without it
 * would be a seam a caller could use to skip it.
 */
export async function currentDmActor(): Promise<DmActor> {
  if (!isCommunityEnabled()) return { state: "unavailable" };

  const current = await currentActiveUser();
  if (current.state !== "active") return { state: "unavailable" };

  return dmActorFrom(current.session);
}

/**
 * The page-shaped variant — for pages and Server Actions, which signal by
 * throwing.
 *
 * ⚠️ **An impersonated session gets `notFound()`, which is what a disabled
 * surface gets.** 19.1 decided the member-facing off-state: the community
 * answers the framework's not-found, for everyone, with no sentence anywhere.
 * This reuses that branch exactly rather than minting a wording — the whole
 * point of FR-209 is that a carved-out surface and an absent one are
 * indistinguishable. An operator inside a member's account learns nothing
 * about whether that member has any correspondence at all.
 *
 * A signed-out or blocked visitor still redirects to `/login`, because that is
 * the answer to "you are not signed in" and has nothing to do with this story.
 */
export async function requireDmActor(): Promise<{
  memberId: string;
  role: string;
}> {
  if (!isCommunityEnabled()) notFound();

  const current = await currentActiveUser();
  if (current.state === "anonymous") redirect("/login");
  if (current.state === "blocked") redirect(`/login?error=${ACCESS_DENIED}`);

  const actor = dmActorFrom(current.session);
  if (actor.state !== "actor") notFound();

  return { memberId: actor.memberId, role: actor.role };
}
