// The measurable half of docs/ux.md, as pure functions.
//
// Separate from check.mjs for the reason every rules file in this project is
// separate from its shell (lib/entitlements/rules.ts says it at length): a rule
// that lives inside the script that prints it is a rule nothing asserts. These
// take a string and return findings — no filesystem, no console, no exit code —
// so scripts/ux/rules.test.ts can put a bad line in and check that it is found,
// which is the only way anybody ever learns that a check still works.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows.

// ── The rules, as data ───────────────────────────────────────────────────────

// One implementation, in scripts/lib/source-text.mjs — sixteen local copies had
// drifted into four behaviours, and three of them let a `//` comment containing
// `/*` swallow every line down to the next `*/`. This file was one of the three,
// and it is the one that ships: `node run.mjs ux-check` in the customer's app.
import { blankComments } from "../lib/source-text.mjs";
/**
 * Text on a surface, measured against WCAG 2.1 AA (4.5:1 for normal text).
 *
 * `[foreground token, background token]`. Two things in here are not obvious
 * and are why the list is written out rather than derived from the
 * `-foreground` suffix:
 *
 *   - `muted-foreground` is never used on `muted`. It is the quiet text on a
 *     page or in a card, so it is measured against those two. Pairing it with
 *     `muted` would measure a combination nothing renders.
 *   - `primary` appears as TEXT as well as a surface — the active menu item, a
 *     link. app/globals.css says so in its own header, and it is the half of a
 *     recolour that people forget: a brand colour light enough to look good as
 *     a button can be unreadable as a word.
 */
export const TEXT_PAIRS = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["primary", "background"],
  ["primary", "card"],
  ["info-foreground", "info"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
  ["danger-foreground", "danger"],
];

/**
 * The focus ring, measured at 3:1 (WCAG 1.4.11, non-text contrast).
 *
 * Only the ring. An input border at 3:1 is also the letter of 1.4.11 and this
 * template does not meet it — that is a judgement written down in docs/ux.md
 * rather than a number failed here, because a check that is red on a fresh
 * clone is a check everybody learns to ignore. The ring is different: it is the
 * only thing a keyboard user has to find their place with, and `--ring` is one
 * of the three tokens the recolouring instructions tell people to change.
 */
export const RING_PAIRS = [
  ["ring", "background"],
  ["ring", "card"],
];

/** Tailwind's own palettes. A colour from here does not follow into dark mode. */
const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITIES =
  "bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|" +
  "accent|caret|divide|placeholder";

/**
 * Elements the design system already has a component for. Writing one by hand
 * is not a style question: the hand-built version has no focus ring, no dark
 * mode and different spacing two pages later.
 *
 * `input` is handled separately in `findRawElements` — its `type` decides.
 */
const RAW_ELEMENTS = ["button", "select", "textarea", "table"];

// ── Colour maths (WCAG 2.1, relative luminance) ──────────────────────────────

/**
 * `hsl(243 70% 58%)` → `[r, g, b]`, 0–255.
 *
 * Only the space-separated form app/globals.css uses. A comma form or a `#hex`
 * returns null, and the caller reports that as "cannot read" rather than
 * skipping it silently — a token nothing can parse is a token nothing checks.
 */
export function parseHsl(value) {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value.trim());
  if (!m) return null;
  return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
}

/**
 * `h` in 0–360, `s` and `l` in 0–1 → `[r, g, b]`, 0–255.
 *
 * Split out of `parseHsl` for `node run.mjs brand`, which has to try HUNDREDS
 * of candidate lightnesses per mode before it writes a token. It is the same
 * arithmetic either way; the point of sharing it is that the colour the command
 * proposes and the colour `ux-check` later judges can never be computed two
 * different ways.
 */
export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(channel(hue + 1 / 3) * 255),
    Math.round(channel(hue) * 255),
    Math.round(channel(hue - 1 / 3) * 255),
  ];
}

/** `[r, g, b]` → `#rrggbb`. The form a manifest, a mail or an OG card wants. */
export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1–21. Order of the arguments does not matter. */
export function contrastRatio(rgbA, rgbB) {
  const a = relativeLuminance(rgbA);
  const b = relativeLuminance(rgbB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The two token blocks of app/globals.css.
 *
 * Deliberately not a CSS parser: it reads the `:root { … }` and `.dark { … }`
 * blocks and the `--name: value;` lines inside them, which is all this file has
 * ever contained. A block it cannot find comes back empty, and the caller
 * reports that rather than passing.
 *
 * @param {string} css
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function parseTokens(css) {
  /** @type {(selector: string) => Record<string, string>} */
  const block = (selector) => {
    const range = blockRange(css, selector);
    if (!range) return {};
    const body = css.slice(range.start, range.end);
    const out = {};
    for (const m of body.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gim)) {
      out[m[1]] = m[2].trim();
    }
    return out;
  };
  return { light: block(":root"), dark: block(".dark") };
}

/**
 * Where a token block starts and ends in `app/globals.css`.
 *
 * 🚨 Exported so that the READER above and the WRITER (`node run.mjs brand`,
 * which rewrites three token lines in place) can never hold different opinions
 * about where `:root` ends. Without that, a writer with its own idea of the
 * boundary could land a token inside `@theme inline`, where it would be
 * syntactically fine, invisible to `parseTokens`, and wrong.
 *
 * @returns {{ start: number, end: number } | null}
 */
export function blockRange(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  const end = css.indexOf("\n}", start);
  if (end === -1) return null;
  return { start, end };
}

/**
 * Every pair above that mentions `token`, with the minimum it has to clear.
 *
 * 🚨 The anti-drift move for `node run.mjs brand`. That command has to know
 * which ratios an accent must satisfy before it writes one — and the day
 * somebody adds `["primary", "popover"]` to TEXT_PAIRS, it starts enforcing
 * that too, in the same commit, instead of proposing a colour `ux-check` then
 * rejects. A retyped list would have to be remembered; this cannot be.
 *
 * @returns {{ fg: string, bg: string, min: number }[]}
 */
export function pairsTouching(token) {
  return [
    ...TEXT_PAIRS.map(([fg, bg]) => ({ fg, bg, min: 4.5 })),
    ...RING_PAIRS.map(([fg, bg]) => ({ fg, bg, min: 3 })),
  ].filter((pair) => pair.fg === token || pair.bg === token);
}

// ── The source scans ─────────────────────────────────────────────────────────

const lineAt = (source, index) => source.slice(0, index).split(/\r?\n/).length;

/** Every hard-coded colour — the ones that do not follow into dark mode. */
/**
 * Comments, blanked to spaces — same length, same line numbers.
 *
 * 🚨 **Every finder below scans JSX as TEXT, so a file that EXPLAINS an element
 * was reported for using it.** Measured on `modules/community/components/pager.tsx`:
 * its header says, at length, that a disabled step "renders as a plain disabled
 * `<button>`" instead of a link — and the file itself uses `<Button>` throughout.
 * `ux-check` reported two raw `<button>` elements at the two comment lines and
 * exited non-zero. A confident false finding in the one check whose whole job is
 * telling somebody their page is wrong.
 *
 * Blanked rather than removed, because the findings carry LINE NUMBERS: dropping
 * the characters would shift every position after the first comment, and a
 * finding at the wrong line is barely better than no finding.
 *
 * `//` preceded by a colon is not a comment — `href="https://…"` is the case,
 * and blanking it would hide whatever followed on that line.
 */

export function findPaletteClasses(source) {
  source = blankComments(source);
  const patterns = [
    new RegExp(
      `\\b(?:${COLOR_UTILITIES})-(?:${PALETTE})-(?:50|[1-9]00|950)\\b`,
      "g",
    ),
    /\b(?:bg|text|border|ring|fill|stroke|divide|placeholder)-(?:white|black)\b/g,
  ];
  const hits = [];
  source.split(/\r?\n/).forEach((line, i) => {
    for (const pattern of patterns) {
      for (const m of line.matchAll(pattern)) {
        hits.push({ line: i + 1, found: m[0] });
      }
    }
  });
  return hits;
}

// ── The dials, and anything written past one ─────────────────────────────────

/**
 * The six ways a page can write a VALUE where the design system has a dial.
 *
 * docs/design-system.md §8 says the app has a short, closed list of things that
 * are configurable — the accent, the type, the radius, the elevation — and that
 * everything else is composition. That sentence is prose, and prose is not a
 * boundary: this list is what makes it one.
 *
 * The seam is `sourceFiles()` in check.mjs, which already excludes
 * `components/ui/`, so the kit's own `shadow-lg` on a <Dialog> is out of reach
 * by construction and no rule here needs a path. It walks `modules/` too, so a
 * module's component is measured before anybody installs it.
 *
 * `{ id, dial, pattern, why }` — exported as DATA rather than hidden inside the
 * finder, because rules.test.ts drives an `it.each` over it and pins its LENGTH.
 * A table-driven test over a table an edit quietly emptied passes; the pin is
 * what turns that silence into a red run.
 *
 * Three shapes are deliberately NOT in here, each for a reason that is a
 * decision rather than an oversight:
 *
 *   · `style={{ … }}` — app/opengraph-image.tsx renders through satori with
 *     inline styles and knows nothing of classes. Every pattern below is
 *     anchored on a Tailwind CLASS (`utility-[…]`, a size word, a theme key),
 *     so an inline `color: "#0b1220"` cannot match one. That is by construction
 *     and not by exclusion — a confident false finding in the one check whose
 *     job is telling somebody their page is wrong is how the check stops being
 *     read.
 *   · `font-sans` / `font-mono` — both name a ROLE, and `font-mono` is a
 *     legitimate thing to write on a page (a code span). A role is what the
 *     dial turns; naming one is not writing past it.
 *   · `shadow-none` — it sets no value, so it turns no dial. A page taking an
 *     elevation back off something the kit raised is a composition decision,
 *     and §8 does not name it.
 */
export const DIAL_BYPASSES = [
  {
    id: "fontArbitrary",
    dial: "type",
    // `font-['Playfair']`, `font-[--my-var]`. The face is one variable, filled
    // once in app/layout.tsx — a page naming its own is a second type system.
    pattern: /(?<![\w-])font-\[[^\]\s]*\]/g,
    why: "The type dial is --font-app-sans / --font-app-heading, wired in app/layout.tsx.",
  },
  {
    id: "shadowArbitrary",
    dial: "elevation",
    // `shadow-[0_2px_8px_rgba(0,0,0,.3)]` — a depth nobody chose, and one that
    // is near-invisible in dark mode for the reason app/globals.css spells out.
    pattern: /(?<![\w-])shadow-\[[^\]\s]*\]/g,
    why: "The elevation dial is --elevation-raised / --elevation-overlay in app/globals.css.",
  },
  {
    id: "shadowSize",
    dial: "elevation",
    // A bare size word. `@theme inline` maps all seven onto the two elevation
    // tokens, so `shadow-lg` RESOLVES correctly — the objection is that it
    // picks a step out of Tailwind's vocabulary instead of naming the app's
    // role, and there are only two roles. `shadow-(--elevation-overlay)`
    // compiles to the identical declaration and says which one.
    //
    // ⚠️ The lookbehind is what keeps `inset-shadow-sm` out: Tailwind v4's
    // inset shadows are a different property and app/globals.css deliberately
    // maps none of them, so they are not this dial either.
    pattern: /(?<![\w-])shadow-(?:2xs|2xl|xs|sm|md|lg|xl)(?![\w-])/g,
    why: "The elevation dial has two steps, named after the role they play.",
  },
  {
    id: "shadowVariable",
    dial: "elevation",
    // 🚨 The sixth form, and the one this list was OPEN on until Story A65.
    //
    // Tailwind v4's parenthesised custom-property shorthand on the shadow
    // utility. Two spellings of it are the doctrine's own sanctioned answer to
    // a `shadow-lg` finding — the two elevation ROLE names, and nothing else —
    // so those two are the exception written into the pattern and every other
    // variable is reported. `docs/design-system.md` §8 named this opening for
    // two stories and closed neither; the reason it could not stay open is that
    // the sanctioned form and a page inventing its own fifth elevation step are
    // the SAME SHAPE to a reader, and only the variable's name tells them apart.
    //
    // ⚠️ It became a real bypass rather than a theoretical one on the day
    // `lib/utils.ts` grew its `extendTailwindMerge`. Before that, stock
    // tailwind-merge did not know the shorthand at all, so such a class lost to
    // whatever shadow was already there — a silent no-op. Measured after the
    // repair: cn() with a base step and an invented variable now returns the
    // invented one ALONE. The fix that made the sanctioned form work made the
    // unsanctioned one work too, which is precisely why the guard belongs here.
    //
    // The pattern demands a `--` name inside (with or without Tailwind's
    // `type:` hint) rather than accepting any parenthesised text: the shorthand
    // takes nothing else, so a class with anything else in it emits no CSS rule
    // at all, and reporting a typo as an elevation bypass is the kind of
    // confident false finding that gets a checker ignored.
    //
    // The lookbehind carries the same load it carries above — an inset, drop or
    // text shadow is a different property that app/globals.css maps nowhere, so
    // it is not this dial either.
    //
    // 🚨 What this entry does NOT claim: the same shorthand exists for the
    // radius and the colour utilities, and neither is in this list. That is not
    // an oversight — the list has never been "every value past a dial" (a plain
    // arbitrary radius and a non-hex arbitrary colour are both uncaught by
    // design), it is a list of NAMED forms, each carrying the reason it is
    // named. This one is named because the doctrine RECOMMENDS its neighbour.
    pattern: /(?<![\w-])shadow-\((?!--elevation-(?:raised|overlay)\))(?:[a-z-]+:)?--[^()\s]*\)/g,
    why: "The elevation dial has two role names; any other variable is a fifth step nobody chose.",
  },
  {
    id: "hexArbitrary",
    dial: "accent",
    // 🚨 Anchored on the arbitrary-value BRACKET, never on a bare `#rrggbb`
    // anywhere in the text. Every hex in app/opengraph-image.tsx and in
    // lib/email.ts is legal — those two cannot use classes at all — and a rule
    // that read them would be red on a fresh clone for ever.
    pattern: /(?<![\w-])[a-z][a-z0-9-]*-\[#[0-9a-fA-F]{3,8}\]/g,
    why: "A colour written here does not follow into dark mode and survives no recolour.",
  },
  {
    id: "fontHeading",
    dial: "type",
    // 🚨 The utility Story 43.2's `@theme inline` entry generates, and there is
    // no naming that avoids it: a `--font-*` key ALWAYS produces the matching
    // class (`--font-sans` produces `font-sans` today). The heading face's
    // reach is the `h1` rule in `@layer base`, not a class somebody writes — so
    // the class is reported rather than prevented. A sanctioned-looking escape
    // hatch is exactly the loophole this list exists to close.
    pattern: /(?<![\w-])font-heading(?![\w-])/g,
    why: "The heading face reaches h1 through app/globals.css, never through a class.",
  },
];

/**
 * Every value written past a dial, with the dial it bypasses.
 *
 * One hit per match, per line — the same shape `findPaletteClasses` uses, so
 * two bypasses on one line are two hits and the count in check.mjs's header
 * line is a count of BYPASSES rather than of files.
 *
 * @param {string} source
 * @returns {{ line: number, found: string, dial: string }[]}
 */
export function findDialBypasses(source) {
  source = blankComments(source);
  const hits = [];
  source.split(/\r?\n/).forEach((line, i) => {
    for (const bypass of DIAL_BYPASSES) {
      for (const m of line.matchAll(bypass.pattern)) {
        hits.push({ line: i + 1, found: m[0], dial: bypass.dial });
      }
    }
  });
  return hits;
}

/**
 * Tokens that legitimately live in ONE mode block, with the reason each does.
 *
 * A set with reasons, never a count — the argument `scripts/security/accepted.mjs`
 * and `scripts/deps.test.ts` both make about their own sets: a test that
 * asserted "there is one exception" would go green on the day a second, wrong
 * one was added, and an entry that stops matching anything is good news rather
 * than a regression. So nothing anywhere asserts how many entries are here.
 *
 * An id with no reason reads as an arbitrary exemption to whoever finds it
 * next, which is why the value is prose and not `true`.
 */
export const MODE_SINGLE_TOKENS = {
  radius: {
    // 🚨 The BLOCK it legitimately lives in, and the direction is the whole
    // point. Written as a bare string this excused the token in BOTH
    // directions — measured 2026-08-15: `--radius` present only in `.dark`
    // reported nothing, and `--radius` deleted OUTRIGHT reported nothing, while
    // the line said `✓ Every token is defined in both modes … 1 on the
    // exception list`. Nothing else in the tree asserts that `--radius` exists,
    // so in light mode every `rounded-*` would have lost its corner and the
    // shipped checker would have called it clean.
    in: ":root",
    why:
      "A corner does not change with the mode. --radius is a length, not a " +
      "colour, and the dark block has nothing to say about it — repeating it " +
      "there would be a second place to edit the same decision.",
  },
};

/** The line a token's declaration sits on inside one of the two blocks. */
function tokenLine(css, selector, token) {
  const range = blockRange(css, selector);
  if (!range) return 1;
  const body = css.slice(range.start, range.end);
  // Token names come out of parseTokens' own `[a-z0-9-]+`, so there is nothing
  // in one to escape.
  const found = new RegExp(`^\\s*--${token}:`, "m").exec(body);
  return lineAt(css, range.start + (found ? found.index : 0));
}

/**
 * Tokens present in `:root` and absent from `.dark`, or the reverse.
 *
 * The classic mistake is writing one block and forgetting the other, and it
 * fails in the mode nobody was looking at — silently, because a missing token
 * inherits rather than erroring. NFR-69: both blocks, always.
 *
 * 🚨 Read through `parseTokens()` and never a second parser, for the reason
 * `blockRange()`'s own comment gives: a second opinion about where `:root` ends
 * is a second opinion about what a token IS.
 *
 * An EMPTY block is one finding of its own rather than N unpaired tokens — the
 * fact is that the block is gone, and listing thirty-three tokens would bury
 * it. Both empty (an unparseable file) is therefore two findings and never an
 * empty result: "nothing found" and "nothing looked at" must not be the same
 * answer.
 *
 * @param {string} css
 * @returns {{ kind: "unpaired" | "emptyBlock", token: string | null,
 *             presentIn: string | null, missingFrom: string, line: number }[]}
 */
export function findUnpairedTokens(css) {
  const { light, dark } = parseTokens(css);

  const empty = [];
  for (const [selector, set] of [
    [":root", light],
    [".dark", dark],
  ]) {
    if (Object.keys(set).length === 0) {
      empty.push({
        kind: "emptyBlock",
        token: null,
        presentIn: null,
        missingFrom: selector,
        line: blockRange(css, selector) ? lineAt(css, blockRange(css, selector).start) : 1,
      });
    }
  }
  if (empty.length > 0) return empty;

  const findings = [];
  for (const token of [...new Set([...Object.keys(light), ...Object.keys(dark)])].sort()) {
    const inLight = Object.prototype.hasOwnProperty.call(light, token);
    const inDark = Object.prototype.hasOwnProperty.call(dark, token);
    if (inLight && inDark) continue;
    // An excepted token is excused ONLY for being absent from the block it does
    // not belong in. Absent from its OWN block — or absent everywhere, which
    // reaches here as absent from one — is the finding the exception was never
    // about.
    const exception = MODE_SINGLE_TOKENS[token];
    if (exception && (inLight ? ":root" : ".dark") === exception.in) continue;
    const presentIn = inLight ? ":root" : ".dark";
    findings.push({
      kind: "unpaired",
      token,
      presentIn,
      missingFrom: inLight ? ".dark" : ":root",
      line: tokenLine(css, presentIn, token),
    });
  }
  return findings;
}

/**
 * Elements built by hand where the kit has a component.
 *
 * Two buckets, because "the kit already has this" and "the kit does not have
 * this yet" are different sentences to say to somebody:
 *
 *   `hard` — `<button>`, `<select>`, `<textarea>`, `<table>` and a text
 *            `<input>`. All of them are in components/ui/. No excuse.
 *   `soft` — a checkbox, a radio, a segmented control. The kit ships
 *            <Checkbox>, <RadioGroup> and <Switch> for client forms — but a
 *            Radix control cannot reach FormData without JavaScript, so a
 *            native input in a plain-POST form is sometimes the correct
 *            element (app/plans/page.tsx says why above its checkbox), and a
 *            segmented control has no kit counterpart at all (no ToggleGroup).
 *            Reported so they stay visible, never failed.
 */
/**
 * A JSX opening tag, from its `<` to the `>` that really ends it.
 *
 * 🚨 **`[^>]*>` is not that, and the difference is a wrong VERDICT rather than a
 * missed one.** A JSX attribute may hold an expression, and an expression may
 * hold a `>` — an arrow function is the everyday case:
 *
 *     <button ref={(node) => …} role="radio">
 *
 * A lazy match ends at the arrow's own `>`, so `role` falls outside the tag, the
 * element is classified as the thing its tag name says, and a segmented control
 * is reported as a raw `<button>` the kit already covers. Measured 2026-08-13 on
 * `components/theme-toggle.tsx` while adding its keyboard handling: `ux-check`
 * went from a warning to a FAILURE, exit 1, over a `ref` that changed nothing
 * about the element.
 *
 * So the end is found by scanning, counting braces and skipping quoted strings.
 * It is not a JSX parser and does not need to be: it stops at the first `>` that
 * is not inside `{…}` or a string, which is where the tag ends.
 *
 * @param {string} source
 * @param {number} start index of the `<`
 * @returns {string} the tag text, or the rest of the source if it never closes
 */
function tagAt(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== null) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

export function findRawElements(source) {
  source = blankComments(source);
  const hits = [];

  // Radix composition: `<DropdownMenuItem asChild><button …>` MERGES the two —
  // the menu item BECOMES the button and brings its styling, focus and keyboard
  // handling with it. Putting a <Button> in there instead would nest two of
  // everything. So a raw element directly under an `asChild` slot is the
  // idiomatic form, not a shortcut.
  const composed = (index) =>
    /asChild[^<>]*>\s*$/.test(source.slice(Math.max(0, index - 200), index));

  const pattern = new RegExp(`<(${RAW_ELEMENTS.join("|")})\\b`, "g");
  for (const m of source.matchAll(pattern)) {
    if (composed(m.index)) continue;
    const tag = tagAt(source, m.index);
    // An element carrying an explicit `role` is deliberately NOT the thing its
    // tag name says — `<button role="radio">` is one cell of a segmented
    // control, and the kit ships no ToggleGroup to build that from.
    const role = /\brole=["']([a-z]+)["']/.exec(tag)?.[1];
    const soft = role !== undefined && role !== "button";
    hits.push({
      line: lineAt(source, m.index),
      found: soft ? `<${m[1]} role="${role}">` : `<${m[1]}>`,
      kind: soft ? "soft" : "hard",
    });
  }

  for (const m of source.matchAll(/<input\b/g)) {
    const tag = tagAt(source, m.index);
    const type = /type=["']([a-z]+)["']/.exec(tag)?.[1] ?? "text";
    // Not an interface element at all: it carries form data and nobody ever
    // sees it. Skipped rather than excused.
    if (type === "hidden") continue;
    const soft = type === "checkbox" || type === "radio";
    hits.push({
      line: lineAt(source, m.index),
      found: `<input type="${type}">`,
      kind: soft ? "soft" : "hard",
    });
  }

  return hits.sort((a, b) => a.line - b.line);
}

/**
 * Icon-only buttons nobody can name.
 *
 * A `size="icon"` button whose only content is a picture has no name at all for
 * a screen reader — it reads as "button", and there is no way to find out what
 * it does. It needs an `aria-label`, or a `<span className="sr-only">` beside
 * the icon.
 *
 * The window is 500 characters from the tag, which comfortably covers a button
 * and its children, and is why this does not try to match nested JSX.
 */
export function findUnnamedIconButtons(source) {
  source = blankComments(source);
  const hits = [];
  const lines = source.split(/\r?\n/);
  for (const m of source.matchAll(/<Button\b/g)) {
    const window = source.slice(m.index, m.index + 500);
    const tagEnd = window.indexOf(">");
    const tag = tagEnd === -1 ? window : window.slice(0, tagEnd);
    if (!/size=["']icon["']/.test(tag)) continue;
    if (/aria-label|aria-labelledby|sr-only/.test(window)) continue;
    const line = lineAt(source, m.index);
    hits.push({ line, found: lines[line - 1]?.trim().slice(0, 60) ?? "" });
  }
  return hits;
}

/** `<img>` / `<Image>` with no `alt`. An empty `alt=""` is a decision and passes. */
export function findImagesWithoutAlt(source) {
  source = blankComments(source);
  const hits = [];
  for (const m of source.matchAll(/<(img|Image)\b[^>]*>/g)) {
    if (/\salt=/.test(m[0])) continue;
    hits.push({ line: lineAt(source, m.index), found: `<${m[1]}>` });
  }
  return hits;
}

/**
 * The shipped placeholder still sitting at `/` (app/page.tsx).
 *
 * 🚨 **ONE marker carries this today, not two, and the difference matters.**
 * The rule was written with two — the shipped `features.authTitle` KEY, and the
 * key/cart/sparkles icon trio in the import — on the argument that a re-text
 * touches neither, so either one alone would still catch the placeholder.
 *
 * Story 43.9 rewrote `app/page.tsx` and the trio is gone: the page imports
 * `ArrowRight` and nothing else, which the page's own comment records ("it is
 * the ONLY one left"). So the redundancy is not there: renaming ONE string key
 * silences `ux-check`, `salespage` step 0, `coach` and `go-live` at the same
 * moment. The second branch stays because a customer's page may still carry the
 * trio, and `rules.test.ts` exercises it against a synthetic fixture — but it
 * matches nothing in the shipped tree, and the assertion below says so rather
 * than leaving a reader to assume a belt and braces that is one belt.
 *
 * The caller reports this as a WARNING, never a failure: a test app keeps the
 * placeholder legitimately, and so does an app before its products exist. The
 * page that replaces it is the skill `salespage` (docs/salespage.md).
 */
export function findPlaceholderHome(source) {
  source = blankComments(source);
  const hits = [];

  for (const m of source.matchAll(/["']features\.authTitle["']/g)) {
    hits.push({ line: lineAt(source, m.index), found: "features.authTitle" });
  }

  const icons = /import\s*\{[^}]*\}\s*from\s*["']lucide-react["']/.exec(source);
  if (
    icons &&
    ["KeyRound", "ShoppingCart", "Sparkles"].every((name) =>
      new RegExp(`\\b${name}\\b`).test(icons[0]),
    )
  ) {
    hits.push({
      line: lineAt(source, icons.index),
      found: "KeyRound + ShoppingCart + Sparkles",
    });
  }

  return hits.sort((a, b) => a.line - b.line);
}

/**
 * `<Input type="number">` (or a raw `<input>`) that does not say its `step`.
 *
 * Without one the browser defaults to whole numbers and REFUSES the decimal on
 * its own, with a tooltip in the BROWSER's language — measured on a field-test
 * app: "Anfahrt (km)" took `12` and answered `12.5` with "Please enter a valid
 * value. The two nearest valid values are 12 and 13." on a German page, past
 * every catalogue in messages/, and nothing else on the page said a word.
 *
 * So the step is a decision and is written down: `step="1"` when whole numbers
 * are the point (a count, a position), the unit's grain otherwise (`0.01` for
 * money and m², `0.1` for km), `step="any"` when it does not matter. The
 * binding range check lives in the action with a translated code either way —
 * the attribute is a convenience, never the refusal (docs/ux.md § 2).
 *
 * Reads through blankComments(): a JSDoc that mentions `type="number"` is not
 * an input.
 */
export function findNumberInputsWithoutStep(source) {
  source = blankComments(source);
  const hits = [];
  // A tag from `<Input` / `<input` to its closing `>`, across lines. `[^>]`
  // deliberately: an arrow function inside an attribute would end the match
  // early, and a number input carrying one is rare enough to accept.
  for (const m of source.matchAll(/<(?:Input|input)\b[^>]*?type=["']number["'][^>]*>/g)) {
    if (/\bstep=/.test(m[0])) continue;
    hits.push({ line: lineAt(source, m.index), found: 'type="number" without step' });
  }
  return hits;
}

/**
 * The product NAMES the template ships as examples. An app that still SELLS a
 * product under one of these names has not named what it sells — measured on
 * a field-test app: a German quote tool for painters offered "Basic (monthly)
 * — The uncomplicated way in — Cancel monthly" on /plans and on its dashboard.
 *
 * Hand-kept on purpose: the customer's tree has no other record of what the
 * examples were called. The factory checks this list against the shipped
 * registry (scripts/shipped-lists.test.mjs), so a renamed example cannot
 * silently leave the rule matching nothing.
 */
export const SHIPPED_EXAMPLE_PRODUCT_NAMES = ["Basic (monthly)", "Basic (yearly)", "Starter Tokens"];

/**
 * Products on sale under a shipped example name — `{ key, name }` each.
 * A parked entry (`"sell": false`) is a template somebody keeps, never a hit.
 * Reported as a WARNING by the caller: a test app keeps the examples
 * legitimately, and so does an app before its products exist.
 */
export function findExampleProducts(registrySource) {
  let registry;
  try {
    registry = JSON.parse(registrySource);
  } catch {
    return [];
  }
  const hits = [];
  for (const [key, def] of Object.entries(registry?.products ?? {})) {
    if (!def || typeof def !== "object") continue;
    if (def.sell === false) continue;
    if (SHIPPED_EXAMPLE_PRODUCT_NAMES.includes(def.name)) hits.push({ key, name: def.name });
  }
  return hits;
}

/** The `href`s declared in NAVIGATION, or null if the list cannot be found. */
export function navHrefs(appShellSource) {
  // TWO shapes, because a menu is declared in two places and only one of them
  // can be a top-level const. The core writes `export const NAVIGATION = [...]`
  // in `components/app-shell.tsx`; a MODULE writes `NAVIGATION: [...]` as a
  // property of the `ModuleNav` object it default-exports, because that is what
  // the interface asks for.
  //
  // ⚠️ `lib/modules/nav.ts` has always claimed this worked — *"Named
  // `NAVIGATION`, exactly like the core's, and that is load-bearing: navHrefs()
  // finds a menu by that name"* — and until this reader learned the second shape
  // it did not. Nothing went red, because `ux-check` was also missing the
  // module's PAGES; the two errors cancelled into a green result, and fixing
  // either alone produces a confident false finding.
  //
  // The declaration is matched rather than the bare word, so a comment that
  // mentions NAVIGATION does not become the start of the menu.
  const declaration = /export\s+const\s+NAVIGATION\b|^\s*NAVIGATION\s*:/m;
  const found = declaration.exec(appShellSource);
  if (!found) return null;
  const body = appShellSource.slice(found.index);
  return [...body.matchAll(/href:\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** What a path segment is replaced by once it is known to be a parameter. */
const PARAM = "[param]";

/**
 * A path in the one shape both sides of the navigation check can be compared in.
 *
 * 🚨 **The whole point is that it is applied to BOTH sides.** A route on disk
 * spells its parameter `[groupId]`; the link that leads there spells it
 * `${encodeURIComponent(group.id)}`. Those two strings are never equal, so a
 * navigation check that dropped the "skip dynamic routes" rule without this
 * would report every dynamic route in the app as unreachable on the same day —
 * a wall of confident false findings, which is how a check gets switched off.
 *
 * ⚠️ Why the routes were skipped until 2026-08-12, and what it cost: the rule
 * read "a [id] page is opened from somewhere else with a real record", which is
 * true and does not follow. Measured on a real installation — the course's
 * lesson pages were finished and reachable ONLY by typing the URL, because
 * nothing in the whole tree linked to `/dashboard/course/[unit]`. This check
 * skipped it by construction and `node run.mjs smoke` skips `[param]` routes
 * too, so the app's two navigation gates were both blind to the same page.
 *
 * A segment counts as a parameter only when it is a parameter WHOLE:
 *
 * | in | out |
 * |---|---|
 * | `/dashboard/account` | unchanged — nothing here is dynamic |
 * | `/dashboard/community/groups/[groupId]` | `/dashboard/community/groups/[param]` |
 * | `` `/dashboard/community/groups/${encodeURIComponent(id)}` `` | the same |
 * | `` `/a/${x}/b/${y}` `` | `/a/[param]/b/[param]` — every segment, not the first |
 * | `` `/a/pre-${x}` `` | unchanged. A partly dynamic segment is not the route `/a/[x]` |
 * | `` `/a/${id}?page=${n}` `` | `/a/[param]` — the query is not part of the route |
 *
 * That last-but-one row is the one worth keeping: matching a partial segment
 * would let `/a/pre-${x}` count as a link to `/a/[x]`, and then a real orphan
 * hides behind a link that never leads to it.
 *
 * @param {string} path a route from the file tree, or the literal inside an `href`
 * @returns {string} the same path with every whole dynamic segment as `[param]`
 */
export function routeShape(path) {
  if (typeof path !== "string") return "";

  // ⚠️ **One depth-aware pass, not `split("/")` and a query strip.** Both of the
  // obvious shortcuts are wrong on real input, and both were measured here
  // before this loop existed: an interpolation may contain a `?` (a ternary,
  // `${a ? b : c}`) and it may contain a `/` (a string inside a call), so
  // cutting the query first or splitting on every slash tears the expression in
  // half and leaves a fragment that matches nothing.
  const segments = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < path.length; i += 1) {
    const char = path[i];
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);

    if (depth === 0) {
      // The query and the fragment are not part of a route, and everything
      // after the first one of them is gone.
      if (char === "?" || char === "#") break;
      if (char === "/") {
        segments.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }
  segments.push(current);

  return segments
    .filter((segment) => {
      // 🚨 Segments that organise the FILE TREE and are not in the URL: a route
      // group `(marketing)`, a parallel route `@modal`, an intercepting route
      // `(.)photo`. Next serves `/dashboard/reports/x` for
      // `app/dashboard/(marketing)/reports/[id]`, so leaving the group in would
      // compare a path no browser ever asks for.
      //
      // ⚠️ This is the one place where keeping dynamic routes made something
      // WORSE before it made it better: a grouped route used to be skipped for
      // containing a `[`, so nobody noticed. Compared without this filter, every
      // page under a route group is a confident false finding — and route groups
      // are the ordinary App Router way to divide a dashboard.
      if (/^\(.*\)$/.test(segment)) return false;
      if (segment.startsWith("@")) return false;
      return true;
    })
    .map((segment) => {
      // `[groupId]`, `[...slug]`, `[[...slug]]` — a route file's spelling.
      //
      // ⚠️ A catch-all collapses to ONE `[param]`, so a link that fills it with
      // several segments (`/a/${x}/${y}`) does not match its own route. There is
      // no catch-all in this template; a customer who adds one gets a false
      // finding, and the honest fix then is to teach this function the shape
      // rather than to skip the route.
      if (/^\[+[^[\]]+\]+$/.test(segment)) return PARAM;
      // `${…}` — a template literal's, with whatever expression inside it.
      // Counted rather than matched lazily, because `${encodeURIComponent(x)}`
      // closes a brace before its own end.
      if (segment.startsWith("${") && segment.endsWith("}")) {
        let inner = 0;
        for (let i = 0; i < segment.length; i += 1) {
          if (segment[i] === "{") inner += 1;
          else if (segment[i] === "}") {
            inner -= 1;
            // A brace closing before the end means the segment is `${a}-${b}`
            // or `${a}x`: dynamic in part, and therefore not this route.
            if (inner === 0 && i !== segment.length - 1) return segment;
          }
        }
        return inner === 0 ? PARAM : segment;
      }
      return segment;
    })
    .join("/");
}

/**
 * Hand-built controls this template has looked at and accepted — a SET with
 * prose, never a count.
 *
 * The argument is `MODE_SINGLE_TOKENS`' above and `scripts/security/accepted.mjs`'
 * in full: a check that simply allowed "the known findings" goes green on the day
 * a new, real one appears. So what is accepted is a set of named places, each
 * carrying the reason, and anything outside the set is reported however small.
 *
 * ⚠️ **Nothing in this project may assert how many entries are in here.** An
 * entry that stops matching costs nothing and is good news.
 *
 * ⚠️ It accepts a `soft` finding only — an element the kit has no answer for, or
 * a native input in a form that must work without JavaScript. A raw `<button>`,
 * `<select>`, `<textarea>`, `<table>` or text `<input>` is `hard` and cannot be
 * accepted here at all.
 *
 * 🚨 **The test for "must work without JavaScript" is the form's own shape, not
 * a feeling about it.** `<form action={serverAction}>` with NO `onSubmit` is
 * progressively enhanced by Next and really does post without JS — there a
 * native input is the correct element. A form with `onSubmit` +
 * `preventDefault()`, or one inside a dialog that only JavaScript can open,
 * never runs without JS and has no claim to the exception at all.
 *
 * That test was written after it removed two of this list's own first four
 * entries (2026-08-12). Both had reasons that sounded right and were not:
 * `report-button.tsx` cancels its native submit inside a Radix dialog, and
 * `theme-toggle.tsx` hand-builds the pattern `components/ui/radio-group.tsx`
 * already ships — without the arrow-key navigation Radix would have brought,
 * so accepting it would have silenced a keyboard defect inside a check whose
 * own section is called *Keyboard and screen reader*. Both are reported, and
 * that is what this list is worth: an entry has to survive the question.
 *
 * ⚠️ **One entry covers every hit of that ELEMENT in that file**, not one
 * occurrence. `found` is the element's class (`<input type="checkbox">`), so a
 * second checkbox in an accepted file is accepted too — while a *different*
 * hand-built control there is still reported. Said plainly because the shape
 * invites the other reading: if you need one checkbox in a file judged and the
 * next one seen, this list is the wrong instrument.
 *
 * Why this exists (reported 2026-08-12): all four entries below were reported on
 * every run of every fresh app, for ever. The advice text names the exception
 * itself and points at the file that documents it — and could not accept it. A
 * reader who checks "2 things worth looking at", finds only template code and
 * stops looking is a reader who will miss the fifth, real one.
 *
 * @typedef {object} AcceptedControl
 * @property {string} found   the finding's own wording, matched exactly
 * @property {string} reason  why, in prose. `true` would read as an arbitrary
 *                            exemption to whoever finds it next.
 */

/**
 * ⚠️ Annotated as a Record and not left to inference, so that the type is "a
 * list of these" rather than "exactly today's four". Inferred, every caller
 * would have to pass all four entries — which broke the tests the first time,
 * and would have made the list unextendable by the customer it is for.
 *
 * @type {Record<string, AcceptedControl>}
 */
export const RAW_ELEMENT_EXCEPTIONS = {
  "app/plans/page.tsx": {
    found: '<input type="checkbox">',
    reason:
      "The auto-top-up consent. It authorises a recurring card charge, and that " +
      "consent must not depend on JavaScript having loaded — shadcn's <Checkbox> " +
      "is a Radix button with no form value and reaches FormData only through a " +
      "hidden input beside it. The file carries this reasoning above the element " +
      "itself, which is where a reader meets it.",
  },
  "components/theme-toggle.tsx": {
    found: '<button role="radio">',
    reason:
      "A segmented control — three visible switches rather than one button that " +
      "cycles, so it can be seen at a glance which applies. The kit has no " +
      "counterpart: there is no ToggleGroup in components/ui/, and the template " +
      "deliberately does not ship one (the advice text above tells an app that " +
      "needs one to run `npx shadcn@latest add toggle-group`). " +
      "⚠️ Accepted only since 2026-08-13, and only because the KEYBOARD was " +
      "fixed first. It was refused for a day: `role=radiogroup` is a promise " +
      "that arrow keys move the choice and the group is one tab stop, and this " +
      "control kept neither — three tab stops, arrow keys dead, markup saying " +
      "radiogroup. An exception for a hand-built control is a statement that it " +
      "does the work the kit component would have done.",
  },
  "modules/community/components/profile-ui.tsx": {
    found: '<input type="checkbox">',
    reason:
      "Remove-my-picture, in the profile form. Same reason as app/plans: the " +
      "server reads it as `formData.get('removeAvatar') === 'on'`, which is the " +
      "native checkbox's own wire format, and a Radix control posts nothing " +
      "without a hidden input to carry it.",
  },
};

/**
 * Split `soft` findings into the open ones and the ones already judged.
 *
 * `hard` findings pass through untouched — they are not acceptable here, and
 * routing them past this function at all would be the first step to making them
 * so. A file in the list whose element has changed comes out as OPEN.
 *
 * @param {Array<{file: string, line: number, found: string, kind: string}>} hits
 * @param {Record<string, AcceptedControl>} [exceptions]
 * @returns {{open: Array<object>, accepted: Array<object>}}
 */
export function partitionAcceptedControls(hits, exceptions = RAW_ELEMENT_EXCEPTIONS) {
  const open = [];
  const accepted = [];
  for (const hit of hits ?? []) {
    // `hasOwnProperty`, not a bare read: an inherited key is not an entry
    // somebody wrote. `findUnpairedTokens` guards its own list the same way.
    const listed =
      hit?.kind === "soft" && Object.prototype.hasOwnProperty.call(exceptions, hit.file);
    const entry = listed ? exceptions[hit.file] : undefined;
    if (entry && entry.found === hit.found) accepted.push(hit);
    else open.push(hit);
  }
  return { open, accepted };
}
