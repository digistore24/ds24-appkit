// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading and writing consent records.
//
// The shell around `lib/consent/rules.ts`: this file talks to the database, the
// rules file decides. Nothing here makes a judgement about what a consent means.
//
// ── The one security property ──────────────────────────────────────────────
// `recordConsent()` takes NO member id. The account it writes for is always the
// session's own, exactly as `spendTokens()` works and for the same reason: a
// Server Action is an HTTP endpoint of its own, so a member id arriving in a
// `FormData` is a parameter somebody can change. Consent recorded against
// another person's account is worse than a missing record — it is a fabricated
// permission with your name on it.
//
// Reading is a different shape. `consentsFor(memberId)` is called by the
// Operator's export and by `node run.mjs data-export`, where naming somebody
// else IS the job — the same split as `spendTokens` versus `consumeTokens`.
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentRecords } from "@/db/schema";
import { requireActiveUser } from "@/lib/authz";
import { consentPurpose, consentPurposes } from "./config";
import {
  ConsentError,
  currentConsent,
  type ConsentPurpose,
  type ConsentRecord,
  type ConsentState,
} from "./rules";

/** A purpose together with where this member stands on it. */
export interface ConsentStatus {
  purpose: ConsentPurpose;
  state: ConsentState;
  /** When they last answered. `null` when they never have. */
  answeredAt: Date | null;
}

/**
 * Record an answer for the signed-in member.
 *
 * Always an INSERT — the table is append-only, so a withdrawal is this function
 * called with `granted: false`. Never an update: the previous row is the
 * evidence that consent was given at the time, and Art. 7(1) asks you to be
 * able to show exactly that.
 *
 * `locale` is stored because "informed" means informed in a language they read.
 * If the two translations ever drift, this says which sentence they saw.
 */
export async function recordConsent({
  purpose: purposeKey,
  granted,
  locale,
}: {
  purpose: string;
  granted: boolean;
  locale: string;
}): Promise<void> {
  const session = await requireActiveUser();
  // The cast is the house idiom (`lib/tokens/spend.ts`, `lib/authz.ts`):
  // Auth.js types `id` as optional, but `requireActiveUser()` has already
  // redirected anyone without a session.
  const memberId = session.user.id;

  // Not merely tidy: an undeclared purpose would write a row nothing can ever
  // read back — `currentConsent` only answers for purposes in the config, so
  // the record would be invisible to the account page and to the export.
  const purpose = consentPurpose(purposeKey);
  if (!purpose) throw new ConsentError("unknownPurpose");

  await db.insert(consentRecords).values({
    memberId,
    purpose: purpose.key,
    granted,
    // The version that is current NOW, not one supplied by the caller. A
    // version travelling in from the request would let a stale browser tab
    // record agreement to wording that has since been replaced.
    textVersion: purpose.textVersion,
    locale,
  });
}

/**
 * Every record held for one member, newest first.
 *
 * For the subject access request and the account page. Takes an id because both
 * callers legitimately name somebody else — see the note at the top.
 */
export async function consentsFor(memberId: string): Promise<ConsentRecord[]> {
  const rows = await db
    .select({
      purpose: consentRecords.purpose,
      granted: consentRecords.granted,
      textVersion: consentRecords.textVersion,
      createdAt: consentRecords.createdAt,
    })
    .from(consentRecords)
    .where(eq(consentRecords.memberId, memberId))
    .orderBy(desc(consentRecords.createdAt));

  return rows;
}

/**
 * Where this member stands on every declared purpose.
 *
 * What the account page renders and what a feature asks before acting. An app
 * with no purposes declared gets an empty array, and every page built on this
 * renders nothing — which is the shipped state.
 */
export async function consentStatusFor(memberId: string): Promise<ConsentStatus[]> {
  const purposes = consentPurposes();
  if (purposes.length === 0) return [];

  const records = await consentsFor(memberId);

  return purposes.map((purpose) => {
    const answered = records.find((record) => record.purpose === purpose.key);
    return {
      purpose,
      state: currentConsent(records, purpose),
      answeredAt: answered?.createdAt ?? null,
    };
  });
}

/**
 * May the app do the thing this purpose covers, for this member?
 *
 * **The only question a feature should ask**, and the one to put in front of
 * the tag, the mail or the transfer — not in front of the button that triggers
 * it. An unknown purpose answers `false` rather than throwing: a feature asking
 * about a purpose somebody deleted from the config must stop, not crash.
 */
export async function hasConsent(memberId: string, purposeKey: string): Promise<boolean> {
  const purpose = consentPurpose(purposeKey);
  if (!purpose) return false;

  const records = await db
    .select({
      purpose: consentRecords.purpose,
      granted: consentRecords.granted,
      textVersion: consentRecords.textVersion,
      createdAt: consentRecords.createdAt,
    })
    .from(consentRecords)
    .where(
      and(eq(consentRecords.memberId, memberId), eq(consentRecords.purpose, purpose.key)),
    )
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);

  return currentConsent(records, purpose) === "granted";
}
