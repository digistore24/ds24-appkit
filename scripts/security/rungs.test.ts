// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The ladder's contract, and the one rule a tier-2 rung may never break.
//
// Two halves:
//
//  1. **The contract.** Every registered rung declares a unique id, a label, a
//     `tier` of exactly 1 or 2, a `covers` sentence and a `run` function — and
//     every tier-2 rung sits after every tier-1 one. `RUNGS` is imported from
//     `check.mjs`, which runs NOTHING on import: its entry-point guard compares
//     `process.argv[1]` against its own resolved path, precisely so a reader can
//     do this.
//
//  2. 🚨 **A tier-2 rung never downloads its own tool.** No `docker pull`, no
//     `npm install`, no `npx` that would fetch one, no `go install`, no request
//     to a host that is not one of the advisory databases this ladder declares.
//     The reason is written where the rule lives (`tier2.mjs`) and is worth
//     repeating in one line: a security check that downloads and executes a
//     package from a registry in order to look for supply-chain problems has
//     spent, in its own implementation, the thing it was protecting.
//     `rungs/signatures.mjs` verifies registry signatures; nothing here may
//     undercut it.
//
// ⚠️ **Pure.** `vitest.config.ts:15` puts every `.test.ts` under `template/`
// inside `make check`, and `security-check` must never become a gate. Nothing
// below spawns, fetches, or starts a container: it reads `RUNGS` and it reads
// source as TEXT.
//
// The text scan blanks comments through `blankComments()` from
// `scripts/lib/source-text.mjs` — never its own regex (CLAUDE.md → Rules;
// `source-text.test.ts` refuses a seventeenth copy). Without it, this very file's
// subject matter would report `container.mjs` for the `docker pull` it spends a
// paragraph refusing to run.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "../lib/source-text.mjs";
import { RUNGS } from "./check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNG_DIR = path.join(HERE, "rungs");

/** Every rung file, as `{ name, source }` with comments already blanked. */
const FILES = readdirSync(RUNG_DIR)
  .filter((name) => name.endsWith(".mjs"))
  .sort()
  .map((name) => ({
    name,
    source: blankComments(readFileSync(path.join(RUNG_DIR, name), "utf8")),
  }));

// ── the contract ────────────────────────────────────────────────────────────

describe("every registered rung keeps the shape the aggregator was written against", () => {
  it("has one file per rung and one rung per file", () => {
    // Non-vacuity for everything below: a walk that found nothing passes a suite
    // written around emptiness in full.
    expect(RUNGS.length).toBeGreaterThanOrEqual(10);
    expect(FILES.length).toBe(RUNGS.length);
    expect(FILES.map((file) => file.name)).toContain("history.mjs");
    expect(FILES.map((file) => file.name)).toContain("container.mjs");
  });

  it.each(RUNGS.map((rung) => [rung.id, rung]))("%s declares id, label, tier, covers, run", (_id, rung: any) => {
    expect(typeof rung.id).toBe("string");
    expect(rung.id.trim()).not.toBe("");
    expect(String(rung.label ?? "").trim()).not.toBe("");
    // `covers` is not decoration: it is the sentence that stops a skip reading
    // like a pass, and `formatSkip()` prints it as `Blind to:`.
    expect(String(rung.covers ?? "").trim()).not.toBe("");
    expect([1, 2]).toContain(rung.tier);
    expect(typeof rung.run).toBe("function");
  });

  it("gives every rung its own id — the record is keyed on it", () => {
    const ids = RUNGS.map((rung) => rung.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says what it WOULD have checked, not what it is called", () => {
    for (const rung of RUNGS) {
      // A `covers` that is the label again tells a reader nothing they did not
      // already have from the `⏭ NOT ASKED` header line above it.
      expect(rung.covers.trim().toLowerCase()).not.toBe(rung.label.trim().toLowerCase());
      expect(rung.covers.length).toBeGreaterThan(20);
    }
  });

  it("🚨 puts every tier-2 rung after every tier-1 one", () => {
    // The one ordering rule this ladder has. A tier-2 rung prints a
    // `⏭ NOT ASKED` block on most machines, and those belong at the bottom of
    // what somebody reads — under the answers that were actually given.
    const tiers = RUNGS.map((rung) => rung.tier);
    const firstTwo = tiers.indexOf(2);
    if (firstTwo === -1) return;
    expect(
      tiers.slice(firstTwo),
      `RUNGS goes ${tiers.join(", ")} — a tier-1 rung may not follow a tier-2 one`,
    ).toEqual(tiers.slice(firstTwo).map(() => 2));
  });

  it("has both of this story's rungs registered, at tier 2, last", () => {
    const tail = RUNGS.slice(-2).map((rung) => rung.id);
    expect(tail).toEqual(["secrets-history", "container-scan"]);
    for (const id of tail) expect(RUNGS.find((rung) => rung.id === id)!.tier).toBe(2);
  });
});

// ── 🚨 a rung never fetches its own tool ────────────────────────────────────

/**
 * The hosts a rung is allowed to name.
 *
 * Each is an advisory database a tier-1 rung declares in its own header, and
 * each was measured into this list off the shipped source rather than chosen.
 * `rungs/drift.mjs` is deliberately absent: it takes its base from the app's own
 * `.template-version`, so it names no host at all.
 */
const DECLARED_HOSTS = ["api.osv.dev", "registry.npmjs.org", "api.deps.dev"];

/** Every `https?://host` literal left in a source once its comments are blanked. */
export function hostsIn(source: string): string[] {
  return [...source.matchAll(/https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((match) => match[1]);
}

/**
 * Everything in a rung's source that would ACQUIRE a tool.
 *
 * Two layers, and the second exists because of a measurement: `npm install`
 * appears as plain prose in the `Fix:` line of three shipped rungs — advice to an
 * operator, not something this code runs. A flat text scan for it would report
 * those three and teach whoever hit it to weaken the rule. So the executable
 * question is asked of the SPAWN CALL SITES, where the command and its argv are
 * both visible, and the flat scan is kept for the needles that cannot honestly
 * occur in prose here.
 */
export function acquisitionsIn(source: string): string[] {
  const found: string[] = [];

  // ── layer 1: needles that are never prose in this folder ──────────────────
  if (/docker\s+pull/.test(source)) found.push("docker pull");
  if (/\bgo\s+install\b/.test(source)) found.push("go install");
  // `npx` is admitted only as `npx --no-install <tool>` — which runs what is
  // already in node_modules/.bin and REFUSES rather than fetching.
  for (const line of source.split(/\r?\n/)) {
    if (/\bnpx\b/.test(line) && !line.includes("--no-install")) found.push("npx without --no-install");
  }

  // ── layer 2: what is actually started ────────────────────────────────────
  const calls = source.matchAll(
    /\b(?:capture|run|runNpm|runScript|spawn|spawnCommand)\s*\(\s*(["'`])([^"'`]*)\1\s*,\s*\[([\s\S]*?)\]/g,
  );
  for (const call of calls) {
    const command = call[2];
    const argv = call[3];
    const has = (word: string) => new RegExp(`["'\`]${word}["'\`]`).test(argv);
    if (/(^|[\\/])docker(\.exe)?$/.test(command) && has("pull")) found.push(`spawns ${command} pull`);
    if (/(^|[\\/])npm(\.cmd|\.exe)?$/.test(command) && (has("install") || has("i")))
      found.push(`spawns ${command} install`);
    // `npx --no-install <tool>` is the one admitted form: it runs what is already
    // in node_modules/.bin and refuses rather than fetching. Anything else fetches.
    if (/(^|[\\/])npx(\.cmd|\.exe)?$/.test(command) && !has("--no-install"))
      found.push(`spawns ${command} without --no-install`);
    if (/(^|[\\/])go(\.exe)?$/.test(command) && has("install")) found.push(`spawns ${command} install`);
  }

  return found;
}

/** Environment variables a rung reads, or merely names — see the assertion below. */
export function credentialNamesIn(source: string): string[] {
  return [...source.matchAll(/\b[A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD)[A-Z0-9_]*\b/g)].map(
    (match) => match[0],
  );
}

describe("🚨 no rung ever acquires its own tool", () => {
  it("the needle can fire at all", () => {
    // 🚨 The assertions below are scans over source text, and a scan whose needle
    // cannot occur passes over every file in the tree while reading none of it.
    // `source-text.test.ts:176-201` records what that cost: sixteen copies of a
    // regex were removed while the guard meant to keep them gone could not see a
    // single one. So each needle is measured against a planted fixture first.
    const planted = [
      'const a = await capture("docker", ["pull", "aquasec/trivy"]);',
      'const b = await capture("npm", ["install", "some-scanner"]);',
      "// docker pull happens here",
      "await run(\"npx\", [\"some-scanner\"]);",
    ].join("\n");
    const found = acquisitionsIn(blankComments(planted));
    expect(found).toContain("spawns docker pull");
    expect(found).toContain("spawns npm install");
    expect(found).toContain("spawns npx without --no-install");
    expect(found).toContain("npx without --no-install");

    // …and the two that must NOT fire: prose in a Fix line, and `npm ci --dry-run`,
    // which installs nothing and is what `rungs/posture.mjs` really runs.
    const innocent = [
      'fix: "Raise them in package.json, run `npm install`, then node run.mjs test",',
      'const c = await capture("npm", ["ci", "--dry-run"]);',
      'const d = await capture("npx", ["--no-install", "tool"]);',
    ].join("\n");
    expect(acquisitionsIn(blankComments(innocent))).toEqual([]);

    expect(credentialNamesIn("process.env.CRON_SECRET")).toEqual(["CRON_SECRET"]);
    expect(hostsIn('await fetch("https://evil.example.net/x")')).toEqual(["evil.example.net"]);
  });

  it.each(FILES.map((file) => [file.name, file]))("%s downloads nothing", (_name, file: any) => {
    expect(
      acquisitionsIn(file.source),
      `${file.name} would acquire a tool: ${acquisitionsIn(file.source).join(", ")}\n` +
        "A tier-2 rung discovers its tool and never fetches it — scripts/security/tier2.mjs " +
        "carries the reasoning. The way to get it belongs in the skip's reason, where a " +
        "person reads it and decides.",
    ).toEqual([]);
  });

  it.each(FILES.map((file) => [file.name, file]))("%s needs no account and no key", (_name, file: any) => {
    // NFR-65 made structural: no rung reads — or even names — an environment
    // variable that would be a credential. ⚠️ A text scan cannot see a name that
    // arrives through an IMPORTED table; `rungs/live.mjs` is the shipped case
    // (`ENVIRONMENTS`), and the reason it is not a hole is that only the ADDRESS
    // half of that table is ever read, which that file argues at length.
    expect(
      credentialNamesIn(file.source),
      `${file.name} names a credential-shaped environment variable. A rung requires no ` +
        "account, no API key and no hosted service (NFR-65).",
    ).toEqual([]);
  });

  it.each(FILES.map((file) => [file.name, file]))("%s talks only to a declared database", (_name, file: any) => {
    for (const host of hostsIn(file.source)) {
      expect(
        DECLARED_HOSTS,
        `${file.name} names the host ${host}. A rung may reach an advisory database it ` +
          "declares in its own header, and nothing else.",
      ).toContain(host);
    }
  });

  it("keeps every tier-2 rung off the network entirely", () => {
    // A tier-2 rung asks a LOCAL tool a local question. `--network none` says the
    // same thing to the container; this says it about the rung.
    for (const file of FILES.filter((entry) => /tier:\s*2/.test(entry.source))) {
      expect(file.source, `${file.name} is tier 2 and calls fetch()`).not.toMatch(/\bfetch\s*\(/);
      expect(hostsIn(file.source), `${file.name} is tier 2 and names a host`).toEqual([]);
    }
    // Non-vacuity: the two this story added really are seen as tier 2 here.
    expect(FILES.filter((entry) => /tier:\s*2/.test(entry.source)).map((entry) => entry.name)).toEqual([
      "container.mjs",
      "history.mjs",
    ]);
  });
});
