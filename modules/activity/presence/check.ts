// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Does this environment hold anything of this module's?
//
// ⚠️ **Nothing here is content, and that is the honest answer rather than a
// reason to stay silent.** `activity_results` are the MEMBERS' own work — what
// somebody answered, where they stopped. No deploy is supposed to bring them,
// so there is nothing an operator could have forgotten to apply, and an
// environment with zero is a new environment rather than a broken one.
//
// It answers anyway, because `content-check` exists to tell "there is nothing
// here" apart from "I could not look" (`lib/content/presence.ts`). A module
// that owns rows and stays silent makes those two render the same, which is the
// failure the whole command is built against. So: `expected: null`, which can
// never fail a run, and a line an operator can read.
//
// The number is worth seeing for one reason: it says whether anybody has USED
// the activities this app ships. Zero in PROD a month after launch is not a
// content fault — it is a product finding.

import { countResults } from "../results";
import type { PresenceContributor, PresenceReport } from "@/lib/content/presence";

const contributor: PresenceContributor = {
  id: "activity",
  async check(): Promise<PresenceReport> {
    return {
      owner: "activity",
      items: [{ what: "activity results (members' own)", found: await countResults(), expected: null }],
    };
  },
};

export default contributor;
