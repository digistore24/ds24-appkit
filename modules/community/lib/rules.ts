// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The community's pure core. No I/O, no database, no config read — functions
// in here take values and answer values, and the vitest beside this file
// exercises them directly (the spine fixes this path as the module's rules
// layer; later stories add threshold arithmetic and the content-state reader
// here).
//
// ⚠️ **"No config read" is load-bearing rather than tidy, and it is easy to
// break by accident.** This file is imported by CLIENT components
// (`app/dashboard/account/community-profile-ui.tsx` reads the caps from here),
// so anything it imports is bundled for the browser. `groupPlanProblems()`
// wants to know whether a product key is one an entitlement can ever answer
// for — and the obvious way to get that, importing `planProblem()` from
// `lib/media/config.ts`, would have shipped `config/digistore-products.json`
// (prices, Digistore24 product ids) into the browser on every account page.
// So the check is a PARAMETER: the shell hands it in, this file stays pure,
// and `lib/community/config.ts`'s "not a client component" rule keeps holding
// for the whole module.
import type { Limit } from "@/lib/rate-limit";
import { isOwner } from "@/lib/roles";

/**
 * Every reason the community refuses something. Each code MUST have a text in
 * `messages/*.json` under `errors` — `i18n/messages.test.ts` enforces that.
 */
export const COMMUNITY_ERROR_CODES = [
  /**
   * The member has not chosen a display name, so they cannot take part yet.
   *
   * Reading the community never needs one; writing into it always does — a
   * post, a reply, a direct message, a follow. See `canParticipate()`.
   */
  "communityProfileIncomplete",
  /** The display name was missing, blank, or longer than the cap. */
  "communityDisplayNameInvalid",
  /** The "about" text was longer than the cap. */
  "communityAboutTooLong",
  /** The "about" field was not text at all — a malformed request, not a long one. */
  "communityAboutInvalid",
  /**
   * The community is not running on this installation.
   *
   * ⚠️ **It has no member-facing caller, and must not get one.** AD-67 reserves
   * this code for the operator's diagnosis view — every member-facing branch
   * renders nothing at all, because a sentence saying the community is not
   * active tells a probing member that a community module EXISTS on this
   * installation, which is the distinction FR-180 is built to erase.
   *
   * Story 19.3 briefly used it in the account card's action and a code review
   * took it back out: that action now returns the generic `unknown`. The code
   * stays declared for the operator's surfaces, which is what 19.1's AC 6
   * asked for.
   */
  "communityOff",
  /** A group was asked for by an id nothing answers to (or one already gone). */
  "notFound",
  /** A group's name was missing, blank, or longer than the cap. */
  "communityGroupNameInvalid",
  /** A group's description was longer than the cap. */
  "communityGroupDescriptionTooLong",
  /**
   * A group's description arrived as something that is not text.
   *
   * Its own code, the `communityAboutInvalid` lesson applied a third time. It used to
   * answer `{ ok: true, description: null }` — success, with the operator's
   * text silently thrown away and a "saved" toast over the top of it.
   * `formData.get()` returns `string | File | null`, so this is reachable.
   */
  "communityGroupDescriptionInvalid",
  /**
   * A plan-gated group named a product key the registry cannot answer for —
   * a typo, a retired product, or a token package (a balance is not an
   * entitlement, so `hasPlan()` answers false for it for ever and nobody would
   * ever get in). Refused when the group is SAVED, never at a member's read:
   * `hasPlan()` throws on an unknown key, so an unvalidated one would take the
   * page down rather than mean "no access". The sentence names the key.
   */
  "communityUnknownPlanKey",
  /** A plan-gated group was saved with no product keys — a door with no key. */
  "communityPlanKeysRequired",
  /**
   * Somebody was made group moderator who does not hold the moderator role.
   *
   * Its own code rather than `notOwner`: this refusal is about the TARGET, not
   * about the caller, and one code for two unrelated conditions produces a
   * sentence nobody can act on (the `communityAboutInvalid` lesson, applied again).
   */
  "communityNotModerator",
  /** A thread was closed to new posts — the state exists, the act arrives later. */
  "communityDiscussionLocked",
  /** A discussion title was missing, blank, or longer than the cap. */
  "communityTitleInvalid",
  /** A post was empty, or nothing that renders. */
  "communityPostEmpty",
  /** A post was longer than the cap. */
  "communityPostTooLong",
  /**
   * A post already carries a deletion event.
   *
   * At most ONE per row, and the refusal matters in one direction in
   * particular: an author must not be able to write their own deletion over a
   * moderator's removal and relabel it as tidying-up.
   */
  "communityAlreadyDeleted",
  /** Too many posts from one member in a short time. A cost and noise brake. */
  "communityPostRateLimited",
  /**
   * An embedded discussion is not this member's to read or write.
   *
   * ⚠️ **ONE code for TWO conditions, and here that is the whole point** —
   * everywhere else in this file a second condition gets a second code so the
   * sentence is one somebody can act on. "There is no such Subject Key" and
   * "there is one and you are not entitled to it" are merged in
   * `mayViewEmbed()`, exactly once, so that no surface below the delivery
   * layer ever holds the two apart and none can leak the difference by
   * accident. A member who could tell them apart could walk a course's table
   * of contents by trying keys, which is the structure of something they have
   * not bought.
   *
   * Which is also why the sentence in `messages/*.json` names neither
   * condition: it says the discussion is not available here, and stops.
   */
  "communityNotEntitled",
  /**
   * The counterpart of a direct message cannot receive it.
   *
   * ⚠️ **ONE code for every cause, and the neutrality IS the feature** — the
   * second place in this file where merging is deliberate, and the reasoning
   * is `communityNotEntitled`'s applied to a person instead of a room. No such member,
   * a blocked account, a deleted account — and, from Story 21.2, a member who
   * blocked this sender. FR-201 requires the block's refusal to be
   * indistinguishable from any other undeliverable message, and a refusal is
   * only indistinguishable if the surfaces are the same one: give any cause
   * its own wording and "she has blocked you" becomes readable by comparison,
   * which is precisely what a block must not announce.
   *
   * So the sentence in `messages/*.json` names no cause at all. It says the
   * message could not be delivered, and stops.
   */
  "communityNotDeliverable",
  /** A direct message was empty, or nothing that renders. */
  "communityMessageEmpty",
  /** A direct message was longer than the cap. */
  "communityMessageTooLong",
  /** Too many direct messages from one member in a short time. */
  "communityMessageRateLimited",
  /**
   * A moderator removed a post without saying why.
   *
   * Its own code rather than a generic one: the reason is what makes a
   * removal reviewable, and "say why" is a sentence somebody can act on.
   */
  "reasonRequired",
  /**
   * Somebody tried to report their own content.
   *
   * Its own code because the sentence is one they can act on ("that is
   * yours"), and because merging it into `notFound` would make the report
   * button lie about a post that is plainly on screen.
   */
  "communityCannotReportOwn",
  /** Too many reports from one member in a short time. */
  "communityReportRateLimited",
  /**
   * The automatic send-block stands: this member may read but not write.
   *
   * The sentence says they are blocked and that a moderator can lift it —
   * never who reported them and never the arithmetic. Both would turn a
   * safety brake into a scoreboard.
   */
  "communitySendBlocked",
  /** A moderator's own report is among the ones being acted on. */
  "communityConflictOfInterest",
  /** The thread is already closed — locking it again would record nothing. */
  "communityAlreadyLocked",
  /** …and it is not closed, so there is nothing to open. */
  "communityNotLocked",
  /**
   * More pictures on one post than `posting.imagesMax` allows.
   *
   * The sentence carries the number, so raising the ceiling cannot leave a
   * message quoting the old one — and it is refused BEFORE any byte is read,
   * which is why it is a code of its own rather than a media refusal: nothing
   * about the files is wrong, there are too many of them.
   */
  "communityTooManyImages",
  /**
   * A picture arrived with no description of what it shows.
   *
   * ⚠️ **Required rather than optional, and this code is where that decision is
   * enforced.** `components/ui/figure.tsx` makes "an image with no alternative
   * text" a compile error for the page author; a picture a MEMBER uploads is the
   * one case the type cannot reach, because the text arrives at runtime from a
   * form. So the form asks for it and the server insists — a post image nobody
   * described is one a screen-reader member cannot perceive at all, and this is
   * the one surface in the app where the reader is another member rather than
   * the operator.
   *
   * One code for "missing", "blank" and "longer than the cap", exactly as
   * `communityDisplayNameInvalid` covers the same three — the sentence carries
   * the cap and is one a member can act on either way.
   */
  "communityImageAltInvalid",
  /**
   * This community does not take pictures in posts (`posting.imagesMax: 0`).
   *
   * Its own code because the composer renders no upload field in that state, so
   * anything arriving here is a crafted request — and a Server Action is a
   * public endpoint. The sentence is honest rather than generic: the operator
   * turned pictures off, which is a product decision a member may as well be
   * told about, unlike the module's own enablement (FR-180).
   */
  "communityImagesOff",
] as const;

export type CommunityErrorCode = (typeof COMMUNITY_ERROR_CODES)[number];

export class CommunityError extends Error {
  readonly code: CommunityErrorCode;
  /**
   * Values the translated sentence needs — e.g. `{ key: "basic_monthly" }`
   * for `communityUnknownPlanKey`, whose whole point is naming the key the operator
   * mistyped. The delivery layer passes it straight into `t(code, detail)`;
   * it never contains anything a member typed, and never anything private.
   */
  readonly detail: Record<string, string> | undefined;

  constructor(
    code: CommunityErrorCode,
    message?: string,
    detail?: Record<string, string>,
  ) {
    // The message IS the code — it belongs in logs, not in front of people.
    super(message ?? code);
    this.name = "CommunityError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Does the community get a navigation entry?
 *
 * The `chatNavVisible()` decision (`lib/ai/rules.ts`), made again for the
 * second `featureKey`, identically — the shell's header comment demands the
 * question be answered anew, and the answer is the same:
 *
 *   usable                → everyone sees the entry.
 *   wanted but not usable → the OPERATOR sees it, because the same flag that
 *                           hides a broken feature would hide the one page
 *                           that says what is broken. Members see nothing.
 *   not wanted            → nobody sees it. Disabled means gone — for the
 *                           operator too (AD-67: groups are configured after
 *                           switching on, and that is a decision, not a gap).
 *
 * ⚠️ Cosmetics, like every `featureKey`. `/dashboard/community` answers
 * not-found on its own when the community is off — a menu entry is not a
 * permission and its absence is not a check.
 */
export function communityNavVisible(
  usable: boolean,
  wanted: boolean,
  isOwner: boolean,
): boolean {
  if (usable) return true;
  return wanted && isOwner;
}

/**
 * Where the member's community profile sits on `/dashboard/account`.
 *
 * The account page is long — balance, plans, sign-in, consent, this module's
 * card, then the two data-protection cards — and the community's "choose a
 * name first" hint has to land somebody ON the box rather than on the page it
 * is somewhere inside. So the hint links to the anchor and the card wears it
 * as an `id`.
 *
 * It is one constant because the two halves live in different files and
 * neither can be read out of the other: drop the `id` and the link still
 * navigates, to the top of the page, silently — the failure mode of a deep
 * link is never an error. `profile-anchor.test.ts` holds both sides to this
 * name — the clamp every deep link in this template needs: the target renders
 * the `id` in the SAME commit that starts pointing at it.
 */
export const COMMUNITY_PROFILE_ANCHOR = "community-profile";

/** The hint's target — derived, so the anchor cannot be forgotten here. */
export const COMMUNITY_PROFILE_HREF = `/dashboard/account#${COMMUNITY_PROFILE_ANCHOR}`;

/**
 * Longest display name the community stores. Same cap and same reasoning as
 * `MAX_DISPLAY_NAME_LENGTH` in `lib/users/rules.ts` — a label beside an avatar,
 * not a document — and refused on the RAW input, before any work is done on it.
 */
export const MAX_COMMUNITY_DISPLAY_NAME_LENGTH = 120;

/**
 * Longest "about" text. A line about me, not a biography: the profile page is
 * a place to recognise somebody, and a member who needs more room is writing a
 * post. Bounded cheaply on the raw input for the same reason as the name — a
 * signed-in member can otherwise hand the server a megabyte per request and
 * have it stored and retained.
 */
export const MAX_COMMUNITY_ABOUT_LENGTH = 500;

/**
 * Characters that are present in a string and absent from a screen.
 *
 * Zero-width spaces and joiners, the bidi overrides, the BOM. `trim()` and
 * `\s` follow the ECMAScript definition of whitespace, which contains none of
 * these — so a name of three U+200B characters survives both, is stored in a
 * NOT NULL column, satisfies `canParticipate()` and renders as a blank author
 * beside a blank avatar. That is precisely the "row of blanks"
 * `displayNameFor()` exists to prevent, arrived at from the other side.
 *
 * U+202A–U+202E and U+2066–U+2069 are in here for a second reason: they do not
 * merely fail to render, they change how the text AROUND them renders. A name
 * carrying an override reverses its neighbours in every list it appears in.
 */
const INVISIBLE = /[\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/** The part of a string a person would actually see — used only for emptiness tests. */
function visibleLength(value: string): number {
  return value.replace(INVISIBLE, "").trim().length;
}

/**
 * Bidi OVERRIDES — a different problem, with a different answer.
 *
 * A zero-width character contributes nothing, so it is simply not counted. An
 * override contributes nothing either, but it changes how the text AROUND it
 * renders — a name carrying one reorders its neighbours in every list it
 * appears in, so "not counted" is not a sufficient answer. It is refused.
 *
 * This does NOT touch right-to-left names. Arabic and Hebrew render correctly
 * from the characters' own properties; the bidi algorithm needs no help, and
 * these controls exist to OVERRIDE it rather than to express it. A member
 * writing their name in Hebrew is unaffected, and the test beside this file
 * says so rather than leaving it to be assumed.
 */
const BIDI_OVERRIDE = /[\u202A-\u202E\u2066-\u2069]/;

/**
 * What the community calls this person.
 *
 * The fallback chain, in order, and it is the same one everywhere a member is
 * shown — post authors in 19.6, DM partners in Epic 21, a follower list in
 * Epic 22 all resolve through here rather than each inventing a rule:
 *
 *   1. the name they chose for the community,
 *   2. else the name on their account,
 *   3. else a neutral, stable placeholder.
 *
 * **Never the email address, and never blank.** The template's default sign-up
 * is a magic link, and such an account has NO name at all — so step 3 is the
 * common case on a fresh app rather than an edge, and getting it wrong means
 * either an address on screen beside somebody's words or a row of blanks.
 *
 * Pure: the caller hands in the joined row. A renderer showing forty posts
 * resolves forty names without forty queries, which is the reason this takes
 * values rather than a member id.
 *
 * ── Why the placeholder LABEL is an input ─────────────────────────────────
 * Step 3 produces a user-visible string, and this file is below the delivery
 * layer, where a sentence may not be born (AD-10). Since step 3 is the COMMON
 * case on a fresh app, hardcoding an English "Member" here would have put the
 * single most-rendered string in the module permanently in one language — a
 * German member reading `Member 8f41d7` beside every post. So the caller
 * passes the translated word in (`t("memberPlaceholder")`), and this function
 * stays pure while the language stays the request's.
 */
export function displayNameFor(input: {
  profileName: string | null;
  accountName: string | null;
  memberId: string;
  /** The translated word for an unnamed member — e.g. "Mitglied" / "Member". */
  placeholderLabel: string;
}): string {
  // `visibleLength`, not `trim()`: a name of zero-width characters is a name
  // that renders as nothing, and falling through to the account name is the
  // only answer that keeps "never blank" true.
  const profileName = input.profileName?.trim();
  if (profileName && visibleLength(profileName) > 0) return profileName;

  const accountName = input.accountName?.trim();
  if (accountName && visibleLength(accountName) > 0) return accountName;

  // The placeholder. Stable per member — the same person is called the same
  // thing on every page and across sessions, which is what makes a thread
  // readable before anybody has named themselves.
  //
  // Derived from the id's LAST characters: member ids are `crypto.randomUUID()`
  // (see `db/schema.ts`), so the tail is random hex and carries nothing about
  // the person. A prefix would be equally random today, but the tail keeps
  // this honest if ids ever gain a structured prefix. Nothing here is
  // reversible into an address, and it deliberately reads as a placeholder
  // rather than impersonating a chosen name.
  //
  // TWELVE characters, not six. Six hex digits is a 16.7M space, and two
  // distinct members collide with 50% probability at about 4,800 of them —
  // measured, not estimated. Since the placeholder is the common case rather
  // than the edge, a community of a few thousand unnamed members would
  // reliably contain two different people rendering identically in one thread,
  // with nothing on the page to tell them apart. Twelve moves that boundary
  // past any community this template will hold.
  const suffix = input.memberId.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
  return `${input.placeholderLabel} ${suffix || "?"}`.trim();
}

/**
 * May this member write into the community?
 *
 * The single core refusal every participation write calls — posting and
 * replying (19.6), sending a direct message (Epic 21), following somebody
 * (Epic 22). READING never asks it: a member who has not named themselves may
 * look around, and being made to fill in a form before seeing what the place
 * even is would be the wrong order.
 *
 * ⚠️ **It has no caller yet, and that is correct.** No participation surface
 * exists at this point in the epic. It ships now, with tests, so that the
 * story which adds the first one wires this in rather than inventing a second
 * answer to the same question — and so that the answer is decided while the
 * profile shape is being decided, not under the pressure of a composer that
 * needs to render.
 *
 * The UI gating that goes with it — a disabled composer with "choose a name
 * first" — is cosmetics on top of this, never instead of it (AD-69).
 *
 * @param profile the member's profile row, or `null` when they have none.
 */
export function canParticipate(
  profile: { displayName: string | null } | null,
): "communityProfileIncomplete" | null {
  if (!profile) return "communityProfileIncomplete";
  // The same visibility test the input check uses. A row written before that
  // check existed — or by a script, or by a later import — can still hold a
  // name that renders as nothing, and letting it post would put unattributable
  // words in a thread.
  if (!profile.displayName || visibleLength(profile.displayName) === 0) {
    return "communityProfileIncomplete";
  }
  return null;
}

/**
 * Normalizes and validates a community display name.
 *
 * **Blank is a REFUSAL here, where `checkDisplayName` in `lib/users/rules.ts`
 * treats it as "clear the field".** The two look alike and mean opposite
 * things, so the difference is worth stating: an account name is optional and
 * an account without one renders fine everywhere, so clearing it is a real
 * choice. A community profile exists in order to put a name beside somebody's
 * words — clearing it would leave a row that `canParticipate()` must then
 * refuse, i.e. a profile that silently stops working. There is no such state:
 * a member either has a name or has no row.
 */
export function checkCommunityDisplayName(
  value: unknown,
): { ok: true; name: string } | { ok: false; code: "communityDisplayNameInvalid" } {
  if (typeof value !== "string")
    return { ok: false, code: "communityDisplayNameInvalid" };
  // On the raw input, before trimming — the point is to refuse absurd input
  // cheaply rather than to measure it after work has been done on it.
  if (value.length > MAX_COMMUNITY_DISPLAY_NAME_LENGTH) {
    return { ok: false, code: "communityDisplayNameInvalid" };
  }
  const name = value.trim().replace(/\s+/g, " ");
  // Not `name === ""`. A name made of zero-width characters is not empty by
  // that test and is entirely empty on screen — it would be stored NOT NULL,
  // satisfy `canParticipate()`, and render as a blank author.
  if (visibleLength(name) === 0)
    return { ok: false, code: "communityDisplayNameInvalid" };
  if (BIDI_OVERRIDE.test(name))
    return { ok: false, code: "communityDisplayNameInvalid" };
  // Refused even WITH visible text beside it: an override reorders the
  // neighbouring text wherever the name is listed, so it is not a question of
  // how much of the name is visible.
  return { ok: true, name };
}

/**
 * Normalizes and validates the optional "about" text.
 *
 * Blank IS meaningful here, unlike the name: it means "I have not written one",
 * which is the shipped state of every profile and a perfectly good answer. It
 * normalises to `null` so the column carries the `NULL` means "not" idiom the
 * rest of this schema uses, rather than storing an empty string that renders
 * as an empty paragraph.
 */
export function checkCommunityAbout(
  value: unknown,
):
  | { ok: true; about: string | null }
  | { ok: false; code: "communityAboutTooLong" | "communityAboutInvalid" } {
  if (value === null || value === undefined) return { ok: true, about: null };
  // Its OWN code. Returning `communityAboutTooLong` here told a member "at most 500
  // characters" about a value that might be three characters or a file — one
  // code for two unrelated conditions produces a sentence nobody can act on.
  if (typeof value !== "string") return { ok: false, code: "communityAboutInvalid" };

  // Line endings are normalised BEFORE the cap is measured. A browser submits
  // a textarea with CRLF, so a text the `maxLength` attribute accepted (which
  // counts `\n` as one) can be two characters longer by the time it arrives —
  // and the member is refused for a text they can see is short enough, with
  // nothing on screen explaining the difference.
  // A loose guard on the RAW input, ahead of the rewrite that copies it.
  // Twice the cap, not the cap: the CRLF normalisation below can halve the
  // length, so the real measurement has to happen after it — see
  // `checkGroupDescription` for the full argument.
  if (value.length > MAX_COMMUNITY_ABOUT_LENGTH * 2)
    return { ok: false, code: "communityAboutTooLong" };
  const text = value.replace(/\r\n/g, "\n");
  if (text.length > MAX_COMMUNITY_ABOUT_LENGTH)
    return { ok: false, code: "communityAboutTooLong" };
  // Trailing whitespace goes; the shape of what they wrote stays — a member may
  // legitimately use line breaks in a few sentences about themselves.
  const about = text.trim();
  return { ok: true, about: visibleLength(about) === 0 ? null : about };
}

// ───────────────────────────────────────────────────────────────────────────
// Groups — the rooms, and the one function that decides who is in one
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four access levels a room can have. Exactly one per group, never a set.
 *
 * The order is the one the operator's select renders in, and it runs from the
 * most open to the most closed on purpose: whoever is picking one reads down
 * the list and stops at the first that is narrow enough.
 */
export const GROUP_ACCESS_LEVELS = [
  "open",
  "plan",
  "moderators",
  "operator",
] as const;

export type GroupAccessLevel = (typeof GROUP_ACCESS_LEVELS)[number];

/** Is this arbitrary value one of the four levels? (Form input, always.) */
export function isGroupAccessLevel(value: unknown): value is GroupAccessLevel {
  return (
    typeof value === "string" &&
    (GROUP_ACCESS_LEVELS as readonly string[]).includes(value)
  );
}

/** Longest group name. A label at the top of a room, not a sentence. */
export const MAX_GROUP_NAME_LENGTH = 120;

/** Longest group description. One or two sentences saying what belongs in here. */
export const MAX_GROUP_DESCRIPTION_LENGTH = 500;

/**
 * May this viewer enter this room?
 *
 * **The module's pure heart, and the one place the four levels are decided.**
 * Every surface that lists, opens or writes into a group goes through here —
 * the member's list of doors, the group page, and every write the shell makes
 * — so there is exactly one answer to "who is in this room" and no second
 * place for it to drift.
 *
 * ⚠️ **It takes `grantedKeys`, and it never asks for them.** No `hasPlan()`
 * call, no database, no await: the shell resolves which of the app's product
 * keys this member currently holds and hands the set in, and this function
 * compares. That is what makes the whole matrix testable without a database —
 * and what keeps a renderer from issuing one entitlement query per group.
 *
 * ⚠️ **`plan` is ANY-of, not all-of.** FR-188 says "one or more named
 * products", and any-of is the reading that survives a plan switch: a
 * Digistore24 upgrade delivers two events days apart, so a member is briefly
 * holding both keys — or neither. All-of would lock an upgrading customer out
 * of the room they are in the middle of paying more for. Do not flip this.
 *
 * ⚠️ **A `plan` room is not opened by being the operator.** The levels are
 * about entitlement and role separately, and only `moderators`/`operator`
 * are role questions. An operator who wants to sit in their own paid room
 * grants themselves the plan (`grantByHand()` on the support page) — one row,
 * visible, revocable, and the same mechanism every other member came in
 * through. A silent role bypass here would mean the operator's view of a room
 * is not the view they are configuring.
 *
 * An archived room is closed to everybody on the member side. The operator
 * still reaches it through the admin surface, which does not ask this
 * function — administering a room is not entering it.
 */
export function mayEnterGroup(
  group: {
    accessLevel: GroupAccessLevel;
    planKeys: readonly string[];
    archivedAt: Date | null;
  },
  viewer: { role: string; grantedKeys: readonly string[] },
): boolean {
  if (group.archivedAt) return false;

  switch (group.accessLevel) {
    case "open":
      // Any active member. The caller has already established there IS a
      // session — `requireActiveUser()` at the surface — so "active member" is
      // the precondition of asking at all, not a fifth thing to check here.
      return true;
    case "plan":
      return group.planKeys.some((key) => viewer.grantedKeys.includes(key));
    case "moderators":
      return isOwner(viewer.role) || viewer.role === "moderator";
    case "operator":
      return isOwner(viewer.role);
  }
}

/**
 * May this viewer see this embedded discussion — and is there one to see?
 *
 * **The single place "no such Subject Key" and "not entitled" become the same
 * answer.** Both produce `communityNotEntitled`; `null` means yes. Merging here rather
 * than at each surface is what makes the indistinguishable refusal a property
 * of the design instead of a discipline four call sites have to keep: the
 * delivery layer only ever receives one code, so there is nothing for it to
 * tell apart and no way for a later surface to start telling it apart.
 *
 * ⚠️ **The declaration is the provenance, and it comes from
 * `lib/community/embeds.ts` — never from the request.** The component takes a
 * Subject Key and the host page's heading; it never takes an access level and
 * never takes plan keys, because a gate the browser sends is no gate.
 *
 * ⚠️ **It answers by calling `mayEnterGroup()`, deliberately.** An embed has
 * the same four levels a room has, and this module has ONE access grammar. A
 * second `switch` over the levels here is how "plan is any-of, not all-of"
 * comes to mean two different things on two surfaces. An embed cannot be
 * archived — there is no row to archive, the declaration is code — so
 * `archivedAt` is `null` by construction rather than by a field nobody sets.
 *
 * Pure, like everything else in this file: the shell resolves which product
 * keys this member holds right now (AD-60, at the moment of the read) and
 * hands the set in.
 */
export function mayViewEmbed(
  declaration: {
    accessLevel: GroupAccessLevel;
    planKeys: readonly string[];
  } | null,
  viewer: { role: string; grantedKeys: readonly string[] },
): "communityNotEntitled" | null {
  // Undeclared. Not its own code — see the header, and `communityNotEntitled`'s own
  // comment up in the code list.
  if (!declaration) return "communityNotEntitled";
  return mayEnterGroup({ ...declaration, archivedAt: null }, viewer)
    ? null
    : "communityNotEntitled";
}

/**
 * Which of a room's product keys need asking about — empty for every level
 * except `plan`.
 *
 * Exists so the shell can resolve the UNION of keys across the rooms it is
 * about to render, ask `hasPlan()` once per distinct key, and feed one set to
 * every `mayEnterGroup()` call. Without it a list of twelve rooms would issue
 * twelve × keys queries for an answer bounded by the number of distinct keys
 * the operator configured.
 */
export function planKeysToResolve(
  groups: ReadonlyArray<{
    accessLevel: GroupAccessLevel;
    planKeys: readonly string[];
  }>,
): string[] {
  const keys = new Set<string>();
  for (const group of groups) {
    if (group.accessLevel !== "plan") continue;
    for (const key of group.planKeys) keys.add(key);
  }
  return [...keys];
}

/**
 * What is wrong with a room's product keys — `null` when nothing is.
 *
 * **Asked when the group is SAVED, never when it is read.** `hasPlan()` throws
 * on a key the registry does not know, so a key that slipped through here does
 * not produce "no access": it produces a 500 on the page that lists the room,
 * for a paying member who did nothing wrong. `lib/media/config.ts` reached the
 * same conclusion for `requiresPlan` on a stored file, and its `planProblem()`
 * is what the shell passes in as `problemFor` — one answer to "can an
 * entitlement ever be true for this key", used by both, never re-implemented.
 * (Why a parameter rather than an import: the file header. This module is
 * bundled for the browser.)
 *
 * Keys on a non-`plan` room are not checked and not kept: the shell stores an
 * empty list for every other level, so a room switched from `plan` to `open`
 * cannot leave a stale key behind to be validated against a registry that has
 * moved on.
 *
 * The empty list gets its OWN refusal. `communityUnknownPlanKey` would have to name a
 * key, and there is none to name — a plan room with no keys is a door with no
 * key, which is a different mistake with a different fix.
 */
export function groupPlanProblems(
  input: {
    accessLevel: GroupAccessLevel;
    planKeys: readonly string[];
  },
  /** `planProblem` from `lib/media/config.ts` — why a key can never be held. */
  problemFor: (key: string) => string | null,
):
  | { code: "communityPlanKeysRequired" }
  | { code: "communityUnknownPlanKey"; key: string; reason: string }
  | null {
  if (input.accessLevel !== "plan") return null;
  if (input.planKeys.length === 0) return { code: "communityPlanKeysRequired" };

  for (const key of input.planKeys) {
    const reason = problemFor(key);
    if (reason) return { code: "communityUnknownPlanKey", key, reason };
  }
  return null;
}

/**
 * Normalizes and validates a room's name.
 *
 * Blank is a refusal, as it is for a display name and for the same reason: the
 * name is how the room is referred to everywhere, and a room called nothing is
 * a row of blanks in the member's list. `visibleLength`, not `trim()` — a name
 * of zero-width characters passes `trim()` and renders as nothing.
 */
export function checkGroupName(
  value: unknown,
): { ok: true; name: string } | { ok: false; code: "communityGroupNameInvalid" } {
  if (typeof value !== "string") return { ok: false, code: "communityGroupNameInvalid" };
  // On the RAW input, before any work is done on it.
  if (value.length > MAX_GROUP_NAME_LENGTH)
    return { ok: false, code: "communityGroupNameInvalid" };
  const name = value.trim().replace(/\s+/g, " ");
  if (visibleLength(name) === 0) return { ok: false, code: "communityGroupNameInvalid" };
  // Bidi overrides reorder the text AROUND them — in a nav list, in a page
  // title, in the admin table. Refused for the same reason a display name is.
  if (BIDI_OVERRIDE.test(name)) return { ok: false, code: "communityGroupNameInvalid" };
  return { ok: true, name };
}

/**
 * Normalizes and validates a room's optional description.
 *
 * Blank is meaningful here — it means the operator wrote none — and normalises
 * to `null`, the `NULL` means "not" idiom this schema uses throughout.
 *
 * ⚠️ **Absent and unreadable are different answers.** `null`/`undefined` is
 * the operator writing none and succeeds; anything else that is not a string
 * is REFUSED. It used to answer success with the value dropped, which meant a
 * `File` part — `formData.get()` returns `string | File | null` — wiped an
 * existing description and reported "saved" over the top of it. Silent data
 * loss reported as success is the one outcome a validator must never produce.
 */
export function checkGroupDescription(
  value: unknown,
):
  | { ok: true; description: string | null }
  | { ok: false; code: "communityGroupDescriptionTooLong" | "communityGroupDescriptionInvalid" } {
  if (value === null || value === undefined)
    return { ok: true, description: null };
  if (typeof value !== "string")
    return { ok: false, code: "communityGroupDescriptionInvalid" };
  // A loose guard on the RAW input, before the rewrite allocates a copy of it.
  // NOT the real cap: normalising CRLF can halve the length, and a textarea
  // legitimately arrives longer than the `maxLength` attribute counted — the
  // test below pins exactly that. Twice the cap is the tightest bound that
  // cannot refuse a value which would have fitted, and it is what stops a
  // signed-in caller handing the server a megabyte to rewrite, store, index
  // and export.
  if (value.length > MAX_GROUP_DESCRIPTION_LENGTH * 2) {
    return { ok: false, code: "communityGroupDescriptionTooLong" };
  }
  // CRLF then, and the real cap is measured after it.
  const text = value.replace(/\r\n/g, "\n");
  if (text.length > MAX_GROUP_DESCRIPTION_LENGTH) {
    return { ok: false, code: "communityGroupDescriptionTooLong" };
  }
  const description = text.trim();
  return {
    ok: true,
    description: visibleLength(description) === 0 ? null : description,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Talk — discussions, posts, and the safe rendering of somebody else's words
// ───────────────────────────────────────────────────────────────────────────

/**
 * Longest discussion title. A line in a list, not a post in disguise.
 */
export const MAX_DISCUSSION_TITLE_LENGTH = 200;

/**
 * Longest post. Generous — somebody answering a question properly needs room —
 * and bounded anyway, on the RAW input, for the reason every cap in this file
 * exists: a signed-in member can otherwise hand the server a megabyte per
 * request and have it stored, indexed, exported and retained.
 */
export const MAX_POST_LENGTH = 10_000;

/** The rate-limit bucket for posting. The module's first of three. */
export const COMMUNITY_POST_RATE_BUCKET = "community-post";

/**
 * How often one member may write.
 *
 * The `chatLimit()` shape (`lib/ai/rules.ts`), ten minutes for the same
 * reason: this is a noise and cost brake, not a security control, and it has
 * to forgive somebody genuinely answering five people in a row.
 *
 * ⚠️ In memory and per process — `lib/rate-limit.ts` carries the full caveat.
 * Behind several instances every limit is multiplied by their number. That is
 * a property of the shape this template ships with, not an oversight.
 */
export function postLimit(maxPosts: number): Limit {
  return { max: maxPosts, windowMs: 10 * 60 * 1000 };
}

/**
 * What a reader is allowed to see of one post.
 *
 * ⚠️ **The ONLY reader of `deletedAt` and `deletedBy`.** No renderer, no query
 * and no export interprets those columns itself — everything asks here, so the
 * four states cannot drift apart per surface. The three deleted ones are three
 * different sentences on screen, deliberately: "the author deleted this", "a
 * moderator removed this" and "the account was deleted" are not the same thing
 * to whoever is reading the thread, and one boolean would make a moderator's
 * decision look like a member's change of mind.
 *
 * `deletedAt` is the fact; `deletedBy` says whose act it was. A row with a
 * timestamp and no actor is not a state this app writes, and it resolves to
 * `authorDeleted` — the mildest reading, which is the right way to be wrong
 * about a row that should not exist.
 */
export function contentState(post: {
  deletedAt: Date | null;
  deletedBy: "author" | "moderator" | "system" | null;
}): "visible" | "authorDeleted" | "moderatorRemoved" | "accountDeleted" {
  if (!post.deletedAt) return "visible";
  if (post.deletedBy === "moderator") return "moderatorRemoved";
  if (post.deletedBy === "system") return "accountDeleted";
  return "authorDeleted";
}

/**
 * What a thread's title renders as.
 *
 * The twin of `contentState()` one level up: a title is the starter's own
 * words, so an account deletion scrubs it — and a renderer needs to know the
 * difference between "this thread has no title" (impossible;
 * `checkDiscussionTitle()` refuses a blank one) and "the person who wrote it
 * is gone". The empty string in the database is the marker, and the sentence
 * the reader sees is chosen in the delivery layer, in their language.
 */
export function titleState(discussion: {
  title: string;
}): "visible" | "scrubbed" {
  return discussion.title === "" ? "scrubbed" : "visible";
}

/**
 * May this member start a thread in this room?
 *
 * Participation needs a name — `canParticipate()`, the one refusal every write
 * in this module asks, wired in here for the first time. Reading never asks
 * it: a member may look around before filling anything in.
 */
export function canStartDiscussion(
  profile: { displayName: string | null } | null,
): "communityProfileIncomplete" | null {
  return canParticipate(profile);
}

/**
 * May this member write into this thread?
 *
 * Participation first, then the thread's own state. The order is the one the
 * reader of an error message would want: "choose a name" is about them and
 * they can act on it; "this thread is closed" is about the thread.
 */
export function canPost(
  profile: { displayName: string | null } | null,
  discussion: { lockedAt: Date | null },
): "communityProfileIncomplete" | "communityDiscussionLocked" | null {
  const participation = canParticipate(profile);
  if (participation) return participation;
  if (discussion.lockedAt) return "communityDiscussionLocked";
  return null;
}

/**
 * May this post be deleted — and is this the caller's post to delete?
 *
 * **At most one deletion event per row.** A second attempt is refused rather
 * than allowed to overwrite the first, and the direction that matters is an
 * author writing over a moderator's removal: the wording on screen would
 * change from "removed by a moderator" to "deleted by the author", which is
 * the record of a moderation decision being erased by the person it was about.
 *
 * Authorship is checked here AND scoped in the UPDATE itself. The second is
 * what makes an IDOR impossible; this one is what produces a sentence instead
 * of a silent no-op.
 */
export function canDeleteOwnPost(
  post: { authorId: string | null; deletedAt: Date | null },
  memberId: string,
  discussion: { lockedAt: Date | null },
): "notFound" | "communityAlreadyDeleted" | "communityDiscussionLocked" | null {
  // Not "notAuthor": somebody else's post is not a post this member has, and
  // saying "that is not yours" confirms it exists. Same posture as the group
  // page's one indistinguishable absence.
  if (post.authorId !== memberId) return "notFound";
  if (post.deletedAt) return "communityAlreadyDeleted";
  // A lock freezes the thread — see `canEditOwnPost` for the whole argument.
  // Ordered AFTER `communityAlreadyDeleted` so a second delete still reports the state
  // of the row rather than the state of the room: "already deleted" is the
  // truer sentence, and it is the one that keeps the one-deletion-event rule
  // legible.
  if (discussion.lockedAt) return "communityDiscussionLocked";
  return null;
}

/**
 * May this member edit their own post?
 *
 * ⚠️ **A lock stops edits, not only new posts.** `canPost()` alone left
 * "locked" meaning "no new rows", so every participant could still rewrite the
 * content of every post they owned in a thread a moderator had just closed —
 * including replacing the exact text that caused the lock. Editing is
 * publishing; a thread nobody may write into is a thread nobody may rewrite.
 *
 * The same holds for an author's own deletion (`canDeleteOwnPost` above), and
 * that half is the less obvious one: withdrawing your own words reads like a
 * different act from adding new ones. It is refused anyway, because a lock is
 * usually applied to an argument in progress and deleting your side of it
 * rewrites the record just as effectively as editing it. A member who wants
 * their words out of a locked thread asks the operator, or deletes their
 * account — the one path that scrubs every post they ever wrote.
 *
 * Nothing writes `lockedAt` yet; the moderation release does. This function is
 * what makes `db/schema-community.ts`'s "the core already refuses a write into
 * a locked thread so that the act is all that is missing" true — it was not
 * when that comment was written.
 */
export function canEditOwnPost(
  post: { authorId: string | null; deletedAt: Date | null },
  memberId: string,
  discussion: { lockedAt: Date | null },
): "notFound" | "communityAlreadyDeleted" | "communityDiscussionLocked" | null {
  if (post.authorId !== memberId) return "notFound";
  // A deleted post cannot be edited back into existence. The UPDATE's WHERE
  // enforces it too; this is what produces a sentence instead of a no-op.
  if (post.deletedAt) return "communityAlreadyDeleted";
  if (discussion.lockedAt) return "communityDiscussionLocked";
  return null;
}

/**
 * Normalizes and validates a discussion title.
 *
 * Same shape as a group name and for the same reasons: blank is a refusal, the
 * cap is measured on the raw input, and a bidi override is refused outright
 * because it reorders the text AROUND it — in a thread list, that is every
 * neighbouring title.
 */
export function checkDiscussionTitle(
  value: unknown,
): { ok: true; title: string } | { ok: false; code: "communityTitleInvalid" } {
  if (typeof value !== "string") return { ok: false, code: "communityTitleInvalid" };
  if (value.length > MAX_DISCUSSION_TITLE_LENGTH) {
    return { ok: false, code: "communityTitleInvalid" };
  }
  const title = value.trim().replace(/\s+/g, " ");
  if (visibleLength(title) === 0) return { ok: false, code: "communityTitleInvalid" };
  if (BIDI_OVERRIDE.test(title)) return { ok: false, code: "communityTitleInvalid" };
  return { ok: true, title };
}

/**
 * Normalizes and validates a post's text.
 *
 * Line breaks survive — a post is prose and paragraphs are part of it — and
 * CRLF is normalised BEFORE the cap is measured, so a text the browser's own
 * `maxLength` accepted cannot be refused for two characters the member cannot
 * see.
 *
 * A bidi override is NOT refused here, and the difference from a name is
 * deliberate: inside a block of prose an override affects that post's own
 * text, which is the author's to mangle; in a NAME it reorders every
 * neighbouring row of a list. What protects the page instead is that the post
 * is rendered as text nodes in its own element.
 */
export function checkPostContent(
  value: unknown,
): { ok: true; content: string } | { ok: false; code: "communityPostEmpty" | "communityPostTooLong" } {
  if (typeof value !== "string") return { ok: false, code: "communityPostEmpty" };
  // A loose guard on the RAW input, ahead of the global replace that copies
  // all of it. Twice the cap rather than the cap itself: CRLF normalisation
  // can halve the length and a browser submits a textarea with CRLF, so the
  // real measurement belongs after the rewrite. What this refuses is the
  // megabyte — the case `MAX_POST_LENGTH`'s own comment is about.
  if (value.length > MAX_POST_LENGTH * 2)
    return { ok: false, code: "communityPostTooLong" };
  const text = value.replace(/\r\n/g, "\n");
  if (text.length > MAX_POST_LENGTH) return { ok: false, code: "communityPostTooLong" };
  const content = text.trim();
  // `visibleLength`, not `=== ""`: a post of zero-width characters renders as
  // an empty bubble with somebody's name on it.
  if (visibleLength(content) === 0) return { ok: false, code: "communityPostEmpty" };
  return { ok: true, content };
}

/**
 * One picture on a post, ready to render and carrying no id anybody could act
 * on.
 *
 * ⚠️ **Addresses, never a media id.** `FeedItem.authorAvatarMediaId` explains
 * the same distinction from the other side: an id is not permission, and a shape
 * that carried one would invite a renderer to mint its own address without the
 * `mayAccess()` check that `postImagesFor()` performs. `mediaId` is here only
 * because React needs a stable key and because the Art. 15 answer names the
 * picture by it — it is the same value the member's own export already holds.
 *
 * Every field is JSON-safe: this crosses the live wire unchanged (`wirePost()`),
 * so `PostView` on the client reads exactly this.
 *
 * ⚠️ **Declared HERE rather than in `manage.ts`, and that is not filing.** The
 * composer and the post list are `"use client"`, and a type imported from
 * `manage.ts` would put the module's database layer in a client file's import
 * graph — erased at compile time, yes, and one refactor away from somebody
 * importing a value beside it. `rules.ts` is the pure half both sides already
 * read; `manage.ts` re-exports the name so a server caller needs no second
 * import.
 */
export interface PostImage {
  /** The `media` row's id. A key and an export reference, never an address. */
  mediaId: string;
  src: string;
  /** `mediaImageFor().srcSet` — `null` when there is nothing to choose from. */
  srcSet: string | null;
  /** The original's measured size, or `null` for a picture stored before 26.2. */
  width: number | null;
  height: number | null;
  /**
   * What the member said the picture shows.
   *
   * `null` only for a row written before the description became required (there
   * are none in any shipped app) or one edited by hand. The renderer takes
   * `Figure`'s `decorative` branch then, exactly as the courses unit page does
   * for a cover with no `alt` — never an empty `alt`, which is the half-state
   * `Figure` exists to refuse.
   */
  alt: string | null;
}

/**
 * The media types the picker filters on for a post image.
 *
 * The three `lib/media/exif.ts` strips location data from, which is the whole
 * reason these bytes travel through the app — offering a fourth would mean
 * offering one this app cannot clean. Still only a browser hint: what the file IS
 * is decided from its first bytes, on the server (`acceptUpload()`).
 */
export const POST_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * What the composer is allowed to offer, as the client reads it.
 *
 * Three numbers that all come from somewhere else — the module's own config, the
 * core's media ceilings, the reader's locale — assembled once on the server
 * (`postImagePolicy()` in `manage.ts`) and handed down as one prop. A client
 * component computing any of them would be a second copy of a ceiling, and
 * `components/ui/media-upload.tsx` says in its own header why it knows no number
 * itself: at least one of three copies is wrong.
 */
export interface PostImagePolicy {
  /** `posting.imagesMax`. **Zero means the composer offers nothing at all.** */
  max: number;
  /** What may reach a Server Action — the lower of the slot cap and the kind's. */
  ceilingBytes: number;
  /** That ceiling as a sentence-ready string, formatted for the reader's locale. */
  maxLabel: string;
}

/**
 * Longest description of a picture a member attached.
 *
 * A sentence saying what is in the picture, not a second post — and bounded for
 * the reason every cap in this file is: it is stored on a `media` row, read back
 * into every reader's page and handed over in a subject access request.
 */
export const MAX_IMAGE_ALT_LENGTH = 200;

/**
 * The pictures on one post, judged before a single byte is read.
 *
 * ⚠️ **Pure, and it deliberately never sees the files.** What it decides —
 * are pictures allowed here at all, are there too many, has each one been
 * described — needs a COUNT and the descriptions, and nothing about the bytes.
 * Keeping it that way is what lets the caller refuse a fifty-picture post
 * without buffering fifty files first, which is the whole reason the count
 * ceiling is checked here rather than inside the upload loop.
 *
 * What the bytes ARE is a different question with a different owner:
 * `acceptUpload()` sniffs them, applies the role's ceiling and strips the
 * location data. This function must not grow a second opinion about any of that.
 *
 * `alts` is positional — the nth description belongs to the nth file, which is
 * how two repeated form fields arrive and the only ordering a form can express.
 * A missing, blank or over-long one is refused rather than defaulted: `Figure`
 * takes `alt` or `decorative`, and "decorative" is a claim about the picture
 * that nobody here is in a position to make.
 */
export function checkPostImages(
  count: number,
  alts: readonly unknown[],
  max: number,
):
  | { ok: true; alts: string[] }
  | {
      ok: false;
      code: "communityImagesOff" | "communityTooManyImages" | "communityImageAltInvalid";
    } {
  if (count === 0) return { ok: true, alts: [] };
  // `max: 0` is the operator's "this community is text". The composer renders no
  // field in that state, so anything arriving here is a crafted request — and a
  // Server Action is a public endpoint, which is why the refusal is here rather
  // than left to the absence of a form control.
  if (max <= 0) return { ok: false, code: "communityImagesOff" };
  if (count > max) return { ok: false, code: "communityTooManyImages" };

  const described: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = alts[index];
    if (typeof value !== "string") return { ok: false, code: "communityImageAltInvalid" };
    const alt = value.trim();
    // `visibleLength`, not `=== ""` — the `checkPostContent()` rule applied to
    // the one field whose whole job is to be read out loud: a description made
    // of zero-width characters is silence with a length.
    if (visibleLength(alt) === 0 || alt.length > MAX_IMAGE_ALT_LENGTH) {
      return { ok: false, code: "communityImageAltInvalid" };
    }
    described.push(alt);
  }
  return { ok: true, alts: described };
}

// ───────────────────────────────────────────────────────────────────────────
// Direct messages — the pure half
// ───────────────────────────────────────────────────────────────────────────

/**
 * Order two member ids into the conversation's column order.
 *
 * ⚠️ **The ONE place this arithmetic lives.** `community_conversations` stores
 * two explicit participant columns with a CHECK saying `a < b` and a unique
 * index over the pair (AD-73), so "who is a" has to be answered the same way
 * by the writer, by every reader and by the tests — a second call site
 * comparing them the other way round would insert (y, x) beside an existing
 * (x, y) if the CHECK ever loosened, and would silently match nothing while it
 * holds.
 *
 * A plain string comparison, which is what Postgres does for `text` — so this
 * function and the constraint are the same comparison rather than two that
 * agree today. The same reasoning as `compareCursor()`'s tie-break.
 *
 * `null` when the two ids are the same person: a conversation with oneself is
 * not a state this app writes, and refusing it here means no write path has to
 * remember to.
 */
export function canonicalPair(
  a: string,
  b: string,
): { participantAId: string; participantBId: string } | null {
  if (a === b) return null;
  return a < b
    ? { participantAId: a, participantBId: b }
    : { participantAId: b, participantBId: a };
}

/**
 * Is this member one of the two?
 *
 * Trivial, and it exists so that no surface writes the comparison itself: the
 * DM invariant is "every read is scoped by a participant id", and a scoping
 * rule enforced by one named function is one a structural test can point at.
 */
export function isParticipant(
  conversation: {
    participantAId: string | null;
    participantBId: string | null;
  },
  memberId: string,
): boolean {
  return (
    conversation.participantAId === memberId ||
    conversation.participantBId === memberId
  );
}

/**
 * The other person in a conversation, from one participant's point of view.
 *
 * `null` when their account is gone — the FK NULLs the column and the
 * conversation stays (FR-203), so "the other side is nobody now" is a normal
 * state the inbox renders as a former member rather than an error.
 */
export function counterpartOf(
  conversation: {
    participantAId: string | null;
    participantBId: string | null;
  },
  memberId: string,
): string | null {
  if (conversation.participantAId === memberId) return conversation.participantBId;
  if (conversation.participantBId === memberId) return conversation.participantAId;
  return null;
}

/**
 * May this member send a direct message at all?
 *
 * Participation first — the one refusal every community WRITE asks, and a
 * direct message is a write. Reading an inbox never asks it, for the same
 * reason reading a room does not: a member may look around before filling
 * anything in.
 *
 * Whether the COUNTERPART can receive is a separate question, answered against
 * the database in `manage.ts` and merged into `communityNotDeliverable` — see that code
 * for why every cause shares one sentence.
 */
export function canSendMessage(
  profile: { displayName: string | null } | null,
): "communityProfileIncomplete" | null {
  return canParticipate(profile);
}

/**
 * Can a message reach this counterpart at all?
 *
 * 🚨 **Every "no" is the same "no", and that is the whole function.** Four
 * causes go in and one code comes out: writing to oneself, an account that
 * does not exist, an account the operator blocked, and a standing member
 * block between the pair. FR-201 requires the member block's refusal to be
 * indistinguishable from any other undeliverable message — and a refusal is
 * only indistinguishable if the causes never separate above this point. So
 * they are merged HERE, once, in a pure function, rather than in four call
 * sites that agree today.
 *
 * ── The block bites in BOTH directions, and that is a decided reading ──────
 * FR-201 says "the blocked member can no longer start or continue a private
 * conversation with them", which strictly names one direction. The decision
 * recorded here is that a standing block makes the pair mutually
 * undeliverable for NEW messages: the blocker chose silence, and a channel
 * where only the blocker may still talk is not a quieter channel — it is a
 * megaphone with a mute button on the other end. Epic 22 severs follows in
 * both directions on the same reasoning.
 *
 * **Reading history stays.** A block hides nothing that was already
 * delivered; it refuses what has not been sent yet. Deletion is Story 21.4's
 * instrument and it is a different one.
 *
 * The caller gathers the facts; this decides. `blockedEitherWay` is one
 * boolean rather than two on purpose — a caller that could ask "who blocked
 * whom" would be a caller that could answer it, and that answer is what the
 * neutral refusal exists not to give.
 */
export function canDeliverTo(input: {
  /** Is the counterpart the sender themselves? */
  self: boolean;
  /** The counterpart's account, or `null` when there is none. */
  target: { blockedAt: Date | null } | null;
  /** Is there a member block between the two, in either direction? */
  blockedEitherWay: boolean;
}): "communityNotDeliverable" | null {
  if (input.self) return "communityNotDeliverable";
  if (!input.target) return "communityNotDeliverable";
  if (input.target.blockedAt !== null) return "communityNotDeliverable";
  if (input.blockedEitherWay) return "communityNotDeliverable";
  return null;
}

/**
 * May this member block that one?
 *
 * `null` when they may. Blocking oneself is the only refusal, and it is here
 * rather than in the write path so the surface gets a sentence instead of a
 * row nobody can lift: a self-block would make every one of that member's own
 * conversations undeliverable, and `canDeliverTo()` refuses a self-send
 * anyway, so the row would be pure damage.
 *
 * Notice what is NOT a refusal: no justification is asked for, no cooldown, no
 * operator approval, no limit on how many people somebody blocks. That is
 * FR-201's "self-service" taken literally — an inbox is theirs.
 */
export function canBlockMember(
  blockerId: string,
  blockedId: string,
): "communityNotDeliverable" | null {
  return blockerId === blockedId ? "communityNotDeliverable" : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Moderation — who may act, and what is written down when they do
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every act that lands in `community_moderation_audit`.
 *
 * A `const` union rather than a database enum, deliberately: later stories add
 * values, and an enum would need a migration for each one. The column is
 * `text` and this list is what may go in it.
 */
export const MODERATION_ACTS = [
  /** A moderator removed a post. Carries a reason, always. */
  "removePost",
  /** A thread was closed to new posts. */
  "lockDiscussion",
  /** …and opened again. Its OWN row — never an edit of the lock's. */
  "unlockDiscussion",
  /**
   * 🚨 **A moderator was shown part of a private conversation.**
   *
   * The one exception the direct-message guard ever grants (AD-71), and the
   * reason this act exists at all: "who saw what of my correspondence" has to
   * have an answer. The row's `exposedMessageIds` is exactly the reported
   * message plus whatever the REPORTER chose to attach — never a range, never
   * a neighbourhood, never a conversation.
   */
  "dmVisibility",
  /** A report was looked at and dealt with. */
  "consumeReport",
  /** The automatic send-block crossed its threshold. */
  "sendBlockFallen",
  /** …and a moderator lifted it. */
  "blockLifted",
] as const;

export type ModerationAct = (typeof MODERATION_ACTS)[number];

/**
 * May this person moderate here?
 *
 * ⚠️ **The inputs are read from the DATABASE at the moment of the act, never
 * from the session.** A JWT carries the role somebody had when they signed in;
 * an operator who takes the moderator role away at eleven expects it gone at
 * eleven, not at the next sign-in. `lib/users/blocked.ts` carries the same
 * argument for the account block, and `moderationAuthority()` in `manage.ts`
 * is the read that feeds this function.
 *
 * ── The two answers ───────────────────────────────────────────────────────
 * The **operator** moderates everywhere and needs no duty row — which is also
 * why an empty duty list on a room means "the operator looks after it" rather
 * than "nobody does" (`db/schema-community.ts` says so at the duty table).
 * A **moderator** may act only in a room a duty row names them for: the role
 * alone grants nothing, which is the whole distinction between the third role
 * and an admin.
 *
 * ── Embedded discussions: the operator's, and any moderator's ─────────────
 * FR-206 scopes a duty by GROUP, and an embedded discussion has none — it
 * hangs off a page of the app. Two readings were available: nobody but the
 * operator, or any moderator holding a duty anywhere. The second is recorded
 * here, because the first leaves the one kind of thread that appears inside a
 * paid course with no moderator at all, and a member reporting a post there
 * would be waiting for the operator personally. A moderator who is trusted
 * with a room is trusted with the lesson pages of the same app.
 */
export function mayModerate(
  actor: { role: string; blockedAt: Date | null },
  /** The room the act is in — `null` for an embedded discussion. */
  groupId: string | null,
  /** The rooms this actor holds a duty for, read fresh. */
  duties: readonly string[],
): "notFound" | null {
  // A blocked account is not an actor, whatever its role says. Refused here
  // as well as at the session guard, because this function is the one every
  // act asks.
  if (actor.blockedAt !== null) return "notFound";
  if (isOwner(actor.role)) return null;
  if (actor.role !== "moderator") return "notFound";

  // The embedded leg — see the header.
  if (groupId === null) return duties.length > 0 ? null : "notFound";

  return duties.includes(groupId) ? null : "notFound";
}

/**
 * May this post be removed by a moderator, with this reason?
 *
 * Two refusals, and the first is AD-72's one-deletion-event rule read from the
 * moderator's side: a post that already carries a deletion event is not
 * removed again. That matters in both directions — a moderator must not
 * overwrite an author's own deletion (the screen would stop saying "the author
 * deleted this" about something the author did), and nothing may overwrite an
 * earlier removal.
 *
 * The reason is required and is the whole of the second refusal. A removal
 * with no reason is a moderation decision nobody can review, and the trail
 * exists to be reviewable — `docs/data-protection.md` says the reason is the
 * member's personal data, which is the same fact from the other end.
 */
export function removalProblem(
  post: { deletedAt: Date | null },
  reason: unknown,
): "communityAlreadyDeleted" | "reasonRequired" | null {
  if (post.deletedAt) return "communityAlreadyDeleted";
  if (typeof reason !== "string") return "reasonRequired";
  if (visibleLength(reason.trim()) === 0) return "reasonRequired";
  if (reason.length > MAX_MODERATION_REASON_LENGTH) return "reasonRequired";
  return null;
}

/**
 * Longest reason. A sentence for a colleague and for a subject access
 * request, not a case file — and bounded on the raw input for the reason every
 * cap in this file exists.
 */
export const MAX_MODERATION_REASON_LENGTH = 500;

/**
 * May this discussion be locked, or unlocked?
 *
 * The state has to change: locking a locked thread and unlocking an open one
 * are both no-ops that would append an audit row saying something happened.
 * A trail with rows for acts that changed nothing is a trail nobody trusts.
 */
export function lockProblem(
  discussion: { lockedAt: Date | null },
  locking: boolean,
): "communityAlreadyLocked" | "communityNotLocked" | null {
  if (locking && discussion.lockedAt !== null) return "communityAlreadyLocked";
  if (!locking && discussion.lockedAt === null) return "communityNotLocked";
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// The automatic send-block — DERIVED, never stored
// ───────────────────────────────────────────────────────────────────────────

/** What the reports say about one member, right now. */
export interface SendBlockState {
  blocked: boolean;
  /** When it crossed — the moment the threshold-th distinct report landed. */
  since: Date | null;
  /** The distinct reporters that count. Never rendered to the blocked member. */
  reporterIds: string[];
}

/**
 * Is this member's writing blocked by the spam loop?
 *
 * 🚨 **AD-64: there is no send-block table and there must not be one.** The
 * block IS this function over the unconsumed report rows. That is what makes
 * it liftable in one tap (consume the reports and it is gone) and what makes
 * it lift ITSELF when the reports age out of the window — a stored boolean
 * would need a job to clear, and a job nobody runs is a member silenced for
 * ever by five taps.
 *
 * ⚠️ **It re-derives NOTHING.** No access checks, no content lookups, no I/O.
 * Eligibility was judged when each report was written (AD-71) and is frozen
 * into these rows; asking again here would mean a spammer could clear the
 * block by getting the reporters' access revoked.
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *  - **Distinct reporters**, so one member cannot block anybody alone. The
 *    unique indexes already absorb their duplicates; counting distinct ids is
 *    the same rule stated where it can be read.
 *  - **Unconsumed** rows only — a moderator who judged a report took it out of
 *    the derivation, which is exactly how the lift works.
 *  - **Inside the window**, so a slow trickle of complaints over a year is not
 *    a block.
 *
 * ── Who is exempt ─────────────────────────────────────────────────────────
 * The operator and anybody holding the moderator role, at derivation time. A
 * community that can silence its own moderators by five taps has handed the
 * moderation of itself to whoever organises fastest. Role-holders stay
 * blockable by hand, through the user administration that already exists.
 *
 * The clock is injected so the window and the expiry are testable at their
 * edges rather than around them.
 */
export function sendBlockState(input: {
  reports: ReadonlyArray<{
    reporterId: string | null;
    createdAt: Date;
    consumedAt: Date | null;
  }>;
  /** The target's role, read fresh by the shell (AD-63). */
  role: string;
  threshold: number;
  windowHours: number;
  /** `null` = never expires. See OQ-4 in `config/community.json`. */
  expiryDays: number | null;
  now: Date;
}): SendBlockState {
  const none: SendBlockState = { blocked: false, since: null, reporterIds: [] };

  // Role-holders are never auto-blocked. See the header.
  if (isOwner(input.role) || input.role === "moderator") return none;

  const from = new Date(
    input.now.getTime() - input.windowHours * 60 * 60 * 1000,
  );

  // Oldest first, so the crossing moment is the createdAt of the report that
  // brought the distinct count up to the threshold.
  const counting = input.reports
    .filter((row) => row.consumedAt === null)
    .filter((row) => row.reporterId !== null)
    .filter((row) => row.createdAt > from)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const seen: string[] = [];
  let since: Date | null = null;
  for (const row of counting) {
    if (!seen.includes(row.reporterId as string)) {
      seen.push(row.reporterId as string);
      if (seen.length === input.threshold) since = row.createdAt;
    }
  }

  if (seen.length < input.threshold || !since) return none;

  // OQ-4's term. `null` is the shipped answer — a block stands until somebody
  // lifts it, because v1 has no notification channel and a silent expiry
  // un-silences a spammer with nobody told.
  if (input.expiryDays !== null) {
    const expires = since.getTime() + input.expiryDays * 24 * 60 * 60 * 1000;
    if (input.now.getTime() >= expires) return none;
  }

  return { blocked: true, since, reporterIds: seen };
}

/**
 * May this moderator act on this block, or on this report?
 *
 * ⚠️ **A moderator whose own report is among the counted ones is refused**, and
 * the refusal is in the core so both the disabled button and the server answer
 * come from one decision. Somebody who reported a member is not the person to
 * judge whether that report should stand.
 *
 * **The operator is never conflicted out**, and that is a decision rather than
 * an oversight: somebody must always be able to act. The operator answers for
 * the app, they are the end of every escalation, and an operator-filed report
 * against a member still needs a path — leaving them conflicted would mean a
 * block nobody in the installation can lift.
 */
export function conflictOfInterest(
  actor: { id: string; role: string },
  countedReporterIds: readonly string[],
): "communityConflictOfInterest" | null {
  if (isOwner(actor.role)) return null;
  return countedReporterIds.includes(actor.id) ? "communityConflictOfInterest" : null;
}

/**
 * May this moderator mark this report handled?
 *
 * ⚠️ **Consuming a report IS acting on it**, and this is the half of the
 * shipped promise that was missing. `CLAUDE.md`, `docs/community.md` and the
 * lift action all say "Nobody acts on a report they filed or on a block their
 * own reports counted towards"; only the second half was built. `consumeReport`
 * checked that the actor was a moderator and nothing else — its query did not
 * even fetch `reporterId`.
 *
 * 🚨 **The second condition is not politeness, it is the hole.** A send-block
 * is derived from UNCONSUMED reports (`sendBlockState()` filters
 * `consumedAt === null`), so consuming enough of them dissolves it — and a
 * conflicted moderator does not need to touch their OWN report to do that. With
 * a threshold of five and five counted reporters, they consume the four
 * belonging to other people, the distinct count falls to one, and the block is
 * gone. That is precisely the act `liftSendBlock()` refused them, reached by a
 * different button. Refusing only "their own report" would have left it open.
 *
 * The operator is never conflicted out, for the reason
 * {@link conflictOfInterest} gives: somebody must always be able to act.
 *
 * The cost is stated rather than hidden: a conflicted moderator's own report
 * stays in the queue in front of them until another moderator or the operator
 * handles it. That is what "those pass to another moderator or to the operator"
 * means, and a queue that lets you tidy away your own accusation would be the
 * more expensive answer.
 */
export function mayConsumeReport(
  actor: { id: string; role: string },
  report: { reporterId: string | null },
  block: { blocked: boolean; reporterIds: readonly string[] },
): "communityConflictOfInterest" | null {
  if (isOwner(actor.role)) return null;
  if (report.reporterId === actor.id) return "communityConflictOfInterest";
  if (block.blocked && block.reporterIds.includes(actor.id)) {
    return "communityConflictOfInterest";
  }
  return null;
}

/**
 * Which message ids a report may carry as context.
 *
 * 🚨 **Two rules, and both are bounds on how much of a private conversation a
 * moderator is shown.** Every id must belong to the conversation the reported
 * message is in — a smuggled id from elsewhere is dropped rather than
 * refused, because a refusal would tell the reporter whether that other id
 * exists — and the list is cut to the configured maximum.
 *
 * The reported message itself is always included and always first: the window
 * is "this, plus the context they chose", and a report whose reported message
 * had somehow been filtered out would show a moderator context for nothing.
 */
export function windowMessageIds(input: {
  reportedId: string;
  /** Ids the reporter picked, as they arrived. */
  attached: readonly string[];
  /** The ids that really are in the same conversation. */
  sameConversation: readonly string[];
  max: number;
}): string[] {
  const allowed = new Set(input.sameConversation);
  const extras: string[] = [];
  for (const id of input.attached) {
    if (id === input.reportedId) continue;
    if (!allowed.has(id)) continue;
    if (extras.includes(id)) continue;
    if (extras.length >= input.max) break;
    extras.push(id);
  }
  return [input.reportedId, ...extras];
}

/**
 * The rate-limit bucket for reporting. The module's third of three.
 */
export const COMMUNITY_REPORT_RATE_BUCKET = "community-report";

/**
 * How often one member may report.
 *
 * The `postLimit()` shape and window, with its own number — and the one meant
 * to stay generous: somebody clearing up a spam wave is doing exactly what the
 * feature is for, and a brake that caught them would be a bug that reads as a
 * policy. It exists against a script.
 */
export function reportLimit(maxReports: number): Limit {
  return { max: maxReports, windowMs: 10 * 60 * 1000 };
}

/**
 * May this member report this content?
 *
 * 🚨 **Asked ONCE, at the moment of the report, and never again.** That is
 * AD-71: a report is a frozen fact. "An eligible member said this was spam on
 * Tuesday" does not stop being true on Wednesday, so nothing re-derives
 * eligibility afterwards — otherwise a spammer could clear the reports against
 * them by getting the reporters' access revoked, and more ordinarily, reports
 * would evaporate whenever somebody's subscription lapsed.
 *
 * The caller supplies the answers; this decides. `readable` is the access
 * question already derived by the same path the READ uses — "eligible means
 * members who could read the reported content themselves" (FR-211), which for
 * a room is `mayEnterGroup()` and for a private message is being one of the
 * two participants.
 */
export function reportProblem(input: {
  /** Could the reporter read this content, at this moment? */
  readable: boolean;
  /** Is the reporter the author? */
  own: boolean;
  /** Does the reporter have a display name — the one refusal every write asks? */
  profile: { displayName: string | null } | null;
}): "communityProfileIncomplete" | "communityCannotReportOwn" | "notFound" | null {
  const participation = canParticipate(input.profile);
  if (participation) return participation;
  // Not readable and not existing are one answer, as everywhere else in this
  // module: telling them apart tells a prober which ids are real.
  if (!input.readable) return "notFound";
  if (input.own) return "communityCannotReportOwn";
  return null;
}

/**
 * Does this post belong in a feed at all?
 *
 * ⚠️ **`contentState()` decides, and nothing else.** A feed is a list of
 * things that happened; a post the author deleted, one a moderator removed and
 * one an account deletion emptied did not stop happening, but they stopped
 * being readable — and a feed item is a claim that there is something to read.
 * The three states are all `false` here for that one reason, which is why this
 * is a call to the module's one deletion reader rather than a
 * `deletedAt === null` check that would silently mean something different if a
 * fourth state ever arrived.
 *
 * ⚠️ **It says nothing about ACCESS.** Whether the viewer may be in the space
 * a post was written in is answered by the space's own rules, at read time,
 * before this is ever asked — `mayEnterGroup()` and `mayViewEmbed()` are the
 * two answers and the feed re-uses them rather than growing a third.
 */
export function feedVisible(post: {
  deletedAt: Date | null;
  deletedBy: "author" | "moderator" | "system" | null;
}): boolean {
  return contentState(post) === "visible";
}

/**
 * May this member follow that one?
 *
 * Two refusals, both reused rather than minted, and the reuse is the point:
 *
 *  - **`communityProfileIncomplete`** — `canParticipate()`, the one refusal every
 *    community WRITE asks. A follow appears on somebody else's list under a
 *    name, so it is a write like any other; a member with no name would appear
 *    there as a blank. This is 19.3's gate gaining a caller, not a second
 *    display-name check.
 *  - **`communityNotDeliverable`** — a standing block between the pair, in either
 *    direction, and following oneself. The SAME code and the same sentence a
 *    message to an unknown or closed account gets, because a refusal that can
 *    be told apart announces the block. `canDeliverTo()` already merges the
 *    causes; this hands it the same shape.
 *
 * There is deliberately **no rate-limit bucket** for following. The module has
 * three (posting, direct messages, reporting) and this is not a fourth: a
 * follow has no push surface to abuse — there are no notifications in v1 and
 * the follower list is pull-only, so flapping a follow costs the followed
 * member nothing they would ever see.
 */
export function canFollow(
  profile: { displayName: string | null } | null,
  input: {
    self: boolean;
    /** The person being followed, or `null` when there is no such account. */
    target: { blockedAt: Date | null } | null;
    blockedEitherWay: boolean;
  },
): "communityProfileIncomplete" | "communityNotDeliverable" | null {
  const participation = canParticipate(profile);
  if (participation) return participation;
  // ⚠️ The whole rest of the decision is `canDeliverTo()`'s, unchanged and
  // uncopied. A follow that could be told apart from a message in WHICH of
  // the four causes refused it would leak the block through a second door.
  return canDeliverTo(input);
}

/** Longest direct message. The post cap, for the same reasons. */
export const MAX_MESSAGE_LENGTH = 10_000;

/**
 * The rate-limit bucket for direct messages. The module's THIRD of three
 * (posting, reporting, this) — its own bucket rather than a share of the
 * posting one, because a member answering five people in a room and a member
 * writing five people privately are different behaviours and the second is the
 * one worth braking harder.
 */
export const COMMUNITY_DM_RATE_BUCKET = "community-dm";

/**
 * How often one member may send a direct message.
 *
 * `postLimit()`'s shape and window; the number is its own so an operator can
 * relax the room without relaxing the inbox. ⚠️ In memory and per process —
 * `lib/rate-limit.ts` carries the caveat, and behind several instances every
 * limit is multiplied by their number.
 */
export function messageLimit(maxMessages: number): Limit {
  return { max: maxMessages, windowMs: 10 * 60 * 1000 };
}

/**
 * Normalizes and validates a direct message's text.
 *
 * `checkPostContent()`'s twin, with its own codes so the sentence on screen
 * talks about a message rather than a post. Same reasoning throughout: CRLF is
 * normalised before the cap is measured, the raw input is loosely bounded
 * first, `visibleLength()` refuses a message made of zero-width characters,
 * and a bidi override is allowed inside prose because the message is rendered
 * as text nodes in its own element.
 */
export function checkMessageContent(
  value: unknown,
):
  | { ok: true; content: string }
  | { ok: false; code: "communityMessageEmpty" | "communityMessageTooLong" } {
  if (typeof value !== "string") return { ok: false, code: "communityMessageEmpty" };
  if (value.length > MAX_MESSAGE_LENGTH * 2)
    return { ok: false, code: "communityMessageTooLong" };
  const text = value.replace(/\r\n/g, "\n");
  if (text.length > MAX_MESSAGE_LENGTH)
    return { ok: false, code: "communityMessageTooLong" };
  const content = text.trim();
  if (visibleLength(content) === 0) return { ok: false, code: "communityMessageEmpty" };
  return { ok: true, content };
}

/** One piece of a rendered post: plain text, or a link the renderer may make. */
export type PostSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string };

/**
 * Only these schemes ever become a clickable link.
 *
 * ⚠️ **This whitelist is the one XSS React's escaping does not stop.** React
 * escapes text children by construction, so `{post.content}` is safe on its
 * own — but an `href` built from member text is not: `javascript:alert(1)` in
 * an anchor executes on click, and so does a `data:text/html` URL in some
 * browsers. Matching only `http://` and `https://` is why every other scheme
 * stays a plain text node.
 *
 * The word "whitelist" is exact: this is not a list of things to strip. Adding
 * a scheme here is a security decision, not a formatting one.
 */
const LINKABLE = /https?:\/\/[^\s<>"'`]+/gi;

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING = /[.,;:!?)\]}'"»]+$/;

/**
 * Closing brackets that belong to the URL rather than to the sentence.
 *
 * `TRAILING` strips a trailing `)` unconditionally, which is right for
 * "see https://example.com/page)." and wrong for
 * `https://en.wikipedia.org/wiki/Ruby_(programming_language)` — that address
 * ends in a bracket it opened itself, and cutting it produces a 404 with a
 * stray `)` rendered beside it. So a closing bracket is only sentence
 * punctuation when the URL has no matching opener left for it.
 */
function keepsBracket(url: string, bracket: string): boolean {
  const open = bracket === ")" ? "(" : bracket === "]" ? "[" : "{";
  let depth = 0;
  for (const character of url) {
    if (character === open) depth += 1;
    else if (character === bracket) depth -= 1;
  }
  // depth < 0 means more closers than openers — the last one is the sentence's.
  return depth >= 0;
}

/**
 * Trim sentence punctuation off the end of a matched URL, one character at a
 * time so that a bracket can be judged in the context of what is left.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const character = url[end - 1];
    if (!TRAILING.test(character)) break;
    if (
      (character === ")" || character === "]" || character === "}") &&
      keepsBracket(url.slice(0, end), character)
    ) {
      break;
    }
    end -= 1;
  }
  return url.slice(0, end);
}

/**
 * Split a post into what a renderer may draw.
 *
 * Pure, and the whole of the module's rendering policy: **plain text with line
 * breaks, plus links for http(s) URLs, and nothing else.** No HTML parsing, no
 * markdown, no images, no mentions. The single component that consumes this
 * (`components/community/post-body.tsx`) turns `text` into React text nodes
 * and `link` into an `<a rel="noopener noreferrer">` — and a structural test
 * keeps `dangerouslySetInnerHTML` out of the community tree so that the next
 * person adding "just bold" has to go past a failing build to do it.
 *
 * The text of a link segment is the URL itself, never a label taken from
 * elsewhere in the post: a link whose text says one thing and whose target
 * says another is the shape of a phishing message, and this app is not going
 * to render one on a member's behalf.
 *
 * ⚠️ **Which is why a URL carrying a bidi override never becomes a link.**
 * `checkPostContent` permits overrides in prose on the argument that an
 * override "affects that post's own text, which is the author's to mangle" —
 * and that argument holds for every segment except this one. Here the URL is
 * BOTH the `href` and the anchor text, so
 * `https://evil.example/‮elpmaxe.knab//:sptth` renders as a trusted host
 * while pointing somewhere else: exactly the link the paragraph above says
 * this app will not render. It stays a plain text node instead — visible,
 * copyable, not clickable — rather than being silently rewritten, because
 * stripping characters out of somebody's address is its own kind of lie.
 */
export function postSegments(content: string): PostSegment[] {
  const segments: PostSegment[] = [];
  let index = 0;

  // `matchAll` on a fresh regex per call: a module-level /g regex carries
  // `lastIndex` between calls, so two posts rendered in one pass would start
  // the second scan wherever the first stopped.
  for (const match of content.matchAll(new RegExp(LINKABLE.source, "gi"))) {
    const start = match.index;
    let url = match[0];

    // "see https://example.com." — the full stop ends the sentence, not the
    // address. Trailing punctuation goes back to the text beside it, except a
    // bracket the URL opened itself (`trimTrailing` carries the argument).
    url = trimTrailing(url);
    if (url.length === 0) continue;

    // A bidi override in the address: not a link, on the reasoning above. The
    // text before it is still emitted, and the URL falls through to the text
    // segment at the end of the loop by leaving `index` where it was.
    if (BIDI_OVERRIDE.test(url)) continue;

    if (start > index) {
      segments.push({ kind: "text", value: content.slice(index, start) });
    }
    segments.push({ kind: "link", value: url });
    index = start + url.length;
  }

  if (index < content.length) {
    segments.push({ kind: "text", value: content.slice(index) });
  }
  return segments;
}

// ───────────────────────────────────────────────────────────────────────────
// Unread — one comparison, minted here, spent by everything that asks
// "what is new since X"
// ───────────────────────────────────────────────────────────────────────────

/** A point in the module's total order over content. */
export interface Cursor {
  at: Date;
  id: string;
}

/**
 * Order two cursors. Negative when `a` is older, positive when newer, 0 when
 * they are the same point.
 *
 * ⚠️ **This is the module's ONE answer to "what is new since X", and it is
 * deliberately minted before anything needs all of it.** Four features would
 * otherwise each invent their own: this unread badge, a live room's cursor
 * endpoint, direct-message unread, a feed's recency. Any two of them
 * disagreeing shows up as a member being told something is new on one page and
 * read on another — a bug nobody can reproduce, because it needs two features
 * and one millisecond.
 *
 * **Timestamp first, id as the tie-break**, because a timestamp alone has no
 * total order: two posts landing in the same millisecond are real under load,
 * and "newer than" has to be decidable for them too. The tie-break is a plain
 * string comparison, which is what Postgres does for `text` — so
 * `(a.at, a.id) < (b.at, b.id)` in SQL and this function are the same
 * comparison rather than two that agree today. `acknowledgeRead()` relies on
 * exactly that.
 *
 * Timezone-innocent by construction: it compares `Date` values handed in and
 * never constructs one, never reads a clock.
 */
export function compareCursor(a: Cursor, b: Cursor): number {
  const byTime = a.at.getTime() - b.at.getTime();
  if (byTime !== 0) return byTime < 0 ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// The cursor TOKEN — the same currency, wrapped for the wire
// ───────────────────────────────────────────────────────────────────────────

/**
 * The version marker inside a token.
 *
 * Not decoration: it is what lets the shape change one day without a client
 * holding an old token being served a window computed from a misread tuple. An
 * unrecognised version parses to `null`, which the endpoint treats exactly like
 * no cursor at all — resynchronise, deliver nothing, hand back a fresh token.
 */
const CURSOR_VERSION = "1";

/** Field separator. UUIDs and decimal integers contain no `|`. */
const CURSOR_SEPARATOR = "|";

/**
 * A cursor as it travels: an opaque string the client stores and echoes back.
 *
 * ⚠️ **Opacity is a CONTRACT, not encryption, and this is the place to say so
 * before somebody adds crypto "for safety".** A forged token buys nothing: the
 * endpoint re-checks enablement and access on every single answer, so the most
 * a tampered cursor can produce is a different window into rows the viewer may
 * already read. Signing it would add a key to manage, a rotation story and a
 * failure mode, in exchange for nothing.
 *
 * ⚠️ **What it wraps is `compareCursor()`'s tuple, and it does not mint a
 * second one.** AD-70: unread arithmetic and live arithmetic are ONE
 * comparison. If you find yourself writing a second compare-tuples function
 * beside this, stop — that is precisely the drift the one-currency rule exists
 * to prevent.
 *
 * base64url over `<version>|<epoch millis>|<id>`. `btoa` rather than `Buffer`,
 * because this file is bundled for the browser (see the file header) — and the
 * inputs are ASCII by construction: a decimal timestamp and an id this schema
 * mints with `crypto.randomUUID()`.
 */
export function cursorToken(cursor: Cursor): string {
  const raw = [CURSOR_VERSION, String(cursor.at.getTime()), cursor.id].join(
    CURSOR_SEPARATOR,
  );
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Read a token back, or `null` for anything that is not one.
 *
 * **Every failure is the same `null`**, and the caller treats `null` exactly
 * like a missing cursor: garbage, a truncated string, a tampered payload, a
 * future version, a non-numeric timestamp, an empty id. There is nothing to
 * tell apart — a client that cannot produce a valid token has no window to
 * defend, and refusing loudly would only teach a prober what the format is.
 */
export function parseCursorToken(token: unknown): Cursor | null {
  if (typeof token !== "string" || token === "") return null;

  let raw: string;
  try {
    // `atob` throws on anything that is not base64. Padding is restored
    // because it was stripped on the way out.
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }

  const parts = raw.split(CURSOR_SEPARATOR);
  if (parts.length !== 3) return null;
  const [version, millis, id] = parts;
  if (version !== CURSOR_VERSION) return null;
  if (id === "") return null;

  // `/^\d+$/`, not `Number()`: `Number("")` is 0, `Number(" 12 ")` is 12 and
  // `Number("1e3")` is 1000 — three different strings that would all decode
  // into a valid-looking instant, so two tokens could name one point.
  if (!/^\d+$/.test(millis)) return null;
  const at = Number(millis);
  if (!Number.isSafeInteger(at)) return null;

  return { at: new Date(at), id };
}

// ───────────────────────────────────────────────────────────────────────────
// The LIVE cursor — two positions, one comparison
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where a live window stands: one position per question it asks.
 *
 * ⚠️ **This is NOT a second currency, and the distinction is the whole point.**
 * Both fields are `Cursor`, both are ordered by `compareCursor()`, and no second
 * compare-tuples function exists — AD-70's rule is about the COMPARISON, and
 * that is still singular. What grew is the number of POSITIONS a live answer
 * has to remember, and it grew because the two halves of that answer are sorted
 * by different columns.
 *
 * **Why one position could not work, measured rather than argued.** A live
 * answer ORs "created since X" with "changed since X" and takes the newest 50.
 * Half (b) rows are OLD — a deletion touches a post written last month — so
 * they sort FIRST and eat the limit, while contributing nothing to a cursor
 * that may only move forward. Once fifty rows in one discussion are in that
 * state, the cursor stops, the same fifty tombstones ride every poll, and **no
 * new post is ever delivered again**. A GDPR erasure reaches that number in one
 * statement: `scrubCommunityContentFor()` sets `deletedAt` on every post of a
 * departing member at once. Found by three independent review layers on
 * 2026-08-06; there was no test over the cursor-advance loop at all.
 *
 * And the obvious one-position repair is lossy rather than merely imperfect:
 * advancing on half (a) moves the window past tombstones that half (b) has not
 * delivered yet, so deletions would silently never arrive.
 */
export interface LiveCursor {
  /** How far the "what was created" half has been delivered. */
  created: Cursor;
  /** How far the "what changed state" half has been delivered. */
  changed: Cursor;
}

/** Version marker for the two-position token. See {@link CURSOR_VERSION}. */
const LIVE_CURSOR_VERSION = "L1";

/**
 * A live cursor as it travels — the same opaque contract `cursorToken()` has.
 *
 * base64url over `<version>|<created millis>|<created id>|<changed millis>|<changed id>`.
 * Opacity is a contract and not encryption, for the reason spelled out on
 * `cursorToken()`: every answer re-checks enablement and access, so a forged
 * token buys a different window into rows the viewer may already read.
 */
export function liveCursorToken(cursor: LiveCursor): string {
  const raw = [
    LIVE_CURSOR_VERSION,
    String(cursor.created.at.getTime()),
    cursor.created.id,
    String(cursor.changed.at.getTime()),
    cursor.changed.id,
  ].join(CURSOR_SEPARATOR);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Read a live token back, or `null` for anything that is not one.
 *
 * **A single-position token is accepted and read as both positions.** That is
 * not leniency, it is the upgrade path: the page that renders a thread mints
 * where the RENDER stood with `cursorToken()`, one position, because a render
 * has only one; and every client holding a token from before this shape existed
 * would otherwise resynchronise at once on deploy. Reading `X` as
 * `{created: X, changed: X}` is exactly what the single-position window meant.
 */
export function parseLiveCursorToken(token: unknown): LiveCursor | null {
  if (typeof token !== "string" || token === "") return null;

  let raw: string;
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }

  const parts = raw.split(CURSOR_SEPARATOR);
  if (parts[0] !== LIVE_CURSOR_VERSION) {
    // Not ours — try the single-position form before giving up.
    const one = parseCursorToken(token);
    return one ? { created: one, changed: one } : null;
  }
  if (parts.length !== 5) return null;

  const [, createdMillis, createdId, changedMillis, changedId] = parts;
  if (createdId === "" || changedId === "") return null;
  // `/^\d+$/` for the reason `parseCursorToken()` gives: `Number()` would let
  // three different strings decode into one instant.
  if (!/^\d+$/.test(createdMillis) || !/^\d+$/.test(changedMillis)) return null;
  const createdAt = Number(createdMillis);
  const changedAt = Number(changedMillis);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(changedAt)) {
    return null;
  }

  return {
    created: { at: new Date(createdAt), id: createdId },
    changed: { at: new Date(changedAt), id: changedId },
  };
}

/**
 * Merge arriving rows into a rendered list: **upsert by id**, in the thread's
 * own order.
 *
 * ⚠️ **Upsert, never append, and that is AD-70's contract rather than an
 * optimisation.** A row arrives twice because it CHANGED — it was edited, or
 * deleted, or scrubbed with a departing account — so appending it would render
 * one post in two states, the older of which the database no longer shows
 * anybody. The live answer delivers state changes as rows for exactly this
 * reason.
 *
 * ⚠️ **It lives here, beside `compareCursor()`, and not in the component that
 * uses it.** It used to sit inside `live-discussion.tsx`, where every test
 * mocked the whole component away — so a regression to `[...current,
 * ...arriving]`, the precise failure the contract names, turned nothing red.
 * A pure function of two arrays belongs where the module's other pure ordering
 * lives and can be counted. Found by review on 2026-08-06.
 *
 * The order is `compareCursor()`'s and no other. The version inside the
 * component ordered ties with `localeCompare()`, which is ICU collation where
 * this module compares UTF-16 code units and Postgres compares by its own
 * collation — a third restatement of one rule, outside the parity test written
 * to stop the first two drifting.
 */
export function mergeRows<T extends { id: string; createdAt: string }>(
  current: readonly T[],
  arriving: readonly T[],
): T[] {
  if (arriving.length === 0) return [...current];
  const byId = new Map(current.map((row) => [row.id, row]));
  for (const row of arriving) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) =>
    compareCursor(
      { at: new Date(a.createdAt), id: a.id },
      { at: new Date(b.createdAt), id: b.id },
    ),
  );
}

/**
 * The cursor a view that rendered NOTHING starts from: before everything.
 *
 * ⚠️ **This exists so that "I have nothing" is not the same value as "I cannot
 * read my token", and that distinction is a defect this module already had.**
 * While an empty view sent no cursor at all, the endpoint could not tell the
 * two apart and took the resynchronise branch for both — answering `posts: []`
 * together with a cursor pointing PAST whatever had arrived meanwhile. So the
 * first post ever written into a declared embed was never delivered to a page
 * that was already open, and every post after it arrived normally. The symptom
 * reads as "the first post in a new embed never shows up", which is the state
 * every embed is in on the day somebody declares it.
 *
 * `id: "0"` sorts before any `crypto.randomUUID()`, and the epoch timestamp
 * makes the tie-break unreachable anyway — it is there to keep the token's
 * shape honest rather than to decide anything.
 */
export function liveCursorBeginning(): string {
  const beginning: Cursor = { at: new Date(0), id: "0" };
  return liveCursorToken({ created: beginning, changed: beginning });
}

/**
 * The position a live half has reached after an answer.
 *
 * Monotonic by construction — it never returns a point older than the one it
 * started from, which is what stops half (b) rewinding a window and
 * redelivering everything after it for ever.
 */
export function advanceCursor(from: Cursor, delivered: readonly Cursor[]): Cursor {
  let next = from;
  for (const candidate of delivered) {
    if (compareCursor(candidate, next) > 0) next = candidate;
  }
  return next;
}

// ───────────────────────────────────────────────────────────────────────────
// The poll schedule — pure, so the request volume can be COUNTED
// ───────────────────────────────────────────────────────────────────────────

/** How often the client asks, in each of the two states a tab can be in. */
export interface PollSchedule {
  visibleMs: number;
  hiddenMs: number;
}

/**
 * How many consecutive failures still lengthen the wait. Beyond it the delay
 * stops growing: an endpoint that has been down for an hour is not worth
 * asking once a day, and a member who reopens the laptop expects the room back
 * in under a minute.
 */
const MAX_BACKOFF_STEPS = 4;

/**
 * How long to wait before the next poll.
 *
 * It is a separate function because it is the ONE place the visible/hidden
 * decision is made, and because a pure one can be counted — see
 * `pollInstants()` below.
 *
 * ⚠️ **`failures` doubles the wait, up to {@link MAX_BACKOFF_STEPS} times.**
 * Not a refinement: while every failed poll was retried at the unchanged
 * interval, a server answering 500 was asked again every five seconds by every
 * open tab for as long as it stayed broken — the load arriving exactly when the
 * host could least carry it. One good answer resets the count, so a dropped
 * connection costs a few seconds and nothing more.
 *
 * A refusal the server *answered* — 404 when the module is switched off, 401
 * when a session ends — does not come through here at all: the loop latches off
 * instead. Backing off from a definite answer would be asking a question that
 * has been answered.
 */
export function pollDelayMs(
  schedule: PollSchedule,
  hidden: boolean,
  failures = 0,
): number {
  const base = hidden ? schedule.hiddenMs : schedule.visibleMs;
  const steps = Math.min(Math.max(failures, 0), MAX_BACKOFF_STEPS);
  return base * 2 ** steps;
}

/**
 * Every instant the client would poll within a window, in milliseconds from
 * the start of it.
 *
 * ⚠️ **This exists so SM-16's counter-metric can be MEASURED rather than
 * asserted.** "Idle tabs back off" is a claim about request volume, and this
 * repo has zero component tests and no DOM by decision — so the claim is made
 * testable by putting the schedule in a pure function and letting the hook be
 * a thin consumer of it. A test counts the instants for the SHIPPED defaults;
 * see `rules.test.ts`.
 *
 * `isHidden` takes the instant so a test can walk a tab through a sequence of
 * states rather than only the two constant ones.
 *
 * The floor of 1 ms is a guard against a caller handing in `0` and asking this
 * to enumerate infinity. The config readers bound the real values; this
 * function is pure and takes what it is given.
 */
export function pollInstants(
  schedule: PollSchedule,
  windowMs: number,
  isHidden: (atMs: number) => boolean,
): number[] {
  const instants: number[] = [];
  let at = 0;
  while (true) {
    at += Math.max(1, Math.floor(pollDelayMs(schedule, isHidden(at))));
    if (at > windowMs) break;
    instants.push(at);
  }
  return instants;
}

/**
 * Is there something here this member has not read?
 *
 * @param lastActivity the newest content in the thread — `null` when there is
 *   none. **`id` is optional, and that asymmetry is the interesting part.**
 * @param marker what the member has acknowledged, or `null` when they never
 *   have.
 *
 * ── Two callers, two shapes, one deliberate difference ────────────────────
 * A list page knows the newest POST and can pass a full tuple. The navigation
 * indicator does not: it reads `lastActivityAt` off the discussion row — the
 * module's one materialization — which is a timestamp with no id beside it.
 * So when the two timestamps are exactly equal and the activity side has no
 * id, this answers **read**.
 *
 * That is the honest choice of the two. `lastActivityAt` is written from the
 * same `now` as the post it records, and the marker for that post carries the
 * same instant — so equality is overwhelmingly "you have read exactly this",
 * and answering "unread" would leave a dot that never clears. The cost of
 * being wrong the other way is one missed dot in the millisecond where two
 * different posts share a timestamp and the member has read the first; the
 * next post clears it. A permanent dot is a feature people learn to ignore.
 *
 * ── Where it is actually spent ────────────────────────────────────────────
 * ⚠️ **This function has no production caller today, and that is a property to
 * understand rather than a gap to close.** The three unread reads in
 * `manage.ts` must do their comparison inside a `WHERE` — a pure function
 * cannot be called from SQL, and filtering in JS would mean fetching every
 * discussion in every reachable room on the busiest path in the app. So this
 * is the DEFINITION and the SQL is its restatement, which is precisely the
 * shape that drifts: `lib/community/unread-parity.test.ts` runs both over the
 * same matrix and fails when they stop agreeing. Do not "fix" the absence by
 * wiring this into a query; fix it by keeping the parity test honest.
 *
 * The tuple's id half IS live where it can be — `acknowledgeRead()`'s
 * advance-only clause compares `(created_at, id)` as a Postgres row, which is
 * the comparison `compareCursor()` defines.
 *
 * ── Its two future callers ────────────────────────────────────────────────
 * The live channel's "what happened since this cursor" and direct-message
 * unread are the same question against different content. Both use THIS
 * function and `compareCursor()` above; neither re-implements the arithmetic,
 * and neither invents a second meaning for an equal timestamp.
 */
export function hasUnread(
  lastActivity: { at: Date; id?: string } | null,
  marker: Cursor | null,
): boolean {
  // Nothing has happened: nothing to have missed. Not the same as "read".
  if (!lastActivity) return false;
  // Never acknowledged anything, and there IS content: unread.
  if (!marker) return true;

  const byTime = lastActivity.at.getTime() - marker.at.getTime();
  if (byTime !== 0) return byTime > 0;

  // Equal timestamps. Without an id there is nothing left to compare — see the
  // asymmetry above.
  if (lastActivity.id === undefined) return false;
  return compareCursor({ at: lastActivity.at, id: lastActivity.id }, marker) > 0;
}

/**
 * The later of a post's two change stamps — the JS twin of `CHANGED_AT`, the
 * SQL expression `manage.ts` orders the live feed by.
 *
 * Timezone-innocent on purpose: it compares `Date` values handed in and never
 * reads a clock, which is what lets the live cursor be tested without one.
 * `greatest(deletedAt, editedAt)`, with a missing stamp counting as the epoch
 * so a post that has neither sorts before every post that has one.
 */
export function changedAt(post: {
  deletedAt: Date | null;
  editedAt: Date | null;
}): Date {
  const deleted = post.deletedAt?.getTime() ?? 0;
  const edited = post.editedAt?.getTime() ?? 0;
  return new Date(Math.max(deleted, edited));
}
