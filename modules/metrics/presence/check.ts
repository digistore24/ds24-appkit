// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Does this environment hold anything of this module's?
//
// ⚠️ **Nothing here is content, and saying so is the answer rather than a
// reason to stay silent.** Both tables fill themselves while the app runs — no
// deploy brings them, so there is nothing an operator could have forgotten to
// apply, and an environment with zero rows is a new one rather than a broken
// one. Hence `expected: null`, which can never fail a run.
//
// It answers anyway, because `content-check` exists to tell "there is nothing
// here" apart from "I could not look" (`lib/content/presence.ts`). A module
// that owns rows and stays silent makes those two render alike, which is the
// failure the whole command is built against.
//
// The two numbers are worth seeing together for one reason: events without any
// rolled-up days mean the rollup job has not run, and that is the state in
// which the before/after curve is quietly not being kept.
//
// 🚨 A THIN CALLER — no `@/db` import here. `lib/setup/module-boundary.test.ts`
// refuses one, and `../lib/counts` is the narrow file that carries the query.
import { countEvents, countDaily } from "../lib/counts";
import type { PresenceContributor, PresenceReport } from "@/lib/content/presence";

const contributor: PresenceContributor = {
  id: "metrics",
  async check(): Promise<PresenceReport> {
    return {
      owner: "metrics",
      items: [
        { what: "milestone events (collected while the app runs)", found: await countEvents(), expected: null },
        { what: "rolled-up days (written by metrics-rollup)", found: await countDaily(), expected: null },
      ],
    };
  },
};

export default contributor;
