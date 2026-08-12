// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guard that keeps the two subject-access exports saying the same thing.
//
// There are two, on purpose (`lib/privacy/export.ts` explains why): the
// operator's command answers "what do you hold about this address", the
// member's download answers "what do you hold about me". They differ in exactly
// one documented way — the raw webhook bodies are not in the self-service file,
// because they can carry other people's data and nobody is in between to redact
// them (Art. 15(4)).
//
// **The failure this test exists for is not that difference. It is drift.**
// Somebody adds a table, updates whichever export they happened to be looking
// at, and the other one quietly starts answering a legal request incompletely.
// Nothing breaks, no page errors, and the gap surfaces the day a regulator asks
// why two answers about the same person disagree.
//
// Same shape as `lib/ai/providers/leak-guard.test.ts`: a rule nobody can be
// expected to remember, enforced by something that reads the tree.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { MEMBER_EXPORT_SECTIONS, DELIBERATELY_NOT_SELF_SERVICE } from "./export";
import { OWNED_MEDIA_VISIBILITIES } from "@/lib/media/rules";
import { moduleDeclaredSections } from "@/scripts/modules/inventory.mjs";
import { blankComments as withoutComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMMAND = join("scripts", "privacy", "export-data.mjs");
const command = readFileSync(join(ROOT, COMMAND), "utf8");

/**
 * The sections of the operator's report.
 *
 * Read out of the `const report = { … }` literal rather than by running it —
 * the script opens a database connection at import time, and a test that needed
 * Postgres would be a test nobody runs.
 */
function commandSections(): string[] {
  const start = command.indexOf("const report = {");
  expect(start, `no 'const report = {' in ${COMMAND}`).toBeGreaterThan(-1);

  const body = command.slice(start);
  const end = body.indexOf("\n  };");
  expect(end, `could not find the end of the report literal`).toBeGreaterThan(-1);

  const literal = body.slice(0, end);

  // Top-level keys only: two spaces of indentation inside the literal. Nested
  // keys (everything under `aboutThisFile`) are indented further and are prose
  // about the file rather than sections of it.
  const keys = [...literal.matchAll(/^ {4}(\w+)[,:]/gm)].map((match) => match[1]);

  // CONDITIONAL sections, spread in as `...(cond ? { name: … } : {})`.
  //
  // A section that is only emitted on some installations is still a section
  // this export covers, and it must still be compared against the other one —
  // otherwise the first conditional table silently drops out of the drift
  // check, which is the one thing this file exists to prevent. The community
  // profile is the first of them; every later optional module will use the same
  // idiom.
  //
  // AD-65 is often quoted here as "an app with the community off exports no
  // community sections". That sentence was written on 2026-08-05, when OFF was
  // the only way not to have a community. Epic 24 split that one state into two
  // — the module absent, and the module installed but switched off — and only
  // the first of them makes a section absent. The switch never does, which is
  // what the test 60 lines below asserts. See docs/data-protection.md §14a.
  const conditional = [...literal.matchAll(/\?\s*\{\s*(\w+):/g)].map((match) => match[1]);

  // `subject`, `generatedAt` and `aboutThisFile` are the envelope, not data.
  //
  // Plus the sections the installed MODULES declare. They are spread into the
  // literal (`...(await moduleExportSections(...))`), so the regex above cannot
  // see their names — and it must not have to: both exports take them from the
  // same manifests, which is what makes a module unable to appear in one export
  // and not the other. The per-module clamp (manifest == the .ts half == the
  // .mjs half) is `scripts/modules/privacy.test.ts`.
  return [...keys, ...conditional, ...moduleDeclaredSections()].filter(
    (key) => !["subject", "generatedAt", "aboutThisFile"].includes(key),
  );
}

describe("the two exports cover the same tables", () => {
  it("reads a plausible section list out of the command", () => {
    // Non-vacuity: a regex that matched nothing would make every assertion
    // below pass against an empty list.
    const sections = commandSections();
    expect(sections.length).toBeGreaterThan(8);
    expect(sections).toContain("orders");
    expect(sections).toContain("chatMessages");
  });

  it("the member's export omits only what is documented as omitted", () => {
    const missing = commandSections().filter(
      (section) =>
        !MEMBER_EXPORT_SECTIONS.includes(section as never) &&
        !moduleDeclaredSections().includes(section) &&
        !DELIBERATELY_NOT_SELF_SERVICE.includes(section as never),
    );

    expect(
      missing,
      `these sections are in ${COMMAND} but not in the member's own download. ` +
        `Either add them to MEMBER_EXPORT_SECTIONS (and to the query in ` +
        `lib/privacy/export.ts), or add them to DELIBERATELY_NOT_SELF_SERVICE ` +
        `with a comment saying why a person may not have their own copy — ` +
        `"we forgot" is not one of the reasons Art. 15 accepts.`,
    ).toEqual([]);
  });

  it("the command has everything the member's export has", () => {
    const sections = commandSections();
    const missing = MEMBER_EXPORT_SECTIONS.filter(
      (section) => !sections.includes(section),
    );

    expect(
      missing,
      `these sections are in the member's own download but not in ${COMMAND}. ` +
        `The operator's answer to a subject access request must not be the ` +
        `smaller of the two — it is the one that goes to a regulator.`,
    ).toEqual([]);
  });

  it("neither export gates a section on a feature switch", () => {
    // ⚠️ **This replaces a test that could not see the drift it was written
    // for.** It used to compare the SET of conditionally-emitted section names
    // across the two files — `...(cond ? { name: … } : {})` on both sides — and
    // stayed green while the two conditions were different functions: the app
    // used `isCommunityEnabled()` (`enabled && problems.length === 0`) and the
    // command used a local `.enabled === true`. One typo in
    // `config/community.json` then made the member's own download assert the
    // app held no community data while the operator's command returned every
    // row. Two answers to one Art. 15 request, and the test comparing which
    // sections were conditional saw two identical lists.
    //
    // The fix deleted the question rather than aligning the two predicates:
    // switching a module off deletes nothing, so an export must not be a
    // function of a switch at all. That is the ruling `lib/users/manage.ts`
    // already applies to erasure — "an erasure request is about the data
    // rather than about which features are currently enabled" — and access is
    // the same request read from the other end.
    //
    // So this asserts the property directly: no section in either file is
    // emitted conditionally, and neither file consults an enablement switch.
    const memberSource = readFileSync(join(ROOT, "lib", "privacy", "export.ts"), "utf8");

    const conditionalIn = (source: string) =>
      [...source.matchAll(/\?\s*\{\s*(\w+):/g)].map((match) => match[1]).sort();

    expect(
      conditionalIn(memberSource),
      "a section of the member's own download is emitted conditionally. An " +
        "export says what the app HOLDS; a heading that appears or vanishes " +
        "with a config flag describes the product instead of the data.",
    ).toEqual([]);
    expect(
      conditionalIn(command),
      `a section of ${COMMAND} is emitted conditionally — same reason.`,
    ).toEqual([]);

    // The switch itself must not be consulted. Named explicitly rather than
    // inferred from the shape above, because the next way to reintroduce this
    // is an early `if (!enabled) return []` beside the query rather than a
    // ternary around the key.
    //
    // Comments are stripped first: both files EXPLAIN this decision in prose
    // and name the function while doing so. A test that cannot tell a call from
    // the sentence describing why the call was removed would make the fix
    // undocumentable, which is a poor trade for a slightly shorter regex.
    for (const [label, source] of [
      ["lib/privacy/export.ts", withoutComments(memberSource)],
      [COMMAND, withoutComments(command)],
    ] as const) {
      expect(
        source,
        `${label} consults a community enablement switch. Whether a feature is ` +
          `switched on is not a fact about what the app holds about a person: ` +
          `groups archive rather than delete, so every row written while it was ` +
          `on is still there after it is switched off.`,
      ).not.toMatch(/isCommunityEnabled|communityEnabled\s*\(/);
    }
  });

  it("both exports and the deletion sweep agree on which media are the member's own", () => {
    // THE assertion of Story 19.4's deletion AC, and the reason it is written
    // as a source check: the database is mocked in the media tests, so nothing
    // there can see which visibility filter a query actually used.
    //
    // Three copies of one decision exist, and they must agree:
    //   1. `OWNED_MEDIA_VISIBILITIES` (lib/media/rules.ts) — the source of truth
    //   2. `lib/privacy/export.ts` and `listOwnedMedia()` — both import it
    //   3. `scripts/privacy/export-data.mjs` — bare Node, so it spells the list
    //      out in SQL and cannot import the constant
    //
    // If the third drifts, a member's own picture is either swept without ever
    // having been disclosed, or disclosed and then not swept — and the second
    // is an app that shows somebody a file it has promised to delete.
    const memberSource = readFileSync(join(ROOT, "lib", "privacy", "export.ts"), "utf8");
    const mediaSource = readFileSync(join(ROOT, "lib", "media", "manage.ts"), "utf8");

    // USED, not merely imported. `toContain` alone was satisfied by the import
    // line on its own — so reverting `listOwnedMedia()` to
    // `eq(media.visibility, "owner")` while leaving the import in place kept
    // this green, which is the exact drift the test exists to catch.
    const usesConstant = (source: string, near: string) => {
      const at = source.indexOf(near);
      expect(at, `${near} not found`).toBeGreaterThan(-1);
      // Within the query that follows the anchor, not anywhere in the file.
      return source.slice(at, at + 1200).includes("OWNED_MEDIA_VISIBILITIES");
    };
    expect(
      usesConstant(mediaSource, "export async function listOwnedMedia"),
      "listOwnedMedia does not build its filter from OWNED_MEDIA_VISIBILITIES",
    ).toBe(true);
    expect(
      usesConstant(memberSource, ".from(media)"),
      "the member export's media query does not build its filter from OWNED_MEDIA_VISIBILITIES",
    ).toBe(true);

    // The bare-Node copy, read out of its SQL.
    const inSql = /visibility in \(([^)]*)\)/.exec(command);
    expect(inSql, `${COMMAND}: no visibility filter found on the media query`).not.toBeNull();
    const spelled = [...inSql![1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(
      spelled,
      `${COMMAND} spells a different set of "owned" visibilities than ` +
        `OWNED_MEDIA_VISIBILITIES in lib/media/rules.ts`,
    ).toEqual([...OWNED_MEDIA_VISIBILITIES].sort());
  });

  it("every documented omission is real", () => {
    // Stops the exclusion list becoming a graveyard: an entry naming a section
    // the command no longer has is a comment explaining a decision nobody is
    // making any more.
    const sections = commandSections();
    for (const omitted of DELIBERATELY_NOT_SELF_SERVICE) {
      expect(
        sections,
        `DELIBERATELY_NOT_SELF_SERVICE names "${omitted}", which ${COMMAND} ` +
          `does not export either. Remove it.`,
      ).toContain(omitted);
    }
  });
});

describe("both exports carry the conversation a turn belongs to", () => {
  // ── Why this describe exists at all ──────────────────────────────────────
  // The parity check above compares section NAMES. A column added to one export
  // and forgotten in the other passes it silently — both files still have a
  // "chat messages" section, and both are still listed. So a companion's turns
  // would reach one answer differentiated and the other as an undifferentiated
  // heap, and nothing would say so.
  //
  // Matched as COLUMN REFERENCES, following this file's own precedent: the
  // prose above each query names the thing, and a guard that grepped for the
  // bare word would fail on its own documentation.
  const module = readFileSync(join(ROOT, "lib", "privacy", "export.ts"), "utf8");
  const command = readFileSync(join(ROOT, "scripts", "privacy", "export-data.mjs"), "utf8");

  it("read both files", () => {
    // Non-vacuity: without this, a wrong path makes both assertions below pass.
    expect(module.length).toBeGreaterThan(1000);
    expect(command.length).toBeGreaterThan(1000);
  });

  it("the member's own download names conversationId in its chat select", () => {
    expect(module).toMatch(/conversationId:\s*chatMessages\.conversationId/);
  });

  it("the operator's command names conversation_id in its chat query", () => {
    expect(command).toMatch(/select[^;]*\bconversation_id\b[^;]*from chat_messages/);
  });

  // Both chat projections are EXPLICIT column lists, which is how a column
  // added to the table goes missing from an access request with every gate
  // green: the section is still there, still named, one field short. `links`
  // shipped that way — `docs/data-protection.md` listed it as travelling with
  // the row while neither export selected it. The parity test above compares
  // SECTIONS, so only a per-column assertion catches this class.
  it("both exports name links in their chat select", () => {
    expect(module).toMatch(/links:\s*chatMessages\.links/);
    expect(command).toMatch(/select[^;]*\blinks\b[^;]*from chat_messages/);
  });
});

describe("deleting the account still removes the transcripts", () => {
  // No code was needed for this and that is exactly why it is asserted: the
  // companion's turns are rows in `chat_messages`, so the cascade that already
  // existed removes them. The day somebody changes it to `set null` — the
  // treatment the FINANCIAL tables get, and a reasonable-looking edit — a
  // deleted customer's own words would survive their deletion.
  const schema = readFileSync(join(ROOT, "db", "schema-chat.ts"), "utf8");

  it("chat_messages still cascades from the member", () => {
    expect(schema.length).toBeGreaterThan(500);
    expect(schema).toMatch(/references\(\(\)\s*=>\s*users\.id,\s*\{\s*onDelete:\s*"cascade"\s*\}\)/);
  });

  it("and there is no second table for a companion's turns", () => {
    // A second table would need its own cascade, its own export section and its
    // own deletion path — four places for one requirement to go half-done.
    expect(schema).not.toMatch(/pgTable\(\s*"companion/);
  });
});

describe("what the member's export must never contain", () => {
  const source = readFileSync(join(ROOT, "lib", "privacy", "export.ts"), "utf8");

  // Matched as COLUMN REFERENCES (`users.passwordHash`), not as bare words.
  // The file explains in prose what it leaves out and why, and a check that
  // grepped for the word alone would fail on its own documentation — which is
  // how a guard gets deleted as "flaky" rather than fixed.
  it("does not select the password hash", () => {
    // Handing somebody a credential creates risk rather than satisfying a
    // right — and scrypt is one-way, so the value would be useless to them and
    // useful to whoever else read the file.
    expect(source).not.toMatch(/users\.passwordHash/);
  });

  it("does not select OAuth tokens", () => {
    // `accounts` holds access and refresh tokens for the sign-in provider.
    // Those are credentials for somebody else's service, not information about
    // this person.
    expect(source).not.toMatch(/accounts\.(access_token|refresh_token|id_token)/);
  });

  it("does not query the raw webhook payloads", () => {
    // `.from(ipnEvents)` — the table is named in the prose above it, which is
    // the point of matching the query rather than the word.
    expect(source).not.toMatch(/from\(ipnEvents\)/);
    expect(source).not.toMatch(/import[\s\S]*?\bipnEvents\b[\s\S]*?from "@\/db\/schema"/);
  });
});
