// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { Callout } from "@/components/ui/callout";
import { requireActiveUser } from "@/lib/authz";
import { hasPlan } from "@/lib/entitlements/manage";
import {
  chatConfig,
  chatOffReason,
  chatProviderEnvVar,
  chatProviderId,
  isChatEnabled,
} from "@/lib/ai/chat-config";
import { isOwner } from "@/lib/roles";
import { listConversation } from "@/lib/ai/conversation";
import { allowedMediaMarkers } from "@/lib/ai/knowledge";
import { ChatWindow } from "./ui";

// The tab this page opens in — every other page under `app/dashboard/` sets
// one, and without it the browser falls back to the layout's bare app name.
// The assistant's name comes from `config/ai-chat.json`, so the title carries
// it exactly as the heading does rather than saying "Chat".
export async function generateMetadata() {
  const t = await getTranslations("chat");
  return { title: t("title", { name: chatConfig().name }) };
}

// The assistant.
//
// This page ALWAYS renders — switched off it shows a notice, not a 404 and not
// an error. Two reasons, and the second is the one that bites otherwise:
// somebody who followed a link to it deserves to be told why it is empty, and
// `node run.mjs smoke` calls every page under `app/` and reads a 5xx as a
// broken app. A feature that is not configured yet is not a broken app.
//
// Everything below is resolved on the SERVER and handed to the client
// component as plain values: `isChatEnabled()` and `hasPlan()` read config
// files and the database, and neither belongs in a browser bundle.
export default async function ChatPage() {
  const session = await requireActiveUser();
  const memberId = session.user.id;
  const t = await getTranslations("chat");
  const config = chatConfig();

  const header = (
    <PageHeader
      title={t("title", { name: config.name })}
      description={t("subtitle")}
    />
  );

  const offReason = chatOffReason();
  if (!isChatEnabled() && offReason) {
    // WHO is asking decides what they are told. The second place that makes
    // the same distinction is the dashboard's Digistore24 pair (the status
    // card and its callout, both `isOperator &&`) — and the rule both follow
    // is written down one page over, in `app/plans/page.tsx` → `SETUP_HINTS`:
    // a real buyer must never be shown a terminal command.
    //
    // The Operator gets the diagnosis: they switched her on, they are the one
    // who can fix it, and the sentence names a file and an environment
    // variable. A Member gets that this app has no assistant and nothing
    // further — the name of a missing key is the shape of somebody else's
    // infrastructure, and a customer can act on none of it. They reach this
    // page only by typing the URL; the navigation never offers it to them.
    const body = isOwner(session.user.role)
      ? // The reason is a code from lib/ai/chat-config.ts, translated here —
        // the module has no language, the page does.
        {
          disabledInConfig: t("offDisabledInConfig"),
          // The env var is looked up rather than written into the message:
          // which key is missing depends on which provider her task is bound
          // to, and a sentence naming one company would be wrong for every app
          // that chose another. Same bug the leak guard found inside
          // chat-config.ts.
          noApiKey: t("offNoApiKey", {
            envVar: chatProviderEnvVar(),
            provider: chatProviderId(),
          }),
          brokenConfig: t("offBrokenConfig"),
        }[offReason]
      : t("offForMember", { name: config.name });

    return (
      <>
        {header}
        <Callout
          // For the Operator this is a to-do, for the Member a fact.
          variant={isOwner(session.user.role) ? "warning" : "info"}
          title={t("offTitle", { name: config.name })}
        >
          {body}
        </Callout>
      </>
    );
  }

  // Whether the feature exists is one question; whether THIS person may use it
  // is another. `hasPlan` reads `grants` — the app's own answer to "may this
  // person use this" — never a billing table.
  if (config.requiresPlan && !(await hasPlan(memberId, config.requiresPlan))) {
    return (
      <>
        {header}
        <Callout variant="warning" title={t("noAccessTitle")}>
          {t("noAccessBody")}
        </Callout>
      </>
    );
  }

  const history = await listConversation(memberId);

  return (
    <>
      {header}
      <ChatWindow
        assistantName={config.name}
        avatar={config.avatar}
        initial={history.map((turn) => ({
          id: turn.id,
          role: turn.role,
          content: turn.content,
          // Stored with the turn, so a link the customer had yesterday is
          // still a link today. `null` (every row older than the column, and
          // every question) denies, which is the safe direction.
          links: turn.links ?? undefined,
        }))}
        // The Media Marker whitelist (AD-54), derived on the server from the
        // same handbook load the prompt rides on. Passing it to the browser
        // leaks nothing: the handbook is her knowledge for every signed-in
        // member, and the delivery route re-guards every fetch.
        allowedMedia={allowedMediaMarkers()}
      />
    </>
  );
}
