// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Does this environment hold anything of this module's?
//
// ⚠️ **Nothing here is content.** An `api_keys` row is a credential a MEMBER
// minted for their own program; no deploy brings one, and an environment with
// zero has nothing missing — it has nobody using the API yet.
//
// It answers anyway, because `content-check` exists to tell "there is nothing
// here" apart from "I could not look" (`lib/content/presence.ts`), and a module
// that owns rows and stays silent makes those two render the same. `expected` is
// null, so this line can never fail a run.
//
// 🚨 **A count, never a listing.** The key material is hashed and the rest —
// whose key, what it is called, when it was last used — is the member's, not an
// operator's dashboard. This report is read by whoever can reach the setup
// surface, so what it says is one number and nothing about anybody.

import { countAllLiveKeys } from "../keys/keys";
import type { PresenceContributor, PresenceReport } from "@/lib/content/presence";

const contributor: PresenceContributor = {
  id: "api",
  async check(): Promise<PresenceReport> {
    return {
      owner: "api",
      items: [{ what: "API keys (members' own, live)", found: await countAllLiveKeys(), expected: null }],
    };
  },
};

export default contributor;
