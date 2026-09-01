// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
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
import { IMPERSONATION_END_REASONS } from "@/db/schema-impersonation";
import { consentPurposes } from "@/lib/consent/config";
import { CREDENTIAL_CHANGES } from "@/lib/email";
import { MODULE_MESSAGES } from "@/lib/modules/messages";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";
import { STATIC_MESSAGES, catalogueCoverage } from "./static-messages";
import { moduleErrorCodes } from "@/scripts/modules/inventory.mjs";

// The guardian of the translations.
//
// The most expensive bug in multilingual apps is the silent one: somebody
// builds a page, enters the text only in `de.json` — and English users
// suddenly see the key ("users.createTitle") instead of a heading. This test
// breaks the build instead.
//
// New language? Create the file in `messages/` and add its import to
// `i18n/static-messages.ts` — this file builds itself from LOCALES and needs no
// edit. 🚨 It used to carry its own `{ de, en }` literal, which is why the
// coverage test below exists: a locale in `LOCALES` with no catalogue behind it
// made every assertion in this file compare against `undefined`, and the
// failures then named twenty-seven missing keys rather than the one missing
// import that caused them.
//
// ⚠️ Merged the same way `i18n/request.ts` merges it, and NOT a plain catalogue.
// A module's error codes live in the shared `errors` namespace — that is where
// `t(`errors.${code}`)` looks — so a catalogue read straight off the core files
// would report every module code as missing while the running app renders them
// perfectly. Measured the moment the first module was installed.
const ALL_MESSAGES: Record<string, unknown> = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    mergeModuleMessages(STATIC_MESSAGES[locale] ?? {}, MODULE_MESSAGES[locale] ?? {}),
  ]),
);

describe("The static catalogue map", () => {
  // The one list in this app that a new language really does have to be written
  // into by hand. Everything else derives from `LOCALES`; this cannot, because
  // a bundler needs the import to be a literal path.
  it("covers exactly the locales this app speaks", () => {
    const { missing, extra } = catalogueCoverage();
    expect(
      missing,
      `i18n/static-messages.ts has no import for ${missing.join(", ")} — the assistant's ` +
        `cached menu block would go out with a hole in it and nothing else would say so`,
    ).toEqual([]);
    expect(
      extra,
      `i18n/static-messages.ts still imports ${extra.join(", ")}, which is not in LOCALES`,
    ).toEqual([]);
  });
});

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

describe("Impersonation end reasons", () => {
  // The same hole again, and this one was PRODUCED rather than reasoned about:
  // `app/dashboard/admin/impersonations/page.tsx` renders
  // ``t(`endedBy_${row.endedBy}`)`` over a plain `text` column, and a value
  // with no wording throws `MISSING_MESSAGE` into the log while the page still
  // answers 200 — the exact shape CLAUDE.md → *Never ship a broken page* is
  // about. The cast next to that call (`as "endedBy_operator"`) is what keeps
  // `tsc` from noticing, and it has to stay: the column is text, so no type
  // can promise what is in it.
  //
  // The four codes and their wordings sat in two files with nothing between
  // them, so a fifth reason — added to `IMPERSONATION_END_REASONS` and closed
  // in `closeImpersonation()`, which is one commit — would ship a row nobody
  // can read. This is that gap as a build failure.
  for (const locale of LOCALES) {
    it(`${locale}: has a wording for every reason in db/schema-impersonation.ts`, () => {
      for (const reason of IMPERSONATION_END_REASONS) {
        const label = messageAt(ALL_MESSAGES[locale], `impersonation.endedBy_${reason}`);
        expect(label, `${locale}: impersonation.endedBy_${reason}`).toBeTypeOf("string");
        expect(
          String(label).trim(),
          `${locale}: impersonation.endedBy_${reason} is empty`,
        ).not.toBe("");
      }
    });
  }

  it("has no wording for a reason that no longer exists", () => {
    const declared = new Set<string>(IMPERSONATION_END_REASONS);
    const orphans = Object.keys(
      (ALL_MESSAGES[DEFAULT_LOCALE] as { impersonation?: Record<string, string> })
        .impersonation ?? {},
    )
      .filter((key) => key.startsWith("endedBy_"))
      .map((key) => key.slice("endedBy_".length))
      .filter((reason) => !declared.has(reason));
    expect(orphans).toEqual([]);
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

describe("Every message parses as ICU", () => {
  // 🚨 The gap the three tests above structurally leave open. They compare the
  // catalogues against each other — same keys, same placeholders, nothing
  // empty — and a message can satisfy all three and still be unparseable:
  // `{count, plural, one {# Datei} other {# Dateien}` is missing one brace, has
  // exactly the right placeholder set, and throws the moment the page that uses
  // it renders. next-intl does not throw on a bad message; it reports through
  // `onError` and renders the KEY, so the page answers 200 with
  // "users.deleteCount" where a sentence belongs. Nothing else here looks.
  //
  // It mattered little while a human wrote two files. It matters now: four
  // catalogues of 1,491 keys, and an ICU plural is the one construct a
  // translation has to REBUILD rather than copy — the branch keywords are
  // syntax, the text inside them is not.
  //
  // `createTranslator` is the synchronous core of next-intl and is the same code
  // path the app takes (`i18n/translator.ts` explains why it is reachable here
  // and `getTranslations` is not).
  //
  // ⚠️ **The probe has to be right, or it measures itself.** Its first version
  // bound every placeholder to a number and called `t()`, and reported 48
  // failures in four symmetrical batches — every one of them a message that
  // uses rich text or a date, and not one a defect in the catalogues. So the
  // argument TYPE is read out of the message rather than guessed, and a message
  // carrying tags goes through `rich()`, which is what the app does with it.
  const TAG = /<(\w+)>/g;
  /** `{name, date, medium}` → the kind of value ICU will try to format. */
  const ARGUMENT = /\{\s*(\w+)\s*(?:,\s*(\w+))?/g;

  function valuesFor(message: string): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [, name, type] of message.matchAll(ARGUMENT)) {
      if (type === "date" || type === "time") values[name] = new Date("2026-01-01T12:00:00Z");
      else if (type === "number" || type === "plural" || type === "selectordinal") values[name] = 2;
      else if (type === "select") values[name] = "other";
      else values[name] = "x";
    }
    // Rich text: the tag names are bound in the CODE (`t.rich("hint", { code })`),
    // so here they are bound to something that merely proves they were reached.
    for (const [, tag] of message.matchAll(TAG)) {
      values[tag] = (chunks: unknown) => String(chunks);
    }
    return values;
  }

  const stringLeaves = keyPaths(ALL_MESSAGES[DEFAULT_LOCALE]).filter(
    (path) => typeof messageAt(ALL_MESSAGES[DEFAULT_LOCALE], path) === "string",
  ).length;

  for (const locale of LOCALES) {
    it(`${locale}: every message renders without an IntlError`, () => {
      const errors: string[] = [];
      const messages = ALL_MESSAGES[locale] as Record<string, unknown>;
      const translator = createTranslator({
        locale,
        messages: messages as never,
        timeZone: "Europe/Berlin",
        onError: (error) => errors.push(String(error)),
      }) as unknown as {
        (key: string, values?: Record<string, unknown>): string;
        rich: (key: string, values?: Record<string, unknown>) => unknown;
      };

      const paths = keyPaths(messages);
      expect(paths.length, `${locale}: no messages to check`).toBeGreaterThan(100);

      let checked = 0;
      for (const path of paths) {
        const message = messageAt(messages, path);
        if (typeof message !== "string") continue;
        const values = valuesFor(message);
        try {
          if (TAG.test(message)) translator.rich(path, values);
          else translator(path, values);
          TAG.lastIndex = 0;
        } catch (error) {
          errors.push(`${path}: ${String(error)}`);
        }
        checked += 1;
      }

      // The non-vacuity marker, derived rather than a number typed in here: a
      // `keyPaths` that stopped returning leaf paths would leave `errors` empty
      // and the assertion below perfectly satisfied. Every locale has the same
      // key set — the parity test above is what says so — so the count has to
      // match the reference catalogue's exactly.
      expect(checked, `${locale}: rendered ${checked} of ${stringLeaves} message(s)`).toBe(
        stringLeaves,
      );
      expect(errors, `${locale}: ${errors.length} unrenderable message(s)`).toEqual([]);
    });
  }
});

describe("matchLocale", () => {
  // 🚨 The "language this app does not have" is `xx`, and it is not a real
  // language on purpose. These three cases used to name FRENCH, which was true
  // for as long as the app spoke two languages and quietly stopped being a test
  // the day it spoke four: `matchLocale("fr-FR,fr;q=0.9")` returns `fr` now, and
  // the assertion that it falls back would have gone red — the lucky outcome.
  // The unlucky one is the case above it, where a supported `fr` beating `en` on
  // quality weight is the CORRECT answer, so the test would have had to be
  // rewritten to say the opposite of what it was written to say.
  //
  // `xx` is unassigned in ISO 639-1 and will not be assigned, so no future
  // language can turn these back into assertions about something else.
  const UNKNOWN = "xx";

  it("takes the first supported language from the browser header", () => {
    expect(matchLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("ignores the region", () => {
    expect(matchLocale("de-AT")).toBe("de");
  });

  it("honors the quality weights", () => {
    // We do not know xx, but we do know English — so English.
    expect(matchLocale(`${UNKNOWN};q=1.0,en;q=0.8`)).toBe("en");
  });

  it("falls back to the default language", () => {
    expect(matchLocale(`${UNKNOWN}-XX,${UNKNOWN};q=0.9`)).toBe(DEFAULT_LOCALE);
    expect(matchLocale(null)).toBe(DEFAULT_LOCALE);
    expect(matchLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("finds every language this app speaks", () => {
    // Non-vacuity guard for the three above: they say what happens to a language
    // the app does NOT have, and would all still pass on an app that matched
    // nothing at all.
    for (const locale of LOCALES) {
      expect(matchLocale(`${locale}-XX,${locale};q=0.9`), locale).toBe(locale);
    }
    expect(LOCALES.length).toBeGreaterThan(1);
  });
});

describe("isLocale", () => {
  it("recognizes known languages only", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("klingon")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
