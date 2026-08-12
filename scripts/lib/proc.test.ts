// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The parts of scripts/lib/proc.mjs that can be measured rather than trusted.
//
// The Windows branch of `spawnCommand()` never runs on the machine this test
// suite is usually executed on, which is exactly why the decisions it makes are
// pulled out into two pure functions: `cmdQuote()` and `cmdLine()` behave the
// same on all three systems, so the quoting can be held in place from Linux.
//
// What is deliberately NOT asserted here: that npm actually starts through
// cmd.exe. That needs a Windows machine, and pretending otherwise would be the
// same mistake as counting a 307 as a passing page.
import { describe, expect, it } from "vitest";
import path from "node:path";
import { notChecked } from "@/lib/test-not-checked";
import {
  canOpenBrowser,
  capture,
  cmdLine,
  cmdQuote,
  isWindows,
  openUrl,
  whichCommand,
} from "./proc.mjs";

describe("an argument on its way to cmd.exe", () => {
  // Everything this template actually passes is a plain token. It has to come
  // out the other side untouched — a stray pair of quotes around `run` would
  // make npm look for a script by that name including the quotes.
  it.each(["run", "typecheck", "install", "--save-dev", "db:migrate", "whoami", "embedded-postgres@16.14.0-beta.17"])(
    "leaves the literal %s alone",
    (argument) => {
      expect(cmdQuote(argument)).toBe(argument);
    },
  );

  it("quotes what cmd.exe would otherwise read as syntax", () => {
    expect(cmdQuote("a b")).toBe('"a b"');
    expect(cmdQuote(String.raw`C:\Program Files\nodejs\npm.cmd`)).toBe(
      String.raw`"C:\Program Files\nodejs\npm.cmd"`,
    );
    // The empty string is the window title in `start "" <url>`. Unquoted it
    // vanishes, and then cmd reads the URL as the title and opens nothing.
    expect(cmdQuote("")).toBe('""');
  });

  it("quotes a URL carrying query parameters", () => {
    // The bug this whole change grew out of: Digistore24's approval link goes
    // through here, and an unquoted `&` ends the command line at the first one.
    const url = "https://www.digistore24.com/api-key/approve?request_token=abc123&lang=de";
    expect(cmdQuote(url)).toBe(`"${url}"`);
    expect(cmdQuote(url)).toContain("&lang=de");
  });

  it("refuses a double quote instead of mangling it", () => {
    // cmd.exe's rules and the target program's parsing of the same string
    // disagree about `"`. Nothing in this template produces one; a refusal says
    // so out loud rather than producing a command line that is subtly wrong.
    expect(() => cmdQuote('say "hi"')).toThrow(/double quote/);
  });

  it("passes % and ! through, because a percent-encoded URL is normal", () => {
    // cmd expands `%NAME%` only for a variable that exists and `!` only under
    // delayed expansion, which `/d /s /c` does not switch on. Refusing these
    // would refuse the ordinary case.
    expect(cmdQuote("a%20b")).toBe("a%20b");
    expect(cmdQuote("hi!")).toBe("hi!");
  });
});

describe("the command line proc.mjs hands to cmd.exe", () => {
  it("is the join Node used to make, for every call this template makes", () => {
    // Node's own `shell: true` builds `[file, ...args].join(" ")`. For plain
    // tokens the result has to be identical, or this change would have altered
    // what runs on Windows rather than only how it is started.
    expect(cmdLine("npm", ["run", "typecheck"])).toBe("npm run typecheck");
    expect(cmdLine("npm", ["install"])).toBe("npm install");
    expect(cmdLine("npm", ["install", "--save-dev", "embedded-postgres@16.14.0-beta.17"])).toBe(
      "npm install --save-dev embedded-postgres@16.14.0-beta.17",
    );
  });

  it("quotes the resolved shim path, which normally has a space in it", () => {
    expect(cmdLine(String.raw`C:\Program Files\nodejs\npm.cmd`, ["run", "test"])).toBe(
      String.raw`"C:\Program Files\nodejs\npm.cmd" run test`,
    );
  });

  it("keeps a URL in one piece behind start", () => {
    const url = "https://example.com/a?x=1&y=2";
    expect(cmdLine("start", ["", url])).toBe(`start "" "${url}"`);
  });
});

describe("finding a command on the PATH", () => {
  it("finds the Node this test is running on", () => {
    // Whatever `node` is called here, it is on the PATH under its own basename
    // — that is what makes it the honest self-check for this function.
    const found = whichCommand(path.basename(process.execPath));
    expect(found).not.toBeNull();
  });

  it("takes a path that says where it is at its word", () => {
    expect(whichCommand(process.execPath)).toBe(process.execPath);
  });

  it("answers null for something that is not there", () => {
    expect(whichCommand("ds24-a-command-that-does-not-exist")).toBeNull();
    // A path, not a PATH lookup — and still nothing.
    expect(whichCommand(path.join(process.execPath, "not-a-directory", "nope"))).toBeNull();
  });
});

describe("whether a browser can open here", () => {
  // The bug this replaced: `openUrl()` returned `true` unconditionally, because
  // a missing `xdg-open` arrives as an asynchronous 'error' event and the event
  // had to be swallowed to keep the process alive. So the setup announced "The
  // browser was opened" on machines that have no screen at all, and then waited
  // eight minutes for a click nobody was in a position to make.
  //
  // Only the Linux branch is measurable from here — macOS and Windows answer
  // yes by construction, and asserting that would assert the constant back.
  const onLinux = !isWindows && process.platform !== "darwin";

  it.runIf(onLinux)("says no without a display, whatever is installed", () => {
    const display = process.env.DISPLAY;
    const wayland = process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    try {
      expect(canOpenBrowser()).toBe(false);
    } finally {
      if (display !== undefined) process.env.DISPLAY = display;
      if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
    }
  });

  // The claim that matters, and the one the old code got wrong: where no browser
  // can open, the answer is false — not "spawn did not throw".
  it.runIf(onLinux)("reports failure rather than success when it cannot open", async () => {
    const display = process.env.DISPLAY;
    const wayland = process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    try {
      await expect(openUrl("https://example.invalid/")).resolves.toBe(false);
    } finally {
      if (display !== undefined) process.env.DISPLAY = display;
      if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
    }
  });

  it("is the gate openUrl asks first — a no here is a no there", () => {
    // Non-vacuity: on a machine that CAN open one, the two agree the other way,
    // so the test above is measuring the guard rather than a constant `false`.
    expect(typeof canOpenBrowser()).toBe("boolean");
  });
});

// ── the bound on capture(), and the grandchild that used to defeat it ───────
//
// The failure this measures is not hypothetical and not subtle: `capture()`
// resolved on the child's 'close', which waits for every holder of its stdio
// pipes, and a child's own child inherits them. So a killed process with a
// surviving GRANDCHILD held the promise open for as long as the grandchild
// lived, and the `timeout` went by with no effect whatever. Measured on this
// tree before the fix: a 1000 ms bound around a shell wrapping a 12-second
// sleep resolved after 12016 ms; the same shape with a grandchild in its own
// session resolved after 20015 ms against the same 1000 ms bound.
//
// It was survivable only because the two rungs that pass a `timeout` today
// (`gitleaks`, the `docker` CLI) are single static binaries that start nothing —
// a property of those tools, which both rungs record in a comment. The next
// bounded call around a tool that starts something would have lost its bound in
// silence, and nothing anywhere would have gone red.

/** How long the planted grandchild lives if nobody ends it. */
const GRANDCHILD_MS = 30_000;

/** The bound the tests below hand to `capture()`. */
const BOUND_MS = 1_500;

/**
 * The ceiling a bounded call must come in under.
 *
 * Deliberately far above `BOUND_MS + DRAIN_MS` (1750 ms) and far below
 * `GRANDCHILD_MS` — a slow machine must not turn this red, and a regression
 * cannot slip under it, because a regression waits for the grandchild.
 */
const CEILING_MS = 10_000;

/**
 * A program that plants a grandchild on OUR stdio pipes and then sits there.
 *
 * `stdio: ['ignore', 1, 2]` is the whole point: the grandchild inherits the very
 * pipes `capture()` is reading, so it is a holder of them and 'close' cannot
 * arrive while it lives. It prints its pid first, so the test can end it however
 * the run goes.
 *
 * `detach` decides which claim is being measured. `false` is the ordinary
 * shape — a tool that starts a helper — and a kill that reaches the process
 * group ends it. `true` puts the grandchild in a session of its own, where NO
 * kill of ours can reach it, so what holds the bound there is only the decision
 * to stop waiting on 'close'.
 */
const plantGrandchild = (detach: boolean) => `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${GRANDCHILD_MS})'], {
  stdio: ['ignore', 1, 2],
  detached: ${detach},
});
${detach ? "child.unref();" : ""}
process.stdout.write('GRANDCHILD ' + child.pid + '\\n');
setTimeout(() => {}, ${GRANDCHILD_MS});
`;

/** Is this pid still around? Signal 0 asks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * End it, however it got there, and wait until it really is gone.
 *
 * The wait is not politeness. A signal is delivered asynchronously and the
 * planted grandchild is no child of ours — it was reparented when its own parent
 * was killed — so `process.kill(pid, 0)` still answers "there" for a moment
 * after the SIGKILL lands. Asserting on the instant reading made this test fail
 * on a machine where nothing was wrong.
 */
async function end(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true; // already gone
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !alive(pid);
}

/** The pid the planted program printed, or NaN if it never got that far. */
const plantedPid = (stdout: string) => Number(/GRANDCHILD (\d+)/.exec(stdout)?.[1]);

describe("capture() answers inside its timeout even when a grandchild holds the pipes", () => {
  // ⚠️ A regression does not fail fast here: it makes `capture()` wait for the
  // grandchild, so the test runs into vitest's own limit instead of the
  // assertion. That is still red, which is what matters — and the grandchild is
  // built to die by itself at GRANDCHILD_MS, so a red run leaves nothing behind
  // on the machine either way.
  it(
    "the ordinary shape — a tool that starts a helper",
    async () => {
      const started = Date.now();
      const result = await capture(process.execPath, ["-e", plantGrandchild(false)], {
        timeout: BOUND_MS,
      });
      const elapsed = Date.now() - started;
      const pid = plantedPid(result.stdout);
      const gone = await end(pid);

      // Non-vacuity FIRST: without this line a program that failed to start at
      // all would sail through every assertion below, because "nothing ran" and
      // "the bound held" are the same colour.
      expect(result.stdout, "the planted program never announced its grandchild").toMatch(
        /GRANDCHILD \d+/,
      );
      expect(Number.isFinite(pid)).toBe(true);

      expect(elapsed, `capture() took ${elapsed} ms against a ${BOUND_MS} ms bound`).toBeLessThan(
        CEILING_MS,
      );
      expect(result.timedOut).toBe(true);
      // A stopped run is not a successful one — `rungs/history.mjs` reads exactly
      // this to tell "gitleaks found nothing" from "gitleaks never finished".
      expect(result.code).not.toBe(0);
      // And the output that HAD arrived is still there. Settling early may never
      // be a way of losing what was already read.
      expect(result.stdout).toContain("GRANDCHILD");

      expect(gone, "the planted grandchild outlived the test").toBe(true);
    },
    CEILING_MS * 2,
  );

  it(
    "a grandchild no kill of ours can reach — so only the resolution rule holds the bound",
    async (ctx) => {
      if (isWindows) {
        // Windows has no process groups and no sessions to escape into; the
        // template's answer there is `taskkill /T`, which walks the tree from a
        // LIVING process, so "a grandchild our kill cannot reach" is not a state
        // this test can construct. The claim above is therefore unmeasured on
        // Windows — said out loud rather than passed silently.
        return notChecked(
          ctx,
          "a grandchild outside our reach needs POSIX sessions — Windows has none, and its answer is taskkill /T",
        );
      }

      const started = Date.now();
      const result = await capture(process.execPath, ["-e", plantGrandchild(true)], {
        timeout: BOUND_MS,
      });
      const elapsed = Date.now() - started;
      const pid = plantedPid(result.stdout);

      expect(result.stdout, "the planted program never announced its grandchild").toMatch(
        /GRANDCHILD \d+/,
      );

      // 🚨 The line that makes this a measurement rather than a repeat of the
      // test above: the grandchild is STILL RUNNING and STILL HOLDING the pipes.
      // So 'close' has not arrived and cannot have been what resolved the
      // promise. If this is ever false, the kill got there after all and this
      // test has quietly stopped asking its question.
      const survived = alive(pid);
      const gone = await end(pid);
      expect(survived, "the grandchild did not survive — this test measured the kill, not the wait").toBe(
        true,
      );

      expect(elapsed, `capture() took ${elapsed} ms against a ${BOUND_MS} ms bound`).toBeLessThan(
        CEILING_MS,
      );
      expect(result.timedOut).toBe(true);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toContain("GRANDCHILD");

      expect(gone, "the planted grandchild outlived the test").toBe(true);
    },
    CEILING_MS * 2,
  );
});

describe("capture() on the paths that were never in trouble", () => {
  // The bound is new; everything below is the contract every other caller in the
  // tree already relies on, and it has to answer exactly as it did before.
  it("hands back stdout, stderr and the exit code, with no bound in sight", async () => {
    const result = await capture(process.execPath, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    ]);
    expect(result).toMatchObject({ code: 3, stdout: "out", stderr: "err", timedOut: false });
  });

  it("answers the same with a bound that is nowhere near being reached", async () => {
    const result = await capture(process.execPath, ["-e", "process.stdout.write('out')"], {
      timeout: 30_000,
    });
    expect(result).toMatchObject({ code: 0, stdout: "out", timedOut: false });
  });

  it("still answers 127 for a binary that is not there", async () => {
    // `hasCommand()` is built on this number, and so is every rung that reports
    // a missing tool as "not asked" rather than as a finding.
    const result = await capture("ds24-a-command-that-does-not-exist", ["--version"]);
    expect(result.code).toBe(127);
    expect(result.timedOut).toBe(false);
  });

  it("does not truncate a large write, bound or no bound", async () => {
    // The measured risk of settling on 'exit' instead of 'close' is output left
    // in a pipe. The normal path still waits for 'close', and this is what says
    // so — 4 MB is well past any pipe buffer on any of the three systems.
    const size = 4_000_000;
    const write = `process.stdout.write('y'.repeat(${size}))`;
    const unbounded = await capture(process.execPath, ["-e", write]);
    const bounded = await capture(process.execPath, ["-e", write], { timeout: 30_000 });
    expect(unbounded.stdout.length).toBe(size);
    expect(bounded.stdout.length).toBe(size);
  });
});
