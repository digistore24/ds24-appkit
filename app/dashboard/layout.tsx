// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { signOut } from "@/auth";
import { requireActiveUser } from "@/lib/authz";
import { AppShell } from "@/components/app-shell";
import { APP_NAME } from "@/lib/app";
import { chatConfig, isChatEnabled } from "@/lib/ai/chat-config";
import { chatNavVisible, mayUseChat } from "@/lib/ai/rules";
import { allowedMediaMarkers } from "@/lib/ai/knowledge";
import { isOwner } from "@/lib/roles";
import { moduleShellState } from "@/lib/modules/shell-state";
import { hasPlan } from "@/lib/entitlements/manage";
import { ChatLauncher } from "@/app/dashboard/chat/launcher";
import { SiteFooter } from "@/components/site-footer";
import { InstallHint } from "@/components/install-app";

// The frame around ALL pages under /dashboard — sidebar, header, user menu.
// New protected pages are simply created as `app/dashboard/…/page.tsx` and get
// it automatically; they enter the navigation via NAVIGATION in
// components/app-shell.tsx.
//
// The sign-in check here is the second layer: the first is proxy.ts. Both
// together, because the layout needs the user data anyway — and because a
// check that lives only in the proxy can quietly disappear with a
// configuration change.
//
// requireActiveUser() additionally checks whether the account has been
// blocked. The proxy does not do that: it sees only the JWT — which holds the
// state from sign-in time — and it deliberately keeps the database out of the
// request path. That is exactly why the check sits here, at the one place
// every protected page passes through.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireActiveUser();

  async function signOutAction() {
    "use server";
    // Signing out while acting as somebody else ends BOTH identities — the
    // session is destroyed, so there is no half-exit that could leave an
    // Operator authenticated as a customer they thought they had left.
    //
    // The record is closed on the way out. The scheduled job would eventually
    // do it (`close-impersonations`), but only once the cap had passed, and
    // until then the record page would show a session as running that ended the
    // moment somebody pressed "sign out". A row that is wrong for half an hour
    // is worse than one written a moment later.
    const impersonation = session.user.impersonation;
    if (impersonation) {
      const { closeImpersonation } = await import("@/lib/impersonation/manage");
      await closeImpersonation(impersonation.id, "signout");
    }
    await signOut({ redirectTo: "/" });
  }

  // The assistant, on every protected page rather than only on her own. Both
  // halves are resolved HERE, on the server: `isChatEnabled()` reads config
  // files and `hasPlan()` reads `grants` — never a billing table — and neither
  // belongs in a browser bundle.
  //
  // `hasPlan` is asked only when a plan is actually required, so the ordinary
  // app (`requiresPlan: null`) adds no query to any page. And this decides what
  // is SHOWN: `app/api/chat/route.ts` asks the same questions again on every
  // request, because a button nobody rendered is not a check.
  const chat = chatConfig();
  const chatEnabled = isChatEnabled();
  const chatAvailable = mayUseChat(
    chatEnabled,
    chat.requiresPlan,
    chatEnabled && chat.requiresPlan !== null
      ? await hasPlan(session.user.id, chat.requiresPlan)
      : false,
  );


  // What the installed modules want the sidebar to show — features and unread
  // dots, resolved on the server and handed over as booleans.
  //
  // ⚠️ A module that is switched off answers `{}` without touching the
  // database; the guard lives inside each module's `shellState()`. With no
  // module installed this is one `Promise.all` over an empty array.
  //
  // The walk moved into `moduleShellState()` when the admin hub became the
  // second surface asking the same question — that file says why one answer
  // rather than two.
  const { features: moduleFeatures, badges: moduleBadges } = await moduleShellState({
    memberId: session.user.id,
    role: session.user.role,
    impersonating: Boolean(session.user.impersonation),
  });

  return (
    <>
      <AppShell
        appName={APP_NAME}
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }}
        // Resolved here rather than in the shell: `isChatEnabled()` reads the
        // product registry, and that JSON carries prices and Digistore24 product
        // ids. The shell is a client component — it gets the answer, not the file.
        //
        // NOT `chatEnabled` on its own: an assistant switched on in
        // config/ai-chat.json whose provider key is missing would otherwise hide
        // the one page that says so. See `chatNavVisible()`.
        features={{
          chat: chatNavVisible(
            chatEnabled,
            chat.enabled,
            isOwner(session.user.role),
          ),
          // Whatever the installed modules resolved for their own entries. Last,
          // so a module cannot quietly override a core key — `loadModules()`
          // already refuses two modules claiming one, and the core's own keys
          // are not a module's to answer.
          ...moduleFeatures,
        }}
        badges={moduleBadges}
        signOutAction={signOutAction}
      >
        {/* "Put this app on your home screen" — once, from the second visit,
            and then never again. Inside the shell so it sits in the page flow
            above the content: a second sticky element would collide with the
            header (see components/impersonation-banner.tsx). It renders nothing
            at all wherever installing is not a thing that can happen, and the
            permanent place for the same offer is the user menu. */}
        <InstallHint />
        {children}

        {/* Inside the shell, below the page. § 5 DDG asks for the Impressum to
            be reachable from every page, and "every" includes the ones behind
            the sign-in — a customer looking for who they are actually dealing
            with is usually somebody who has already signed up. Rendered here
            rather than in AppShell so the shell stays a layout component with
            no filesystem read in it. */}
        <div className="mt-10">
          <SiteFooter />
        </div>
      </AppShell>

      {/* Beside the shell, not inside it. The launcher is `position: fixed`,
          and a `transform` on any ancestor — the sidebar animates with one —
          would make that ancestor its containing block and pin the button to
          the middle of the page instead of the window. */}
      {chatAvailable && (
        <ChatLauncher
          assistantName={chat.name}
          avatar={chat.avatar}
          // The Media Marker whitelist (AD-54), resolved HERE because the
          // launcher is a client component and the set comes off the handbook
          // on disk — same load the chat's prompt rides on, so it costs no
          // second filesystem walk in production. Only when the launcher
          // actually renders; the companion panel gets none, deliberately.
          allowedMedia={allowedMediaMarkers()}
        />
      )}
    </>
  );
}
