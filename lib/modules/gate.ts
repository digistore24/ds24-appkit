// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// A module's off-state, enforced in front of the router.
//
// A module that is INSTALLED can still be switched off, and off has to be
// indistinguishable from never built. A `notFound()` thrown inside a page
// renders the not-found boundary wrapped in the dashboard layout — sidebar and
// all — while a route that never existed renders the bare root not-found. Those
// two documents differing is what lets a probing member tell "switched off"
// from "never built", so the refusal happens in `proxy.ts`, where the document
// is still whole.
//
// (A module that is NOT INSTALLED needs none of this: its route files carry a
// module suffix and Next builds no route for them at all — see
// `scripts/modules/page-extensions.mjs`. The gate is for the installed-but-off
// state, which is the only one left.)
//
// ── What a gate may import ─────────────────────────────────────────────────
// `proxy.ts` runs in front of EVERY matched request. Since Next 16 it runs in
// the Node runtime, so edge-purity is no longer a platform requirement — but
// the discipline stands and the file says why: "a Postgres import here would
// put the whole database layer in front of every request."
//
// So a gate reads its own bundled config JSON and nothing else. That is the
// same import profile `lib/community/config.ts` already has — one import, its
// own JSON — and it is what `modules/boundary.test.ts` holds it to. The guard
// is named for what it actually protects, not for a platform rule that does not
// exist: **no database in front of every request.**

/**
 * What a module's switch says about it right now.
 *
 * 🚨 **Three states, not two, and collapsing them to a boolean is a shipped
 * bug rather than a hypothetical one.** The two callers want different lines
 * through this:
 *
 * | | `proxy.ts` rewrites | the assistant may NAME its menu entries |
 * |---|---|---|
 * | `"on"` | no | yes |
 * | `"broken"` | **no** | **no** |
 * | `"off"` | yes | no |
 *
 * `"broken"` is the row that has no boolean. It is *switched on but the config
 * does not parse* — the module cannot serve, so its pages refuse and its menu
 * entries hide; but the operator needs ONE door left open, the diagnosis page
 * that names the bad value, because nothing else in a deployed app will.
 * `proxy.ts` says so in its own comment and `docs/community.md` promises that
 * page by name.
 *
 * When this was one `enabled()`, the community answered its
 * `enabled && no problems` and the proxy rewrote the broken state away with
 * the off state. An operator with one mistyped key got `module list` reporting
 * the switch as ON, every page answering 404, and the page whose whole job is
 * to name the typo gone with the rest.
 *
 * ⚠️ A module with no malformed-config state simply never returns `"broken"`.
 * It still says so explicitly rather than inheriting a default, because which
 * of these three a doubt falls to is the decision, and a default is where a
 * decision goes to hide.
 */
export type ModuleState = "on" | "broken" | "off";

export interface ModuleGate {
  /** The module id — only ever used to name the rewrite target. */
  readonly id: string;

  /**
   * What this module's switch says, right now.
   *
   * Read per request from the bundled config, never cached in a session or a
   * module-scope variable: the answer is a property of the deployed build, and
   * a cached one would survive the deploy that was meant to be the incident
   * response.
   *
   * 🚨 **Only `"off"` earns the rewrite**, and the rewrite is not a refusal a
   * page can soften — it sends the request to an unmatched path, so nothing
   * behind this gate is reachable, the operator's own diagnosis included. Read
   * `ModuleState` above before deciding what a new module returns here.
   *
   * The trade `"broken"` accepts, stated once: an in-page `notFound()` renders
   * the layout-wrapped, distinguishable document, so a probing member can tell
   * that state from never-built. A config an operator is in the middle of
   * fixing is worth that. The kill switch is not, and it still gets the
   * indistinguishable answer.
   */
  state(): ModuleState;

  /**
   * Does this DECODED path belong to the module's routes?
   *
   * Decoded, because the router matches that way: `/dashboard/%63ommunity`
   * reaches the community page, and a literal compare would let it slip past
   * the rewrite into the page's own `notFound()` — the layout-wrapped,
   * distinguishable document, one percent-escape away.
   */
  covers(decodedPathname: string): boolean;
}

/**
 * A `covers` built from the route subtrees a module declares.
 *
 * ⚠️ **Use this rather than writing the comparison by hand.** The community's
 * hand-written version covered `/dashboard/community` and missed
 * `/dashboard/admin/community` — the operator's tree fell through to its own
 * in-page `notFound()`, the distinguishable document the whole mechanism exists
 * to avoid, and that page's `notFound()` runs BEFORE its `requireOwner()`, so
 * any signed-in member could read the difference. Nothing compared the admin
 * path; the property was claimed in `CLAUDE.md` and enforced on one of two
 * routes.
 *
 * A module's subtrees come from its manifest's `app` list, so the set that is
 * BUILT and the set that is GUARDED have one source.
 *
 * @param subtrees e.g. `["dashboard/community", "dashboard/admin/community"]`
 */
export function coversSubtrees(subtrees: readonly string[]): (path: string) => boolean {
  const roots = subtrees.map((sub) => (sub.startsWith("/") ? sub : `/${sub}`));
  return (path: string) =>
    roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Which of a module's declared route subtrees a gate is answerable for.
 *
 * 🚨 A gate cannot READ its module's manifest — everything in this closure runs
 * in front of every matched request, so there is no `fs` here and never will be.
 * The list handed to `coversSubtrees()` is therefore written out by hand in the
 * module's own `gate.ts`, and the manifest is the source only in the sense that
 * a TEST holds the copy to it (`scripts/modules/gate.test.ts` for an installed
 * module, `scripts/modules/profiles.test.ts` for all four without installing
 * any). This function is what both of them compare against, so "which subtrees
 * count" is written down once.
 *
 * ⚠️ `api/…` subtrees are excluded, and that is not a convenience. `proxy.ts`'s
 * matcher is `["/dashboard/:path*", "/login", "/", "/plans", "/optin/:path*"]`,
 * read out of the AST at build time and impossible to compute — so the proxy
 * never runs for an `api/` route, and a gate covering one would be dead code
 * that looks like a guarantee. Those handlers refuse for themselves, which is
 * what a module states in `publicRoutes` and what `guard-presence.test.ts`
 * measures for `api/v1`.
 *
 * @param app a manifest's `app` list, as the manifest writes it (no leading slash)
 */
export function guardableSubtrees(app: readonly string[]): string[] {
  return app.filter((subtree) => subtree.startsWith("dashboard/"));
}
