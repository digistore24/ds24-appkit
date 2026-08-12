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
// ── 🚨 Why this file deliberately does NOT blank comments ──────────────────
// `CLAUDE.md` → **Rules** carries the opposite rule, and it is right: a checker
// that greps source goes through `blankComments()`
// (`scripts/lib/source-text.mjs`), or it punishes a file for explaining itself.
// **This checker is the other direction, and both rules hold at once.** The
// reader whose mistake is being prevented here is not one of ours — it is
// TAILWIND, a foreign tool with no idea that `//` means anything, and the
// needle is in the comment ON PURPOSE.
//
// So: do not "unify" this with `blankComments()`, and do not add a call to it
// here to make the two files look alike. Blanking would remove exactly the text
// this file has to read.
//
// ── There is no exemption marker, and that is the point ────────────────────
// `portability.test.ts` has `portability-ok`, `db/sql-cast.test.ts` has
// `sql-cast-ok`. This file has none. There is no way to write these forms
// safely — not in code, not in a comment, not in a doc, not to explain that
// they are wrong. That is the whole lesson of 43.7, and it is why the comment
// in `app/login/ui.tsx` describes the form in words instead of spelling it. A
// marker here would be a licence to break every page in the app.
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
// other:
//
//   1. **the CSS parser** — `var()` whose first argument is not a `--` name.
//      `var()` is the one CSS function with closed argument grammar, so a
//      placeholder there is a parse error where the same placeholder inside
//      `calc()` or `rgb()` is merely a value nobody will ever use.
//      → `✗ Parsing CSS source code failed`
//
//   2. **the bundler** — `url()` with a RELATIVE specifier that is not a file.
//      Measured, and the boundary is exact: a root-relative `/hero.png` is
//      never resolved at build time (it is served from `public/`, and even a
//      missing one builds fine), an `https:` or `data:` URL is left alone, an
//      `#anchor` is left alone, and a relative path that EXISTS beside the
//      stylesheet builds fine. Only a relative specifier with nothing behind
//      it fails — which is precisely what a placeholder in prose is.
//      → `✗ Module not found: Can't resolve '…'`
//
// Neither of those two families can be written out HERE, which is the rule
// proving itself; both are below as code, assembled from escapes.
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
// `shadow-[VAR(…)]` in capitals builds fine, so the rule below is
// case-sensitive: a rule stricter than the measurement is one somebody
// eventually has to argue with.
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
// which is why they are skipped below — `app/globals.css` writes `var(--…)` on
// nearly every line and is read as CSS, not as a source of class names.
//
// ⚠️ **This file writes no broken token literally.** 🚨 That is not a
// precaution taken on principle: the first draft of this header spelled the
// list out, the guard's own tree walk found nine of them in this file, and the
// app it was written to protect would have gone down on the commit that added
// it. Every fixture is assembled at run time out of escapes, and
// `it("the needle can be found at all")` is what proves the assembled string is
// really the incident's form.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// ── The rule ────────────────────────────────────────────────────────────────

/**
 * An arbitrary value as Tailwind's scanner sees one: a bracket group with no
 * whitespace in it (Tailwind spells spaces `_`) and no nesting.
 *
 * Measured on the running app: `shadow-[ var(x) ]` — the same token with real
 * spaces — builds fine, so a bracket group containing whitespace is not a
 * candidate and must not be reported. That is what keeps ordinary prose and
 * ordinary code out of this scan: `["hsl(var(--h) 50% 50%)"]` in
 * `scripts/brand/colors.test.ts` is a JavaScript array, not a class.
 */
const BRACKET_GROUP = /\[[^\s[\]]*\]/g;

/**
 * `var(` and its first argument, up to the comma or the closing paren.
 *
 * The fallback after a comma is deliberately not read: `shadow-[var(--x,…)]`
 * builds, because the placeholder sits in the fallback where any token list is
 * legal. Only the NAME is closed grammar.
 */
const VAR_CALL = /var\(([^,)]*)/g;

/** `url(` and everything up to its closing paren. */
const URL_CALL = /url\(([^)]*)\)/g;

export type Finding = {
  /** `parser` — the stylesheet will not parse. `bundler` — it will not build. */
  reader: "parser" | "bundler";
  /** The whole arbitrary value, as it stands in the text. */
  token: string;
  /** The argument that does it: a `var()` name or a `url()` specifier. */
  argument: string;
  line: number;
  column: number;
};

export type Scan = {
  /** Every arbitrary value seen — the proof that the comparison ran at all. */
  candidates: string[];
  findings: Finding[];
};

/**
 * Does the bundler try to RESOLVE this `url()` specifier as a module?
 *
 * Measured, each of these on the running app:
 *
 * | written | what Turbopack does |
 * |---|---|
 * | `https://…`, `data:…` | leaves it alone — builds |
 * | `//host/x.png` | leaves it alone — builds |
 * | `/icons/icon-192.png`, and `/nope.png` too | never resolved at build; served from `public/` — builds |
 * | `#gradient` | an SVG fragment — builds |
 * | `icon.png`, `./icon.png` beside the stylesheet | resolves, and the file is there — builds |
 * | `nope.png`, `…`, `...`, `<path>` | resolves, nothing there — **500** |
 */
function isResolvedSpecifier(raw: string): boolean {
  const spec = raw.replace(/^['"]/, "").replace(/['"]$/, "");
  if (spec === "") return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) return false; // http:, https:, data:
  if (spec.startsWith("//")) return false;
  if (spec.startsWith("/")) return false;
  if (spec.startsWith("#")) return false;
  return true;
}

/**
 * Read one file's text the way Tailwind reads it: whole, comments included.
 *
 * A bracket group counts as a Tailwind candidate when it is either
 *
 *  · preceded by `-`, which is every utility form (`shadow-[…]`, and with a
 *    variant in front `dark:shadow-[…]`), or
 *  · an arbitrary PROPERTY — `[<prop>:<value>]`, the colon before any paren —
 *    and not glued to a word. Measured on the running app: `[var(x)]` on its
 *    own builds fine (so a markdown link `[var(x)](…)` is not a finding), and
 *    `foo[color:var(x)]` builds fine too — the scanner wants a boundary.
 *
 * `resolves` answers whether a relative `url()` specifier is a file that is
 * really there. It is injected rather than looked up here so the rule stays a
 * pure function: the tree walk passes the filesystem, the tests pass an answer.
 */
export function scanSource(
  source: string,
  resolves: (specifier: string) => boolean = () => false,
): Scan {
  const candidates: string[] = [];
  const findings: Finding[] = [];

  for (const match of source.matchAll(BRACKET_GROUP)) {
    const token = match[0];
    const at = match.index;
    const before = at > 0 ? source[at - 1] : "";
    const inner = token.slice(1, -1);

    const utility = before === "-";
    const colon = inner.indexOf(":");
    const paren = inner.indexOf("(");
    const arbitraryProperty =
      colon !== -1 && (paren === -1 || colon < paren) && !/[A-Za-z0-9_]/.test(before);
    if (!utility && !arbitraryProperty) continue;

    candidates.push(token);

    const upTo = source.slice(0, at);
    const lines = upTo.split("\n");
    const where = { line: lines.length, column: lines[lines.length - 1].length + 1 };

    for (const call of inner.matchAll(VAR_CALL)) {
      if (call[1].startsWith("--")) continue;
      findings.push({ reader: "parser", token, argument: call[1], ...where });
    }

    for (const call of inner.matchAll(URL_CALL)) {
      const spec = call[1];
      if (!isResolvedSpecifier(spec)) continue;
      if (resolves(spec.replace(/^['"]/, "").replace(/['"]$/, ""))) continue;
      findings.push({ reader: "bundler", token, argument: spec, ...where });
    }
  }

  return { candidates, findings };
}

/** One finding, said the way somebody who has never met this can act on it. */
export function say(file: string, finding: Finding): string {
  const why =
    finding.reader === "parser"
      ? `compiles to a CSS declaration reading \`var(${finding.argument})\`. That is ` +
        `not a custom-property name, so the stylesheet does not PARSE`
      : `compiles to a CSS declaration reading \`url(${finding.argument})\`. The bundler ` +
        `resolves a relative url() as a module import, there is no such file, so the ` +
        `stylesheet does not BUILD`;
  const fix =
    finding.reader === "parser"
      ? `describe the form in words, or name a real \`--\` token`
      : `describe the form in words, or make it a root-relative path from public/ ` +
        `(\`/hero.png\`), an absolute URL, or a file that is really beside the stylesheet`;
  return (
    `${file}:${finding.line}:${finding.column}  ${finding.token}\n` +
    `    Tailwind reads this file as raw text — a comment is text too — and it ${why}. ` +
    `EVERY page in the app then answers 500, while typecheck and tests stay green.\n` +
    `    Fix: ${fix}. There is no exemption marker for this and there will not be one.\n` +
    `    If a page still 500s after the fix: \`rm -rf .next\` — Turbopack caches the ` +
    `broken rule across a restart.`
  );
}

// ── The rule, measured ──────────────────────────────────────────────────────

/*
 * The incident's own token, assembled rather than written.
 *
 * The three characters are spelled as escapes on purpose: written out, this
 * file would hold a bracket pair for Tailwind to find, and the guard would be
 * the outage. `it("the needle can be found at all")` reads the code points
 * back, so the escapes cannot quietly stop being the incident's form.
 */
const OPEN = "[";
const CLOSE = "]";
const ELLIPSIS = "…";
const INCIDENT = `shadow-${OPEN}var(${ELLIPSIS})${CLOSE}`;

/** Nothing on disk resolves, unless a test says otherwise. */
const NOTHING_RESOLVES = () => false;

describe("the rule", () => {
  it("🚨 the needle can be found at all", () => {
    // 🚨 Every assertion below runs the rule over an assembled string. A string
    // that is not the incident's form would let the whole file pass while
    // measuring nothing — the failure mode `scripts/lib/source-text.test.ts`
    // shipped once, where the needle and the tree could never line up.
    //
    // So the assembled token is checked against the incident as recorded in
    // Story 43.7 and in the comment above `<Card>` in app/login/ui.tsx, spelled
    // here the only way it can be: by its code points.
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
      `bg-${OPEN}url(${ELLIPSIS})${CLOSE}`,
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
      `shadow-${OPEN}var(--elevation-overlay)${CLOSE}`,
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

/**
 * What Tailwind does not read.
 *
 * `node_modules` and `.next` are ignored by Tailwind itself; `.git`, `.dev` and
 * `.data` hold no source. Everything else is in — `docs/`, `CLAUDE.md`,
 * `messages/*.json` and `drizzle/*.sql` included, because Tailwind scans them
 * and the compiled stylesheet proves it: `.font-\[…\]` is in this app's CSS
 * today and the only place that token occurs is a markdown file.
 */
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".dev", ".data", "dist", "coverage"]);

/** Measured: `.css` is the one text extension Tailwind does not scan. */
const SKIP_EXTENSIONS = [".css"];

function walk(dir: string, keep: (entry: string) => boolean, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let directory: boolean;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      // A dangling symlink. Tailwind cannot read it either; it is not a place a
      // class name can hide.
      continue;
    }
    if (directory) walk(full, keep, found);
    else if (keep(entry)) found.push(full);
  }
  return found;
}

const scannedByTailwind = (entry: string) => !SKIP_EXTENSIONS.some((ext) => entry.endsWith(ext));

const FILES = walk(ROOT, scannedByTailwind).map((file) => relative(ROOT, file).split(sep).join("/"));

/** A file with a NUL byte is a picture or a font — Tailwind skips it, so do we. */
function textOf(file: string): string | null {
  const buffer = readFileSync(join(ROOT, file));
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

/**
 * Where a relative `url()` is resolved from: the directory of every stylesheet
 * that pulls Tailwind in. In this template that is `app/globals.css`, so
 * `app/`; an app that adds a second entry stylesheet gets it for free rather
 * than a hard-coded path that stops being true.
 *
 * ⚠️ Its own walk, because the walk above deliberately SKIPS `.css` — the one
 * extension Tailwind does not read. Reusing it left this list empty, which made
 * the url() half stricter than the app and reported a background that works.
 */
const STYLESHEET_DIRS = walk(ROOT, (entry) => entry.endsWith(".css"))
  .filter((file) => readFileSync(file, "utf8").includes('@import "tailwindcss"'))
  .map((file) => dirname(file));

const resolvesBesideStylesheet = (specifier: string): boolean =>
  STYLESHEET_DIRS.some((dir) => existsSync(join(dir, specifier)));

describe("no source file in this app compiles to a broken CSS rule", () => {
  const scanned = FILES.map((file) => ({ file, text: textOf(file) })).filter(
    (entry): entry is { file: string; text: string } => entry.text !== null,
  );

  it("walked the tree", () => {
    // Non-vacuity. Every assertion here is over `scanned`, so an empty walk is
    // a green run that read nothing.
    expect(scanned.length).toBeGreaterThan(300);
    const files = scanned.map((entry) => entry.file);
    expect(files).toContain("app/login/ui.tsx"); // where the incident happened
    expect(files).toContain("CLAUDE.md"); // prose Tailwind reads as class names
    expect(files).toContain("docs/design-system.md"); // …and the doc under it
  });

  it("found the stylesheet a relative url() would be resolved from", () => {
    // Without this the url() half degrades silently into "nothing resolves",
    // which is stricter than the app and would report a working background.
    expect(STYLESHEET_DIRS.length).toBeGreaterThan(0);
    expect(resolvesBesideStylesheet("icon.png")).toBe(true);
    expect(resolvesBesideStylesheet("nope.png")).toBe(false);
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
    const candidates = scanned.flatMap((entry) => scanSource(entry.text).candidates);
    expect(candidates.length).toBeGreaterThan(5);
    expect(candidates.some((token) => token.includes("var(--"))).toBe(true);
    expect(candidates.some((token) => token.includes(ELLIPSIS))).toBe(true);
  });

  it("finds nothing", () => {
    const findings = scanned.flatMap(({ file, text }) =>
      scanSource(text, resolvesBesideStylesheet).findings.map((finding) => say(file, finding)),
    );
    expect(findings).toEqual([]);
  });
});
