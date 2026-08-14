// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's own copy of what this app holds about them.
//
// Art. 15 GDPR (a copy of the data) and Art. 20 (in a structured, commonly used,
// machine-readable form). The operator's version of the same answer is
// `node run.mjs data-export --email …` (`scripts/privacy/export-data.mjs`), and
// the two are deliberately NOT the same file. See below.
//
// ── Why there are two, and why that is not duplication to be tidied away ───
//
//  1. **They are asked by different people, and answer different questions.**
//     The command answers "what do you hold about this address", typed by an
//     operator who can read the file before sending it. This one answers "what
//     do you hold about ME", downloaded directly by the person, with nobody in
//     between to redact anything.
//
//  2. **So this one leaves out the raw webhook payloads.** `ipn_events` holds
//     the body Digistore24 posted, and that body can carry fields about OTHER
//     people — an affiliate, for instance. The command's own header tells the
//     operator to strip those before forwarding. A self-service download has no
//     such step, and Art. 15(4) is explicit that the right to a copy "shall not
//     adversely affect the rights and freedoms of others". The derived order
//     fields are all here; the raw envelope is not.
//
//  3. **Everything else IS here, including what the operator wrote.**
//     `grants.note` and `tokenLedger.note` are notes ABOUT this person
//     ("comped, angry on the phone"). The app hides them from the account page
//     as a matter of tone — `lib/entitlements/leak-guard.test.ts` enforces
//     that — and tone is not an exemption from a legal request. Write them as
//     if they will be read out, because here they are.
//
// `lib/privacy/export.test.ts` compares the two exports section by section and
// fails the build when one grows a table the other does not have. That is the
// realistic drift: somebody adds a table, updates the export they happened to
// be looking at, and the other one quietly starts answering incompletely.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { OWNED_MEDIA_VISIBILITIES } from "@/lib/media/rules";
import { MODULES } from "@/lib/modules/registry";
import {
  accounts,
  aiUsage,
  chatMessages,
  consentRecords,
  emailChanges,
  grants,
  impersonations,
  setupAudit,
  invoices,
  media,
  orders,
  subscriptions,
  tokenAccounts,
  tokenLedger,
  users,
} from "@/db/schema";

/**
 * The sections a member's export contains.
 *
 * Exported so the parity test can compare it against the command's own list
 * without parsing an object literal out of a running query.
 */
export const MEMBER_EXPORT_SECTIONS = [
  "account",
  "signInMethods",
  "pendingEmailChange",
  "consents",
  "orders",
  "subscriptions",
  "invoices",
  "tokenAccounts",
  "tokenLedger",
  "grants",
  "chatMessages",
  "aiUsage",
  "impersonations",
  "media",
  "setupActs",
  // ⚠️ **A module's sections are NOT in this list, and they are not optional
  // either.** The community's thirteen used to be spelled out here; they now
  // live in `modules/community/privacy/sections.ts` beside the queries that
  // answer them, and reach this file through `...moduleSections` at the bottom.
  // What moved with them is the ruling they were the occasion for: an export
  // says what the app HOLDS, so no section here or in a module may be a
  // function of a feature switch. `lib/modules/privacy.ts` carries the full
  // account, and `lib/privacy/export.test.ts` enforces it on this file.
] as const;

/**
 * Sections the OPERATOR's export has and this one deliberately does not.
 *
 * If you add to this list, say why here — an unexplained gap in a subject
 * access request is a gap in the answer.
 */
export const DELIBERATELY_NOT_SELF_SERVICE = [
  // Raw Digistore24 webhook bodies. May contain third-party data (an
  // affiliate's details), and there is nobody between the query and the
  // download to take it out. Art. 15(4).
  "webhookEvents",
] as const;

export interface MemberExport {
  subject: { memberId: string; email: string | null };
  generatedAt: string;
  aboutThisFile: Record<string, unknown>;
  [section: string]: unknown;
}

/**
 * Build the export for ONE member — the caller's own.
 *
 * Takes an id because it is called from a route handler that has already
 * established whose session it is (`currentActiveUser()`). It must never be
 * handed an id that came out of a request body; see
 * `app/api/account/export/route.ts`.
 */
export async function buildMemberExport(
  memberId: string,
): Promise<MemberExport> {
  // Asked first, so a module that throws does so before half a file has been
  // assembled — an Art. 15 answer is whole or it is an error, never partial.
  const moduleSections: Record<string, unknown> = {};
  for (const mod of MODULES) {
    if (!mod.privacy) continue;
    Object.assign(moduleSections, await mod.privacy.build(memberId));
  }

  const [account] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      createdAt: users.createdAt,
      emailVerified: users.emailVerified,
      blockedAt: users.blockedAt,
      // Deliberately absent: `passwordHash` (a one-way hash nobody can read
      // back, and handing over a credential creates risk rather than
      // satisfying a right) and `checkoutToken` (not personal data — a random
      // string that corroborates an id inside a checkout call).
    })
    .from(users)
    .where(eq(users.id, memberId));

  if (!account) {
    throw new Error(`no such member: ${memberId}`);
  }

  /**
   * Purchases made before this person ever signed up.
   *
   * A purchase without an account leaves an order carrying the buyer's address
   * and no member id (`docs/data-protection.md` §3), and it is that person's
   * personal data as much as anything attached to the account.
   *
   * **Matched by address only when the address is VERIFIED**, and that
   * condition is load-bearing rather than cautious. An Operator can set a
   * member's address with no confirmation link (`setUserEmail()`), and doing so
   * CLEARS `emailVerified` — while a member changing their own address proves
   * they can read mail there, which SETS it. Without this guard, an address set
   * by somebody else would pull a stranger's purchase history into this file.
   */
  const email = account.email?.trim().toLowerCase() ?? null;
  const claimableEmail = account.emailVerified !== null ? email : null;

  // `AnyPgColumn` because the two callers pass columns of different tables, and
  // a signature pinned to `orders` would reject the `subscriptions` pair.
  const byMemberOrEmail = (
    memberColumn: AnyPgColumn,
    emailColumn: AnyPgColumn,
  ) =>
    claimableEmail
      ? or(
          eq(memberColumn, memberId),
          eq(sql`lower(btrim(${emailColumn}))`, claimableEmail),
        )
      : eq(memberColumn, memberId);

  const [
    signInMethods,
    pendingEmailChange,
    consents,
    orderRows,
    subscriptionRows,
  ] = await Promise.all([
    // The providers, never the tokens: an OAuth access token is a credential
    // for somebody else's service, not information about this person.
    db
      .select({
        provider: accounts.provider,
        type: accounts.type,
        providerAccountId: accounts.providerAccountId,
      })
      .from(accounts)
      .where(eq(accounts.userId, memberId)),

    db
      .select({
        newEmail: emailChanges.newEmail,
        requestedAt: emailChanges.requestedAt,
        expiresAt: emailChanges.expiresAt,
      })
      .from(emailChanges)
      .where(eq(emailChanges.memberId, memberId)),

    db
      .select({
        purpose: consentRecords.purpose,
        granted: consentRecords.granted,
        textVersion: consentRecords.textVersion,
        locale: consentRecords.locale,
        createdAt: consentRecords.createdAt,
      })
      .from(consentRecords)
      .where(eq(consentRecords.memberId, memberId))
      .orderBy(asc(consentRecords.createdAt)),

    db
      .select()
      .from(orders)
      .where(byMemberOrEmail(orders.memberId, orders.buyerEmail))
      .orderBy(asc(orders.createdAt)),

    db
      .select()
      .from(subscriptions)
      .where(byMemberOrEmail(subscriptions.memberId, subscriptions.buyerEmail))
      .orderBy(asc(subscriptions.createdAt)),
  ]);

  // Invoices carry no person at all — they hang off an order id, so they are
  // reached through the orders and subscriptions found above or missed entirely.
  const orderIds = [
    ...new Set(
      [...orderRows, ...subscriptionRows]
        .map((row) => row.ds24OrderId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const accountIds = (
    await db
      .select({ id: tokenAccounts.id })
      .from(tokenAccounts)
      .where(eq(tokenAccounts.memberId, memberId))
  ).map((row) => row.id);

  const [
    invoiceRows,
    tokenAccountRows,
    ledgerRows,
    grantRows,
    chatRows,
    usageRows,
    impersonationRows,
    // 🚨 One name per query, in the query's own order. A destructuring with too
    // FEW names is legal TypeScript and silently shifts everything after the
    // gap: this list was missing `setupActRows`, so `mediaRows` received the
    // setup-audit rows, the member's own uploads fell out of the answer
    // entirely, and `setupActs` — which `MEMBER_EXPORT_SECTIONS` promises —
    // never reached the returned object at all. Typecheck was clean and the
    // parity test compared two DECLARATIONS, so nobody ever called this
    // function. `lib/privacy/export-shape.test.ts` now does.
    setupActRows,
    mediaRows,
  ] = await Promise.all([
    orderIds.length
      ? db
          .select()
          .from(invoices)
          .where(inArray(invoices.ds24OrderId, orderIds))
          .orderBy(asc(invoices.createdAt))
      : Promise.resolve([]),

    db.select().from(tokenAccounts).where(eq(tokenAccounts.memberId, memberId)),

    // `note` included on purpose — see point 3 in the header.
    accountIds.length
      ? db
          .select()
          .from(tokenLedger)
          .where(inArray(tokenLedger.accountId, accountIds))
          .orderBy(asc(tokenLedger.createdAt))
      : Promise.resolve([]),

    db
      .select()
      .from(grants)
      .where(eq(grants.memberId, memberId))
      .orderBy(asc(grants.createdAt)),

    db
      .select({
        id: chatMessages.id,
        // Which conversation each turn belongs to — `null` is the assistant,
        // anything else is a companion, keyed `<companion>:<subject>`. Without
        // it a person receives two hundred undifferentiated turns from five
        // different subjects: technically complete, practically useless, and a
        // subject access request is answered by what somebody can read.
        conversationId: chatMessages.conversationId,
        role: chatMessages.role,
        content: chatMessages.content,
        // The pages an answer pointed at. Not personal data in itself, but it
        // is part of the turn — and `docs/data-protection.md` lists it as
        // travelling with the row, which is a promise this projection has to
        // keep. Explicit column lists are how a new column goes missing from
        // an access request without anything failing.
        links: chatMessages.links,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.memberId, memberId))
      .orderBy(asc(chatMessages.createdAt)),



    // Numbers only. `ai_usage` holds no prompt and no answer — there is no
    // column that could carry one (`db/schema-ai-usage.ts`). It belongs here
    // because it records this person's activity with timestamps, not because
    // it records their words.
    db
      .select({
        id: aiUsage.id,
        task: aiUsage.task,
        provider: aiUsage.provider,
        model: aiUsage.model,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        outcome: aiUsage.outcome,
        latencyMs: aiUsage.latencyMs,
        createdAt: aiUsage.createdAt,
      })
      .from(aiUsage)
      .where(eq(aiUsage.memberId, memberId))
      .orderBy(asc(aiUsage.createdAt)),

    // Every time an operator signed in as this person. The operator's ADDRESS,
    // not "an administrator": in a business with more than one admin the
    // generic answer is no answer, and this is the section a customer's
    // question — "has anyone from your company been in my account?" — lands in.
    db
      .select({
        id: impersonations.id,
        startedAt: impersonations.startedAt,
        endedAt: impersonations.endedAt,
        endedBy: impersonations.endedBy,
        operatorEmail: users.email,
      })
      .from(impersonations)
      .leftJoin(users, eq(users.id, impersonations.operatorId))
      .where(eq(impersonations.memberId, memberId))
      .orderBy(asc(impersonations.startedAt)),

    // Every setup act ABOUT this person: the operator's coding agent creating
    // their account, granting them a plan, ending one.
    //
    // It is here because it is personal data, and it is sliceable at all only
    // because `setup_audit` carries `subjectMemberId` beside the human-readable
    // `target` — a polymorphic text column cannot be queried per person, and
    // without the id this section could exist in the operator's export and not
    // in this one, which `export.test.ts` compares section by section and
    // refuses.
    //
    // What is NOT in it is the payload: the trail records identifiers and
    // numbers, never what was written. `role` and `reason` are the two named
    // exceptions, and both belong to the person the act was about.
    db
      .select({
        at: setupAudit.createdAt,
        environment: setupAudit.appEnv,
        tool: setupAudit.tool,
        outcome: setupAudit.outcome,
        role: setupAudit.role,
        reason: setupAudit.reason,
      })
      .from(setupAudit)
      .where(eq(setupAudit.subjectMemberId, memberId))
      .orderBy(asc(setupAudit.createdAt)),

    // What this person uploaded. `owner`-visible rows only: those are theirs.
    // Product imagery an operator uploaded carries their id too, and it belongs
    // to the app rather than to them — which is why the foreign key is
    // `set null` and not `cascade`.
    //
    // The FILE is not in here, and it should not be: an export is a JSON
    // document, and a member who wants their pictures back downloads them from
    // the app. What belongs here is the record that they exist, what they are
    // called and when they arrived. `filename` is in because they chose it.
    db
      .select({
        id: media.id,
        kind: media.kind,
        mime: media.mime,
        filename: media.filename,
        bytes: media.bytes,
        alt: media.alt,
        createdAt: media.createdAt,
      })
      .from(media)
      // The same set `listOwnedMedia()` sweeps on deletion, from the same
      // constant — deliberately, because the two must never disagree. An export
      // wider than the sweep promises to delete something it keeps; a sweep
      // wider than the export deletes something it never disclosed.
      .where(
        and(
          eq(media.ownerId, memberId),
          inArray(media.visibility, [...OWNED_MEDIA_VISIBILITIES]),
        ),
      )
      .orderBy(asc(media.createdAt)),
  ]);

  return {
    subject: { memberId, email },
    generatedAt: new Date().toISOString(),

    // Written for the PERSON receiving it, not for an operator. The command's
    // equivalent block is addressed the other way round — it tells whoever runs
    // it what to check before forwarding the file.
    aboutThisFile: {
      purpose:
        "Everything this application holds about you, prepared for your own records (GDPR Art. 15) and in a machine-readable form you can take elsewhere (Art. 20).",
      searchedBy:
        claimableEmail !== null
          ? "your account, and your confirmed email address on purchase records — so a purchase you made before signing up is included"
          : "your account. Your email address has not been confirmed, so purchases made under it before you signed up are not matched here — confirm your address, or ask us and we will look it up",
      notIncluded: [
        "Your password, if you set one. It is stored only as a one-way hash which nobody — not even we — can read back.",
        "Sign-in link tokens and confirmation tokens. Single-use secrets, stored hashed, and spent or expired by the time you read this.",
        "OAuth tokens from a connected sign-in provider. Those are credentials for that service, not information about you.",
        "The raw webhook bodies our payment provider sends us. They can contain details about other people (an affiliate, for example), so they are not part of a self-service download. Ask us and we will provide them with the third-party parts removed.",
      ],
      aboutTheNotes:
        "`grants[].note` and `tokenLedger[].note` are notes we wrote about your account — for example when access was granted by hand or a balance corrected. They are part of what we hold about you, so they are here.",
      aboutRetention:
        "Orders and invoices stay even if you delete your account. They are accounting records that German law requires us to keep (§ 147 AO, § 257 HGB), and the GDPR exempts exactly those from erasure while that obligation runs (Art. 17(3)(b)). Your member link is removed from them.",
      notHeldAtAll: [
        "No tracking, profiling, advertising or automated decision-making — this application does none.",
        "IP addresses are counted in memory for fifteen minutes to limit failed sign-in attempts and are never written to the database, so there is nothing here to export.",
      ],
    },

    account,
    signInMethods,
    pendingEmailChange,
    consents,
    orders: orderRows,
    subscriptions: subscriptionRows,
    invoices: invoiceRows,
    tokenAccounts: tokenAccountRows,
    tokenLedger: ledgerRows,
    grants: grantRows,
    chatMessages: chatRows,
    aiUsage: usageRows,
    impersonations: impersonationRows,
    media: mediaRows,
    setupActs: setupActRows,

    // 🚨 And whatever the installed modules hold about this person — the
    // community's thirteen sections among them, since Epic 24 moved them into
    // `modules/community/privacy/`.
    //
    // NOT gated on anything, for the reason those sections were the occasion
    // for: an export says what the app HOLDS. A section that
    // appears and vanishes with a config flag describes the PRODUCT instead of
    // the data. The only thing that may make a module's sections absent is the
    // module being ABSENT — and `module remove` refuses while its tables hold
    // rows, precisely so that absent code and absent data are the same
    // statement.
    //
    // `scripts/privacy/export-data.mjs` does the same merge with the same
    // sections, from the same manifests, and `lib/privacy/export.test.ts`
    // compares the two.
    ...moduleSections,
  };
}
