// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The app's mark: the operator's logo where there is one, the letter tile where
// there is not.
//
// No `"use client"` on purpose. There are no hooks here, so the file is
// importable from the client tree (`components/app-shell.tsx`) and the server
// tree (`/login`, `/account/confirm-email`, `components/public-header.tsx`)
// alike. A component consumed by a `"use client"` file looks like a client
// component to the next reader — it is not, and it does not need to be.
//
// ── The tile is ink, not the accent, and that is a decision ────────────────
// It used to be `bg-primary text-primary-foreground`. A filled accent square
// with a letter in it IS the shadcn/v0 logo — two apps built by two strangers
// wore the same one — and spending the brand colour on a PLACEHOLDER is why
// `--primary` read as decoration rather than as "this is interactive". Ink for
// the mark, accent for interaction. `foreground`/`background` is the first pair
// `scripts/ux/rules.mjs` measures, so the contrast comes for free.
//
// ── What is IN the tile is a monogram, and that is also a decision ─────────
// The argument above did not change; what changed is the letterform. It used to
// be `appName.slice(0, 1)` — one character at a size chosen for one character,
// sitting small in a near-square box, which is the shape of something nobody
// got to rather than something chosen. Now it is the initials of the name's
// WORDS (`lib/initials.ts`): "Kraft Werk" is KW, "Kraftwerk" is K. One letter
// per word is what a monogram IS; two letters out of one word would be an
// abbreviation and read as one — and per-word is also what every workspace mark
// somebody has already met does.
//
// 🚨 `slice(0, 1)` was a defect and not merely a simplification: on a name
// beginning outside the basic plane it returns a lone high surrogate, which the
// browser draws as the replacement character. An app name is
// `NEXT_PUBLIC_APP_NAME`, typed by whoever set the `.env`.
//
// The tile stays a SQUARE with a soft corner, deliberately, and the reason is
// twenty pixels away: the user avatar in `components/app-shell.tsx` is a round
// 28 px badge with a person's initials in it. A round brand mark with initials
// in it would be the same object twice in one header row, and whichever of the
// two somebody clicked would be a coin toss. Square is what tells them apart.
//
// ── The SVG, and why it is safe here and nowhere else ──────────────────────
// 🚨 `CLAUDE.md` § Media: no SVG on the upload path, at any door, for any role,
// because it is a document that can carry script. The operator's own logo is
// the ONE exception in this app, and it is bounded on both sides:
//
//   · **Rendering** — only ever `<img src>`. A browser renders an SVG
//     referenced by `<img>` in secure static mode: its script does not run and
//     its external references are not fetched. `<object>`, `<embed>`,
//     `<iframe>`, `dangerouslySetInnerHTML` and importing the file into JSX all
//     render it as a DOCUMENT, and all five DO execute it.
//   · **Serving** — `next.config.ts` puts `Content-Security-Policy:
//     default-src 'none'; sandbox` on `/brand/:path*`, which is the half `<img>`
//     cannot cover: somebody navigating straight to `/brand/logo.svg` gets the
//     file as a document, and without that header its script would run on this
//     app's own origin.
//
// `components/brand-mark.test.ts` fails the build on either half slipping.
//
// **Not `next/image`, and this is a decision rather than an omission.** Next
// refuses to optimise an SVG unless `dangerouslyAllowSVG` is set — and that
// switch is precisely what this file exists not to need. A component with one
// branch per file extension is a rule that gets got wrong; one `<img>` for
// every brand asset is a rule that cannot be. `components/ui/figure.tsx` takes
// a bare `<img>` for its own reason and says so at the same length. Nothing is
// being bypassed: a logo is kilobytes, served from this app's own origin.
import Link from "next/link";

import { brand } from "@/lib/brand";
import { initialsFrom } from "@/lib/initials";
import { cn } from "@/lib/utils";

/** The two geometries this app has. A third size is a third entry, not a prop. */
const SIZES = {
  // The `h-14` brand row in the sidebar and the public header — this is the one
  // that carries the app: three of the five call sites, so every page of it.
  sm: { tile: "size-6 rounded-md", one: "text-sm", two: "text-[10px]", mark: "h-6" },
  // Centred above the heading on `/login` and `/account/confirm-email`, where the
  // mark stands ALONE with no app name beside it. Same mark, more of it — the
  // two entries are two SIZES and not two roles, which is the reading the
  // comment above has always had and this letterform did not change. The `mark`
  // half scales the operator's logo and can only ever mean a size; a tile that
  // branched by role would make one prop mean two things depending on which
  // branch ran, and an app would wear two different marks on two of its pages.
  lg: { tile: "size-9 rounded-lg", one: "text-xl", two: "text-sm", mark: "h-9" },
} as const;
// Each entry carries TWO type sizes, and that is the whole geometry work.
// Measured in the browser at both sizes, glyph width against tile width: one
// letter and two letters cannot share a size. At a size that lets "WW" breathe
// a lone "K" is a speck in the middle of a box, and at a size that fills the
// tile for "K" the widest two-letter monograms — WW, MW, AW — run into the
// rounded corners. So: 37 % fill for one letter, 67–80 % for two, at both
// sizes.
//
// ⚠️ `text-[10px]` is the arbitrary value this file already carried and it is
// kept rather than added; the other three are scale steps. A size is outside
// the four forms `node run.mjs ux-check` counts as written past a dial (a
// colour, a font, a shadow, a hex), so this is a note for the next reader
// rather than a finding — and there is no `--size` dial for it to bypass.
//
// The corner follows the radius dial through the scale and is ~25 % of the edge
// at both sizes (6 px on 24, 8 px on 36), so turning `--radius` turns the mark
// along with everything else rather than leaving it behind at a value of its own.

export interface BrandMarkProps {
  /**
   * The app's name.
   *
   * A required prop, never read from `@/lib/app` in here. `AppShell` already
   * threads it down, and a second independent read would be a second source for
   * one fact in the tree that deliberately has one.
   */
  appName: string;
  size?: keyof typeof SIZES;
  className?: string;
  /**
   * A name for the mark, for the case where nothing beside it says where this
   * leads.
   *
   * Left unset the mark is DECORATIVE (`alt=""` + `aria-hidden`), which is
   * correct at all four shipped call sites: two render the app's name right
   * next to it, two put the page's `<h1>` directly underneath. Announcing it
   * there would make a screen reader say the name twice.
   *
   * ⚠️ Given one, it is a SENTENCE a person hears — so it belongs in
   * `messages/de.json` AND `messages/en.json`, never as a literal here.
   */
  label?: string;
}

/** The mark itself, without a link around it. */
export function BrandMark({
  appName,
  size = "sm",
  className,
  label,
}: BrandMarkProps) {
  const { logo, logoDark, width, height } = brand();
  const geometry = SIZES[size];
  // ⚠️ Written out at every <img> below rather than spread in from here.
  // `findImagesWithoutAlt()` in `scripts/ux/rules.mjs` reads JSX as TEXT, so an
  // `alt` arriving through `{...props}` is an `alt` it cannot see — and it was
  // right to complain: an empty alt is a DECISION, and a decision hidden behind
  // a spread is one the next reader cannot check.
  const alt = label ?? "";
  const hidden = label ? undefined : true;

  if (!logo) {
    const monogram = initialsFrom(appName);
    // 🚨 Count CODE POINTS, not `.length`. "𝕏" is one character and two UTF-16
    // units, so `monogram.length > 1` would set the two-letter size for a
    // one-letter mark — the same bug class the initials themselves have.
    const twoLetters = [...monogram].length > 1;
    return (
      <span
        aria-hidden={label ? undefined : true}
        aria-label={label}
        role={label ? "img" : undefined}
        className={cn(
          "bg-foreground text-background grid shrink-0 place-items-center font-bold tracking-tight",
          geometry.tile,
          twoLetters ? geometry.two : geometry.one,
          className,
        )}
      >
        {monogram}
      </span>
    );
  }

  // Light/dark is CSS, never `useTheme()`. next-themes sets the class on <html>
  // BEFORE React hydrates (app/layout.tsx says so at `suppressHydrationWarning`),
  // so a JS swap would be a hydration mismatch plus a visible flash of the wrong
  // mark. With no dark file there is ONE <img> and no variant classes — the same
  // file must not be fetched twice.
  const shared = cn("w-auto shrink-0", geometry.mark, className);

  if (!logoDark) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- see the file
         header: next/image cannot carry an SVG without `dangerouslyAllowSVG`,
         and that switch is what this component exists not to need. */
      <img
        src={logo}
        alt={alt}
        aria-hidden={hidden}
        width={width}
        height={height}
        className={shared}
      />
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- see the file header */}
      <img
        src={logo}
        alt={alt}
        aria-hidden={hidden}
        width={width}
        height={height}
        className={cn(shared, "dark:hidden")}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- see the file header */}
      <img
        src={logoDark}
        alt={alt}
        aria-hidden={hidden}
        width={width}
        height={height}
        className={cn(shared, "hidden dark:block")}
      />
    </>
  );
}

/**
 * The mark plus the app's name, as a link — the shell's and the public
 * header's brand row.
 *
 * The name stays beside the mark even when there is a logo. A wordmark that
 * replaces the app's name is a different decision (and a different asset); the
 * name next to the mark is also what makes the mark decorative, which is the
 * whole reason there are no new i18n keys here.
 */
export function BrandLink({
  appName,
  href,
  className,
}: {
  appName: string;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 font-semibold tracking-tight",
        className,
      )}
    >
      <BrandMark appName={appName} />
      <span className="truncate">{appName}</span>
    </Link>
  );
}
