// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guard on the AI disclosure — Article 50(1) EU AI Act.
//
// Since 2 August 2026 a system that talks to people has to say that it is a
// machine, "at the latest at the time of the first interaction", clearly and
// distinguishably. The two surfaces in this template are exactly the case the
// rule was written for: the assistant has a human name, a face and a friendly
// tone, and the companion reads what the customer WROTE, which is the sharper
// case of the two.
//
// One line in `messages/*.json` carries that obligation per surface, rendered by
// `components/ai-disclosure.tsx`. It reads like a UX nicety, which is the whole
// problem: the realistic way it disappears is not deletion but a rewrite,
// somebody making it warmer ("Lisa hilft dir gerne!") in a commit about tone.
// Nothing else in the app would break, and the app would be non-compliant.
//
// ── One loop, not one describe per surface ─────────────────────────────────
// The registry is `DISCLOSURE_SURFACES` in `lib/ai/disclosure.mjs`, and
// `scripts/legal/check.mjs` walks the same list with the same patterns. Before
// that module existed the rule lived here as assertions AND there as a regular
// expression carrying the comment "Mirrors lib/ai/disclosure.test.ts" — two
// copies of a rule with a legal deadline, kept in step by hand. A third surface
// is now one entry rather than three edits.
//
// Same shape as `lib/ai/providers/leak-guard.test.ts` and `db/sql-cast.test.ts`:
// a rule nobody can be expected to remember, enforced by something that reads
// the tree. The reasoning for a human is in `docs/compliance.md`.
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import de from "@/messages/de.json";
import en from "@/messages/en.json";

import {
  DISCLOSURE_SURFACES,
  NAMES_A_MACHINE,
  disclosureProblems,
  mountFor,
} from "./disclosure.mjs";
import { moduleDisclosureSurfaces } from "@/scripts/modules/inventory.mjs";
import { MODULE_MESSAGES } from "@/lib/modules/messages";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";

/** The ids the installed modules contribute — none in a core-only app. */
const moduleDisclosureIds = (await moduleDisclosureSurfaces()).map((s) => s.id);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// The message files are typed by their own contents, so a `Record<string, …>`
// annotation rejects every namespace that is not a disclosure. Read them as the
// shape this file actually uses instead.
// ⚠️ MERGED, not `{ de, en }`. A module's disclaimer lives in ITS message file
// — `modules/companion/messages/de.json` — and the running app merges it in.
// Reading the core files alone would report every module surface as having no
// notice while the app renders one perfectly, which is a false Art. 50 alarm
// and would teach the next reader to distrust this check.
const MESSAGES = {
  de: mergeModuleMessages(de as Record<string, unknown>, MODULE_MESSAGES.de ?? {}),
  en: mergeModuleMessages(en as Record<string, unknown>, MODULE_MESSAGES.en ?? {}),
} as unknown as Record<
  string,
  Record<string, { disclaimer?: string }>
>;
// Typed, because `NAMES_A_MACHINE` comes out of a `.mjs` and has no index
// signature — and because a locale this file cannot check must be a visible
// omission rather than an `any`.
const LOCALES = Object.keys(MESSAGES) as (keyof typeof NAMES_A_MACHINE)[];

const sourceOf = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("the registry is real, so the loops below can fail", () => {
  // Non-vacuity, first and for the whole file: a loop over an empty list passes
  // every assertion inside it, which is the one way a table-driven test lies.
  it("has the surface this core ships, plus every installed module's", () => {
    // ⚠️ This used to assert exactly ["chat", "companion"]. The companion is a
    // MODULE now, so the second entry is present only while it is installed —
    // and asserting the pair would have made the list a claim about which
    // features an app happens to have rather than about the registry.
    //
    // What must not weaken is the non-vacuity: a loop over an empty list passes
    // every assertion inside it, which is the one way a table-driven test lies.
    const ids = DISCLOSURE_SURFACES.map((surface) => surface.id);
    expect(ids).toContain("chat");
    expect(ids.length).toBe(new Set(ids).size);
    for (const id of moduleDisclosureIds) expect(ids).toContain(id);
  });

  it("names files that exist and were really read", () => {
    for (const surface of DISCLOSURE_SURFACES) {
      expect(existsSync(join(ROOT, surface.rendersIn)), surface.rendersIn).toBe(true);
      const source = sourceOf(surface.rendersIn);
      expect(source.length, surface.rendersIn).toBeGreaterThan(1000);
      // The component's own name, not only its length — a wrong path that
      // happened to point at another long file would otherwise pass. Restored
      // after a code review found it had been dropped in the rewrite.
      const componentName = surface.id === "chat" ? "ChatWindow" : "CompanionPanel";
      expect(source, surface.rendersIn).toContain(componentName);
    }
  });

  it("🚨 a surface's extra hint names a file that is really there", () => {
    // `switchedOnHint` is the one sentence a surface may add to `legal-check`'s
    // refusal — its own accepted false positive, in its own words. It is the
    // most helpful line that command prints and therefore the worst place for a
    // dead path: it used to live in `scripts/legal/check.mjs` behind an
    // `id === "companion"` test and went on naming `lib/ai/companions.ts` long
    // after the companion became a module. Whoever hit it was sent to a file
    // that is not there.
    for (const surface of DISCLOSURE_SURFACES) {
      const hint = (surface as { switchedOnHint?: string }).switchedOnHint;
      if (hint === undefined) continue;
      expect(typeof hint, surface.id).toBe("string");
      const paths = [...hint.matchAll(/\b([\w./-]+\.(?:ts|tsx|mjs|json))\b/g)].map((m) => m[1]);
      expect(paths.length, `${surface.id}: the hint names no file at all`).toBeGreaterThan(0);
      for (const path of paths) {
        expect(existsSync(join(ROOT, path)), `${surface.id} → ${path}`).toBe(true);
      }
    }
  });
});

describe.each(DISCLOSURE_SURFACES)("$label ($id)", (surface) => {
  const source = sourceOf(surface.rendersIn);

  for (const locale of LOCALES) {
    it(`${locale}: names it as a machine`, () => {
      const text = MESSAGES[locale][surface.id]?.disclaimer;

      expect(
        text,
        `messages/${locale}.json has no ${surface.id}.disclaimer. It is the ` +
          `notice required by Art. 50(1) EU AI Act, not decoration — see ` +
          `docs/compliance.md.`,
      ).toBeTruthy();

      expect(
        text,
        `messages/${locale}.json → ${surface.id}.disclaimer no longer says it ` +
          `is an AI. Whatever else it says, it has to say that.`,
      ).toMatch(NAMES_A_MACHINE[locale]);
    });
  }

  it("is mounted, exactly once", () => {
    const mount = `surface="${surface.id}"`;
    expect(source, `${surface.rendersIn} no longer mounts ${mountFor(surface.id)}.`).toContain(
      mount,
    );
    expect(source.split(mount).length - 1, "expected exactly one disclosure").toBe(1);
  });

  it("comes before the transcript, not after the input box", () => {
    // "At the latest at the time of the first interaction" — a line under the
    // send button, below the fold of a short panel, is not that.
    const at = source.indexOf(`surface="${surface.id}"`);
    const transcript = source.indexOf("overflow-y-auto");

    expect(at).toBeGreaterThan(-1);
    expect(transcript).toBeGreaterThan(-1);
    expect(
      at < transcript,
      `the disclosure is rendered after the transcript. It has to be readable ` +
        `before the first question, in the short panel as well as on the page.`,
    ).toBe(true);
  });

  it("is not conditional on there being anything to show yet", () => {
    // The first interaction is the one that has not happened. A notice behind
    // "once there are messages", or behind "once the history has loaded", is a
    // notice the first question never sees.
    const line = source.split("\n").find((candidate) => candidate.includes(`surface="${surface.id}"`));
    expect(line).toBeTruthy();
    expect(line, "the disclosure line carries a condition").not.toMatch(/\{\s*\w+\s*&&/);
  });

  if (surface.insideBlock) {
    // Captured before the callback: the surface list is now a uniform type
    // (core entries plus whatever an installed module contributes), so
    // TypeScript cannot carry the narrowing above into the closure below.
    const insideBlock = surface.insideBlock;
    it("renders in the part every variant mounts", () => {
      // `ChatWindow` is drawn twice — as a page and as the floating panel. The
      // shared block is what both mount, so a disclosure placed there is one the
      // panel gets too. One that drifted into a variant-specific branch would
      // silently cover only one of the two places customers meet her.
      const blockStart = source.indexOf(insideBlock);
      const returnStart = source.indexOf("  return (", blockStart);
      const at = source.indexOf(`surface="${surface.id}"`);

      expect(blockStart).toBeGreaterThan(-1);
      expect(returnStart).toBeGreaterThan(blockStart);
      expect(
        at > blockStart && at < returnStart,
        `the disclosure moved out of the shared block. The floating panel ` +
          `renders that block and nothing else — putting the notice anywhere ` +
          `variant-specific leaves one of the two uncovered.`,
      ).toBe(true);
    });
  }
});

describe("the patterns themselves", () => {
  it("would catch a friendlier rewrite", () => {
    expect(NAMES_A_MACHINE.de.test("Lisa ist eine KI. Sie kann sich irren.")).toBe(true);
    expect(NAMES_A_MACHINE.de.test("Lisa hilft dir gerne weiter!")).toBe(false);
    expect(NAMES_A_MACHINE.en.test("Lisa is an AI. She can be wrong.")).toBe(true);
    expect(NAMES_A_MACHINE.en.test("Lisa is happy to help!")).toBe(false);
    // The German string must not pass on the English word.
    expect(NAMES_A_MACHINE.de.test("Lisa is an AI assistant.")).toBe(false);
  });

  it("would catch the companion's own kind of rewrite", () => {
    // The one somebody actually writes: warm, accurate about what it does, and
    // silent about what it is.
    expect(NAMES_A_MACHINE.de.test("Dein persönlicher Coach liest mit.")).toBe(false);
    expect(
      NAMES_A_MACHINE.de.test("Was du hier schreibst, liest und beantwortet eine KI."),
    ).toBe(true);
    expect(NAMES_A_MACHINE.en.test("Your coach reads along and replies.")).toBe(false);
    expect(NAMES_A_MACHINE.en.test("An AI reads what you write here.")).toBe(true);
  });
});

// ── `disclosureProblems()` against fixtures ────────────────────────────────
// The assertions above prove the SHIPPED tree is right. These prove the check
// would go red if it were not — which is the half a green suite cannot show,
// and the behaviour `node run.mjs legal-check` rests on.
describe("what disclosureProblems() reports", () => {
  // No fixtures on disk: `disclosureProblems()` takes its readers as arguments,
  // so the cases below are handed to it directly. An earlier version wrote files
  // into a temp directory that nothing ever read — dead code that looked like
  // coverage, plus a directory left behind on every run.
  // ⚠️ Driven through the CHAT surface, not the companion's.
  //
  // The companion became a module, so its surface is in the registry only while
  // that module is installed — and a fixture aimed at a surface that may not be
  // there is a test that passes by finding nothing. The behaviours below are
  // generic (a missing key, a sentence that stopped naming a machine, a notice
  // nothing renders); the chat is simply the surface this core always has.
  /** A file that mounts the notice, padded so it is not mistaken for empty. */
  const mounts = `${"// filler\n".repeat(60)}<AiDisclosure surface="chat" />\n`;
  const mountsNot = `${"// filler\n".repeat(60)}<p>nothing here</p>\n`;

  const ask = (options: { chatOn: boolean; chatText?: string | null; source?: string }) =>
    disclosureProblems({
      locales: ["de", "en"],
      messagesFor: (locale: string) => ({
        chat:
          options.chatText === null
            ? {}
            : {
                disclaimer:
                  options.chatText ?? (locale === "de" ? "Lia ist eine KI." : "Lia is an AI."),
              },
      }),
      sourceOf: () => options.source ?? mounts,
      // Only the chat's switch is driven; anything else — a module's surface in
      // an app that installed one — stays off, and a switched-off surface owes
      // nothing. Without this the fixture would demand a notice from every
      // surface the app happens to have.
      configFor: (relative: string) =>
        relative === "config/ai-chat.json" ? { enabled: options.chatOn } : { enabled: false },
    });

  it("says nothing about a surface that is switched off", () => {
    // The shipped state of the companion, and the honest answer rather than a
    // pass: nothing talks to anybody, so nothing is owed.
    expect(ask({ chatOn: false, source: mountsNot, chatText: null })).toEqual([]);
  });

  it("says nothing when a live surface is correct", () => {
    expect(ask({ chatOn: true })).toEqual([]);
  });

  it("reports a missing key, per locale", () => {
    const problems = ask({ chatOn: true, chatText: null });
    expect(problems).toHaveLength(2);
    expect(problems.every((problem: { code: string }) => problem.code === "missingKey")).toBe(true);
    expect(problems.map((problem: { locale?: string }) => problem.locale).sort()).toEqual([
      "de",
      "en",
    ]);
  });

  it("reports a sentence that stopped naming a machine", () => {
    const problems = ask({ chatOn: true, chatText: "Dein Coach liest mit." });
    expect(problems.some((problem: { code: string }) => problem.code === "doesNotNameAMachine")).toBe(
      true,
    );
  });

  it("reports a perfect sentence that nothing renders", () => {
    // The half a rewrite of the component breaks while every message file stays
    // untouched — and the half that is easiest to miss in review.
    const problems = ask({ chatOn: true, source: mountsNot });
    expect(problems).toEqual([
      {
        code: "nothingRendersIt",
        surface: "chat",
        rendersIn: "app/dashboard/chat/ui.tsx",
      },
    ]);
  });

  it("consults the switch rather than scanning the tree", () => {
    // The same panel, the same missing tag, two different answers — decided by
    // the switch alone. A scan for product-side call sites would answer "found"
    // in every app, because the template itself ships one.
    expect(ask({ chatOn: false, source: mountsNot })).toEqual([]);
    expect(ask({ chatOn: true, source: mountsNot })).not.toEqual([]);
  });

});
