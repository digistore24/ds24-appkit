// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 This module's Art. 50(1) surface.
//
// Since 2 August 2026 a system that talks to people has to say it is a machine,
// "at the latest at the time of the first interaction". `CLAUDE.md` states that
// as a rule about a LIST of surfaces rather than about any one feature, and a
// module that adds one joins the list here — a module that adds a surface and
// does NOT join ships a page talking to a person as a machine without saying
// so, and nothing else would notice: the page renders, the tests pass, only the
// obligation is missed.
//
// `.mjs` because `node run.mjs legal-check` is given no `needs` on purpose and
// runs with no bundler, so it cannot import TypeScript.
import { companionConfigFrom } from "./config.mjs";

export const surfaces = [
  {
    // The id IS the message namespace, so the key is `companion.disclaimer`.
    id: "companion",
    label: "a companion",
    // Read as a PATH by the checker, which then looks for the mount inside it.
    rendersIn: "modules/companion/components/companion-panel.tsx",
    configFile: "config/ai-companion.json",
    // ⚠️ Through `companionConfigFrom()`, never `raw?.enabled === true`. That
    // shortcut looks like a simplification and is the exact regression the
    // shared config reader was created to prevent — this check drifted that way
    // once already.
    isOn: (config) => companionConfigFrom(config).enabled,
    // The panel is drawn in one place, so there is no shared block to pin.
    insideBlock: null,
    // The one accepted false positive of this surface, in its own words and
    // with its own path — `node run.mjs legal-check` appends it to the refusal.
    // The switch can say "on" while the registry is still empty, and this file
    // cannot tell: `companions.ts` is TypeScript and legal-check has no bundler.
    // ⚠️ The sentence lived in `scripts/legal/check.mjs` behind an
    // `id === "companion"` test until the module moved, and it went on naming
    // `lib/ai/companions.ts` for as long as that path was wrong.
    switchedOnHint:
      "If you switched it on but have not declared a companion in " +
      "modules/companion/companions.ts yet, switch it back off until you do.",
  },
];
