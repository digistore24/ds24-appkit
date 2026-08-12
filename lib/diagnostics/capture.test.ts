// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The tap, the ring, and the two claims this whole feature stands on.
//
// ⚠️ **What vitest CANNOT prove is named here rather than left implied.** The
// one failure mode that would make the endpoint answer `{ findings: [] }` for
// ever — `instrumentation.ts` and the route holding two different module
// instances, so the writer fills ring A and the reader reads ring B — is
// invisible in this file by construction: vitest has ONE module registry. Only
// a deployed app can produce the split, which is why `scripts/deploy-test.mjs`
// in the factory provokes a real error against a real production build. See the
// header of `capture.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installErrorCapture, MAX_LINES, readWindow, resetCapture } from "./capture";
import { parseErrors } from "./parse.mjs";
import * as redact from "./redact.mjs";

/** The tap only installs in the Node runtime — that is Next's own variable. */
function withRuntime(fn: () => void | Promise<void>) {
  const before = process.env.NEXT_RUNTIME;
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = before;
  }
}

beforeEach(() => resetCapture());
afterEach(() => {
  resetCapture();
  vi.restoreAllMocks();
});

describe("the tap", () => {
  it("does nothing outside the Node runtime", () => {
    const before = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "edge";
    const original = process.stderr.write;
    installErrorCapture();
    expect(process.stderr.write).toBe(original);
    if (before === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = before;
  });

  it("does nothing when DIAGNOSTICS_CAPTURE is off — the kill switch is real", () => {
    withRuntime(() => {
      process.env.DIAGNOSTICS_CAPTURE = "off";
      const original = process.stderr.write;
      installErrorCapture();
      expect(process.stderr.write).toBe(original);
      delete process.env.DIAGNOSTICS_CAPTURE;
    });
  });

  it("installs once, however often it is called", () => {
    withRuntime(() => {
      installErrorCapture();
      const wrapped = process.stderr.write;
      installErrorCapture();
      installErrorCapture();
      expect(process.stderr.write).toBe(wrapped);
    });
  });

  it("🚨 passes the original's return value back, verbatim", () => {
    withRuntime(() => {
      // That value is BACKPRESSURE. Returning `true` unconditionally makes a
      // busy app buffer without bound — a diagnostics tap that changes how the
      // app writes is worse than no tap at all.
      const original = process.stderr.write;
      const fake = vi.fn().mockReturnValue(false);
      process.stderr.write = fake as unknown as typeof process.stderr.write;
      installErrorCapture();

      expect(process.stderr.write("something\n")).toBe(false);
      expect(fake).toHaveBeenCalled();

      resetCapture();
      process.stderr.write = original;
    });
  });

  it("hands both call signatures through untouched", () => {
    withRuntime(() => {
      const original = process.stderr.write;
      const seen: unknown[][] = [];
      const fake = vi.fn((...args: unknown[]) => {
        seen.push(args);
        return true;
      });
      process.stderr.write = fake as unknown as typeof process.stderr.write;
      installErrorCapture();

      const callback = () => {};
      process.stderr.write("a\n", callback);
      process.stderr.write("b\n", "utf8", callback);

      expect(seen[0]).toEqual(["a\n", callback]);
      expect(seen[1]).toEqual(["b\n", "utf8", callback]);

      resetCapture();
      process.stderr.write = original;
    });
  });

  it("never throws into a caller, even when redaction does", () => {
    withRuntime(() => {
      const original = process.stderr.write;
      process.stderr.write = (() => true) as unknown as typeof process.stderr.write;
      installErrorCapture();
      vi.spyOn(redact, "redactLine").mockImplementation(() => {
        throw new Error("boom");
      });

      expect(() => process.stderr.write("anything\n")).not.toThrow();

      resetCapture();
      process.stderr.write = original;
    });
  });
});

describe("the ring", () => {
  /** Writes through the tap without the test's own output reaching the console. */
  function write(text: string) {
    const original = process.stderr.write;
    process.stderr.write = (() => true) as unknown as typeof process.stderr.write;
    installErrorCapture();
    process.stderr.write(text);
    resetCapture();
    process.stderr.write = original;
  }

  /** Same, but leaves the ring in place so several writes accumulate. */
  function open() {
    const original = process.stderr.write;
    process.stderr.write = (() => true) as unknown as typeof process.stderr.write;
    installErrorCapture();
    const tapped = process.stderr.write;
    return {
      write: (text: string) => tapped.call(process.stderr, text),
      close: () => {
        process.stderr.write = original;
      },
    };
  }

  it("keeps whole lines and holds a partial tail until its newline arrives", () => {
    withRuntime(() => {
      const tap = open();
      tap.write("first\nsec");
      expect(readWindow().lines).toEqual(["first"]);
      tap.write("ond\n");
      expect(readWindow().lines).toEqual(["first", "second"]);
      tap.close();
    });
  });

  it("accepts a Buffer as readily as a string", () => {
    withRuntime(() => {
      const tap = open();
      tap.write("x\n");
      const tapped = process.stderr.write;
      tapped.call(process.stderr, Buffer.from("from a buffer\n"));
      expect(readWindow().lines).toContain("from a buffer");
      tap.close();
    });
  });

  it("is bounded in lines, and says how many it dropped", () => {
    withRuntime(() => {
      const tap = open();
      for (let i = 0; i < MAX_LINES + 25; i += 1) tap.write(`line ${i}\n`);
      const window = readWindow();
      expect(window.retainedLines).toBe(MAX_LINES);
      expect(window.droppedLines).toBe(25);
      // The OLDEST went, not the newest — a truncated window keeps what just
      // happened, which is what somebody is asking about.
      expect(window.lines[window.lines.length - 1]).toBe(`line ${MAX_LINES + 24}`);
      tap.close();
    });
  });

  it("is bounded in bytes too, whichever bites first", () => {
    withRuntime(() => {
      const tap = open();
      // 200 lines of 450 characters is ~90 KB against a 64 KB cap, and 200 is
      // well inside MAX_LINES — so it is the BYTE cap that has to bite here.
      //
      // ⚠️ Not "ten lines of 16 KB": `redactLine()` cuts every line at 500
      // characters first, so those ten arrive as ~5 KB in total and prove
      // nothing. The two caps compose, and this is the one that is easy to
      // write a vacuous test for.
      for (let i = 0; i < 200; i += 1) tap.write(`${"y".repeat(450)}\n`);
      const window = readWindow();
      expect(window.retainedLines).toBeLessThan(200);
      expect(window.retainedLines).toBeGreaterThan(0);
      expect(window.droppedLines).toBeGreaterThan(0);
      tap.close();
    });
  });

  it("answers only what came after a mark — the remote twin of markLog()", () => {
    withRuntime(() => {
      const tap = open();
      tap.write("before one\nbefore two\n");
      const mark = readWindow().seq;
      tap.write("after one\n");
      expect(readWindow({ after: mark }).lines).toEqual(["after one"]);
      // …and the mark itself keeps moving.
      expect(readWindow().seq).toBe(mark + 1);
      tap.close();
    });
  });

  it("names the window it looked at, so an empty answer is not 'your app is fine'", () => {
    withRuntime(() => {
      const window = readWindow();
      expect(window.retainedLines).toBe(0);
      expect(window.oldest).toBeNull();
      // The boot time and an instance id are in EVERY answer, empty or not:
      // an empty ring five seconds after a redeploy must not read as health.
      expect(window.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(window.instance).toMatch(/^[a-z0-9]{1,8}$/);
    });
    write("");
  });
});

describe("🚨 the equivalence needle — same bytes, same verdict", () => {
  // The whole feature's claim in one assertion: what comes out of the ring, run
  // through the UNMODIFIED parser, is what the local command would have said
  // about the same log text.
  const REAL_LOG = `   ▲ Next.js 16.2.11 (Turbopack)
 GET /dashboard/admin/challenges 200 in 624ms (next.js: 518ms, proxy.ts: 10ms)

⚠️  DEVELOPMENT LOGIN ACTIVE — sign-in without password and without magic link.

Error: FORMATTING_ERROR: Invalid time value
    at <unknown> (app/dashboard/admin/challenges/[id]/page.tsx:174:35)
    at AdminChallengePage (app/dashboard/admin/challenges/[id]/page.tsx:161:35)
  173 |                         <TableCell className="text-muted-foreground">
> 174 |                           {format.dateTime(person.since, { dateStyle: "medium" })}
      |                                   ^
  175 |                         </TableCell>
`;

  function throughTheRing(text: string) {
    const original = process.stderr.write;
    process.stderr.write = (() => true) as unknown as typeof process.stderr.write;
    installErrorCapture();
    process.stderr.write(text);
    const window = readWindow();
    process.stderr.write = original;
    return parseErrors(window.lines.join("\n"));
  }

  it("finds exactly what parseErrors() finds when handed the text directly", () => {
    withRuntime(() => {
      expect(throughTheRing(REAL_LOG)).toEqual(parseErrors(REAL_LOG));
    });
  });

  it("…and the comparison would notice a difference (the probe)", () => {
    // Without this, a future refactor that made BOTH sides return `[]` would
    // pass the assertion above for ever. A needle guard needs a needle probe:
    // proving the walk ran is not proving the comparison did.
    withRuntime(() => {
      const direct = parseErrors(REAL_LOG);
      expect(direct.length).toBeGreaterThan(0);
      const mutated = direct.map((finding, index) =>
        index === 0 ? { ...finding, location: "somewhere/else.ts:1" } : finding,
      );
      expect(throughTheRing(REAL_LOG)).not.toEqual(mutated);
    });
  });
});

describe("🚨 the privacy assertion — the process never retains the payload", () => {
  const LEAK =
    'Error: duplicate key value violates unique constraint "users_email_unique" ' +
    "Key (email)=(anna@example.com)\n";

  function ringHolding(text: string): string {
    const original = process.stderr.write;
    process.stderr.write = (() => true) as unknown as typeof process.stderr.write;
    installErrorCapture();
    process.stderr.write(text);
    const dump = JSON.stringify(readWindow());
    process.stderr.write = original;
    return dump;
  }

  it("holds no address anywhere in the window", () => {
    withRuntime(() => {
      const dump = ringHolding(LEAK);
      expect(dump).not.toContain("anna@example.com");
      // …and it did hold the LINE — the constraint name is the finding.
      expect(dump).toContain("users_email_unique");
    });
  });

  it("…and the assertion is not passing on an empty buffer (the probe)", () => {
    // With `redactLine()` stubbed to the identity the address MUST come back.
    // Otherwise the test above would be green against a ring that captured
    // nothing at all — which is exactly the failure this feature is built to
    // refuse everywhere else.
    withRuntime(() => {
      vi.spyOn(redact, "redactLine").mockImplementation((line: string) => line);
      expect(ringHolding(LEAK)).toContain("anna@example.com");
    });
  });
});
