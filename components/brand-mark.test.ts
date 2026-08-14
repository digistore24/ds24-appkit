// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The SVG exception, kept honest.
//
// `CLAUDE.md` § Media says no SVG anywhere on the upload path, because an SVG
// is a document that can carry script. The operator's own logo under
// `public/brand/` is the ONE exception in this app, and an exception that is
// only written down is an exception that widens. This file is what stops it.
//
// It asserts the boundary from four sides, because each is a different way the
// rule could quietly stop holding:
//
//   1. the media pipeline never learns the brand folder exists
//   2. the upload refusal is still where it was
//   3. exactly one file in the app renders a brand asset
//   4. that file renders it as an IMAGE, and the server serves it as an inert
//      document
//
// Plus the boring one that catches the realistic mistake: a config naming a
// file nobody put there.
//
// 🚨 **Every scan goes through `blankComments()`, never a regex of its own.**
// This file itself is full of the strings it hunts for — `public/brand/` is in
// the paragraph you are reading. `CLAUDE.md` names the failure ("A checker that
// reads source as TEXT goes through blankComments()") and
// `scripts/lib/source-text.mjs` carries the measured post-mortem.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";
import { mediaConfig } from "@/lib/media/config";
import { sniffMime } from "@/lib/media/sniff";
import { brand, NO_BRAND } from "@/lib/brand";
import { notChecked } from "@/lib/test-not-checked";
import brandConfig from "@/config/brand.json";

const ROOT = process.cwd();

/** The one file allowed to RENDER a brand asset. */
const THE_RENDERER = "components/brand-mark.tsx";

/**
 * The one file allowed to JUDGE a brand asset path.
 *
 * Two files, two jobs, and the split is the point: `lib/brand.ts` decides
 * whether a path may be used at all (under the brand folder, no traversal, an
 * extension that is not a document), and this component decides how it reaches
 * the DOM. Anything else naming the path is a third opinion about one of those
 * two questions.
 */
const THE_READER = "lib/brand.ts";

/** Where a second renderer, or a leak into the media layer, could appear. */
const SEARCHED = ["app", "components", "lib", "modules"];

const CODE = /\.(ts|tsx|mjs|js|jsx)$/;

interface Hit {
  file: string;
  line: number;
}

/**
 * Every line under `dirs` matching `needle`, comments blanked.
 *
 * `extra` plants a line that is not on disk. 🚨 That parameter is what makes
 * the probes below probes: re-running the regex over a planted string by hand
 * would measure a COPY of this function rather than this function — the walk,
 * the extension filter, the `.test.` exclusion and the blanking would all go
 * unexercised, and a scan that silently matches nothing would still look green.
 */
function scan(
  needle: RegExp,
  dirs: string[] = SEARCHED,
  extra?: { file: string; source: string },
): Hit[] {
  const hits: Hit[] = [];

  const consider = (file: string, source: string) => {
    // A test is allowed to name what it forbids — this file is the proof.
    if (file.includes(".test.")) return;
    const lines = blankComments(source).split("\n");
    lines.forEach((line, i) => {
      if (needle.test(line)) hits.push({ file, line: i + 1 });
    });
  };

  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (CODE.test(entry)) {
        consider(relative(ROOT, full), readFileSync(full, "utf8"));
      }
    }
  };

  for (const dir of dirs) walk(join(ROOT, dir));
  if (extra) consider(extra.file, extra.source);
  return hits;
}

const source = (file: string) =>
  blankComments(readFileSync(join(ROOT, file), "utf8"));

describe("the media pipeline knows nothing about the brand folder", () => {
  // If `lib/media/` ever reads the brand config or writes into `public/brand/`,
  // the two systems have met — and the exception stops being "a file the
  // operator put in their own repo" the moment an upload can land in it.
  const NEEDLE = /public\/brand|config\/brand\.json|@\/lib\/brand/;

  it("🚨 leaves no reference to the brand slot inside lib/media/", () => {
    const hits = scan(NEEDLE, ["lib/media", "modules"]);
    expect(
      hits,
      `A file in the media layer names the brand slot:\n` +
        hits.map((h) => `  ${h.file}:${h.line}`).join("\n") +
        `\nThat is the boundary in docs/design-system.md. The brand mark is a ` +
        `build-time file; nothing an upload can reach may know where it lives.`,
    ).toEqual([]);
  });

  it("would see one if there were one", () => {
    const planted = scan(NEEDLE, ["lib/media"], {
      file: "lib/media/planted.ts",
      source: 'const logo = "/public/brand/logo.svg";',
    });
    expect(planted).toEqual([{ file: "lib/media/planted.ts", line: 1 }]);
  });

  it("does not count a comment that explains the rule", () => {
    const planted = scan(NEEDLE, [], {
      file: "lib/media/commented.ts",
      source: "// never reference public/brand from here\nconst x = 1;",
    });
    expect(planted).toEqual([]);
  });
});

describe("the upload refusal is still where it was", () => {
  // Deliberately a duplicate of lib/media/config.test.ts. This is the file
  // somebody opens when they want to WIDEN the exception ("we already allow one
  // SVG…"), so the sentence that says no belongs under their nose here too.
  it("🚨 admits image/svg+xml for no kind", () => {
    for (const [kind, rules] of Object.entries(mediaConfig().kinds)) {
      expect(rules.mimeTypes, `kind "${kind}"`).not.toContain("image/svg+xml");
    }
  });

  it("🚨 does not recognise an SVG from its bytes either", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffMime(svg)).toBeNull();
  });
});

describe("exactly one file renders a brand asset", () => {
  const NEEDLE = /["'`]\/brand\//;

  it("🚨 names /brand/ nowhere but the brand mark and its reader", () => {
    const others = scan(NEEDLE).filter(
      (h) => h.file !== THE_RENDERER && h.file !== THE_READER,
    );
    expect(
      others,
      `A second renderer of the brand asset:\n` +
        others.map((h) => `  ${h.file}:${h.line}`).join("\n") +
        `\nThe <img>-only rule is enforceable because there is ONE place to ` +
        `enforce it. Render <BrandMark> instead.`,
    ).toEqual([]);
  });

  it("would see a second one if there were one", () => {
    const planted = scan(NEEDLE, [], {
      file: "app/somewhere/page.tsx",
      source: '<object data="/brand/logo.svg" />',
    });
    expect(planted).toEqual([{ file: "app/somewhere/page.tsx", line: 1 }]);
  });
});

describe("the brand mark renders an SVG as an image, never as a document", () => {
  // `<img>` is the whole mitigation on the rendering side: a browser runs an
  // SVG referenced by <img> in secure static mode. Each of these five renders
  // it as a DOCUMENT instead, and all five execute its script.
  const EXECUTING = [
    ["<object>", /<object[\s>]/],
    ["<embed>", /<embed[\s>]/],
    ["<iframe>", /<iframe[\s>]/],
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["an SVG imported into JSX", /from\s+["'][^"']*\.svg["']/],
  ] as const;

  it.each(EXECUTING)("🚨 does not use %s", (_name, needle) => {
    expect(needle.test(source(THE_RENDERER))).toBe(false);
  });

  it("🚨 does not reach for next/image", () => {
    // next/image refuses an SVG unless `dangerouslyAllowSVG` is set, and that
    // switch is exactly what the <img> rule exists not to need.
    expect(/from\s+["']next\/image["']/.test(source(THE_RENDERER))).toBe(false);
  });

  it("uses <img>", () => {
    expect(/<img[\s>]/.test(source(THE_RENDERER))).toBe(true);
  });
});

describe("the server serves a brand asset as an inert document", () => {
  // The half <img> cannot cover: somebody NAVIGATING to /brand/logo.svg gets
  // the file as a document on this app's own origin.
  const config = source("next.config.ts");

  it("🚨 never switches on dangerouslyAllowSVG", () => {
    expect(/dangerouslyAllowSVG/.test(config)).toBe(false);
  });

  it("🚨 sends a scripting-free CSP for /brand/", () => {
    expect(config).toMatch(/source:\s*["'`]\/brand\/:path\*["'`]/);
    expect(config).toMatch(/default-src 'none'/);
    expect(config).toMatch(/sandbox/);
  });
});

describe("config/brand.json does not lie", () => {
  // Widened on purpose: the SHIPPED file has `"logo": null`, so TypeScript
  // infers the literal type `null` and every check below would be dead code
  // against it. The point of these assertions is what happens once somebody
  // fills the file in.
  const config = brandConfig as {
    logo: string | null;
    logoDark: string | null;
    logoWidth: number | null;
    logoHeight: number | null;
  };
  const paths = [config.logo, config.logoDark].filter(
    (p): p is string => typeof p === "string",
  );

  it("names only files that are on disk", () => {
    for (const path of paths) {
      expect(
        existsSync(join(ROOT, "public", path)),
        `config/brand.json names ${path}, which is not in public/. A brand ` +
          `mark that 404s is a broken-image icon in the header of every page.`,
      ).toBe(true);
    }
  });

  it("keeps every asset under public/brand/ with an allowed extension", () => {
    for (const path of paths) {
      expect(path).toMatch(/^\/brand\/[^.]*\.(svg|png|webp)$/i);
    }
  });

  it("carries the dimensions whenever it carries a logo", () => {
    if (!config.logo) return;
    expect(config.logoWidth).toBeGreaterThan(0);
    expect(config.logoHeight).toBeGreaterThan(0);
  });

  it("ships with no logo — the letter tile is the shipped state", (ctx) => {
    // Not a preference: a template that shipped somebody's logo would ship it
    // into every app, so `config/brand.json` leaves it null.
    //
    // 🚨 But `node run.mjs brand icons --logo … --apply` is exactly what an app
    // is TOLD to run, and it fills this file in. Asserted flatly, this was a
    // shipped test that went red the moment a customer used a shipped feature —
    // and a red test is the commit condition in `CLAUDE.md`, so it stopped them
    // committing. Once the file names a logo there is no shipped state left to
    // check, and saying so out loud is the answer: the three assertions above
    // become live at the same moment and carry the claim from here on.
    if (config.logo) {
      return notChecked(
        ctx,
        `config/brand.json names a logo (${config.logo}), so this app is past ` +
          "the shipped state — `brand icons --apply` has run. What the TEMPLATE " +
          "ships cannot be measured from inside an app that has changed it.",
      );
    }
    expect(brand()).toEqual(NO_BRAND);
  });
});

describe("brand() falls towards no logo", () => {
  // The direction matters: the letter tile is always renderable, a half-
  // configured logo is a broken image on every page. Exercised through the
  // module's own validation by rewriting the JSON it reads.
  const read = async (config: unknown) => {
    const { resetModules, doMock } = await import("vitest").then((m) => ({
      resetModules: m.vi.resetModules,
      doMock: m.vi.doMock,
    }));
    resetModules();
    doMock("@/config/brand.json", () => ({ default: config }));
    const mod = await import("@/lib/brand");
    return mod.brand();
  };

  it.each([
    ["a path outside the brand folder", { logo: "/icons/icon-192.png", logoWidth: 192, logoHeight: 192 }],
    ["a traversal", { logo: "/brand/../../etc/passwd.png", logoWidth: 1, logoHeight: 1 }],
    ["an extension that can carry markup", { logo: "/brand/logo.html", logoWidth: 1, logoHeight: 1 }],
    ["a logo with no dimensions", { logo: "/brand/logo.svg" }],
    ["a logo with a zero dimension", { logo: "/brand/logo.svg", logoWidth: 512, logoHeight: 0 }],
    ["nothing at all", {}],
  ])("resolves %s to no logo", async (_case, config) => {
    await expect(read(config)).resolves.toEqual(NO_BRAND);
  });

  it("accepts a complete entry", async () => {
    await expect(
      read({ logo: "/brand/logo.svg", logoWidth: 512, logoHeight: 128 }),
    ).resolves.toEqual({
      logo: "/brand/logo.svg",
      logoDark: null,
      width: 512,
      height: 128,
    });
  });
});
