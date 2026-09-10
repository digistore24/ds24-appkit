// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every exported Server Action has a decided answer to "who may call this" —
// enforced structurally, not by review.
//
// 🚨 **This is not a hole; it is the missing catch for the next one.** Counted
// on 2026-08-18: all 37 exported actions under `app/dashboard/admin/**` (13) and
// `modules/community/**` (24) ARE guarded. But a Server Action is an HTTP
// endpoint of its own, and a 38th without a guard would be red in **no gate at
// all**: `npm run typecheck` green, vitest green, `smoke` only makes GETs,
// `deploy-test` posts nothing. Finding L-7.
//
// The sibling instruments: `app/route-protection.test.ts` forces the decision
// for ROUTES, `lib/setup/guard-presence.test.ts` and
// `modules/api/routes/guard-presence.test.ts` for HTTP handlers,
// `modules/courses/admin/guard.test.ts` for the courses surface. These two
// surfaces had nothing. ⚠️ Not to be confused with the five guard tests under
// `modules/community/lib/` — those check SEMANTIC properties (DM
// confidentiality, feed leakage, moderation authority). None of them asks
// whether every exported action opens with a guard; the gap sat beside them.
//
// It lives here, next to `app/route-protection.test.ts`, because it is the same
// instrument pointed at the other kind of endpoint and because it spans both
// trees — a list per surface would be two lists to keep, and the openers are
// shared between them.
//
// ── The rule, and why it is not "opens with requireOwner()" ────────────────
//
// There are SEVEN openers on these two surfaces, not one, and that is correct:
// the community surface has owner actions AND member actions. So the rule is
// **the first `await` in the body is a call from a closed, named list** — and
// the list itself is then the thing under test.
//
// 🚨 Which is why there are TWO stages. A name list is only as good as the list:
// whoever adds `helper()`, which guards nothing, and writes `helper` into
// OPENERS has defeated the test and nobody notices. Stage 2 reads each opener's
// own definition and requires it to reach one of the three real authorities.
//
// 🚨 **Through `blankComments()`, never a regex of its own.** A checker that
// greps source punishes a file for explaining itself, and these files explain
// themselves at length — `modules/community/pages/actions.ts` names
// `requireActiveUser` in prose about why a different function does not read one.
// The measured post-mortem is in `scripts/lib/source-text.mjs`.
//
// ⚠️ **Counts are floors, never equalities.** An equality would break on every
// new action, and a walk that found NOTHING must be a failure rather than a
// clean run — that is the shape of mistake this whole file exists to catch.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();

/**
 * The openers, counted off the code rather than guessed.
 *
 * ⚠️ The finding's own first pass reported four actions as unguarded, and it
 * was a short pattern list rather than the code: `viewer()` and `dmViewer()`
 * were missing from it. Whoever extends this list counts first.
 *
 * `requireOwner`, `requireActiveUser` and `currentActiveUser` are the
 * authorities themselves; the rest are surface-local helpers that resolve to
 * one of them, which stage 2 checks.
 */
const OPENERS = [
  "requireOwner",
  "requireActiveUser",
  "currentActiveUser",
  "actor",
  "guard",
  "guardAsOperator",
  "viewer",
  "dmViewer",
  "requireDmActor",
];

/** What an opener has to reach, one way or another. */
const AUTHORITIES = ["requireOwner", "requireActiveUser", "currentActiveUser"];

/** Every `.ts` under `dir`, recursively — admin/ is NESTED, unlike the mould. */
function sourcesIn(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourcesIn(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

interface ServerFile {
  path: string;
  source: string;
}

/**
 * The `"use server"` files under `dir`.
 *
 * The directive itself and through `blankComments()` — a file that merely
 * MENTIONS the string in prose is not one.
 */
function serverFiles(dir: string): ServerFile[] {
  return sourcesIn(join(ROOT, dir))
    .map((path) => ({ path, source: blankComments(readFileSync(path, "utf8")) }))
    .filter(({ source }) => /^\s*["']use server["']/m.test(source));
}

/** Every `export async function`, with the text that follows it. */
function actionsIn(source: string): { name: string; body: string }[] {
  return source
    .split(/export\s+async\s+function\s+/)
    .slice(1)
    .map((chunk) => ({ name: chunk.slice(0, chunk.indexOf("(")).trim(), body: chunk }));
}

/** The base name of the first thing this body awaits, or null. */
function firstAwait(body: string): string | null {
  const match = /await\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(body);
  return match ? match[1]!.split(".")[0]! : null;
}

const SURFACES = [
  { dir: "app/dashboard/admin", minFiles: 4, minActions: 13 },
  { dir: "modules/community", minFiles: 8, minActions: 24 },
];

describe.each(SURFACES)("$dir — every action opens with a guard", ({ dir, minFiles, minActions }) => {
  const files = serverFiles(dir);
  const all = files.flatMap((file) =>
    actionsIn(file.source).map((action) => ({ ...action, path: file.path })),
  );

  it("🚨 found the surface at all", () => {
    // The count guard. A walk that collapsed reports zero offenders and looks
    // exactly like a clean tree — the failure this file exists to prevent,
    // turned on itself.
    expect(files.length, `no "use server" files under ${dir}`).toBeGreaterThanOrEqual(minFiles);
    expect(all.length, `no exported actions under ${dir}`).toBeGreaterThanOrEqual(minActions);
  });

  it("every exported action's first await is an opener", () => {
    const unguarded = all
      .filter((action) => {
        const opener = firstAwait(action.body);
        return opener === null || !OPENERS.includes(opener);
      })
      .map((action) => `${relative(ROOT, action.path)}:${action.name} (${firstAwait(action.body) ?? "nothing awaited"})`);

    expect(
      unguarded,
      "an exported Server Action does not open with a guard. A Server Action is a " +
        "public HTTP endpoint: either open it with one of OPENERS, or — if a new " +
        "opener is genuinely right — add it to OPENERS and make sure stage 2 below " +
        "can see it authorise something.",
    ).toEqual([]);
  });
});

describe("🚨 stage 2 — and each opener really authorises", () => {
  // Without this half, OPENERS is a list anybody can write themselves into.
  // Every opener is defined in one of the two surfaces or in the community
  // module's `lib/`, all of which are read here — so no import resolution is
  // needed.
  const HAYSTACK = [
    ...sourcesIn(join(ROOT, "app/dashboard/admin")),
    ...sourcesIn(join(ROOT, "modules/community")),
    ...sourcesIn(join(ROOT, "lib/authz.ts").replace(/\/authz\.ts$/, "")),
  ].map((path) => ({ path, source: blankComments(readFileSync(path, "utf8")) }));

  it("has sources to look in", () => {
    expect(HAYSTACK.length, "stage 2 found no files").toBeGreaterThan(10);
  });

  /**
   * The body of a top-level declaration of `name`, or null.
   *
   * ⚠️ Anchored to the start of a LINE. Without that, `const viewer = { … }`
   * inside some unrelated function matches first and stage 2 reads a local
   * variable instead of the opener — measured while writing this, on
   * `modules/community/lib/reports.ts`.
   */
  function definitionOf(name: string): string | null {
    const declaration = new RegExp(
      `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(|^(?:export\\s+)?const\\s+${name}\\s*=`,
      "m",
    );
    for (const { source } of HAYSTACK) {
      const match = declaration.exec(source);
      if (!match) continue;
      const from = match.index;
      const next = source.indexOf("\nexport ", from + 1);
      return source.slice(from, next === -1 ? from + 2000 : next);
    }
    return null;
  }

  /**
   * Does this opener reach an authority — directly, or through ONE other
   * opener that does?
   *
   * The indirection is real and not a loophole: `dmViewer()` is one line,
   * `return requireDmActor()`, and `requireDmActor()` is the DM seam that reads
   * `currentActiveUser()`. Refusing that would push the test towards a list of
   * exceptions, which is the thing stage 2 exists to avoid. It is bounded to
   * one hop and every hop must itself be a NAMED opener, so nothing can be
   * laundered through an anonymous helper.
   */
  function reachesAuthority(opener: string, seen = new Set<string>()): boolean {
    if (AUTHORITIES.includes(opener)) return true;
    if (seen.has(opener)) return false;
    seen.add(opener);
    const body = definitionOf(opener);
    if (!body) return false;
    if (AUTHORITIES.some((authority) => body.includes(authority))) return true;
    return OPENERS.some((other) => other !== opener && body.includes(`${other}(`) && reachesAuthority(other, seen));
  }

  it.each(OPENERS.filter((name) => !AUTHORITIES.includes(name)))(
    "%s reaches one of the three authorities",
    (opener) => {
      expect(
        definitionOf(opener),
        `${opener} is in OPENERS but is defined nowhere these surfaces can see`,
      ).toBeTruthy();
      expect(
        reachesAuthority(opener),
        `${opener} guards nothing — it is in OPENERS but reaches no authority`,
      ).toBe(true);
    },
  );
});
