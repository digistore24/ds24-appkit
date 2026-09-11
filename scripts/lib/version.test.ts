// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { versionAtLeast } from "./version.mjs";

describe("versionAtLeast", () => {
  it("compares numerically, not as text", () => {
    // "1.10.0" < "1.9.3" as strings — the bug this exists to avoid.
    expect(versionAtLeast("1.10.0", "1.9.3")).toBe(true);
    expect(versionAtLeast("1.9.3", "1.10.0")).toBe(false);
  });

  it("treats an equal version as sufficient", () => {
    expect(versionAtLeast("0.5.0", "0.5.0")).toBe(true);
  });

  it("pads the shorter side", () => {
    expect(versionAtLeast("2", "2.0.0")).toBe(true);
    expect(versionAtLeast("2.0", "2.0.1")).toBe(false);
  });

  it("does not crash on nonsense", () => {
    expect(versionAtLeast(undefined, "1.0.0")).toBe(false);
  });
});
