// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { LOCALES, DEFAULT_LOCALE, matchLocale, isLocale } from "./config";
import { USER_ERROR_CODES } from "@/lib/users/rules";
import { TOKEN_ERROR_CODES } from "@/lib/tokens/rules";
import { GRANT_ERROR_CODES } from "@/lib/entitlements/grant-rules";
import { CREDENTIAL_ERROR_CODES } from "@/lib/credentials/rules";
import { EMAIL_CHANGE_ERROR_CODES } from "@/lib/email-change/rules";
import { CHAT_ERROR_CODES } from "@/lib/ai/rules";
import { PROVIDER_ERROR_CODES } from "@/lib/ai/providers/types";
import { CONSENT_ERROR_CODES } from "@/lib/consent/rules";
import { MEDIA_ERROR_CODES } from "@/lib/media/rules";
import { ROLES } from "@/lib/roles";
import { consentPurposes } from "@/lib/consent/config";
import { CREDENTIAL_CHANGES } from "@/lib/email";
import de from "@/messages/de.json";
import { MODULE_MESSAGES } from "@/lib/modules/messages";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";
import en from "@/messages/en.json";
import { moduleErrorCodes } from "@/scripts/modules/inventory.mjs";

// The guardian of the translations.
//
// The most expensive bug in multilingual apps is the silent one: somebody
// builds a page, enters the text only in `de.json` — and English users
// suddenly see the key ("users.createTitle") instead of a heading. This test
// breaks the build instead.
//
// New language? Create the file in `messages/`, add it to ALL_MESSAGES here.
//
// ⚠️ Merged the same way `i18n/request.ts` merges it, and NOT a plain `{de, en}`.
// A module's error codes live in the shared `errors` namespace — that is where
// `t(`errors.${code}`)` looks — so a catalogue read straight off the core files
// would report every module code as missing while the running app renders them
// perfectly. Measured the moment the first module was installed.
const ALL_MESSAGES: Record<string, unknown> = {
  de: mergeModuleMessages(de as Record<string, unknown>, MODULE_MESSAGES.de ?? {}),
  en: mergeModuleMessages(en as Record<string, unknown>, MODULE_MESSAGES.en ?? {}),
};

/** All keys of a nested object as "a.b.c". */
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([key, value]) =>
    keyPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * Placeholders of an ICU message, e.g. "{email}" -> ["email"].
 *
 * Limited to `{name}` and `{name, plural, …}`: inside a plural, text branches
 * such as `=0 {No users yet}` also sit in curly braces — those are text, not
 * placeholders, and must be allowed to differ between languages.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
}

function messageAt(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        typeof acc === "object" && acc !== null
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      obj,
    );
}

describe("Message files", () => {
  it("has a file for every language in LOCALES", () => {
    for (const locale of LOCALES) {
      expect(ALL_MESSAGES[locale], `messages/${locale}.json is missing`).toBeDefined();
    }
  });

  const reference = keyPaths(ALL_MESSAGES[DEFAULT_LOCALE]).sort();

  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;

    it(`${locale}: has exactly the same keys as ${DEFAULT_LOCALE}`, () => {
      const existing = keyPaths(ALL_MESSAGES[locale]).sort();
      expect(existing.filter((k) => !reference.includes(k))).toEqual([]);
      expect(reference.filter((k) => !existing.includes(k))).toEqual([]);
    });

    it(`${locale}: uses the same placeholders as ${DEFAULT_LOCALE}`, () => {
      for (const path of reference) {
        const original = messageAt(ALL_MESSAGES[DEFAULT_LOCALE], path);
        const translated = messageAt(ALL_MESSAGES[locale], path);
        if (typeof original !== "string" || typeof translated !== "string") continue;
        expect(placeholders(translated), `${locale}: ${path}`).toEqual(
          placeholders(original),
        );
      }
    });

    it(`${locale}: has no empty text`, () => {
      for (const path of reference) {
        const value = messageAt(ALL_MESSAGES[locale], path);
        expect(String(value).trim(), `${locale}: ${path}`).not.toBe("");
      }
    });
  }
});

// Every rules layer that returns CODES instead of sentences belongs in this
// list. A code missing from BOTH locales is invisible to the key-parity test
// above — the files agree with each other, and the Operator is shown the literal
// key ("errors.insufficientBalance") at the moment something went wrong. Adding
// a domain to lib/ without adding its union here re-opens exactly that hole.
const ERROR_CODE_UNIONS: Record<string, readonly string[]> = {
  "lib/users/rules.ts": USER_ERROR_CODES,
  "lib/tokens/rules.ts": TOKEN_ERROR_CODES,
  "lib/entitlements/grant-rules.ts": GRANT_ERROR_CODES,
  "lib/credentials/rules.ts": CREDENTIAL_ERROR_CODES,
  "lib/email-change/rules.ts": EMAIL_CHANGE_ERROR_CODES,
  "lib/ai/rules.ts": CHAT_ERROR_CODES,
  "lib/ai/providers/types.ts": PROVIDER_ERROR_CODES,
  "lib/consent/rules.ts": CONSENT_ERROR_CODES,
  "lib/media/rules.ts": MEDIA_ERROR_CODES,
};

// Plus the unions an installed module declares. A module names its own source
// file and the export in its manifest, and the codes are read from it — so a
// module's refusals are held to the same bar as the core's: a code with no text
// shows the member the literal key at the moment something went wrong.
//
// Read with a dynamic import, which is fine here and would not be in the app:
// this is a test, and there is no bundler to satisfy. `ALL_MESSAGES` already
// carries the module texts, because `i18n/request.ts` merges them in.
for (const { source, codes } of await moduleErrorCodes()) {
  ERROR_CODE_UNIONS[source] = codes;
}

describe("Error codes", () => {
  // These layers return codes rather than sentences. If a code has no text, the
  // admin sees "selfDelete" instead of an explanation when something fails —
  // precisely when they need one.
  for (const [source, codes] of Object.entries(ERROR_CODE_UNIONS)) {
    for (const locale of LOCALES) {
      it(`${locale}: has a text for every code in ${source}`, () => {
        for (const code of codes) {
          expect(
            messageAt(ALL_MESSAGES[locale], `errors.${code}`),
            `${locale}: errors.${code}`,
          ).toBeTypeOf("string");
        }
      });
    }
  }
});

describe("Role names", () => {
  // The same hole the error-code block above closes, one table further along:
  // a role's display name is looked up with a COMPUTED key (`t(role)` in
  // `components/role-badge.tsx`, `t(\`roles.${r}\`)` in the admin page), so the
  // key-parity test cannot see it. A role added to `lib/roles.ts` and to
  // NEITHER message file leaves both files in perfect agreement and renders
  // the raw key path in the row menu, the create dialog and the badge.
  //
  // Story 19.2 added `moderator` to all the right places by hand; nothing
  // would have said so if it had not. The badge's own header already carries
  // the instruction ("Whoever adds a role enters it in lib/roles.ts AND in
  // both message files") — this is that sentence as a build failure.
  for (const locale of LOCALES) {
    it(`${locale}: has a display name for every role in lib/roles.ts`, () => {
      for (const role of ROLES) {
        const label = messageAt(ALL_MESSAGES[locale], `roles.${role}`);
        expect(label, `${locale}: roles.${role}`).toBeTypeOf("string");
        expect(String(label).trim(), `${locale}: roles.${role} is empty`).not.toBe("");
      }
    });
  }

  it("has no display name for a role that no longer exists", () => {
    // The other direction, and the cheaper half of keeping the table honest:
    // a removed role leaves a label behind that reads as if the role were
    // still there.
    const declared = new Set<string>(ROLES);
    const labelled = Object.keys(
      (ALL_MESSAGES[DEFAULT_LOCALE] as { roles?: Record<string, string> }).roles ?? {},
    );
    expect(labelled.filter((key) => !declared.has(key))).toEqual([]);
  });
});

// The mail texts are looked up with a COMPUTED key — `credentialSubject_${change}`
// in lib/email.ts. The parity test above cannot see that: de.json and en.json
// agreed with each other perfectly while a subject line was missing from BOTH,
// and the notice went out with the literal string
// "email.credentialSubject_emailChanged" where its subject should have been.
// Every test was green. This walks the union instead.
// Consent purposes are looked up with a COMPUTED key too — `consent.${key}.title`
// and `.body`, where `key` comes out of `config/consent.json` rather than out of
// the code. The parity test cannot see them: an operator who declares a purpose
// and forgets the wording has both files agreeing perfectly while the dialog
// renders the literal string "consent.marketing_email.title" — at a customer, in
// the one dialog whose whole purpose is to be understood before it is answered.
//
// Vacuous as shipped, deliberately: this template declares no purposes, because
// it needs none. It stops being vacuous the moment somebody adds one, which is
// exactly when it is needed.
describe("Consent purpose texts", () => {
  const purposes = consentPurposes();

  for (const locale of LOCALES) {
    for (const purpose of purposes) {
      for (const part of ["title", "body"] as const) {
        it(`${locale}: has consent.${purpose.key}.${part}`, () => {
          expect(
            messageAt(ALL_MESSAGES[locale], `consent.${purpose.key}.${part}`),
            `${locale}: consent.${purpose.key}.${part} — a purpose declared in ` +
              `config/consent.json with no wording behind it`,
          ).toBeTypeOf("string");
        });
      }
    }
  }

  it("knows how many purposes it checked", () => {
    // Non-vacuity marker rather than an assertion about the count: if this ever
    // reads a number and the loops above produced no tests, the config reader
    // broke rather than the config being empty.
    expect(Array.isArray(purposes)).toBe(true);
  });
});

describe("Credential-change mail texts", () => {
  for (const locale of LOCALES) {
    it(`${locale}: has a subject and a body for every credential change`, () => {
      for (const change of CREDENTIAL_CHANGES) {
        expect(
          messageAt(ALL_MESSAGES[locale], `email.credentialSubject_${change}`),
          `${locale}: email.credentialSubject_${change}`,
        ).toBeTypeOf("string");
        expect(
          messageAt(ALL_MESSAGES[locale], `email.credential_${change}`),
          `${locale}: email.credential_${change}`,
        ).toBeTypeOf("string");
      }
    });
  }
});

describe("matchLocale", () => {
  it("takes the first supported language from the browser header", () => {
    expect(matchLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("ignores the region", () => {
    expect(matchLocale("de-AT")).toBe("de");
  });

  it("honors the quality weights", () => {
    // We do not know French, but we do know English — so English.
    expect(matchLocale("fr;q=1.0,en;q=0.8")).toBe("en");
  });

  it("falls back to the default language", () => {
    expect(matchLocale("fr-FR,fr;q=0.9")).toBe(DEFAULT_LOCALE);
    expect(matchLocale(null)).toBe(DEFAULT_LOCALE);
    expect(matchLocale("")).toBe(DEFAULT_LOCALE);
  });
});

describe("isLocale", () => {
  it("recognizes known languages only", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("klingon")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
