// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this module answers about one person, for the member's own download.
//
// 🚨 **This section is new, and its absence was a defect rather than a
// decision.** While the API was core, `api_keys` was in neither export — not in
// `lib/privacy/export.ts` and not in `scripts/privacy/export-data.mjs` — although
// `schema.ts` says of the `name` column, in as many words, *"Theirs to write, so
// it is personal data and it is in docs/data-protection.md."* Nothing compared
// those two claims. The manifest does: it refuses a module that declares
// `tables` without a complete `privacy` block, and that refusal is what asked
// the question.
//
// The twin is `sections.mjs` — the operator's command is bare Node and cannot
// import TypeScript, so the same query exists twice, in Drizzle and in raw SQL.
// `scripts/modules/privacy.test.ts` compares them against the manifest.
//
// 🚨 Neither half asks whether the API is switched ON. `config/api.json` is a
// switch; an export says what the app HOLDS. An app that ran the API for a year
// and then set `"enabled": false` still holds every key ever minted.
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import type { ModulePrivacy } from "@/lib/modules/privacy";
import { apiKeys } from "../schema";

const privacy: ModulePrivacy = {
  sections: ["apiKeys"],

  async build(memberId: string) {
    // ⛔ `tokenHash` is NOT selected, and adding it would be the one real
    // mistake available in this file. It is the credential — a subject access
    // request hands a person a JSON file that routinely travels by mail, and a
    // hash of a live key does not belong in one. `prefix` is deliberately fine:
    // it is the part already shown on the account page, so the member can tell
    // which row is which key, and it is not enough to be one.
    const rows = await db
      .select({
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scope: apiKeys.scope,
        audience: apiKeys.audience,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.memberId, memberId))
      .orderBy(asc(apiKeys.createdAt));

    // Revoked and expired keys are INCLUDED. The question is what the app holds
    // about this person, and a revoked key is a row it still holds — with a
    // name they wrote and a record of when they last used it.
    return { apiKeys: rows };
  },
};

export default privacy;
