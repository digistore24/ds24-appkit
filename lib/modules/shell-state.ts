// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the installed modules want shown to THIS viewer — asked once, in one
// place.
//
// ── Why it is not simply inline in the layout any more ─────────────────────
// It was, and it was correct while the sidebar was the only surface that
// needed the answer. The admin hub is the second: it lists the operator's
// surfaces, and a module contributes some of them (`/dashboard/admin/course`,
// `/dashboard/admin/community`, `/dashboard/admin/metrics`). A hub that
// resolved the same feature keys with its own `Promise.all` would be a second
// opinion about whether a module's page exists — and the two would agree
// perfectly on the day it was written and drift on the day a module changes
// what `shellState()` answers. The sidebar showing an entry the hub does not
// (or worse, the other way round) is exactly the class of defect nothing here
// can measure.
//
// 🚨 SERVER ONLY. `MODULES` is the modules' server entry — the sidebar itself
// is a client component and receives BOOLEANS, never this function. The
// client-safe half of the same subject is `MODULE_NAV` in `./nav-registry.ts`.
import { MODULES } from "./registry";
import type { ModuleViewer } from "./types";

/** The resolved state, flattened — what a surface actually renders from. */
export interface ShellState {
  /** Feature keys the nav entries hide behind, resolved for this viewer. */
  readonly features: Readonly<Record<string, boolean>>;
  /** Hrefs with something new waiting — the sidebar's unread dot. */
  readonly badges: readonly string[];
}

/**
 * Ask every installed module what it wants this viewer to see.
 *
 * ⚠️ **Runs on every protected page load, so it answers cheaply or not at
 * all** — the property `ModuleEntry.shellState` documents and the reason a
 * switched-off module returns `{}` on its first line without touching the
 * database. With no module installed this is one `Promise.all` over an empty
 * array, which is the shipped state.
 *
 * A module with no `shellState` at all contributes nothing rather than
 * failing: `activity` and `companion` have no nav entry to resolve.
 */
export async function moduleShellState(viewer: ModuleViewer): Promise<ShellState> {
  const resolved = await Promise.all(
    MODULES.map(async (mod) => (mod.shellState ? await mod.shellState(viewer) : {})),
  );
  return {
    features: Object.assign({}, ...resolved.map((state) => state.features ?? {})),
    badges: resolved.flatMap((state) => state.badges ?? []),
  };
}
