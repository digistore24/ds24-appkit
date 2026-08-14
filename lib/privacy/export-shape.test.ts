// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What `buildMemberExport()` really HANDS OVER — the object, not the list.
//
// `lib/privacy/export.test.ts` compares `MEMBER_EXPORT_SECTIONS` against the
// operator command's own list. Two DECLARATIONS, and nothing between them ever
// called the function — which is how this shipped:
//
//   const [ …, impersonationRows, mediaRows ] = await Promise.all([ …9 queries… ])
//
// Eight names for nine queries. An array destructuring with too few names is
// legal TypeScript, so everything from the gap on shifted up: `mediaRows` got
// the setup-audit rows, the member's own uploads fell out of the answer, and
// `setupActs` — a section `MEMBER_EXPORT_SECTIONS` PROMISES — never reached the
// returned object at all. Typecheck clean, every test green, and the person
// exercising their Art. 15 right got somebody else's rows under the heading
// "media" and silence on a section they were promised.
//
// So this file calls the function. The driver is `drizzle-orm/pg-proxy` (the
// pattern is `lib/notify/sent-once.test.ts`) and each query is answered with
// its OWN table's name in every column — so a shifted result arrives wearing
// the other query's label and says so.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  // Every column of every row is the table the query read. Forty of them
  // because the projections differ in width and drizzle maps positionally,
  // ignoring the surplus — a count per query would be a second copy of the
  // queries, which is the thing this file exists to stop trusting.
  const db = drizzle(async (sql: string) => {
    const table = /\bfrom\s+"([a-z_]+)"/i.exec(sql)?.[1] ?? "unknown";
    return { rows: [Array.from({ length: 40 }, () => table)] };
  });
  return { db };
});

import { getTableName } from "drizzle-orm";
import {
  accounts,
  aiUsage,
  chatMessages,
  consentRecords,
  emailChanges,
  grants,
  impersonations,
  invoices,
  media,
  orders,
  setupAudit,
  subscriptions,
  tokenAccounts,
  tokenLedger,
  users,
} from "@/db/schema";

import { MEMBER_EXPORT_SECTIONS, buildMemberExport } from "./export";

/**
 * Which table each promised section is an answer ABOUT.
 *
 * This is the claim, not a convenience: "the rows under this heading came from
 * this table". The table NAMES are read off the schema rather than typed out,
 * so a renamed table moves this file with it instead of quietly passing.
 */
const SECTION_TABLE: Record<string, string> = {
  account: getTableName(users),
  signInMethods: getTableName(accounts),
  pendingEmailChange: getTableName(emailChanges),
  consents: getTableName(consentRecords),
  orders: getTableName(orders),
  subscriptions: getTableName(subscriptions),
  invoices: getTableName(invoices),
  tokenAccounts: getTableName(tokenAccounts),
  tokenLedger: getTableName(tokenLedger),
  grants: getTableName(grants),
  chatMessages: getTableName(chatMessages),
  aiUsage: getTableName(aiUsage),
  impersonations: getTableName(impersonations),
  media: getTableName(media),
  setupActs: getTableName(setupAudit),
};

describe("🚨 the member export as it is really handed over", () => {
  it("keeps every section MEMBER_EXPORT_SECTIONS promises", async () => {
    const result = (await buildMemberExport("member-1")) as Record<
      string,
      unknown
    >;

    const missing = MEMBER_EXPORT_SECTIONS.filter(
      (section) => !Object.hasOwn(result, section),
    );
    expect(
      missing,
      "MEMBER_EXPORT_SECTIONS promises section(s) the returned object does " +
        "not have. A subject access request answered with silence on a " +
        "promised heading is a defect in the answer, not in the list — check " +
        "the destructuring of the Promise.all in export.ts.",
    ).toEqual([]);
  });

  it("puts each table's rows under its OWN heading", async () => {
    const result = (await buildMemberExport("member-1")) as Record<
      string,
      unknown
    >;

    for (const [section, table] of Object.entries(SECTION_TABLE)) {
      // At least one text column survives the column mappers, so the marker is
      // findable; a section carrying another query's rows carries that query's
      // table name instead and fails here with both names on screen.
      expect(
        JSON.stringify(result[section] ?? null),
        `the "${section}" section does not contain rows from "${table}" — a ` +
          "shifted destructuring hands one query's rows to the next name",
      ).toContain(`"${table}"`);
    }
  });

  it("names every section it returns, so nothing arrives unannounced", async () => {
    // The other direction of the same rule. A section in the object that no
    // list mentions is a heading nobody has judged — and the operator's export
    // will not have it.
    const { MODULES } = await import("@/lib/modules/registry");
    const moduleSections = new Set<string>();
    for (const mod of MODULES) {
      for (const section of mod.privacy?.sections ?? []) {
        moduleSections.add(section);
      }
    }

    const result = (await buildMemberExport("member-1")) as Record<
      string,
      unknown
    >;
    const promised = new Set<string>([
      ...MEMBER_EXPORT_SECTIONS,
      ...moduleSections,
      // Not sections — the envelope: who the file is about, and the
      // plain-language notes that travel with it (what the app does not hold,
      // why orders stay).
      "subject",
      "generatedAt",
      "aboutThisFile",
    ]);

    const unannounced = Object.keys(result).filter((key) => !promised.has(key));
    expect(
      unannounced,
      "section(s) in the export that no list names — add them to " +
        "MEMBER_EXPORT_SECTIONS (and to the operator's export) or take them out",
    ).toEqual([]);
  });
});
