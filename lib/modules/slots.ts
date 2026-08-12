// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Where a module may put something on a page the CORE owns.
//
// Hand-written, not generated — same division as `types.ts`: the generator
// produces the LIST, this file produces the shape and the vocabulary.
//
// ── Why this exists at all ─────────────────────────────────────────────────
// Everything else a module contributes is additive to a registry: a route, a
// nav entry, a table, a text. A card on `/dashboard/account` is not — the page
// is the core's, the member expects one page for "my account", and giving each
// module its own page instead would answer the mechanical question by making
// the product worse.
//
// So the core names the PLACES, and a module fills one. The core never learns
// what filled it.
//
// ── The three rules a slot lives by ────────────────────────────────────────
//
//  1. **A slot component fetches its own data.** It is handed the viewer and
//     nothing else. The alternative — the page loading a module's rows and
//     passing them down — is the hub coming back wearing a prop.
//
//  2. **An empty slot renders nothing, and that is the shipped state.** With no
//     module installed `MODULE_SLOTS` is empty and the page is exactly what it
//     was. A slot must never render a heading, a divider or a placeholder for
//     an absence.
//
//  3. **A slot is not a permission.** Whatever the component shows, it decides
//     for itself what this viewer may see — the same duty a content source has.
//     Being rendered means the page had a place, never that the viewer passed
//     a check.
import type { ComponentType } from "react";

import type { ModuleViewer } from "./types";

/**
 * The places the core offers.
 *
 * ⚠️ **This list is the enforcement.** `lib/modules/slot-registry.ts` is
 * generated and typed against `SlotName`, so a manifest naming a slot that does
 * not exist fails `npm run typecheck` by the name it got wrong — rather than
 * generating a card that renders nowhere and is discovered by a customer.
 *
 * Adding a slot is therefore two edits and no more: a name here, and a
 * `<ModuleSlots name="…" />` on the page that offers it. `scripts/modules/
 * slots.test.ts` refuses a name with no renderer, which is the half that would
 * otherwise rot.
 */
export const SLOT_NAMES = ["account"] as const;

export type SlotName = (typeof SLOT_NAMES)[number];

/** Everything a slot component is given. Deliberately only this. */
export interface ModuleSlotProps {
  readonly viewer: ModuleViewer;
}

/** One module's contribution to one slot. */
export interface ModuleSlotEntry {
  /** The module that owns it — used as the React key and in nothing else. */
  readonly module: string;
  readonly slot: SlotName;
  readonly Component: ComponentType<ModuleSlotProps>;
}
