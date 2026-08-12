// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Two branches and one compile error.
//
// ── The compile error is the component's whole reason for existing ──────────
// "Images with no `alt`" is the single most common finding `ux-gateway` reports,
// and here it is not a finding but a type error: `FigureProps` is a union, and
// neither arm is satisfied by an object carrying neither `alt` nor `decorative`.
// Story 26.2 adds a `srcSet` prop and a second render branch, and the one thing
// that must NOT happen is that guarantee weakening — so the guard below is a
// `@ts-expect-error`, which fails `npm run typecheck` if the error stops
// happening. A runtime test cannot express that at all.
//
// ── The branches ───────────────────────────────────────────────────────────
// A remote address WITH a `srcSet` renders a bare `<img srcset sizes>`, because
// bucket media is already `unoptimized` (`next.config.ts` declares no
// `remotePatterns`) and `next/image`'s `loader` is a function that cannot cross
// into a client component. Everything else keeps `next/image` untouched — the
// app's own origin, where the optimiser really does something, and a remote
// picture with no variants, which is every picture stored before 26.2.
//
// ⚠️ **`useEffect` does not run here** and there is no DOM: vitest runs with
// `environment: "node"`, so `renderToStaticMarkup` sees the first render and
// nothing after it. That is enough for markup a caller depends on, which is what
// `media-upload.test.ts` says for its own case.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Figure, type FigureProps } from "./figure";

const REMOTE = "https://bucket.example/community/post/2026/08/m1.jpg?sig";
const SRCSET =
  "https://bucket.example/community/post/2026/08/m1-w480.jpg?sig 480w, " +
  "https://bucket.example/community/post/2026/08/m1.jpg?sig 2000w";

const render = (props: FigureProps) => renderToStaticMarkup(createElement(Figure, props));

/**
 * `next/image`'s fingerprint in static markup.
 *
 * It always emits `style="color:transparent"`, which nothing else in this
 * component does — so this is how the two branches are told apart without
 * asserting on the whole string. If Next ever stops emitting it, the two
 * "which branch ran" assertions below fail together rather than silently
 * agreeing.
 */
const NEXT_IMAGE = /color:transparent/;

describe("🚨 AC 3 — a bucket picture with variants renders a bare <img srcset>", () => {
  const html = render({
    src: REMOTE,
    srcSet: SRCSET,
    width: 2000,
    height: 1333,
    alt: "Ein Strand",
  });

  it("carries the candidate list verbatim", () => {
    // Verbatim, because the addresses are signed on the SERVER and re-composing
    // them anywhere else would mean composing them twice.
    expect(html).toContain(`srcSet="${SRCSET}"`);
    expect(html).toContain(`src="${REMOTE}"`);
  });

  it("carries a `sizes`, because without one a browser assumes the full viewport", () => {
    expect(html).toContain('sizes="100vw"');
    const narrow = render({
      src: REMOTE,
      srcSet: SRCSET,
      width: 2000,
      height: 1333,
      alt: "x",
      sizes: "(min-width: 768px) 40rem, 100vw",
    });
    expect(narrow).toContain('sizes="(min-width: 768px) 40rem, 100vw"');
  });

  it("is NOT next/image, and keeps the kit's plate and shape", () => {
    expect(html).not.toMatch(NEXT_IMAGE);
    // The same classes as the other branch: a picture must not look different
    // depending on which driver stored it.
    expect(html).toContain("rounded-md");
    expect(html).toContain("bg-muted");
    expect(html).toContain("object-cover");
  });

  it("keeps the alternative text, and hides a decorative one from a screen reader", () => {
    expect(html).toContain('alt="Ein Strand"');
    const decoration = render({
      src: REMOTE,
      srcSet: SRCSET,
      width: 10,
      height: 10,
      decorative: true,
    });
    expect(decoration).toContain('alt=""');
    expect(decoration).toContain('aria-hidden="true"');
  });

  it("defers a picture nobody said was urgent, and hurries one somebody did", () => {
    expect(html).toContain('loading="lazy"');
    const hero = render({
      src: REMOTE,
      srcSet: SRCSET,
      width: 2000,
      height: 1333,
      alt: "x",
      priority: true,
    });
    expect(hero).toContain('loading="eager"');
    expect(hero).toContain('fetchPriority="high"');
    // A bonus React hands this branch and `next/image` used to be the only way
    // to get: a `fetchPriority` on an `<img srcset>` makes React hoist a
    // `<link rel="preload" imageSrcSet imageSizes>`, so the browser starts the
    // right candidate before it has parsed the body.
    expect(hero).toContain('rel="preload"');
    expect(hero).toContain("imageSrcSet=");
    expect(hero).toContain('imageSizes="100vw"');
  });

  it("still renders its caption", () => {
    const captioned = render({
      src: REMOTE,
      srcSet: SRCSET,
      width: 10,
      height: 10,
      alt: "x",
      caption: "Am Strand von Sylt",
    });
    expect(captioned).toContain("<figure");
    expect(captioned).toContain("Am Strand von Sylt");
  });
});

describe("everything else keeps next/image untouched", () => {
  it("a remote picture with NO variants goes through the optimiser path as before", () => {
    // Every picture stored before Story 26.2 — `mediaImageFor()` answers
    // `srcSet: null` for them, and this branch is what they rendered yesterday.
    const html = render({ src: REMOTE, width: 2000, height: 1333, alt: "x" });
    expect(html).toMatch(NEXT_IMAGE);
    expect(html).not.toContain("srcSet");
  });

  it("an own-origin picture ignores a srcSet it should never have been given", () => {
    // The local driver serves from this app's own origin and has no per-variant
    // address, so `mediaImageFor()` cannot produce one there. Deriving the branch
    // from the URL rather than from the prop means a caller who passes one anyway
    // gets the optimiser rather than a broken candidate list.
    const html = render({ src: "/api/media/m1", srcSet: SRCSET, width: 10, height: 10, alt: "x" });
    expect(html).toMatch(NEXT_IMAGE);
  });

  it("an explicit `unoptimized` on an own-origin picture still works", () => {
    const html = render({ src: "/logo.png", width: 10, height: 10, alt: "x", unoptimized: true });
    expect(html).toMatch(NEXT_IMAGE);
  });
});

describe("🚨 the alt-or-decorative union is intact", () => {
  it("reports an empty alt rather than taking the page down", () => {
    // The half a type cannot catch: `alt=""` satisfies `alt: string`. It throws
    // where somebody is building and logs where somebody is using it — a `throw`
    // inside a component unwinds to the nearest error boundary, which trades an
    // accessibility defect for an Internal Server Error, worse for the same
    // person.
    expect(() => render({ src: "/x.png", width: 1, height: 1, alt: "   " })).toThrow(/`alt`/);
  });

  it("compiles neither arm without one of the two — checked by tsc, not at runtime", () => {
    // 🚨 **This block is the guard, and `@ts-expect-error` is what makes it one.**
    // `npm run typecheck` fails if any of these STOPS being an error, which is
    // exactly what a weakened union would do — an optional `alt?: string` on
    // `FigureBase`, or a `srcSet` arm added beside the two instead of into the
    // base, and the compile-time guarantee is gone with every gate still green.
    const cases: FigureProps[] = [];

    // @ts-expect-error — neither `alt` nor `decorative`
    cases.push({ src: "/x.png", width: 1, height: 1 });
    // @ts-expect-error — `decorative` may not carry alternative text
    cases.push({ src: "/x.png", width: 1, height: 1, decorative: true, alt: "something" });
    // @ts-expect-error — a `srcSet` does not excuse the missing alternative text
    cases.push({ src: REMOTE, srcSet: SRCSET, width: 1, height: 1 });
    // @ts-expect-error — `unoptimized` is `true` only; `false` has no honest meaning
    cases.push({ src: "/x.png", width: 1, height: 1, alt: "x", unoptimized: false });

    // The two that DO compile, so the four above are refusals rather than a
    // type nothing satisfies.
    cases.push({ src: "/x.png", width: 1, height: 1, alt: "x" });
    cases.push({ src: "/x.png", width: 1, height: 1, decorative: true });

    expect(cases).toHaveLength(6);
    // Nothing is rendered here on purpose: the assertion happened at compile
    // time, and `vi` is imported so this file's intent is not mistaken for a
    // forgotten test.
    expect(vi.isMockFunction(render)).toBe(false);
  });
});
