// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The mechanism that keeps "I could not look" from reading as "nothing is
// wrong" — asserted rather than assumed, because both halves of it are easy to
// lose in a tidy-up: the note that makes the run count a SKIP, and the stderr
// line that is the only channel a plain `npx vitest run` shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notChecked, resetNotCheckedLog } from "./test-not-checked";

/** A stand-in for vitest's context — its `skip()` throws, as the real one does. */
function fakeCtx(file: string, name = "a test") {
  const skipped: string[] = [];
  return {
    skipped,
    ctx: {
      task: { name, file: { name: file } },
      skip(note?: string) {
        skipped.push(note ?? "");
        throw new Error("SKIPPED");
      },
    },
  };
}

let wrote: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetNotCheckedLog();
  wrote = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  wrote.mockRestore();
});

describe("notChecked", () => {
  it("skips with the reason as the note, and does not return", () => {
    const { ctx, skipped } = fakeCtx("lib/one.test.ts");
    expect(() => notChecked(ctx, "the registry holds no token package")).toThrow("SKIPPED");
    expect(skipped).toEqual(["the registry holds no token package"]);
  });

  it("🚨 writes the reason to stderr, where the default reporter shows it", () => {
    // Not `console.warn`: vitest 4's default reporter prints console output
    // only for tests that FAIL, so a skipped test's warning reaches nobody.
    const { ctx } = fakeCtx("lib/one.test.ts");
    expect(() => notChecked(ctx, "no token package")).toThrow("SKIPPED");

    const line = String(wrote.mock.calls[0][0]);
    expect(line).toContain("NOT CHECKED");
    expect(line).toContain("lib/one.test.ts");
    expect(line).toContain("no token package");
    expect(line.endsWith("\n")).toBe(true);
  });

  it("says it once per file and reason — but skips every time", () => {
    // Six tests in one file share one cause; six paragraphs about it is how
    // people learn to scroll past the whole block.
    const first = fakeCtx("lib/one.test.ts", "first");
    const second = fakeCtx("lib/one.test.ts", "second");
    expect(() => notChecked(first.ctx, "no token package")).toThrow("SKIPPED");
    expect(() => notChecked(second.ctx, "no token package")).toThrow("SKIPPED");

    expect(wrote.mock.calls).toHaveLength(1);
    // The line is deduplicated. The verdict is not — the second test is
    // skipped, never passed.
    expect(second.skipped).toHaveLength(1);
  });

  it("keeps a different file and a different reason apart", () => {
    const a = fakeCtx("lib/one.test.ts");
    const b = fakeCtx("lib/two.test.ts");
    const c = fakeCtx("lib/one.test.ts");
    expect(() => notChecked(a.ctx, "same reason")).toThrow("SKIPPED");
    expect(() => notChecked(b.ctx, "same reason")).toThrow("SKIPPED");
    expect(() => notChecked(c.ctx, "another reason")).toThrow("SKIPPED");
    expect(wrote.mock.calls).toHaveLength(3);
  });
});
