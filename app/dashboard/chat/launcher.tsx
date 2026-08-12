// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The assistant, reachable from every page — the button bottom right.
//
// ── Why it lives here and not in components/ ───────────────────────────────
// Everything the chat is made of sits in this one folder: the page, the window,
// the server actions. The launcher is the same feature seen from the side, and
// it reuses the same `ChatWindow` rather than reimplementing one — a second
// implementation would be a second place to fix every streaming bug found in
// the first. `app/dashboard/layout.tsx` renders it; only `page.tsx`,
// `layout.tsx` and `route.ts` are routes, so a component file next to them is
// not one.
//
// ── What is decided where ──────────────────────────────────────────────────
// Whether this thing exists at all is answered on the SERVER, in the layout:
// `isChatEnabled()` reads config files and `hasPlan()` reads the database, and
// neither belongs in a browser bundle. What arrives here is a boolean and two
// strings. **And none of it is a permission** — `app/api/chat/route.ts` asks
// every question again on every request, because a button that is not rendered
// is not a check.
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { loadChatAction } from "./actions";
import { ChatWindow, type ChatMessage } from "./ui";

export function ChatLauncher({
  assistantName,
  avatar,
  allowedMedia,
}: {
  assistantName: string;
  avatar: string;
  /**
   * The Media Marker whitelist for her answers — resolved in the layout
   * (this file is `"use client"` and cannot read the handbook itself) and
   * handed through to `ChatWindow` untouched. Absent it denies (AD-54).
   */
  allowedMedia?: readonly string[];
}) {
  const t = useTranslations("chat");
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  // `null` means "not fetched yet" — different from an empty conversation, and
  // the difference is what stops the panel showing "no messages yet" for the
  // half second before the transcript arrives.
  const [history, setHistory] = useState<ChatMessage[] | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // The transcript is loaded when somebody OPENS the panel, once. Loading it in
  // the layout would put a database query in front of every page in the app for
  // a panel most visits never open.
  useEffect(() => {
    if (!open || history !== null) return;
    let cancelled = false;
    void loadChatAction()
      .then((turns) => {
        if (!cancelled) setHistory(turns);
      })
      .catch(() => {
        // An unreachable server is not a reason to withhold the chat: an empty
        // transcript still asks and still answers, and the history is on the
        // server either way. The next open tries again.
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, history]);

  // Escape closes it — it is a floating layer over the page, and every other
  // one in this app (Dialog, AlertDialog) behaves that way.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Not on the chat's own page. The button would open a second copy of the
  // conversation on top of the first, and the two would drift apart the moment
  // somebody typed into one of them.
  if (pathname === "/dashboard/chat") return null;

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <div
          role="dialog"
          aria-label={t("title", { name: assistantName })}
          // The elevation is named by its ROLE, not by a size out of Tailwind's
          // vocabulary: this is a panel floating OVER the page, which is what
          // `--elevation-overlay` means. `shadow-lg` maps to the same token
          // after Story 43.1 and compiles to the identical declaration —
          // measured — so this is the same picture said in the app's own words.
          className="bg-card text-card-foreground w-[min(24rem,calc(100vw-2rem))] rounded-lg border shadow-(--elevation-overlay)"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="size-7 shrink-0">
                <AvatarImage src={avatar} alt="" />
                <AvatarFallback>
                  {assistantName.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-medium">
                {t("title", { name: assistantName })}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={close}
              aria-label={t("close")}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>

          <div className="p-3">
            {history === null ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                {t("loading")}
              </p>
            ) : (
              <ChatWindow
                variant="panel"
                assistantName={assistantName}
                avatar={avatar}
                initial={history}
                allowedMedia={allowedMedia}
              />
            )}
          </div>
        </div>
      )}

      {/* Her face, not a speech bubble. A generic icon reads as "help", and help
          is what people click when something is already wrong; a person is what
          they click to ask. `size-12` and not `icon-lg`, because a button
          somebody is meant to find in the corner of a page they are working on
          has to survive being ignored. The picture is the one from
          `config/ai-chat.json` — the same one in the bubbles, so the launcher
          follows an app that swapped it without a second file to change. */}
      <Button
        type="button"
        size="icon-lg"
        // Same reasoning as the panel above: a button that floats over whatever
        // page somebody is working on wears the overlay step, named as such.
        // The kit's default Button variant carries no shadow of its own, so
        // this class is what gives it one — it is not a restatement.
        className="size-12 overflow-hidden rounded-full p-0 shadow-(--elevation-overlay)"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? t("close") : t("open", { name: assistantName })}
      >
        {open ? (
          <X aria-hidden className="size-5" />
        ) : (
          <Avatar className="size-full rounded-none">
            <AvatarImage src={avatar} alt="" className="object-cover" />
            {/* An app that never dropped a picture in still gets a button,
                carrying her initial rather than a broken image. */}
            <AvatarFallback className="bg-transparent text-base font-medium">
              {assistantName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </Button>
    </div>
  );
}
