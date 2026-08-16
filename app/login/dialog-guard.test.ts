// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What story 4.1 promises about the sign-in page, asserted on the source.
//
// Both promises are properties of the FILES, not of any return value, so there
// is nothing to call. They are asserted the way lib/entitlements/leak-guard.test.ts
// asserts its own — a rule that lives only in a comment is a rule the next edit
// reverses without noticing.
//
//   1. THERE IS ONE SIGN-IN FORM. The page this replaced rendered a password
//      card unconditionally and a demo-login card whenever the development
//      login was active. Both conditions hold on a demo installation, so both
//      appeared — two forms, stacked, with nothing to tell them apart. The
//      trap is that neither card was wrong on its own, which is why this came
//      back rather than being caught in review.
//
//   2. THE DIALOG STAYS OUT OF THE SERVER. ui.tsx is a client component and
//      ends up in the browser bundle. `docs/auth-setup.md` records mail
//      delivery being dragged into one by exactly this route, which is why the
//      imports are pinned here rather than trusted to stay tidy.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import { blankComments as stripComments } from "@/scripts/lib/source-text.mjs";

/** The app root (this file sits in app/login/). */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function source(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

/**
 * The code with its comments taken out.
 *
 * Load-bearing here: the files this reads discuss their own design at length,
 * including the shapes these tests forbid. A check that saw the prose would be
 * answering from the argument rather than from the code.
 */
/** Opening `<form` tags. */
function formCount(code: string): number {
  return [...stripComments(code).matchAll(/<form[\s>]/g)].length;
}

/**
 * The message keys `SignInFormState.error` can hold, read off its declaration.
 *
 * Comments are blanked first for the usual reason — state.ts explains its own
 * codes in prose, and a quoted name in an explanation is not a member of the
 * union. `null` is dropped: it is the absence of a message, not one.
 */
function refusalCodes(code: string): string[] {
  const union = /\berror\s*:([^;]*);/.exec(stripComments(code));
  if (!union) return [];
  return [...union[1].matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]);
}

describe("the sign-in dialog", () => {
  it("counts forms rather than prose — the counter itself", () => {
    // Non-vacuity check. Without it, a `formCount` that silently returned 0 for
    // everything would make every assertion below pass.
    expect(formCount("<form action={x}>")).toBe(1);
    expect(formCount("<form><form>")).toBe(2);
    expect(formCount("// <form> in a comment\n/* <form> too */")).toBe(0);
    expect(formCount("{/* a <form> in JSX prose */}")).toBe(0);
  });

  it("renders exactly ONE sign-in form", () => {
    expect(formCount(source("app", "login", "ui.tsx"))).toBe(1);
  });

  it("leaves no second form on the page around it", () => {
    // The page keeps the Google button, which is a form of its own and is not a
    // second way of typing an address. Anything beyond that is the regression.
    expect(formCount(source("app", "login", "page.tsx"))).toBeLessThanOrEqual(1);
  });

  it("asks for the password only after the address", () => {
    const ui = source("app", "login", "ui.tsx");
    // The password field is inside the branch — never rendered unconditionally.
    expect(ui).toMatch(/step === "email" \?/);
    expect(ui).toContain('type="password"');
  });

  it("keeps the browser bundle away from the server", () => {
    const ui = source("app", "login", "ui.tsx");
    const imports = [...ui.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const forbidden of ["@/auth", "@/lib/email", "@/db"]) {
      expect(imports, `ui.tsx must not import ${forbidden}`).not.toContain(forbidden);
    }
    expect(
      imports.filter((i) => i.startsWith("@/lib/credentials")),
      "ui.tsx must not import the credential layer",
    ).toEqual([]);
  });

  it("never puts the typed address in the URL", () => {
    // The rejected alternative was redirect("/login?email=…"), which works and
    // writes an address into browser history, the Referer header and every
    // access log in front of the app.
    for (const file of ["ui.tsx", "actions.ts", "page.tsx"]) {
      expect(stripComments(source("app", "login", file)), file).not.toMatch(
        /[?&]email=/,
      );
    }
  });
});

describe("the sign-in messages", () => {
  const locales = { de, en } as Record<string, { login: Record<string, string> }>;

  it("reads the union rather than prose — the parser itself", () => {
    expect(refusalCodes(`error: "a" | "b" | null;`)).toEqual(["a", "b"]);
    expect(refusalCodes(`error:\n | "a"\n | null;`)).toEqual(["a"]);
    // A code named only in an explanation is not a member of the union.
    expect(refusalCodes(`/* "ghost" */\nerror: "a" | null;`)).toEqual(["a"]);
    expect(refusalCodes("nothing here")).toEqual([]);
  });

  it("has no key left over from the one-step form", () => {
    // The parity test next door fails on a key missing from ONE locale. A key
    // present in both and used by nobody is invisible to it, so retired copy
    // rots in place and the next person reinstates the flow it described.
    const retired = ["passwordHint", "passwordOnlyHint", "forgotPassword", "devSubmit"];
    for (const [locale, messages] of Object.entries(locales)) {
      for (const key of retired) {
        expect(messages.login[key], `${locale}: login.${key}`).toBeUndefined();
      }
    }
  });

  it("has a title and a body for every refusal the dialog can return", () => {
    // These are looked up as `t(`${state.error}Title`)`, which no static check
    // can follow — a missing one surfaces as a rendered key path in front of
    // whoever just failed to sign in.
    //
    // 🚨 **Read off state.ts rather than typed out here.** A hand-kept list is
    // the shape that goes quiet exactly when it matters: whoever adds a code to
    // the union ships it, both locales stay green because nobody asked about
    // the new one, and the first person to meet it sees `login.xTitle` on
    // screen. The union is the register; this reads it.
    const errors = refusalCodes(source("app/login/state.ts"));
    // Non-vacuity: a parse that silently returned [] would pass everything.
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors).toContain("tooManyLinks");
    for (const [locale, messages] of Object.entries(locales)) {
      for (const error of errors) {
        expect(messages.login[`${error}Title`], `${locale}: ${error}Title`).toBeTruthy();
        expect(messages.login[`${error}Body`], `${locale}: ${error}Body`).toBeTruthy();
      }
    }
  });

  it("has the strings the two steps need", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      for (const key of ["continueSubmit", "linkInstead", "changeEmail"]) {
        expect(messages.login[key], `${locale}: login.${key}`).toBeTruthy();
      }
    }
  });
});
