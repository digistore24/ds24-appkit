// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isYes, parseArgs } from "./_client.mjs";
import { blankComments } from "../lib/source-text.mjs";

describe("isYes", () => {
  // Digistore24 answers boolean fields with the STRINGS "Y" and "N". Both are
  // truthy in JavaScript, which is exactly the trap this function exists for.
  it("reads the Digistore24 spelling", () => {
    expect(isYes("Y")).toBe(true);
    expect(isYes("N")).toBe(false);
  });

  it("does not fall for the truthy \"N\"", () => {
    // The whole point: `if ("N")` is true, `isYes("N")` is not.
    expect(Boolean("N")).toBe(true);
    expect(isYes("N")).toBe(false);
  });

  it("tolerates the other spellings the API uses in places", () => {
    expect(isYes(true)).toBe(true);
    expect(isYes(1)).toBe(true);
    expect(isYes("1")).toBe(true);
    expect(isYes("y")).toBe(true);
    expect(isYes(" Y ")).toBe(true);
    expect(isYes(false)).toBe(false);
    expect(isYes(0)).toBe(false);
    expect(isYes("0")).toBe(false);
  });

  it("treats what is not there as no", () => {
    expect(isYes(undefined)).toBe(false);
    expect(isYes(null)).toBe(false);
    expect(isYes("")).toBe(false);
  });
});

// Digistore24 sends every boolean as the STRING "Y"/"N" (base.php → bool()).
// Both are truthy, and neither is ever `=== true` — so a plain comparison is
// silently wrong instead of loudly broken. That has now cost us twice:
// `ipnSetup` claiming "created" on every update, and `ipnInfo.have_settings`
// making the dry run announce a "new" connection that had existed for weeks.
//
// isYes() itself is well covered above; the bug was never in isYes, it was in
// the one call site that forgot to use it. So this guards the call sites.
describe("no Y/N field is compared as a boolean", () => {
  // The fields the API source hands through bool(). Extend when a new one shows up.
  const YN_FIELDS = [
    "created",
    "updated",
    "deleted",
    "have_settings",
    "is_active",
    "is_success",
    "success",
  ];

  const dir = fileURLToPath(new URL(".", import.meta.url));
  const scripts = readdirSync(dir).filter((f) => f.endsWith(".mjs"));

  it("finds the scripts it is supposed to guard", () => {
    expect(scripts).toContain("ipn-setup.mjs");
    expect(scripts.length).toBeGreaterThan(3);
  });

  it.each(YN_FIELDS)("never compares .%s against true/false", (field) => {
    const bad = new RegExp(`\\.${field}\\s*[!=]==\\s*(true|false)`);
    const offenders = scripts
      // Comments blanked: a script may WRITE DOWN the comparison it must not
      // make without being reported for making it.
      .map((file) => ({ file, src: blankComments(readFileSync(join(dir, file), "utf8")) }))
      .filter(({ src }) => bad.test(src))
      .map(({ file }) => file);

    expect(
      offenders,
      `${offenders.join(", ")}: compare Digistore24's "${field}" with isYes(), not with ===. ` +
        `It arrives as the string "Y"/"N".`,
    ).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("reads values and flags", () => {
    expect(parseArgs(["--key", "pro", "--apply"])).toEqual({
      key: "pro",
      apply: true,
    });
  });

  it("keeps two flags apart when they follow each other", () => {
    // This is what `node run.mjs ds24-sync --dry-run` produces once the target has
    // added its own --apply: both have to arrive as flags, so that --dry-run
    // can win over --apply in the scripts.
    const args = parseArgs(["--apply", "--dry-run"]);
    expect(args.apply).toBe(true);
    expect(args["dry-run"]).toBe(true);
    expect(Boolean(args.apply) && !args["dry-run"]).toBe(false);
  });

  it("ignores everything that is not a flag", () => {
    expect(parseArgs(["noise", "--url", "https://x/api/ipn"])).toEqual({
      url: "https://x/api/ipn",
    });
  });
});
