// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// This module's `smoke` claim: a switched-off course leaves no trace.
//
// The course ships off, and unlike the community that is the NORMAL state for
// weeks — the window between `module add courses` and the content being
// written. So this claim is the one an app spends most of its early life in,
// and it is worth asserting rather than assuming.
//
// ⚠️ **What it asserts, and what it deliberately does not.** It checks the
// status and that the answer carries none of the dashboard chrome — the sidebar
// is what makes a layout-wrapped `notFound()` distinguishable from a route that
// never existed, and it is the difference a probing member could actually read.
// It does NOT compare the two documents byte for byte. `modules/community/smoke.mjs`
// does, and getting there took two normalizations with a measured justification
// each; a second copy of that reasoning would be the copy that drifts. If this
// claim ever needs to be that sharp, the normalization moves into a shared file
// first.
//
// The config is read as a FILE: this script is bare Node and must not import
// TypeScript. Anything but `true` is off — the same coercion `lib/config.ts`
// applies.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {object} options
 * @param {string} options.baseUrl  where the app answers
 * @param {string} options.cookie   the signed-in session's cookie header
 * @param {boolean} options.isLocal is this a local run
 * @returns {Promise<number>} failures to add
 */
export async function assert({ baseUrl, cookie, isLocal }) {
  try {
    // A `--url` run asserts the DEPLOYED bundle, and this working copy's
    // config cannot speak for it — mid-rollout the two legitimately disagree.
    if (!isLocal) {
      console.log(
        "\n·  course-off assertion runs locally only — a --url run cannot read the deployed bundle's config",
      );
      return 0;
    }

    let enabled = false;
    try {
      enabled = JSON.parse(readFileSync(join("config", "course.json"), "utf8")).enabled === true;
    } catch {
      // Unreadable counts as off, exactly as the module's own reader does.
    }
    if (enabled) {
      console.log("\n·  course enabled — the off-state 404 check does not apply");
      return 0;
    }

    const get = async (route) => {
      const answer = await fetch(`${baseUrl}${route}`, { redirect: "manual", headers: { cookie } });
      return { status: answer.status, body: await answer.text() };
    };

    // The section, a path BELOW it, and the operator's tree. All three, because
    // the community's gate once covered the member route only and the admin
    // subtree fell through to its own in-page `notFound()` — the layout-wrapped
    // document — while the docs claimed the two were indistinguishable.
    //
    // ⚠️ The last two are the operator's answering surface, and they are here
    // because `scripts/dev/smoke.mjs` cannot reach the second of them: the sweep
    // finds pages by walking `app/` and skips every directory whose name starts
    // with `[`, so `…/submissions/[submissionId]` is never called by it. This
    // file fetches LITERAL paths and is not subject to that skip, so the
    // dynamic route's off-state is asserted here or nowhere.
    // 🚨 **Two SHAPES of not-there, and both are asserted.** Since Story 44.2 a
    // lesson lives at `/dashboard/course/<course>/<lesson>`, so "no such course"
    // and "no such lesson in a course that does exist" are different paths
    // through the page — and with the module switched off BOTH have to answer
    // the document a route that never existed answers. The one-segment form is
    // kept too: it is now the course LIST, a literal path, and the one this
    // sweep would notice a rewrite on.
    const routes = [
      "/dashboard/course",
      "/dashboard/course/never-existed",
      "/dashboard/course/never-existed/also-never-existed",
      "/dashboard/admin/course",
      "/dashboard/admin/course/submissions",
      "/dashboard/admin/course/submissions/never-existed",
    ];

    let failures = 0;
    for (const route of routes) {
      const answer = await get(route);
      if (answer.status !== 404) {
        console.log(`\n✗ ${route} answered ${answer.status} with the course switched off — expected 404`);
        failures = 1;
        continue;
      }
      // The chrome: a dashboard-wrapped document carries the app shell's
      // navigation landmark. A route that never existed does not.
      if (/<nav\b/i.test(answer.body)) {
        console.log(
          `\n✗ ${route} answered 404 but the document carries the dashboard shell — ` +
            "a switched-off module has to be indistinguishable from one that was never built",
        );
        failures = 1;
      }
    }

    if (failures === 0) {
      console.log(`\n·  course off: ${routes.length} route(s) answer 404 with no dashboard chrome`);
    }
    return failures;
  } catch (error) {
    // Never throw: a raw stack here would kill the run before the failure
    // summary and the log check, turning one finding into a crash that reports
    // nothing.
    console.log(`\n✗ course-off assertion could not run: ${error.message}`);
    return 1;
  }
}
