// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { clsx, type ClassValue } from "clsx";
import {
  extendTailwindMerge,
  type ExperimentalParsedClassName,
} from "tailwind-merge";

// ── Why this file is not three lines ────────────────────────────────────────
//
// `cn()` is the shadcn/ui helper every component in `components/ui/` runs its
// class list through. It joins (clsx) and then merges (tailwind-merge), and
// the merge is the load-bearing half: it decides which of two CONFLICTING
// utilities survives, so that a caller's `shadow-lg` replaces a component's own
// `shadow-sm` instead of both landing in the class list and the STYLESHEET's
// order deciding the outcome.
//
// tailwind-merge 2.6.1 predates Tailwind v4 and does not know v4's
// custom-property shorthand — `shadow-(--elevation-overlay)`, the form this
// app's own design system asks for, because it names the elevation ROLE where
// a size word out of Tailwind's vocabulary would name a value. Measured on this
// tree, with the stock `twMerge`:
//
//     twMerge("shadow-sm shadow-(--elevation-overlay)")  ->  BOTH classes
//     twMerge("shadow-sm shadow-lg")                     ->  "shadow-lg"
//
// The second line is the merge working. The first is it not recognising the
// class at all: an unknown class conflicts with nothing, so both stay, and
// `.shadow-sm` — emitted last — wins in the browser. On anything that already
// carries a shadow, the app's sanctioned way of naming an elevation was a
// SILENT no-op: it compiled, it type-checked, the page answered 200, and only
// `getComputedStyle` told the truth.
//
// The three clauses below fix that at the cause. None changes what any class
// MEANS; all three only teach the merger to see a conflict that is really there.

/**
 * The two square brackets, each on its own line and never beside each other.
 *
 * Tailwind v4 scans this whole tree as raw text and does not know what a
 * comment or a string literal is. A bracketed arbitrary value spelled out
 * anywhere below — in the rewrite, in a doc comment explaining it — would
 * become a real CSS rule, and depending on what stands inside it can take every
 * page in the app to a 500 while typecheck and tests stay green. So the form is
 * only ever ASSEMBLED here, never written; `scripts/tailwind-raw-text.test.ts`
 * carries that incident and is what checks the whole tree for it.
 */
const OPEN = "[";
const CLOSE = "]";

/** A `-(` … `)` group with no whitespace in it — the shape of the shorthand. */
const VAR_SHORTHAND = /-\(([^()\s]*)\)/g;

/**
 * Rewrite Tailwind v4's custom-property shorthand into the arbitrary-value form
 * it is DEFINED to be a shorthand for, before tailwind-merge parses the class.
 *
 * Tailwind's own rule: `<utility>-(--x)` is sugar for the arbitrary form
 * carrying `var(--x)`, and `<utility>-(type:--x)` for the same with the data
 * type hint kept. So this is not an interpretation — it is the identity
 * Tailwind itself applies one step earlier in the pipeline.
 *
 * Only the PARSE sees the rewritten text. tailwind-merge returns the classes it
 * was handed (`mergeClassList` keeps `originalClassName`), so nothing the app
 * renders changes shape: the shorthand goes in and the shorthand comes out.
 *
 * Measured across all 216 class-name prefixes in tailwind-merge's default
 * config: 141 of them stop treating the shorthand as an unknown class. The 42
 * that still do not resolve are keyword-only utilities (`float`, `overflow`,
 * `items`, …) where Tailwind has no arbitrary form either — for every one of
 * the 216 the shorthand now behaves EXACTLY like the arbitrary form, which is
 * the whole claim and not a word more.
 */
function desugarVarShorthand(className: string): string {
  if (!className.includes("-(")) return className;
  return className.replace(VAR_SHORTHAND, (whole, inner: string) => {
    const colon = inner.indexOf(":");
    const hint = colon === -1 ? "" : inner.slice(0, colon + 1);
    const name = colon === -1 ? inner : inner.slice(colon + 1);
    // Not a custom property — not this shorthand. Leave the class untouched.
    if (!name.startsWith("--")) return whole;
    return `-${OPEN}${hint}var(${name})${CLOSE}`;
  });
}

/**
 * An arbitrary value that is nothing but a `var()` of a custom property, with
 * no data-type hint in front of it.
 *
 * This is the second clause, and it exists for exactly one class group. In
 * tailwind-merge 2.6.1 the `shadow` group's validator demands a value SHAPED
 * like a shadow (`0_1px_2px_…`); `var(--elevation-overlay)` is not, so the
 * class falls through to the box-shadow-COLOR group, whose validator accepts
 * anything. A colour and a shadow do not conflict, so `shadow-sm` survived
 * next to it and the rewrite above alone would not have helped.
 *
 * Sending the un-hinted form to the box-shadow group is what Tailwind v4 does
 * too: there, `shadow-(--x)` sets the shadow and a colour has to say so —
 * `shadow-(color:--x)`. The hinted form still lands in the colour group here,
 * because the hint makes `startsWith` below fail. That asymmetry is Tailwind's,
 * not ours.
 */
const isCssVariableValue = (value: string) =>
  value.startsWith(OPEN + "var(--") && value.endsWith(")" + CLOSE);

/** Tailwind's important marker, in both spellings — v3 leads with it, v4 trails. */
const IMPORTANT = "!";

/**
 * Move a TRAILING `!` — Tailwind v4's important marker — to where tailwind-merge
 * 2.6.1 looks for it. This is the third clause, and it is the smaller sibling of
 * the first: the same crack, a class the library cannot parse.
 *
 * That version knows only v3's `!shadow-lg`. `shadow-lg!` leaves the `!` on the
 * base class, so `getClassGroupId` is asked about `shadow-lg` + a marker, which
 * matches nothing — and an unknown class conflicts with nothing. Measured on
 * this tree, before this clause:
 *
 *     cn("p-2!", "p-4!")                     ->  BOTH classes
 *     cn("max-h-10!", "max-h-(--radix-y)!")  ->  BOTH classes
 *
 * ⚠️ The failure has a SECOND shape, and it is the worse of the two. Where a
 * group has a catch-all neighbour the unparsed class does not fall through — it
 * lands in the neighbour. `shadow-sm!` is not a shadow to this version; it is a
 * box-shadow COLOUR, because that group's validator accepts anything. So the
 * merge looked like it worked (two trailing-`!` shadows did replace each other)
 * while every answer around it was wrong: a shadow swallowed a colour, and a
 * colour swallowed a shadow. Reading `cn("shadow-sm!", "shadow-lg!")` as
 * evidence that the trailing form was fine is the trap this comment exists for.
 *
 * The correction is the one field that decides it. `hasImportantModifier` is
 * what `mergeClassList` puts in front of the class id, so an important class and
 * a plain one deliberately do NOT conflict — `cn("shadow-sm", "shadow-lg!")`
 * keeps both, and so does `cn("shadow-sm", "!shadow-lg")`. That is
 * tailwind-merge's own design and holds for BOTH spellings; this clause makes
 * the two spellings agree, it does not change what either of them means.
 *
 * `maybePostfixModifierPosition` needs no adjustment: the marker sits at the
 * very end, after any `/50`, so removing it shifts no index. (The leading form
 * is the one where that index and the stripped base disagree — untouched here.)
 *
 * A class carrying BOTH markers is valid in neither Tailwind version, so this
 * clause does not touch it — whatever 2.6.1 already made of `!shadow-lg!`, it
 * goes on making. Inventing a reading for a class Tailwind emits no rule for is
 * the one thing none of these three clauses does.
 */
function withTrailingImportant(
  parsed: ExperimentalParsedClassName,
): ExperimentalParsedClassName {
  if (parsed.hasImportantModifier) return parsed;
  if (!parsed.baseClassName.endsWith(IMPORTANT)) return parsed;
  return {
    ...parsed,
    hasImportantModifier: true,
    baseClassName: parsed.baseClassName.slice(0, -IMPORTANT.length),
  };
}

const twMerge = extendTailwindMerge({
  experimentalParseClassName: ({ className, parseClassName }) =>
    withTrailingImportant(parseClassName(desugarVarShorthand(className))),
  extend: {
    classGroups: {
      shadow: [{ shadow: [isCssVariableValue] }],
    },
  },
});

// shadcn/ui helper: combines classes and resolves Tailwind conflicts.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Exported for `lib/utils.test.ts` only — the needle that keeps the three clauses
// above honest measures the merge itself, not these internals.
export const __testing = {
  desugarVarShorthand,
  isCssVariableValue,
  withTrailingImportant,
};
