// Copyright (c) 2026 Digistore24 Inc, SPDX-License-Identifier: MIT

// The dependency decisions that cannot be written down where they are made.
//
// `package.json` and `package-lock.json` are JSON: they hold no comments. So an
// `overrides` entry looks like an arbitrary version to whoever reads it next,
// and the two most likely things to happen to it are that somebody deletes it as
// noise or narrows it back into the shape that caused the noise. This file is
// where the reasoning lives instead — the same arrangement `scripts/dev/fixes.json`
// has, and for the same reason.
//
// 🚨 **That is now a checked property, not a convention.** The `posture` rung of
// `node run.mjs security-check` reads THIS FILE'S TEXT and reports an `overrides`
// entry whose package name it cannot find here — so every key in that block owes
// a paragraph below. Two things follow. It reads the file with its comments
// INTACT (the reasons ARE comments; `scripts/security/rungs/posture.mjs` says why
// at the call site), and a reason that cannot be recovered from git history says
// **that**, plus what was measured, rather than an invented rationale.
//
// Five overrides are pinned here, one measurement, one refusal, and one
// non-decision.
//
// ── 1. The esbuild override is a FLOOR, not a pin ───────────────────────────
// It exists because GHSA-67mh-4wv8-2f99 let esbuild's development server answer
// cross-origin requests, fixed in 0.25.0. Removing it is not an option:
// drizzle-kit reaches esbuild through @esbuild-kit/core-utils, whose own range
// goes back into 0.18.
//
// It was written `^0.25.12`, which is `>=0.25.12 <0.26.0` — a pin. vite 8 (via
// vitest) and tsx 4 both ask for `^0.28`, so every `npm install` printed a wall
// of `npm WARN ERESOLVE overriding peer dependency` at somebody who had just
// deployed the app, and npm lost the argument anyway: `npm ls esbuild` reported
// two `invalid` entries. A floor says what was always meant and prints nothing.
//
// ── 1a. postcss and nodemailer — the older copies somebody else brings ──────
// Both come from the same day (`1c774a4`): a freshly generated app reported 16
// vulnerabilities, one of them critical, on its first `npm install`.
// `npm audit fix --force` was refused there and is refused here — it wanted to
// downgrade `next` to 9.3.3. What was done instead was to raise the direct
// dependencies (vitest 2→4, drizzle-orm 0.38→0.45, drizzle-kit 0.30→0.31,
// nodemailer 6→9, next-auth beta.25→beta.32) and then to override the two
// packages that arrive a second time, older, underneath somebody else:
//
//     postcss     `next` asks for the EXACT version 8.4.31, and @tailwindcss/postcss
//                 and vite ask for ^8.5.x. Without the override npm is entitled to
//                 nest next's own copy, and that copy is in what the app SHIPS —
//                 the bundle a customer's visitors load. Raising the direct
//                 devDependency alone does not reach it.
//     nodemailer  @auth/core and next-auth declare it as a PEER at
//                 `^7.0.7 || ^8.0.5`, while this app asks for ^9. The override is
//                 what makes that one resolution instead of an ERESOLVE block on
//                 every install — and `make deploy-local-check` is the gate that
//                 reads those blocks, so it is not a cosmetic difference.
//
// Neither is a floor written `>=`, and that is deliberate rather than an
// oversight: unlike esbuild, nothing here asks for a HIGHER major of either, so
// the caret prints nothing. If one ever does, the esbuild block above is the
// worked example of what to do about it.
//
// ── 1b. nanoid — a high advisory in the shipped bundle ─────────────────────
// `cd2c9e4`. GHSA-2v37-7h3g-55p8 in `nanoid <3.3.17`, severity high, and PROD:
// it reaches the tree transitively under `postcss` under `next`, so it is in the
// bundle a customer-app's visitors load. Nothing regressed here — 3.3.16 was
// already in the lockfile and the advisory was new.
//
// Fixed as an OVERRIDE rather than as a direct dependency on purpose:
// `npm install nanoid@…` would have written it into `dependencies`, and this app
// never imports nanoid — a direct dependency on a package nobody imports is a
// claim the next tidy-up rightly deletes. `npm audit --omit=dev --audit-level=high`
// went back to `found 0 vulnerabilities`, which is the question that takes no
// allowance at all.
//
// ── 1c. sharp — two high libvips findings out of every install ─────────────
// `aa9993e`: sharp arrived transitively (next declares it as an optional
// dependency at ^0.34.5) and the libvips CVEs in that range came out of every
// `npm install` as two HIGH findings. The override raised it to ^0.35.0 and
// `npm audit` reported 0. `71696e6` later made sharp a DIRECT dependency as well
// — `createMedia()` uses it to write the narrower image variants — deliberately
// at the same range, so the two cannot drift apart. next's own optional ^0.34.5
// is still in the lockfile, which is what the override is still holding down.
//
// ── 2. brace-expansion must carry the expansion cap ────────────────────────
// GHSA-mh99-v99m-4gvg: a brace bomb expands without bound and takes the process
// down with an out-of-memory crash. It reaches this project only through eslint,
// so it never ships — but a lockfile is what a fresh clone installs, and there
// is no reason to hand anybody the version that dies. Measured, not assumed:
//
//     1.1.16 -> heap out of memory      (what this lockfile used to pin)
//     1.1.18 -> returns a capped list
//
// The 5.x floor had no such line for a long time, and two other files asserted
// `5.0.9` in prose while this one enforced `5.0.8` — consistent only because a
// floor admits everything above it, and because the lockfile happens to resolve
// 5.0.9. Measured 2026-08-10 (Node v22.22.1, `--max-old-space-size=512`):
//
//     5.0.7 -> FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed -
//              JavaScript heap out of memory
//     5.0.8 -> returns a capped list (2 entries, ~3.9 MB)
//
// ⚠️ **The obvious bomb does not separate them, and that is why nobody had an
// answer.** `"{a,b}".repeat(30)` is capped by 5.0.6 and 5.0.7 as well: 5.x has
// carried `EXPANSION_MAX` (100000 results) since before either. What 5.0.8 adds
// is `EXPANSION_MAX_LENGTH` (4000000 characters), so the bomb that tells them
// apart is one whose result COUNT is small and whose total LENGTH is not —
// `("{" + "a".repeat(100000) + ",b}").repeat(20)`. 5.0.7 dies on it; 5.0.8
// returns two strings. **5.0.8 is the floor**, and `5.0.9` was only ever the
// version this tree happened to resolve.
//
// The floors are per major because the fix was backported: 1.1.18 and 5.0.8.
// An unvetted major fails this test rather than passing quietly — the check is
// "somebody measured this one", and nobody has measured 3.x or 4.x here.
//
// ── 3. minimatch and brace-expansion may NEVER be overridden ───────────────
// This is the load-bearing one, because it forbids the fix that looks best.
//
// For a long stretch of this template's life `npm audit` reported the
// brace-expansion advisory above once per path through eslint-config-next — one
// advisory, counted per path, which is why the summary line read like several
// problems. It never shipped: `npm audit --omit=dev` was clean
// throughout, which is the question the skill `security-gateway` §5 already asks.
// It persisted because the advisory range is written `<=5.0.7` across all
// majors, so the 1.x backport that fixes the bug sits inside it. It is not
// currently reported here; why it stopped is not measured, and nothing in this
// decision depends on whether it comes back.
//
// `"overrides": { "minimatch": "^10" }` makes any such finding go away. It also
// breaks the linter. minimatch@10's CommonJS build exports an OBJECT and sets
// `__esModule: true` with no `default`; eslint-plugin-import,
// eslint-plugin-jsx-a11y and eslint-plugin-react all do
// `_interopRequireDefault(require('minimatch'))` and end up calling `undefined`:
//
//     TypeError: minimatch is not a function
//     Rule: "react/forbid-component-props"
//
// `npm run lint` in this project stays GREEN, because eslint-config-next enables
// none of the affected rules. That is exactly what makes it dangerous: it ships
// as a landmine for the first customer who switches one on. The same reasoning
// rules out overriding brace-expansion to `^5` — 5.x's CJS export is
// `{ EXPANSION_MAX, EXPANSION_MAX_LENGTH, expand }`, where minimatch@3 calls the
// module itself.
//
// A clean `npm audit` is not worth a crash in somebody else's app. If the two
// packages ever have to be forced, the way through is upstream —
// eslint-config-next moving its plugins off minimatch@3 — not an override here.
//
// ── 4. The two deprecation warnings are not a decision at all ──────────────
// `docs/troubleshooting.md` → *What the first install prints* already answers
// them for whoever reads them on a first install, and that answer is not
// repeated here. What is here is the part prose cannot do: the answer is
// "@esbuild-kit is drizzle-kit's chain, not ours", and nothing checked that it
// STAYS that. A direct dependency on either, or a second package pulling them
// in, turns a line somebody was told to ignore into one they should not — and
// it would arrive looking exactly like the line before it.
//
// The check deliberately does not fail when drizzle-kit drops them: that is the
// day the warnings stop, and a customer's suite going red because upstream
// improved is noise they cannot act on. Then this block is stale prose, and
// deleting it is the whole job.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const json = (rel: string) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

const pkg = json("package.json");
const lock = json("package-lock.json");

/** The esbuild dev-server CVE was fixed in 0.25.0; 0.25.12 is where we came in. */
const ESBUILD_FLOOR = "0.25.12";

/** Majors of brace-expansion somebody has measured, and the version that caps. */
const BRACE_EXPANSION_FLOORS: Record<string, string> = { "1": "1.1.18", "5": "5.0.8" };

/**
 * The overrides whose reason names a specific advisory, and the version that
 * closes it — sections 1b and 1c above.
 *
 * Only these two: `esbuild` has its own block below (it is a floor, and the
 * shape of the range is the whole point there), and `postcss` / `nodemailer` are
 * not about one advisory but about an older copy somebody else brings, which is
 * a state of the tree rather than a version anybody can name. A reason with no
 * assertion is still the deliverable — the posture rung reads this file's TEXT.
 */
const ADVISORY_FLOORS: Record<string, { floor: string; advisory: string }> = {
  nanoid: { floor: "3.3.17", advisory: "GHSA-2v37-7h3g-55p8, high, and in what the app SHIPS" },
  sharp: { floor: "0.35.0", advisory: "the libvips CVEs next's own ^0.34.5 range sits in" },
};

/** Packages that must never appear in `overrides` — see decision 3 above. */
const NEVER_OVERRIDE = ["minimatch", "brace-expansion"];

/** The packages whose deprecation notice a first install prints — see 4 above. */
const DEPRECATED_TRANSITIVES = ["@esbuild-kit/esm-loader", "@esbuild-kit/core-utils"];

/** The only package that may ask for them (esm-loader asks for core-utils itself). */
const DEPRECATED_VIA = "drizzle-kit";

/** `1.2.3` → `[1, 2, 3]`. Every version here is a plain triple. */
function triple(version: string): [number, number, number] {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`not a plain version: ${version}`);
  }
  return [parts[0], parts[1], parts[2]];
}

/**
 * The version a `">=x.y.z"` range admits from below, or null for anything else.
 *
 * Deliberately strict rather than forgiving: a range this cannot read is a range
 * whose lower bound nobody can state, and reporting that is the whole job here.
 */
function floorOf(range: string): string | null {
  return /^>=\s*(\d+\.\d+\.\d+)$/.exec(range.trim())?.[1] ?? null;
}

/** True when `version` is at or above `floor`. */
function atLeast(version: string, floor: string): boolean {
  const [a, b, c] = triple(version);
  const [x, y, z] = triple(floor);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
}

/**
 * The lockfile paths of every package that ASKS for `name`.
 *
 * The root entry is `""`, so a direct dependency shows up as an empty path —
 * which is exactly the case the deprecation check wants to catch.
 */
function requestedBy(name: string): string[] {
  return Object.entries(lock.packages as Record<string, Record<string, unknown>>)
    .filter(([, entry]) =>
      ["dependencies", "devDependencies", "optionalDependencies"].some(
        (field) => (entry[field] as Record<string, string> | undefined)?.[name] !== undefined,
      ),
    )
    .map(([where]) => where);
}

/** `node_modules/a/node_modules/b` → `b`; the root entry `""` → `""`. */
function packageNameAt(where: string): string {
  return where === "" ? "" : (where.split("node_modules/").pop() as string);
}

/** Every resolved copy of one package in the lockfile, with the path it sits at. */
function resolved(name: string): { where: string; version: string }[] {
  return Object.entries(lock.packages as Record<string, { version?: string }>)
    .filter(([where]) => where.split("node_modules/").pop() === name)
    .map(([where, entry]) => ({ where, version: entry.version ?? "" }))
    .filter((entry) => entry.version !== "");
}

describe("the esbuild override", () => {
  it("is still there — drizzle-kit's chain reaches back into 0.18 without it", () => {
    expect(pkg.overrides?.esbuild).toBeTruthy();
  });

  it("is a floor, not a pin — a caret range is what printed ERESOLVE at every install", () => {
    const range: string = pkg.overrides.esbuild;
    const floor = floorOf(range);
    expect(
      floor,
      `overrides.esbuild is "${range}". It has to be a floor (">=x.y.z"): vite and tsx ` +
        `ask for ^0.28, and a caret or exact range makes npm print ERESOLVE on every ` +
        `install and leaves the tree invalid. See the header of this file.`,
    ).not.toBeNull();
    expect(
      atLeast(floor as string, ESBUILD_FLOOR),
      `the floor is ${floor}, below ${ESBUILD_FLOOR} — the dev-server CVE ` +
        `(GHSA-67mh-4wv8-2f99) is what the override is for.`,
    ).toBe(true);
  });

  it("permits every copy the lockfile actually resolved", () => {
    // No fallback when the range is not a floor: a copy outside the declared
    // override is what npm calls `invalid`, and checking it against a guessed
    // floor instead would report a healthy tree while npm reports a broken one.
    const floor = floorOf(pkg.overrides.esbuild);
    expect(
      floor,
      `overrides.esbuild is "${pkg.overrides.esbuild}", so what it admits cannot be ` +
        `checked against the lockfile here. Make it a floor (">=x.y.z").`,
    ).not.toBeNull();
    const copies = resolved("esbuild");
    expect(copies.length).toBeGreaterThan(0);
    for (const { where, version } of copies) {
      expect(
        atLeast(version, floor as string),
        `${where} resolved esbuild@${version}, below the override's floor ${floor}. ` +
          `npm would report this as "invalid" — regenerate package-lock.json.`,
      ).toBe(true);
    }
  });
});

describe("brace-expansion", () => {
  it("carries the expansion cap in every copy the lockfile resolved", () => {
    const copies = resolved("brace-expansion");
    expect(copies.length).toBeGreaterThan(0);
    for (const { where, version } of copies) {
      const major = String(triple(version)[0]);
      const floor = BRACE_EXPANSION_FLOORS[major];
      expect(
        floor,
        `${where} resolved brace-expansion@${version}, and nobody has measured ` +
          `whether ${major}.x caps its expansion. Check it against a brace bomb and ` +
          `add the floor to BRACE_EXPANSION_FLOORS.`,
      ).toBeTruthy();
      expect(
        atLeast(version, floor),
        `${where} resolved brace-expansion@${version}, below ${floor} — that version ` +
          `dies of an out-of-memory crash on a brace bomb (GHSA-mh99-v99m-4gvg). ` +
          `Regenerate package-lock.json.`,
      ).toBe(true);
    }
  });
});

describe("the overrides that hold a named advisory out of the tree", () => {
  it("resolved every copy at or above the version the reason names", () => {
    for (const [name, { floor, advisory }] of Object.entries(ADVISORY_FLOORS)) {
      expect(
        pkg.overrides?.[name],
        `overrides.${name} is gone. It is there for ${advisory} — read section 1b/1c ` +
          `of this file's header before deciding it is noise.`,
      ).toBeTruthy();

      const copies = resolved(name);
      // Non-vacuity: a package that has left the tree entirely would make the
      // loop below pass by having nothing to iterate.
      expect(copies.length, `nothing in the lockfile resolves ${name} any more`).toBeGreaterThan(0);
      for (const { where, version } of copies) {
        expect(
          atLeast(version, floor),
          `${where} resolved ${name}@${version}, below ${floor} — ${advisory}. ` +
            `Regenerate package-lock.json.`,
        ).toBe(true);
      }
    }
  });
});

describe("the deprecation warnings a first install prints", () => {
  it("is somebody else's chain — nothing here asks for @esbuild-kit itself", () => {
    for (const name of DEPRECATED_TRANSITIVES) {
      // Allowed askers: drizzle-kit, and the pair asking for each other. Anything
      // else — this project, or a second package — is a new question, not the one
      // docs/troubleshooting.md tells the reader to ignore.
      const allowed = new Set([DEPRECATED_VIA, ...DEPRECATED_TRANSITIVES]);
      const strangers = requestedBy(name)
        .map(packageNameAt)
        .filter((asker) => !allowed.has(asker));
      expect(
        strangers,
        `${name} is deprecated, and ${strangers.map((s) => s || "this project").join(", ")} ` +
          `now asks for it. Until today the answer to that warning was "not ours, ` +
          `nothing to do" (docs/troubleshooting.md → What the first install prints). ` +
          `That answer no longer covers this one — judge it, then either move off it ` +
          `or say here why it stays.`,
      ).toEqual([]);
    }
  });
});

// The old name of this block was "the audit findings that stay", which was a
// claim about what `npm audit` reports rather than a description of what is
// asserted below — and it stopped being true: this tree answers
// `found 0 vulnerabilities`, and section 3 of the header already says so. The
// assertion is unchanged; only the sentence describing it moved. 🚨 No fixed
// count of advisories belongs anywhere here, in code or in prose.
describe("the two packages that may never be overridden", () => {
  it("is not silenced with an override that breaks the linter", () => {
    for (const name of NEVER_OVERRIDE) {
      expect(
        pkg.overrides?.[name],
        `overrides.${name} is set. It makes "npm audit" read clean and makes ` +
          `eslint-plugin-react/import/jsx-a11y throw "minimatch is not a function" ` +
          `on any rule that matches a pattern — while this project's own lint stays ` +
          `green, so it ships as a landmine. Whatever it silences is dev-only ` +
          `anyway; "npm audit --omit=dev" is what decides whether something ` +
          `ships. See the header of this file.`,
      ).toBeUndefined();
    }
  });
});
