// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The imperative shell for changing the account address.
//
// Two halves that must stay apart:
//
//   requestEmailChange()  writes NOTHING about the account. It records an
//                         intention and hands back a token. Until the token
//                         comes back, the account is exactly as it was — the
//                         old address still signs in, a password still works,
//                         and an abandoned request stays abandoned for ever.
//
//   confirmEmailChange()  is the only thing that moves the address, and it runs
//                         only for somebody holding a token that was mailed to
//                         the NEW address. That is the whole proof.
//
// What this deliberately does NOT do is claim purchases or send mail. Both
// belong to the caller: a failed claim must not fail the change (see the page),
// and a mail needs the request's language.
import { and, eq, lt, ne } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { db } from "@/db";
import { emailChanges, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/users/rules";
import { hasEmailConfig } from "@/lib/env-guard";
import {
  CONFIRMATION_ACCOUNT_BUCKET,
  CONFIRMATION_LIMIT,
  CONFIRMATION_TARGET_BUCKET,
  PROBE_BUCKET,
  PROBE_LIMIT,
  EmailChangeError,
  checkRequestedEmail,
  expiryFrom,
  isExpired,
} from "@/lib/email-change/rules";
import { isLimited, record } from "@/lib/rate-limit";

/** 32 bytes of CSPRNG output, URL-safe. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored. The token itself never touches the database. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface PendingChange {
  newEmail: string;
  expiresAt: Date;
}

/** The change this Member is waiting on, if any. Never returns the token. */
export async function pendingChangeFor(
  userId: string,
): Promise<PendingChange | null> {
  const [row] = await db
    .select({ newEmail: emailChanges.newEmail, expiresAt: emailChanges.expiresAt })
    .from(emailChanges)
    .where(eq(emailChanges.memberId, userId));
  if (!row) return null;
  // An expired row is not a pending change — showing one would tell the Member
  // to keep waiting for a link that no longer works.
  if (isExpired(row.expiresAt, new Date())) return null;
  return row;
}

/**
 * Records that this Member would like to move to `rawEmail`, and returns the
 * token to mail there. Changes nothing about the account.
 */
export async function requestEmailChange(
  userId: string,
  rawEmail: unknown,
  opts: { impersonating: boolean },
): Promise<{ newEmail: string; token: string; expiresAt: Date }> {
  // 🚨 BEFORE the transport check, and before the row. An operator signed in AS
  // this member may not move the address: the confirmation goes to the NEW
  // mailbox — the one the operator typed — and the old address is never told.
  // The change outlives the thirty minutes and appears in no impersonation
  // record. Same reasoning, spelled out, in `lib/credentials/manage.ts`.
  //
  // ⚠️ `confirmEmailChange()` below deliberately gets NO such guard: it is a
  // public token endpoint with no session at all. The refusal belongs at the
  // request, not at the confirmation.
  if (opts.impersonating) throw new EmailChangeError("notWhileImpersonating");

  // FIRST, before anything is read or written. Mail is not a delivery detail of
  // this feature, it IS the mechanism: the link is the only thing that can move
  // an address. Without a transport there is nothing to send and therefore
  // nothing this function can usefully do.
  //
  // Checked here rather than left to the send failing later, because the row is
  // written before the send. Discovering it afterwards left a Member reading
  // "unknown error" while their account page announced a change waiting for a
  // confirmation that was never posted — the app looking like it had worked.
  if (!hasEmailConfig(process.env)) {
    throw new EmailChangeError("mailNotConfigured");
  }

  const newEmail = normalizeEmail(rawEmail);

  const [me] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!me) throw new EmailChangeError("changeNotFound");

  const denial = checkRequestedEmail(me.email, newEmail);
  if (denial) throw new EmailChangeError(denial);

  // Every request that gets this far is counted, refused or not — this is the
  // counter that meters the disclosure below rather than the mail. It must be
  // recorded BEFORE the lookup, or a refusal would slip past it for free,
  // which is precisely the hole it exists to close.
  if (isLimited(PROBE_BUCKET, userId, PROBE_LIMIT)) {
    throw new EmailChangeError("tooManyRequests");
  }
  record(PROBE_BUCKET, userId, PROBE_LIMIT);

  // Told straight away rather than at confirmation time. This does confirm to
  // the requester that an account exists at that address — judged acceptable
  // for a single-operator SAAS, and cheaper than spending a mail and the
  // Member's day on a request that was never going to succeed. Metered by the
  // probe counter above, so it answers a person and not a script.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, newEmail as string), ne(users.id, userId)));
  if (taken) throw new EmailChangeError("emailTaken");

  // Checked AFTER the refusals above, so a mistyped address does not spend one
  // of the three: nothing was going to be sent for it anyway. Both counters are
  // asked before either is written — otherwise a request refused by the second
  // would still have consumed a slot on the first.
  const target = newEmail as string;
  if (
    isLimited(CONFIRMATION_ACCOUNT_BUCKET, userId, CONFIRMATION_LIMIT) ||
    isLimited(CONFIRMATION_TARGET_BUCKET, target, CONFIRMATION_LIMIT)
  ) {
    throw new EmailChangeError("tooManyRequests");
  }

  const token = newToken();
  const expiresAt = expiryFrom(new Date());

  // At most one pending change per Member: the new request REPLACES the old
  // one, which is how a typo'd address is corrected. Any link already in flight
  // stops working at this moment — that is the point, not a side effect.
  await db.transaction(async (tx) => {
    // Expired rows anywhere in the installation go at the same time, and this
    // is a data-protection rule rather than housekeeping. `newEmail` is an
    // address somebody TYPED — on a typo it belongs to a stranger who never
    // asked to be in this database, and once the link has expired the row can
    // no longer do anything for anyone. Storage limitation says it should not
    // outlive its purpose, and its purpose ended at `expiresAt`.
    //
    // Done on a write that already runs rather than on a schedule, so an
    // operator who never sets up cron still gets it. See docs/data-protection.md.
    await tx.delete(emailChanges).where(lt(emailChanges.expiresAt, new Date()));
    await tx.delete(emailChanges).where(eq(emailChanges.memberId, userId));
    await tx.insert(emailChanges).values({
      memberId: userId,
      newEmail: target,
      tokenHash: hashToken(token),
      expiresAt,
    });
  });

  // Counted at the REQUEST, not at the send. The caller does the sending, and a
  // transport that fails would otherwise hand an attacker unlimited retries
  // against an address that is bouncing — which is the shape of the abuse, not
  // an exception to it.
  record(CONFIRMATION_ACCOUNT_BUCKET, userId, CONFIRMATION_LIMIT);
  record(CONFIRMATION_TARGET_BUCKET, target, CONFIRMATION_LIMIT);

  return { newEmail: target, token, expiresAt };
}

export type ConfirmResult =
  | { applied: true; memberId: string; oldEmail: string | null; newEmail: string }
  /** The link was already used. Not an error — say so and stop. */
  | { applied: false; alreadyDone: true; newEmail: string };

/**
 * Moves the account, for whoever proves they can read mail at the new address.
 *
 * Authenticated by the token and by nothing else — deliberately. The mail is
 * read on whichever device the Member happens to have their inbox on, which is
 * routinely not the one they made the request from, and demanding a session
 * here would strand exactly the person the feature is for.
 */
export async function confirmEmailChange(
  rawToken: string,
): Promise<ConfirmResult> {
  const [row] = await db
    .select()
    .from(emailChanges)
    .where(eq(emailChanges.tokenHash, hashToken(rawToken)));
  if (!row) throw new EmailChangeError("changeNotFound");

  const [member] = await db
    .select({ email: users.email, blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.id, row.memberId));
  if (!member) throw new EmailChangeError("changeNotFound");

  // Already there: the link was followed twice, or a mail scanner opened it
  // before the Member did. Nothing to do, and nothing that deserves a red page.
  if (member.email === row.newEmail) {
    return { applied: false, alreadyDone: true, newEmail: row.newEmail };
  }

  if (member.blockedAt) throw new EmailChangeError("userBlocked");
  if (isExpired(row.expiresAt, new Date())) {
    throw new EmailChangeError("changeExpired");
  }

  // Asked a SECOND time, and this is the one that counts: between the request
  // and this click, somebody else may have taken the address.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, row.newEmail), ne(users.id, row.memberId)));
  if (taken) throw new EmailChangeError("emailTaken");

  const oldEmail = member.email;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: row.newEmail,
        // SET, not cleared — and this is the opposite of what the Operator's
        // setUserEmail() does, on purpose. There, an address is asserted by
        // somebody else and has proved nothing. Here, following this link IS
        // the proof, so the account ends up in a stronger state than it began.
        emailVerified: new Date(),
      })
      .where(eq(users.id, row.memberId));
    // The row has done its job. No history is kept — see db/schema-email-changes.ts.
    await tx.delete(emailChanges).where(eq(emailChanges.id, row.id));
  });

  return { applied: true, memberId: row.memberId, oldEmail, newEmail: row.newEmail };
}
