// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The rungs above tier 1 — the tool table, and the sentence an absent tool says.
//
// Rungs one to eight need nothing installed. The two above them need a tool that
// may simply not be here, and **the interesting path is the one where it is
// missing** — that is the normal state of a developer's machine, and it is what
// this file exists to get right.
//
// ── 🚨 A tier-2 rung never downloads its own tool ──────────────────────────
//
// No `docker pull`, no `npx` that installs, no `go install`, no fetch-and-run.
// "Costs nothing to reach" means ALREADY HERE; anything else is a `⏭ NOT ASKED`
// block naming the one-line way to get it, and a person deciding.
//
// Two reasons, and the second is the one that settles it:
//
//  1. A command somebody runs interactively must not turn into a download they
//     did not ask for. `docker pull aquasec/trivy` is several hundred megabytes.
//  2. 🚨 **This is a security check.** `rungs/signatures.mjs` exists to verify
//     that the packages in this tree carry the registry's signature, and
//     `rungs/registry.mjs` to notice one published two days ago. A ladder that
//     fetches and executes a package from that same registry in order to look
//     for supply-chain problems has spent, in its own implementation, exactly
//     the thing it was built to protect. `npx --no-install` is the honest form:
//     it runs what is already in `node_modules/.bin` and refuses otherwise.
//
// So the tool is DISCOVERED, never acquired, and the acquisition line lives
// inside the skip's reason — where a person reads it and decides.
// `rungs.test.ts` enforces this on the source rather than trusting this comment.
//
// ── 🚨 "Docker does not answer" and "the image is not here" are two sentences ─
//
// They are never merged. Measured on the maintainer's machine on 2026-08-10:
// `docker info` answers `29.7.2`, and `docker images` holds `postgres:16`,
// `httpd:2.4` and `minio/minio:latest` — so the container rung skips there
// because the IMAGE is absent, with a daemon that is running perfectly well.
// Telling that operator to "install Docker" would be wrong advice about a
// program they already have, and an operator who reads one wrong sentence stops
// reading the rest.
//
// ── Pure ────────────────────────────────────────────────────────────────────
//
// No `node:fs`, no `node:child_process`, no `process.cwd()` — the same purity
// `rules.mjs` keeps, and for the same reason: `tier2.test.ts` can then hand this
// file a tool id and check the sentence that comes back, inside `npm run test`,
// with no Docker and no gitleaks anywhere near it.
import { MAX_REASON_LENGTH } from "./rules.mjs";

/**
 * The scanner image the container rung looks for — and never pulls.
 *
 * A repository name rather than a pinned tag: whichever tag is on the machine is
 * the one that gets used, because a pinned tag nobody has is a rung that always
 * skips (and the only way to un-skip it would be the pull this file forbids).
 */
export const SCANNER_IMAGE_REPO = "aquasec/trivy";

/**
 * Every tool a tier-2 rung may reach for, with the ONE line that gets it.
 *
 *   missing    what is not here — this app's own sentence about a TOOL, never
 *              about a person and never anything somebody typed. It travels
 *              into `.dev/security-check.json`, which `docs/cron.md` restricts
 *              to exactly that.
 *   howToGet   one line, and it names the three systems where they differ.
 *              🚨 It is a sentence a person reads, never a command this code
 *              runs.
 *
 * @type {Record<string, {id: string, label: string, missing: string, howToGet: string}>}
 */
export const TIER2_TOOLS = {
  gitleaks: {
    id: "gitleaks",
    label: "gitleaks",
    missing: "gitleaks is not on this machine's PATH",
    // Homebrew covers macOS and Linux; the release binary is the answer on
    // Windows (Git Bash) and on a Linux without brew. One line, both halves.
    howToGet: "brew install gitleaks, or the release binary from github.com/gitleaks/gitleaks",
  },

  docker: {
    id: "docker",
    // 🚨 The daemon, not the PATH — `dockerUsable()` in `scripts/db/driver.mjs`
    // is the one place this project decides what "Docker is here" means, and the
    // container rung asks it rather than forming a second opinion. Naming
    // `docker info` here is what tells the operator which test just failed.
    label: "Docker",
    missing: "the Docker daemon did not answer `docker info` (what `node run.mjs start` asks too)",
    howToGet: "start Docker Desktop",
  },

  "trivy-image": {
    id: "trivy-image",
    label: SCANNER_IMAGE_REPO,
    // Deliberately opens with "Docker answered" — the whole point of AC3 is that
    // this reader must not be told to install a program that is running.
    missing: `Docker answered, but the ${SCANNER_IMAGE_REPO} image is not on this machine`,
    howToGet: `get it by hand with docker pull ${SCANNER_IMAGE_REPO}`,
  },
};

/**
 * A reason, collapsed to one line and kept inside the record's own cap.
 *
 * `rules.mjs` shortens a skip's reason on the way into `.dev/security-check.json`
 * (`MAX_REASON_LENGTH`, 120). Doing it HERE as well is not belt and braces: a
 * sentence cut downstream is cut in the middle of whatever word happens to land
 * there, and the half this file cares about — the way to get the tool — is at the
 * END. So the fixed halves are asserted to fit (`tier2.test.ts`), and the only
 * thing that is ever truncated is a tool's own error text pasted in verbatim.
 *
 * The arithmetic is `rules.mjs`'s, spelled out again rather than imported,
 * because that function is private to that file and this story may not edit it.
 *
 * @param {string} text
 * @returns {string}
 */
export function capReason(text) {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  return line.length <= MAX_REASON_LENGTH ? line : `${line.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/**
 * A rung whose tool is not here — `skipped`, with the reason and no findings.
 *
 * The reason is `<what is missing> — <how to get it>`, and `formatSkip()`
 * renders it under `Reason:` beside the rung's own `Blind to:`. The install line
 * goes INSIDE the reason on purpose: the renderer has two fields and no third,
 * and a rung that wanted one would be an aggregator edited by a later rung —
 * which is the thing `rules.mjs` was shaped to make unnecessary.
 *
 * @param {string} toolId  a key of TIER2_TOOLS
 * @param {string} [detail] replaces the tool's own "what is missing" clause
 * @returns {import("./rules.mjs").RungResult}
 */
export function unavailable(toolId, detail = "") {
  const tool = TIER2_TOOLS[toolId];
  if (!tool) {
    // Never a silent fallback: a rung asking for a tool this table does not know
    // would otherwise skip with a blank reason, which `aggregate()` refuses
    // anyway — but it would refuse it by rung id, naming the wrong problem.
    throw new Error(
      `✗ unavailable("${toolId}") — no such tier-2 tool. Known: ${Object.keys(TIER2_TOOLS).join(", ")}`,
    );
  }
  const missing = String(detail ?? "").trim() || tool.missing;
  return {
    state: "skipped",
    reason: capReason(`${missing} — ${tool.howToGet}`),
    findings: [],
  };
}

/** gitleaks is not on the PATH. */
export const gitleaksMissing = () => unavailable("gitleaks");

/** The Docker daemon did not answer. NOT the same fact as the one below. */
export const dockerMissing = () => unavailable("docker");

/** Docker answered and the scanner image is not here. NOT the same fact as above. */
export const imageMissing = (image = SCANNER_IMAGE_REPO) =>
  unavailable(
    "trivy-image",
    image === SCANNER_IMAGE_REPO ? "" : `Docker answered, but the ${image} image is not on this machine`,
  );

/**
 * A tool that IS here and then could not answer — a bound, a crash, a report
 * that never appeared. Not `unavailable()`: the install line would be wrong
 * advice, because the tool is installed.
 *
 * @param {string} reason
 * @returns {import("./rules.mjs").RungResult}
 */
export function unanswered(reason) {
  return { state: "skipped", reason: capReason(reason), findings: [] };
}

/** The ANSI colour runs a tool writes into its own stderr. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The first non-empty line of what a tool said — never the whole wall of it.
 *
 * Colour is stripped as well as trimmed, and both halves were measured. A skip
 * reason travels into `.dev/security-check.json`, and gitleaks colours its own
 * stderr: before this existed, that file carried a raw ANSI escape run where a
 * sentence should have been. The tools are asked not to emit colour as well
 * (`--no-color`, `--quiet`); this is the belt behind those braces.
 *
 * 🚨 The escape character is BUILT with `String.fromCharCode(27)` rather than
 * written into the source. A control byte in a file makes git treat the whole
 * file as binary — no reviewable diff, no textual merge — and
 * `scripts/portability.test.ts` fails the build on exactly that.
 *
 * It lives here rather than in either rung because both need it and no rung may
 * import another: a rung importing a rung is one step from a rung reading
 * another rung's outcome, which is the property the ladder exists to deny
 * (`rungs/advisories.mjs:45-49` argues the same about `../npm-audit.mjs`).
 *
 * @param {string} text
 * @returns {string}
 */
export function firstLine(text) {
  return (
    String(text ?? "")
      .replace(ANSI, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}
