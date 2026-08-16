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
import { hasPlan } from "@/lib/entitlements/manage";
import { countLiveKeys, listKeys } from "../keys/keys";
import { MAX_LIVE_KEYS } from "../keys/rules";
import { keysCardMode } from "../keys/visibility";
import { apiConfig, apiOffReason } from "../api/config";
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
  const config = apiConfig();
  const off = apiOffReason();

  const [rows, liveKeys, entitled] = await Promise.all([
    listKeys(viewer.memberId, "api"),
    countLiveKeys(viewer.memberId, "api"),
    // 🚨 Only asked while the config is COHERENT. `hasPlan()` throws on a
    // product key that is not in the registry, and an unknown `requiresPlan` is
    // exactly what `apiConfigProblems()` reports — so asking anyway would turn a
    // typo in a config file into a 500 on the whole account page. When the API
    // is off for any reason, the answer cannot change what the card does.
    off === null && config.requiresPlan
      ? hasPlan(viewer.memberId, config.requiresPlan)
      : Promise.resolve(true),
  ]);

  // Three separate questions decide what this card is — see `keys/visibility.ts`.
  // Hidden when the member could not make a key AND holds none; read-only when
  // they hold some, so a switch can hide an empty thing and never a non-empty
  // one; the full card otherwise.
  //
  // ⚠️ Note what none of this is: the module being uninstalled. An uninstalled
  // module is not rendered at all, because it is not in the slot registry.
  // Everything here is the module's own configuration, and the two questions
  // stay separate exactly as they do everywhere else.
  const { mode, reason } = keysCardMode({
    apiOff: off,
    selfService: config.selfService,
    entitled,
    keyCount: rows.length,
  });

  if (mode === "hidden") return null;

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
      // Only spelled out where it can be acted on. A read-only card is a list to
      // revoke from, and an address nobody may mint a key for is noise.
      endpoint={mode === "manage" ? await apiEndpoint() : null}
      maxLiveKeys={MAX_LIVE_KEYS}
      liveKeys={liveKeys}
      mode={mode}
      reason={reason}
      createAction={createApiKeyAction}
      revokeAction={revokeApiKeyAction}
    />
  );
}
