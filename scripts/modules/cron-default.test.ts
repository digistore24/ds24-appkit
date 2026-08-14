// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 A module's scheduled job must arrive OFF.
//
// `config/cron.json` is the core's file, and a module cannot ship an entry in
// it — the core's config would then name a job that every app without the
// module does not have. But **leaving a job out of that file is not "off"**:
// `JOB_DEFAULTS` in `lib/cron/rules.mjs` is `{ enabled: true, everyMinutes:
// 1440 }`, so a job with no entry inherits enabled-and-daily. The only place a
// module can state its posture is its own registry entry, as
// `enabledByDefault: false`.
//
// What that means for a module somebody else wrote: install it, and by default
// its jobs run on the operator's server, every day, doing whatever they do —
// with nothing in this app having said yes. That is the failure this file
// closes, and it is the sharpest thing the module system hands a stranger.
//
// ⚠️ **Measured at zero on the day it was armed.** Both module jobs in this tree
// (`community-prune`, `courses-digest`) already declare it, each with its own
// argument written beside it. A rule that opened with a wall of findings is one
// somebody switches off, taking the intent with it — so it goes in at zero or
// not at all.
//
// AVAILABLE, not installed: `config/modules.json` ships empty, so asking the
// installed set would make this pass by describing nothing in exactly the app a
// customer starts from. Same reasoning as `privacy.test.ts`, which says it more
// sharply because a regulator is on the other end of that one.
import { describe, expect, it } from "vitest";

import { availableModules, readModule } from "./registry.mjs";

/** Every available module that declares scheduled jobs, with its cron file. */
const WITH_CRON = availableModules()
  .map((id) => {
    const { manifest } = readModule(id);
    const jobs = Array.isArray(manifest.cronJobs) ? (manifest.cronJobs as string[]) : [];
    return { id, jobs, cron: manifest.cron as string | undefined };
  })
  .filter((entry) => entry.jobs.length > 0 && typeof entry.cron === "string");

describe("a module's scheduled jobs arrive switched off", () => {
  it("finds modules with jobs to judge", () => {
    // Without this the loop below would pass on an empty set — the green-by-
    // vacuity this repo refuses everywhere else. If a day comes when no module
    // ships a job, this line is the one to argue with.
    expect(WITH_CRON.length, "no module declares cronJobs — nothing was checked").toBeGreaterThan(
      0,
    );
  });

  it.each(WITH_CRON.map((entry) => [entry.id, entry] as const))(
    "%s declares enabledByDefault: false for every job it brings",
    async (id, entry) => {
      // `/* @vite-ignore */` is what `scripts/modules/inventory.mjs` already
      // uses at its four dynamic imports off a manifest, and for the same
      // reason: the path is a value the manifest supplies, so there is no
      // static part for the bundler to analyse.
      const loaded = await import(/* @vite-ignore */ `../../modules/${id}/${entry.cron}`);
      const jobs = (loaded.default ?? []) as { id: string; enabledByDefault?: boolean }[];

      // The manifest's list and the file's list are two statements about the
      // same set, and `profiles.test.ts` already holds them to each other. What
      // is asked here is only the posture, per job the manifest declared.
      for (const jobId of entry.jobs) {
        const job = jobs.find((candidate) => candidate.id === jobId);
        expect(job, `${id} declares "${jobId}" in its manifest but ${entry.cron} has no such job`)
          .toBeDefined();
        expect(
          job?.enabledByDefault,
          `${id}'s job "${jobId}" does not say enabledByDefault: false — with no entry in ` +
            `config/cron.json it therefore inherits JOB_DEFAULTS, which is enabled and daily, ` +
            `and it would start running on the operator's server the moment the module is ` +
            `installed`,
        ).toBe(false);
      }
    },
  );
});
