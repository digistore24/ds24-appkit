// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's card on `/dashboard/account` — the slot's filling.
//
// A SERVER component that fetches its own rows. That is the slot contract
// (`lib/modules/slots.ts`), and it is the reason the account page no longer has
// five imports, two awaited queries and a visibility condition belonging to a
// feature most apps do not have: it has one `<ModuleSlots name="account" />`,
// and does not know what filled it.
//
// The interactive half — `KeysCard` — is the same client component it always
// was, unmoved and unchanged.
import { headers } from "next/headers";

import type { ModuleSlotProps } from "@/lib/modules/slots";
import { countLiveKeys, listKeys } from "../keys/keys";
import { MAX_LIVE_KEYS } from "../keys/rules";
import { apiOffReason } from "../api/config";
import { KeysCard } from "./keys-ui";
import { createApiKeyAction, revokeApiKeyAction } from "../actions";

/**
 * The absolute URL a client is told to connect to.
 *
 * Moved here with the card rather than left on the account page: it exists to
 * spell `/api/v1` for somebody's laptop, so it belongs to the module that owns
 * that path. `APP_URL` first because it is the deliberate answer — what the
 * operator configured, and what every other outbound URL in this app uses; the
 * request's own origin is the fallback for a local machine whose app moved to
 * another port before `.env` caught up.
 *
 * This string is copied into a config file on somebody's laptop, so getting it
 * wrong costs them a debugging session rather than a page refresh.
 */
async function apiEndpoint(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/, "")}/api/v1`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}/api/v1`;
}

export default async function ApiKeysAccountCard({ viewer }: ModuleSlotProps) {
  const off = apiOffReason();
  const [rows, liveKeys] = await Promise.all([
    listKeys(viewer.memberId, "api"),
    countLiveKeys(viewer.memberId, "api"),
  ]);

  // Hidden entirely when the interface is off AND this member holds no keys —
  // there is no point showing somebody a feature their app does not offer. A
  // member who DOES hold keys sees it either way, so they can still revoke
  // them: a switch may hide an empty thing, never a non-empty one.
  //
  // ⚠️ Note what this is NOT: it is not the module being uninstalled. An
  // uninstalled module is not rendered at all, because it is not in the slot
  // registry. This condition is the module's own switch (`config/api.json`),
  // and the two questions stay separate here exactly as they do everywhere else.
  if (off && rows.length === 0) return null;

  return (
    <KeysCard
      namespace="apiKeys"
      keys={rows.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scope: key.scope,
        state: key.state,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
      }))}
      endpoint={await apiEndpoint()}
      maxLiveKeys={MAX_LIVE_KEYS}
      liveKeys={liveKeys}
      offReason={off}
      createAction={createApiKeyAction}
      revokeAction={revokeApiKeyAction}
    />
  );
}
