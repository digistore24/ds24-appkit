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
// 🚨 **Since 2026-09-15 it reads the WHOLE of `app/` and `modules/`, not two
// directories.** Measured: eleven `"use server"` files sat outside the two
// surfaces named here — `app/dashboard/{account,billing,chat}/actions.ts`,
// `app/plans/actions.ts`, `modules/{api,activity,companion}/actions.ts`, the
// courses module — every one of them guarded, and a new unguarded file beside
// them would have been red in no gate at all. The actions that are public BY
// DECISION are a table below (`PUBLIC`), each with the sentence that makes it
// one; a stale row in that table is itself a failure.
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
 * one of them, which stage 2 checks — for EVERY definition of the name, since
 * `guard` and `actor` are defined more than once across the tree.
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
  // The courses module's lesson seam: `viewer()` first, then lesson → block →
  // course → the entitlement gate (modules/courses/pages/actions.ts).
  "unitInCourse",
  // Two domain calls that ARE the action's first act and open with
  // `requireActiveUser()` themselves — lib/users/manage.ts, lib/consent/manage.ts.
  "deleteOwnAccount",
  "recordConsent",
];

/** What an opener has to reach, one way or another. */
const AUTHORITIES = ["requireOwner", "requireActiveUser", "currentActiveUser"];

/**
 * Awaits that touch no data and decide nothing — skipped when looking for the
 * first real act. A dynamic `import()` is how a few actions keep a heavy module
 * out of the client bundle; `getTranslations`/`getLocale` read the request's
 * language. None of the three is a place a guard could be missing FROM: the
 * question is what the action does with the first thing it touches.
 */
const INERT = ["import", "getTranslations", "getLocale"];

/**
 * 🚨 The actions that are public BY DECISION — a table of human judgements,
 * each with the sentence that makes it one. Not "unguarded": each either has
 * no session to guard (sign-in) or reads its own session inline and acts only
 * on the caller's own token. A row here whose action no longer exists is a
 * failure, so the table cannot outlive what it excuses.
 */
const PUBLIC: Record<string, string> = {
  "app/login/actions.ts:signInAction": "the sign-in itself — there is no session yet to guard",
  "app/login/actions.ts:googleSignInAction": "the sign-in itself — there is no session yet to guard",
  "app/plans/actions.ts:startCheckoutAction":
    "reads auth() inline and redirects an anonymous caller to /login before any product is looked up",
  "app/impersonation-actions.ts:stopImpersonationAction":
    "reads auth() inline; acts only on the CALLER's own token and refuses when it carries no impersonation",
  "app/impersonation-actions.ts:clearEndedImpersonationAction":
    "acts only on the caller's own token (unstable_update is a no-op without a session); nothing is read or written",
};

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

/**
 * Every exported action, with the text that follows it — both spellings,
 * `export async function name(` and `export const name = async (`.
 */
function actionsIn(source: string): { name: string; body: string }[] {
  const heads = [...source.matchAll(/export\s+(?:async\s+function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*async\b)/g)];
  return heads.map((head, i) => {
    const from = head.index! + head[0].length;
    const to = heads[i + 1]?.index ?? source.length;
    return { name: (head[1] ?? head[2])!, body: source.slice(from, to) };
  });
}

/** The base name of the first thing this body awaits that is not inert, or null. */
function firstAwait(body: string): string | null {
  for (const match of body.matchAll(/await\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const name = match[1]!.split(".")[0]!;
    if (!INERT.includes(name)) return name;
  }
  return null;
}

/**
 * The one decision, as a function of the text — so it can be probed with a
 * planted defect below and pointed at the tree above.
 *
 * `publicNames` are `path:name` keys already decided to be public.
 */
function unguardedIn(files: ServerFile[], publicNames: readonly string[]): string[] {
  return files
    .flatMap((file) => actionsIn(file.source).map((action) => ({ ...action, path: file.path })))
    .filter((action) => !publicNames.includes(`${relative(ROOT, action.path)}:${action.name}`))
    .filter((action) => {
      const opener = firstAwait(action.body);
      return opener === null || !OPENERS.includes(opener);
    })
    .map(
      (action) =>
        `${relative(ROOT, action.path)}:${action.name} (${firstAwait(action.body) ?? "nothing awaited"})`,
    );
}

const SURFACES = [
  // Floors, never equalities: a walk that found NOTHING must be a failure.
  { dir: "app", minFiles: 8, minActions: 20 },
  { dir: "modules", minFiles: 12, minActions: 35 },
];

describe.each(SURFACES)("$dir — every action opens with a guard", ({ dir, minFiles, minActions }) => {
  const files = serverFiles(dir);
  const all = files.flatMap((file) => actionsIn(file.source).map((action) => ({ ...action, path: file.path })));

  it("🚨 found the surface at all", () => {
    // The count guard. A walk that collapsed reports zero offenders and looks
    // exactly like a clean tree — the failure this file exists to prevent,
    // turned on itself.
    expect(files.length, `no "use server" files under ${dir}`).toBeGreaterThanOrEqual(minFiles);
    expect(all.length, `no exported actions under ${dir}`).toBeGreaterThanOrEqual(minActions);
  });

  it("every exported action's first real await is an opener — or the action is in PUBLIC, with its reason", () => {
    expect(
      unguardedIn(files, Object.keys(PUBLIC)),
      "an exported Server Action does not open with a guard. A Server Action is a " +
        "public HTTP endpoint: either open it with one of OPENERS, or — if a new " +
        "opener is genuinely right — add it to OPENERS and make sure stage 2 below " +
        "can see it authorise something. An action that is public BY DECISION goes " +
        "into PUBLIC with the sentence that makes it one.",
    ).toEqual([]);
  });
});

describe("the PUBLIC table cannot outlive what it excuses", () => {
  const known = new Set(
    [...serverFiles("app"), ...serverFiles("modules")].flatMap((file) =>
      actionsIn(file.source).map((action) => `${relative(ROOT, file.path)}:${action.name}`),
    ),
  );

  it.each(Object.entries(PUBLIC))("%s still exists, and says why it is public", (key, reason) => {
    expect(known.has(key), `${key} is in PUBLIC but no such action exists — remove the row`).toBe(true);
    expect(reason.length, "a public action carries its reason").toBeGreaterThan(20);
  });

  it("no row excuses an action that is guarded anyway — a guard that is there is not a decision to skip one", () => {
    const files = [...serverFiles("app"), ...serverFiles("modules")];
    const flaggedWithoutTable = new Set(unguardedIn(files, []).map((line) => line.slice(0, line.indexOf(" ("))));
    for (const key of Object.keys(PUBLIC)) {
      expect(flaggedWithoutTable.has(key), `${key} opens with a guard — it does not belong in PUBLIC`).toBe(true);
    }
  });
});

describe("🚨 the needle — the classifier goes red on a planted defect", () => {
  const file = (source: string): ServerFile => ({ path: join(ROOT, "app/probe/actions.ts"), source: blankComments(source) });

  it("flags an action whose first real await is not an opener", () => {
    const flagged = unguardedIn(
      [file(`"use server";\nexport async function leakAction(id: string) {\n  const rows = await db.select().from(users);\n  return rows;\n}\n`)],
      [],
    );
    expect(flagged).toEqual(["app/probe/actions.ts:leakAction (db)"]);
  });

  it("flags an action that awaits nothing at all", () => {
    const flagged = unguardedIn([file(`"use server";\nexport async function nothingAction() {\n  return 1;\n}\n`)], []);
    expect(flagged).toEqual(["app/probe/actions.ts:nothingAction (nothing awaited)"]);
  });

  it("flags the arrow spelling too", () => {
    const flagged = unguardedIn(
      [file(`"use server";\nexport const arrowAction = async (id: string) => {\n  await db.delete(users);\n};\n`)],
      [],
    );
    expect(flagged).toEqual(["app/probe/actions.ts:arrowAction (db)"]);
  });

  it("🚨 a guard that lives only in a comment is no guard", () => {
    const flagged = unguardedIn(
      [file(`"use server";\n// await requireOwner() used to be here\nexport async function ghostAction() {\n  await db.delete(users);\n}\n`)],
      [],
    );
    expect(flagged).toHaveLength(1);
  });

  it("an inert await before the opener is fine; an inert await before a data call is not", () => {
    const guarded = file(
      `"use server";\nexport async function okAction() {\n  const t = await getTranslations("x");\n  const { helper } = await import("@/lib/x");\n  const session = await requireActiveUser();\n  return t("done");\n}\n`,
    );
    expect(unguardedIn([guarded], [])).toEqual([]);

    const notGuarded = file(
      `"use server";\nexport async function badAction() {\n  const t = await getTranslations("x");\n  await db.insert(users).values({});\n  return t("done");\n}\n`,
    );
    expect(unguardedIn([notGuarded], [])).toEqual(["app/probe/actions.ts:badAction (db)"]);
  });

  it("a PUBLIC row silences exactly its own action and nothing else", () => {
    const two = file(
      `"use server";\nexport async function publicAction() {\n  await signIn("x");\n}\nexport async function otherAction() {\n  await db.delete(users);\n}\n`,
    );
    expect(unguardedIn([two], ["app/probe/actions.ts:publicAction"])).toEqual([
      "app/probe/actions.ts:otherAction (db)",
    ]);
  });
});

describe("🚨 stage 2 — and each opener really authorises, in EVERY place it is defined", () => {
  // Without this half, OPENERS is a list anybody can write themselves into.
  // Every opener is defined in the two surfaces, in the community module's
  // `lib/`, or in the two core files named — all of which are read here, so no
  // import resolution is needed.
  const HAYSTACK = [
    ...sourcesIn(join(ROOT, "app")),
    ...sourcesIn(join(ROOT, "modules")),
    join(ROOT, "lib/authz.ts"),
    join(ROOT, "lib/users/manage.ts"),
    join(ROOT, "lib/consent/manage.ts"),
  ].map((path) => ({ path, source: blankComments(readFileSync(path, "utf8")) }));

  it("has sources to look in", () => {
    expect(HAYSTACK.length, "stage 2 found no files").toBeGreaterThan(10);
  });

  /**
   * The body of EVERY top-level declaration of `name`, with its file.
   *
   * ⚠️ Anchored to the start of a LINE. Without that, `const viewer = { … }`
   * inside some unrelated function matches first and stage 2 reads a local
   * variable instead of the opener — measured while writing this, on
   * `modules/community/lib/reports.ts`.
   *
   * ⚠️ EVERY definition, not the first. `guard()` is defined in the community
   * module AND in the courses module, `actor()` three times; a second
   * definition that lost its guard used to pass because the first one was read.
   */
  function definitionsOf(name: string): { path: string; body: string }[] {
    const declaration = new RegExp(
      `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(|^(?:export\\s+)?const\\s+${name}\\s*=`,
      "gm",
    );
    const found: { path: string; body: string }[] = [];
    for (const { path, source } of HAYSTACK) {
      for (const match of source.matchAll(declaration)) {
        const from = match.index!;
        const next = source.indexOf("\nexport ", from + 1);
        found.push({ path, body: source.slice(from, next === -1 ? from + 2000 : next) });
      }
    }
    return found;
  }

  /**
   * Does this definition reach an authority — directly, or through ONE other
   * opener that does in every one of ITS definitions?
   *
   * The indirection is real and not a loophole: `dmViewer()` is one line,
   * `return requireDmActor()`, and `requireDmActor()` is the DM seam that reads
   * `currentActiveUser()`. Refusing that would push the test towards a list of
   * exceptions, which is the thing stage 2 exists to avoid. It is bounded to
   * one hop and every hop must itself be a NAMED opener, so nothing can be
   * laundered through an anonymous helper.
   */
  function reachesAuthority(body: string, seen = new Set<string>()): boolean {
    if (AUTHORITIES.some((authority) => new RegExp(`\\b${authority}\\s*\\(`).test(body))) return true;
    return OPENERS.some((other) => {
      if (seen.has(other) || AUTHORITIES.includes(other)) return false;
      if (!new RegExp(`\\b${other}\\s*\\(`).test(body)) return false;
      const definitions = definitionsOf(other);
      return (
        definitions.length > 0 &&
        definitions.every((d) => reachesAuthority(d.body, new Set([...seen, other])))
      );
    });
  }

  it.each(OPENERS.filter((name) => !AUTHORITIES.includes(name)))(
    "%s reaches one of the three authorities in every definition",
    (opener) => {
      const definitions = definitionsOf(opener);
      expect(
        definitions.length,
        `${opener} is in OPENERS but is defined nowhere these surfaces can see`,
      ).toBeGreaterThan(0);
      for (const { path, body } of definitions) {
        expect(
          reachesAuthority(body, new Set([opener])),
          `${opener} in ${relative(ROOT, path)} guards nothing — it is in OPENERS but reaches no authority`,
        ).toBe(true);
      }
    },
  );

  it("🚨 the needle — a definition that names an authority only in a string is not one", () => {
    const seen = () => new Set(["actor"]);
    expect(reachesAuthority(`function actor() { return "requireOwner"; }`, seen())).toBe(false);
    expect(reachesAuthority(`function actor() { const requireOwner = 1; return requireOwner; }`, seen())).toBe(false);
    expect(reachesAuthority(`async function actor() { return requireOwner(); }`, seen())).toBe(true);
    // …and one hop through a named opener counts, an unnamed helper does not.
    expect(reachesAuthority(`async function actor() { return guardAsOperator(); }`, seen())).toBe(true);
    expect(reachesAuthority(`async function actor() { return someHelper(); }`, seen())).toBe(false);
  });
});
