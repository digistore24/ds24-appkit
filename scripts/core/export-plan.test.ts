// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { exportStamp, normalizeText, planExport, refuseTarget, writable } from "./export-plan.mjs";

const action = (plan: ReturnType<typeof planExport>, path: string) =>
  plan.find((entry) => entry.path === path)?.action;

describe("normalizeText", () => {
  const sha = (text: string) => createHash("sha256").update(normalizeText(text), "utf8").digest("hex");

  it("hashes the content, not the line endings it is stored with", () => {
    // Git for Windows checks out CRLF, and without this every file in such a
    // clone looks "edited in the target" — the export then refuses to write
    // anything, for ever, to somebody who touched nothing.
    expect(sha("export const x = 1;\r\n")).toBe(sha("export const x = 1;\n"));
  });

  it("still tells two different texts apart", () => {
    expect(sha("Body\n")).not.toBe(sha("Body!\n"));
  });

  it("changes nothing about an LF file", () => {
    const text = "# Title\n\nBody\n";
    expect(normalizeText(text)).toBe(text);
  });
});

describe("planExport", () => {
  it("replaces a file nobody there has touched", () => {
    const plan = planExport({
      local: { "lib/rules.ts": { current: "aaa", shipped: "aaa" } },
      remote: { "lib/rules.ts": "bbb" },
    });
    expect(action(plan, "lib/rules.ts")).toBe("update");
  });

  it("leaves a file alone that was edited in the target", () => {
    // The one case that must never be got wrong: somebody changed the copy in
    // their companion, and an export would take that away silently.
    const plan = planExport({
      local: { "lib/rules.ts": { current: "mine", shipped: "aaa" } },
      remote: { "lib/rules.ts": "bbb" },
    });
    expect(action(plan, "lib/rules.ts")).toBe("local-change");
    expect(writable(plan)).toEqual([]);
  });

  it("leaves a file alone that .core-version does not know", () => {
    // No baseline means no way to tell an untouched file from an edited one,
    // and "no idea" has to resolve to "hands off".
    const plan = planExport({
      local: { "lib/own.ts": { current: "mine", shipped: null } },
      remote: { "lib/own.ts": "theirs" },
    });
    expect(action(plan, "lib/own.ts")).toBe("local-change");
  });

  it("says nothing needs doing when the hashes match", () => {
    const plan = planExport({
      local: { "lib/rules.ts": { current: "same", shipped: "same" } },
      remote: { "lib/rules.ts": "same" },
    });
    expect(action(plan, "lib/rules.ts")).toBe("unchanged");
    expect(writable(plan)).toEqual([]);
  });

  it("writes a file the target does not have yet", () => {
    const plan = planExport({ local: {}, remote: { "lib/new.ts": "aaa" } });
    expect(action(plan, "lib/new.ts")).toBe("new");
    expect(writable(plan).map((entry: { path: string }) => entry.path)).toEqual(["lib/new.ts"]);
  });

  it("reports a withdrawn file instead of deleting it", () => {
    const plan = planExport({
      local: { "lib/old.ts": { current: "aaa", shipped: "aaa" } },
      remote: {},
    });
    expect(action(plan, "lib/old.ts")).toBe("withdrawn");
    expect(writable(plan)).toEqual([]);
  });

  it("does not report a withdrawn file that is already gone", () => {
    const plan = planExport({
      local: { "lib/old.ts": { current: null, shipped: "aaa" } },
      remote: {},
    });
    expect(plan).toEqual([]);
  });
});

describe("refuseTarget", () => {
  const ROOT = "/home/somebody/my-app";

  it("accepts a sibling directory — the intended shape", () => {
    expect(refuseTarget("/home/somebody/my-app-mobile/core", ROOT)).toBeNull();
  });

  it("refuses an empty target", () => {
    expect(refuseTarget("", ROOT)).toContain("no target");
    expect(refuseTarget(undefined, ROOT)).toContain("no target");
  });

  it("refuses the project itself and anything inside it", () => {
    expect(refuseTarget(ROOT, ROOT)).toContain("this app itself");
    expect(refuseTarget(`${ROOT}/core`, ROOT)).toContain("inside this app");
  });

  it("does not mistake a sibling with the same prefix for 'inside'", () => {
    // `/x/my-app-mobile` starts with `/x/my-app` as a STRING — the check has
    // to be path-segment-aware or the natural naming convention is refused.
    expect(refuseTarget("/home/somebody/my-app-mobile", ROOT)).toBeNull();
  });
});

describe("exportStamp", () => {
  it("carries version and per-file hashes, and no timestamp", () => {
    const stamp = exportStamp({ version: "0.11.0", files: { "lib/roles.ts": "abc" } });
    expect(stamp.version).toBe("0.11.0");
    expect(stamp.files).toEqual({ "lib/roles.ts": "abc" });
    // Same input, same output — a timestamp would make every export a diff.
    expect(JSON.stringify(stamp)).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it("copies the files map instead of aliasing it", () => {
    const files: Record<string, string> = { "a.ts": "1" };
    const stamp = exportStamp({ version: "1.0.0", files });
    files["b.ts"] = "2";
    expect(stamp.files).toEqual({ "a.ts": "1" });
  });
});
