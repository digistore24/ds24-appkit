// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The navigation a module contributes — the shape, and the merge.
//
// Hand-written; `lib/modules/nav-registry.ts` is the generated list. Kept OUT
// of `components/app-shell.tsx` for one concrete reason: a module's `nav.ts`
// needs this type, the generated registry imports every module's `nav.ts`, and
// `app-shell.tsx` imports that registry. Declaring the type in the component
// would close that circle.
//
// ── Client-safe, and that is a rule rather than a happy accident ───────────
// `app-shell.tsx` is a client component, so everything reachable from a
// module's `nav.ts` lands in the browser bundle. A nav file therefore holds
// static data and a lucide icon — never a config reader, never `@/db`, never
// the module's own logic. Whether an entry is VISIBLE is decided on the server
// (`shellState()`), handed in as a boolean, and read here only as a key.
import type { LucideIcon } from "lucide-react";

/** What every navigation entry is, core and module alike. */
export interface NavItemBase {
  href: string;
  /** Key in the `nav` namespace of the message files. */
  labelKey: string;
  icon: LucideIcon;
  /** Visible to the "owner" role only. */
  ownerOnly?: boolean;
  /**
   * Hidden unless this feature is switched on.
   *
   * A plain string rather than `keyof ShellFeatures`: a module cannot widen an
   * interface in the core. What the type used to guarantee is now asserted —
   * `scripts/modules/nav.test.ts` fails the build on a `featureKey` no module
   * and no core entry declares, which catches the typo the type used to catch
   * and also catches a key nobody resolves, which the type never did.
   */
  featureKey?: string;
  /** Key of a section heading rendered before this entry. */
  groupKey?: string;
}

/** A navigation entry brought by a module. */
export interface ModuleNavItem extends NavItemBase {
  /**
   * Put this entry directly after the entry with that `href`.
   *
   * Without it a module's entries land at the end of the menu, which is below
   * the operator's admin section — almost never where a member-facing page
   * belongs. `after` is how a module says "I sit under the chat", and a value
   * naming an href that does not exist is a build failure rather than a silent
   * jump to the end (`scripts/modules/nav.test.ts`).
   */
  after?: string;
}

/** What a module's `nav.ts` exports. */
export interface ModuleNav {
  readonly id: string;
  /**
   * ⚠️ Named `NAVIGATION`, exactly like the core's, and that is load-bearing:
   * `navHrefs()` in `scripts/ux/rules.mjs` finds a menu by that name, and
   * `node run.mjs ux-check` uses it to report pages that are in no menu. A
   * module using any other name would have every one of its pages reported as
   * unreachable.
   *
   * 🚨 **That was a claim before it was a mechanism, and it is worth knowing
   * why nothing noticed.** `navHrefs()` looked for `export const NAVIGATION`,
   * which a module cannot have — this is a property of the object the module
   * default-exports — and `ux-check` read `components/app-shell.tsx` and no
   * module file at all. Its page walk was missing the module's PAGES in the
   * same breath, so the two errors cancelled into a green result: no menu
   * entries found, and no pages to miss them. Fixing either half alone produces
   * a confident false finding.
   *
   * Both halves are kept now — `moduleNavFiles()` feeds the reader, and
   * `scripts/ux/rules.test.ts` pins both menu shapes.
   */
  readonly NAVIGATION: readonly ModuleNavItem[];
  /** The feature keys this module's entries use. Resolved by `shellState()`. */
  readonly features: readonly string[];
}

/**
 * Core entries plus the modules', each module entry placed after the one it
 * names. Pure — the whole reason the merge is here and not in the component.
 *
 * Order within a module is preserved, and two entries pointing at the same
 * `after` keep the order the modules were installed in.
 */
export function mergeModuleNav(
  core: readonly NavItemBase[],
  modules: readonly ModuleNav[],
): NavItemBase[] {
  const merged: NavItemBase[] = [...core];

  // Where the NEXT entry naming a given anchor goes.
  //
  // ⚠️ Without this, two entries naming one anchor come out REVERSED: both jump
  // to the same index, so the second lands in front of the first. Found by the
  // test, not by the first draft's comment, which claimed the opposite. Once an
  // entry has been placed after an anchor, it becomes the anchor for the next
  // one — no index bookkeeping, and correct however far the list has shifted.
  const anchorOf = new Map<string, string>();

  for (const mod of modules) {
    for (const item of mod.NAVIGATION) {
      if (item.after === undefined) {
        merged.push(item);
        continue;
      }
      const anchor = anchorOf.get(item.after) ?? item.after;
      const at = merged.findIndex((entry) => entry.href === anchor);
      if (at === -1) {
        // Never silently appended: a dangling `after` means the module is
        // describing a menu this app does not have, and the page would turn up
        // below the admin section where nobody looks for it.
        throw new Error(
          `Module "${mod.id}" puts "${item.href}" after "${item.after}", which is in no menu. ` +
            `Name an href that exists, or drop \`after\` to accept the end of the list.`,
        );
      }
      merged.splice(at + 1, 0, item);
      anchorOf.set(item.after, item.href);
    }
  }

  return merged;
}
