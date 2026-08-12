// What is measurably wrong with this app's interface.
//
//   node run.mjs ux-check
//
// The counterpart to `legal-check`, `ai-check` and `kb-check`, for the rules in
// docs/ux.md. It is the narrow half of the skill `ux-gateway`: everything in
// here is a fact a machine can settle — a contrast ratio, a class that is in
// the file, a page that is in no menu. Whether the wording is clear, whether
// the first five minutes make sense, whether a flow has a dead end: none of
// that is here, because a script cannot know it, and pretending otherwise is
// how a report earns its way into the bin.
//
// So a green run does NOT mean the app is good. It means the things that can be
// counted have been counted. The skill does the rest.
//
// It reports; it never writes. The rules themselves are in ./rules.mjs, tested
// in ./rules.test.ts.
//
// Plain Node, no bundler, no TypeScript, no dependency — Linux, macOS and Git
// Bash on Windows (CLAUDE.md, "Three systems").
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";

import {
  TEXT_PAIRS,
  RING_PAIRS,
  parseHsl,
  contrastRatio,
  parseTokens,
  MODE_SINGLE_TOKENS,
  findUnpairedTokens,
  findPaletteClasses,
  findDialBypasses,
  findRawElements,
  findUnnamedIconButtons,
  findImagesWithoutAlt,
  findPlaceholderHome,
  navHrefs,
} from "./rules.mjs";
import { installedModules } from "../modules/installed.mjs";
import { modulePageExtensions } from "../modules/page-extensions.mjs";
import { moduleNavFiles } from "../modules/inventory.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// ── Walking the tree ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".dev", "drizzle"]);

function walk(dir, onFile) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

/**
 * The file names that are a page in THIS app — the core's plus every installed
 * module's, which is a function of `config/modules.json` and not a constant.
 *
 * ⚠️ Same rule, same reason, same fix as `scripts/dev/smoke.mjs`: a module's
 * pages are `page.<id>.tsx`, and Next builds them exactly while the module is
 * installed. This walk matched `page.tsx` alone, so `/dashboard/community` and
 * the ten pages under it were invisible to every navigation check.
 */
const PAGE_NAMES = modulePageExtensions(installedModules()).map((ext) => `page.${ext}`);

/** Every page under app/dashboard, as a route. Dynamic segments are skipped. */
function dashboardRoutes(appDir) {
  const routes = [];
  walk(join(appDir, "dashboard"), (file) => {
    const rel = relative(appDir, file).split(sep).join("/");
    const name = PAGE_NAMES.find((page) => rel === page || rel.endsWith(`/${page}`));
    if (!name) return;
    const route = "/" + rel.replace(new RegExp(`/?${name.replace(".", "\\.")}$`), "");
    // A [id] page is opened from somewhere else with a real record. It has no
    // place in a menu, and its absence from one is not a finding.
    if (route.includes("[")) return;
    routes.push(route);
  });
  return routes.sort();
}

/** The .tsx files this checks — the app's own, never the kit's. */
function sourceFiles() {
  const files = [];
  const collect = (file) => {
    if (!file.endsWith(".tsx")) return;
    const rel = relative(ROOT, file).split(sep).join("/");
    // components/ui/** is shadcn's code, not the app's. It is allowed to write
    // the primitives everybody else is told to use instead.
    if (rel.startsWith("components/ui/")) return;
    files.push(rel);
  };
  walk(join(ROOT, "app"), collect);
  walk(join(ROOT, "components"), collect);
  // 🚨 A module's components render to the same member on the same screen, and
  // every rule below is about what that member sees — contrast, hand-built
  // elements, an icon button nobody can name, a picture with no alt text. The
  // walk stopped at the core's two folders, so an installed community put ~20
  // member-facing components outside every UX rule in the app.
  //
  // The whole tree, installed or not: `ux-check` is what somebody runs before
  // saying a page is finished, and a module's component has to pass before
  // anybody installs it — the same reason `purity.test.ts` reads the tree
  // rather than the module list.
  walk(join(ROOT, "modules"), collect);
  return files.sort();
}

// ── Reporting ────────────────────────────────────────────────────────────────

let problems = 0;
let warnings = 0;

const fail = (what, why) => {
  problems++;
  console.log(`  ❌ ${what}\n     ${why}`);
};
const warn = (what, why) => {
  warnings++;
  console.log(`  ⚠️  ${what}\n     ${why}`);
};
const ok = (what) => console.log(`  ✓ ${what}`);

/** At most this many example lines per finding — the rest is a count. */
const EXAMPLES = 5;

function detail(hits, why) {
  const shown = hits
    .slice(0, EXAMPLES)
    .map((h) => `${h.file}:${h.line}  ${h.found}`)
    .join("\n     ");
  const more =
    hits.length > EXAMPLES ? `\n     … and ${hits.length - EXAMPLES} more` : "";
  return `${why}\n     ${shown}${more}`;
}

function report(hits, what, why) {
  if (hits.length === 0) return false;
  fail(`${what} (${hits.length})`, detail(hits, why));
  return true;
}

function reportWarning(hits, what, why) {
  if (hits.length === 0) return false;
  warn(`${what} (${hits.length})`, detail(hits, why));
  return true;
}

// ── 1 · Colours ──────────────────────────────────────────────────────────────

function checkContrast() {
  console.log("\nColours — can everything be read, in both modes?\n");

  const cssPath = join(ROOT, "app/globals.css");
  if (!existsSync(cssPath)) {
    // A finding, never a skip: neither the contrast pass nor the two-mode
    // pairing below can be MADE without this file, and an unmade check must not
    // be able to read as a clean one.
    fail(
      "app/globals.css is missing",
      "There are no design tokens to check — neither their contrast nor " +
        "whether each is defined in both modes.",
    );
    return;
  }

  const css = readFileSync(cssPath, "utf8");
  const tokens = parseTokens(css);
  let found = 0;

  for (const [mode, set] of [
    ["light", tokens.light],
    ["dark", tokens.dark],
  ]) {
    const block = mode === "light" ? ":root" : ".dark";
    if (Object.keys(set).length === 0) {
      found++;
      fail(
        `No tokens found for ${mode} mode`,
        `app/globals.css should define them in ${block}.`,
      );
      continue;
    }
    for (const [pairs, minimum, kind] of [
      [TEXT_PAIRS, 4.5, "text"],
      [RING_PAIRS, 3, "the focus ring"],
    ]) {
      for (const [fg, bg] of pairs) {
        // A token this app does not use is not a finding. A token it uses and
        // this cannot read is — see below.
        if (!set[fg] || !set[bg]) continue;
        const a = parseHsl(set[fg]);
        const b = parseHsl(set[bg]);
        if (!a || !b) {
          found++;
          warn(
            `--${fg} / --${bg} (${mode}) cannot be read`,
            `Expected hsl(H S% L%), as everything else in the file uses. ` +
              `Nothing is checking this pair.`,
          );
          continue;
        }
        const ratio = contrastRatio(a, b);
        if (ratio < minimum) {
          found++;
          fail(
            `--${fg} on --${bg} (${mode}): ${ratio.toFixed(2)}:1`,
            `WCAG 2.1 AA asks for ${minimum}:1 for ${kind}. Darken or lighten ` +
              `--${fg} in the ${block} block of app/globals.css — and then ` +
              `look at the other mode, which the same change usually breaks.`,
          );
        }
      }
    }
  }

  if (found === 0) ok("Every token pair is legible in light and dark");

  // ── Both blocks, always ────────────────────────────────────────────────────
  //
  // A `fail` rather than a `warn`, and there is no judgement call in it: a
  // token in one block only is mechanical, unambiguous and fails in the mode
  // nobody was looking at — silently, because the missing one inherits instead
  // of erroring.
  const unpaired = findUnpairedTokens(css).map((f) => ({
    file: "app/globals.css",
    line: f.line,
    found:
      f.kind === "emptyBlock"
        ? `${f.missingFrom} defines no tokens at all`
        : `--${f.token} is in ${f.presentIn} only, not in ${f.missingFrom}`,
  }));
  const compared = new Set([
    ...Object.keys(tokens.light),
    ...Object.keys(tokens.dark),
  ]).size;
  const excepted = Object.keys(MODE_SINGLE_TOKENS).length;
  if (
    !report(
      unpaired,
      "Tokens defined in one mode only",
      "Every token belongs in :root AND in .dark — a missing one inherits the " +
        "other mode's value, which is why this breaks in the mode nobody was " +
        "looking at. A token that legitimately has no dark answer goes on " +
        "MODE_SINGLE_TOKENS in scripts/ux/rules.mjs, with the reason beside it.",
    )
  ) {
    // Names what was counted: "nothing found" and "nothing looked at" have to
    // be different sentences.
    ok(
      `Every token is defined in both modes — ${compared} token(s) compared, ` +
        `${excepted} on the exception list`,
    );
  }
}

// ── 2 · The kit, 3 · keyboard, 4 · navigation ────────────────────────────────

function checkSources() {
  const palette = [];
  const raw = [];
  const unnamed = [];
  const noAlt = [];
  const bypasses = [];

  const files = sourceFiles();
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const hit of findPaletteClasses(source)) palette.push({ file, ...hit });
    for (const hit of findRawElements(source)) raw.push({ file, ...hit });
    for (const hit of findUnnamedIconButtons(source)) unnamed.push({ file, ...hit });
    for (const hit of findImagesWithoutAlt(source)) noAlt.push({ file, ...hit });
    // Each hit names the dial it bypasses — the finding is not "you wrote a
    // class", it is "you turned nothing".
    for (const hit of findDialBypasses(source)) {
      bypasses.push({ file, line: hit.line, found: `${hit.found}  → the ${hit.dial} dial` });
    }
  }

  console.log("\nThe kit — is the app using it, or working around it?\n");

  // 🚨 Zero files is a broken walk, not a clean tree. Every rule in this
  // section would report nothing, and the run would be green for the one reason
  // that must never look like a pass — so it fails, AND no `✓` line is printed
  // below: a green tick under "nothing was scanned" is the same sentence twice
  // in two colours.
  const scanned = files.length > 0;
  if (!scanned) {
    fail(
      "No source files were scanned",
      "sourceFiles() walks app/, components/ and modules/ for .tsx files and " +
        "found none. Nothing below was checked; this is not a clean tree.",
    );
  }
  const kit = [
    report(
      palette,
      "Hard-coded colours",
      "These do not follow into dark mode and are missed when the app is " +
        "recoloured. Use the tokens (bg-card, text-muted-foreground, bg-primary).",
    ),
    report(
      raw.filter((h) => h.kind === "hard"),
      "Raw elements the kit already covers",
      "components/ui/ has these, with focus rings, dark mode and consistent " +
        "spacing. Use <Button>, <Input>, <Select>, <Textarea>, <Table>.",
    ),
    report(
      noAlt,
      "Images without alt",
      'Every image needs alt text — alt="" if it is decoration, which is a ' +
        "decision and reads as one.",
    ),
    reportWarning(
      raw.filter((h) => h.kind === "soft"),
      "Hand-built controls",
      // ⚠️ This used to say "components/ui/ has none of these", which stopped
      // being true once the kit gained checkbox.tsx and radio-group.tsx — so the
      // one line meant to help was telling people the opposite of what to do.
      // The honest reason a native input survives is narrower and is in
      // CLAUDE.md: a form that must work WITHOUT JavaScript cannot use a Radix
      // control, because there is no hidden field behind it to post.
      "The kit ships <Checkbox> and <RadioGroup>, so reach for those first. " +
        "The exception is a plain-POST form that has to work without " +
        "JavaScript — then a native input styled from tokens is right, and " +
        "app/plans/page.tsx says so above its own. Anything the kit has no " +
        "answer for (a segmented control) is honest hand-work: keep it in " +
        "step, or npx shadcn@latest add toggle-group",
    ),
  ].some(Boolean);
  if (!kit && scanned) ok("No hand-built elements and no hard-coded colours");

  // A `fail` and not a `warn`, for two reasons that are not a free choice: this
  // is the boundary docs/design-system.md §8 declares closed, and the skill
  // `design` declares this command's green its OWN floor ("it must be green",
  // "ux-check green is the floor, in both modes"). A rule with no consequence
  // is not a boundary. Every hit has a one-line fix.
  const bypassed = report(
    bypasses,
    "Values written past a dial",
    "The design system has a short, closed list of dials — the accent, the " +
      "type, the radius, the elevation (docs/design-system.md §8). Each of " +
      "these writes a VALUE instead of turning one, so it survives no recolour " +
      "and follows into no mode. Turn the dial, or compose from what it gives.",
  );
  // Names what was counted, so that a green line cannot be read as "nobody
  // looked".
  if (!bypassed && scanned) {
    ok(`No value written past a dial — ${files.length} file(s) scanned`);
  }

  console.log("\nKeyboard and screen reader\n");
  const named = report(
    unnamed,
    "Icon buttons with no name",
    'A screen reader reads these as "button" and nothing else. Add an ' +
      'aria-label, or a <span className="sr-only"> beside the icon.',
  );
  if (!named && scanned) ok("Every icon button has a name");
}

function checkHomePage() {
  console.log("\nThe home page — does it sell the product?\n");

  const pagePath = join(ROOT, "app/page.tsx");
  if (!existsSync(pagePath)) {
    warn("app/page.tsx is missing", "There is no home page to check.");
    return;
  }

  const hits = findPlaceholderHome(readFileSync(pagePath, "utf8")).map((h) => ({
    file: "app/page.tsx",
    ...h,
  }));
  // A warning, never a failure: a test app keeps the placeholder legitimately,
  // and so does an app whose products do not exist yet.
  const found = reportWarning(
    hits,
    "The home page still carries the shipped placeholder",
    "The first page a stranger sees describes the template, not your product " +
      "— and swapped texts on the shipped structure are still the shipped " +
      "structure. The skill that builds the real one is: salespage " +
      "(docs/salespage.md).",
  );
  if (!found) ok("app/page.tsx is no longer the shipped placeholder");
}

function checkNavigation() {
  console.log("\nNavigation\n");

  const shellPath = join(ROOT, "components/app-shell.tsx");
  if (!existsSync(shellPath)) {
    warn(
      "components/app-shell.tsx is missing",
      "Cannot tell which pages are in the navigation.",
    );
    return;
  }
  const hrefs = navHrefs(readFileSync(shellPath, "utf8"));
  if (hrefs === null) {
    warn(
      "NAVIGATION not found in components/app-shell.tsx",
      "Cannot tell which pages are in the navigation.",
    );
    return;
  }

  // Plus the entries every installed module contributes. `components/app-shell.tsx`
  // splices `mergeModuleNav(…, MODULE_NAV)` in at runtime, which a text parser
  // cannot see — so without this the module's own pages are reported as being in
  // no menu, which is the false finding that would appear the moment the page
  // walk above was fixed on its own.
  const known = new Set(hrefs);
  for (const file of moduleNavFiles()) {
    const moduleHrefs = navHrefs(readFileSync(join(ROOT, file), "utf8"));
    if (moduleHrefs === null) {
      warn(
        `${file} declares no NAVIGATION`,
        "A module's nav file exports a menu under that name — `lib/modules/nav.ts` " +
          "says why. Its pages are about to be reported as unreachable.",
      );
      continue;
    }
    for (const href of moduleHrefs) known.add(href);
  }
  // A page reached from ANOTHER page is reached. This check's own sentence is
  // "reachable only by typing the address", and until now it never asked: a page
  // in no sidebar menu was reported whether or not something linked to it.
  //
  // ⚠️ Measured on the community, which is the first feature shaped this way: one
  // sidebar entry and a hub page with tiles to /feed, /messages, /moderation,
  // /people and /reports. All five are linked, none is in a menu, and reporting
  // them would have been five confident false findings — with `ux-check` exiting
  // non-zero. The right answer for that design is not "put six entries in the
  // sidebar".
  //
  // Only a real link counts: `href` in a `.tsx`, not any mention of the path. A
  // route named in a privacy section list or a comment is not a way in.
  const linkedFrom = new Set();
  for (const dir of ["app", "components", "modules"]) {
    walk(join(ROOT, dir), (file) => {
      if (!file.endsWith(".tsx")) return;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/href=(?:\{\s*)?["'`]([^"'`]+)["'`]/g)) {
        linkedFrom.add(match[1]);
      }
    });
  }

  const orphans = dashboardRoutes(join(ROOT, "app")).filter(
    (route) => !known.has(route) && !linkedFrom.has(route),
  );
  if (orphans.length === 0) {
    ok("Every page under /dashboard is in a menu or linked from another page");
    return;
  }
  fail(
    `Pages nothing leads to (${orphans.length})`,
    `Reachable only by typing the address — in no menu, and no page links to ` +
      `them. Two ways out: one line in NAVIGATION (components/app-shell.tsx, or ` +
      `the module's own nav.ts) plus the label in BOTH message files, or a link ` +
      `from the page this one belongs under:\n     ` +
      orphans.join("\n     "),
  );
}

// ── The run ──────────────────────────────────────────────────────────────────

function main() {
  checkContrast();
  checkSources();
  checkHomePage();
  checkNavigation();

  console.log("");
  if (problems > 0) {
    console.log(
      `❌ ${problems} thing(s) to fix` +
        (warnings > 0 ? `, and ${warnings} worth looking at.` : "."),
    );
    console.log("   The guided path is the skill: ux-gateway\n");
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(`⚠️  ${warnings} thing(s) worth looking at. Nothing blocking.\n`);
    return;
  }
  console.log(
    "✓ Nothing measurable is wrong.\n" +
      "  That means the countable things are counted, not that the app is good —\n" +
      "  the first five minutes, the wording and the dead ends are ux-gateway's.\n",
  );
}

// Run only when this file IS the command. Compared as a resolved path rather
// than by name: three other scripts in this project are also called check.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
