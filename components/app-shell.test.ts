// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The user menu, asserted on the source.
//
// Nothing here can be called: `app-shell.tsx` is a client component and this
// repo has no DOM test environment (vitest runs with `environment: "node"`).
// What is asserted is therefore structural — but the thing that went wrong was
// structural too. The Member's own page existed, was reachable, was in the
// sidebar and was still not findable by somebody looking for "where do I change
// my password", because the only entry point was a sidebar item named after
// entitlements rather than after the account.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The file with its comments removed — this one discusses its own subject. */
const SHELL = blankComments(readFileSync(join(ROOT, "components", "app-shell.tsx"), "utf8"));

/** Just the UserMenu component, so the sidebar's own entry cannot satisfy this. */
const USER_MENU = (() => {
  const start = SHELL.indexOf("function UserMenu(");
  const end = SHELL.indexOf("\nexport function AppShell(", start);
  if (start < 0 || end < 0) throw new Error("cannot find UserMenu in app-shell.tsx");
  return SHELL.slice(start, end);
})();

describe("the user menu", () => {
  it("was found at all — the slice is not empty", () => {
    // Non-vacuity: a mis-sliced USER_MENU would make every assertion below pass
    // by containing nothing at all.
    expect(USER_MENU).toContain("DropdownMenuTrigger");
    expect(USER_MENU.length).toBeGreaterThan(200);
  });

  it("links to the Member's own account page", () => {
    expect(USER_MENU).toContain("/dashboard/account");
  });

  it("puts that link ABOVE the sign-out", () => {
    // The order is the requirement, not a detail: sign-out is the destructive
    // item and sits last, and a settings link placed under it is one people
    // mis-click on the way past.
    const account = USER_MENU.indexOf("/dashboard/account");
    // The FORM, not the prop of the same name in the signature above it — that
    // one sits at index ~30 and would make this pass no matter where the link
    // went.
    const signOut = USER_MENU.indexOf("action={signOutAction}");
    expect(account).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(-1);
    expect(account).toBeLessThan(signOut);
  });

  it("calls the page the same thing the sidebar does", () => {
    // One page, one name. The menu item reads `nav.account` rather than a label
    // of its own precisely so the two cannot drift apart.
    expect(USER_MENU).toMatch(/nav/);
  });
});

describe("the name of the account page", () => {
  const locales: Record<string, unknown> = { de, en };

  /** `messages.a.b` without asserting a shape onto the whole catalogue. */
  function message(locale: string, namespace: string, key: string): string {
    const value = (locales[locale] as Record<string, Record<string, unknown>>)[
      namespace
    ]?.[key];
    if (typeof value !== "string") {
      throw new Error(`${locale}: ${namespace}.${key} is missing or not a string`);
    }
    return value;
  }

  it("says 'account', not only 'access', in both locales", () => {
    // What the page is named IS the discoverability problem: somebody looking
    // for their email address and password does not look under a heading about
    // what they are allowed to use.
    for (const locale of Object.keys(locales)) {
      const expected = locale === "de" ? "Konto" : "account";
      expect(message(locale, "nav", "account"), `${locale}: nav.account`).toContain(
        expected,
      );
      expect(message(locale, "account", "title"), `${locale}: account.title`).toContain(
        expected,
      );
    }
  });

  it("is named the same in the copy that points people at it", () => {
    // Two messages send somebody to this page BY NAME. A rename that misses one
    // leaves instructions pointing at a menu entry that no longer exists.
    for (const locale of Object.keys(locales)) {
      const name = message(locale, "nav", "account");
      for (const [namespace, key] of [
        ["login", "passwordFailedBody"],
        ["confirmEmail", "failedHint"],
      ] as const) {
        expect(
          message(locale, namespace, key),
          `${locale}: ${namespace}.${key} must name "${name}"`,
        ).toContain(name);
      }
    }
  });
});
