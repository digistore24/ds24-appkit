// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// User management rules — deliberately PURE functions, no database.
//
// Why they are separate: these rules keep an operator from locking themselves
// out, or from leaving the app without an admin. That makes them
// security-relevant, and they have to be testable one by one
// (lib/users/rules.test.ts).
//
// The database layer (lib/users/manage.ts) calls them BEFORE it writes.
//
// LANGUAGE: this layer returns NO finished sentences, only codes
// (`"selfDelete"`). Translation happens in the UI via the `errors` namespace
// in `messages/*.json`. A sentence written here would exist in exactly one
// language — and that would not necessarily be the user's.
import type { Role } from "@/lib/roles";

/** The admin performing the action. */
export interface Actor {
  id: string;
  role: string;
}

/** The user being acted upon. */
export interface Target {
  id: string;
  role: string;
  /** Blocked since — null/undefined means "not blocked". */
  blockedAt?: Date | null;
  email?: string | null;
}

/**
 * Every reason for refusal. Each code MUST have a text in `messages/*.json`
 * under `errors` — `i18n/messages.test.ts` enforces that.
 */
export const USER_ERROR_CODES = [
  "notOwner",
  "selfDelete",
  "lastOwnerDelete",
  "selfDemote",
  "lastOwnerRole",
  "selfBlock",
  "lastOwnerBlock",
  "invalidEmail",
  "emailTaken",
  "userNotFound",
  "userBlocked",
  "userWithoutEmail",
  "emailNotConfigured",
  "selfImpersonate",
  "ownerImpersonate",
  "moderatorImpersonate",
  "nonMemberImpersonate",
  "alreadyImpersonating",
  "impersonationDisabled",
  "notImpersonating",
] as const;

export type UserErrorCode = (typeof USER_ERROR_CODES)[number];

/** Result of a check. `null` = allowed, otherwise the reason. */
export type Denial = UserErrorCode | null;

/**
 * An error carrying a translatable reason. The server actions catch it and
 * turn it into a message in the user's language via `t(code)`.
 */
export class UserError extends Error {
  readonly code: UserErrorCode;

  constructor(code: UserErrorCode) {
    // The message IS the code — it belongs in logs, not in front of people.
    super(code);
    this.name = "UserError";
    this.code = code;
  }
}

/**
 * May `actor` delete the user `target`?
 *
 * Forbidden:
 *  - not being an admin,
 *  - deleting yourself (you would lock yourself out),
 *  - deleting the last remaining admin (nobody could get back in).
 */
export function canDeleteUser(
  actor: Actor,
  target: Target,
  ownerCount: number,
): Denial {
  if (actor.role !== "owner") return "notOwner";
  if (actor.id === target.id) return "selfDelete";
  if (target.role === "owner" && ownerCount <= 1) return "lastOwnerDelete";
  return null;
}

/**
 * May this person delete their OWN account?
 *
 * A different question from `canDeleteUser`, and deliberately so. That one
 * refuses self-deletion outright (`selfDelete`) because it guards the Operator's
 * user list, where deleting yourself is always a mistake — you would be
 * removing an admin by misclicking a row menu.
 *
 * Here it is the point. Art. 17 GDPR gives a person the right to have their data
 * erased, and an app where the only way out is to email support is an app that
 * makes exercising a right depend on somebody answering the phone.
 *
 * **One refusal survives**: the last remaining owner. Not for their sake but for
 * the installation's — an app with no admin has no way back in, and no support
 * desk that could let them. They can hand the role to somebody else first. This
 * is not a GDPR problem: nothing stops that person deleting the account once
 * another owner exists, and the refusal is temporary and in their own hands.
 *
 * Note what is NOT a reason to refuse: a running subscription. It is a real
 * problem — billing continues at Digistore24 with no account behind it — but
 * the answer to it is to say so plainly before the button is pressed, not to
 * withhold erasure until the customer has tidied up. Refusing would be the
 * violation; the warning is in `app/dashboard/account/ui.tsx`.
 */
export function canDeleteOwnAccount(actor: Actor, ownerCount: number): Denial {
  if (actor.role === "owner" && ownerCount <= 1) return "lastOwnerDelete";
  return null;
}

/**
 * May `actor` set `target`'s role to `newRole`?
 *
 * Forbidden:
 *  - not being an admin — the owner ALONE touches roles, and that includes
 *    granting and revoking "moderator" (FR-204): a moderator who could mint
 *    moderators would be an admin with extra steps,
 *  - demoting yourself (you would lose access immediately — and
 *    owner→moderator IS a demotion; a moderator is not an admin),
 *  - turning the last admin into anything else. Only owners count here:
 *    a moderator is never a way back into a locked-out app.
 *
 * Setting the role that already applies is allowed — and deliberately a no-op.
 */
export function canChangeRole(
  actor: Actor,
  target: Target,
  newRole: Role,
  ownerCount: number,
): Denial {
  if (actor.role !== "owner") return "notOwner";
  if (target.role === newRole) return null;
  if (actor.id === target.id && newRole !== "owner") return "selfDemote";
  if (target.role === "owner" && newRole !== "owner" && ownerCount <= 1)
    return "lastOwnerRole";
  return null;
}

/** May `actor` create users at all? */
export function canCreateUser(actor: Actor): Denial {
  if (actor.role !== "owner") return "notOwner";
  return null;
}

/**
 * May `actor` block or unblock the user `target`?
 *
 * Blocking means: no new sign-in, and the running session ends on the next
 * page load (lib/users/blocked.ts). That makes it almost as drastic as
 * deleting — only reversible. Hence the same safeguards:
 *  - not being an admin,
 *  - blocking yourself (you could not get back in to lift it),
 *  - blocking the last remaining admin.
 *
 * A moderator is deliberately NOT a special case: they are blocked like any
 * member, and the block strips nothing extra (FR-204). Blocking already ends
 * the session via lib/users/blocked.ts, and duties are inert without a usable
 * account — when the Group-Moderator duty table arrives (19.5), a blocked
 * moderator's duty rows stay, harmless, because every session of theirs is
 * refused. No cleanup is needed then, and none may be invented.
 *
 * UNBLOCKING is always allowed: it grants nobody rights they did not already
 * have, and a state you cannot get out of would be a trap.
 */
export function canBlockUser(
  actor: Actor,
  target: Target,
  ownerCount: number,
  blocked: boolean,
): Denial {
  if (actor.role !== "owner") return "notOwner";
  if (!blocked) return null;
  if (actor.id === target.id) return "selfBlock";
  if (target.role === "owner" && ownerCount <= 1) return "lastOwnerBlock";
  return null;
}

/**
 * May `actor` change `target`'s email address?
 *
 * In this app the address IS the identity — it is where the sign-in link goes.
 * Changing it therefore means: whoever held the old address can no longer get
 * in, and whoever holds the new one can. Only admins may do that.
 *
 * Whether the address itself is usable and still free is decided by the
 * database layer (normalizeEmail, or the unique index → "emailTaken").
 */
export function canChangeEmail(actor: Actor): Denial {
  if (actor.role !== "owner") return "notOwner";
  return null;
}

/**
 * May `actor` send the user `target` a sign-in link?
 *
 * Forbidden:
 *  - not being an admin,
 *  - an account without an email address (there would be nowhere to send it),
 *  - a blocked account — a link that leads nowhere only confuses.
 */
export function canSendLoginLink(actor: Actor, target: Target): Denial {
  if (actor.role !== "owner") return "notOwner";
  if (!target.email) return "userWithoutEmail";
  if (target.blockedAt) return "userBlocked";
  return null;
}

/** What the app knows about the impersonation the actor is (or is not) already in. */
export interface ImpersonationContext {
  /** Is the feature switched on at all? `config/impersonation.json`. */
  enabled: boolean;
  /** Is this actor already acting as somebody else? */
  alreadyImpersonating: boolean;
}

/**
 * May `actor` sign in as the user `target`?
 *
 * This is the whole security of the impersonation feature, which is why it is a
 * pure function with a test per branch rather than a series of checks spread
 * across a menu and a form. Every refusal below is repeated by nothing else —
 * the server action asks this and only this.
 *
 * Forbidden:
 *  - not being an admin,
 *  - the feature being switched off (`config/impersonation.json`),
 *  - already impersonating somebody — a chain has no end anybody can see, and
 *    the record could not say who is really at the keyboard,
 *  - yourself (there would be nothing to step into),
 *  - **an admin.** This is the privilege-escalation rule and the reason the
 *    check cannot live in the menu: every guard in this app answers from
 *    `session.user.role`, so impersonating an owner hands the impersonator
 *    every right that owner holds — including this feature. A request that
 *    never passed through the menu has to be refused identically.
 *  - **a moderator**, and anybody else who is not a plain member. The rule is
 *    operator→member (FR-204): a moderator's badge in a room must never be an
 *    operator in disguise — whoever answers under that badge is the person it
 *    names, always. ⚠️ An earlier version of this comment said "not escalation
 *    — an impersonated session's role is `member` either way", and that was
 *    simply false: `lib/impersonation/session.ts` sets `token.role =
 *    member.role`, so the session carries the TARGET's role verbatim. Once
 *    Epic 23 hangs duties off that value, impersonating a moderator IS an
 *    escalation. The false premise is what let the second refusal layer in
 *    `session.ts` keep asking only about owners.
 *  - the refusal below is written as an ALLOWLIST for that reason. `users.role`
 *    is `text` with no enum, so the set of values is open; refusing everything
 *    that is not `"member"` cannot go stale when a role is added, where a list
 *    of the roles we currently dislike goes stale in silence.
 *  - a BLOCKED account. Not because it is uninteresting, but because
 *    `requireActiveUser()` (lib/authz.ts) sends a blocked session to
 *    `/login?error=AccessDenied`, and the banner carrying the way out lives
 *    inside the app. The Operator would be ejected into a session they can
 *    neither see nor end. To look at a blocked account, unblock it first.
 */
export function canImpersonate(
  actor: Actor,
  target: Target,
  context: ImpersonationContext,
): Denial {
  if (actor.role !== "owner") return "notOwner";
  if (!context.enabled) return "impersonationDisabled";
  if (context.alreadyImpersonating) return "alreadyImpersonating";
  if (actor.id === target.id) return "selfImpersonate";
  if (target.role === "owner") return "ownerImpersonate";
  if (target.role === "moderator") return "moderatorImpersonate";
  // Everything that is not a plain member, named generically. The two lines
  // above stay because their codes say something useful to the operator; this
  // one is the floor, and it is what keeps the rule true for a role nobody has
  // added yet — or for a value written straight into the column.
  if (target.role !== "member") return "nonMemberImpersonate";
  if (target.blockedAt) return "userBlocked";
  return null;
}

/**
 * May this session STOP impersonating?
 *
 * Deliberately not `requireOwner()`, and this is the sharpest edge in the whole
 * feature: while an impersonation runs, the session's role IS the member's
 * (AD-23), so an owner check here would refuse the one action that gets the
 * Operator out again — an unescapable session. The only precondition is that an
 * impersonation is in fact running.
 *
 * It takes no target and no id for the same reason `spendTokens()` takes no
 * member id: the session it ends is always the caller's own.
 */
export function canStopImpersonating(context: {
  alreadyImpersonating: boolean;
}): Denial {
  if (!context.alreadyImpersonating) return "notImpersonating";
  return null;
}

/**
 * How long an impersonation lasts before it ends by itself, in minutes.
 *
 * Long enough to work through a support ticket, short enough that a laptop
 * somebody walked away from is bounded. It is a constant rather than a setting
 * because nobody has asked for a second value, and a setting nobody changes is
 * a field somebody eventually sets to a year.
 */
export const IMPERSONATION_MINUTES = 30;

/**
 * Has this impersonation run out?
 *
 * Pure, and takes `now` rather than reading the clock, so the boundary is
 * testable. The comparison is `>=` on purpose: at exactly the expiry moment the
 * session is over, not in its final millisecond.
 */
export function impersonationExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}

/**
 * The longest address this app will accept — the limit RFC 5321 puts on a
 * forward path, so nothing deliverable is turned away.
 *
 * It is a security bound rather than a formatting one. `users.email` and
 * `email_changes.newEmail` are unbounded `text`, and an address also becomes a
 * key in the in-memory rate-limit map (lib/rate-limit.ts). Without a cap, a
 * signed-in Member can hand the server a megabyte per request and have it
 * stored and retained; the pattern that matched before this line accepted a
 * 200,000-character address in a millisecond.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Normalizes and validates an email input.
 * @returns the trimmed, lowercased address, or null if it is unusable.
 */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Checked before the pattern, and on the RAW input: the point is to refuse
  // absurd input cheaply, not to measure it after work has been done on it.
  if (input.length > MAX_EMAIL_LENGTH) return null;
  const email = input.trim().toLowerCase();
  // Deliberately simple: one character before and after the @, a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Longest display name the app stores. A label beside an avatar, not a
 * document — and, like the address above, refused cheaply on the raw input.
 */
export const MAX_DISPLAY_NAME_LENGTH = 120;

/**
 * Normalizes a member's own display name.
 *
 * `null` (or an empty string) is a VALID answer meaning "clear it" — the
 * column is nullable and an account without a name renders fine everywhere.
 * That is the difference from `checkKeyName` in `lib/api-keys/rules.ts`,
 * where a blank would make a list unusable. Returns `{ ok: false }` only for
 * input that is not a name at all: a non-string, or one past the cap.
 */
export function checkDisplayName(
  value: unknown,
): { ok: true; name: string | null } | { ok: false } {
  if (value === null) return { ok: true, name: null };
  if (typeof value !== "string") return { ok: false };
  if (value.length > MAX_DISPLAY_NAME_LENGTH) return { ok: false };
  const name = value.trim().replace(/\s+/g, " ");
  return { ok: true, name: name === "" ? null : name };
}
