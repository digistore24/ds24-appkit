// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `node run.mjs brand` — take this app's look from the operator's own brand.
//
// Two subcommands, one name (the `module add|list|check|sync` shape):
//
//   brand colors [--css f]… [--url https://…] [--hex #RRGGBB] [--apply] [--json]
//   brand icons  [--logo file] [--logo-dark file] [--apply] [--json]
//   brand        with --logo: both
//
// **Dry run by default; `--apply` writes.** Six committed files and a stylesheet
// full of load-bearing comments are not something to overwrite because somebody
// typed a command — the `user-create` / `export-core` convention, not the
// `ds24-sync` one.
//
// The JUDGEMENT half is not here and must not move here: which of two candidate
// colours is really the brand, whether the customer is happy with the
// adjustment, whether the mark reads at 24 px. That is the skill `design`.
// This command answers only the questions with a right answer.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { parseHsl, parseTokens, rgbToHex } from "../ux/rules.mjs";
import { parseColorLiteral, rgbToHsl, toHslToken } from "./colors.mjs";
import { extractBrandColors, darkTwinOf } from "./rank.mjs";
import { readSite } from "./fetch-site.mjs";
import { adjustAccent } from "./contrast.mjs";
import { replaceTokens } from "./write-tokens.mjs";
import { readLogo, renderIcons } from "./render.mjs";

const ROOT = process.cwd();
const GLOBALS = join(ROOT, "app", "globals.css");
const BRAND_CONFIG = join(ROOT, "config", "brand.json");

// No ANSI colour, deliberately: `scripts/ux/check.mjs` and `scripts/dev/doctor.mjs`
// mark their lines with symbols and nothing else, and a Git Bash on Windows is
// the narrower terminal to write for. Same vocabulary as those two, so somebody
// who has read one of those reports can read this one.
const ok = (s) => s;
const warn = (s) => s;
const bad = (s) => s;
const dim = (s) => s;

function parseArgs(argv) {
  const args = { css: [], apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--json") args.json = true;
    else if (a === "--css") args.css.push(argv[++i]);
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--hex" || a === "--color") args.hex = argv[++i];
    else if (a === "--logo") args.logo = argv[++i];
    else if (a === "--logo-dark") args.logoDark = argv[++i];
    else if (!a.startsWith("-") && !args.sub) args.sub = a;
  }
  return args;
}


/** One adjusted mode, printed the way the skill quotes it back to the user. */
function reportMode(label, result) {
  if (!result.ok) {
    console.log(`  ${bad("✗")} ${label}: ${result.reason}`);
    return;
  }
  const token = toHslToken(result.primary);
  const hex = rgbToHex(parseHsl(token));
  const changed = result.changed
    ? `lightness ${result.lightnessFrom}% → ${result.lightnessTo}%` +
      (result.saturationFrom !== result.saturationTo
        ? `, saturation ${result.saturationFrom}% → ${result.saturationTo}%`
        : "")
    : "unchanged — your colour passes as it is";

  console.log(`  --primary (${label})  ${token}  ${dim(hex)}`);
  console.log(`      ${changed}`);

  if (result.forcedBy && result.changed) {
    // Only when the COLOUR moved. Saying "why" under "unchanged" reads as a
    // contradiction, and it was one: the pair below is measured against the
    // brand colour with the first candidate foreground, so it can be red even
    // when the answer was simply the OTHER foreground.
    console.log(
      dim(
        `      why: ${result.forcedBy.fg} on ${result.forcedBy.bg} was ` +
          `${result.forcedBy.ratio.toFixed(1)}:1, and ${result.forcedBy.min}:1 is the floor`,
      ),
    );
  } else if (result.forcedBy) {
    console.log(
      dim(
        `      the text ON it had to be the dark one rather than the light one — ` +
          `your colour itself is untouched`,
      ),
    );
  }
  if (result.shift === "far") {
    console.log(
      warn(
        `      ⚠ that is ${result.lightnessShift} points of lightness. Same hue, but nobody would\n` +
          `        call it the same colour. The honest alternative is to keep your tone for\n` +
          `        surfaces and let the accent be a deeper relative of it — your call.`,
      ),
    );
  }
  const worst = [...result.ratios].sort((a, b) => a.ratio / a.min - b.ratio / b.min)[0];
  console.log(
    dim(`      after: every pair passes, tightest ${worst.fg}/${worst.bg} at ${worst.ratio.toFixed(1)}:1`),
  );
}

async function gatherCss(args) {
  const pieces = [];
  const read = [];
  let themeColor = null;

  for (const file of args.css) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) {
      console.log(`  ${bad("✗")} ${file} — no such file`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    pieces.push(text);
    read.push(`${file} (${Math.round(text.length / 1024)} KB)`);
  }

  if (args.url) {
    console.log(`  ${dim("→")} fetching ${args.url}`);
    const site = await readSite(args.url);
    if (site.failed) {
      console.log(`  ${bad("✗")} ${site.failed}`);
    } else {
      for (const s of site.sources) {
        console.log(dim(`      read ${s.url} (${Math.round(s.bytes / 1024)} KB)`));
      }
      console.log(
        dim(
          `      That host learns an IP asked for public pages. Nothing about this\n` +
            `      app, its .env or its customers is sent.`,
        ),
      );
      for (const note of site.notes) console.log(warn(`      ${note}`));
      pieces.push(site.css);
      themeColor = site.themeColor ?? null;
      read.push(`${args.url} (${site.sources.length} document(s))`);
      if (site.logoCandidates?.length) {
        console.log(dim(`      the site's own mark is at:`));
        for (const url of site.logoCandidates.slice(0, 3)) console.log(dim(`        ${url}`));
        console.log(
          dim(`      Not downloaded — whose image that is, is not visible from here.`),
        );
      }
    }
  }

  return { css: pieces.join("\n"), read, themeColor };
}

async function runColors(args) {
  console.log("\nReading your brand");

  let brandHsl = null;
  let source = "";

  if (args.hex) {
    const rgb = parseColorLiteral(args.hex);
    if (!rgb) {
      console.log(`  ${bad("✗")} "${args.hex}" is not a colour this can read`);
      return 1;
    }
    brandHsl = rgbToHsl(rgb);
    source = args.hex;
    console.log(`  ${ok("✓")} the colour you gave: ${args.hex}`);
  }

  let extraction = null;
  if (!brandHsl) {
    const { css, read, themeColor } = await gatherCss(args);
    if (!css.trim()) {
      console.log(`  ${bad("✗")} nothing to read. Give it --css <file>, --url <address> or --hex <colour>.`);
      return 1;
    }
    for (const r of read) console.log(`  ${ok("✓")} ${r}`);

    extraction = extractBrandColors(css, { themeColor });
    if (extraction.compiled) {
      console.log(
        warn(
          `  ⚠ this looks like a COMPILED stylesheet (Tailwind or Bootstrap output).\n` +
            `    It contains every palette colour once, so how often a colour appears\n` +
            `    means nothing — the ranking below uses names only.`,
        ),
      );
    }
    if (extraction.unread.length) {
      const total = extraction.unread.reduce((n, u) => n + u.count, 0);
      console.log(
        dim(
          `  ${total} value(s) could not be read (${extraction.unread.slice(0, 3).map((u) => u.value).join(", ")}` +
            `${extraction.unread.length > 3 ? ", …" : ""}) — composed at run time, not counted`,
        ),
      );
    }

    if (!extraction.accents.length) {
      console.log(`  ${bad("✗")} no colour in there looks like a brand accent.`);
      console.log(
        dim(
          `    A brand that lives only in a background image, an SVG or a gradient is\n` +
            `    invisible to this. Give it --hex with the colour instead.`,
        ),
      );
      return 1;
    }

    console.log("\nThe colours it found");
    extraction.accents.slice(0, 4).forEach((c, i) => {
      const hex = rgbToHex(c.rgb);
      const names = c.names.length ? ` ${c.names.join(" ")}` : "";
      console.log(
        `  ${i + 1}  ${hex}  ${toHslToken(c.hsl)}${names}  ${c.count}x` +
          (i === 0 ? `  ${ok("★ accent")}` : ""),
      );
      if (c.why.length) console.log(dim(`     ${c.why.join("; ")}`));
    });

    brandHsl = extraction.accents[0].hsl;
    source = rgbToHex(extraction.accents[0].rgb);
  }

  const css = readFileSync(GLOBALS, "utf8");
  const tokens = parseTokens(css);

  // A dark twin the site already solved beats anything derived here.
  let darkSeed = brandHsl;
  if (extraction) {
    const twin = darkTwinOf(extraction.accents[0], [...extraction.accents, ...extraction.neutrals]);
    if (twin) {
      darkSeed = twin.hsl;
      console.log(
        dim(`\n  your site already has a dark-mode version of it (${rgbToHex(twin.rgb)}) — using that as the starting point for dark`),
      );
    }
  }

  console.log("\nWhat that means for this app");
  const light = adjustAccent(brandHsl, "light", tokens.light);
  const dark = adjustAccent(darkSeed, "dark", tokens.dark);
  reportMode("light", light);
  reportMode("dark", dark);

  if (!light.ok || !dark.ok) {
    console.log(
      `\n  ${bad("Nothing written.")} That colour cannot carry text at this hue.\n` +
        `  Keep it for surfaces, and let the accent be a colour that can — the skill\n` +
        `  \`design\` will pick one with you.`,
    );
    return 1;
  }

  const blocks = {
    light: {
      primary: toHslToken(light.primary),
      "primary-foreground": toHslToken(light.foreground),
      ring: toHslToken(light.ring),
    },
    dark: {
      primary: toHslToken(dark.primary),
      "primary-foreground": toHslToken(dark.foreground),
      ring: toHslToken(dark.ring),
    },
  };

  if (args.json) {
    console.log(JSON.stringify({ source, blocks }, null, 2));
  }

  if (!args.apply) {
    console.log(`\n${dim("Nothing has been written. To apply it:")}`);
    console.log(`    node run.mjs brand colors ${process.argv.slice(3).join(" ")} --apply\n`);
    return 0;
  }

  const result = replaceTokens(css, blocks);
  if (result.error) {
    console.log(`\n  ${bad("✗")} ${result.error}`);
    return 1;
  }
  writeFileSync(GLOBALS, result.css);
  console.log(`\n  ${ok("✓")} app/globals.css — ${result.replaced.length} token(s)`);
  console.log(dim(`    next:  git diff app/globals.css`));
  console.log(dim(`           node run.mjs ux-check`));
  if (existsSync(join(ROOT, "docs", "design.md"))) {
    console.log(dim(`           record the new values in docs/design.md § Tokens`));
  }
  return 0;
}

async function runIcons(args) {
  if (!args.logo) {
    console.log(`\n  ${bad("✗")} which logo? Give it --logo public/brand/logo.svg`);
    return 1;
  }

  console.log("\nThe logo");
  const logo = await readLogo(resolve(ROOT, args.logo));
  if (logo.error) {
    console.log(`  ${bad("✗")} ${logo.error}`);
    return 1;
  }
  console.log(
    `  ${ok("✓")} ${args.logo} — ${logo.vector ? "vector" : logo.format}, ${logo.width} × ${logo.height}`,
  );
  for (const w of logo.warnings) console.log(warn(`  ⚠ ${w}`));

  const rendered = await renderIcons(logo);
  if (rendered.error) {
    console.log(`  ${bad("✗")} ${rendered.error}`);
    return 1;
  }

  console.log(`\n${args.apply ? "Writing" : "Would write (nothing has been written)"}`);
  for (const icon of rendered.icons) {
    console.log(
      `  ${icon.file.padEnd(36)} ${String(icon.size).padStart(4)} × ${String(icon.size).padEnd(4)} ` +
        dim(icon.padding ? `artwork ${Math.round(icon.size * 0.6)} px centred, ~20 % padding` : icon.what),
    );
  }

  // The mark itself is copied into public/brand/ so <BrandMark> can serve it,
  // and config/brand.json is filled in — the two have to happen together or the
  // config names a file nobody put there (brand-mark.test.ts fails on that).
  const target = join(ROOT, "public", "brand", `logo${args.logo.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png"}`);
  const rel = `/brand/${target.split(/[\\/]/).pop()}`;
  console.log(`  ${relative(ROOT, target).padEnd(36)} ${dim("the mark in the header and on /login")}`);
  console.log(`  ${"config/brand.json".padEnd(36)} ${dim(`logo: "${rel}", ${logo.width} × ${logo.height}`)}`);

  if (!args.apply) {
    console.log(`\n${dim("To apply it:")}`);
    console.log(`    node run.mjs brand icons --logo ${args.logo} --apply\n`);
    return 0;
  }

  for (const icon of rendered.icons) {
    const path = join(ROOT, icon.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, icon.bytes);
  }

  mkdirSync(dirname(target), { recursive: true });
  if (logo.vector) {
    // LF: portability.test.ts walks .svg and fails on CRLF anywhere in the tree.
    writeFileSync(target, logo.bytes.toString("utf8").replace(/\r\n?/g, "\n"));
  } else if (resolve(ROOT, args.logo) !== target) {
    copyFileSync(resolve(ROOT, args.logo), target);
  }

  // 🚨 The dark mark goes through the SAME two steps as the light one — copied
  // into `public/brand/`, and named by its `/brand/…` path. It used to write the
  // caller's raw argument straight into the config, which failed twice at once:
  // `lib/brand.ts` silently drops anything that is not `/brand/*.{svg,png,webp}`
  // (so the dark mark never appeared, with no word said), and
  // `components/brand-mark.test.ts` fails on a config naming a file nobody put
  // there — so a customer following the documented step in the `design` skill
  // could no longer commit, on a rule `CLAUDE.md` makes the commit condition.
  let darkRel = null;
  if (args.logoDark) {
    const ext = args.logoDark.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png";
    const darkTarget = join(ROOT, "public", "brand", `logo-dark${ext}`);
    darkRel = `/brand/${darkTarget.split(/[\\/]/).pop()}`;
    if (!/\.(svg|png|webp)$/i.test(ext)) {
      console.error(`\n  ✗ --logo-dark must be an .svg, .png or .webp (got "${args.logoDark}")`);
      return 1;
    }
    mkdirSync(dirname(darkTarget), { recursive: true });
    if (resolve(ROOT, args.logoDark) !== darkTarget) {
      copyFileSync(resolve(ROOT, args.logoDark), darkTarget);
    }
  }

  const config = JSON.parse(readFileSync(BRAND_CONFIG, "utf8"));
  config.logo = rel;
  config.logoWidth = logo.width;
  config.logoHeight = logo.height;
  if (darkRel) config.logoDark = darkRel;
  writeFileSync(BRAND_CONFIG, `${JSON.stringify(config, null, 2)}\n`);

  console.log(`\n  ${ok("✓")} ${rendered.icons.length + 2} file(s) written`);
  console.log(dim(`    next:  node run.mjs start, then look at /login and the sidebar`));
  console.log(dim(`           and at the icon: Chrome → Install app`));
  return 0;
}

const HELP = `
node run.mjs brand — take this app's look from your own brand

  brand colors --css <file>       read a stylesheet you already have
               --url <https://…>  read your own website (fetches it — see below)
               --hex "#1F6F4A"    just the colour, if you know it
  brand icons  --logo <file>      the five app icons, from one logo (png or svg)
               --logo-dark <file> a second mark for dark mode, when the first
                                  one disappears on a dark ground (optional)

  --apply   write it. Without this nothing is written and you see what would be.
  --json    the result as data, for an agent.

The colour is contrast-checked in BOTH modes before it is written: your hue is
never changed, the lightness is moved only as far as readability needs, and the
report says by how much and why. A colour that cannot carry text at any
lightness is refused rather than written.

--url fetches the address you give it. That host learns an IP asked for its
public pages; nothing about this app or its customers is sent.
`;

export async function run(argv) {
  const args = parseArgs(argv);
  if (args.sub === "help" || argv.includes("--help")) {
    console.log(HELP);
    return 0;
  }

  if (args.sub === "colors" || args.sub === "colours") return runColors(args);
  if (args.sub === "icons") return runIcons(args);

  // No subcommand: do what the arguments imply.
  if (args.logo && (args.css.length || args.url || args.hex)) {
    const code = await runColors(args);
    return code || runIcons(args);
  }
  if (args.logo) return runIcons(args);
  if (args.css.length || args.url || args.hex) return runColors(args);

  console.log(HELP);
  return 0;
}

const code = await run(process.argv.slice(2));
process.exitCode = code;
