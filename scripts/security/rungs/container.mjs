// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 10, tier 2 — this repository's own container and infrastructure files,
// read by a scanner that is already on the machine.
//
// ── 🚨 Why this scans configuration and NOT vulnerabilities ────────────────
//
// `check.mjs:19-25` is explicit that the aggregator knows no rung and **no rung
// reads another's result**. That is what keeps the ladder addable-to, and it has
// one consequence this file has to respect: **there is nowhere to de-duplicate
// across rungs.**
//
// `aggregate()` counts findings. A third vulnerability database here would have
// one CVE counted by `npm audit`, by OSV and by Trivy — three ❌ HIGH findings for
// one problem, in a project whose own troubleshooting guide carries a post-mortem
// called *"The advisory that was reported nine times"*
// (`docs/troubleshooting.md:246`). The same argument rules out a second secret
// ruleset over the working tree: that is `rungs/secrets.mjs`'s claim, already
// counted. If a later story wants a third advisory database, the honest place is
// INSIDE the advisory rung, where `source` already exists for it
// (`../rules.mjs:110-124`) — not as an eleventh rung.
//
// What is left is the thing nothing else on this ladder looks at: the
// repository's **own** configuration — the shipped `docker-compose.yml`, any
// `Dockerfile` an operator added, any infrastructure file that came with their
// host's tooling. Small on a fresh app, real on a grown-up one, and **disjoint by
// construction** from every other rung, which is what makes it safe to add to a
// tally nobody can de-duplicate.
//
// ── 🚨 It never pulls the image ───────────────────────────────────────────
//
// `docker images … aquasec/trivy` asks whether it is already here. If it is not,
// this rung says so and names `docker pull` as a line for a PERSON to run. The
// reasoning is in `../tier2.mjs`; `../rungs.test.ts` enforces it on this file's
// source.
//
// ── 🚨 "Docker does not answer" and "the image is not here" are two sentences ─
//
// `dockerUsable()` (`scripts/db/driver.mjs:60-71`) is reused rather than
// re-implemented — the daemon, not the PATH, and never a second opinion about
// what "Docker is here" means in this app. Note that importing it pulls
// `scripts/db/local.mjs` into this file's import graph: both are dependency-free
// plain Node (its one npm resolution is lazy, inside a function), so nothing
// installs, nothing starts, and `security-check` stays importable on a tree with
// no `node_modules` at all.
//
// ── Offline and read-only, structurally ───────────────────────────────────
//
//   docker run --rm --network none -v <root>:/repo:ro <image> \
//     fs --scanners misconfig --skip-check-update --format json --quiet /repo
//
// `--network none` is what makes "no account, no key, no hosted service" a
// property of the run rather than a promise, and `--skip-check-update` is what
// lets it hold — Trivy would otherwise try to refresh its checks bundle and fail
// on a network that is not there. `:ro` means the scanner cannot write into the
// tree it is reading.
//
// ── "Clean" and "could not look" are not the same answer ──────────────────
//
// Trivy exits non-zero on `--exit-code` and on failure, the same ambiguity
// `rungs/advisories.mjs` writes out for `npm audit`. The discriminator is
// structural: **stdout parses as JSON carrying `SchemaVersion`**. Anything else
// is a skip with the first non-empty line of stderr.
//
// And a run that found no configuration files at all says so in its evidence
// (`0 configuration file(s) in scope`) — the reader must not be able to read
// "the hardening pass happened" out of an empty answer.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. `docker` is a
// real executable on all three and is started through `capture()` with an args
// array, so **no shell is involved** — which is also why Git Bash's MSYS path
// translation, the thing that would rewrite the container-side `/repo` into a
// Windows path, cannot occur here. The host side of the mount is `resolve(root)`,
// so Windows passes `C:\Users\…\app:/repo:ro`, which is what Docker Desktop
// expects.
import { resolve } from "node:path";

import { dockerUsable } from "../../db/driver.mjs";
import { capture } from "../../lib/proc.mjs";
import {
  SCANNER_IMAGE_REPO,
  dockerMissing,
  firstLine,
  imageMissing,
  unanswered,
} from "../tier2.mjs";

const SOURCE = "Trivy";

/** The wall clock this rung is bounded by. A first run on a big tree is not fast. */
export const TIMEOUT_MS = 90_000;

/**
 * Which tag of the scanner is on this machine — whichever one is, not a pinned one.
 *
 * A pinned tag nobody has is a rung that always skips, and the only way to
 * un-skip it would be the pull this ladder forbids. An image whose tag is
 * `<none>` is a dangling layer and cannot be run by name.
 *
 * @param {string} stdout
 * @returns {string|null}
 */
export function firstImage(stdout) {
  return (
    String(stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.endsWith(":<none>")) ?? null
  );
}

/**
 * The argv of the scan — one place, so the test can read it and the rung can run it.
 *
 * @param {string} image
 * @param {string} root  already resolved
 * @returns {string[]}
 */
export function scanArgs(image, root) {
  return [
    "run",
    "--rm",
    // No network at all. The claim "no account, no API key, no hosted service"
    // is made structural here rather than asserted in prose.
    "--network",
    "none",
    "-v",
    `${root}:/repo:ro`,
    image,
    "fs",
    // 🚨 misconfig ONLY — see this file's header. Not `vuln`, not `secret`.
    "--scanners",
    "misconfig",
    "--skip-check-update",
    "--format",
    "json",
    "--quiet",
    "/repo",
  ];
}

/**
 * Trivy's answer, or null.
 *
 * 🚨 The discriminator, and it is the top-level SHAPE rather than the exit code:
 * `SchemaVersion` is the key Trivy's own report always carries, and `Results` is
 * absent entirely when it found nothing — so "parses as JSON" alone would accept
 * any old `{}` a wrapper printed.
 *
 * @param {string} stdout
 * @returns {{SchemaVersion: number, Results?: object[]}|null}
 */
export function readReport(stdout) {
  try {
    const parsed = JSON.parse(String(stdout ?? ""));
    if (!parsed || typeof parsed !== "object" || !("SchemaVersion" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The results that are about configuration files. What else is in there is not ours. */
export function configResults(report) {
  return (report?.Results ?? []).filter((result) => result?.Class === "config");
}

/**
 * One Trivy misconfiguration as one `Finding`.
 *
 * Trivy's own severities are the vendor's word about a check, and they are mapped
 * onto this ladder rather than passed through: CRITICAL and HIGH are ❌ HIGH,
 * everything else is ⚠️ MEDIUM. Nothing here is ever 🚨 CRITICAL — a
 * configuration finding is about a file in this repository, not about a live
 * hole somebody is standing in front of.
 *
 * @param {Record<string, any>} misconfig
 * @param {string} target
 * @returns {import("../rules.mjs").Finding}
 */
export function findingFrom(misconfig, target) {
  const severity = String(misconfig?.Severity ?? "").toUpperCase();
  const line = Number(misconfig?.CauseMetadata?.StartLine ?? 0) || 0;
  const id = String(misconfig?.AVDID || misconfig?.ID || "unknown-check");
  const title = String(misconfig?.Title ?? id);

  return {
    severity: severity === "CRITICAL" || severity === "HIGH" ? "high" : "medium",
    title,
    // `/repo` is where the mount lands INSIDE the container; the operator's copy
    // of the same file is at the path they already have open.
    where: `${String(target ?? "").replace(/^\/repo\/?/, "")}${line > 0 ? `:${line}` : ""}`,
    why:
      String(misconfig?.Description ?? "").trim() ||
      "A configuration file in this repository sets something the scanner rates as weak.",
    fix:
      String(misconfig?.Resolution ?? "").trim() ||
      `Read the check at ${id} and decide: change the file, or leave it and write down why.`,
    evidence:
      `Trivy check ${id} ("${title}") rated ${severity || "unrated"} against ${target}. ` +
      "The scan ran with --network none, so nothing about this app left the machine.",
    source: SOURCE,
    id,
  };
}

/** @type {import("../rules.mjs").Rung} */
export const container = {
  id: "container-scan",
  label: "This repository's container and infrastructure files (Trivy)",
  // Tier 2: Docker may not answer and the image may not be here — two different
  // facts, two different sentences, and neither of them is a failure.
  tier: 2,
  covers:
    "the repository's own container and infrastructure files, checked by a scanner nothing else here runs",

  async run({ root } = {}) {
    // `resolve()` so the host side of the mount is absolute on all three systems.
    const cwd = resolve(root ?? process.cwd());

    // 🚨 The daemon, not the PATH — and the app's own test for it, not a second one.
    if (!(await dockerUsable())) return dockerMissing();

    // The repository name is a FILTER here, not a pull: `docker images` never
    // reaches a registry. An absent image is an empty stdout and exit 0.
    const listed = await capture("docker", [
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
      SCANNER_IMAGE_REPO,
    ]);
    if (Number(listed.code) !== 0) {
      return unanswered(
        `docker could not list images: ${firstLine(listed.stderr) || "no reason given"}`,
      );
    }
    const image = firstImage(listed.stdout);
    if (!image) return imageMissing(SCANNER_IMAGE_REPO);

    const args = scanArgs(image, cwd);
    // ⚠️ One attempt, so 90 s IS the rung's wall clock. Two things about that
    // bound are worth writing down. It used to depend on the tool: `capture()`
    // resolved on the child's 'close', so anything that left a grandchild
    // holding the pipes ran past the limit — the `docker` CLI is one binary and
    // starts nothing, which is the only reason this rung was safe. `capture()`
    // settles the bound itself now, so that is no longer load-bearing. And a scan stopped
    // this way leaves the CONTAINER running for a moment: it is `--rm`, so the
    // daemon clears it up, and it holds nothing but a read-only mount and no
    // network.
    const result = await capture("docker", args, { timeout: TIMEOUT_MS });
    const report = readReport(result.stdout);
    if (!report) {
      const said = firstLine(result.stderr);
      return unanswered(
        said
          ? `${image} wrote no report Trivy would recognise: ${said}`
          : `${image} wrote no report Trivy would recognise (exit ${result.code})`,
      );
    }

    const results = configResults(report);
    const findings = results.flatMap((entry) =>
      (entry?.Misconfigurations ?? []).map((misconfig) => findingFrom(misconfig, entry?.Target)),
    );

    return {
      state: findings.length > 0 ? "found" : "clean",
      findings,
      evidence:
        `${image} fs --scanners misconfig --skip-check-update, offline (--network none) ` +
        `over a read-only mount — ${results.length} configuration file(s) in scope.`,
    };
  },
};
