// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every route has a decided answer to "who may reach this" — enforced
// structurally, not by review.
//
// Protection in this app is OPT-IN: `proxy.ts` matches `/dashboard/:path*` and
// `authorized()` in `auth.config.ts` returns true for every other path. So a
// new page or handler is PUBLIC the moment it exists, and stays public until
// somebody remembers three things (the matcher, the `/dashboard` prefix
// decision in `proxy()`, and `authorized()`). CLAUDE.md warns about this louder
// than about anything else — and until this file existed, the warning was all
// there was: `proxy.test.ts` pins that `/dashboard` is guarded,
// `app/api/v1/guard-presence.test.ts` pins that every v1 handler guards itself,
// and NOBODY looked at the rest of the tree.
//
// This test does not protect anything. It forces a DECISION, once per route:
// either the route lives under `/dashboard` — then the proxy and `authorized()`
// answer for it — or it is named in PUBLIC below with the sentence saying what
// guards it instead. A route in neither place fails the build, with its path.
//
// The entries below were not copied out of anybody's memory: each one was read
// once, and every handler on this surface states its own protection in its
// header. Where a header and this list ever disagree, the handler is the truth
// and this line is the bug.
//
// Two things this test deliberately does NOT do:
//   - it does not check `app/api/v1/**` (guard-presence.test.ts does, better:
//     it reads the handler rather than trusting a list),
//   - it does not verify that a guard WORKS. That is the handler's own
//     colocated test. This one only asks whether anybody decided.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { modulePublicRoutes } from "@/scripts/modules/inventory.mjs";
import { installedModules } from "@/scripts/modules/installed.mjs";
import { modulePageExtensions } from "@/scripts/modules/page-extensions.mjs";

const APP = import.meta.dirname;

/**
 * The public surface, and what guards each one instead of a session.
 *
 * Adding a line here is a decision, and it is meant to be cheap — it is the
 * alternative to leaving a route unconsidered, not a punishment. What it is
 * NOT is a place to park something that ought to be protected: the reason has
 * to name a mechanism, and "TODO" is not one.
 */
const PUBLIC: Record<string, string> = {
  // ── Pages ────────────────────────────────────────────────────────────────
  "/": "the salespage — the whole point is that a stranger reads it",
  "/login": "the sign-in page itself",
  "/plans": "a visitor may buy without an account; the purchase attaches on first sign-in",
  "/impressum": "legally required to be reachable without an account",
  "/datenschutz": "legally required to be reachable without an account",
  "/ds24-connected":
    "the return_url of `node run.mjs ds24-connect`; carries no part of the mechanism and never sees the API key",
  "/optin/[orderId]":
    "where Digistore24 sends the buyer after paying — they routinely have no account yet",
  "/account/confirm-email":
    "authenticated by its single-use, expiring token; the mail is read on whichever device holds the new mailbox, routinely not the signed-in one",

  // ── Handlers outside app/api/v1 ──────────────────────────────────────────
  "/api/auth/[...nextauth]": "Auth.js itself — the sign-in machinery",
  "/api/ipn": "SHA512 signature over the payload, checked first and at the edge; fails closed without a passphrase",
  "/api/cron": "Bearer CRON_SECRET, constant-time compare; refuses to run at all when the secret is unset",
  "/api/diagnostics/errors":
    "Bearer DIAGNOSTICS_SECRET, constant-time compare; 404 with an empty body when the secret is unset, absent or wrong — indistinguishable from a route that was never built",
  "/api/diagnostics/health":
    "Bearer DIAGNOSTICS_SECRET, constant-time compare; 404 with an empty body when the secret is unset, absent or wrong — indistinguishable from a route that was never built",
  // The one diagnostics door that SPENDS: `node run.mjs ai-check --live` asks it
  // for one real model call. Same bearer and same silent 404 as its two
  // neighbours, plus a meter of its own on successful calls — the failure mode
  // here is a loop holding a valid secret, not somebody guessing one.
  "/api/diagnostics/ai":
    "Bearer DIAGNOSTICS_SECRET, constant-time compare, before any model call; 404 with an empty body when the secret is unset, absent or wrong — plus a spend meter per caller",
  "/api/chat": "currentActiveUser() in the handler — 401 for anonymous and blocked alike",
  // The setup surface's two doors. Neither has a session and neither can have
  // one: the caller is the operator's coding agent over MCP, not a browser.
  // Both go through `runSetupCall()`, whose first act is `guardSetup()` — and
  // `lib/setup/guard-presence.test.ts` proves that chain rather than trusting
  // these two lines. While `config/setup.json` is off — the shipped state —
  // both answer 404 with no body at all, so a fresh app gives a stranger
  // nothing to tell "off" from "never built".
  "/api/setup":
    "runSetupCall() → guardSetup(): switch (404 when off) → APP_ENV set → environment claim matches the app's own → ds24setup_ key by prefix, then by hash → owner role re-read from the database at the moment of the act",
  "/api/setup/media":
    "the same guard and the same sequence; the bytes are the only difference, and guardUploadEntry() runs before a single one is stored",
  // ⚠️ `/api/community/live` was HERE, hand-written, and its removal is the
  // entry worth reading twice. It was added while the community was core, and
  // it survived the move into `modules/community/` because the walk below
  // counted an UNINSTALLED module's route files as routes — so the main sweep
  // kept demanding a decision about a route no app had, and this line kept
  // supplying one. The community's manifest declares that route and its reason
  // (`modulePublicRoutes()` merges it below), so while the module is installed
  // nothing is lost; while it is not, the route does not exist and the core has
  // stopped claiming otherwise.
  "/api/media": "currentActiveUser() in the handler — 401 for anonymous and blocked alike",
  // The two halves of the direct-to-bucket path. Both prove the session first,
  // exactly like `/api/media` above; what differs is which outer guard follows.
  "/api/media/upload-url":
    "currentActiveUser() in the handler, then guardUploadEntry() — switch, store health and the hourly slot, spent HERE because an address handed out is what the ceiling protects",
  "/api/media/confirm":
    "currentActiveUser() in the handler, then guardUploadConfirm() — the same switch and store check without the meter, because the slot was already spent when the address was minted; the ticket is bound to its owner and an unknown, expired or foreign one is one 404",
  "/api/media/[id]":
    "currentActiveUser() via deliverMedia's viewerFor, asked only for non-public items",
  "/api/knowledge-media/[...path]":
    "currentActiveUser() first, then the path grammar; every refusal is a 404 so existence cannot be mapped",
  "/api/account/export":
    "currentActiveUser(), and the member id comes from the session and from nowhere else — a parameter here would be the app's worst IDOR",
  "/api/healthz": "liveness — no data, no dependencies, deliberately reachable",
  "/api/readyz": "readiness — answers only whether the database responds",
};

// Plus the public routes an installed module declares. A module's manifest
// carries the same thing this list does — a url and the sentence naming what
// guards it instead — and `scripts/modules/manifest.mjs` holds it to the same
// bar (a real sentence, no "TODO").
//
// Merged rather than hand-copied, because the alternative is this file growing
// an entry for a route it cannot see: a module's routes exist only while it is
// installed, so a hard-coded line here would be dead in every app that declined
// it, and the "PUBLIC names a route that does not exist" check below would fire
// on a healthy app.
for (const { url, reason } of modulePublicRoutes()) PUBLIC[url] = reason;

/** Route groups `(marketing)` and parallel-route slots `@modal` are not in the URL. */
function isInvisibleSegment(segment: string): boolean {
  return (segment.startsWith("(") && segment.endsWith(")")) || segment.startsWith("@");
}

/** `app/optin/[orderId]/page.tsx` → `/optin/[orderId]`, `app/page.tsx` → `/`. */
function routePath(file: string): string {
  const segments = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment !== "" && !isInvisibleSegment(segment));
  return "/" + segments.join("/");
}

/**
 * Is this file a route?
 *
 * 🚨 **Not only `page.tsx` / `route.ts`.** An INSTALLED module's routes are
 * named `page.<id>.tsx` / `route.<id>.ts` and live here too, because Next scans
 * `app/` and nothing else (`scripts/modules/page-extensions.mjs`). A walk that
 * matched the two core names exactly would not see them — and a module could
 * then open a public route that nothing in this repo ever decided on, which is
 * precisely the failure this file exists to prevent.
 *
 * ⚠️ **INSTALLED, and the word is load-bearing.** This used to accept any
 * module-shaped suffix, which reads as caution and is the opposite: a suffix is
 * a route exactly while its module is in `pageExtensions`, so an uninstalled
 * module's file was being counted as a route that no app serves. The main sweep
 * then demanded a decision about it, the honesty check below could not see that
 * the decision was decoration, and the two together kept a hand-written
 * `/api/community/live` line alive in the CORE's list for every app that never
 * installed the community. Derived from the same function `next.config.ts`
 * uses, so the two answers cannot drift.
 */
const ROUTE_NAMES = new Set(
  modulePageExtensions(installedModules()).flatMap((ext) => [`page.${ext}`, `route.${ext}`]),
);

const isRouteFile = (name: string) => ROUTE_NAMES.has(name);

/**
 * Every route file under `app/`.
 *
 * `skipV1` is the subtree `guard-presence.test.ts` owns, and it asks the better
 * question there: not "did somebody decide" but "does the handler call
 * `guardApi()`". The honesty check below walks WITHOUT the skip, because a
 * PUBLIC entry covering that subtree still has to name something real.
 */
function routeFiles(dir: string, skipV1: boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipV1 && path.relative(APP, full).split(path.sep).join("/") === "api/v1") continue;
      routeFiles(full, skipV1, found);
    } else if (isRouteFile(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const routes = routeFiles(APP, true)
  .map((file) => ({ file, url: routePath(file) }))
  .sort((a, b) => a.url.localeCompare(b.url));

/** Including the subtree the sweep above skips — only the honesty check uses it. */
const everyRouteUrl = new Set(routeFiles(APP, false).map((file) => routePath(file)));

/** What a developer has to do about a route nobody has decided on. */
function verdict(url: string): string {
  return [
    `${url} is reachable by anybody, and nothing in this repo says that was intended.`,
    "",
    "Protection here is opt-in — a new route is PUBLIC until you change that. Two ways out:",
    "",
    "  1. It should require a session → move it under /dashboard, or teach all three:",
    "     the path in the `matcher` in proxy.ts, the prefix decision in `proxy()`,",
    "     and `authorized()` in auth.config.ts. The matcher alone protects NOTHING.",
    "  2. It is public on purpose, or it guards itself (a signature, a bearer token,",
    "     a session check in the handler) → add it to PUBLIC in this file, with the",
    "     sentence naming what guards it.",
    "",
    "See CLAUDE.md → Rules, first bullet.",
  ].join("\n");
}

describe("every route has a decided answer to who may reach it", () => {
  it("actually finds the routes, so an empty sweep means something", () => {
    // Non-vacuity: a broken walk must not go green by checking nothing.
    expect(routes.length).toBeGreaterThanOrEqual(25);
    expect(routes.map((route) => route.url)).toContain("/dashboard");
    expect(routes.map((route) => route.url)).toContain("/api/ipn");
  });

  for (const route of routes) {
    // /dashboard/** is answered by the proxy prefix decision plus authorized().
    // That those two still hold is proxy.test.ts's job, not this file's.
    if (route.url === "/dashboard" || route.url.startsWith("/dashboard/")) continue;

    it(`${route.url} is a decided public route`, () => {
      expect(PUBLIC[route.url], verdict(route.url)).toBeTruthy();
    });
  }

  it("keeps the list honest — every entry names an existing route", () => {
    for (const url of Object.keys(PUBLIC)) {
      // A module declares a whole subtree at once — `"/api/v1/*"` — because its
      // handlers are one surface with one answer, and listing ten of them would
      // be ten places to forget the eleventh. Honest means: something is really
      // there. An empty subtree is exactly the decoration this check refuses.
      const honest = url.endsWith("/*")
        ? [...everyRouteUrl].some((existing) => existing.startsWith(url.slice(0, -1)))
        : everyRouteUrl.has(url);
      expect(
        honest,
        `PUBLIC names "${url}", which is no route in this app — a list nobody prunes becomes decoration, and the next reader trusts it.`,
      ).toBe(true);
    }
  });

  it("keeps the reasons honest — a reason names a mechanism", () => {
    for (const [url, reason] of Object.entries(PUBLIC)) {
      expect(
        reason.length > 20 && !/^(todo|tbd|later|fixme)/i.test(reason.trim()),
        `PUBLIC["${url}"] has no real reason. An unfinished decision is the state this file exists to catch — protect the route or say what guards it.`,
      ).toBe(true);
    }
  });

  it("the opt-in rule itself is still what this test assumes", () => {
    // If somebody ever flips protection to opt-out, the sweep above turns into
    // theatre: every route would be safe and this file would still be nodding
    // along. So it reads the two places the rule lives and fails loudly instead.
    const authConfig = readFileSync(path.join(APP, "..", "auth.config.ts"), "utf8");
    expect(
      /path\.startsWith\("\/dashboard"\)/.test(authConfig),
      "auth.config.ts no longer decides on the /dashboard prefix — this test's whole classification is built on that. Re-read it before adjusting.",
    ).toBe(true);
    expect(
      /return true;/.test(authConfig),
      "authorized() no longer falls through to public — if protection became opt-out, PUBLIC above is asking the wrong question.",
    ).toBe(true);
  });
});
