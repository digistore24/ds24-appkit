// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Everything this app holds about one person, as one JSON file.
//
// This is what answers a GDPR subject access request (Art. 15) and a request
// for portability (Art. 20). The operator has one month to reply to either;
// this turns that into one command.
//
// Usage:
//   node run.mjs data-export --email kunde@example.de
//   node run.mjs data-export --email kunde@example.de --out auskunft.json
//   Direct:  node scripts/privacy/export-data.mjs --email …
//
// ── Two things about it that are deliberate and easy to "fix" wrongly ───────
//
// 1. IT SEARCHES BY EMAIL ADDRESS, NOT BY ACCOUNT. The people most likely to
//    ask what you hold about them are the ones who never got an account: a
//    purchase made without signing in leaves an order with their address and
//    name and no member id at all (docs/data-protection.md §3). A member-scoped
//    export would answer "we hold nothing about you" while holding their name
//    and their purchase. Where an account does exist, both routes are followed
//    and the results merged.
//
// 2. IT INCLUDES THE OPERATOR'S NOTES. `grants.note` and `token_ledger.note`
//    hold what the operator wrote ABOUT this person — "comped, angry on the
//    phone". The app never shows those to the customer, and
//    lib/entitlements/leak-guard.test.ts enforces that. **That rule is about
//    the Member's own page and does not apply here.** A subject access request
//    asks what you hold, and you hold those. Stripping them from this file
//    would be answering the request untruthfully.
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "../users/_db.mjs";
import { moduleExportSections } from "../modules/inventory.mjs";

// ── Where the community's thirteen sections went ───────────────────────────
// They were spelled out below until Epic 24 made the community a module; the
// SQL now lives in `modules/community/privacy/sections.mjs` and reaches this
// report through `moduleExportSections()` at the bottom. That file is also the
// one allowed to name the two direct-message tables — the allowance moved with
// the query, and `dm-guard.test.ts` still holds the line.
//
// What did NOT move is the ruling those sections were the occasion for: no
// section here is gated on a feature switch. This file used to read
// `config/community.json` and drop them when it said off — with a comment
// claiming "same coercion the module applies", which was half of it: the app's
// `isCommunityEnabled()` is `enabled && problems.length === 0`, so one typo in
// that file made the operator's answer and the member's own download describe
// different applications. Switching a feature off deletes nothing, and an
// access request is about the data rather than about which features are
// currently enabled.

const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const rawEmail = arg("email");
const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    'ERROR: a valid --email "<address>" is required.\n' +
      "  Example: node run.mjs data-export --email kunde@example.de",
  );
  process.exit(2);
}
const outFile = arg("out");

const sql = connect();
try {
  // --- The account, if there is one ------------------------------------------
  const [account] = await sql`
    select id, email, name, image, role, "createdAt", "emailVerified", "blockedAt"
    from users where lower(email) = ${email}
  `;
  const memberId = account?.id ?? null;

  // --- Sign-in methods (never the credentials themselves) ---------------------
  const signInMethods = memberId
    ? await sql`
        select provider, type, "providerAccountId"
        from accounts where "userId" = ${memberId}
      `
    : [];

  const pendingEmailChange = memberId
    ? await sql`
        select "newEmail", "requestedAt", "expiresAt"
        from email_changes where "memberId" = ${memberId}
      `
    : [];

  // --- What they agreed to ----------------------------------------------------
  // Append-only, so this is the whole history and not just the current answer:
  // every yes, every no, every withdrawal, with the version of the wording that
  // was on screen at the time (db/schema-consent.ts). Empty in an app that
  // declares no purposes, which is the shipped state.
  const consents = memberId
    ? await sql`
        select purpose, granted, text_version, locale, created_at
        from consent_records where member_id = ${memberId} order by created_at`
    : [];

  // --- Purchases: by account AND by address ----------------------------------
  const orders = await sql`
    select * from orders
    where (${memberId}::text is not null and member_id = ${memberId})
       or lower(btrim(buyer_email)) = ${email}
    order by created_at
  `;

  const subscriptions = await sql`
    select * from subscriptions
    where (${memberId}::text is not null and member_id = ${memberId})
       or lower(btrim(buyer_email)) = ${email}
    order by created_at
  `;

  // Invoices carry no person at all — they hang off an order id. Reached
  // through the orders and subscriptions found above, or they would be missed.
  const orderIds = [
    ...new Set(
      [...orders, ...subscriptions].map((r) => r.ds24_order_id).filter(Boolean),
    ),
  ];
  const invoices = orderIds.length
    ? await sql`select * from invoices where ds24_order_id in ${sql(orderIds)} order by created_at`
    : [];

  // --- Balance and its journal ------------------------------------------------
  const tokenAccounts = memberId
    ? await sql`select * from token_accounts where member_id = ${memberId}`
    : [];
  const accountIds = tokenAccounts.map((a) => a.id);
  // `note` and `issued_by` included on purpose — see the header.
  const tokenLedger = accountIds.length
    ? await sql`select * from token_ledger where account_id in ${sql(accountIds)} order by created_at`
    : [];

  // --- Access ------------------------------------------------------------------
  const grants = memberId
    ? await sql`select * from grants where member_id = ${memberId} order by created_at`
    : [];

  // --- The AI assistant --------------------------------------------------------
  // Everything this person typed into the chat, and everything she answered.
  // Their own words are about as personal as this file gets — and unlike the
  // billing records they are deleted with the account, so an export made after
  // a deletion request correctly finds none. Empty when the chat is switched
  // off, and empty for a purchase with no account behind it.
  const chatMessages = memberId
    ? await sql`select id, conversation_id, role, content, links, created_at from chat_messages where member_id = ${memberId} order by created_at`
    : [];

  // What this person's use of the AI features consumed.
  //
  // Numbers only — no prompt and no answer, because `ai_usage` holds none
  // (db/schema-ai-usage.ts). It belongs in the answer all the same: it is a
  // record OF this person's activity, with timestamps, even though it says
  // nothing about what they said. Rows survive a deletion with the member link
  // removed, so an export made afterwards correctly finds none.
  const aiUsage = memberId
    ? await sql`
        select id, task, provider, model, input_tokens, output_tokens,
               cached_input_tokens, thinking_tokens, outcome, latency_ms, created_at
        from ai_usage where member_id = ${memberId} order by created_at`
    : [];

  // Learning performance — the member's results on interactive elements.
  // Deleted with the account (cascade), so a post-deletion export correctly
  // finds none. See docs/data-protection.md §8b.

  // --- Who signed in as this person --------------------------------------------
  // Every time an operator used "sign in as this user" on this account. The
  // operator's ADDRESS is included, not merely "an administrator": the person
  // asking is entitled to know who was in their account, and in a business with
  // more than one admin the generic answer is no answer.
  //
  // What it deliberately does not contain is what the operator DID while they
  // were in there. That is not an omission from this export — the app records
  // no such thing (db/schema-impersonation.ts). The changes that matter show up
  // in the sections above: the ledger, the grants, the address change.
  const impersonations = memberId
    ? await sql`
        select i.id, i.started_at, i.ended_at, i.ended_by, o.email as operator_email
        from impersonations i
        left join users o on o.id = i.operator_id
        where i.member_id = ${memberId} order by i.started_at`
    : [];

  // --- What the setup surface did about them -----------------------------------
  // The operator's coding agent creating their account, granting them a plan,
  // ending one. Personal data, and sliceable only because `setup_audit` carries
  // `subject_member_id` beside the human-readable `target`.
  //
  // Identifiers and numbers — never the payload. `role` and `reason` are the two
  // named exceptions, and both are about the person this section belongs to.
  const setupActs = memberId
    ? await sql`
        select created_at, app_env, tool, outcome, role, reason
        from setup_audit
        where subject_member_id = ${memberId} order by created_at`
    : [];

  // --- What they uploaded ------------------------------------------------------
  // The rows, not the files. An export is a JSON document; somebody who wants
  // their pictures back downloads them from the app.
  //
  // `owner` and `members` — the two visibilities that make an item the person's
  // own: what they uploaded for themselves, and the face they showed other
  // members. This list is `OWNED_MEDIA_VISIBILITIES` in lib/media/rules.ts,
  // spelled out here because this is bare Node and must not import TypeScript;
  // the three copies are kept in step by hand and by lib/privacy/export.test.ts.
  // `public` and `entitled` stay out: product imagery an operator uploaded
  // carries their id too and belongs to the application, not to them.
  const mediaRows = memberId
    ? await sql`
        select id, kind, mime, filename, bytes, alt, created_at
        from media
        where owner_id = ${memberId} and visibility in ('owner', 'members')
        order by created_at`
    : [];

  // --- The raw webhooks --------------------------------------------------------
  // Held for 60 days for diagnosis and pruned after that
  // (lib/digistore/ipn-log.ts), so this is usually shorter than the order list.
  const webhookEvents = orderIds.length
    ? await sql`
        select id, received_at, event, ds24_order_id, ds24_purchase_id, result, payload
        from ipn_events where ds24_order_id in ${sql(orderIds)}
        order by received_at
      `
    : [];

  const found =
    Number(Boolean(account)) +
    orders.length +
    subscriptions.length +
    tokenAccounts.length +
    grants.length;

  const report = {
    subject: { email, memberId, hasAccount: Boolean(account) },
    generatedAt: new Date().toISOString(),

    aboutThisFile: {
      purpose:
        "Everything this application holds about the person identified by the address above. Prepared for a data subject access request (GDPR Art. 15) / portability request (Art. 20).",
      searchedBy: memberId
        ? "the account with this address, and the address itself on purchase records"
        : "the address itself on purchase records — there is no account with it",
      deliberatelyExcluded: [
        "The password, if one is set. It is stored only as a one-way scrypt hash which nobody — including the operator — can read back, and disclosing a credential would create a risk rather than satisfy a right.",
        "OAuth access and refresh tokens. Credentials for another service, not information about the person.",
        "Sign-in link tokens and the address-change confirmation token. Single-use secrets, stored hashed, expired or spent by the time anyone reads this.",
      ],
      reviewBeforeSending: [
        "`webhookEvents[].payload` is the RAW body Digistore24 posted. It can contain fields about OTHER people — an affiliate, for instance. Third-party data must be redacted before this file is handed over; only this person's data belongs in the answer.",
        "`grants[].note` and `tokenLedger[].note` are what the operator wrote about this person, and `issued_by` is who wrote it. They belong in the answer — the app hides them from the customer's own page as a matter of tone, which is not an exemption. Read them before sending.",
        "`chatMessages[].content` is what this person typed into the assistant. People paste things into a chat box that nobody asked for, occasionally including data about somebody else — the same redaction rule as the webhook payloads applies.",
        "A private-message section, if this app has a module that contributes one, is a private CORRESPONDENCE and carries BOTH halves — every message marked `from_me: false` is the other participant's own words. That is right for the person who asked (their inbox already shows them all of it) and it is the part of this file to think hardest about before it leaves your hands: running this command puts a private conversation in front of somebody who was not in it. The app itself has no operator view of a conversation, deliberately; this report is the one exception and it is answered by hand for a named request.",
      ],
      alsoIncluded: [
        "`aiUsage[]` is what this person's use of the AI features consumed — task, provider, model, token counts, timestamps. It contains NO prompt and NO answer, because that table holds none. It is here because it records this person's activity, not because it records their words.",
        "`media[]` is what this person uploaded — kind, media type, the filename THEY chose, size and when it arrived. The files themselves are not in this document; they are in object storage and the app serves them. An uploaded photo can carry more than it appears to, so note that the app strips location and camera data from images on the way in — but NOT from video, which keeps whatever the recording device wrote (docs/data-protection.md).",
        "`impersonations[]` is every time an operator signed in as this person to look at their account — who, when, and for how long. It records ACCESS, not activity: what was done while inside is not captured anywhere, deliberately. A row with `ended_by: \"abandoned\"` was closed automatically when its 30 minutes ran out, which says when the session was due to end, not that the operator was present until then.",
      ],
      notHeldAtAll: [
        "No tracking, profiling or advertising data — this application collects none.",
        "IP addresses are counted in memory for fifteen minutes to limit failed sign-ins and are never written to the database, so there is nothing here to export.",
      ],
      retentionNote:
        "Orders and invoices are accounting records. German law requires them to be kept (§147 AO, §257 HGB) and the GDPR exempts them from erasure while that obligation runs (Art. 17(3)(b)) — they cannot simply be deleted on request. See docs/data-protection.md §6.",
    },

    account: account ?? null,
    signInMethods,
    pendingEmailChange,
    consents,
    orders,
    subscriptions,
    invoices,
    tokenAccounts,
    tokenLedger,
    grants,
    chatMessages,
    aiUsage,
    impersonations,
    setupActs,
    media: mediaRows,
    webhookEvents,
    // 🚨 And whatever the installed modules hold about this person — the same
    // merge `lib/privacy/export.ts` does, from the same manifests. Neither is
    // gated on a module being switched ON: an export says what the app HOLDS,
    // and the only thing that may make a module's sections absent is the module
    // being ABSENT. `module remove` refuses while its tables hold rows, so
    // absent code and absent data stay the same statement.
    ...(await moduleExportSections(sql, memberId)),
  };

  const json = JSON.stringify(report, null, 2);
  if (outFile) {
    writeFileSync(outFile, json + "\n");
    console.log(`✓ Written to ${outFile}`);
  } else {
    console.log(json);
  }

  const where = outFile ? "" : "  (use --out <file> to write it to a file)";
  console.error(
    found === 0
      ? `\nℹ Nothing found for ${email}. That is itself a valid answer to a subject access request — but check the spelling first.${where}`
      : `\n✓ ${email}: account ${account ? "yes" : "no"}, ${orders.length} order(s), ${subscriptions.length} subscription(s), ${grants.length} grant(s), ${tokenLedger.length} ledger entr${tokenLedger.length === 1 ? "y" : "ies"}, ${chatMessages.length} chat message(s), ${aiUsage.length} AI call(s), ${impersonations.length} impersonation(s), ${mediaRows.length} media item(s), ${webhookEvents.length} webhook event(s).${where}`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
