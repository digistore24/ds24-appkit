// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What this machine needs, what it has, and what to do about the difference.
//
// The install commands themselves live next door in `fixes.json`. This file is
// what reads them, and everything else reads this file:
//
//   node run.mjs doctor          the text a person reads
//   node run.mjs doctor --json   the same facts for the agent (skill setup-machine)
//   scripts/dev/session-start     the cheap subset, on every session
//
// Why data and not prose: the skill that walks somebody through the setup must
// not carry install commands of its own. Three copies of the same table — one
// per system — drift, and the copy that drifts is always the one for the system
// nobody here runs. So the skill reads `fix[platform]` and says what it finds;
// `scripts/setup.test.ts` holds it to that.
//
// Why a separate JSON and not a literal down here: a machine with no Node
// cannot run this file at all, and that is precisely the machine somebody needs
// the `node` entry on. `fixes.json` can be READ instead of executed, which is
// what `setup-machine` does in its step 0 — so the table stays single even in
// the one situation where nothing can run.
//
// A check is one object:
//
//   { id, label, severity, ok, detail, fix }
//
//   severity  "blocker"  nothing works without it
//             "optional" nice to have (Docker, cloudflared) — Docker counts as
//                        optional because a machine without it runs the
//                        database from an npm package instead, by itself
//                        (scripts/db/driver.mjs)
//             "info"     worth knowing, never a reason to stop
//   fix       per platform: { command?, url?, admin?, gui?, restart?, note? }
//             admin   needs sudo/Administrator — the agent cannot answer that prompt
//             gui     an installer with a window — a person has to click
//             restart the machine has to be restarted afterwards
//
// Those three flags are the whole point of the shape: they are what decides
// whether the agent may run the command itself or has to hand it over, and that
// decision is a fact about the command, not a judgement to be re-made in prose.
import { existsSync, readFileSync } from "node:fs";
import { classifyStatuses, readApprovalCache } from "../ds24/_approval.mjs";
import {
  appHost,
  isUnjudgeableHost,
  resolvedFrom,
  senderDomainProblem,
} from "../../lib/email-from.mjs";
import { readEnvValue } from "../lib/env-write.mjs";
import { canOpenBrowser, capture, hasCommand, isWindows } from "../lib/proc.mjs";
import { configuredDriver, dbDriver } from "../db/driver.mjs";
import { depsFresh } from "./deps.mjs";
import { portInUse, urlPort } from "./ports.mjs";
import { writeStamp } from "./setup-stamp.mjs";

export const PLATFORMS = ["linux", "darwin", "win32"];

const MIN_NODE = 20;
const DEFAULT_DB_PORT = 15432; // as in docker-compose.yml

/** The same instruction on all three systems — used for project state, not tools. */
const everywhere = (fix) => Object.fromEntries(PLATFORMS.map((p) => [p, fix]));

/** `node run.mjs setup` fixes everything that is about this project, not the machine. */
const RUN_SETUP = everywhere({ command: "node run.mjs setup" });

// ── how a missing tool is installed ─────────────────────────────────────────
// From `fixes.json` — see the header, and that file's own `_comment` for the
// shape. The `linux` and `darwin` entries are the conservative fallback;
// `inspect()` upgrades them to a concrete command once it knows which package
// manager is present (apt/dnf/pacman there, Homebrew here).

const TABLE = JSON.parse(readFileSync(new URL("fixes.json", import.meta.url), "utf8"));

export const FIXES = TABLE.fixes;

/** The better macOS command where Homebrew is already there. Not a platform. */
const BREW_FIXES = TABLE.brew;

// The hosts this template is documented for (docs/DEPLOY.md), and how you ask
// their CLI two questions: is it there, and does it know who I am.
//
// Render is deliberately in the list with no CLI at all. Its deploy runs from
// the connected GitHub repo and its settings live in the dashboard, so there is
// nothing to install and nothing to log into — and saying that here is worth
// more than leaving whoever picked Render wondering what they failed to find.
export const DEPLOY_HOSTS = {
  railway: {
    host: "Railway",
    command: "railway",
    version: ["--version"],
    // `railway whoami` answers from the stored token; it does not need a linked
    // project, so it is the honest test of "am I authenticated".
    auth: ["whoami"],
    login: { command: "railway login", note: "opens the browser; RAILWAY_TOKEN instead, on a machine without one" },
  },
  flyctl: {
    host: "Fly.io",
    command: "flyctl",
    version: ["version"],
    auth: ["auth", "whoami"],
    login: { command: "flyctl auth login", note: "opens the browser; FLY_API_TOKEN instead, on a machine without one" },
  },
  doctl: {
    host: "DigitalOcean",
    command: "doctl",
    version: ["version"],
    auth: ["account", "get"],
    login: { command: "doctl auth init", note: "asks for a Personal Access Token from the DigitalOcean API page" },
  },
};

/** Which package manager this Linux has — so the fix can be a command, not a link. */
const LINUX_PACKAGES = [
  { manager: "apt-get", install: (pkgs) => `sudo apt-get install -y ${pkgs.apt}` },
  { manager: "dnf", install: (pkgs) => `sudo dnf install -y ${pkgs.dnf}` },
  { manager: "pacman", install: (pkgs) => `sudo pacman -S --noconfirm ${pkgs.pacman}` },
];

const LINUX_PACKAGE_NAMES = {
  git: { apt: "git", dnf: "git", pacman: "git" },
  docker: { apt: "docker.io docker-compose-v2", dnf: "docker docker-compose", pacman: "docker docker-compose" },
};

/**
 * A concrete Linux command for `id`, if we can name one.
 * Node is deliberately absent: the distribution packages are regularly older
 * than 20, and installing one would replace the problem with a quieter one.
 */
async function linuxFix(id) {
  const names = LINUX_PACKAGE_NAMES[id];
  if (!names) return null;
  for (const pm of LINUX_PACKAGES) {
    if (!(await hasCommand(pm.manager, ["--version"]))) continue;
    const note =
      id === "docker"
        ? "afterwards: sudo usermod -aG docker $USER — then log out and back in once"
        : undefined;
    return { command: pm.install(names), admin: true, note };
  }
  return null;
}

/**
 * A better macOS command for `id`, if this Mac already has Homebrew.
 *
 * The same move as `linuxFix` one platform over, and the direction matters:
 * `fixes.json` holds the Homebrew-FREE way and this upgrades it, never the
 * reverse. A table full of `brew install …` reads as correct on the Mac of
 * whoever wrote it and hands `brew: command not found` to everybody else —
 * which on macOS is most people, because nothing installs Homebrew for them.
 *
 * So Homebrew is used where it is and worked around where it is not, exactly
 * as Docker is (see `scripts/db/driver.mjs`). What is never done is talking
 * somebody into installing it first: it wants sudo, it takes a while, and on
 * Apple Silicon it finishes by printing a PATH line the user has to run
 * themselves — three chances to lose somebody before their first `node`.
 */
let brewThere = null; // asked once — four checks want the answer, it cannot change mid-run
async function darwinFix(id) {
  if (!Object.hasOwn(BREW_FIXES, id)) return null;
  brewThere ??= hasCommand("brew");
  return (await brewThere) ? BREW_FIXES[id] : null;
}

// ── the checks ──────────────────────────────────────────────────────────────

/**
 * Look at this machine.
 *
 * `quick` leaves out everything that starts another program — that is the
 * variant the SessionStart hook runs, where a `docker info` taking two seconds
 * would be two seconds in front of every single session.
 */
export async function inspect({ quick = false } = {}) {
  const checks = [];
  // `detail` is written as the reason something is missing, so it is dropped
  // once the thing is there — a passing check that still carries "AUTH_SECRET is
  // empty" reads as a finding to whoever parses the JSON.
  const add = (check) =>
    checks.push({ severity: "blocker", ...check, detail: check.ok ? "" : (check.detail ?? "") });

  // ── Node itself ───────────────────────────────────────────────────────────
  // This can only ever report "too old", never "missing": a missing Node could
  // not have run this file. Worth knowing when reading the output — and the
  // reason the skill `setup-machine` opens by reading `fixes.json` directly
  // rather than by asking here.
  const major = Number(process.versions.node.split(".")[0]);
  add({
    id: "node",
    label: `Node.js ${process.version}`,
    ok: major >= MIN_NODE,
    detail: major >= MIN_NODE ? "" : `needs ${MIN_NODE} or newer`,
    // Static on the quick path: `withPlatformFix` probes for a package manager,
    // and the variant the SessionStart hook runs starts no processes. Nothing
    // reads the fix there anyway — the hook prints ids.
    fix: quick ? FIXES.node : await withPlatformFix("node"),
  });

  // ── the project's own state ───────────────────────────────────────────────
  // Cheap (three file lookups and a TCP connect), so the hook runs them too.
  const hasEnv = existsSync(".env");
  add({
    id: "env",
    label: ".env",
    ok: hasEnv && Boolean(readEnvValue(".env", "AUTH_SECRET")),
    detail: hasEnv ? "AUTH_SECRET is empty" : "missing — is created from .env.example",
    fix: RUN_SETUP,
  });

  add({
    id: "deps",
    label: "Dependencies (node_modules)",
    ok: depsFresh(),
    detail: existsSync("node_modules") ? "older than package-lock.json" : "not installed yet",
    fix: RUN_SETUP,
  });

  // A written-down driver is read here because it costs nothing — no process is
  // started, so this is safe on the quick path. Which driver is actually in
  // force may need a look at Docker, and that happens below the quick return.
  // An unusable value is a finding of its own rather than an exception that
  // ends the report — doctor is the command somebody runs when things are broken.
  let driverError = "";
  try {
    configuredDriver();
  } catch (error) {
    driverError = error.message;
  }
  if (driverError) {
    add({
      id: "db-driver",
      label: "DB_DRIVER in .env",
      ok: false,
      detail: driverError.split("\n")[0].replace(/^✗ /, "").replace(/\.$/, ""),
      fix: everywhere({ note: "set DB_DRIVER=docker or DB_DRIVER=local in .env — or delete the line" }),
    });
  }

  const dbUrl = process.env.DATABASE_URL || (hasEnv ? readEnvValue(".env", "DATABASE_URL") : "");
  const dbPort =
    Number(urlPort(dbUrl, 0)) ||
    Number(process.env.DB_PORT || (hasEnv ? readEnvValue(".env", "DB_PORT") : "")) ||
    DEFAULT_DB_PORT;
  add({
    id: "database",
    label: `Database (port ${dbPort})`,
    ok: await portInUse(dbPort),
    detail: "does not answer — it is started along with the app",
    fix: RUN_SETUP,
    severity: "info",
  });

  if (quick) return checks;

  // ── the Digistore24 product approval ──────────────────────────────────────
  //
  // Answered from the cache the session greeting maintains
  // (scripts/ds24/_approval.mjs) — never live: the greeting owns the quick
  // path and the daily listProducts call, and two surfaces disagreeing about
  // freshness would be worse than one of them being a day old. No cache means
  // no synced products, or the check is switched off, or nobody has looked in
  // a month — `readApprovalCache` answers null for all of them, and then there
  // is nothing to report. An app without Digistore24 products is a normal
  // state, not a finding.
  //
  // **Every state that is not "approved" has to appear here.** The first
  // version listed only rejected and unrequested, so an app whose every
  // product sat at `pending` — unable to sell anything — got a green tick from
  // the command people run right before going live, while the greeting two
  // lines up said the opposite.
  const approvalCache = readApprovalCache();
  const approvalGroups = classifyStatuses(approvalCache?.statuses);
  // `notApplicable` is left out of the count on purpose: a Direct Seller has no
  // approval step, so the check has nothing to report — not even a green tick,
  // which would imply a hurdle was cleared that never existed.
  const approvalCount = Object.entries(approvalGroups)
    .filter(([bucket]) => bucket !== "notApplicable")
    .reduce((n, [, keys]) => n + keys.length, 0);
  if (approvalCount > 0) {
    const parts = [];
    if (approvalGroups.rejected.length > 0) parts.push(`rejected: ${approvalGroups.rejected.join(", ")}`);
    if (approvalGroups.unrequested.length > 0)
      parts.push(`not requested yet: ${approvalGroups.unrequested.join(", ")}`);
    if (approvalGroups.pending.length > 0)
      parts.push(`waiting for Digistore24: ${approvalGroups.pending.join(", ")}`);
    if (approvalGroups.unknown.length > 0)
      parts.push(`status could not be read: ${approvalGroups.unknown.join(", ")}`);
    // Answered from a file, so say how old it is. Without the date this reads
    // as "measured just now", and the one thing a cached verdict must never do
    // is look live.
    const days = Math.floor((Date.now() - Number(approvalCache.checkedAt)) / 86_400_000);
    const asOf = days < 1 ? "checked today" : `as of ${days} day(s) ago`;
    add({
      id: "ds24-approval",
      label: "Digistore24 product approval",
      ok: parts.length === 0,
      detail: `${parts.join("; ")} (${asOf}) — only test purchases work until a product is approved`,
      severity: "info",
      // The fix has to match the state, because `fix[platform]` is consumed as
      // data by the setup tooling — a command that refuses for the state it was
      // offered for is a loop the tooling walks.
      //
      //   rejected  → the reason is in the vendor's account; resubmitting it
      //               unchanged gets it rejected again, more slowly
      //   unknown   → `--apply` refuses precisely this state, so pointing at it
      //               would send the tooling round in a circle
      fix: everywhere(
        approvalGroups.unknown.length > 0 && parts.length === 1
          ? {
              command: "node run.mjs ds24-approval",
              note: "the status could not be read — check that the product still exists at Digistore24 and that DIGISTORE_API_KEY belongs to that account. `--apply` deliberately refuses this state",
            }
          : approvalGroups.rejected.length > 0
            ? {
                command: "node run.mjs ds24-approval --apply",
                note: "for a REJECTED product read the reason in your Digistore24 account and fix it there FIRST — resubmitting it unchanged gets rejected again",
              }
            : { command: "node run.mjs ds24-approval --apply" },
      ),
    });
  }

  // ── how this checkout sits on disk ────────────────────────────────────────
  //
  // A working tree with CRLF endings. `.gitattributes` keeps new clones out of
  // this, but a copy made before it existed — or one whose git was told
  // otherwise — still has it, and then `node run.mjs update` silently does
  // nothing: the hashes in `.template-version` are taken over LF content, so
  // every guidance file looks "edited in this app" and is left alone. Nothing
  // else reports that, which is the only reason this check is here.
  //
  // CLAUDE.md stands in for the tree: it is always present and always ours.
  if (existsSync("CLAUDE.md") && readFileSync("CLAUDE.md", "utf8").includes("\r\n")) {
    add({
      id: "line-endings",
      label: "Line endings in the working tree",
      ok: false,
      detail: "CRLF — `node run.mjs update` will report every file as edited and write nothing",
      severity: "info",
      fix: everywhere({
        command: "git config core.autocrlf false && git rm --cached -r . && git reset --hard",
        note: "checks the files out again with LF; commit or stash your own changes first",
      }),
    });
  }

  // ── the tools ─────────────────────────────────────────────────────────────
  add({ id: "npm", label: "npm", ok: await hasCommand("npm"), detail: "comes with Node.js", fix: await withPlatformFix("node") });
  add({ id: "git", label: "git", ok: await hasCommand("git"), fix: await withPlatformFix("git") });

  // Which database this machine ends up running — and, on the first run, the
  // moment that gets decided and written into .env (scripts/db/driver.mjs).
  const driver = await dbDriver();

  // **Docker is never a blocker.** It is used where it exists and replaced
  // where it does not, so a missing Docker is a fact about the machine, not
  // something standing in the way. Reporting it as a blocker would send people
  // off to install Docker Desktop, WSL2 and a restart for a database that is
  // already running without any of it.
  const dockerThere = await hasCommand("docker");
  if (!dockerThere) {
    add({
      id: "docker",
      label: "Docker",
      ok: false,
      detail: "not installed — the database runs without it",
      severity: "optional",
      fix: await withPlatformFix("docker"),
    });
  } else {
    // Installed is not the same as running — ask the daemon, don't assume.
    const info = await capture("docker", ["info", "--format", "{{.ServerVersion}}"]);
    add({
      id: "docker",
      label: "Docker",
      ok: info.code === 0,
      detail:
        driver === "docker"
          ? "installed, but not running — start Docker Desktop"
          : "installed, but not running — the database runs without it",
      severity: "optional",
      fix: await withPlatformFix("docker"),
    });
    if (info.code === 0) {
      const compose = await capture("docker", ["compose", "version"]);
      add({
        id: "docker-compose",
        label: "Docker Compose v2",
        ok: compose.code === 0,
        detail: "update Docker",
        severity: driver === "docker" ? "blocker" : "optional",
        fix: await withPlatformFix("docker"),
      });
    }
  }

  // Say which one is in force. Without this line the choice is invisible until
  // somebody wonders why their data is not where they expected it.
  add({
    id: "db-driver-in-use",
    label:
      driver === "docker"
        ? "Database: Postgres in Docker"
        : "Database: Postgres without Docker (DB_DRIVER=local)",
    ok: true,
    severity: "info",
  });

  // Only needed to receive Digistore24 IPNs on this machine.
  add({
    id: "cloudflared",
    label: "cloudflared (only for local IPNs)",
    ok: await hasCommand("cloudflared"),
    severity: "optional",
    fix: await withPlatformFix("cloudflared"),
  });

  // On Windows the commands belong in Git Bash or WSL2. Git Bash sets MSYSTEM,
  // WSL sets WSL_DISTRO_NAME — neither means PowerShell or cmd, and there the
  // start scripts behave differently enough to be worth saying so.
  add({
    id: "shell",
    label: "Shell",
    ok: !isWindows || Boolean(process.env.MSYSTEM || process.env.WSL_DISTRO_NAME),
    detail: "this looks like PowerShell or cmd — use Git Bash or WSL2",
    severity: "info",
    fix: FIXES.shell,
  });

  // Not a question about software, and never a reason to stop: it asks whether
  // the person reading this is at the screen a browser window would appear on.
  // A cloud session, a container, a machine over SSH all answer no — and three
  // things here are written as if the answer were always yes: the Digistore24
  // approval click, the hosting CLI logins, and every sentence that says "open
  // http://localhost:3000". Nothing to install, so no `FIXES` entry: an entry
  // there would have to name an install command on all three systems
  // (scripts/setup.test.ts), and there is none to name.
  add({
    id: "browser",
    label: "Browser on this machine",
    ok: canOpenBrowser(),
    detail: "no browser can open here — the user has to be given links to click",
    severity: "info",
    fix: everywhere({
      note:
        "Nothing to install — it means the person is somewhere else. Print links " +
        "instead of opening them, and read docs/machine.md before promising a localhost address.",
    }),
  });

  return checks;
}

/**
 * The hosting CLIs — `node run.mjs doctor --deploy`.
 *
 * Deliberately NOT part of `inspect()`. Nobody needs any of this to build the
 * app, and a doctor that reports three missing CLIs to every user on their
 * first day is a doctor people learn to skim. It is asked for by the one skill
 * that needs it (`setup-hosting`), for the one host the user picked.
 *
 * Every entry answers TWO questions, because they have different fixes and
 * conflating them is how somebody ends up reinstalling a CLI that was there all
 * along: is it installed, and does it know who I am. An installed CLI that is
 * not logged in is the normal state after an install, not a fault.
 *
 * The auth call talks to the network, so it gets a timeout. A hosting API that
 * is having a bad morning must not hang the setup — an unanswered question is
 * reported as unanswered.
 */
export async function deployChecks(only = null) {
  const wanted = only ? [only] : Object.keys(DEPLOY_HOSTS);
  // The sender-domain rule first — it is the one check here about the APP, not
  // about a CLI, and the one whose failure is invisible until the deployed app
  // refuses to start (or worse, sends phishing-shaped mail until Safe Browsing
  // notices). Saying it now means it gets fixed on this machine, before the
  // host ever boots the app.
  const checks = [mailSenderCheck()];

  for (const id of wanted) {
    const cli = DEPLOY_HOSTS[id];
    if (!cli) continue;
    const label = `${cli.host} CLI (${cli.command})`;

    if (!(await hasCommand(cli.command, cli.version))) {
      checks.push({
        id,
        label,
        ok: false,
        severity: "optional",
        detail: "not installed",
        fix: await withPlatformFix(id),
      });
      continue;
    }

    const auth = await capture(cli.command, cli.auth, { timeout: 20000 });
    checks.push({
      id,
      label,
      ok: auth.code === 0,
      okDetail: "logged in",
      severity: "optional",
      detail: "installed, but not logged in",
      // The fix here is NOT the install command: it is there. Handing somebody
      // an install command for a login they have not done yet is the kind of
      // advice that gets followed and then does nothing. The login is the same
      // on all three systems, which is why it is one entry and not a table.
      fix: everywhere(cli.login),
    });
  }

  return checks;
}

/**
 * The sender-domain rule as a deploy-prep check (docs/auth-setup.md): the
 * sign-in mails' From must live on the app's own domain, or STAGING/PROD
 * refuse to start (lib/env-guard.ts — the reasoning lives there). This reads
 * the local .env, so with a local APP_URL it can only announce the rule; the
 * verdict on the real domain falls at boot, and setup-hosting names the rule
 * when it sets the host's variables.
 */
function mailSenderCheck() {
  const read = (key) => readEnvValue(".env", key) ?? undefined;
  const id = "mail-from";
  const from = resolvedFrom({
    POSTMARK_SERVER_TOKEN: read("POSTMARK_SERVER_TOKEN"),
    POSTMARK_SENDER: read("POSTMARK_SENDER"),
    SMTP_FROM: read("SMTP_FROM"),
    EMAIL_FROM: read("EMAIL_FROM"),
  });
  const appUrl = read("APP_URL");
  const host = appHost(appUrl);

  if (isUnjudgeableHost(host)) {
    return {
      id,
      label: "Mail sender domain — not judgeable yet (APP_URL is local); STAGING/PROD enforce it at boot",
      ok: true,
      severity: "info",
    };
  }

  const problem = senderDomainProblem({ from, appUrl, foreignDomainAck: read("EMAIL_FROM_FOREIGN_DOMAIN") });
  if (!problem) {
    return {
      id,
      label: "Mail sender domain",
      ok: true,
      okDetail: `${from} matches ${host}`,
      severity: "info",
    };
  }

  const detail =
    problem.code === "missingFrom"
      ? "a mail transport is configured but no sender address is set — the app would send as \"login@localhost\""
      : problem.code === "badOverride"
        ? `EMAIL_FROM_FOREIGN_DOMAIN must name the foreign domain itself (${problem.fromDomain ?? "<domain>"}), not a yes-flag`
        : `${problem.from} is not on the app's domain (${host}) — the shape of a phishing mail; STAGING/PROD refuse to start on it (docs/auth-setup.md)`;

  return {
    id,
    label: "Mail sender domain",
    ok: false,
    severity: "blocker",
    detail,
    fix: everywhere({
      command: "node run.mjs mail-setup",
      note: `use an address on ${host}`,
    }),
  };
}

/**
 * The static table for `id`, with the entry for whichever system we are on
 * upgraded to a better command if this machine allows one.
 *
 * Both upgrades are computed, not just the one for `process.platform`: the JSON
 * is handed to the agent whole, and a check whose macOS entry depended on
 * having *run* on a Mac would be a table that reads differently depending on
 * who asked. Each probe is a `--version` call that fails fast when the tool is
 * absent, and on the machine's own platform it is the one being asked for.
 */
async function withPlatformFix(id) {
  const [linux, darwin] = await Promise.all([linuxFix(id), darwinFix(id)]);
  if (!linux && !darwin) return FIXES[id];
  return { ...FIXES[id], ...(linux && { linux }), ...(darwin && { darwin }) };
}

// ── output ──────────────────────────────────────────────────────────────────

/** The fix for the system we are on. */
export const fixFor = (check, platform = process.platform) =>
  check.fix?.[platform] ?? check.fix?.linux ?? null;

/** A one-line instruction out of a fix — the command, or the link, or the note. */
export function fixLine(fix) {
  if (!fix) return "";
  const parts = [fix.command || fix.url].filter(Boolean);
  if (fix.note) parts.push(`(${fix.note})`);
  return parts.join(" ");
}

/** Everything that genuinely stands in the way. */
export const blockers = (checks) => checks.filter((c) => !c.ok && c.severity === "blocker");

/** The text a person reads. */
export function render(checks) {
  const lines = [`This machine: ${process.platform} ${process.arch}, Node ${process.version}`, ""];
  for (const check of checks) {
    // The install hint is only interesting when the thing is missing.
    if (check.ok) {
      lines.push(`  ✓ ${check.label}`);
      continue;
    }
    const mark = check.severity === "blocker" ? "✗" : "·";
    const hint = [check.detail, fixLine(fixFor(check))].filter(Boolean).join(" — ");
    lines.push(`  ${mark} ${check.label}${hint ? ` — ${hint}` : ""}`);
  }

  const missing = blockers(checks);
  lines.push("");
  if (missing.length === 0) {
    lines.push("✓ Everything that is needed is there. Next: node run.mjs start");
  } else {
    lines.push(`✗ ${missing.length} thing(s) missing — install them, then run doctor again.`);
  }
  return lines.join("\n");
}

/** `node run.mjs doctor` — and `--json` for whoever reads it as data. */
export async function doctor(args = []) {
  // `--deploy` asks a different question ("can I put this online from here?")
  // and answers only that one. It never blocks: not having a hosting CLI is the
  // normal state of every machine that has not deployed yet, so the exit code
  // stays 0 and nobody's `doctor` starts failing because of it.
  if (args.includes("--deploy")) {
    const only = DEPLOY_HOSTS[args[args.indexOf("--deploy") + 1]] ? args[args.indexOf("--deploy") + 1] : null;
    const checks = await deployChecks(only);
    if (args.includes("--json")) {
      console.log(JSON.stringify({ platform: process.platform, checks: checks.map((c) => ({ ...c, fix: fixFor(c) })) }, null, 2));
      return;
    }
    console.log(["Hosting from this machine:", ""].join("\n"));
    for (const check of checks) {
      const hint = [check.detail, fixLine(fixFor(check))].filter(Boolean).join(" — ");
      // "logged in" belongs to the CLI checks; app-state checks (mail-from)
      // carry their own okDetail or none. A failing blocker is ✗, a missing
      // optional CLI stays ·.
      const mark = check.severity === "blocker" ? "✗" : "·";
      console.log(
        check.ok
          ? `  ✓ ${check.label}${check.okDetail ? ` — ${check.okDetail}` : ""}`
          : `  ${mark} ${check.label} — ${hint}`,
      );
    }
    console.log("\nRender needs no CLI — it deploys from the connected GitHub repo.");
    console.log("What to book, and what each one costs: docs/DEPLOY.md");
    return;
  }

  const checks = await inspect();

  // Nothing blocking → note it down. This is the FULL run, the one that asked
  // the Docker daemon, so it is worth remembering: the greeting can then say
  // when the machine was last checked, and the skill `build-app` can make its
  // precondition a lookup instead of another second of waiting.
  //
  // Only the good case is recorded. A blocked machine writes nothing — a stamp
  // saying "checked, and broken" would be a stamp somebody has to interpret,
  // and the whole value of this file is that its presence means one thing.
  if (blockers(checks).length === 0) writeStamp();

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          ok: blockers(checks).length === 0,
          checks: checks.map((check) => ({ ...check, fix: fixFor(check) })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(render(checks));
  }
  if (blockers(checks).length > 0) process.exit(1);
}
