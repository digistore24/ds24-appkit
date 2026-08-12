// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

import { ACTIVITIES, findActivity } from "./activities";
import { activityProblems } from "./rules";

describe("the activity registry", () => {
  it("ships empty", () => {
    // Deliberate, and the model is COMPANIONS, not the cron jobs: an
    // activity the template put in front of a vendor's own
    // customers would be one nobody chose. This is a guard for the day
    // somebody adds the first entry — from then on it asserts the list is
    // sound rather than absent.
    expect(activityProblems(ACTIVITIES)).toEqual([]);
  });

  it("findActivity answers null for an unknown id, never throws", () => {
    expect(findActivity("gibtsnicht")).toBeNull();
  });
});
