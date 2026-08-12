// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Starting other programs — the one place that knows the Windows quirks.
//
// Two rules, and they are the whole reason this file exists (CLAUDE.md →
// Three systems):
//
//  1. **Our own scripts run through `process.execPath`**, never through a
//     shell. `node scripts/users/create-user.mjs --email "a b@c.de"` then keeps
//     its arguments exactly as given — a shell would re-split them, and on
//     Windows with different quoting rules than on Linux.
//  2. **A `.cmd` shim is the only thing left that needs cmd.exe.** `npm` is one
//     on Windows, and Node has refused to spawn `.cmd`/`.bat` without a shell
//     since 18.20/20.12 (it fails with EINVAL). `git`, `docker`, `cloudflared`,
//     `node` and the hosting CLIs are real `.exe` files and need nothing — so
//     `spawnCommand()` looks the command up on the PATH first and reaches for a
//     shell only where the file leaves it no choice.
//
// That second rule used to read "npm needs `shell: true`", and it was handed an
// args array beside that flag — which is the combination Node 24 deprecated
// (DEP0190). The reason is worth knowing, because it is not pedantry: with
// `shell: true` Node builds the command line as a plain
// `[file, ...args].join(" ")` and escapes nothing, so an argument carrying a
// `&` or a `;` stops being an argument. It cannot tell whether those tokens
// came from a program or from a person, so it warns every time.
//
// Here it can be told: every argument that reaches the shell path is a literal
// in this repository — user input goes through `runScript()`, which uses no
// shell at all. But "trust us" is not something a warning can read, and the
// concatenation really was unsafe in one place (see `openUrl()`). So the
// command line is built HERE instead, by `cmdLine()`, with each argument
// quoted, and Node is handed a finished string. Same result on the calls we
// already made, correct on the one we got wrong, and no warning in front of the
// first command a Windows developer runs.
//
// `scripts/portability.test.ts` fails the build if a `shell:` option turns up in
// any other tooling script — this decision belongs in one place or in none.
//
// Everything here is promise-based; nothing polls a process table.
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** True while running on Windows — the flag that decides the two rules above. */
export const isWindows = process.platform === "win32";

// ── finding a command ───────────────────────────────────────────────────────

/** What Windows appends to a bare command name, in the order it tries them. */
const pathExtensions = () =>
  (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);

/** Is `file` there, and would this system run it? */
function runnable(file) {
  try {
    // On Windows the extension decides, and the caller above has already picked
    // it; asking for X_OK there answers a question NTFS does not really have and
    // calls every readable file executable.
    accessSync(file, isWindows ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Where `command` lives on the PATH, or null.
 *
 * This is not here for convenience. On Windows it is what decides whether a
 * shell is needed at all (rule 2), and the name alone cannot say: `npm` is a
 * `.cmd`, `node` is an `.exe`, and both are spelled the same way when you type
 * them.
 */
export function whichCommand(command) {
  const name = String(command);
  // Something that already says where it is was never a PATH question.
  if (name.includes("/") || name.includes("\\")) return runnable(name) ? name : null;

  const directories = (process.env.PATH || "").split(delimiter).filter(Boolean);
  // The name as written first — for whoever typed `npm.cmd` themselves — then
  // the extensions Windows would have tried on their behalf.
  const suffixes = isWindows ? ["", ...pathExtensions()] : [""];
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = join(directory, name + suffix);
      if (runnable(candidate)) return candidate;
    }
  }
  return null;
}

// ── handing cmd.exe a command line ──────────────────────────────────────────

/**
 * What cmd.exe reads as syntax rather than as text.
 *
 * `&` is the one that actually bit: Digistore24's approval link carries query
 * parameters, and an unquoted `&` ended the command line at the first of them —
 * the browser opened a truncated address and cmd tried to run the remainder.
 */
const CMD_SYNTAX = /[\s&|<>^(),;=]/;

/**
 * The one character this cannot honestly quote.
 *
 * A `"` has to satisfy cmd.exe's rules *and* the target program's parsing of
 * the same string, and the two disagree. `%` and `!` are deliberately NOT in
 * here: cmd expands `%NAME%` only for a variable that exists, and `!` only
 * under delayed expansion, which `/d /s /c` does not switch on — so a
 * percent-encoded URL survives, which is the case that actually occurs.
 */
const CMD_UNQUOTABLE = /"/;

/** One argument, safe to hand cmd.exe — or an error saying why it is not. */
export function cmdQuote(argument) {
  const text = String(argument);
  if (CMD_UNQUOTABLE.test(text)) {
    throw new Error(
      `✗ cannot pass ${JSON.stringify(text)} through cmd.exe — a double quote has no honest escaping here`,
    );
  }
  return text === "" || CMD_SYNTAX.test(text) ? `"${text}"` : text;
}

/** The command line Node used to concatenate — built here, and quoted. */
export const cmdLine = (command, args = []) => [command, ...args].map(cmdQuote).join(" ");

/** Windows spells a shim `.cmd` or `.bat`; everything else runs on its own. */
const isShim = (file) => /\.(cmd|bat)$/i.test(file);

/** cmd.exe, told to run one line and exit. The flags are explained at the call. */
const runOneLine = (line, options) =>
  spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...options,
    // `/d` skips the AutoRun registry key, `/s` makes cmd strip exactly the
    // outer pair of quotes and take the rest verbatim, `/c` runs and exits —
    // the same three Node uses internally, for the same reasons. Verbatim
    // arguments stop Node re-quoting the line we just finished quoting.
    windowsVerbatimArguments: true,
  });

/**
 * Start `command`, going through cmd.exe only where Windows leaves no choice.
 *
 * Every spawn in this file goes through here, which is what makes rule 2 a
 * property of the project rather than of whoever wrote the call.
 */
export function spawnCommand(command, args = [], options = {}) {
  if (!isWindows) return spawn(command, args, options);

  const resolved = whichCommand(command);
  // A real executable takes its arguments straight from Node, unmangled — and
  // that is most of them. It is also the better path: nothing is quoted here,
  // so nothing can be quoted wrongly.
  if (!resolved || !isShim(resolved)) return spawn(command, args, options);

  return runOneLine(cmdLine(resolved, args), options);
}

// ── the helpers everything else uses ────────────────────────────────────────

/**
 * Run a command, its output going straight to the terminal.
 * Resolves with the exit code (it does not throw on a non-zero one).
 *
 * ⚠️ **This one does NOT carry `capture()`'s bound, and does not need it.**
 * `stdio: "inherit"` means the child writes to our terminal directly, so this
 * process holds no pipe anybody could keep open — measured: the same shell
 * wrapper that made `capture()` overrun a 1000 ms bound by twelve seconds
 * resolves here at 1008 ms. What it DOES leave behind is the grandchild itself,
 * still running. Detaching to reach it is deliberately not done: `run()` is what
 * starts `next dev` and every interactive command, and a detached child leaves
 * the terminal's foreground process group — Ctrl-C would stop reaching it. If a
 * caller ever needs both, it wants `capture()` or its own group, not a change
 * here. Nothing passes a `timeout` to this function today.
 */
export function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawnCommand(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", (error) => {
      console.error(`✗ ${command} could not be started: ${error.message}`);
      resolve(error.code === "ENOENT" ? 127 : 1);
    });
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Run one of our own .mjs scripts with the current Node — no shell involved. */
export function runScript(scriptPath, args = [], options = {}) {
  return run(process.execPath, [scriptPath, ...args], options);
}

/** Run an npm script (`npm run <name>`). On Windows npm is the shim — see rule 2. */
export function runNpm(args, options = {}) {
  return run("npm", args, options);
}

// ── bounding a command that will not stop ───────────────────────────────────
//
// 🚨 **`timeout` on `capture()` is OUR timer, not the one `child_process.spawn`
// offers**, and the difference is the whole reason this block exists.
//
// **'close' is not 'exit'.** Node fires 'exit' when the child is gone, and
// 'close' when the LAST HOLDER of its stdio pipes has let go — and a child's own
// child inherits those pipes. So a shell wrapper around a background sleep,
// killed at one second, fires 'exit' at 1.007 s and 'close' at 12.010 s:
// measured on this tree, before this block existed, with `spawn`'s own
// `timeout` doing exactly what it promises. A `capture()` that resolves on
// 'close' therefore has no bound at all wherever the command starts something.
// It had one only where the command happened to be a single static binary —
// which is a property of `gitleaks` and the `docker` CLI, not of this function,
// and both rungs say so in a comment because the alternative was to fix this.
//
// Three decisions, each with a cost that was measured rather than assumed:
//
//  1. **The normal path still resolves on 'close', unchanged.** Settling on
//     'exit' can in principle cut output still sitting in a pipe. Measured
//     against that: single writes of 10 B, 1 KiB, 64 KiB, 1 MiB and 8 MiB, and
//     200 trials of a child that writes and dies while our loop is blocked —
//     'exit' never carried fewer bytes than 'close' on this platform. "Never on
//     Linux today" is not a contract, so the risk is simply never taken where
//     nothing is wrong: only a call that ASKED for a bound and then blew it
//     settles early, and even that one gives the pipes `DRAIN_MS` to hand over
//     whatever they are still holding.
//  2. **On Linux and macOS the kill goes to the process GROUP**, which is what
//     `detached: true` below is for. A killed shell whose grandchild survives is
//     not merely slow to report — it is a scanner still running over the
//     repository after the rung gave up on it. The cost is real and is paid only
//     by calls that pass a `timeout`: a detached child is not in the terminal's
//     foreground process group, so **Ctrl-C no longer reaches it**; the deadline
//     is what ends it instead.
//  3. **Windows has no process groups**, so the tree is walked with
//     `taskkill /T` — the same answer `scripts/dev/app.mjs` already gives for the
//     dev server, and the reason `scripts/portability.test.ts` forbids reading
//     the process table. It reaches a grandchild only while the direct child is
//     still alive to be walked from; once that child is gone its orphan is not
//     chased, because finding it means reading the process table. **So: the BOUND
//     holds on all three systems, the CLEANUP is complete on two, and this
//     sentence is the one that must not be quietly dropped.**

/**
 * How long a killed child may still hand over what its pipes are holding.
 *
 * The worst case a caller can see is therefore `timeout + DRAIN_MS`, and that is
 * a bound rather than a hope. Short on purpose: the bytes are already in this
 * process by the time 'exit' fires (see decision 1), so this window is for the
 * ordinary case where 'close' arrives a tick later — not for waiting anything out.
 */
const DRAIN_MS = 250;

/**
 * End `child` and, as far as this system allows, whatever it started.
 *
 * `grouped` is true only where the child was spawned detached, so it really is
 * its own group leader. The group OUTLIVES that leader, which is exactly the
 * grandchild case: the pid is gone, the group still holds the survivor.
 */
function killTree(child, signal, grouped) {
  const pid = child.pid;
  if (!pid) return;

  if (isWindows) {
    // `/T` walks the tree DOWN FROM a living process, so it goes first — after
    // the direct child is gone there is nothing left to walk from.
    try {
      spawnCommand("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on(
        "error",
        () => {},
      );
    } catch {
      /* taskkill lives in System32 on every Windows; a miss here is not fatal */
    }
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
    return;
  }

  if (grouped) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* the group is already empty — fall through to the child itself */
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
}

/**
 * Run a command and capture its output instead of showing it.
 * Resolves with `{ code, stdout, stderr, timedOut }`; a missing binary is 127.
 *
 * `timeout` (ms) is honoured HERE and deliberately not handed to `spawn` — two
 * timers for one bound would mean the weaker one silently wins. A run stopped by
 * it resolves non-zero, with whatever output had arrived, and `timedOut: true`
 * so a caller need not infer it from a wall clock.
 */
export function capture(command, args = [], options = {}) {
  const { timeout, killSignal = "SIGTERM", ...spawnOptions } = options;
  const boundMs = Number(timeout) > 0 ? Number(timeout) : 0;
  // Its own process group, so the kill can reach a grandchild — POSIX only, only
  // where a bound was asked for, and never against a caller who said otherwise.
  const grouped = boundMs > 0 && !isWindows && spawnOptions.detached !== false;

  return new Promise((resolve) => {
    const child = spawnCommand(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(grouped ? { detached: true } : {}),
      ...spawnOptions,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let exited = null;
    let deadline = null;
    let drain = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(drain);
      if (timedOut) {
        // A surviving grandchild still holds these pipes, and an open pipe keeps
        // OUR event loop alive: without this the caller would be answered and
        // the command would still not end, which is the same hang wearing a
        // different hat.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
      }
      resolve({ ...result, timedOut });
    };

    const finish = (code, signal) =>
      settle({ code: code ?? (signal ? 1 : 0), stdout, stderr });

    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    // Destroying a pipe above can surface as an 'error' on the stream, and an
    // unheard stream 'error' takes the whole process down — the same shape of
    // bug `openUrl()` below carries a paragraph about.
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});

    child.on("error", (error) => {
      settle({ code: error.code === "ENOENT" ? 127 : 1, stdout, stderr: error.message });
    });
    child.on("exit", (code, signal) => (exited = { code, signal }));
    child.on("close", (code, signal) => finish(code, signal));

    if (boundMs > 0) {
      deadline = setTimeout(() => {
        timedOut = true;
        killTree(child, killSignal, grouped);
        drain = setTimeout(() => {
          // Whatever is still holding the pipes has now had its chance — and on a
          // child that ignores the first signal this is the only one that lands.
          if (grouped) killTree(child, "SIGKILL", true);
          finish(exited?.code ?? null, exited?.signal ?? killSignal);
        }, DRAIN_MS);
      }, boundMs);
    }
  });
}

/** Is this command on the PATH? Asks it for its version rather than guessing. */
export async function hasCommand(command, versionArgs = ["--version"]) {
  const { code } = await capture(command, versionArgs);
  return code === 0;
}

/**
 * Can a browser be opened on THIS machine at all?
 *
 * Not the same question as "is a browser installed". What it really asks is
 * whether the person reading this is sitting at the screen a window would
 * appear on — and a cloud session, a container and a server over SSH all answer
 * no. Three things in this project are written as if the answer were always
 * yes: the Digistore24 approval click, the hosting CLI logins, and every
 * sentence that says "open http://localhost:3000". Where it is no, the printed
 * link is the whole path, and the person has to be told so.
 *
 * Cheap on purpose — a PATH lookup and two environment variables, no process —
 * because the greeting asks it on every session start.
 *
 * Deliberately generous on macOS and Windows: both ship the opener with the
 * system and a desktop session is the overwhelmingly common case. Being wrong
 * there costs nothing, because `openUrl()` below still reports what actually
 * happened.
 */
export function canOpenBrowser() {
  if (isWindows || process.platform === "darwin") return true;
  const display = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
  return Boolean(display && whichCommand("xdg-open"));
}

/**
 * Open a URL in whatever browser this machine calls its own, and say whether it
 * worked. Best effort — the caller has already printed the link, so a failure
 * here is not one. A failure reported as success is.
 *
 * On Windows this is the single command in the project that genuinely cannot
 * avoid a shell: `start` is not a program, it is a word cmd.exe understands.
 * Which is precisely why it lives here and not at the call site — and why the
 * URL goes through `cmdQuote()` on the way (see `CMD_SYNTAX`).
 *
 * This used to return `true` unconditionally, and that is the failure the shape
 * below exists to prevent. A missing `xdg-open` does NOT throw: spawn reports it
 * asynchronously as an 'error' event, an unheard 'error' event takes the whole
 * process down, so the event was swallowed — and `true` returned anyway. On a
 * machine with no browser the setup then printed "The browser was opened" and
 * waited eight minutes for a click nobody was in a position to make. Node emits
 * 'spawn' once the child really started, so both answers are available: wait for
 * whichever arrives, and for nothing else — not for the browser to be closed.
 */
export function openUrl(url) {
  return new Promise((resolve) => {
    if (!canOpenBrowser()) {
      resolve(false);
      return;
    }
    let child;
    try {
      child = isWindows
        ? // `start ""` — the empty argument is the window title. Leave it out and
          // cmd reads the quoted URL as the title and opens nothing at all.
          runOneLine(cmdLine("start", ["", url]), { stdio: "ignore", detached: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
            stdio: "ignore",
            detached: true,
          });
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

/** Sleep, for the wait loops. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
