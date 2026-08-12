// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import * as React from "react";
import { cn } from "@/lib/utils";

// The head of every page: an optional eyebrow above the title, the title, one
// sentence of explanation, the primary action on the right — and a rule under
// all of it.
//
// Always use this instead of your own <h1> — then all pages share the same
// spacing and sizes, including the ones someone adds later.
//
//   <PageHeader title="Users" description="Who may do what.">
//     <Button>Create user</Button>
//   </PageHeader>
//
// `eyebrow` is the small line ABOVE the title, and it answers "where am I?"
// rather than "what is this?": the section a page belongs to (`Operator`,
// `Billing`), never a second title and never a sentence. It is optional and
// renders nothing at all when it is not given — an empty line of space above
// every heading in the app is the exact defect it would otherwise ship.
//
//   <PageHeader eyebrow={t("nav.groupOperator")} title={t("title")} />
//
// 🚨 It takes a NODE, not a string, for the same reason `title` does: every
// sentence in this app comes from `messages/{de,en}.json` through `t(…)`, and a
// literal written here would exist in one language. Nothing in this file is
// visible text — `components/page-header.test.ts` holds that.
//
// The heading's FACE is not set here. `app/globals.css` gives every <h1> the
// heading family in `@layer base`, so the rule lives in one place and this
// component inherits it; a `font-…` family class here would be a second type
// system. Only the SIZE steps, and it steps once at `sm`.
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  /** The section this page sits in. Rendered above the title, or not at all. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Actions on the right (buttons, menus). */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `border-b pb-5`: the baseline. A page's head and its content used to
        // be told apart by white space alone, which reads as "two things that
        // happen to be near each other" rather than as a header. The colour is
        // `--border` — applied globally in app/globals.css, so no border class
        // here names a value.
        "mb-8 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow && (
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {eyebrow}
          </p>
        )}
        {/* `sm:text-3xl`: the deepest page of the app and its sign-in screen
            wore ONE heading size before this line — nothing said which of the
            two was the top of a structure. The step is at `sm` because the
            narrow layout has no room to spend on it. */}
        <h1 className="truncate text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && (
          // `max-w-2xl`: a one-sentence description running the full width of a
          // wide screen is the difference between a page that reads and one
          // that has to be scanned. `text-pretty` keeps the last line from
          // being a single word.
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
