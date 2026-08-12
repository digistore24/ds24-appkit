// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The stamp is what makes the setup precondition affordable: with it, `build-app`
// skips a `doctor` run. So a stamp that is trusted when it should not be is the
// expensive failure — it puts the "machine is fine" answer in front of a machine
// that is not, which is the exact situation this whole mechanism exists for.
import { describe as suite, expect, it } from "vitest";
import { stampValid, verifiedOn } from "./setup-stamp.mjs";

const stamp = { verifiedAt: "2026-07-26T09:12:00.000Z", node: "v22.14.0", platform: "darwin" };
const here = { node: "v22.14.0", platform: "darwin" };

suite("stampValid", () => {
  it("accepts a stamp from this machine", () => {
    expect(stampValid(stamp, here)).toBe(true);
  });

  it("has nothing to accept when there is no stamp", () => {
    expect(stampValid(null, here)).toBe(false);
    expect(stampValid({}, here)).toBe(false);
  });

  it("ignores the patch level — a Node update is not a new machine", () => {
    expect(stampValid(stamp, { ...here, node: "v22.20.1" })).toBe(true);
  });

  it("rejects a different Node major: the check that passed passed elsewhere", () => {
    expect(stampValid(stamp, { ...here, node: "v20.11.0" })).toBe(false);
  });

  it("rejects another platform — the same folder opened from Windows and WSL", () => {
    expect(stampValid(stamp, { ...here, platform: "win32" })).toBe(false);
  });

  // A stamp written before the field existed carries no `browser`, and is not
  // rejected for it: otherwise every app already installed would re-run its
  // whole setup over a question nobody had put to it yet.
  it("accepts a stamp written before the browser field existed, either way", () => {
    expect(stampValid(stamp, { ...here, browser: true })).toBe(true);
    expect(stampValid(stamp, { ...here, browser: false })).toBe(true);
  });

  // The distinction `platform` cannot make. A cloud session and a desktop app on
  // a Linux laptop are both "linux", so without this field the stamp would carry
  // "a browser can open here" from the one into the other — and with it the
  // promise that somebody is looking at this screen.
  it("rejects the same platform once nobody is at the screen any more", () => {
    const withScreen = { ...stamp, browser: true };
    expect(stampValid(withScreen, { ...here, browser: true })).toBe(true);
    expect(stampValid(withScreen, { ...here, browser: false })).toBe(false);
  });

  it("rejects it the other way round too — the folder that gained a screen", () => {
    expect(stampValid({ ...stamp, browser: false }, { ...here, browser: true })).toBe(false);
  });
});

suite("verifiedOn", () => {
  it("names the day, which is all the greeting has room for", () => {
    expect(verifiedOn(stamp)).toBe("2026-07-26");
  });

  it("says nothing rather than something wrong", () => {
    expect(verifiedOn(null)).toBe("");
    expect(verifiedOn({ verifiedAt: 17 })).toBe("");
  });
});
