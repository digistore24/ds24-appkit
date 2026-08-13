// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Monitor, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

// Switch for the color scheme: system (default) · light · dark.
//
// Deliberately three visible switches instead of one button that cycles: this
// way you see at a glance what currently applies — in particular that "system"
// is active and the app therefore follows the OS setting.
//
// 🚨 **A segmented control, hand-built, and the kit has no ToggleGroup** — so
// `node run.mjs ux-check` reports it, and `RAW_ELEMENT_EXCEPTIONS` in
// `scripts/ux/rules.mjs` is where that judgement is written down.
//
// ⚠️ **What hand-built costs is the KEYBOARD, and until 2026-08-13 this control
// was not paying it.** `role="radiogroup"` and `role="radio"` are a promise to a
// screen reader that arrow keys move the choice and the group is ONE tab stop —
// the WAI-ARIA radio-group pattern, which Radix's `RadioGroup` implements and a
// bare `<button>` does not. All three were separate tab stops and the arrow keys
// did nothing: the markup said radiogroup and behaved like three buttons, which
// is worse than three honest buttons would have been. The roving tabindex and
// the key handling below are that pattern, written out.
const THEME_OPTIONS = [
  { value: "system", labelKey: "system", Icon: Monitor },
  { value: "light", labelKey: "light", Icon: Sun },
  { value: "dark", labelKey: "dark", Icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  // On the server the user's choice is unknown (it lives in localStorage).
  // Render only after mounting, otherwise React reports a hydration mismatch
  // as soon as someone is not on "system".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Which cell carries the group's single tab stop.
   *
   * The checked one, and the FIRST one while nothing is checked — that is the
   * roving-tabindex rule. Before the mount `theme` is unknown (it lives in
   * localStorage), so `index` is -1 and the first cell holds it, which is also
   * what a keyboard user meets on a fresh visit.
   */
  const index = mounted ? THEME_OPTIONS.findIndex((option) => option.value === theme) : -1;
  const stop = index === -1 ? 0 : index;

  /**
   * Arrow keys move AND choose, Home/End jump to the ends.
   *
   * ⚠️ Selection follows focus, which is the pattern for a radio group and not
   * a taste: a screen-reader user arrowing through the options hears each one
   * announced as checked, and there is no separate "confirm" step to discover.
   * It is safe here because every option is instant and reversible — the same
   * reason the WAI-ARIA guidance allows it only for choices with no side effect
   * beyond the choice itself.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: number) => {
    const last = THEME_OPTIONS.length - 1;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current === last ? 0 : current + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current === 0 ? last : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;

    event.preventDefault();
    setTheme(THEME_OPTIONS[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className={cn(
        "bg-card inline-flex items-center gap-0.5 rounded-lg border p-0.5",
        className,
      )}
    >
      {THEME_OPTIONS.map(({ value, labelKey, Icon }, position) => {
        const active = mounted && theme === value;
        const label = t(labelKey);
        return (
          <button
            key={value}
            ref={(node) => {
              buttons.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            // ⚠️ ONE tab stop for the whole group. Three cells with the default
            // 0 make a three-item menu out of a single choice, and that is what
            // this control was.
            tabIndex={position === stop ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, position)}
            onClick={() => setTheme(value)}
            className={cn(
              "text-muted-foreground rounded-md p-1.5 transition-colors",
              "hover:bg-muted hover:text-foreground",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              active && "bg-muted text-foreground",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
