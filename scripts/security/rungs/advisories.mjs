// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 1 — known advisories against the versions this app actually resolved.
//
// It needs nothing installed beyond npm, which is there anyway, and it asks npm
// TWO questions rather than one, because they are two different questions:
//
//   npm audit --omit=dev --audit-level=high   what SHIPS. No allowance at all:
//                                             anything here reaches a visitor's
//                                             browser, so it is ❌ HIGH (🚨 where
//                                             npm says critical) and no accepted
//                                             set is consulted.
//   npm audit                                 the whole tree. A finding here does
//                                             not ship; it is ⚠️ MEDIUM, unless
//                                             its id is in the accepted set, in
//                                             which case it is reported as known
//                                             and left out of the counts.
//
// Merging the two is the mistake this rung is shaped against: a dev-only
// linting advisory rated like a hole in the request path teaches an operator to
// ignore the whole report, and a shipping hole rated as "dev-only, accepted" is
// how one gets missed.
//
// ── "Clean" and "could not look" are not the same answer ───────────────────
//
// `npm audit` exits 1 for two completely different reasons: it found something
// at or above the audit level, or it could not reach the registry at all. So
// the exit code cannot be the discriminator, and neither can a match on the
// error text. The structural one is the presence of `auditReportVersion` in the
// JSON. Measured on this tree:
//
//   npm audit --json                                exit 0, {"auditReportVersion":2,"vulnerabilities":…}
//   npm audit --omit=dev --audit-level=high --json  exit 0, same shape
//   npm audit --package-lock-only --json            exit 0, same shape — no install needed
//   npm audit --json --registry=http://127.0.0.1:9  {"message":"request to … failed, reason: connect ECONNREFUSED"}
//
// No report keys in the last one. So: a report ⇒ an answer; no report ⇒ this
// rung did not run, and it says so with the reason instead of reporting clean.
//
// Plain Node, no dependency. npm is started through `capture()` — never a
// shell, because on Windows npm is a `.cmd` shim and `spawnCommand()` is the
// only thing in this project allowed to know that.
//
// ⚠️ `readAudit()`, `advisoriesIn()` and `whereOf()` used to live in this file
// and now live in `../npm-audit.mjs`, unchanged. They moved because a SECOND
// rung needs what npm reported — and a rung importing another rung is one step
// from a rung reading another rung's outcome, which is the property the ladder
// exists to deny. Nothing about this rung's behaviour changed with the move.
import { capture } from "../../lib/proc.mjs";
import { ACCEPTED_ADVISORIES, acceptedIds } from "../accepted.mjs";
import { advisoriesIn, auditScope, readAudit, whereOf } from "../npm-audit.mjs";
import { partitionAccepted } from "../rules.mjs";

const SOURCE = "npm audit";

const evidenceOf = (advisory, command) =>
  `${command} reported it — npm severity "${advisory.npmSeverity || "unrated"}", ` +
  `reached through ${advisory.packages.size} package(s) in this tree.`;

/** A finding about something that reaches a visitor's browser. No allowance applies. */
function shippedFinding(advisory, command) {
  return {
    // npm's own word decides only the top of the ladder. Everything else that
    // ships is HIGH regardless of what npm calls it: it is in the bundle a
    // customer loads, which is the condition the ladder rates.
    severity: advisory.npmSeverity === "critical" ? "critical" : "high",
    title: advisory.title || `Known advisory ${advisory.id}`,
    where: whereOf(advisory),
    why:
      "This package is in what your app SHIPS, so it runs on a request from a " +
      "visitor. A known hole there is reachable by anybody who can reach the app.",
    fix: advisory.fixAvailable
      ? "A fixed version exists: `npm audit fix`, then `node run.mjs test` — an " +
        "update that breaks the build is not a fix."
      : "No fixed version is published yet. Pin or replace the package, or override " +
        "the transitive dependency in package.json; the order to do it in is in " +
        ".claude/skills/security-gateway/references/checks-secrets-and-deps.md.",
    evidence: evidenceOf(advisory, command),
    source: SOURCE,
    id: advisory.id,
  };
}

/** A finding in the development half of the tree — real, but not on the way out. */
function devFinding(advisory, command) {
  return {
    severity: "medium",
    title: advisory.title || `Known advisory ${advisory.id}`,
    where: whereOf(advisory),
    why:
      "It sits in the development dependencies only, so nothing a customer loads " +
      "runs it. It is real for whoever builds here and it is not a launch blocker.",
    fix:
      "Judge it: update if the update is cheap, or accept it by its id in " +
      "scripts/security/accepted.mjs with the reason written out. An id with no " +
      "reason reads as an arbitrary exemption to whoever finds it next.",
    evidence: evidenceOf(advisory, command),
    source: SOURCE,
    id: advisory.id,
  };
}

/**
 * A finding somebody has already judged.
 *
 * Its `Why:` is the reason out of the accepted set, so the check never trains
 * its reader to skip past a block they have stopped reading. And its `Fix:`
 * deliberately never says `npm audit fix`: an accepted advisory is accepted
 * because the fixes were tried and were worse than the finding.
 */
function acceptedFinding(advisory, command) {
  return {
    // What it WOULD be rated if the entry were taken out of the accepted set.
    // It is never counted while it is in there — `aggregate()` keeps the two
    // lists apart — but a finding with no severity is one that has to be
    // re-judged from scratch the day somebody withdraws the acceptance.
    severity: "medium",
    title: advisory.title || `Known advisory ${advisory.id}`,
    where: whereOf(advisory),
    why: ACCEPTED_ADVISORIES[advisory.id]?.reason ?? "Accepted in scripts/security/accepted.mjs.",
    fix: "Nothing to do here — the way out is upstream. Take the entry out of scripts/security/accepted.mjs when it stops being true.",
    evidence: evidenceOf(advisory, command),
    source: SOURCE,
    id: advisory.id,
  };
}

/** @type {import("../rules.mjs").Rung} */
export const advisories = {
  id: "advisories",
  label: "Known advisories (npm audit)",
  // Tier 1: nothing to install. npm is here because this is a Node app.
  tier: 1,
  covers: "known advisories against the versions this app resolved",

  async run({ root } = {}) {
    const cwd = root ?? process.cwd();
    // A half-set-up project is exactly when somebody asks whether this is safe,
    // so nothing installed is not a refusal: npm answers the same question off
    // the lockfile alone. WHICH of the two npm was put, and what it rated, is
    // `auditScope()`'s to decide and to say — one decision, shared with the OSV
    // rung, measured rather than reasoned about (see ../npm-audit.mjs).
    const scope = auditScope(cwd);

    const shippedCommand = `npm audit --omit=dev --audit-level=high --json${scope.suffix}`;
    const treeCommand = `npm audit --json${scope.suffix}`;

    const shipped = readAudit(
      await capture("npm", ["audit", "--omit=dev", "--audit-level=high", "--json", ...scope.flags], {
        cwd,
      }),
    );
    if (!shipped.report) {
      return { state: "skipped", reason: shipped.reason, findings: [] };
    }

    const tree = readAudit(await capture("npm", ["audit", "--json", ...scope.flags], { cwd }));
    if (!tree.report) {
      // Half an answer is not an answer. The whole-tree call is what recognises
      // an accepted advisory, so reporting only the shipping half here would
      // silently drop the other question rather than saying it went unasked.
      return { state: "skipped", reason: tree.reason, findings: [] };
    }

    const shippedAdvisories = advisoriesIn(shipped.report);
    const shipping = new Set(shippedAdvisories.map((advisory) => advisory.id));
    const findings = shippedAdvisories.map((advisory) => shippedFinding(advisory, shippedCommand));

    // Everything the whole-tree call adds ON TOP of what ships. An advisory that
    // ships appears in both answers, and it has already been rated by the
    // stricter of the two.
    const rest = advisoriesIn(tree.report).filter((advisory) => !shipping.has(advisory.id));
    const split = partitionAccepted(rest, acceptedIds());

    for (const advisory of split.findings) findings.push(devFinding(advisory, treeCommand));
    const accepted = split.accepted.map((advisory) => acceptedFinding(advisory, treeCommand));

    return {
      state: findings.length > 0 ? "found" : "clean",
      findings,
      accepted,
      evidence: `${shippedCommand}, then ${treeCommand} — ${scope.note}`,
    };
  },
};
