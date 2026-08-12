// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { domainCodeOf } from "./dispatch";

class MediaError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "MediaError";
    this.code = code;
  }
}

describe("telling a refusal from an accident", () => {
  // 🚨 Found by uploading a file, not by reading the code.
  //
  // Every domain here throws a typed error carrying a code. Before this, all of
  // them fell into the crash branch and reached the caller as
  // `500 "The tool failed. The server log has the reason."` — the one sentence
  // an agent cannot act on, about a refusal that was perfectly actionable.
  it("reads the code off a typed domain error", () => {
    expect(domainCodeOf(new MediaError("fileDamaged"))).toBe("fileDamaged");
    expect(domainCodeOf(new MediaError("altRequired"))).toBe("altRequired");
  });

  // ⚠️ The other direction matters more. A database that stopped answering must
  // reach the operator as a 500 in the log, not as a polite "no" handed to an
  // agent that will then report the setup step as declined.
  it("does NOT treat a Node system error as a refusal", () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    enoent.name = "Error";
    expect(domainCodeOf(enoent)).toBeNull();

    const refused = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    refused.name = "SystemError";
    expect(domainCodeOf(refused)).toBeNull();
  });

  it("does not treat a plain crash as a refusal", () => {
    expect(domainCodeOf(new Error("boom"))).toBeNull();
    expect(domainCodeOf(new TypeError("x is not a function"))).toBeNull();
    expect(domainCodeOf("a string")).toBeNull();
    expect(domainCodeOf(null)).toBeNull();
  });

  it("ignores an error whose code is not a string", () => {
    const weird = Object.assign(new Error("x"), { code: 42 });
    weird.name = "WeirdError";
    expect(domainCodeOf(weird)).toBeNull();
  });
});
