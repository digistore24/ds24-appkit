// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The needle for `cn()`'s three tailwind-merge clauses.
//
// The failure this file exists for is the quietest one this app has met: a
// class that is written, compiled, shipped and simply does nothing. Tailwind v4
// spells a custom-property value `shadow-(--elevation-overlay)`; tailwind-merge
// 2.6.1 predates that syntax, treated it as an unknown class, and an unknown
// class conflicts with nothing — so `<Card>`'s own `shadow-sm` survived beside
// it and won, because it is emitted last. `npm run typecheck` was clean, all
// tests were green, the page answered 200, and the elevation was the one that
// was already there.
//
// `lib/utils.ts` closes that with three clauses, and the assertions below are
// what stop any of them being removed — or being outgrown by a future
// tailwind-merge — in silence:
//
//   1. the shorthand is rewritten into the arbitrary form it is defined to
//      mean, before the merger parses it
//   2. an un-hinted `var()` in that arbitrary form is a BOX-SHADOW, where
//      tailwind-merge 2.6.1 files it under box-shadow COLOUR
//   3. Tailwind v4's TRAILING important marker (`shadow-lg!`) is the same thing
//      as the v3 leading one (`!shadow-lg`), which is the only one 2.6.1 knows
//
// ⚠️ All three needles were run while this file was written, by taking each
// clause back out of `lib/utils.ts` in turn. Clause 1 gone: the `origin-` and
// `max-h-` cases fail, and so does the whole sweep at the bottom. Clause 2
// gone: every `shadow-` case fails. Clause 3 gone: the whole last block fails,
// including its sweep — 131 of 216 prefixes stop behaving like the plain form.
// None is covered by the others, which is why all three sets are here.
//
// ⚠️ This file writes NO bracketed arbitrary value literally — every one is
// assembled at run time out of escapes, on the rule in
// `scripts/tailwind-raw-text.test.ts`: Tailwind reads this file as raw text and
// does not know what a comment or a test fixture is.
import { describe, expect, it } from "vitest";
import { getDefaultConfig } from "tailwind-merge";

import { cn } from "./utils";

/** The two brackets, assembled — see the header. */
const OPEN = "[";
const CLOSE = "]";

/** `<prefix>-[var(--name)]`, the arbitrary form the shorthand is sugar for. */
const arbitrary = (prefix: string, name = "--probe") =>
  `${prefix}-${OPEN}var(${name})${CLOSE}`;

describe("cn — Tailwind v4's custom-property shorthand", () => {
  // ── The measurement from action point A27, both halves ───────────────────
  it("resolves the shorthand against a base shadow, as a size word already did", () => {
    // This is THE line. Before the fix it returned both classes.
    expect(cn("shadow-sm", "shadow-(--elevation-overlay)")).toBe(
      "shadow-(--elevation-overlay)",
    );
    // The control that always worked — the shorthand must behave like it.
    expect(cn("shadow-sm", "shadow-lg")).toBe("shadow-lg");
  });

  it("keeps the LAST one, whichever way round they are written", () => {
    expect(cn("shadow-(--elevation-overlay)", "shadow-sm")).toBe("shadow-sm");
    expect(cn("shadow-xs", "shadow-(--elevation-raised)")).toBe(
      "shadow-(--elevation-raised)",
    );
    expect(cn("shadow-(--elevation-raised)", "shadow-(--elevation-overlay)")).toBe(
      "shadow-(--elevation-overlay)",
    );
  });

  it("does not touch a class list that has no conflict in it", () => {
    // The chat launcher's button: the kit's default Button carries no shadow,
    // so nothing competes and nothing may be dropped.
    expect(cn("size-12 rounded-full p-0", "shadow-(--elevation-overlay)")).toBe(
      "size-12 rounded-full p-0 shadow-(--elevation-overlay)",
    );
  });

  it("keeps a variant's conflicts apart from the bare one", () => {
    expect(cn("hover:shadow-sm", "hover:shadow-(--elevation-overlay)")).toBe(
      "hover:shadow-(--elevation-overlay)",
    );
    // Different variants are different declarations and must both survive.
    expect(cn("shadow-sm", "hover:shadow-(--elevation-overlay)")).toBe(
      "shadow-sm hover:shadow-(--elevation-overlay)",
    );
  });

  // ── The colour asymmetry is Tailwind's, and it has to be kept ────────────
  it("sends the hinted form to the shadow COLOUR, the un-hinted one to the shadow", () => {
    // `shadow-(color:--x)` is a colour: it must not swallow a base shadow…
    expect(cn("shadow-sm", "shadow-(color:--brand)")).toBe(
      "shadow-sm shadow-(color:--brand)",
    );
    // …and it must replace another shadow colour.
    expect(cn("shadow-red-500", "shadow-(color:--brand)")).toBe(
      "shadow-(color:--brand)",
    );
    // …while the un-hinted form is the shadow itself and does replace one.
    expect(cn("shadow-lg", "shadow-(--elevation-raised)")).toBe(
      "shadow-(--elevation-raised)",
    );
  });

  // ── The other two shorthands this tree really uses ───────────────────────
  // `components/ui/{select,dropdown-menu,tooltip}.tsx` carry these; they are
  // the reason clause 1 is general rather than a shadow special case.
  it("resolves the shorthands the shadcn components ship", () => {
    expect(
      cn("origin-top", "origin-(--radix-tooltip-content-transform-origin)"),
    ).toBe("origin-(--radix-tooltip-content-transform-origin)");
    expect(
      cn("max-h-10", "max-h-(--radix-select-content-available-height)"),
    ).toBe("max-h-(--radix-select-content-available-height)");
  });

  it("leaves a class alone when the parenthesis is not a custom property", () => {
    // Not this shorthand — Tailwind emits no rule for it either, so the merger
    // must not start inventing a conflict.
    expect(cn("w-10", "w-(foo)")).toBe("w-10 w-(foo)");
    expect(cn("grid-cols-2 gap-(4)")).toBe("grid-cols-2 gap-(4)");
  });

  // ── The general claim, measured rather than asserted ─────────────────────
  //
  // What `lib/utils.ts` promises is exactly this and not a word more: the
  // shorthand behaves like the arbitrary form, for EVERY class-name prefix
  // tailwind-merge knows. Where the arbitrary form is not a thing either
  // (`float`, `overflow`, `items` — keyword-only utilities), both are unknown
  // and both are kept, which is the same answer.
  it("makes the shorthand behave exactly like the arbitrary form, for every prefix", () => {
    const prefixes = new Set<string>();
    for (const definitions of Object.values(getDefaultConfig().classGroups)) {
      for (const definition of definitions) {
        if (definition && typeof definition === "object" && !Array.isArray(definition)) {
          for (const prefix of Object.keys(definition)) prefixes.add(prefix);
        }
      }
    }
    // The sweep has to have something to sweep — a config shape that stopped
    // yielding prefixes would make every assertion below vacuously true.
    expect(prefixes.size).toBeGreaterThan(200);

    const differ: string[] = [];
    let resolved = 0;
    for (const prefix of prefixes) {
      const shorthand = `${prefix}-(--probe)`;
      const recognised = cn(arbitrary(prefix, "--a"), arbitrary(prefix, "--b"));
      const mixed = cn(arbitrary(prefix), shorthand);
      const isRecognised = recognised === arbitrary(prefix, "--b");
      if (isRecognised) resolved += 1;
      if (isRecognised !== (mixed === shorthand)) differ.push(prefix);
    }
    expect(differ).toEqual([]);
    // And the shorthand really does resolve for most of them — without clause 1
    // this number is 0, so it is what turns a removed rewrite red rather than
    // leaving the sweep vacuously green.
    expect(resolved).toBeGreaterThanOrEqual(140);
  });
});

// ── Clause 3: Tailwind v4 writes `!` AFTER the class ────────────────────────
//
// The A27 repair named this and left it: tailwind-merge 2.6.1 predates v4 and
// knows only `!shadow-lg`, so `shadow-lg!` left the marker glued to the base
// class and the merger was asked about a class name that matches nothing.
//
// ⚠️ It did NOT simply fall through, and that is the half worth remembering.
// Where a class group has a catch-all neighbour, the unparsed class landed in
// the neighbour: `shadow-sm!` was filed as a box-shadow COLOUR, because that
// group's validator accepts anything. So `cn("shadow-sm!", "shadow-lg!")`
// returned "shadow-lg!" and looked entirely healthy, while a shadow was
// swallowing a colour next door. Measured across the 216 prefixes: 131 of them
// answered differently with the marker than without it.
describe("cn — Tailwind v4's trailing important marker", () => {
  it("resolves a trailing marker exactly as the leading one always did", () => {
    // These returned BOTH classes before clause 3. No catch-all group here, so
    // the failure was the plain one: an unknown class conflicts with nothing.
    expect(cn("p-2!", "p-4!")).toBe("p-4!");
    expect(cn("origin-top!", "origin-(--radix-tooltip-content-transform-origin)!")).toBe(
      "origin-(--radix-tooltip-content-transform-origin)!",
    );
    expect(cn("max-h-10!", "max-h-(--radix-select-content-available-height)!")).toBe(
      "max-h-(--radix-select-content-available-height)!",
    );
    // The control: the v3 spelling has always worked, and must go on working.
    expect(cn("!p-2", "!p-4")).toBe("!p-4");
    expect(cn("!shadow-sm", "!shadow-lg")).toBe("!shadow-lg");
  });

  // ── The combination A27 could not get to ─────────────────────────────────
  //
  // The shorthand AND the trailing marker in one class. Both clause 1 and
  // clause 3 have to fire on the same string, and this is exactly the pair that
  // made adding a `!` useless as a workaround when A27 was measured.
  it("takes the shorthand and the trailing marker in the same class", () => {
    expect(cn("shadow-sm!", "shadow-(--elevation-overlay)!")).toBe(
      "shadow-(--elevation-overlay)!",
    );
    expect(cn("shadow-(--elevation-overlay)!", "shadow-sm!")).toBe("shadow-sm!");
    expect(cn("shadow-(--elevation-raised)!", "shadow-(--elevation-overlay)!")).toBe(
      "shadow-(--elevation-overlay)!",
    );
    expect(cn("hover:shadow-sm!", "hover:shadow-(--elevation-overlay)!")).toBe(
      "hover:shadow-(--elevation-overlay)!",
    );
  });

  // 🚨 The three above would stay green with clause 3 removed — the box-shadow
  // COLOUR group merged them for the wrong reason and reached the same answer.
  // These are the ones that tell the two apart, and they are the needle for the
  // combination: a shadow and a colour do not conflict, so a merge here is the
  // misfiling, not the fix.
  it("keeps the shadow and the shadow COLOUR apart, marker or no marker", () => {
    expect(cn("shadow-red-500!", "shadow-(--elevation-overlay)!")).toBe(
      "shadow-red-500! shadow-(--elevation-overlay)!",
    );
    expect(cn("shadow-sm!", "shadow-(color:--brand)!")).toBe(
      "shadow-sm! shadow-(color:--brand)!",
    );
    expect(cn("shadow-red-500!", "shadow-lg!")).toBe("shadow-red-500! shadow-lg!");
    // …and the colours still replace each other, which is the other half.
    expect(cn("shadow-red-500!", "shadow-(color:--brand)!")).toBe("shadow-(color:--brand)!");
  });

  it("leaves a marked class alone when there is nothing to conflict with", () => {
    expect(cn("size-12 rounded-full p-0", "shadow-(--elevation-overlay)!")).toBe(
      "size-12 rounded-full p-0 shadow-(--elevation-overlay)!",
    );
    expect(cn("w-10!", "w-(foo)!")).toBe("w-10! w-(foo)!");
  });

  // ── Marked and unmarked deliberately do NOT conflict ─────────────────────
  //
  // 🚨 This is the A27 report's headline measurement, and reading it as this
  // clause's job is the mistake to avoid. `cn("shadow-sm", "shadow-lg!")` keeps
  // both — and so does `cn("shadow-sm", "!shadow-lg")`, in the spelling
  // tailwind-merge has always understood. `hasImportantModifier` goes into the
  // class id on purpose: dropping an `!important` class because a plain one
  // came later would be wrong, since the plain one loses in the browser. It is
  // the library's design, it holds for both spellings, and clause 3 makes the
  // two spellings AGREE rather than changing what either means.
  it("never merges a marked class with an unmarked one — in either spelling", () => {
    expect(cn("shadow-sm", "shadow-lg!")).toBe("shadow-sm shadow-lg!");
    expect(cn("shadow-sm", "!shadow-lg")).toBe("shadow-sm !shadow-lg");
    expect(cn("shadow-lg!", "shadow-sm")).toBe("shadow-lg! shadow-sm");
    // Which is why the doctrine stays what it is: the sanctioned way to name an
    // elevation is plain. Two plain ones merge; that is the line to write.
    expect(cn("shadow-sm", "shadow-(--elevation-overlay)")).toBe("shadow-(--elevation-overlay)");
  });

  it("does not invent a reading for a class carrying both markers", () => {
    // Valid in neither Tailwind version, so clause 3 declines it: the leading
    // marker was already consumed, and what is left is a base class ending in a
    // character no class group knows. 2.6.1 files that under box-shadow COLOUR
    // and merges the pair — its answer, not ours, and it must stay its answer.
    // This assertion is here to go red if the clause ever grows greedy enough
    // to start interpreting a class Tailwind emits no rule for.
    expect(cn("!shadow-sm!", "!shadow-lg!")).toBe("!shadow-lg!");
    // The same class with only ONE marker is the one that is real, either way.
    expect(cn("!shadow-sm", "!shadow-lg")).toBe("!shadow-lg");
    expect(cn("shadow-sm!", "shadow-lg!")).toBe("shadow-lg!");
  });

  // ── The general claim, measured rather than asserted ─────────────────────
  //
  // What clause 3 promises: a trailing marker changes WHETHER two classes
  // conflict for no prefix at all. Measured over every prefix tailwind-merge
  // knows, in both the arbitrary form and the shorthand — so the clause is
  // checked together with clause 1 rather than only beside it.
  it("makes the trailing marker change nothing about conflicts, for every prefix", () => {
    const prefixes = new Set<string>();
    for (const definitions of Object.values(getDefaultConfig().classGroups)) {
      for (const definition of definitions) {
        if (definition && typeof definition === "object" && !Array.isArray(definition)) {
          for (const prefix of Object.keys(definition)) prefixes.add(prefix);
        }
      }
    }
    expect(prefixes.size).toBeGreaterThan(200);

    const differ: string[] = [];
    let resolved = 0;
    for (const prefix of prefixes) {
      const a = arbitrary(prefix, "--a");
      const b = arbitrary(prefix, "--b");
      const plain = cn(a, b) === b;
      const marked = cn(`${a}!`, `${b}!`) === `${b}!`;
      const shorthandMarked = cn(`${a}!`, `${prefix}-(--b)!`) === `${prefix}-(--b)!`;
      if (plain) resolved += 1;
      if (plain !== marked || plain !== shorthandMarked) differ.push(prefix);
    }
    expect(differ).toEqual([]);
    // The needle probe: without clause 3 this list holds 131 of the 216, so an
    // empty `differ` is only worth something while the sweep really resolves
    // something to compare against.
    expect(resolved).toBeGreaterThanOrEqual(140);
  });
});
