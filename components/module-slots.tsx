// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The core's side of a page slot: "something may go here".
//
// A SERVER component, and it has to be — a module's slot component fetches its
// own data, which is the whole reason the core does not have to know what filled
// the slot. Rendering this from a client component would make every module's
// card a client component too, and drag its queries into the browser bundle.
//
// ⚠️ **It renders nothing when nothing is installed, and that is the shipped
// state.** No wrapper, no heading, no divider — a page with an empty slot must
// be byte-for-byte the page that had no slot, or every app that installed no
// module pays for the ones that did. `scripts/modules/slots.test.ts` asserts it.
import type { SlotName, ModuleSlotProps } from "@/lib/modules/slots";
import type { ModuleViewer } from "@/lib/modules/types";
import { MODULE_SLOTS } from "@/lib/modules/slot-registry";

export function ModuleSlots({ name, viewer }: { name: SlotName; viewer: ModuleViewer }) {
  const filled = MODULE_SLOTS.filter((entry) => entry.slot === name);
  if (filled.length === 0) return null;

  return (
    <>
      {filled.map(({ module, Component }) => {
        // Each module's card is its own element with its own key — a module
        // whose card throws must not be able to take the page's other cards
        // with it any more than it already can.
        const props: ModuleSlotProps = { viewer };
        return <Component key={module} {...props} />;
      })}
    </>
  );
}
