// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Turning a session into somebody else's, and back again.
//
// This is the only file that rewrites the subject of a signed-in token, and
// everything in it exists to make that safe. Read this header before changing
// any of it.
//
// ══════════════════════════════════════════════════════════════════════════
// THE ATTACK THIS DEFENDS AGAINST
// ══════════════════════════════════════════════════════════════════════════
// `unstable_update()` POSTs to `/api/auth/session`, and @auth/core hands the
// request body to the `jwt` callback as `session`, then re-encodes whatever the
// callback returns straight into the cookie. That endpoint is reachable by ANY
// signed-in user — @auth/core's own types say of that parameter:
//
//     "⚠ Note, you should validate this data before using it."
//
// So a callback written the obvious way —
//
//     token.sub = payload.memberId          // ☠️  NEVER
//
// — is a complete authentication bypass: any member POSTs a JSON body and
// becomes anyone, including an owner. It would pass every test in this repo and
// look entirely reasonable in review.
//
// What is trusted here instead:
//
//   1. `token.sub` — inside the signed token. We put it there.
//   2. A row in `impersonations` — written only by `startImpersonationAction`,
//      which opens with `requireOwner()` and `canImpersonate()`.
//
// and the join between them is the check that matters:
//
//     row.operatorId === token.sub
//
// An attacker can forge neither. They cannot create a row (the action refuses
// them), and they cannot claim somebody else's row (their own token says who
// they are). The worst a member can do by POSTing at this endpoint is nothing.
//
// This is why `db/schema-impersonation.ts` insists the row is written BEFORE
// the session changes. It is not audit-trail etiquette. The row IS the
// capability.
// ══════════════════════════════════════════════════════════════════════════
import type { JWT } from "next-auth/jwt";
import { IMPERSONATION_CLAIM, impersonationState, readClaim } from "./claim";
import type { ImpersonationClaim } from "./claim";

/**
 * The shape a caller sends to `unstable_update()`.
 *
 * Deliberately tiny. `start` carries a record id and NOTHING else — no member
 * id, no role, no email — because every one of those would be a value from the
 * request that the callback might be tempted to believe. The id is a lookup
 * key, not an assertion.
 */
export interface ImpersonationUpdate {
  impersonation?: { start?: string } | { stop?: true };
}

function claimFrom(
  row: { id: string; operatorId: string | null; expiresAt: Date },
  operator: { email: string | null; role: string },
  member: { email: string | null },
): ImpersonationClaim {
  return {
    id: row.id,
    operatorId: row.operatorId as string,
    operatorEmail: operator.email,
    operatorRole: operator.role,
    memberEmail: member.email,
    expiresAt: row.expiresAt.getTime(),
  };
}

/**
 * Handle an update trigger on the `jwt` callback.
 *
 * Returns the token to encode, or `null` to destroy the session. Every refusal
 * returns the token UNCHANGED — silently. The server action has already told
 * the Operator what went wrong in their own language; this layer answering an
 * unauthenticated poke with a distinguishable error would only tell an attacker
 * which of their guesses was closer.
 */
export async function applyImpersonationUpdate(
  token: JWT,
  payload: unknown,
): Promise<JWT | null> {
  const update = (payload ?? {}) as ImpersonationUpdate;
  const request = update.impersonation;
  if (!request || typeof request !== "object") return token;

  if ("stop" in request && request.stop === true) return stopImpersonating(token);
  if ("start" in request && typeof request.start === "string") {
    return startImpersonating(token, request.start);
  }
  return token;
}

async function startImpersonating(token: JWT, recordId: string): Promise<JWT> {
  // No chaining. The rule refuses it too, but this is a second, independent
  // refusal on the path that does not go through the rule.
  //
  // The state, not merely the presence of a claim: an EXPIRED claim is a
  // leftover, not a running session. Refusing on presence alone would lock an
  // Operator out of the feature for the rest of their sign-in the first time
  // they let one time out — and they would have no way to tell why.
  if (impersonationState(token).kind === "running") return token;

  const caller = typeof token.sub === "string" ? token.sub : null;
  if (!caller) return token;

  const { findOpenImpersonation } = await import("./manage");
  const row = await findOpenImpersonation(recordId);
  if (!row) return token;

  // ── THE CHECK ──────────────────────────────────────────────────────────
  // Everything above is lookup. This line is the authorisation: the row has to
  // name the caller as the Operator who opened it. Deleting it turns this
  // module into an account-takeover endpoint.
  if (row.operatorId !== caller) return token;

  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      blockedAt: users.blockedAt,
    })
    .from(users)
    .where(inArray(users.id, [row.operatorId, row.memberId]));

  const operator = rows.find((u) => u.id === row.operatorId);
  const member = rows.find((u) => u.id === row.memberId);
  if (!operator || !member) return token;

  // Defence in depth: the rule already refused all of these before the row was
  // written. They are re-asked here because the row and this callback are two
  // separate requests, and an account can change between them — a target
  // promoted in the seconds after the dialog was confirmed would otherwise
  // hand over rights the rule refused.
  //
  // The target check is an ALLOWLIST (`!== "member"`), not a list of the roles
  // we happen to refuse, and that is the whole lesson of the review that wrote
  // this line: `canImpersonate()` gained `moderatorImpersonate` for Story 19.2
  // while this layer still asked only about `"owner"`, so the second refusal
  // silently stopped mirroring the first. `users.role` is `text` with no enum
  // by decision, so the set of values is open — a denylist here goes stale
  // every time somebody adds a role, and goes stale SILENTLY, which is the one
  // failure mode a defence-in-depth layer cannot afford.
  if (operator.role !== "owner") return token;
  if (member.role !== "member") return token;
  if (member.blockedAt) return token;

  token.sub = member.id;
  token.role = member.role;
  token.email = member.email ?? undefined;
  token.name = member.name ?? undefined;
  token.picture = member.image ?? undefined;
  (token as Record<string, unknown>)[IMPERSONATION_CLAIM] = claimFrom(
    row,
    operator,
    member,
  );

  return token;
}

/**
 * Step back out.
 *
 * Trusts NOTHING from the request — there is nothing in the payload to trust.
 * The identity restored comes from the claim inside the signed token, and the
 * rights restored come from a fresh look at the database, because the Operator
 * may have been demoted, blocked or deleted while they were inside.
 */
async function stopImpersonating(token: JWT): Promise<JWT | null> {
  const claim = readClaim(token);
  if (!claim) return token;

  const { closeImpersonation } = await import("./manage");
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const [operator] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      blockedAt: users.blockedAt,
    })
    .from(users)
    .where(eq(users.id, claim.operatorId))
    .limit(1);

  // How it ended is derived here, from the claim, and never taken from the
  // request. It is only a label on the record page, but a label somebody else
  // gets to choose is a label that can be made to lie — and this one is read by
  // whoever is answering "was an admin really in my account for 30 minutes?"
  const reason =
    impersonationState(token).kind === "expired" ? "expired" : "operator";

  // The record closes either way. The Operator left; whether they had anywhere
  // to go back to is a different question, and an open row would be a lie.
  await closeImpersonation(claim.id, reason);

  // Nothing to return to — demoted, blocked or deleted while they were inside.
  // `null` destroys the session, which lands them on /login. Restoring a role
  // they no longer hold would be the alternative, and it is not one.
  if (!operator || operator.role !== "owner" || operator.blockedAt) return null;

  token.sub = operator.id;
  token.role = operator.role;
  token.email = operator.email ?? undefined;
  token.name = operator.name ?? undefined;
  token.picture = operator.image ?? undefined;
  delete (token as Record<string, unknown>)[IMPERSONATION_CLAIM];

  return token;
}
