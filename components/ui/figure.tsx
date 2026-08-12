// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// An image on a page, which cannot be written without saying what it shows.
//
// ── Why this is a type and not a lint rule ─────────────────────────────────
// "Images with no `alt`" is the single most common finding the `ux-gateway`
// skill reports, and a finding is something somebody has to run a check to
// discover and then go back and fix. Here it is a compile error: there is no
// way to render this component without either writing the alternative text or
// saying, in as many characters, that the image is decoration. The finding
// becomes impossible rather than merely detected.
//
// **`decorative` is not a way out.** It is the correct answer for an image that
// carries no information a sighted reader gets — a divider, a texture, a
// pattern behind a heading — and for those an empty `alt` is what a screen
// reader needs, because announcing "decorative-swoosh.png" is worse than
// silence. It is the wrong answer for anything a reader would miss, and the two
// cases are told apart by whoever is writing the page, which is the only place
// they can be told apart.
//
// ── Why `next/image`, and the one case where it is a wrapper around nothing ──
// Sizing. An app that hands a phone the 4 MB photo somebody took on a phone is
// the finding `performance-gateway` reports next, and on this app's OWN origin
// `next/image` resizes on demand.
//
// For BUCKET media it cannot: `next.config.ts` declares no
// `images.remotePatterns` (two reasons, written out there), so anything remote is
// already `unoptimized` — `next/image` then emits one `<img>` with the address it
// was given and no `srcset` at all. That is the case `srcSet` below is for: the
// narrower copies are derived at UPLOAD (`lib/media/variants.ts`, with the
// `sharp` this app now declares explicitly rather than inheriting from Next's
// hoist) and their addresses are minted on the server
// (`lib/media/url.ts` → `mediaImageFor()`), because a `next/image` `loader` is a
// FUNCTION and a function does not cross into a client component.
//
// So there are two branches, and which one runs is derived rather than chosen by
// a caller — see `isRemote` below.
import Image from "next/image";

import { cn } from "@/lib/utils";

type FigureBase = {
  src: string;
  width: number;
  height: number;
  className?: string;
  /** A visible caption. Rendered as a `<figcaption>`, and NOT a substitute for `alt`. */
  caption?: string;
  /**
   * Render at natural size without Next's optimiser.
   *
   * For an image that is already exactly the size it is shown at. Costs the
   * resizing.
   *
   * **`true` only, deliberately.** Anything not on this app's own origin is
   * already `unoptimized` by default (see below) because `next.config.ts`
   * declares no `remotePatterns` — so passing `false` for a bucket URL would
   * hand `/_next/image` a host it will refuse with a 400, in production only.
   * There is no host it can be told about, so there is nothing a `false` here
   * could correctly mean.
   */
  unoptimized?: true;
  priority?: boolean;
  sizes?: string;
  /**
   * The narrower copies a browser may fetch instead — `mediaImageFor().srcSet`.
   *
   * **Only used on the remote branch, and it is a whole string rather than a
   * list on purpose:** every candidate is a signed address minted on the server
   * beside the `src`, so composing it here would mean composing it twice.
   * `mediaImageFor()` returns `null` when there is nothing to choose from — a
   * picture with no variants, one whose pixel width was never measured, the local
   * driver — and `null` renders exactly what this component rendered before.
   *
   * ⚠️ **Pass `sizes` with it.** Without one a browser assumes `100vw`, which on
   * a picture laid out in a narrow column picks a candidate two steps too wide.
   * It is not made required because `next/image` treats it as optional too and a
   * second, stricter rule on one branch would be a trap of its own.
   */
  srcSet?: string | null;
};

/**
 * Either say what it shows, or say that it shows nothing.
 *
 * The union is what produces the compile error: neither branch is satisfied by
 * an object with no `alt` and no `decorative`.
 */
export type FigureProps = FigureBase &
  (
    | { alt: string; decorative?: false }
    | { decorative: true; alt?: never }
  );

export function Figure(props: FigureProps) {
  const { src, width, height, className, caption, priority, sizes, srcSet } = props;
  // `?? ""` because `alt` is typed `string` and arrives `null` anyway: a
  // `media` row's `alt` column is nullable, and `createMedia()` — the path
  // `docs/visuals.md` documents for selling a file — accepts a row without one.
  const alt = props.decorative ? "" : (props.alt ?? "").trim();

  // `alt=""` without `decorative` is the half-state this component exists to
  // prevent: the screen reader is told to skip it, but `aria-hidden` is not set
  // and the image is not declared decoration. The type cannot catch it — an
  // empty string satisfies `alt: string` — so the check is here.
  //
  // ── Why it does NOT throw in production ──────────────────────────────────
  // It used to, unguarded, while the comment beside it claimed "in development".
  // A `throw` inside a component is not a lint: React unwinds to the nearest
  // error boundary, so one image whose row happens to carry no alternative text
  // takes down the whole page — an Internal Server Error where the fault is a
  // missing sentence. That trades an accessibility defect for an availability
  // defect, and the second is worse for the same person: a screen-reader user
  // gets no page at all rather than one image they cannot perceive.
  //
  // So it is loud where somebody is building (`throw`, immediately, with the
  // fix in the message) and reported where somebody is using it: the page
  // renders, `node run.mjs errors` picks the line up out of the log, and
  // `ux-gateway` check 8 reports it against the running app.
  if (!props.decorative && alt === "") {
    const message =
      "Figure: `alt` is empty. Say what the picture shows, or mark it `decorative` " +
      `if it shows nothing a reader would miss. (src: ${src})`;
    if (process.env.NODE_ENV !== "production") throw new Error(message);
    console.error(`[figure] ${message}`);
  }

  // ── Why the optimiser is off for bucket media ────────────────────────────
  // `next.config.ts` declares no `remotePatterns`, for the two reasons written
  // out there. So anything not served from this app's own origin has to bypass
  // the optimiser, or Next answers 400. Derived from the URL rather than asked
  // for as a prop, because a caller who forgets it gets a broken image and no
  // explanation.
  const isRemote = /^https?:\/\//.test(src);
  const unoptimized = props.unoptimized ?? isRemote;

  // The plate and the shape are the same on both branches — a picture must not
  // look different depending on which driver stored it.
  const imageClassName = cn("h-auto max-w-full rounded-md bg-muted object-cover", className);

  const image =
    isRemote && srcSet ? (
      // eslint-disable-next-line @next/next/no-img-element -- The rule exists to
      // stop somebody bypassing Next's optimiser by accident. Here there is no
      // optimiser to bypass: `next.config.ts` declares no `images.remotePatterns`,
      // so this address is `unoptimized` either way and `next/image` would emit
      // one `<img>` with no `srcset`. The candidates come from
      // `lib/media/url.ts` → `mediaImageFor()`, derived at upload by
      // `lib/media/variants.ts` — which is the sizing the rule is really about,
      // done at a moment when the bytes are in hand rather than per request. Its
      // `loader` prop cannot carry them: a loader is a function, these addresses
      // are signed on the server, and a function does not cross into a client
      // component.
      <img
        src={src}
        srcSet={srcSet}
        // Without this a browser assumes the picture fills the viewport and picks
        // one candidate too wide. `100vw` is the honest default for a figure in a
        // page's own column; a caller laying one out narrower says so.
        sizes={sizes ?? "100vw"}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        // `next/image` sets both by itself; on this branch they are ours to set,
        // and leaving them off is a picture that blocks the first paint and one
        // that jumps when it arrives.
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={imageClassName}
        aria-hidden={props.decorative ? true : undefined}
      />
    ) : (
      <Image
        src={src}
        // Empty for a decorative image. That is the documented way to tell a
        // screen reader to skip an element — not a missing attribute, which makes
        // it read the filename out instead.
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        unoptimized={unoptimized}
        // `bg-muted` rather than nothing: a picture with a light background of
        // its own sitting on a dark page is the dark-mode finding this
        // template's own gateway looks for, and a neutral plate behind it is
        // what stops the transparent parts of a PNG from disappearing into the
        // page.
        className={imageClassName}
        // Decorative images are hidden from assistive technology entirely, which
        // is the other half of an empty `alt` — some readers announce an
        // `alt=""` image as "image" without it.
        aria-hidden={props.decorative ? true : undefined}
      />
    );

  if (!caption) return image;

  return (
    <figure className="space-y-2">
      {image}
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
