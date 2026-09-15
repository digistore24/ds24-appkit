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
// repository's **own** infrastructure files — the `Dockerfile` that `fly launch`
// writes, a Terraform module, a Helm chart, a Kubernetes or CloudFormation
// manifest that came with an operator's host tooling. Empty on a fresh app, real
// on a grown-up one, and **disjoint by construction** from every other rung,
// which is what makes it safe to add to a tally nobody can de-duplicate.
//
// ── 🚨 The shipped `docker-compose.yml` is NOT one of those files ──────────
//
// Measured 2026-09-15 with `aquasec/trivy:latest fs --scanners misconfig` over
// the template tree: **0 configuration files in scope**. Trivy's misconfig
// scanner reads Dockerfiles, Terraform, Helm, Kubernetes, CloudFormation, Azure
// ARM and Bicep — a Compose file is not on that list. So a fresh app has nothing
// here for the scanner to read, and until that measurement this rung asked for
// Docker AND the image only to find that out, and printed `⏭ NOT ASKED — Blind
// to: the repository's own container and infrastructure files` on every machine
// without them. A tester read that skip as a gap. It was not a gap; it was a rung
// that had not looked in the tree before asking for its tool.
//
// ── So the tree is read FIRST, and Docker is asked only when it matters ────
//
// `scopeFiles()` walks the tree with nothing but `node:fs` and collects the
// files Trivy would read (by name for Dockerfiles, Terraform, Bicep and Helm; by
// a look at the first few kilobytes for the YAML and JSON that is a Kubernetes or
// CloudFormation manifest, because `k8s/deploy.yaml` and `package.json` look the
// same from the outside). Three answers follow:
//
//   nothing in scope     `✓` with an evidence line saying what was looked for and
//                        that Docker was not asked — the answer this rung already
//                        gave WITH Trivy present (`0 configuration file(s) in
//                        scope`), reached without the detour.
//   files, no tool       `⏭ NOT ASKED` as before, but `Blind to:` now names the
//                        files that lie unread, so the skip is exactly as big as
//                        the tree makes it.
//   files, tool          the scan, with the same names in its evidence.
//
// The list has to track Trivy's targets by hand, and a file it misses is a `✓`
// that should have been a `⏭`. That is why the sniff errs towards inclusion (any
// document with `apiVersion` and `kind`, any with `AWSTemplateFormatVersion`)
// and why `container.test.ts` plants one of each and asserts the set.
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
// (`0 configuration file(s) in scope`, or the walk's own sentence when Docker was
// never asked) — the reader must not be able to read "the hardening pass
// happened" out of an empty answer.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. `docker` is a
// real executable on all three and is started through `capture()` with an args
// array, so **no shell is involved** — which is also why Git Bash's MSYS path
// translation, the thing that would rewrite the container-side `/repo` into a
// Windows path, cannot occur here. The host side of the mount is `resolve(root)`,
// so Windows passes `C:\Users\…\app:/repo:ro`, which is what Docker Desktop
// expects.
import { readdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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

// ── The files Trivy's misconfig scanner reads ────────────────────────────────

/** Folders the walk never enters — a dependency's Dockerfile is not this repository's. */
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".next", ".dev"]);

/** How much of a YAML or JSON file is read to tell a manifest from a config. */
const SNIFF_BYTES = 4096;

/** How many names a sentence carries before it says "and N more". */
const NAMED_FILES = 5;

/** The one-line summary of what the walk looks for — the same words in every sentence that names it. */
const LOOKED_FOR =
  "Dockerfile*, *.tf, *.bicep, Helm charts and Kubernetes or CloudFormation manifests";

/**
 * Is this file name one Trivy reads on sight?
 *
 * Dockerfiles in their three spellings, Terraform, Bicep and a Helm chart's
 * `Chart.yaml`. Compose files are deliberately NOT here — see the header.
 *
 * @param {string} name  the base name, no directory
 * @returns {boolean}
 */
export function isScopeName(name) {
  const base = String(name ?? "");
  if (base === "Dockerfile" || base.startsWith("Dockerfile.") || base.endsWith(".Dockerfile")) {
    return true;
  }
  if (base.endsWith(".tf") || base.endsWith(".tf.json") || base.endsWith(".bicep")) return true;
  return base === "Chart.yaml";
}

/** A YAML or JSON file whose content has to be looked at before it can be placed. */
export function needsSniff(name) {
  return /\.(ya?ml|json)$/i.test(String(name ?? ""));
}

/**
 * Does the head of a YAML or JSON document read as a Kubernetes or CloudFormation manifest?
 *
 * Kubernetes: `apiVersion` AND `kind` as top-level keys. CloudFormation:
 * `AWSTemplateFormatVersion`. Both spellings — bare YAML keys and quoted JSON
 * keys — because Trivy reads both. A Compose file has neither
 * (`services:`), and neither does `package.json`.
 *
 * @param {string} head
 * @returns {boolean}
 */
export function sniffsAsManifest(head) {
  const text = String(head ?? "");
  if (/^\s*"?AWSTemplateFormatVersion"?\s*:/m.test(text)) return true;
  return /^\s*"?apiVersion"?\s*:/m.test(text) && /^\s*"?kind"?\s*:/m.test(text);
}

/** The first `SNIFF_BYTES` of a file, or "" when it cannot be read. */
function headOf(file) {
  let fd = null;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const read = readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    return buffer.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Every file in this tree that Trivy's misconfig scanner would read — relative
 * paths, forward slashes, sorted.
 *
 * Plain `node:fs`, no dependency, and symlinks are not followed: a link out of
 * the tree is not a file of this repository, and following it is how a walk
 * stops terminating.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function scopeFiles(root) {
  const base = resolve(root ?? process.cwd());
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isScopeName(entry.name) || (needsSniff(entry.name) && sniffsAsManifest(headOf(full)))) {
        found.push(relative(base, full).split("\\").join("/"));
      }
    }
  };
  walk(base);
  return found.sort();
}

/**
 * A handful of names, then a count — never the whole tree in one line.
 *
 * @param {string[]} files
 * @returns {string}
 */
export function nameList(files) {
  const list = Array.isArray(files) ? files : [];
  const shown = list.slice(0, NAMED_FILES).join(", ");
  const rest = list.length - NAMED_FILES;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * What a skip is blind to when the tree DOES hold files — the names, not the category.
 *
 * Handed back on the rung's result as `covers`, which `outcomeFrom()` prefers
 * over the rung's static sentence. The static one stays for the tree-less case
 * and for the shape test in `rungs.test.ts`.
 *
 * @param {string[]} files
 * @returns {string}
 */
export function blindTo(files) {
  return `${nameList(files)} — ${files.length} container/infrastructure file(s) in this tree, unread`;
}

/**
 * The `✓` a tree without any such file gets — without Docker having been asked.
 *
 * @returns {import("../rules.mjs").RungResult}
 */
export function nothingInScope() {
  return {
    state: "clean",
    findings: [],
    evidence:
      `No container or infrastructure file in this tree — looked for ${LOOKED_FOR}. ` +
      "docker-compose.yml is the development database and not a scanner target " +
      `(measured: Trivy reads no Compose file). Nothing here for ${SCANNER_IMAGE_REPO} ` +
      "to read, so Docker was not asked.",
  };
}

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
  // The sentence for a tree that holds no such file. When the tree does, the
  // result carries its own `covers` naming them (`blindTo()`).
  covers:
    "any Dockerfile, Terraform, Helm, Kubernetes or CloudFormation file in this repository — " +
    "the shipped docker-compose.yml is not one of them",

  async run({ root } = {}) {
    // `resolve()` so the host side of the mount is absolute on all three systems.
    const cwd = resolve(root ?? process.cwd());

    // 🚨 The tree first. A fresh app holds nothing this scanner reads, and a rung
    // that asks for a tool before it knows whether there is anything for the
    // tool to do prints a skip that reads as a gap (header).
    const files = scopeFiles(cwd);
    if (files.length === 0) return nothingInScope();
    const covers = blindTo(files);

    // 🚨 The daemon, not the PATH — and the app's own test for it, not a second one.
    if (!(await dockerUsable())) return { ...dockerMissing(), covers };

    // The repository name is a FILTER here, not a pull: `docker images` never
    // reaches a registry. An absent image is an empty stdout and exit 0.
    const listed = await capture("docker", [
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
      SCANNER_IMAGE_REPO,
    ]);
    if (Number(listed.code) !== 0) {
      return {
        ...unanswered(
          `docker could not list images: ${firstLine(listed.stderr) || "no reason given"}`,
        ),
        covers,
      };
    }
    const image = firstImage(listed.stdout);
    if (!image) return { ...imageMissing(SCANNER_IMAGE_REPO), covers };

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
      return {
        ...unanswered(
          said
            ? `${image} wrote no report Trivy would recognise: ${said}`
            : `${image} wrote no report Trivy would recognise (exit ${result.code})`,
        ),
        covers,
      };
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
        `over a read-only mount — ${results.length} configuration file(s) in scope; ` +
        `this tree holds ${files.length}: ${nameList(files)}.`,
    };
  },
};
