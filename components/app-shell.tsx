// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The frame around every page in the protected area (`app/dashboard/*`):
// sidebar on the left, header on top, content on the right. On narrow screens
// the sidebar opens as an overlay (Sheet).
//
// ── Adding a page to the navigation ────────────────────────────────────────
// Just extend the NAVIGATION list below — active highlighting, mobile view and
// keyboard handling come for free:
//
//   { href: "/dashboard/projects", labelKey: "projects", icon: FolderKanban }
//
// `labelKey` points into the `nav` namespace in `messages/*.json`; the text
// belongs there, not here. Entries with `ownerOnly: true` are only visible to
// the "owner" role — that is pure cosmetics, the page itself MUST still start
// with `requireOwner()`, otherwise it remains reachable via the address bar.
//
// `featureKey` hides an entry whose feature is switched off on this
// installation. Same caveat, twice over: hiding a link is not protecting a
// page. The page still renders its own notice, and the route handler behind it
// still refuses — see `app/api/chat/route.ts`. What the flag prevents is a menu
// entry leading somewhere that only ever says "not configured".
//
// ⚠️ The flag is a boolean the LAYOUT computes, not a reading of a config file,
// and "switched off" is not the same question as "not working". A feature the
// Operator switched ON but this machine cannot run must keep its entry for the
// Operator — otherwise the same flag that hides the broken feature hides the
// page explaining what is broken, and the app goes silent about a fault it can
// name exactly.
//
// Three shipped keys, and the third is the one that shows the question is real
// rather than ceremonial:
//
//   `chat`           — `chatNavVisible()` (lib/ai/rules.ts). The worked example.
//   `community`      — `communityNavVisible()` (modules/community/lib/rules.ts).
//                      Asked again, answered identically: broken keeps the entry
//                      for the operator, because /dashboard/community IS the
//                      diagnosis page. ⚠ A MODULE's key, so it exists only in an
//                      app that installed the community — this file never names
//                      it; the entry is merged in below the literal.
//   `communityAdmin` — asked again, answered DIFFERENTLY: plain
//                      `isCommunityEnabled()`. /dashboard/admin/community is
//                      not a diagnosis page and refuses in the broken state, so
//                      keeping its entry would put a link in front of the one
//                      person it would 404 for.
//
// Whoever adds the fourth decides it again, and "the last one did X" is not the
// answer — what the target page does when the feature is broken is.

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  CircleUser,
  CreditCard,
  FileText,
  MessageCircle,
  ShieldCheck,
  Users,
  Receipt,
  Coins,
  LogIn,
  LogOut,
  Menu,
  MessagesSquare,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { initialsFrom } from "@/lib/initials";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RoleBadge } from "@/components/role-badge";
import { BrandLink } from "@/components/brand-mark";
import { InstallAppDialog, InstallAppMenuItem } from "@/components/install-app";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mergeModuleNav, type NavItemBase } from "@/lib/modules/nav";
import { MODULE_NAV } from "@/lib/modules/nav-registry";

/**
 * Optional features, resolved on the server and passed in as booleans.
 *
 * ⚠️ A plain map rather than the named interface it used to be. A module
 * cannot widen an interface that lives in the core, so `keyof ShellFeatures`
 * stopped being expressible the moment features could arrive from
 * `modules/<id>/nav.ts`.
 *
 * What the type used to guarantee is now asserted, and asserted MORE:
 * `scripts/modules/nav.test.ts` fails the build on a `featureKey` that no
 * entry declares — the typo the type caught — and also on one that nothing
 * RESOLVES, which the type never could. The keys are `chat` from the CORE and
 * `community` / `communityAdmin` from the community MODULE, so the last two
 * exist only in an app that installed it; the second and third are two keys on
 * purpose, because `community` keeps the entry for an operator whose community
 * is on-but-broken so the diagnosis page stays reachable, and the admin page
 * refuses in precisely that state.
 */
export type ShellFeatures = Record<string, boolean | undefined>;

/**
 * A navigation entry.
 *
 * The shape lives in `lib/modules/nav.ts` rather than here, and the move was
 * forced rather than tidy: a module's `nav.ts` needs the type, the generated
 * nav registry imports every module's `nav.ts`, and this component imports that
 * registry. Declaring it here would close that circle.
 */
export type NavItem = NavItemBase;

export const NAVIGATION: NavItem[] = [
  { href: "/dashboard", labelKey: "overview", icon: LayoutDashboard },
  // The Member's own account: what they may use, until when, and their balance
  // (story 3.5). Under /dashboard, so `proxy.ts` already guards it — a
  // route OUTSIDE that prefix would be public until the matcher named it.
  { href: "/dashboard/account", labelKey: "account", icon: CircleUser },
  // The Member's purchases, invoices and subscription self-service — visible to
  // every signed-in member (NOT ownerOnly). Scoped to them by the page itself.
  { href: "/dashboard/billing", labelKey: "billing", icon: FileText },
  // The assistant. Optional — an app without an ANTHROPIC_API_KEY, or with
  // `"enabled": false` in config/ai-chat.json, does not show this at all.
  {
    href: "/dashboard/chat",
    labelKey: "chat",
    icon: MessageCircle,
    featureKey: "chat",
  },
  // ⚠ The community's two entries were HERE and are not any more: they belong
  // to the module and are merged in below the literal, so this file no longer
  // names them. The old comment outlived them by one commit, sitting above an
  // unrelated entry and describing something a reader would look for in vain.
  { href: "/plans", labelKey: "plans", icon: CreditCard },
  {
    href: "/dashboard/admin",
    labelKey: "admin",
    icon: ShieldCheck,
    ownerOnly: true,
    groupKey: "groupOperator",
  },
  {
    href: "/dashboard/admin/users",
    labelKey: "users",
    icon: Users,
    ownerOnly: true,
  },
  {
    href: "/dashboard/admin/purchases",
    labelKey: "purchases",
    icon: Receipt,
    ownerOnly: true,
  },
  // What the AI layer costs. NOT behind `featureKey: "chat"` — the assistant is
  // one task among however many the Operator adds, and a page that vanishes
  // when she is switched off would hide the bill for all the others.
  {
    href: "/dashboard/admin/ai-costs",
    labelKey: "aiCosts",
    icon: Coins,
    ownerOnly: true,
  },
  // Who signed in as whom, and when. NOT behind the impersonation switch:
  // turning the feature off does not unmake the sessions that already
  // happened, and the page an Operator needs when a customer asks "did
  // somebody access my account?" is exactly the one that must not disappear
  // because a setting changed afterwards.
  {
    href: "/dashboard/admin/impersonations",
    labelKey: "impersonations",
    icon: LogIn,
    ownerOnly: true,
  },
];

// The entries installed modules bring, each placed after the one it names.
//
// ⚠️ Merged AFTER the literal above, never spread into it, and that is the same
// lesson the greeting's SHIPPED lists taught: `navHrefs()` in
// `scripts/ux/rules.mjs` and `lib/ai/nav-labels.test.ts` both read
// `export const NAVIGATION` as TEXT. A spread inside the literal would blind
// them — and `ux-check` would stop reporting pages that are in no menu, which
// is the one check that notices a page nobody can reach.
//
// A module's own nav file is named `NAVIGATION` for the same reason: the same
// parser reads it, so a module's pages are visible to `ux-check` too.
NAVIGATION.splice(0, NAVIGATION.length, ...mergeModuleNav([...NAVIGATION], MODULE_NAV));

export interface ShellUser {
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

/**
 * Initials for the avatar — "anna.mueller@x.com" becomes "AM".
 *
 * The word rule is `initialsFrom()` in `lib/initials.ts` and is shared with the
 * app's own mark (`components/brand-mark.tsx`) — one rule, two callers, and
 * `lib/initials.test.ts` refuses a second copy of it. What is NOT shared is the
 * two lines below: deriving a SOURCE from a person (`name`, else the local part
 * of their address) is a rule about users and has nothing to do with an app
 * name, and the fallback is for a name made of nothing but separators, where
 * there are no words to take an initial from.
 *
 * ⚠️ The old body indexed the string (`parts[0]?.[0]`), so a name beginning
 * outside the basic plane produced a lone surrogate and the avatar showed the
 * replacement character. Every other answer is unchanged.
 */
function initials(user: ShellUser): string {
  const source = user.name?.trim() || user.email?.split("@")[0] || "?";
  return initialsFrom(source) || [...source].slice(0, 2).join("").toUpperCase();
}

/**
 * Is this the active entry? An exact match, or a prefix for sub-pages — but
 * "/dashboard" must not light up on every sub-page, or two entries would be
 * active at once. Hence the more specific entry wins.
 */
function isActive(pathname: string, href: string, all: NavItem[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  return !all.some(
    (other) =>
      other.href !== href &&
      other.href.startsWith(href + "/") &&
      (pathname === other.href || pathname.startsWith(other.href + "/")),
  );
}

function NavLinks({
  items,
  onNavigate,
  unreadHrefs,
}: {
  items: NavItem[];
  onNavigate?: () => void;
  /** Entries carrying a "something happened here" dot. */
  unreadHrefs?: ReadonlySet<string>;
}) {
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href, items);
        const Icon = item.icon;
        return (
          <React.Fragment key={item.href}>
            {item.groupKey && (
              <p className="text-muted-foreground mt-4 mb-1 px-3 text-xs font-medium tracking-wide uppercase">
                {t(item.groupKey)}
              </p>
            )}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                // The active entry, and the two additions are a WEIGHT step and
                // an OPACITY step — nothing structural. The geometry (`w-60`,
                // `h-14`, the padding here) is a closed list in
                // docs/design-system.md §8 and none of it moves.
                //
                // 🚨 `font-semibold` is the load-bearing one, and not for
                // looks: before it, "this entry is the one you are on" was
                // carried by COLOUR ALONE — a 1.16 tint against the sidebar.
                // That is WCAG 1.4.1's exact case. `aria-current="page"` two
                // lines up already answers a screen reader; weight is the
                // answer for somebody who sees the sidebar but not the hue.
                //
                // The tint goes /10 -> /15 so the pill reads as a surface
                // rather than a smudge. Measured, because an alpha-composited
                // fill is NOT a token and `pairsTouching()` in
                // scripts/ux/rules.mjs therefore cannot see it — `text-primary`
                // is measured against `card` and `background`, never against
                // what it actually sits on here. By hand, on the shipped
                // tokens, `--primary` over the sidebar's own surface:
                //
                //   light  /10  5.37:1   /15  4.98:1   (sidebar = card = white)
                //   dark   /10  7.60:1   /15  6.79:1   (sidebar `--card`)
                //   dark   /10  8.53:1   /15  7.66:1   (mobile sheet, `--background`)
                //
                // /18 was the next step and was refused: 4.75:1 in light is a
                // quarter of a point off the floor, and the pill would then be
                // one recolour away from being unreadable in an app nobody here
                // will ever see.
                active &&
                  "bg-primary/15 font-semibold text-primary hover:bg-primary/15 hover:text-primary",
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {t(item.labelKey)}
              {unreadHrefs?.has(item.href) && (
                // Existence, not a count — see `unreadFor()`. A number here
                // would need an unbounded aggregation on the busiest path in
                // the app, and nothing asks for one.
                //
                // `aria-hidden` on the dot with an `sr-only` word beside it:
                // a coloured circle is not a sentence, and a screen reader
                // that announced "bullet" would be worse than silence.
                <span className="ml-auto flex items-center">
                  <span
                    aria-hidden
                    className="bg-primary size-2 rounded-full"
                  />
                  <span className="sr-only">{tShell("unread")}</span>
                </span>
              )}
            </Link>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const t = useTranslations("theme");
  return (
    // The toggle deliberately sits on the RIGHT: in development Next.js shows
    // its own button in the bottom left and would cover it. The language
    // switcher sits up in the header for the same reason.
    <div className="flex items-center justify-between gap-2 border-t p-3">
      <span className="text-muted-foreground pl-10 text-xs">{t("label")}</span>
      <ThemeToggle />
    </div>
  );
}

function UserMenu({
  user,
  signOutAction,
}: {
  user: ShellUser;
  signOutAction: () => Promise<void>;
}) {
  const t = useTranslations("shell");
  // The account entry reads the SIDEBAR's label, not one of its own. Two names
  // for one page is how somebody ends up looking for their password behind both
  // and finding it behind neither.
  const tNav = useTranslations("nav");
  // The install steps open in a dialog, and the dialog is rendered OUTSIDE the
  // dropdown: one nested in `DropdownMenuContent` unmounts as the menu closes
  // behind it. Same arrangement as the row menus in
  // `app/dashboard/admin/users/ui.tsx`.
  const [installSteps, setInstallSteps] = React.useState(false);

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2"
          aria-label={t("openUserMenu")}
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {initials(user)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm sm:inline">
            {user.name || user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">
            {user.name || user.email}
          </p>
          {user.name && user.email && (
            <p className="text-muted-foreground truncate text-xs">
              {user.email}
            </p>
          )}
          <span className="mt-2 inline-flex">
            <RoleBadge role={user.role} />
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Where a Member changes their email address and their password. It is
            in the sidebar too, and that was not enough: the entry is named
            after what the page GRANTS ("Mein Zugang" / "My access"), so nobody
            looking for their sign-in details recognised it. The name changed
            with this entry; this menu is simply where people look for it. */}
        <DropdownMenuItem asChild>
          <Link href="/dashboard/account">
            <CircleUser aria-hidden className="size-4" />
            {tNav("account")}
          </Link>
        </DropdownMenuItem>
        {/* Renders nothing where a home-screen icon is not a thing that can
            happen — an installed app, a desktop browser, a phone that already
            carries it. This is the PERMANENT place for it; the notice in the
            dashboard shows once and never returns. See components/install-app.tsx. */}
        <InstallAppMenuItem onShowSteps={() => setInstallSteps(true)} />
        <DropdownMenuSeparator />
        {/* Signing out is a server action — hence a real form and not an
            onClick. Last, and separated: it is the destructive item, and a
            settings link placed under it is one people mis-click past. */}
        <form action={signOutAction}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut aria-hidden className="size-4" />
              {t("signOut")}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
    <InstallAppDialog open={installSteps} onOpenChange={setInstallSteps} />
    </>
  );
}

export function AppShell({
  appName,
  user,
  features,
  badges,
  signOutAction,
  children,
}: {
  /** Name in the top left (lib/app.ts). */
  appName: string;
  user: ShellUser;
  /**
   * Which optional features are on. Resolved on the SERVER and handed down as
   * booleans — the modules that answer this read config files carrying prices
   * and product ids, which have no business in a browser bundle.
   */
  features?: ShellFeatures;
  /**
   * The hrefs with something new waiting for THIS person — the sidebar's dot.
   *
   * A prop of its own rather than a `ShellFeatures` entry, deliberately: that
   * object answers "does this installation have the feature", which is a
   * property of the app, while this answers "has something happened for THIS
   * person", which is data and changes between two renders for two members.
   * Putting them in one bag would invite a cache that is right about one and
   * wrong about the other.
   *
   * A list of hrefs rather than one boolean per feature, because the shell
   * already keyed the dot by href internally — the old `communityUnread` prop
   * was the one caller of a mechanism that was general all along.
   */
  badges?: readonly string[];
  /** Server action that signs out (see app/dashboard/layout.tsx). */
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();

  // The dot's targets. A set rather than a boolean threaded through NavLinks,
  // so a second indicator later is one more entry rather than one more prop.
  const unreadHrefs = React.useMemo(() => new Set(badges ?? []), [badges]);

  const items = NAVIGATION.filter(
    (item) =>
      (!item.ownerOnly || user.role === "owner") &&
      (!item.featureKey || features?.[item.featureKey] === true),
  );
  const current = items.find((item) => isActive(pathname, item.href, items));

  return (
    <div className="min-h-screen">
      {/* Sidebar — fixed from "lg" up, below that inside the Sheet (see below). */}
      <aside className="bg-card fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <BrandLink appName={appName} href="/dashboard" />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks items={items} unreadHrefs={unreadHrefs} />
        </div>
        <SidebarFooter />
      </aside>

      <div className="lg:pl-60">
        <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-sm sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label={tShell("openNavigation")}
              >
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 gap-0 p-0">
              <div className="flex h-14 items-center border-b px-4">
                <SheetTitle asChild>
                  <div>
                    <BrandLink appName={appName} href="/dashboard" />
                  </div>
                </SheetTitle>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <NavLinks
                  items={items}
                  unreadHrefs={unreadHrefs}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
              <SidebarFooter />
            </SheetContent>
          </Sheet>

          {/* Quiet on purpose. This restates the <h1> that `PageHeader` puts
              forty pixels below it — useful when the page is scrolled, loud
              when it is not. One heading per screen should be the loud one. */}
          <h2 className="text-muted-foreground truncate text-sm font-medium">
            {current ? t(current.labelKey) : ""}
          </h2>

          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Separator orientation="vertical" className="hidden h-6 sm:block" />
            <UserMenu user={user} signOutAction={signOutAction} />
          </div>
        </header>

        {/* 5xl, not 6xl: beside a 15rem sidebar, 72rem of content gives a table
            a line length nobody reads across and leaves body text stranded. */}
        <main className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
