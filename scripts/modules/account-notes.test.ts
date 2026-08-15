// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a module says about itself on `/dashboard/account` — held to the same
// bar as what it says in the exports.
//
// ── The failure this exists to prevent ─────────────────────────────────────
// The download's hint and the deletion dialog's "what goes" list used to be two
// core strings that enumerated other people's data: the community's profile,
// moderator duties, posts and read markers; the api module's keys. That is wrong
// in both directions at once, and each direction rules out the other's fix:
//
//   · a fresh app has none of those modules, so the core promised a member data
//     it did not hold and offered to delete rows that do not exist;
//   · deleting the clauses would leave an app that DOES hold that data
//     describing its own Art. 15 answer too narrowly — and understating an
//     access request is the worse of the two.
//
// So the module writes its own sentence, the manifest requires it wherever
// `tables` are declared, and this file holds the three things a validator cannot
// see: that the declared key really has text, in every language; that the page
// really renders them; and that the core has stopped naming anybody.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankCommentsFor } from "@/scripts/lib/source-text.mjs";
import { MODULE_ACCOUNT_NOTES } from "@/lib/modules/account-notes-registry";
import { MODULE_MESSAGES } from "@/lib/modules/messages";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";
import { installedModules } from "./installed.mjs";
import { availableModules, readModule } from "./registry.mjs";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// 🚨 `blankCommentsFor`, not `blankComments`, because this reader takes a MIXED
// corpus: the modules' `messages/<locale>.json` catalogues AND
// `app/dashboard/account/privacy-ui.tsx`. The page is read as TEXT for needles it
// could just as well mention while explaining itself — `MODULE_ACCOUNT_NOTES`, the
// two `<ModuleNotes …/>` mounts, the ROOT `useTranslations()` — and that file is
// dense with prose about exactly this seam, so it has to be blanked. It is also
// where a distance-limited regex reads, and blanking keeps every offset it
// depends on. The message files must NOT be —
// they are data that gets `JSON.parse`d, and a sentence about somebody's data
// rights is the subject of the assertion rather than an aside about it.
// (CLAUDE.md → a checker that reads source as TEXT goes through `blankComments()`.)
const read = (rel: string) => blankCommentsFor(rel, readFileSync(join(ROOT, rel), "utf8"));

/** The locales a module ships text in — read, never assumed. */
function localesOf(dir: string, messagesDir: string): string[] {
  return readdirSync(join(ROOT, dir, messagesDir))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
}

/**
 * The bit of a manifest this file reads.
 *
 * `readModule()` is `.mjs` and hands back `unknown` for the manifest — declaring
 * the shape here rather than casting at four call sites keeps the assertions
 * readable and keeps this file honest about what it assumes.
 */
interface TableManifest {
  messages?: { dir?: string; namespaces?: string[] };
  privacy?: { accountNotes?: { export?: string; deletion?: string } };
  tables?: string[];
}

/** `"community.accountExportNote"` against a nested catalogue. */
function lookup(catalogue: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (at, part) =>
        at && typeof at === "object" ? (at as Record<string, unknown>)[part] : undefined,
      catalogue,
    );
}

describe("every module that holds rows says so on the account page", () => {
  // Against the REAL manifests, not a fixture — `manifest.test.ts` covers the
  // rule, this covers the tree.
  const withTables = availableModules(ROOT)
    .map((id) => readModule(id, ROOT) as { id: string; dir: string; manifest: TableManifest })
    .filter((record) => (record.manifest.tables?.length ?? 0) > 0);

  it("found modules to check, so an empty sweep means something", () => {
    expect(withTables.length).toBeGreaterThan(0);
  });

  it("declares both sentences", () => {
    for (const { id, manifest } of withTables) {
      const notes = manifest.privacy?.accountNotes;
      expect(notes?.export, `${id} declares no accountNotes.export`).toBeTruthy();
      expect(notes?.deletion, `${id} declares no accountNotes.deletion`).toBeTruthy();
    }
  });

  it("🚨 has real text behind every declared key, in every language it ships", () => {
    // A manifest can name a key nobody wrote, and nothing else would notice: the
    // page renders the raw key, which reads like a translation bug in a paragraph
    // about somebody's data rights. `availableModules` rather than the installed
    // list, deliberately — a module's text has to be there BEFORE somebody
    // installs it, not after the first member opens the page.
    for (const { id, dir, manifest } of withTables) {
      const messagesDir = manifest.messages?.dir;
      expect(messagesDir, `${id} declares accountNotes but ships no messages dir`).toBeTruthy();
      const locales = localesOf(dir, messagesDir as string);
      expect(locales.length, `${id} ships no message file at all`).toBeGreaterThan(0);

      for (const locale of locales) {
        const catalogue = JSON.parse(read(join(dir, messagesDir as string, `${locale}.json`)));
        for (const which of ["export", "deletion"] as const) {
          const key = manifest.privacy?.accountNotes?.[which] ?? "";
          const text = lookup(catalogue, key);
          expect(
            typeof text === "string" && text.trim().length > 20,
            `${id}: "${key}" has no real text in ${locale} — the account page would ` +
              "render the raw key inside a paragraph about somebody's data rights",
          ).toBe(true);
        }
      }
    }
  });
});

describe("the installed notes resolve in the app's own catalogue", () => {
  const merged: Record<string, unknown> = {
    de: mergeModuleMessages(de as Record<string, unknown>, MODULE_MESSAGES.de ?? {}),
    en: mergeModuleMessages(en as Record<string, unknown>, MODULE_MESSAGES.en ?? {}),
  };

  it("resolves every registry entry the way the page will", () => {
    // The page calls a ROOT translator with the fully qualified key. This asks
    // the same question of the same merged catalogue `i18n/request.ts` builds —
    // so a namespace a module owns but never merges is caught here rather than
    // on the page.
    for (const note of MODULE_ACCOUNT_NOTES) {
      for (const [locale, catalogue] of Object.entries(merged)) {
        for (const key of [note.export, note.deletion]) {
          expect(typeof lookup(catalogue, key), `${key} in ${locale}`).toBe("string");
        }
      }
    }
  });

  it("names only modules this app has", () => {
    // ⚠️ This used to be `expect(MODULE_ACCOUNT_NOTES).toEqual([])` — the shipped
    // state. True of the template and false of any app that installed
    // `activity`, `api` or `community` (all three declare tables and therefore
    // both sentences), so a customer following this template's own instructions
    // got a red suite about a fault that was not one. That claim moved to
    // `scripts/shipped-lists.test.mjs` in the factory, where `template/` is
    // pristine by construction.
    //
    // What holds in every app: a paragraph on the account page describing a
    // module this app does not have would be the core promising a member data it
    // never held — the same failure as the core strings this whole seam replaced,
    // pointed the other way.
    const installed = installedModules(ROOT);
    for (const note of MODULE_ACCOUNT_NOTES) {
      expect(
        installed,
        `the account page would render "${note.module}"'s sentences, and this app ` +
          `does not have that module`,
      ).toContain(note.module);
    }
  });
});

describe("the account page really composes them", () => {
  const ui = read("app/dashboard/account/privacy-ui.tsx");

  it("renders one paragraph per installed module, in both cards", () => {
    expect(ui).toContain("MODULE_ACCOUNT_NOTES");
    expect(ui).toMatch(/<ModuleNotes which="export" \/>/);
    expect(ui).toMatch(/<ModuleNotes which="deletion" \/>/);
  });

  it("reads them with a ROOT translator", () => {
    // A namespaced `useTranslations("privacy")` cannot reach `community.…`, and
    // the way to make it reach would be to put the key under the core's
    // namespace — which is the coupling this seam removes.
    expect(ui).toMatch(/function ModuleNotes[\s\S]{0,400}useTranslations\(\)/);
  });
});

describe("🚨 the core's own privacy texts name no module", () => {
  // The regression this whole seam exists to prevent, asserted where it would
  // reappear: somebody adds a module, wants one more clause on the account page,
  // and writes it into the core string because that is where the sentence
  // already is.
  const ids = availableModules(ROOT);

  it("has module ids to look for", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it("mentions no module's data in either sentence", () => {
    const CORE_KEYS = ["exportHint", "exportExcluded", "deleteGoesBody", "deleteStaysBody"];
    const offenders: string[] = [];
    for (const [locale, catalogue] of Object.entries({ de, en })) {
      for (const key of CORE_KEYS) {
        const text = lookup(catalogue, `privacy.${key}`);
        expect(typeof text, `messages/${locale}.json is missing privacy.${key}`).toBe("string");
        for (const id of ids) {
          // Word-ish match on the module id. `api` would hit "Kapital"; the
          // boundary anchors keep it to the word a sentence would really use.
          if (new RegExp(`\\b${id}\\b`, "i").test(String(text))) {
            offenders.push(`${locale}: privacy.${key} names "${id}"`);
          }
        }
      }
    }
    expect(
      offenders,
      "a core sentence on /dashboard/account describes a module's data. Only the " +
        "module knows what it stores — put the clause in its own message files and " +
        "declare the key in its manifest's privacy.accountNotes:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
