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
} from "./rules.mjs";

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
    // number exists for: the `it.each` above would then run over four entries,
    // pass, and say nothing about the fifth. The pin is not a style rule about
    // list length — it is the only assertion that notices a shrinking table.
    //
    // Adding a SIXTH form is a deliberate act: raise this number, add its
    // sample above, and say in docs/design-system.md §7 what it settles.
    expect(DIAL_BYPASSES).toHaveLength(5);
    expect(Object.keys(SAMPLES)).toHaveLength(5);
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
    for (const [token, reason] of Object.entries(MODE_SINGLE_TOKENS)) {
      expect(token).toMatch(/^[a-z0-9-]+$/);
      expect(reason.length).toBeGreaterThan(30);
    }
    expect(MODE_SINGLE_TOKENS.radius).toBeDefined();
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
