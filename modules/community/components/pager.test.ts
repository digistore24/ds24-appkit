// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **A disabled step is not a link — pinned, because it was three times not.**
//
// The community had three pagers written by three stories, and they disagreed
// about what "disabled" means: one rendered `<a aria-disabled>` with a live
// `href` (a mouse is stopped by `pointer-events-none`, Enter is not), one added
// a `disabled` prop to a `<Link>` where it means nothing at all, and one got it
// right. This file is what keeps the one that got it right from drifting back:
// at the ends of the range the step must render NO link element, whatever it
// looks like.
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async (namespace: string) => (key: string, values?: unknown) =>
      `${namespace}.${key}(${JSON.stringify(values ?? null)})`,
  ),
}));

import { Pager } from "./pager";

type El = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is El {
  return typeof node === "object" && node !== null && "type" in node;
}

function collect(node: unknown, predicate: (el: El) => boolean, into: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, into);
    return into;
  }
  if (!isElement(node)) return into;
  if (predicate(node)) into.push(node);
  for (const value of Object.values(node.props ?? {})) {
    collect(value, predicate, into);
  }
  return into;
}

/** Anything a browser would follow: our default `<a>`, or a caller's `<Link>`. */
const links = (tree: unknown) =>
  collect(tree, (el) => el.props?.href !== undefined);

/** The two step controls, in order: previous, then next. */
const steps = (tree: unknown) =>
  collect(tree, (el) => el.props?.disabled !== undefined);

const hrefFor = (page: number) => `?page=${page}`;

describe("the range it renders in", () => {
  it("renders nothing for a single page", async () => {
    expect(await Pager({ page: 1, pages: 1, hrefFor })).toBeNull();
  });

  it("renders nothing when there are no pages at all", async () => {
    expect(await Pager({ page: 1, pages: 0, hrefFor })).toBeNull();
  });

  it("renders a labelled nav once there is more than one page", async () => {
    const tree = await Pager({ page: 1, pages: 2, hrefFor });
    const nav = collect(tree, (el) => el.type === "nav");
    expect(nav).toHaveLength(1);
    expect(nav[0]?.props["aria-label"]).toBe("community.pages(null)");
  });
});

describe("a disabled step is not a link", () => {
  it("offers no previous link on the first page", async () => {
    const tree = await Pager({ page: 1, pages: 3, hrefFor });
    // One link only — next. Nothing points at page 0.
    expect(links(tree).map((el) => el.props.href)).toEqual(["?page=2"]);
  });

  it("offers no next link on the last page", async () => {
    const tree = await Pager({ page: 3, pages: 3, hrefFor });
    // One link only — previous. Nothing points at page 4.
    expect(links(tree).map((el) => el.props.href)).toEqual(["?page=2"]);
  });

  it("offers both in the middle", async () => {
    const tree = await Pager({ page: 2, pages: 3, hrefFor });
    expect(links(tree).map((el) => el.props.href)).toEqual(["?page=1", "?page=3"]);
  });
});

describe("the button underneath", () => {
  it("marks exactly the unavailable step disabled, and never slots that onto a link", async () => {
    const first = steps(await Pager({ page: 1, pages: 3, hrefFor }));
    expect(first.map((el) => el.props.disabled)).toEqual([true, false]);

    const last = steps(await Pager({ page: 3, pages: 3, hrefFor }));
    expect(last.map((el) => el.props.disabled)).toEqual([false, true]);

    // ⚠️ The bug this replaced: `<Button asChild disabled>` hands `disabled`
    // to the `<Link>` underneath, where it is an unknown attribute and stops
    // nothing. A step that IS a link must therefore never be `asChild` and
    // disabled at once — and the enabled ones are asChild.
    const middle = steps(await Pager({ page: 2, pages: 3, hrefFor }));
    for (const step of middle) {
      expect(step.props.disabled).toBe(false);
      expect(step.props.asChild).toBe(true);
    }
    for (const link of links(await Pager({ page: 2, pages: 3, hrefFor }))) {
      expect(link.props.disabled).toBeUndefined();
    }
  });

  it("says type=button, so an embed cannot swallow a host form's Enter", async () => {
    for (const step of steps(await Pager({ page: 1, pages: 3, hrefFor }))) {
      expect(step.props.type).toBe("button");
    }
  });
});

describe("what it uses to navigate", () => {
  it("defaults to a plain anchor", async () => {
    const tree = await Pager({ page: 2, pages: 3, hrefFor });
    expect(links(tree).every((el) => el.type === "a")).toBe(true);
  });

  it("uses the link component a caller supplies, so in-app pages keep client navigation", async () => {
    const Link = ({ href, children }: { href: string; children: unknown }) => null;
    const tree = await Pager({ page: 2, pages: 3, hrefFor, link: Link });
    expect(links(tree).every((el) => el.type === Link)).toBe(true);
  });
});
