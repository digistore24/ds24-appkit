// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The heading family — wired as a role variable, and ACTUALLY FILLED.
//
// The second half of that sentence is the one a test is for. A role variable is
// four edits — a `localFont()` call, a class on <html>, an `@theme inline` entry
// and one rule in `@layer base` — and if any single one of them is missing, the
// app still builds, every page still answers 200, `npm run typecheck` is still
// green, and the headings quietly render in the body sans. There is no error
// anywhere. The dial is declared and empty, which is a slot standing open
// wearing the appearance of a decision.
//
// So this file refuses the shapes that mistake takes, one finding each:
//
//   · no call declares `--font-app-heading` at all
//   · the call is there and its `src` is a file that is not on disk
//   · the package it names is not a declared dependency
//   · the heading variable holds the SAME file as the body sans — the epic's
//     explicitly refused version of "shipped"
//   · the call is there and its class never reaches <html>, so nothing on the
//     page can read the variable
//   · the `@theme inline` entry is missing, or its chain does not end on the
//     body sans, so removing the family degrades onto `system-ui` or onto
//     nothing at all
//   · the `@layer base` rule is missing, or there is more than one of it, or
//     its selector is not `h1` alone
//
// 🚨 Every one of those is a FAILURE with a sentence, never a skip (NFR-60):
// this suite runs `environment: "node"` and cannot look at a rendered page, so
// the one thing it must never do is let "I could not check that" and "that is
// fine" produce the same green.
//
// It reads the real app/globals.css through `parseTokens()`/`blockRange()` from
// scripts/ux/rules.mjs — never a second parser, exactly as
// app/globals.elevation.test.ts does — and blanks comments with
// `blankComments()` before looking for any needle, or this file's own prose
// would answer its own questions.

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { blockRange } from "@/scripts/ux/rules.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const LAYOUT = readFileSync(here("./layout.tsx"), "utf8");
const CSS = readFileSync(here("./globals.css"), "utf8");
const PACKAGE_JSON = JSON.parse(
  readFileSync(here("../package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

/** The two role variables. Named after what they DO, never after a font. */
const HEADING_VARIABLE = "--font-app-heading";
const SANS_VARIABLE = "--font-app-sans";

/** The theme key, and the base rule's only permitted selector. */
const THEME_KEY = "--font-heading";
const SELECTOR = "h1";

// ── Reading app/layout.tsx ───────────────────────────────────────────────────

type FontCall = { name: string | null; body: string };

/**
 * Every `localFont({ … })` call in `source`, with the const it was assigned to.
 *
 * Brace-matched rather than regex-matched: the option object is the thing being
 * read, and a regex that stops at the first `}` would stop inside `src` the day
 * somebody writes the array form. A call whose braces never close is returned
 * with the rest of the file as its body, so the checks below report an
 * unreadable call instead of silently seeing none.
 */
function localFontCalls(source: string): FontCall[] {
  const out: FontCall[] = [];
  const NEEDLE = "localFont({";
  for (let at = source.indexOf(NEEDLE); at !== -1; at = source.indexOf(NEEDLE, at + 1)) {
    const open = at + NEEDLE.length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = end === -1 ? source.slice(open) : source.slice(open, end + 1);
    const assignment = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*localFont\(\{$/.exec(
      source.slice(0, at + NEEDLE.length),
    );
    out.push({ name: assignment ? assignment[1] : null, body });
  }
  return out;
}

/** A `key: "value"` option, or `null` when it is absent or not a plain string. */
function stringOption(body: string, key: string): string | null {
  const m = new RegExp(`\\b${key}\\s*:\\s*"([^"]*)"`).exec(body);
  return m ? m[1] : null;
}

/** The npm package a `../node_modules/…` src names, or `null`. */
function packageOf(src: string): string | null {
  const m = /(?:^|\/)node_modules\/(@[^/]+\/[^/]+|[^@/][^/]*)\//.exec(src);
  return m ? m[1] : null;
}

// ── Reading app/globals.css ──────────────────────────────────────────────────

/** The body of a block, or `null` when the block is not in the file at all. */
function bodyOf(css: string, selector: string): string | null {
  const range = blockRange(css, selector);
  return range ? css.slice(range.start, range.end) : null;
}

type CssRule = { selector: string; declarations: string };

/** The flat rules inside a `@layer` body. Enough for a layer holding no nesting. */
function rulesOf(layerBody: string): CssRule[] {
  const out: CssRule[] = [];
  for (const m of layerBody.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].replace(/\s+/g, " ").trim(), declarations: m[2] });
  }
  return out;
}

// ── The findings, as one pure helper ─────────────────────────────────────────

type Input = {
  layout: string;
  css: string;
  dependencies: Record<string, string>;
  /** Does the file this `src` names exist, resolved as `app/layout.tsx` resolves it? */
  fileExists: (src: string) => boolean;
};

/**
 * Everything wrong with the heading family in `input`, one sentence each.
 *
 * A helper over STRINGS rather than over the tree, so the doctored cases in the
 * needle probe below need no filesystem. Every finding names the thing it is
 * about, so the probe can assert that the right one fired rather than that
 * something did.
 */
function headingProblems(input: Input): string[] {
  const layout = blankComments(input.layout);
  const css = blankComments(input.css);
  const problems: string[] = [];

  // ── 1 · The call ───────────────────────────────────────────────────────────
  const calls = localFontCalls(layout);
  const heading = calls.find(
    (call) => stringOption(call.body, "variable") === HEADING_VARIABLE,
  );
  const sans = calls.find((call) => stringOption(call.body, "variable") === SANS_VARIABLE);

  if (!heading) {
    problems.push(
      `${HEADING_VARIABLE} is not wired: no localFont() call in app/layout.tsx declares it`,
    );
  } else {
    const src = stringOption(heading.body, "src");
    if (src === null) {
      // NFR-60: a call this cannot read is a failure, never a pass.
      problems.push(
        `${HEADING_VARIABLE} has a src nothing is checking — expected src: "../node_modules/…/<file>.woff2"`,
      );
    } else {
      if (!input.fileExists(src)) {
        problems.push(
          `${HEADING_VARIABLE} is declared and EMPTY: "${src}" is not on disk — ` +
            `read the package's files/ directory, the name differs per family`,
        );
      }
      const pkg = packageOf(src);
      if (!pkg) {
        problems.push(
          `${HEADING_VARIABLE} names "${src}", which is not a file inside an npm package — ` +
            `the family has to ship in node_modules or the build fetches it`,
        );
      } else if (!input.dependencies[pkg]) {
        problems.push(
          `${HEADING_VARIABLE} loads from "${pkg}", which is not a dependency in package.json`,
        );
      }
      const sansSrc = sans ? stringOption(sans.body, "src") : null;
      if (sansSrc !== null && sansSrc === src) {
        problems.push(
          `${HEADING_VARIABLE} holds the same file as ${SANS_VARIABLE} — the dial ships open, ` +
            `not filled; a second variable on the body face changes nothing anybody can see`,
        );
      }
    }

    if (stringOption(heading.body, "display") !== "swap") {
      problems.push(
        `${HEADING_VARIABLE} does not say display: "swap" — the body sans does, and a heading ` +
          `blocking on its own file is a blank page rather than a swap`,
      );
    }
    if (!/\bfallback\s*:\s*\[[^\]]*\S[^\]]*\]/.test(heading.body)) {
      problems.push(`${HEADING_VARIABLE} has no fallback chain`);
    }

    if (!heading.name) {
      problems.push(
        `the localFont() call for ${HEADING_VARIABLE} is not assigned to a const, so nothing ` +
          `can put its class on <html>`,
      );
    } else if (!layout.includes("${" + heading.name + ".variable}")) {
      problems.push(
        `${HEADING_VARIABLE} never reaches <html>: ${heading.name}.variable is not in the ` +
          `className — the variable would be defined nowhere the page can read it`,
      );
    }
  }

  // ── 2 · The theme entry ────────────────────────────────────────────────────
  const theme = bodyOf(css, "@theme inline");
  if (theme === null) {
    problems.push("app/globals.css has no `@theme inline` block");
  } else {
    const entry = new RegExp(`^\\s*${THEME_KEY}:\\s*([^;]+);`, "m").exec(theme);
    if (!entry) {
      problems.push(
        `${THEME_KEY} is missing from \`@theme inline\`, so there is no utility and no ` +
          `\`var(${THEME_KEY})\` for the base rule to use`,
      );
    } else {
      const value = entry[1].replace(/\s+/g, " ").trim();
      if (!value.includes(`var(${HEADING_VARIABLE}`)) {
        problems.push(`${THEME_KEY} does not read ${HEADING_VARIABLE}: "${value}"`);
      }
      if (!value.endsWith(`var(${SANS_VARIABLE}))`)) {
        problems.push(
          `${THEME_KEY} does not end in var(${SANS_VARIABLE}): "${value}" — removing the family ` +
            `has to degrade onto the body sans, and the nested form is the only one that does`,
        );
      }
    }
  }

  // ── 3 · The one rule ───────────────────────────────────────────────────────
  const base = bodyOf(css, "@layer base");
  if (base === null) {
    problems.push("app/globals.css has no `@layer base` block");
  } else {
    const carrying = rulesOf(base).filter((rule) =>
      rule.declarations.replace(/\s+/g, " ").includes(`font-family: var(${THEME_KEY})`),
    );
    if (carrying.length === 0) {
      problems.push(
        `no rule in \`@layer base\` sets font-family: var(${THEME_KEY}) — the family is loaded ` +
          `and nothing wears it`,
      );
    } else if (carrying.length > 1) {
      problems.push(
        `${carrying.length} rules in \`@layer base\` set font-family: var(${THEME_KEY}) ` +
          `(${carrying.map((r) => r.selector).join(", ")}) — the reach has to live in ONE place`,
      );
    } else if (carrying[0].selector !== SELECTOR) {
      problems.push(
        `the heading face is scoped to "${carrying[0].selector}" rather than "${SELECTOR}": ` +
          `an h2 rule's reach depends on CardTitle's level prop, and two of the app's own h2s ` +
          `are 14 px and muted`,
      );
    }
  }

  return problems;
}

// ── The shipped tree ─────────────────────────────────────────────────────────

const SHIPPED: Input = {
  layout: LAYOUT,
  css: CSS,
  dependencies: PACKAGE_JSON.dependencies ?? {},
  // Resolved from THIS file, which sits in `app/` beside layout.tsx — so the
  // relative src is resolved exactly the way `next/font/local` resolves it.
  fileExists: (src) => existsSync(here(src)),
};

describe("app — the heading family", () => {
  it("wires --font-app-heading in app/layout.tsx", () => {
    // Non-vacuity, twice over: an empty problem list below must mean "checked
    // and fine", never "the parser found nothing to check". The sans is the
    // known-good case — if the reader cannot see THAT call, it can see none.
    const calls = localFontCalls(blankComments(LAYOUT));
    expect(calls.map((c) => stringOption(c.body, "variable"))).toEqual(
      expect.arrayContaining([SANS_VARIABLE, HEADING_VARIABLE]),
    );
  });

  it("ships it FILLED — the file is on disk and is not the body face", () => {
    const heading = localFontCalls(blankComments(LAYOUT)).find(
      (c) => stringOption(c.body, "variable") === HEADING_VARIABLE,
    );
    const src = heading ? stringOption(heading.body, "src") : null;
    expect(src, `src of ${HEADING_VARIABLE}`).toBeTruthy();
    expect(existsSync(here(src!)), `${src} on disk`).toBe(true);
    expect(src).not.toContain("figtree");
  });

  it("has no heading problem at all", () => {
    expect(headingProblems(SHIPPED)).toEqual([]);
  });

  it("reaches h1 and nothing else — the kit's own titles are untouched", () => {
    // The positive half of the selector decision, stated as what the CSS says
    // rather than as what the comment claims. `h2`/`h3` keep the typographic
    // rule above it (text-wrap, letter-spacing) and must not gain the face.
    const base = bodyOf(blankComments(CSS), "@layer base");
    expect(base, "@layer base").not.toBeNull();
    const carrying = rulesOf(base!).filter((rule) =>
      rule.declarations.replace(/\s+/g, " ").includes(`font-family: var(${THEME_KEY})`),
    );
    expect(carrying.map((r) => r.selector)).toEqual([SELECTOR]);
  });
});

// ── The needle probe ─────────────────────────────────────────────────────────

describe("🚨 headingProblems can fire", () => {
  // This repo's own doctrine (scripts/lib/source-text.test.ts): "A guard whose
  // probe cannot fire is worse than no guard: it reports success." A helper
  // returning `[]` for every input passes every assertion above, so each finding
  // is produced here on purpose, from a doctored string, and the thing it is
  // about is asserted in it.

  const HEADING_SRC =
    "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2";
  const SANS_SRC =
    "../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2";

  const layoutFrom = (headingCall: string, className = "${appSans.variable} ${appHeading.variable}") =>
    `import localFont from "next/font/local";
const appSans = localFont({
  src: "${SANS_SRC}",
  variable: "${SANS_VARIABLE}",
  display: "swap",
  weight: "300 900",
  fallback: ["system-ui", "sans-serif"],
});
${headingCall}
export default function RootLayout() {
  return <html className={\`${className}\`} />;
}
`;

  const HEADING_CALL = `const appHeading = localFont({
  src: "${HEADING_SRC}",
  variable: "${HEADING_VARIABLE}",
  display: "swap",
  weight: "200 900",
  fallback: ["Georgia", "serif"],
});`;

  const cssFrom = (
    themeEntry = `  ${THEME_KEY}: var(${HEADING_VARIABLE}, var(${SANS_VARIABLE}));`,
    baseRules = `  h1 {\n    font-family: var(${THEME_KEY});\n  }`,
  ) =>
    `@theme inline {
  --font-sans: var(${SANS_VARIABLE}), system-ui;
${themeEntry}
}

@layer base {
  h1,
  h2,
  h3 {
    text-wrap: balance;
  }

${baseRules}
}
`;

  const healthy: Input = {
    layout: layoutFrom(HEADING_CALL),
    css: cssFrom(),
    dependencies: {
      "@fontsource-variable/figtree": "^5.2.7",
      "@fontsource-variable/source-serif-4": "^5.3.0",
    },
    fileExists: () => true,
  };

  it("says nothing about a healthy tree — so each finding below is attributable", () => {
    expect(headingProblems(healthy)).toEqual([]);
  });

  it("1 · fires when no call declares the role variable", () => {
    const problems = headingProblems({ ...healthy, layout: layoutFrom("") });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(HEADING_VARIABLE);
    expect(problems[0]).toContain("no localFont() call");
  });

  it("2 · fires when the file it names is not on disk — declared and EMPTY", () => {
    const problems = headingProblems({
      ...healthy,
      fileExists: (src) => src !== HEADING_SRC,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("declared and EMPTY");
    expect(problems[0]).toContain("source-serif-4");
  });

  it("3 · fires when the package is not a dependency", () => {
    const problems = headingProblems({
      ...healthy,
      dependencies: { "@fontsource-variable/figtree": "^5.2.7" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("@fontsource-variable/source-serif-4");
    expect(problems[0]).toContain("not a dependency");
  });

  it("4 · fires when the heading variable ships holding the BODY face", () => {
    const openDial = HEADING_CALL.replace(HEADING_SRC, SANS_SRC);
    const problems = headingProblems({ ...healthy, layout: layoutFrom(openDial) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("the dial ships open");
  });

  it("5 · fires when the class never reaches <html>", () => {
    const problems = headingProblems({
      ...healthy,
      layout: layoutFrom(HEADING_CALL, "${appSans.variable}"),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("never reaches <html>");
  });

  it("6 · fires when the @theme inline entry is missing", () => {
    const problems = headingProblems({ ...healthy, css: cssFrom("") });
    // The entry is gone, so the base rule's `var(--font-heading)` resolves to
    // nothing — one finding, and it is the one that says why.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${THEME_KEY} is missing`);
  });

  it("7 · fires on the comma form, which does NOT degrade onto the body sans", () => {
    const problems = headingProblems({
      ...healthy,
      css: cssFrom(`  ${THEME_KEY}: var(${HEADING_VARIABLE}), var(${SANS_VARIABLE});`),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`does not end in var(${SANS_VARIABLE})`);
  });

  it("8 · fires when nothing in @layer base wears the family", () => {
    const problems = headingProblems({ ...healthy, css: cssFrom(undefined, "") });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("nothing wears it");
  });

  it("9 · fires on the wider selector tokens.md used to prescribe", () => {
    const problems = headingProblems({
      ...healthy,
      css: cssFrom(
        undefined,
        `  h1,\n  h2,\n  h3 {\n    font-family: var(${THEME_KEY});\n  }`,
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("h1, h2, h3");
    expect(problems[0]).toContain("CardTitle");
  });

  it("10 · fires when the reach lives in two places", () => {
    const problems = headingProblems({
      ...healthy,
      css: cssFrom(
        undefined,
        `  h1 {\n    font-family: var(${THEME_KEY});\n  }\n\n  h2 {\n    font-family: var(${THEME_KEY});\n  }`,
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("2 rules");
    expect(problems[0]).toContain("ONE place");
  });

  it("11 · a comment cannot answer for the file — the needle is blanked", () => {
    // The doctrine at scripts/lib/source-text.mjs, measured here rather than
    // trusted: a layout whose PROSE spells the wiring out, with no call in it,
    // must still be reported as unwired.
    const commentOnly = layoutFrom(
      `// const appHeading = localFont({ variable: "${HEADING_VARIABLE}", src: "${HEADING_SRC}" });`,
    );
    const problems = headingProblems({ ...healthy, layout: commentOnly });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no localFont() call");
  });
});
