// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// The read guard, held to its rule in both directions: what it refuses (a
// whole-file read of a long file, an unpiped `cat` of one) and — the half that
// matters more, because a guard that refuses too much gets removed — what it
// lets through: a range, a short file, a piped `cat`, a path that does not
// exist, a tool it does not know. The reasoning is in the script's header; the
// replay of a whole archived session through `decide()` lives in the factory,
// beside the archive.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_LINES, catCalls, countLines, decide } from "./read-guard.mjs";

let dir = "";
let long = "";
let short = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ds24-read-guard-"));
  long = join(dir, "long.ts");
  short = join(dir, "short.ts");
  writeFileSync(long, Array.from({ length: MAX_LINES + 50 }, (_, i) => `line ${i + 1}`).join("\n"));
  writeFileSync(short, Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const read = (file_path: string, extra: Record<string, unknown> = {}) =>
  decide({ tool_name: "Read", tool_input: { file_path, ...extra } }, { cwd: dir });
const bash = (command: string) => decide({ tool_name: "Bash", tool_input: { command } }, { cwd: dir });

describe("Read", () => {
  it("refuses a whole-file Read of a file over the threshold, naming the count", () => {
    const reason = read(long);
    expect(reason).toMatch(new RegExp(`has ${MAX_LINES + 50} lines`));
    expect(reason).toMatch(/offset \+ limit/);
  });

  it("lets a RANGE through — offset, limit, or both", () => {
    expect(read(long, { offset: 100, limit: 50 })).toBeNull();
    expect(read(long, { limit: 50 })).toBeNull();
    expect(read(long, { offset: 200 })).toBeNull();
  });

  it("lets a short file through whole, and the threshold itself is not over it", () => {
    expect(read(short)).toBeNull();
    const exact = join(dir, "exact.ts");
    writeFileSync(exact, Array.from({ length: MAX_LINES }, () => "x").join("\n"));
    expect(read(exact)).toBeNull();
  });

  it("lets a path it cannot judge through — missing file, a directory, no path", () => {
    expect(read(join(dir, "nope.ts"))).toBeNull();
    expect(read(dir)).toBeNull();
    expect(decide({ tool_name: "Read", tool_input: {} }, { cwd: dir })).toBeNull();
  });

  it("resolves a relative path against the session's cwd", () => {
    expect(read("long.ts")).toMatch(/has/);
    expect(read("short.ts")).toBeNull();
  });
});

describe("Bash", () => {
  it("refuses `cat` and `cat -n` of a long file", () => {
    expect(bash(`cat ${long}`)).toMatch(/has/);
    expect(bash("cat -n long.ts")).toMatch(/has/);
    expect(bash(`cd ${dir} && cat long.ts`)).toMatch(/has/);
  });

  it("lets a NARROWED cat through — head, sed, grep behind the pipe are a range", () => {
    expect(bash(`cat ${long} | head -40`)).toBeNull();
    expect(bash(`cat -n ${long} | sed -n '10,20p'`)).toBeNull();
    expect(bash(`cat ${long} | grep -n line`)).toBeNull();
  });

  it("a pipe into something that is not a narrower does not launder the read", () => {
    expect(bash(`cat ${long} | tee copy.ts`)).toMatch(/has/);
  });

  it("lets a short file, a missing file and a non-cat command through", () => {
    expect(bash(`cat ${short}`)).toBeNull();
    expect(bash("cat nope.ts")).toBeNull();
    expect(bash(`grep -n line ${long}`)).toBeNull();
    expect(bash(`sed -n '1,40p' ${long}`)).toBeNull();
    expect(bash("git status")).toBeNull();
  });

  it("a `cat` that WRITES (heredoc, redirection) is not a read of the target", () => {
    expect(bash(`cat > ${long} << 'EOF'\nx\nEOF`)).toBeNull();
    expect(bash(`cat ${short} > ${long}`)).toBeNull();
  });
});

describe("the pieces", () => {
  it("catCalls: files and narrowing per segment", () => {
    expect(catCalls("cat a.ts; cat b.ts | head; cd x && cat -n c.ts")).toEqual([
      { files: ["a.ts"], narrowed: false },
      { files: ["b.ts"], narrowed: true },
      { files: ["c.ts"], narrowed: false },
    ]);
    expect(catCalls("echo cat a.ts")).toEqual([]);
  });

  it("countLines: portable, null for what it cannot read", () => {
    expect(countLines(short)).toBe(40);
    expect(countLines(join(dir, "nope"))).toBeNull();
    expect(countLines(dir)).toBeNull();
  });

  it("an unknown tool is nobody's business", () => {
    expect(decide({ tool_name: "Grep", tool_input: { pattern: "x", path: long } }, { cwd: dir })).toBeNull();
    expect(decide({ tool_name: "Write", tool_input: { file_path: long, content: "" } }, { cwd: dir })).toBeNull();
    expect(decide(null as unknown as Record<string, unknown>, { cwd: dir })).toBeNull();
  });
});
