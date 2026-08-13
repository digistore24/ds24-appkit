// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 Tailwind reads this whole tree as RAW TEXT — and it does not know what a
// comment is.
//
// Every file here is a source of class names to Tailwind v4: `.tsx`, `.ts`,
// `.mjs`, `.json`, `.md`, this file. It does not parse them; it scans them for
// anything that looks like a utility and emits a CSS rule for it. So a class
// name written in PROSE — in a comment, in a doc, in a table explaining what
// NOT to write — becomes a real rule in `app/globals.css`'s output, exactly as
// if somebody had put it on an element.
//
// Usually that is harmless: a spare `.shadow-sm` nobody uses costs nothing, and
// this tree ships several of them. But an ARBITRARY value — the square-bracket
// form — carries its contents through into the declaration, and there the
// contents have to survive two readers that a comment was never written for.
// When they do not, **every page in the app answers 500** while `npm run
// typecheck` is clean and every test is green.
//
// ── The incident this file exists for (Story 43.7) ─────────────────────────
// `app/login/ui.tsx` needed to explain why the bracketed arbitrary form of a
// shadow utility is the wrong way to name an elevation role. Writing it out,
// inside a `//` comment, to say *do not write this*, took the app down:
//
//     ✗ 500  /login  ./app/globals.css:1633:22  Parsing CSS source code failed
//     ✗ 8 page(s) with a server error.
//
// `smoke` found it, and nothing else could have. ⚠️ It also needed
// `rm -rf .next`: Turbopack keeps the broken rule in its cache across a
// restart, after the source is already clean. That is not folklore — building
// this file re-produced it twice, and once it silently poisoned the NEXT
// measurement, which is the whole reason the reset below is a cache wipe rather
// than a restart.
//
// ── 🚨 The RULE is not here. It is a command's rule, and this is one caller ─
// `scripts/ux/tailwind-raw-text.mjs` holds the scanner, the tree walk and the
// needle. This file is the caller that runs under `npm run test`, and
// `node run.mjs ux-check` is the other — which is the point of the split
// (Retro-Action A69): a customer meets this file through the test suite, but
// after a 500 they go to `ux-check`, and a failure whose only symptom is a 500
// on every page has to be answerable there. Two callers, ONE implementation:
// a second scanner would be a second truth, and this project has measured what
// that costs twice.
//
// **What lives here and nowhere else is the MEASUREMENT** — which forms took
// the running app down, which are harmless, and the honesty about the boundary.
// The `.mjs` states the rule; these tests are the record of what it was
// measured against, and they are what a change to that file has to survive.
//
// 🚨 And the one thing that must survive both files: this scanner deliberately
// does NOT go through `blankComments()`, where every other text checker here
// must. The reader whose mistake is being prevented is TAILWIND — a foreign
// tool with no idea that `//` means anything — so the needle is in the comment
// on purpose. Do not "unify" the two; the long form is in the `.mjs` header.
//
// ── 🚨 What was measured, and WITH WHAT ────────────────────────────────────
// Every line below was measured by planting one token in a comment in
// `app/login/ui.tsx` and asking the RUNNING app for `/login` — Turbopack, the
// reader that actually decides, with a cache wipe and a restart after every
// failure so no answer could leak into the next.
//
// 🚨 **The instrument matters, and getting it wrong is how this file nearly
// shipped a lie.** The first pass judged tokens by compiling them through this
// repo's own `@tailwindcss/postcss` and parsing the result with a CSS parser.
// That instrument called a background utility carrying a `url()` with an
// ellipsis in it **harmless** — it is perfectly valid CSS — so it went into the
// header below, spelled out, as an example of what NOT to report.
// Tailwind then emitted it, and the app answered **500 on eight pages**:
// Turbopack resolves a relative `url()` in CSS as a MODULE IMPORT, and `…` is
// not a file. A guard measured against the wrong reader would have named that
// form as the safe one.
//
// So there are TWO families, one per reader, and neither is a subset of the
// other — the `.mjs` header carries both, with the error line each one produces.
// 🚨 Neither says everything Tailwind can break on: a third reader could exist,
// and both callers word their output as *what was measured*.
//
//   measured on the running app as HARMLESS — NOT a finding, and the tree
//   ships these:
//     shadow-[…]   font-[…]   text-[#fff]   w-[calc(100%-1rem)]   shadow-[...]
//     shadow-[var(--x,…)]   shadow-[var(--elevation-overlay)]
//     shadow-sm   text-xl   shadow-(--elevation-overlay)
//
//   ⚠️ Writing that list out costs about a kilobyte of dead CSS in every app
//   built on this template — Tailwind reads this comment and emits a rule for
//   every one of them. That is not a slip: it is the cheapest possible
//   demonstration of the claim this whole file rests on, and `docs/ux.md` and
//   `docs/design-system.md` have been paying the same toll for longer. The two
//   broken families cannot be paid for at any price, which is the difference.
//
// Two forms of the parenthesised shorthand were measured too and neither can
// carry any of this: `shadow-(x)` and `shadow-(…)` produce no rule at all,
// because that shorthand only accepts a `--*` name in the first place. And
// `shadow-[VAR(…)]` in capitals builds fine, so the rule is case-sensitive: a
// rule stricter than the measurement is one somebody eventually has to argue
// with.
//
// ── ⚠️ The ONE place this guard is deliberately stricter than Tailwind ──────
// Measured, and it is the most surprising result of the whole exercise: what
// follows the closing bracket decides whether Tailwind takes the token at all.
// With the incident's form written at the end of a line, inside backticks, or
// with a space after it, the app answers **500**. With a `.` or a `,` glued
// straight onto the bracket, the app answers **200** — the punctuation is read
// as part of the candidate, the candidate is nonsense, and no rule comes out.
//
// This guard reports all of them, on purpose. The "fix" the exception would
// license is *put a full stop after it*, which is not a fix but a landmine: the
// next person to re-wrap that paragraph, or to move the sentence, takes the app
// down and has no idea why. Two punctuation marks of over-strictness buy a rule
// somebody can hold in their head — do not add the exception.
//
// ⚠️ `.css` files are the one text extension Tailwind does NOT scan (measured),
// which is why the walk skips them — `app/globals.css` writes `var(--…)` on
// nearly every line and is read as CSS, not as a source of class names.
//
// ⚠️ **This file writes no broken token literally.** 🚨 That is not a
// precaution taken on principle: the first draft of this header spelled the
// list out, the guard's own tree walk found nine of them in this file, and the
// app it was written to protect would have gone down on the commit that added
// it. Every fixture is assembled at run time out of escapes, and
// `it("the needle can be found at all")` is what proves the assembled string is
// really the incident's form.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BUNDLER_NEEDLE,
  HARMLESS_CONTROL,
  PARSER_NEEDLE,
  needleProbe,
  say,
  scanSource,
  scanTree,
} from "./ux/tailwind-raw-text.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// ── The rule ────────────────────────────────────────────────────────────────

/** The three characters the fixtures below are assembled from. */
const OPEN = "[";
const CLOSE = "]";
const ELLIPSIS = "…";
const INCIDENT = PARSER_NEEDLE;

/** Nothing on disk resolves, unless a test says otherwise. */
const NOTHING_RESOLVES = () => false;

describe("the rule", () => {
  it("🚨 the needle can be found at all", () => {
    // 🚨 Every assertion below runs the rule over an assembled string. A string
    // that is not the incident's form would let the whole file pass while
    // measuring nothing — the failure mode `scripts/lib/source-text.test.ts`
    // shipped once, where the needle and the tree could never line up.
    //
    // The check itself lives in the `.mjs` as `needleProbe()`, because
    // `ux-check` needs exactly the same reassurance and must not carry a second
    // copy of it. What it answers is: is the assembled token still the incident
    // as recorded in Story 43.7 and in the comment above `<Card>` in
    // app/login/ui.tsx, does the rule still recognise BOTH families' needles,
    // and does it still stay silent on a form measured as harmless.
    expect(needleProbe()).toEqual([]);

    // …and the shape of it, spelled here the only way it can be: by code points.
    expect(INCIDENT.startsWith("shadow-")).toBe(true);
    expect(INCIDENT).toHaveLength("shadow-".length + "var()".length + 3);
    expect(INCIDENT.codePointAt(7)).toBe(0x5b); // [
    expect(INCIDENT.codePointAt(12)).toBe(0x2026); // …
    expect(INCIDENT.codePointAt(14)).toBe(0x5d); // ]

    const { findings } = scanSource(`// ${INCIDENT}`, NOTHING_RESOLVES);
    expect(findings).toHaveLength(1);
    expect(findings[0].reader).toBe("parser");
    expect(findings[0].argument).toBe(ELLIPSIS);
  });

  it("🚨 the needle probe fails when the rule stops recognising it", () => {
    // The probe's own counter-proof. `needleProbe()` is what `ux-check` trusts
    // instead of hoping the tree contains a token — so "it returned []" has to
    // mean "it compared", not "it never looked". Each of the three questions it
    // asks is asked again here against a rule that has been broken on purpose.
    const brokenParser = scanSource(`// ${PARSER_NEEDLE.replace("var", "VAR")}`);
    expect(brokenParser.findings).toEqual([]); // the case-sensitivity, measured

    const brokenBundler = scanSource(`// ${BUNDLER_NEEDLE.replace("url", "URL")}`);
    expect(brokenBundler.findings).toEqual([]);

    // …and the control really is a form the rule stays silent on.
    expect(scanSource(`// ${HARMLESS_CONTROL}`).findings).toEqual([]);
  });

  it("finds it in a line comment, a block comment and a doc", () => {
    // The three places it has actually been written. Tailwind sees no
    // difference between them, so neither does this.
    for (const text of [
      `    // and the bracketed form ${INCIDENT} would resolve through cn()`,
      `/** ⚠️ never write ${INCIDENT} — see docs/design-system.md */`,
      `| a value written past a dial | \`${INCIDENT}\` |`,
    ]) {
      expect(scanSource(text, NOTHING_RESOLVES).findings, text).toHaveLength(1);
    }
  });

  it("finds it in code too, because Tailwind cannot tell the difference", () => {
    const source = `<Card className="${INCIDENT}" />`;
    expect(scanSource(source, NOTHING_RESOLVES).findings).toHaveLength(1);
  });

  it("names the file, the line and the column", () => {
    const source = ["const a = 1;", "", `// ${INCIDENT}`].join("\n");
    const [finding] = scanSource(source, NOTHING_RESOLVES).findings;
    expect(finding.line).toBe(3);
    expect(finding.column).toBe(11);
    expect(say("app/login/ui.tsx", finding)).toContain("app/login/ui.tsx:3:11");
    expect(say("app/login/ui.tsx", finding)).toContain("does not PARSE");
    expect(say("app/login/ui.tsx", finding)).toContain("rm -rf .next");
  });

  it("finds every form the CSS parser was measured to refuse", () => {
    // Each of these was planted in app/login/ui.tsx and answered
    // `✗ Parsing CSS source code failed` on the running app.
    const broken = [
      `text-${OPEN}var(${ELLIPSIS})${CLOSE}`,
      `p-${OPEN}var(x)${CLOSE}`,
      `w-${OPEN}calc(var(x)*2)${CLOSE}`,
      `dark:shadow-${OPEN}var(${ELLIPSIS})${CLOSE}`,
      `font-${OPEN}family-name:var(${ELLIPSIS})${CLOSE}`,
      `${OPEN}color:var(${ELLIPSIS})${CLOSE}`,
      `${OPEN}--foo:var(${ELLIPSIS})${CLOSE}`,
    ];
    for (const token of broken) {
      const { findings } = scanSource(`// ${token}`, NOTHING_RESOLVES);
      expect(findings, token).toHaveLength(1);
      expect(findings[0].reader, token).toBe("parser");
    }
  });

  it("finds every form the BUNDLER was measured to refuse", () => {
    // `✗ Module not found: Can't resolve '…'` on the running app — a 500 that a
    // CSS parser cannot see, because the CSS is valid.
    const broken = [
      BUNDLER_NEEDLE,
      `bg-${OPEN}url(...)${CLOSE}`,
      `bg-${OPEN}url(<path>)${CLOSE}`,
      `bg-${OPEN}url(nope.png)${CLOSE}`,
    ];
    for (const token of broken) {
      const { findings } = scanSource(`// ${token}`, NOTHING_RESOLVES);
      expect(findings, token).toHaveLength(1);
      expect(findings[0].reader, token).toBe("bundler");
    }
  });

  it("🚨 stays silent on the harmless forms — the tree is full of them", () => {
    // The counter-proof, and the reason this guard can be left switched on. A
    // checker that reported `shadow-[…]` would fire on CLAUDE.md, on
    // docs/ux.md, on docs/design-system.md and on the ux rules' own fixtures —
    // and would be switched off within a week, taking the real check with it.
    //
    // Every one of these was planted in app/login/ui.tsx and the running app
    // answered 200.
    const harmless = [
      `shadow-${OPEN}${ELLIPSIS}${CLOSE}`,
      `font-${OPEN}${ELLIPSIS}${CLOSE}`,
      `grid-cols-${OPEN}${ELLIPSIS}${CLOSE}`,
      `shadow-${OPEN}...${CLOSE}`,
      `font-${OPEN}<family>${CLOSE}`,
      `text-${OPEN}#fff${CLOSE}`,
      `w-${OPEN}calc(100%-1rem)${CLOSE}`,
      `text-${OPEN}rgb(${ELLIPSIS})${CLOSE}`,
      `shadow-${OPEN}var(--x,${ELLIPSIS})${CLOSE}`,
      HARMLESS_CONTROL,
      `h-${OPEN}var(--radix-select-trigger-height)${CLOSE}`,
      `bg-${OPEN}--my-color${CLOSE}`,
      `shadow-${OPEN}VAR(${ELLIPSIS})${CLOSE}`,
      "shadow-sm",
      "text-xl",
      "shadow-(--elevation-overlay)!",
      `shadow-(${ELLIPSIS})`,
      // url() the bundler never resolves — measured, including the missing file
      // behind a root-relative path.
      `bg-${OPEN}url(/icons/icon-192.png)${CLOSE}`,
      `bg-${OPEN}url(/nope.png)${CLOSE}`,
      `bg-${OPEN}url(https://example.com/a.png)${CLOSE}`,
      `bg-${OPEN}url(data:image/gif;base64,R0lGOD)${CLOSE}`,
      `bg-${OPEN}url(#gradient)${CLOSE}`,
      // Not a Tailwind candidate at all, measured: the app answers 200.
      `shadow-${OPEN} var(x) ${CLOSE}`,
      `${OPEN}var(x)${CLOSE}`,
      `see ${OPEN}var(x)${CLOSE}(https://example.com)`,
      `foo${OPEN}color:var(x)${CLOSE}`,
    ];
    for (const token of harmless) {
      expect(scanSource(`// ${token}`, NOTHING_RESOLVES).findings, token).toEqual([]);
    }
  });

  it("⚠️ reports it even where a trailing . or , would have saved the app", () => {
    // Measured, and the one place this rule is stricter than Tailwind: glue a
    // `.` or a `,` onto the closing bracket and the token stops being a
    // candidate, so the app answers 200. Reported anyway — the header says why,
    // and it comes down to this: nobody should ever be able to fix one of these
    // findings by adding a full stop.
    for (const tail of [".", ","]) {
      const { findings } = scanSource(`// never write ${INCIDENT}${tail}`, NOTHING_RESOLVES);
      expect(findings, tail).toHaveLength(1);
    }
    // …and the forms that really are candidates, which is most of them: at the
    // end of a line, in backticks, with a space after. All three measured 500.
    for (const text of [
      `// ${INCIDENT}`,
      `// \`${INCIDENT}\` is the wrong way to say it`,
      `// the form ${INCIDENT} is wrong`,
    ]) {
      expect(scanSource(text, NOTHING_RESOLVES).findings, text).toHaveLength(1);
    }
  });

  it("leaves a relative url() alone when the file is really there", () => {
    // Measured: a background utility whose url() names `icon.png` — with or
    // without a leading `./` — builds, because `app/icon.png` sits beside the
    // stylesheet. The rule must not report a background that works.
    //
    // ⚠️ Neither of those two tokens can be written out here either, and that is
    // not the same reason as everywhere else in this file: they are perfectly
    // safe in THIS app. They would break the first app whose `app/icon.png` was
    // renamed — a landmine planted in a customer's tree by a comment of ours.
    const token = `bg-${OPEN}url(./icon.png)${CLOSE}`;
    expect(scanSource(`// ${token}`, NOTHING_RESOLVES).findings).toHaveLength(1);
    expect(scanSource(`// ${token}`, (spec) => spec === "./icon.png").findings).toEqual([]);
  });
});

// ── The tree ────────────────────────────────────────────────────────────────

describe("no source file in this app compiles to a broken CSS rule", () => {
  const scan = scanTree({ root: ROOT });

  it("walked the tree", () => {
    // Non-vacuity. Every assertion here is over the walk, so an empty one is a
    // green run that read nothing.
    expect(scan.texts.length).toBeGreaterThan(300);
    const files = scan.texts.map((entry) => entry.file);
    expect(files).toContain("app/login/ui.tsx"); // where the incident happened
    expect(files).toContain("CLAUDE.md"); // prose Tailwind reads as class names
    expect(files).toContain("docs/design-system.md"); // …and the doc under it
    // The other caller. `ux-check` runs this same walk, so a tree that stopped
    // containing the scanner would be a scan of an app without one.
    expect(files).toContain("scripts/ux/tailwind-raw-text.mjs");
  });

  it("found the stylesheet a relative url() would be resolved from", () => {
    // Without this the url() half degrades silently into "nothing resolves",
    // which is stricter than the app and would report a working background.
    expect(scan.stylesheetDirs.length).toBeGreaterThan(0);
    expect(scan.resolves("icon.png")).toBe(true);
    expect(scan.resolves("nope.png")).toBe(false);
  });

  it("🚨 and really compared: it sees arbitrary values that are there today", () => {
    // 🚨 The second half of the probe, and the one that is easy to leave out.
    // "Walked 400 files" proves the walk ran; it does not prove the rule
    // recognised a single token. A regex that matched nothing at all would give
    // the same green as a clean tree — and the two must never look alike.
    //
    // This tree ships arbitrary values in code (`components/ui/select.tsx`) and
    // in prose (`docs/design-system.md` explains why not to write them). Both
    // are correct and neither is a finding; what they prove is that the
    // comparison happened.
    expect(scan.candidates.length).toBeGreaterThan(5);
    expect(scan.candidates.some((token) => token.includes("var(--"))).toBe(true);
    expect(scan.candidates.some((token) => token.includes(ELLIPSIS))).toBe(true);
  });

  it("finds nothing", () => {
    expect(scan.findings.map((finding) => say(finding.file, finding))).toEqual([]);
  });
});
