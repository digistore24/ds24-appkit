// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import type { ElementType } from "react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

/**
 * The community's ONE pager — a thread's, a room's and an embed's alike.
 *
 * ⚠️ **It exists because there were three of them, and they disagreed.** One
 * rendered a real `<button disabled>`, one an `<a aria-disabled>` with a live
 * `href`, and one an `<a aria-disabled>` carrying a `disabled` prop that did
 * nothing at all — three different answers to "can a keyboard reach this?"
 * inside one feature, none of them written down as a decision. A member does
 * not know they have moved between surfaces; the control has to behave the
 * same.
 *
 * **The answer this file settles on: a disabled step is not a link.** Not a
 * link with the pointer events removed — `pointer-events-none` stops a mouse
 * and nothing else, and Enter still activates an `<a href>` that names a page
 * outside the thread. It renders as a plain disabled `<button>`, which no
 * input method can follow and which every assistive technology announces as
 * unavailable rather than as a destination.
 *
 * `link` is how a caller keeps client-side navigation: pages inside the app
 * pass Next's `<Link>`, an embed whose host supplies its own URL builder gets
 * the default `<a>`. Both take `href` and children, so nothing else differs.
 */
export async function Pager({
  page,
  pages,
  hrefFor,
  link: Link = "a",
}: {
  /** The page being looked at, already clamped to `1..pages` by the caller. */
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  link?: ElementType;
}) {
  const t = await getTranslations("community");
  if (pages <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < pages;

  return (
    <nav
      className="mt-6 flex items-center justify-between"
      aria-label={t("pages")}
    >
      {/* `type="button"` on both: a disabled step still renders a real button,
          and a button with no type submits — an embed dropped inside a host
          page's form would otherwise swallow that form's Enter key. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasPrevious}
        asChild={hasPrevious}
      >
        {hasPrevious ? (
          <Link href={hrefFor(page - 1)}>{t("previousPage")}</Link>
        ) : (
          t("previousPage")
        )}
      </Button>
      <span className="text-muted-foreground text-sm">
        {t("pageOf", { page, pages })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasNext}
        asChild={hasNext}
      >
        {hasNext ? (
          <Link href={hrefFor(page + 1)}>{t("nextPage")}</Link>
        ) : (
          t("nextPage")
        )}
      </Button>
    </nav>
  );
}
