// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// `docs/ux.md` § 0: "your app's card is the FIRST card on /dashboard" — a
// member came for the product, and on a phone the navigation sits behind a
// button. Two field-test apps in a row built their pages, put them in the
// menu, and left the overview saying "Basic (monthly)" and "not connected"
// (2026-09-03: the calculator's tile was the third card; 2026-09-04: there was
// no tile at all — with the rule READ, in docs/api-map.md).
//
// So the rule gets a measurement: every section of your own under
// app/dashboard/ is LINKED from the overview page — `app/dashboard/page.tsx`
// or a component it imports carries the href — or its page says in one line
// why it is not there (`// not-on-the-overview: <reason>`). The sections the
// template ships (account, admin, billing, chat) already have their place; a
// module's pages are `page.<id>.tsx` and are the module's business.
//
// Order ("FIRST card") is not measured here: that is the skill `ux-gateway`'s
// eye, and the screenshot's. Presence is, because absence is the silent half.
//
// Measured on the shipped tree before this was armed: zero sections of your
// own, so the rule is vacuous there by construction and its needle is a
// planted `app/dashboard/probe/page.tsx` — see the last test, which drives the
// same function with a synthetic tree.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { isOwnSpecifier, resolveImport } from "../../scripts/lib/import-graph.mjs";
import { blankComments } from "../../scripts/lib/source-text.mjs";

const ROOT = join(__dirname, "..", "..");
const DASHBOARD = join(ROOT, "app", "dashboard");

/** The sections the template ships under app/dashboard/ — each has its place on the overview already. */
export const SHIPPED_SECTIONS = ["account", "admin", "billing", "chat"];

/** The one-line exemption a page carries when it is deliberately not on the overview. */
export const EXEMPTION = "not-on-the-overview:";

/** Is there a `page.tsx` (exactly — a module's `page.<id>.tsx` is not yours) anywhere below `dir`? */
function hasOwnPage(dir: string): boolean {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (hasOwnPage(full)) return true;
    } else if (entry === "page.tsx") {
      return true;
    }
  }
  return false;
}

/** The top-level sections of your own: directories under app/dashboard/ with a page.tsx below them. */
export function ownSections(root = DASHBOARD, shipped = SHIPPED_SECTIONS): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => statSync(join(root, entry)).isDirectory())
    .filter((entry) => !shipped.includes(entry))
    .filter((entry) => hasOwnPage(join(root, entry)))
    .sort();
}

/**
 * The overview's text plus the text of everything it imports from this tree —
 * a card built as a component of its own still counts. Comments blanked, so a
 * TODO naming the route is not a link.
 */
export function overviewText(entry: string, root = ROOT): string {
  const seen = new Set<string>();
  const queue = [entry];
  const parts: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = blankComments(readFileSync(file, "utf8"));
    parts.push(source);
    for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (!isOwnSpecifier(m[1])) continue;
      const resolved = resolveImport(file, m[1], { root });
      // A bare directory can resolve too (an index-less folder import); only a file is text.
      if (
        resolved?.exists &&
        statSync(resolved.path).isFile() &&
        !relative(root, resolved.path).startsWith("node_modules")
      ) {
        queue.push(resolved.path);
      }
    }
  }
  return parts.join("\n");
}

/** Every page.tsx below a section, as text with comments kept — the exemption is a comment. */
function pagesOf(section: string, root = DASHBOARD): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") out.push(readFileSync(full, "utf8"));
    }
  };
  walk(join(root, section));
  return out;
}

/** The pure rule: linked from the overview, or exempted by one of its pages. */
export function hasWayIn(section: string, overview: string, pages: string[]): boolean {
  if (overview.includes(`/dashboard/${section}`)) return true;
  return pages.some((page) => page.includes(EXEMPTION));
}

describe("every section of your own under app/dashboard/ has its card on the overview", () => {
  const entry = join(DASHBOARD, "page.tsx");
  const overview = overviewText(entry);

  it("reads the overview at all", () => {
    // The shipped overview is well over a thousand characters; an empty read
    // would let every section below pass for the wrong reason.
    expect(overview.length).toBeGreaterThan(1000);
    expect(overview).toContain("/plans");
  });

  for (const section of ownSections()) {
    it(`/dashboard/${section} is linked from the overview (or says why not)`, () => {
      expect(
        hasWayIn(section, overview, pagesOf(section)),
        `app/dashboard/${section}/ has a page.tsx, and app/dashboard/page.tsx (or a component it imports) ` +
          `never links /dashboard/${section}. A member came for this and on a phone the menu is behind a ` +
          `button — give the overview a card for it (first, above the shipped ones — docs/ux.md § 0), or ` +
          `put \`// ${EXEMPTION} <reason>\` into the page.`,
      ).toBe(true);
    });
  }

  it("🚨 needle: a section the overview never names is found, an exempted one is not", () => {
    const overviewWithCard = 'import { Card } from "@/components/ui/card";\n<Link href="/dashboard/quote">';
    expect(hasWayIn("quote", overviewWithCard, ["export default function Page() {}"])).toBe(true);
    expect(hasWayIn("pricing", overviewWithCard, ["export default function Page() {}"])).toBe(false);
    expect(hasWayIn("pricing", overviewWithCard, [`// ${EXEMPTION} reached from the quote page only`])).toBe(true);
    // A comment on the overview is not a link.
    expect(hasWayIn("pricing", blankComments("// TODO link /dashboard/pricing"), [])).toBe(false);
  });
});
