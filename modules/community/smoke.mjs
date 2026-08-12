// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// ── The community-off assertion (AD-67) ─────────────────────────────────────
//
// This module's `smoke` claim: with the community disabled, `/dashboard/community`
// must be indistinguishable from a route that NEVER existed — same 404, same
// not-found document — for a signed-in visitor, who is the only one who gets
// past the login redirect.
//
// This is the OPPOSITE claim from smoke's own verdict table, where "answered
// with a 4xx" counts as a pass: here 404 is the demanded answer, and it is
// asserted against a pre-module baseline rather than against the framework's
// wording.
//
// **How it is reached.** `module.json` names this file under `smoke`, and
// `runModuleSmoke()` calls the exported `assert(context)` at the end of the
// signed-in pass. Nothing in the core names it — that is the point. It was once
// `scripts/dev/smoke-community.mjs`, imported by name from the sweep, and it had
// grown to roughly 180 of that script's 425 lines: the tool every customer runs
// to answer "is my app broken?" was four tenths one optional module, and it died
// outright the moment that module moved. An assertion about a module belongs to
// the module.
//
// The config is read as a FILE: this script is bare Node and must not import
// TypeScript. Anything but `true` is off — the same coercion
// `modules/community/lib/config.ts` applies.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assert that a switched-off community leaves no trace.
 *
 * Prints its own findings in smoke's voice and returns how many FAILURES it
 * found (0 or 1) for the caller to add to its count. It never throws: a raw
 * stack out of here would kill the run before the failure summary and the log
 * check, turning one finding into a crash that reports nothing.
 *
 * @param {object} options
 * @param {string} options.baseUrl  where the app answers
 * @param {string} options.cookie   the signed-in session's cookie header
 * @param {boolean} options.isLocal is this a local run (see below)
 * @returns {Promise<number>} failures to add
 */
export async function assert({ baseUrl, cookie, isLocal }) {
  try {
    // Locally only: a --url run asserts the DEPLOYED bundle, and this working
    // copy's config/community.json cannot speak for it — mid-rollout the two
    // legitimately disagree, and a wrong guess is either a spurious hard
    // failure against a healthy app or a silently skipped claim. The
    // assertion's home is the local run and the deploy gate, which is where the
    // shipped-off state is exercised (AC 5).
    if (!isLocal) {
      console.log(
        "\n·  community-off assertion runs locally only — a --url run cannot read the deployed bundle's config",
      );
      return 0;
    }

    const communityRaw = JSON.parse(readFileSync(join("config", "community.json"), "utf8"));
    if (communityRaw.enabled === true) {
      // A customer who switched the community on must not fail smoke.
      console.log("\n·  community enabled — the off-state 404 check does not apply");
      return 0;
    }

    const fetch404 = async (route) => {
      const answer = await fetch(`${baseUrl}${route}`, {
        redirect: "manual",
        headers: { cookie },
      });
      return { status: answer.status, body: await answer.text() };
    };

    const neverSlug = `never-existed-${Math.random().toString(36).slice(2)}`;
    const community = await fetch404("/dashboard/community");
    const baseline = await fetch404(`/dashboard/${neverSlug}`);
    const baselineAgain = await fetch404(`/dashboard/${neverSlug}`);
    // A path UNDER the section as well as the section itself. The module grew a
    // route subtree (`/community/members/<id>`, and groups and discussions after
    // it), and only the top path was ever asserted — so narrowing the proxy's
    // condition to an equality check, a plausible tidy-up since each page
    // carries its own `notFound()` as defense in depth, would leave every page
    // BELOW the section answering the layout-wrapped 404 while this check stayed
    // green. Static on purpose: smoke skips `[param]` routes, and this is
    // exactly the gap that creates.
    const belowSection = await fetch404("/dashboard/community/members/never-existed");
    // The OPERATOR's tree, for the same reason and one worse. The rewrite
    // covered the member route only, so `/dashboard/admin/community` fell
    // through to its own in-page `notFound()` — the layout-wrapped document this
    // whole check exists to catch — while `CLAUDE.md` claimed the two were
    // indistinguishable. And that page's `notFound()` runs BEFORE its
    // `requireOwner()`, so the member fetching it here is exactly who could read
    // the difference: no operator session required.
    const adminSection = await fetch404("/dashboard/admin/community");

    // TWO normalizations, each with its proof — and only these two:
    //  1. The 404 document echoes the REQUESTED path in its flight payload — a
    //     pre-module app answering /dashboard/community echoes "community"
    //     exactly the same way, so the echo carries no information about the
    //     module; the baseline's random slug is substituted so both documents
    //     claim the same requested path.
    //  2. The remaining <script> flight rows are compared only for PRESENCE,
    //     not bytes: their row-id allocation differs deterministically between
    //     a proxied and a directly-unmatched request (measured — identical row
    //     content, ids offset by one), which encodes the serializer's
    //     module-graph walk, not the route's existence. The member-visible
    //     document — everything outside <script> — must still match byte for
    //     byte; the sidebar chrome this check exists to catch lives there. The
    //     `baselineAgain` fetch guards this reasoning: if two fetches of one URL
    //     ever differ after normalization, the check says so instead of lying.
    //
    // There used to be a third, blanking Next's per-request id `self.__next_r`.
    // It was dead code presented as load-bearing evidence: that id only ever
    // appears INSIDE a <script> block, so every byte it touched was discarded by
    // normalization 2 a moment later. Removed rather than left as decoration — a
    // normalization nobody can point at a real effect for is how the next reader
    // over-trusts this comparison. If it ever does appear outside a script, the
    // `baselineAgain` probe is what says so.
    const normalize = (body) =>
      body
        .replaceAll(neverSlug, "community")
        .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g, "<script/>");
    community.body = normalize(community.body);
    baseline.body = normalize(baseline.body);
    baselineAgain.body = normalize(baselineAgain.body);
    belowSection.body = normalize(belowSection.body);
    adminSection.body = normalize(adminSection.body);

    if (baseline.body !== baselineAgain.body) {
      console.log(
        "      (note: two fetches of the SAME never-existed URL differ after " +
          "normalization — the comparison below may be reading serializer noise)",
      );
    }

    if (baseline.status !== 404) {
      // The baseline is a random slug under /dashboard, and this app is a
      // TEMPLATE: a customer who builds `app/dashboard/[slug]/page.tsx` has a
      // route that matches it, so the "never existed" control is not a control
      // at all. Failing here would report a community leak in an app whose
      // community is fine and whose dynamic route is healthy — the worst kind of
      // finding, because it is confidently wrong. Named skip, never silence.
      console.log(
        `\n·  the never-existed baseline /dashboard/${neverSlug} answered ` +
          `${baseline.status}, not 404 — a dynamic route under /dashboard matches it, ` +
          "so there is nothing to compare against; the community-off 404 assertion did not run",
      );
      return 0;
    }

    if (community.status !== 404) {
      console.log(
        `\n  ✗ community off, but /dashboard/community answers ${community.status} ` +
          "while the never-existed baseline answers 404 — off must be 404",
      );
      return 1;
    }

    if (community.body !== baseline.body) {
      // Same status is not enough: a 404 that carries the dashboard chrome tells
      // a probing member the module exists. If this fires, the fix is placement
      // (gate early enough that the same document answers both), never a
      // relaxation to status-only.
      console.log(
        "\n  ✗ community off: /dashboard/community and the never-existed baseline both " +
          "answer 404, but with DIFFERENT documents — off must look like never-existed",
      );
      // Show WHERE they diverge — the fix is placement, and the first divergence
      // names the layer that leaked into one of the two.
      let at = 0;
      while (at < community.body.length && community.body[at] === baseline.body[at]) at++;
      const from = Math.max(0, at - 60);
      console.log(`      community: …${community.body.slice(from, at + 120)}…`);
      console.log(`      baseline:  …${baseline.body.slice(from, at + 120)}…`);
      return 1;
    }

    if (adminSection.status !== 404 || adminSection.body !== baseline.body) {
      console.log(
        "\n  ✗ community off: /dashboard/admin/community answers " +
          `${adminSection.status} with a document that differs from the ` +
          "never-existed baseline — the operator's tree must be as invisible " +
          "as the member's, and this member is not an operator",
      );
      return 1;
    }

    if (belowSection.status !== 404 || belowSection.body !== baseline.body) {
      console.log(
        "\n  ✗ community off: the section itself is indistinguishable, but a path BELOW it " +
          `(/dashboard/community/members/…) answers ${belowSection.status} with a different ` +
          "document — the whole subtree must look like it was never built, not just its root",
      );
      return 1;
    }

    console.log(
      "\n  ✓ 404  community off — the section, a path below it and the operator's " +
        "admin tree are all indistinguishable from a route that never existed",
    );
    return 0;
  } catch (err) {
    // No config/community.json (an app generated before the module) — there is
    // nothing to assert, and its absence must not fail existing apps. Anything
    // ELSE is a real answer and is counted, never rethrown.
    if (err.code === "ENOENT") {
      // It SAYS so. This was once the one skip channel in the whole script that
      // printed nothing, so a missing config produced a fully green run that had
      // asserted nothing — green-by-skip wearing the colour of green-by-check,
      // which is the exact confusion `deploy-test.mjs` was extended to catch on
      // the release path. A customer running `node run.mjs smoke` is not on that
      // path and gets the line instead.
      console.log(
        "\n·  no config/community.json in this app — the community-off 404 assertion did not run",
      );
      return 0;
    }
    console.log(`\n  ✗ community-off check errored: ${err.message}`);
    return 1;
  }
}
