// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs ux-check` is only worth having if it is trusted, and trust here
// breaks in two directions — exactly as it does for `node run.mjs errors`.
//
// Miss a real one and the app ships with unreadable text while the command says
// green. Flag something correct and the command cries wolf on a fresh clone
// until nobody reads it any more. This project's own template is the second
// case: `<input type="hidden">`, a `<button>` under a Radix `asChild` slot and
// a segmented control all LOOK like violations to a naive regex and are not.
//
// So both directions are tested, and every "must not flag" case below is a real
// line taken out of this template.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseHsl,
  contrastRatio,
  parseTokens,
  DIAL_BYPASSES,
  MODE_SINGLE_TOKENS,
  findDialBypasses,
  findUnpairedTokens,
  findPaletteClasses,
  findRawElements,
  findUnnamedIconButtons,
  findImagesWithoutAlt,
  findPlaceholderHome,
  navHrefs,
  routeShape,
  RAW_ELEMENT_EXCEPTIONS,
  partitionAcceptedControls,
} from "./rules.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import { notChecked } from "@/lib/test-not-checked";

/**
 * The three message keys the SHIPPED `app/page.tsx` renders its feature list
 * from — the whole marker, read as raw strings.
 *
 * 🚨 Deliberately not imported from `rules.mjs`: this list is what decides
 * whether the question below may be asked at all, and a precondition taken from
 * the mechanism under test can be talked out of asking by the very defect it is
 * there to catch. `findPlaceholderHome()` knows one of these three and looks for
 * it with a regex; this looks for all three with `includes`. The overlap is the
 * point — the two agree about the page and disagree about how they read it.
 *
 * `salespage` step 0 uses the same marker to decide whether a page was already
 * built ("the three `home.features.*` keys are gone from the page"), so the two
 * cannot drift into different opinions about what "still the template" means.
 */
const SHIPPED_HOME_KEYS = [
  "features.authTitle",
  "features.billingTitle",
  "features.readyTitle",
];

describe("parseHsl", () => {
  it("reads the form app/globals.css uses", () => {
    expect(parseHsl("hsl(0 0% 100%)")).toEqual([255, 255, 255]);
    expect(parseHsl("hsl(0 0% 0%)")).toEqual([0, 0, 0]);
  });

  it("reads a saturated colour", () => {
    // --primary in the light block.
    const rgb = parseHsl("hsl(243 70% 58%)");
    expect(rgb).not.toBeNull();
    const [r, g, b] = rgb!;
    expect(b).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(g);
  });

  it("returns null for a form it does not understand", () => {
    // The caller REPORTS this rather than skipping it — a token nothing can
    // parse is a token nothing checks, and silence there is the worst outcome.
    expect(parseHsl("#4f46e5")).toBeNull();
    expect(parseHsl("hsl(243, 70%, 58%)")).toBeNull();
    expect(parseHsl("oklch(0.55 0.2 275)")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5);
  });

  it("does not care which way round the arguments come", () => {
    const a: [number, number, number] = [30, 30, 30];
    const b: [number, number, number] = [200, 200, 200];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("agrees with a known WCAG value", () => {
    // #767676 on white is the canonical 4.54:1 — the shade that just passes AA.
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 1);
  });
});

describe("parseTokens", () => {
  const css = `
:root {
  --background: hsl(0 0% 100%);
  --primary: hsl(243 70% 58%);
}

.dark {
  --background: hsl(240 10% 5%);
  --primary: hsl(243 85% 74%);
}

@theme inline {
  --color-primary: var(--primary);
}
`;

  it("reads both blocks separately", () => {
    const tokens = parseTokens(css);
    expect(tokens.light.primary).toBe("hsl(243 70% 58%)");
    expect(tokens.dark.primary).toBe("hsl(243 85% 74%)");
  });

  it("does not drag @theme's var() aliases in", () => {
    // Those are Tailwind plumbing, not colours. A `var(--primary)` reaching
    // parseHsl would be reported as unreadable on every single run.
    const tokens = parseTokens(css);
    expect(tokens.light["color-primary"]).toBeUndefined();
    expect(tokens.dark["color-primary"]).toBeUndefined();
  });

  it("comes back empty rather than throwing when a block is missing", () => {
    expect(parseTokens("body { color: red; }")).toEqual({ light: {}, dark: {} });
  });
});

describe("findPaletteClasses", () => {
  it("finds a hard-coded palette colour", () => {
    const hits = findPaletteClasses('<div className="bg-blue-600 p-4">');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 1, found: "bg-blue-600" });
  });

  it("finds one behind a variant", () => {
    expect(findPaletteClasses('className="dark:text-gray-500"')[0]?.found).toBe(
      "text-gray-500",
    );
  });

  it("finds bg-white and text-black", () => {
    // No shade, so the first pattern misses them — and they break dark mode
    // just as thoroughly.
    expect(findPaletteClasses('className="bg-white"')).toHaveLength(1);
    expect(findPaletteClasses('className="text-black"')).toHaveLength(1);
  });

  it("leaves the tokens alone", () => {
    const source =
      '<div className="bg-card text-muted-foreground border-input bg-primary ' +
      'text-success-foreground bg-destructive">';
    expect(findPaletteClasses(source)).toEqual([]);
  });

  it("reports the line it is on", () => {
    expect(findPaletteClasses("a\nb\n<p className='text-red-700'>")[0]?.line).toBe(3);
  });
});

/**
 * Tailwind v4's parenthesised custom-property shorthand, ASSEMBLED rather than
 * written out.
 *
 * 🚨 `CLAUDE.md` → **Rules**, and `scripts/tailwind-raw-text.test.ts` in full:
 * Tailwind reads this file as RAW TEXT and does not know what a test fixture
 * is. Every class spelled here becomes a real CSS rule in every app built on
 * this template. This form is not one of the two families that take the app
 * down, but a fixture whose whole job is to be the class NOBODY may write has
 * no business shipping as a rule — so it is put together at run time and
 * `it("the shorthand fixture is really the form")` is what proves the assembled
 * string is the thing the rule is about.
 */
const shadowVar = (name: string) => `shadow-${"("}${name}${")"}`;

describe("findDialBypasses", () => {
  it("finds an arbitrary font", () => {
    const hits = findDialBypasses(`<h1 className="font-['Playfair_Display']">`);
    expect(hits).toEqual([
      { line: 1, found: "font-['Playfair_Display']", dial: "type" },
    ]);
  });

  it("finds an arbitrary shadow", () => {
    const hits = findDialBypasses(
      `<div className="shadow-[0_2px_8px_rgba(0,0,0,.3)]">`,
    );
    expect(hits[0]).toMatchObject({ dial: "elevation" });
  });

  it("finds every bare shadow size, 2xs to 2xl", () => {
    for (const size of ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"]) {
      const hits = findDialBypasses(`<div className="rounded-lg shadow-${size}">`);
      expect(hits, size).toHaveLength(1);
      expect(hits[0]).toMatchObject({ found: `shadow-${size}`, dial: "elevation" });
    }
  });

  it("finds a hex inside an arbitrary value", () => {
    expect(findDialBypasses('className="bg-[#abc]"')[0]).toMatchObject({
      found: "bg-[#abc]",
      dial: "accent",
    });
    expect(findDialBypasses('className="text-[#0f172a]"')).toHaveLength(1);
    expect(findDialBypasses('className="border-[#fff8]"')).toHaveLength(1);
  });

  it("finds one behind a variant", () => {
    // `dark:` and `md:` sit in front of the utility; the lookbehind has to let
    // a `:` through or every responsive class would be invisible to this.
    expect(findDialBypasses('className="dark:shadow-lg md:bg-[#abc]"')).toHaveLength(2);
  });

  it("🚨 finds font-heading, which the theme key generates and nobody may write", () => {
    // A `--font-*` entry in `@theme inline` ALWAYS produces the matching
    // utility, so Story 43.2's variable produces this class. There is no naming
    // that avoids it — the answer is to report it, not to sanction it.
    expect(findDialBypasses('<h2 className="font-heading">')[0]).toMatchObject({
      found: "font-heading",
      dial: "type",
    });
  });

  it("does not flag font-sans or font-mono — both name a role", () => {
    // `font-mono` is a perfectly normal thing to write on a page (a code span),
    // and neither is the value of a dial.
    expect(findDialBypasses('<code className="font-mono text-sm">')).toEqual([]);
    expect(findDialBypasses('<body className="font-sans">')).toEqual([]);
  });

  it("does not flag shadow-none — it sets no value, so it turns no dial", () => {
    expect(findDialBypasses('<Card className="shadow-none border-0">')).toEqual([]);
  });

  it("does not flag an inset shadow, which app/globals.css maps nowhere", () => {
    // A different property and not this dial. The lookbehind is what keeps it
    // out — without it, `inset-shadow-sm` reads as `shadow-sm`.
    expect(findDialBypasses('className="inset-shadow-sm"')).toEqual([]);
  });

  it("the shorthand fixture is really the form — the needle's own probe", () => {
    // A guard whose probe cannot fire reports success. Every assertion below
    // rests on this helper producing the shorthand and not something adjacent
    // to it, and the helper is the one thing here that is assembled rather than
    // read, so it is checked against its own shape once.
    expect(shadowVar("--x")).toBe(["shadow-", "(", "--x", ")"].join(""));
    expect(shadowVar("--x")).toMatch(/^shadow-\(--[a-z-]+\)$/);
  });

  it("🚨 finds a variable that is not one of the two elevation roles", () => {
    // The form Story 43.3 named and 43.4 named again, neither closed: the same
    // syntax as the sanctioned answer, pointing at a slot the design system
    // does not have. §8 calls it a fifth elevation step arriving as a tweak.
    const hits = findDialBypasses(`<div className="${shadowVar("--my-own-shadow")}">`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      found: shadowVar("--my-own-shadow"),
      dial: "elevation",
    });
  });

  it("🚨 does not flag the two sanctioned role names, which is the other half", () => {
    // A rule that reported these would report six lines of the shipped tree and
    // contradict the recipe `docs/design-system.md` §8 gives for answering a
    // `shadow-lg` finding. Both real: `app/login/ui.tsx` and `app/page.tsx`.
    expect(findDialBypasses(`<Card className="${shadowVar("--elevation-overlay")}">`)).toEqual([]);
    expect(findDialBypasses(`<Card className="${shadowVar("--elevation-raised")}">`)).toEqual([]);
    expect(
      findDialBypasses(
        `<Card className="bg-background gap-0 overflow-hidden p-0 ${shadowVar("--elevation-overlay")}">`,
      ),
    ).toEqual([]);
  });

  it("flags a name that only STARTS like a sanctioned one", () => {
    // The exception is the two names, not a prefix of them — otherwise the way
    // past the rule is to append a letter.
    expect(findDialBypasses(shadowVar("--elevation-raised-more"))).toHaveLength(1);
    expect(findDialBypasses(shadowVar("--elevation"))).toHaveLength(1);
  });

  it("flags the hinted colour form, which names neither role", () => {
    // Tailwind's `type:` hint. `shadow-(color:--x)` sets a shadow COLOUR from a
    // variable holding a whole shadow — not one of the two sanctioned
    // spellings, and not a thing this design system has a slot for.
    expect(findDialBypasses(shadowVar("color:--elevation-overlay"))).toHaveLength(1);
    expect(findDialBypasses(shadowVar("color:--brand-glow"))[0]).toMatchObject({
      dial: "elevation",
    });
  });

  it("does not flag the shorthand on an inset, drop or text shadow", () => {
    // Same lookbehind, same reason as the size words: a different property,
    // mapped nowhere in app/globals.css, so not this dial.
    for (const prefix of ["inset-", "drop-", "text-"]) {
      expect(findDialBypasses(`${prefix}${shadowVar("--x")}`), prefix).toEqual([]);
    }
  });

  it("does not flag a parenthesised class that carries no custom property", () => {
    // The shorthand accepts nothing but a `--` name, so Tailwind emits no rule
    // for these at all (measured in scripts/tailwind-raw-text.test.ts). They are
    // typos, and reporting a typo as an elevation bypass is how a checker that
    // tells people their page is wrong stops being read.
    expect(findDialBypasses(shadowVar("x"))).toEqual([]);
    expect(findDialBypasses(shadowVar(""))).toEqual([]);
  });

  it("finds the shorthand behind a variant too", () => {
    expect(findDialBypasses(`className="dark:${shadowVar("--my-own-shadow")}"`)).toHaveLength(1);
  });

  it("does not flag a token class or an arbitrary value with no hex in it", () => {
    // Real lines out of this template: the launcher's width, and the tokens
    // every page is told to use.
    expect(
      findDialBypasses(
        '<div className="bg-card text-card-foreground w-[min(24rem,calc(100vw-2rem))] rounded-lg border">',
      ),
    ).toEqual([]);
  });

  it("🚨 does not flag a hex inside style={{ … }}", () => {
    // app/opengraph-image.tsx renders through satori with inline styles and
    // knows nothing of classes. The patterns are anchored on the arbitrary-value
    // BRACKET, never on a bare `#rrggbb` anywhere in the text, so this cannot
    // match by construction rather than by exclusion.
    const source = `
      <div style={{ background: "#0b1220", color: "#f8fafc", padding: 80 }}>
        <div style={{ fontSize: 76, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }} />
      </div>`;
    expect(findDialBypasses(source)).toEqual([]);
  });

  it("finds no bypass inside a comment, and still finds the real one", () => {
    // The rule every source-reading checker here obeys: blank the comments, or
    // report the file that DOCUMENTS a rule as breaking it. Blanked rather than
    // removed, so the line number of the real hit survives.
    const source = [
      "// Never write shadow-lg on a page — turn the elevation dial instead.",
      "/* font-['Playfair'] is what this rule exists to catch. */",
      'export const Panel = () => <div className="shadow-lg" />;',
    ].join("\n");
    const hits = findDialBypasses(source);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 3, found: "shadow-lg" });
  });

  it("counts one hit per match per line", () => {
    // Two bypasses on one line are two hits — the count in the header line is
    // a count of BYPASSES, not of files or of lines.
    expect(
      findDialBypasses(`<div className="shadow-lg font-['Playfair'] bg-[#abc]">`),
    ).toHaveLength(3);
  });

  it("🚨 finds the extra value written past a legal one", () => {
    // The command's title claim: a class string that already contains a legal
    // token class gains one more that turns nothing, and that extra one is what
    // gets counted.
    const hits = findDialBypasses('cn("rounded-lg border", "shadow-lg")');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ found: "shadow-lg", dial: "elevation" });
  });
});

describe("🚨 DIAL_BYPASSES — the needle", () => {
  // `scripts/lib/source-text.test.ts` says why this block exists, in one
  // sentence: "a guard whose probe cannot fire is worse than no guard: it
  // reports success". A table-driven test over a table an edit quietly emptied
  // passes over nothing at all and is green.
  const SAMPLES: Record<string, string> = {
    fontArbitrary: `<h1 className="font-[--brand-face]">`,
    shadowArbitrary: `<div className="shadow-[0_2px_8px_#000]">`,
    shadowSize: `<div className="rounded-lg border shadow-lg">`,
    // Assembled — see `shadowVar` above for why this one alone is not written.
    shadowVariable: `<div className="${shadowVar("--my-own-shadow")}">`,
    hexArbitrary: `<span className="text-[#0f172a]">`,
    fontHeading: `<h2 className="font-heading tracking-tight">`,
  };

  it.each(DIAL_BYPASSES)("$id fires and names the $dial dial", (bypass) => {
    const sample = SAMPLES[bypass.id];
    expect(sample, `no sample for ${bypass.id}`).toBeDefined();
    const hits = findDialBypasses(sample);
    expect(hits.length, `${bypass.id} found nothing in ${sample}`).toBeGreaterThan(0);
    expect(hits.map((h) => h.dial)).toContain(bypass.dial);
  });

  it("🚨 has an entry for every form, and that is what this pin catches", () => {
    // A form silently dropped from the list is precisely the failure this
    // number exists for: the `it.each` above would then run over five entries,
    // pass, and say nothing about the sixth. The pin is not a style rule about
    // list length — it is the only assertion that notices a shrinking table.
    //
    // Adding a SEVENTH form is a deliberate act: raise this number, add its
    // sample above, and say in docs/design-system.md §7 what it settles.
    //
    // The sixth arrived that way and is worth reading as the worked example:
    // `shadow-(--anything)` stood named-but-open in §8 across two stories, and
    // this pin is what made closing it a decision somebody took rather than a
    // pattern that slipped into the list unremarked.
    expect(DIAL_BYPASSES).toHaveLength(6);
    expect(Object.keys(SAMPLES)).toHaveLength(6);
    expect(DIAL_BYPASSES.map((b) => b.id).sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it("every entry carries a dial and a reason", () => {
    for (const bypass of DIAL_BYPASSES) {
      expect(["accent", "type", "radius", "elevation"]).toContain(bypass.dial);
      expect(bypass.why.length).toBeGreaterThan(20);
    }
  });
});

describe("findUnpairedTokens", () => {
  const paired = `
:root {
  --background: hsl(0 0% 100%);
  --radius: 0.5rem;
  --elevation-raised: 0 1px 2px 0 hsl(30 15% 12% / 0.06);
}

.dark {
  --background: hsl(240 10% 5%);
  --elevation-raised: 0 1px 2px 0 hsl(0 0% 0% / 0.55);
}
`;

  it("passes the shipped truth: --radius in :root only is on the list", () => {
    // Measured on the real app/globals.css after Story 43.1: 34 keys in :root,
    // 33 in .dark, and the single difference is `radius`.
    expect(findUnpairedTokens(paired)).toEqual([]);
  });

  it("finds a token that landed in :root and not in .dark", () => {
    // The classic mistake Story 43.1's two tokens are exposed to, and it fails
    // in the mode nobody was looking at.
    const css = paired.replace(
      "  --elevation-raised: 0 1px 2px 0 hsl(0 0% 0% / 0.55);\n",
      "",
    );
    const hits = findUnpairedTokens(css);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "unpaired",
      token: "elevation-raised",
      presentIn: ":root",
      missingFrom: ".dark",
    });
  });

  it("finds the reverse too — a token only in .dark", () => {
    const css = paired.replace("  --background: hsl(0 0% 100%);\n", "");
    expect(findUnpairedTokens(css)).toEqual([
      expect.objectContaining({
        token: "background",
        presentIn: ".dark",
        missingFrom: ":root",
      }),
    ]);
  });

  it("reports the line the token is actually on", () => {
    const css = paired.replace(
      "  --elevation-raised: 0 1px 2px 0 hsl(0 0% 0% / 0.55);\n",
      "",
    );
    const line = css.split("\n").findIndex((l) => l.includes("--elevation-raised")) + 1;
    expect(findUnpairedTokens(css)[0].line).toBe(line);
  });

  it("🚨 an empty block is a finding of its own, never an empty result", () => {
    // `parseTokens` returns {} for a block it cannot find, so without this the
    // most broken file in the world would come back with no findings — "nothing
    // found" and "nothing looked at" wearing the same colour.
    const noDark = ":root {\n  --background: hsl(0 0% 100%);\n}\n";
    expect(findUnpairedTokens(noDark)).toEqual([
      expect.objectContaining({ kind: "emptyBlock", missingFrom: ".dark" }),
    ]);

    const nothing = "body { color: red; }";
    const hits = findUnpairedTokens(nothing);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.kind === "emptyBlock")).toBe(true);
  });

  it("names an empty block once rather than listing every token of the other", () => {
    // The fact is that the block is gone. Thirty-three "unpaired" rows would
    // bury it under its own consequences.
    const noRoot = ".dark {\n  --a: 1;\n  --b: 2;\n  --c: 3;\n}\n";
    expect(findUnpairedTokens(noRoot)).toHaveLength(1);
  });

  it("MODE_SINGLE_TOKENS is a set with reasons, never a count", () => {
    // Nothing here asserts how many entries there are: a shrinking exception
    // list is good news, and an entry that stops matching anything is fine.
    // What IS asserted is that every entry carries prose — an id with no reason
    // reads as an arbitrary exemption to whoever finds it next.
    for (const [token, entry] of Object.entries(MODE_SINGLE_TOKENS)) {
      expect(token).toMatch(/^[a-z0-9-]+$/);
      expect(entry.why.length).toBeGreaterThan(30);
      // 🚨 And the BLOCK it belongs in. An exception without a direction
      // excuses the token in both, which is how `--radius` could vanish from
      // the tree entirely under a green tick.
      expect([":root", ".dark"]).toContain(entry.in);
    }
    expect(MODE_SINGLE_TOKENS.radius).toBeDefined();
  });

  it("🚨 an excepted token is excused in ONE direction, never in both", () => {
    // Measured 2026-08-15, before the exception carried a direction: `--radius`
    // only in `.dark` reported nothing, and `--radius` deleted outright
    // reported nothing — while the line said every token was defined in both
    // modes. Nothing else in the tree asserts that `--radius` exists, so in
    // light mode every `rounded-*` would have lost its corner.
    // `--x` is in BOTH blocks in every case — a paired control, so the only
    // thing any case can report is `--radius`.
    const css = (light: string, dark: string) =>
      `:root {\n  --x: 1;\n${light}\n}\n.dark {\n  --x: 1;\n${dark}\n}\n`;

    // Where it belongs: excused.
    expect(findUnpairedTokens(css("  --radius: 0.5rem;", ""))).toEqual([]);
    // In the WRONG block: a finding, and it names the token.
    const wrong = findUnpairedTokens(css("", "  --radius: 0.5rem;"));
    expect(wrong.map((f) => f.token)).toEqual(["radius"]);
    // Gone from both: nothing to pair, so this rule says nothing — which is why
    // the case above is the one that matters. Stated so the gap is on record.
    expect(findUnpairedTokens(css("", ""))).toEqual([]);
  });
});

describe("findRawElements", () => {
  it("flags a hand-built button, select, textarea and table", () => {
    const kinds = findRawElements(
      '<button className="rounded">x</button><select /><textarea /><table />',
    );
    expect(kinds).toHaveLength(4);
    expect(kinds.every((h) => h.kind === "hard")).toBe(true);
  });

  it("flags a text input", () => {
    const hits = findRawElements('<input name="email" />');
    expect(hits).toEqual([
      { line: 1, found: '<input type="text">', kind: "hard" },
    ]);
  });

  it('ignores <input type="hidden">', () => {
    // Not an interface element at all — it carries form data and nobody sees
    // it. Eight of these ship in this template; flagging them would have made
    // the command red on a fresh clone, which is how a check dies.
    expect(
      findRawElements('<input type="hidden" name="memberId" value={id} />'),
    ).toEqual([]);
  });

  it("ignores a hidden input written across several lines", () => {
    expect(
      findRawElements(
        '<input\n  type="hidden"\n  name="granted"\n  value={"true"}\n/>',
      ),
    ).toEqual([]);
  });

  it("ignores a raw element under a Radix asChild slot", () => {
    // asChild MERGES the two: the menu item becomes the button. Wrapping a
    // <Button> in there would nest two of everything. components/app-shell.tsx
    // does exactly this for the sign-out item.
    const source =
      '<DropdownMenuItem asChild variant="destructive">\n' +
      '  <button type="submit" className="w-full">\n' +
      "    {t('signOut')}\n" +
      "  </button>\n" +
      "</DropdownMenuItem>";
    expect(findRawElements(source)).toEqual([]);
  });

  it("softens a checkbox, a radio and a segmented control", () => {
    // Reported so they stay visible, never failed. The kit ships <Checkbox>,
    // <RadioGroup> and <Switch> for client forms, but a Radix control cannot
    // reach FormData without JavaScript — app/plans/page.tsx keeps a native
    // checkbox for exactly that reason — and there is no <ToggleGroup> at all.
    // The bucket text in rules.mjs carries the full reasoning.
    const checkbox = findRawElements('<input type="checkbox" name="autoReload" />');
    expect(checkbox[0]).toMatchObject({ kind: "soft" });

    const segment = findRawElements(
      '<button type="button" role="radio" aria-checked={active}>',
    );
    expect(segment[0]).toMatchObject({
      kind: "soft",
      found: '<button role="radio">',
    });
  });

  it('does not soften role="button" — that is just a button', () => {
    expect(
      findRawElements('<button role="button" className="p-2">')[0],
    ).toMatchObject({ kind: "hard" });
  });
});

describe("findUnnamedIconButtons", () => {
  it("flags an icon button with nothing but a picture in it", () => {
    const source = '<Button size="icon" variant="ghost">\n  <Menu />\n</Button>';
    expect(findUnnamedIconButtons(source)).toHaveLength(1);
  });

  it("accepts an aria-label", () => {
    expect(
      findUnnamedIconButtons(
        '<Button size="icon" aria-label={t("openMenu")}>\n  <Menu />\n</Button>',
      ),
    ).toEqual([]);
  });

  it("accepts an sr-only span beside the icon", () => {
    expect(
      findUnnamedIconButtons(
        '<Button size="icon">\n  <Menu />\n  <span className="sr-only">Menu</span>\n</Button>',
      ),
    ).toEqual([]);
  });

  it("leaves buttons that carry text alone", () => {
    // Only `size="icon"` is at issue. A button with a label names itself.
    expect(findUnnamedIconButtons("<Button>\n  <Save />\n  Save\n</Button>")).toEqual(
      [],
    );
  });
});

describe("findImagesWithoutAlt", () => {
  it("flags an image with no alt", () => {
    expect(findImagesWithoutAlt('<Image src="/logo.png" width={40} />')).toHaveLength(
      1,
    );
  });

  it('accepts alt="" — decoration is a decision', () => {
    expect(findImagesWithoutAlt('<img src="/line.svg" alt="" />')).toEqual([]);
  });

  it("accepts a real alt", () => {
    expect(findImagesWithoutAlt('<Image src="/a.png" alt={t("chart")} />')).toEqual(
      [],
    );
  });
});

describe("findPlaceholderHome", () => {
  it("flags the shipped page by its keys AND its icon trio", () => {
    // Both markers as they stand in the shipped app/page.tsx.
    const source = `
import { KeyRound, ShoppingCart, Sparkles, ArrowRight } from "lucide-react";
const features = [
  { icon: KeyRound, title: "features.authTitle", body: "features.authBody" },
] as const;`;
    expect(findPlaceholderHome(source)).toHaveLength(2);
  });

  it("still flags a re-texted placeholder — the keys survive a text swap", () => {
    // The field case: messages/*.json rewritten, the page untouched. The
    // shipped KEY is still referenced even though the sentences are new.
    const source = `const features = [{ title: "features.authTitle" }];`;
    expect(findPlaceholderHome(source)).toHaveLength(1);
  });

  it("accepts a page that was genuinely replaced", () => {
    const source = `
import { ArrowRight, Check } from "lucide-react";
<h1>{t("hero.title")}</h1>`;
    expect(findPlaceholderHome(source)).toEqual([]);
  });

  it("does not flag one shipped icon on its own", () => {
    // Sparkles is a perfectly normal icon for a real page — only the shipped
    // trio in one import reads as the placeholder.
    const source = `import { Sparkles } from "lucide-react";`;
    expect(findPlaceholderHome(source)).toEqual([]);
  });

  it("🚨 the SHIPPED page is still caught — and by how many markers", (ctx) => {
    // Every case above is a synthetic fixture, so all four would stay green on
    // a tree where this rule catches nothing at all. Measured 2026-08-15: Story
    // 43.9 rewrote `app/page.tsx` and the icon trio is gone, so the redundancy
    // the docstring used to promise does not exist — ONE marker carries this,
    // and renaming one string key silences `ux-check`, `salespage` step 0,
    // `coach` and `go-live` together. The number is asserted rather than
    // described so that the day it changes, this line says so.
    //
    // 🚨 **And it only holds while the page IS the placeholder.** This test
    // ships inside the customer's app, and `salespage` — which this template
    // recommends, step 2.4 of the path — REPLACES `app/page.tsx`. Reported from
    // the field 2026-08-16 and reproduced here: one red test out of 7 700-odd,
    // in an app whose only fault was following the instructions. Five of these
    // have been healed between 0.27.0 and 0.33.0 (brand-mark, payment-event,
    // content-tools, content/check) and this is the first whose premise was
    // *the customer has not done the recommended step*.
    //
    // So the precondition is asked FIRST, and it is asked INDEPENDENTLY of the
    // rule under test: the three `features.*Title` keys the shipped page
    // carries, matched as raw strings, where `findPlaceholderHome()` knows
    // exactly one of them and finds it with a regex of its own. A broken rule
    // therefore cannot talk this test into skipping — the strings are still
    // there and the assertion still runs. Comments are blanked on both sides so
    // that a page EXPLAINING the marker is not mistaken for one carrying it.
    const page = blankComments(readFileSync(join(ROOT, "app", "page.tsx"), "utf8"));
    const shipped = SHIPPED_HOME_KEYS.filter((key) => page.includes(key));
    if (shipped.length === 0) {
      return notChecked(
        ctx,
        "app/page.tsx is no longer the shipped placeholder — none of " +
          `${SHIPPED_HOME_KEYS.join(", ")} is in it. That is what the skill ` +
          "`salespage` does, so there is no placeholder left for this rule to " +
          "catch. The rule itself is measured by the four fixtures above",
      );
    }
    const hits = findPlaceholderHome(page);
    expect(
      hits.length,
      `app/page.tsx still carries ${shipped.join(", ")} — so it is still the ` +
        "shipped placeholder — and this rule no longer catches it. Either the " +
        "rule broke, or somebody renamed `features.authTitle` alone, which " +
        "silences `ux-check`, `salespage` step 0, `coach` and `go-live` together",
    ).toBe(1);
  });
});

describe("🚨 a file that EXPLAINS an element is not using it", () => {
  // Measured on `modules/community/components/pager.tsx`: its header argues at
  // length that a disabled step "renders as a plain disabled `<button>`" rather
  // than a link — and the file uses `<Button>` from the kit throughout.
  // `ux-check` reported two raw `<button>` elements, at the two COMMENT lines,
  // and exited non-zero. A confident false finding in the one check whose whole
  // job is telling somebody their page is wrong; the fix somebody would then
  // make is to delete the explanation.
  const explained = `
// One rendered a real <button disabled>, one an <a aria-disabled>.
/* It renders as a plain disabled <button>, which no input method follows. */
export function Pager() {
  return <Button variant="outline">Next</Button>;
}`;

  it("finds no raw element inside a comment", () => {
    expect(findRawElements(explained)).toEqual([]);
  });

  it("still finds the real one on the right line", () => {
    // Blanked rather than removed, because a finding carries a LINE NUMBER —
    // dropping the characters would shift every position after the comment.
    const mixed = `${explained}\nexport const Bad = () => <button>go</button>;`;
    const hits = findRawElements(mixed);
    expect(hits).toHaveLength(1);
    expect(hits[0].found).toBe("<button>");
    expect(hits[0].line).toBe(mixed.split("\n").findIndex((l) => l.includes("Bad")) + 1);
  });

  it("does not take a URL for a comment", () => {
    // `//` after a colon is `https://`, and blanking it would hide whatever
    // followed on that line.
    const source = `const a = <a href="https://x.test"><button>go</button></a>;`;
    expect(findRawElements(source).map((h) => h.found)).toContain("<button>");
  });
});

describe("navHrefs", () => {
  it("reads the hrefs out of NAVIGATION", () => {
    const source = `
const OTHER = [{ href: "/nope" }];
export const NAVIGATION: NavItem[] = [
  { href: "/dashboard", labelKey: "overview", icon: LayoutDashboard },
  { href: "/dashboard/account", labelKey: "account", icon: CircleUser },
];`;
    // "/nope" sits BEFORE the list and must not be counted — otherwise an
    // unrelated array above it would silently excuse a page from the menu.
    expect(navHrefs(source)).toEqual(["/dashboard", "/dashboard/account"]);
  });

  it("returns null when there is no NAVIGATION to read", () => {
    // null means "cannot tell", which the caller reports as a warning. An
    // empty array would mean "no page is in the menu" and fail every page.
    expect(navHrefs("export const FOO = [];")).toBeNull();
  });

  it("🚨 reads a MODULE's menu too, which is a property and not a const", () => {
    // A module default-exports a `ModuleNav` object, so its menu can only be
    // `NAVIGATION:` — it cannot be a top-level const. `lib/modules/nav.ts` has
    // claimed since the first module that this reader finds it "by that name",
    // and until the community moved nothing kept the claim: `ux-check` read
    // `components/app-shell.tsx` and nothing else, and its page walk missed the
    // module's pages in the same breath. Two errors cancelling into green.
    const source = `
import { MessagesSquare } from "lucide-react";
const nav: ModuleNav = {
  id: "community",
  NAVIGATION: [
    { href: "/dashboard/community", labelKey: "community", icon: MessagesSquare },
    { href: "/dashboard/admin/community", labelKey: "communityAdmin", icon: MessagesSquare },
  ],
  features: ["community", "communityAdmin"],
};
export default nav;`;
    expect(navHrefs(source)).toEqual(["/dashboard/community", "/dashboard/admin/community"]);
  });

  it("does not take a COMMENT mentioning NAVIGATION for the menu", () => {
    // The declaration is matched, not the bare word — otherwise the header of
    // `components/app-shell.tsx`, which explains NAVIGATION at length, would
    // become the start of the list and drag in every href written above it.
    const source = `
// Everything about NAVIGATION: read this first.
const OTHER = [{ href: "/nope" }];
export const NAVIGATION = [{ href: "/dashboard" }];`;
    expect(navHrefs(source)).toEqual(["/dashboard"]);
  });
});

describe("routeShape", () => {
  // 🚨 Both sides of the navigation check go through this, and that is the
  // whole design: a route on disk spells its parameter `[groupId]`, the link
  // that leads there spells it `${encodeURIComponent(group.id)}`. Normalising
  // one side only reports every dynamic route in the app as unreachable.
  it("leaves a static path exactly as it is", () => {
    expect(routeShape("/dashboard/account")).toBe("/dashboard/account");
    expect(routeShape("/")).toBe("/");
  });

  it("makes a route file's parameter and a link's interpolation the same string", () => {
    const route = routeShape("/dashboard/community/groups/[groupId]");
    const link = routeShape("/dashboard/community/groups/${encodeURIComponent(group.id)}");
    expect(route).toBe(link);
    expect(route).toBe("/dashboard/community/groups/[param]");
  });

  it("normalises EVERY dynamic segment, not the first", () => {
    expect(routeShape("/a/[x]/b/[y]")).toBe("/a/[param]/b/[param]");
    expect(routeShape("/a/${p}/b/${q}")).toBe("/a/[param]/b/[param]");
  });

  it("knows the catch-all spellings a route file may use", () => {
    expect(routeShape("/a/[...slug]")).toBe("/a/[param]");
    expect(routeShape("/a/[[...slug]]")).toBe("/a/[param]");
  });

  it("drops the query, which is not part of the route", () => {
    expect(routeShape("/a/${id}?page=${n}")).toBe("/a/[param]");
    expect(routeShape("/a/b#anchor")).toBe("/a/b");
  });

  // 🚨 The counter-test, and the one that earns the brace counting: a segment
  // is a parameter WHOLE or not at all. Matching a partial one would let
  // `/a/pre-${x}` count as a link to `/a/[x]`, and then a real orphan hides
  // behind a link that never leads to it.
  it("does not take a partly dynamic segment for a parameter", () => {
    expect(routeShape("/a/pre-${x}")).toBe("/a/pre-${x}");
    expect(routeShape("/a/${x}-${y}")).toBe("/a/${x}-${y}");
    expect(routeShape("/a/${x}suffix")).toBe("/a/${x}suffix");
    expect(routeShape("/a/x[y]")).toBe("/a/x[y]");
  });

  it("survives the nested braces every link in this tree actually has", () => {
    // `${encodeURIComponent(x)}` closes a brace before its own end — a lazy
    // match would stop there and read the rest as literal text.
    expect(routeShape("/a/${encodeURIComponent(row.id)}")).toBe("/a/[param]");
    expect(routeShape("/a/${x ? `${y}` : z}")).toBe("/a/[param]");
  });

  // 🚨 Both of these broke the first version of this function, which cut the
  // query with `split(/[?#]/)` and then split on every `/`. An interpolation may
  // legitimately contain either character, and the shortcut tore the expression
  // in half and left a fragment that matches nothing — a link that exists and is
  // not seen, which is exactly the class of defect this whole rule is for.
  it("does not let a `?` INSIDE an interpolation end the path", () => {
    expect(routeShape("/a/${a ? b : c}")).toBe("/a/[param]");
    expect(routeShape("/a/${a ? b : c}?page=2")).toBe("/a/[param]");
  });

  it("does not let a `/` INSIDE an interpolation start a new segment", () => {
    expect(routeShape('/a/${cond ? "b/c" : "d"}')).toBe("/a/[param]");
  });

  it("answers for a non-string rather than throwing", () => {
    // It is fed whatever a regex captured; a check that crashes on one file
    // measures nothing about the rest.
    expect(routeShape(undefined as unknown as string)).toBe("");
  });
});

describe("partitionAcceptedControls", () => {
  const entries = {
    "components/theme-toggle.tsx": {
      found: '<button role="radio">',
      reason: "a segmented control, and the kit has no ToggleGroup",
    },
  };

  it("accepts a listed place with the listed element", () => {
    const { open, accepted } = partitionAcceptedControls(
      [{ file: "components/theme-toggle.tsx", line: 45, found: '<button role="radio">', kind: "soft" }],
      entries,
    );
    expect(open).toEqual([]);
    expect(accepted).toHaveLength(1);
  });

  // 🚨 Keyed on the ELEMENT as well as the file. A second, different hand-built
  // control in an accepted file is a new finding — otherwise one judgement
  // exempts a whole file for ever, which is how a real one hides.
  it("reports a different element in a listed file", () => {
    const { open, accepted } = partitionAcceptedControls(
      [{ file: "components/theme-toggle.tsx", line: 90, found: '<input type="checkbox">', kind: "soft" }],
      entries,
    );
    expect(open).toHaveLength(1);
    expect(accepted).toEqual([]);
  });

  it("reports an unlisted file", () => {
    const { open } = partitionAcceptedControls(
      [{ file: "app/somewhere/new.tsx", line: 1, found: '<input type="checkbox">', kind: "soft" }],
      entries,
    );
    expect(open).toHaveLength(1);
  });

  // The direction that must never invert: `hard` is not acceptable at all.
  it("🚨 never accepts a hard finding, even in a listed file", () => {
    const { open, accepted } = partitionAcceptedControls(
      [{ file: "components/theme-toggle.tsx", line: 45, found: '<button role="radio">', kind: "hard" }],
      entries,
    );
    expect(open).toHaveLength(1);
    expect(accepted).toEqual([]);
  });

  it("takes an empty list and a missing list without complaint", () => {
    expect(partitionAcceptedControls([], {})).toEqual({ open: [], accepted: [] });
    expect(partitionAcceptedControls(undefined as never, {})).toEqual({ open: [], accepted: [] });
  });

  // ⚠️ NOT a count. `scripts/security/accepted.mjs` and MODE_SINGLE_TOKENS both
  // argue this in their own heads: a test that asserted "there are four" goes
  // green on the day a fifth, wrong one is added, and an entry that stops
  // matching is good news. What is asserted is the SHAPE — an entry without
  // prose reads as an arbitrary exemption to whoever finds it next.
  it("ships entries that each carry an element and a reason, never `true`", () => {
    for (const [file, entry] of Object.entries(RAW_ELEMENT_EXCEPTIONS)) {
      expect(typeof entry.found, file).toBe("string");
      expect(entry.found.length, file).toBeGreaterThan(0);
      expect(entry.reason.length, `${file} has no reason`).toBeGreaterThan(80);
    }
  });
});

describe("routeShape and the App Router's non-URL segments", () => {
  // 🚨 These made the change WORSE before they made it better. A grouped route
  // used to be skipped for containing a `[`, so nobody noticed; compared
  // without this filter, every page under a route group becomes a confident
  // false finding — and route groups are the ordinary way to divide a dashboard.
  it("drops a route group, which is not in the URL", () => {
    expect(routeShape("/dashboard/(marketing)/reports/[id]")).toBe(
      routeShape("/dashboard/reports/${id}"),
    );
    expect(routeShape("/dashboard/(marketing)/reports/[id]")).toBe("/dashboard/reports/[param]");
  });

  it("drops a parallel route slot", () => {
    expect(routeShape("/dashboard/@modal/photo/[id]")).toBe("/dashboard/photo/[param]");
  });

  it("keeps an ordinary segment that merely contains a bracket or an at-sign", () => {
    // The filter is anchored: a whole segment, never a substring.
    expect(routeShape("/dashboard/e@mail")).toBe("/dashboard/e@mail");
    expect(routeShape("/dashboard/a(b)c")).toBe("/dashboard/a(b)c");
  });
});

describe("findRawElements reads a whole tag, not up to the first `>`", () => {
  // 🚨 Measured 2026-08-13 on `components/theme-toggle.tsx`: adding a `ref`
  // with an arrow function made `ux-check` FAIL — the `>` of `=>` ended the tag
  // for the old `[^>]*>` pattern, `role` fell outside it, and a segmented
  // control was reported as a raw <button> the kit already covers. A wrong
  // verdict, not a missed one, over an attribute that changed nothing.
  it("sees a role that sits behind an arrow function", () => {
    const hits = findRawElements(
      `<button ref={(node) => { keep(node); }} type="button" role="radio">`,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ found: '<button role="radio">', kind: "soft" });
  });

  it("sees an input type behind one too", () => {
    const hits = findRawElements(`<input onChange={(e) => set(e)} type="checkbox" />`);
    expect(hits[0]).toMatchObject({ found: '<input type="checkbox">', kind: "soft" });
  });

  // The counter-test: a `>` inside a STRING must not end the tag either, and a
  // tag that genuinely ends still ends.
  it("is not fooled by a > inside an attribute string, and still stops at the real one", () => {
    const hits = findRawElements(`<button title="a > b" role="radio">x</button>`);
    expect(hits[0]).toMatchObject({ found: '<button role="radio">' });
  });

  it("still reports a plain raw element as hard", () => {
    expect(findRawElements(`<button onClick={() => go()}>Go</button>`)[0]).toMatchObject({
      found: "<button>",
      kind: "hard",
    });
  });
});
