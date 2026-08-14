// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two Digistore24 platform rules, as assertions.
//
// Both are rules whose breach produces NO error: no failing test, no unhappy
// customer, no line in a log. What they produce is a product refused at
// approval, or an account closed after months of selling. So the only thing
// that can hold them is a check, and the only thing that can hold the check is
// this file.
//
// The sentence that started it is real, from an app built on this template:
// **"Einmal kaufen, dauerhaft nutzen"** — which contains none of the ten words
// as Digistore24 spells them and every one of them as they mean it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DURATION_TERMS,
  RESELLER_SURFACES,
  durationClaims,
  namesReseller,
  sentencesOf,
} from "./digistore-claims.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (relative: string) =>
  readFileSync(new URL(relative, ROOT), "utf8");

describe("the ten words, as they are actually written", () => {
  it("🚨 catches the sentence this rule was written for", () => {
    const [claim] = durationClaims("Einmal kaufen, dauerhaft nutzen");
    expect(claim).toMatchObject({ term: "dauerhaft", aboutAccess: true });
  });

  it("catches every declension, which is the whole point of stems", () => {
    // Digistore24's list is written in one form — *lebenslanger, dauerhafter,
    // unbegrenzter*. German inflects; a literal match would pass all of these.
    for (const text of [
      "Lebenslanger Zugang zu allen Inhalten",
      "Dauerhafte Nutzung, ohne Abo",
      "Unbegrenzter Zugriff auf den Mitgliederbereich",
      "Unbefristeter Zugang",
      "Unbeschränkte Nutzung",
      "Zugang auf unbestimmte Zeit",
      "Der Kurs gehört dir für immer — nutze ihn, wann du willst",
    ]) {
      const claims = durationClaims(text);
      expect(claims.length, `not caught: ${text}`).toBeGreaterThan(0);
      expect(claims.some((c) => c.aboutAccess), text).toBe(true);
    }
  });

  it("catches the English forms their list does not name", () => {
    for (const text of [
      "Lifetime access to every lesson",
      "Buy once, use it forever",
      "Unlimited use",
      "Yours for life",
    ]) {
      expect(durationClaims(text).some((c) => c.aboutAccess), text).toBe(true);
    }
  });

  it("🚨 leaves a FEATURE promise alone — the half that keeps this usable", () => {
    // "unbegrenzt viele Notizen" is allowed and common. A bare word list would
    // report it, the report would open with a wall, and somebody would switch
    // the check off — taking the rule with it.
    for (const text of [
      "Unbegrenzt viele Notizen",
      "Unlimited storage for your files",
      "Gültigkeit in Tagen (leer = unbegrenzt)",
      "Delete permanently",
    ]) {
      const claims = durationClaims(text);
      expect(claims.some((c) => c.aboutAccess), text).toBe(false);
    }
  });

  it("still REPORTS those, so the caller can count them", () => {
    // Not silence: `legal-check` prints how many were set aside, so nobody
    // reads its tick as "the words do not occur".
    expect(durationClaims("Unbegrenzt viele Notizen")).toHaveLength(1);
  });

  it("needs a word boundary in front, so a longer word is not a hit", () => {
    expect(durationClaims("Die Nutzung ist unproblematisch permanent")).toHaveLength(1);
    expect(durationClaims("supermanent nonsense")).toEqual([]);
  });

  it("keeps a comma-joined claim in ONE sentence", () => {
    // The measured failure mode of the other design: split on commas and
    // "dauerhaft" lands in one bucket while "nutzen" lands in the next, so the
    // claim is reported as a mere word.
    expect(sentencesOf("Einmal kaufen, dauerhaft nutzen")).toEqual([
      "Einmal kaufen, dauerhaft nutzen",
    ]);
    expect(sentencesOf("Erste. Zweite\nDritte")).toEqual([
      "Erste.",
      "Zweite",
      "Dritte",
    ]);
  });

  it("carries all ten of Digistore24's, not five", () => {
    // `CLAUDE.md` names five and says "and five more"; only `docs/courses.md`
    // ever wrote the full list down, and nothing read it.
    const theirs = DURATION_TERMS.filter((t) => t.source === "ds24").map((t) => t.stem);
    for (const stem of [
      "lifetime",
      "lebenslang",
      "unlimitiert",
      "dauerhaft",
      "unbegrenzt",
      "unbefristet",
      "unbeschränkt",
      "permanent",
      "auf unbestimmte zeit",
      "für immer",
    ]) {
      expect(theirs, `${stem} is not in the list`).toContain(stem);
    }
  });

  it("agrees with the doc it was taken from", () => {
    // The list lives in code now, and `docs/courses.md` is where its reason
    // lives. If somebody rewrites that paragraph, this notices.
    const courses = read("docs/courses.md");
    for (const stem of ["lebenslang", "unbefristet", "unbeschränkt", "auf unbestimmte Zeit"]) {
      expect(courses, `docs/courses.md no longer names "${stem}"`).toContain(stem);
    }
  });
});

describe("this template's own text keeps the rule", () => {
  // The measurement that armed the check: zero findings on the tree of the day.
  // It is repeated here so that the SHIPPED example products cannot drift back
  // — they said "Unlimited use" on the plans page of every app ever generated
  // from this template until 2026-08-14.
  it("the shipped products promise nothing about how long access lasts", () => {
    const registry = JSON.parse(read("config/digistore-products.json")) as {
      products: Record<string, Record<string, unknown>>;
    };
    const offenders: string[] = [];
    for (const [key, def] of Object.entries(registry.products)) {
      const copy = [def.name, def.tagline, def.description, ...((def.features as string[]) ?? [])]
        .filter((part): part is string => typeof part === "string")
        .join("\n");
      for (const claim of durationClaims(copy)) {
        if (claim.aboutAccess) offenders.push(`${key}: "${claim.sentence}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("both language files keep it too", () => {
    const offenders: string[] = [];
    for (const locale of ["de", "en"]) {
      const walk = (value: unknown, path: string): void => {
        if (typeof value === "string") {
          for (const claim of durationClaims(value)) {
            if (claim.aboutAccess) offenders.push(`${locale} ${path}: "${claim.sentence}"`);
          }
          return;
        }
        if (!value || typeof value !== "object") return;
        for (const [key, inner] of Object.entries(value)) {
          walk(inner, path ? `${path}.${key}` : key);
        }
      };
      walk(JSON.parse(read(`messages/${locale}.json`)), "");
    }
    expect(offenders).toEqual([]);
  });
});

describe("who charged — the notice on both surfaces", () => {
  it("recognises the name and nothing else", () => {
    expect(namesReseller("Die Abbuchung erfolgt über die Digistore24 GmbH.")).toBe(true);
    expect(namesReseller("Billed by digistore24")).toBe(true);
    expect(namesReseller("Your payment has been processed.")).toBe(false);
    expect(namesReseller(null)).toBe(false);
  });

  it("🚨 names TWO surfaces — a signed-in buyer never sees the thank-you page", () => {
    // `app/optin/[orderId]/page.tsx` redirects a signed-in buyer straight to
    // the dashboard, which is right and would otherwise mean the notice reaches
    // only the buyers who had no account yet.
    expect(RESELLER_SURFACES.map((s) => s.rendersIn)).toEqual([
      "app/optin/[orderId]/page.tsx",
      "app/dashboard/page.tsx",
    ]);
  });

  it("every surface really renders its key, and every locale really has it", () => {
    // The same claim `legal-check` makes, held here too: that command is not
    // run by `npm run test`, and a mount that quietly disappeared would be
    // found at the next compliance pass rather than at the next commit.
    for (const surface of RESELLER_SURFACES) {
      expect(read(surface.rendersIn), `${surface.rendersIn} lost its mount`).toContain(
        surface.mount,
      );
      const [namespace, key] = surface.key.split(".");
      for (const locale of ["de", "en"]) {
        const catalogue = JSON.parse(read(`messages/${locale}.json`)) as Record<
          string,
          Record<string, string>
        >;
        const line = catalogue[namespace]?.[key];
        expect(typeof line, `${locale}: ${surface.key} is missing`).toBe("string");
        expect(namesReseller(line), `${locale}: ${surface.key}`).toBe(true);
      }
    }
  });
});
