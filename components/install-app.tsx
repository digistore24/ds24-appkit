// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// "Put this app on your home screen" — in two places, deliberately.
//
//   `InstallAppMenuItem` + `InstallAppDialog`  the entry under the user's name.
//        Permanent. A menu entry never nags; it waits. Somebody who dismissed
//        the notice, changed their mind, or changed their phone finds it here.
//   `InstallHint`                              one notice in the dashboard,
//        from the second visit, and then never again.
//
// ── Why the notice gets exactly one showing ─────────────────────────────────
// On iOS there is NO WAY to find out that the app is already installed while
// somebody is browsing in Safari — Apple exposes nothing, and this template
// ships no service worker, so `beforeinstallprompt` does not fire either. On
// Android `getInstalledRelatedApps()` answers it, and the offer disappears by
// itself. A notice we cannot reliably switch off must therefore not be able to
// come back, which is what makes the permanent menu entry the other half of
// this file rather than a nicety.
//
// ── What this file is allowed to be ────────────────────────────────────────
// A reader of browser facts and a renderer of one `<Callout>` and one
// `<Dialog>`. Every DECISION is in `lib/pwa/rules.ts`, where vitest can reach
// it (`environment: "node"`, no DOM in this repo). Keep it that way: a
// condition written into the JSX below is a condition nothing tests.
//
// ── Why it is not in the root layout ───────────────────────────────────────
// `ImpersonationBanner` sits there because being signed in as somebody else is
// worth saying on every page, public ones included. This is the opposite. An
// anonymous visitor who installs from the salespage gets an icon that opens on
// a sign-in page — and on iOS, where the installed app has a cookie store of
// its own, they would have to sign in again anyway. So it lives under
// `/dashboard`, where the person looking at it has an account.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  installHint,
  shouldNudge,
  type InstallEnvironment,
  type InstallRoute,
} from "@/lib/pwa/rules";

/**
 * The one thing this app writes to the device for the install offer.
 *
 * 🚨 It is the FOURTH entry in `docs/compliance.md` § TDDDG (session cookie,
 * language, theme — and this). It sits on the same footing as the theme: the
 * direct result of somebody operating a switch, no identifier, no analytics,
 * never sent anywhere. One key rather than two so the inventory stays readable;
 * `components/install-app.test.ts` fails when a second one appears, and when
 * this name stops being named in that document.
 *
 * `localStorage` and NOT a column on the user: an icon lives on ONE DEVICE.
 * Somebody who dismisses this on their laptop must still meet it on their
 * phone, and a per-account flag would silence the one place it matters.
 *
 * The `:v1` is not decoration — it is how the offer can be made again after the
 * wording or the install flow changed, without reading a stale key for ever.
 */
const STORAGE_KEY = "ds24:pwa:v1";

/** Per-TAB, so the visit counter counts visits and not page views. */
const SESSION_KEY = "ds24:pwa-counted";

interface DeviceState {
  visits: number;
  dismissed: boolean;
}

/** `beforeinstallprompt`, which TypeScript's DOM library does not carry. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ── The held prompt, shared ─────────────────────────────────────────────────
//
// Module level rather than component state, because `beforeinstallprompt`
// fires ONCE and this file renders in two places. Per-component listeners would
// hand the event to whichever of them mounted first, and the other would offer
// an instruction while a one-tap install was sitting right there.
//
// It is dead code on the shipped template — Chrome only fires this event for an
// app with a service worker's fetch handler, and this one has none, so what a
// customer actually does is the manual route
// (`docs/mobile.md` → *How a customer puts the icon there*). It is here so that
// an app which adds a worker later gets the better path without touching this
// file.
let heldPrompt: InstallPromptEvent | null = null;
let installed = false;
const subscribers = new Set<() => void>();
let wired = false;

function announce() {
  for (const notify of subscribers) notify();
}

function wireOnce() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // Held rather than let go: without `preventDefault()` Chrome shows its own
    // mini-infobar, the event is gone, and this notice would be competing with
    // it. With it, the offer is ours and it is one button.
    event.preventDefault();
    heldPrompt = event as InstallPromptEvent;
    announce();
  });
  window.addEventListener("appinstalled", () => {
    heldPrompt = null;
    installed = true;
    announce();
  });
}

function readDevice(): DeviceState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const state = parsed as Partial<DeviceState>;
      return {
        visits: typeof state.visits === "number" ? state.visits : 0,
        dismissed: state.dismissed === true,
      };
    }
  } catch {
    // A blocked or full storage, or a value somebody edited by hand. Falling
    // through to "first visit" keeps the menu entry working and keeps the
    // notice quiet, which is the safe direction of the two.
  }
  return { visits: 0, dismissed: false };
}

function writeDevice(state: DeviceState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Nothing to do and nothing to report: the offer simply behaves as if this
    // were a first visit next time.
  }
}

/** Count this visit at most once per tab, however many components ask. */
function countVisit(): DeviceState {
  const state = readDevice();
  try {
    if (window.sessionStorage.getItem(SESSION_KEY)) return state;
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    return state;
  }
  const next = { ...state, visits: state.visits + 1 };
  writeDevice(next);
  return next;
}

interface InstallOffer {
  /** Which instruction. Never "none" — a null offer says that instead. */
  route: InstallRoute;
  /** May the one-time notice appear? */
  nudge: boolean;
  /** The browser's own dialog, where there is one. */
  install: (() => Promise<void>) | null;
  dismiss: () => void;
}

/**
 * Everything the two surfaces need, read once from the browser.
 *
 * Returns `null` until React has mounted — the server knows none of these
 * facts, so anything else is a hydration mismatch on the first page view of
 * every customer. Same gate as `components/theme-toggle.tsx`, same reason.
 */
function useInstallOffer(): InstallOffer | null {
  const [env, setEnv] = useState<InstallEnvironment | null>(null);

  useEffect(() => {
    wireOnce();

    const read = () => {
      const device = countVisit();
      setEnv({
        userAgent: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints ?? 0,
        standalone:
          installed ||
          window.matchMedia("(display-mode: standalone)").matches ||
          // Safari's older flag. iOS has reported the media query since 16.4,
          // but home-screen apps added before that are still out there.
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
        hasPrompt: heldPrompt !== null,
        relatedInstalled: false,
        secureContext: window.isSecureContext,
        dismissed: device.dismissed,
        visits: device.visits,
      });
    };

    read();
    subscribers.add(read);

    // The only reliable "you already have this" on Android, and the reason
    // `related_applications` is in the manifest at all. Chrome-only, hence the
    // optional call — and a rejection means "we do not know", never "installed",
    // which would silence the offer on every other browser.
    const nav = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<unknown[]>;
    };
    nav
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps.length > 0) setEnv((current) => current && { ...current, relatedInstalled: true });
      })
      .catch(() => {});

    return () => {
      subscribers.delete(read);
    };
  }, []);

  const dismiss = useCallback(() => {
    setEnv((current) => {
      if (!current) return current;
      writeDevice({ visits: current.visits, dismissed: true });
      return { ...current, dismissed: true };
    });
  }, []);

  const install = useCallback(async () => {
    const prompt = heldPrompt;
    if (!prompt) return;
    // Single-use either way — the browser will not replay it.
    heldPrompt = null;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "dismissed") dismiss();
    announce();
  }, [dismiss]);

  if (!env) return null;
  const route = installHint(env);
  if (!route) return null;
  return {
    route,
    nudge: shouldNudge(env),
    install: route === "prompt" ? install : null,
    dismiss,
  };
}

/** The steps for one route, as the two or three sentences they really are. */
function Steps({ route }: { route: InstallRoute }) {
  const t = useTranslations("pwa");
  const key = {
    prompt: "stepsPrompt",
    android: "stepsAndroid",
    ios: "stepsIos",
    desktop: "stepsDesktop",
    webview: "stepsWebview",
    none: "stepsWebview",
  }[route];
  return (
    <>
      <p>{t(key)}</p>
      {route === "ios" && (
        // 🚨 Not a nicety. A home-screen app on iOS has its OWN cookie store, so
        // the session in Safari does not carry over — and the sign-in link from
        // an email opens Safari, not the installed app. Somebody who does not
        // expect that concludes the app is broken. See docs/mobile.md.
        <p className="mt-2">{t("stepsIosSignIn")}</p>
      )}
    </>
  );
}

/**
 * The dialog behind the menu entry.
 *
 * Controlled from outside and rendered OUTSIDE the dropdown — the pattern
 * `app/dashboard/admin/users/ui.tsx` uses for its row menus. A dialog nested
 * inside `DropdownMenuContent` unmounts the moment the menu closes behind it,
 * which is every click the person makes in it.
 */
export function InstallAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pwa");
  const offer = useInstallOffer();
  if (!offer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogIntro")}</DialogDescription>
        </DialogHeader>
        <div className="text-sm">
          <Steps route={offer.route} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The permanent entry under the user's name.
 *
 * Renders nothing where there is nothing true to say — an installed app, a
 * desktop browser that cannot do it, a device already carrying the icon.
 */
export function InstallAppMenuItem({ onShowSteps }: { onShowSteps: () => void }) {
  const t = useTranslations("pwa");
  const offer = useInstallOffer();
  if (!offer) return null;

  return (
    <DropdownMenuItem
      onSelect={(event) => {
        if (offer.install) {
          // The browser's own dialog beats any instruction we could write.
          event.preventDefault();
          void offer.install();
          return;
        }
        onShowSteps();
      }}
    >
      <Smartphone aria-hidden className="size-4" />
      {t("menuItem")}
    </DropdownMenuItem>
  );
}

/**
 * The one-time notice in the dashboard.
 *
 * A `Callout` — the shipped shape for something that STAYS until the state it
 * describes changes (CLAUDE.md → UI, "never invent a fourth"). Not sticky:
 * `AppShell`'s header is `sticky top-0 z-30`, and a second sticky element on
 * the same edge is the collision `components/impersonation-banner.tsx` spells
 * out.
 */
export function InstallHint() {
  const t = useTranslations("pwa");
  const offer = useInstallOffer();
  const [open, setOpen] = useState(false);

  if (!offer || !offer.nudge) return null;

  return (
    <>
      <Callout variant="info" hideIcon className="mb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Smartphone aria-hidden className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{t("hintTitle")}</span> {t("hintBody")}
          </p>
          <span className="flex shrink-0 gap-2">
            {offer.install ? (
              <Button size="sm" onClick={() => void offer.install?.()}>
                {t("install")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setOpen(true)}>
                {t("hintShow")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={offer.dismiss}>
              {t("dismiss")}
            </Button>
          </span>
        </div>
      </Callout>
      <InstallAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
