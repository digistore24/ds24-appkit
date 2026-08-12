#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Calls every page of the app once and reports which ones are broken. Catches
// exactly what tests and `npm run build` do NOT catch: errors that only show up
// when rendering with a real database and a real .env — the classic "Internal
// Server Error" on a page nobody has ever opened.
//
// Usage (the app has to be running — `node run.mjs start`):
//   node scripts/dev/smoke.mjs          (or: node run.mjs smoke)
//   node scripts/dev/smoke.mjs --url https://staging.example.de
//   node scripts/dev/smoke.mjs --no-signed-in    (only the anonymous sweep)
//
// It runs in TWO passes, and the second one is the interesting half:
//
//   1. anonymous — every page once. A 307 to /login here is the correct answer
//      for a protected page, and it says nothing at all about that page.
//   2. signed in — exactly the pages that redirected above, now with a real
//      session (scripts/dev/sign-in.mjs). These are the pages with the queries
//      in them: the operator's, the member's, everything touching money and
//      roles. Without this pass they were only ever exercised when a person
//      opened them by hand.
//
// WHO is signed in depends on where the app runs, and the difference matters:
//
//   - locally: the OWNER, via the development login — every protected page
//     renders, admin pages included.
//   - deployed (--url): the smoke MEMBER, via the real password sign-in —
//     provisioned once with `node run.mjs smoke-account`. Owner-only pages
//     answer a member with a redirect, so remotely they count as redirects,
//     never as rendered. A remote run is therefore the smaller half of smoke —
//     run it locally as well.
//
// The LOG check now runs on both. Locally it reads `.dev/dev.log` around the
// sweep; remotely it asks the deployed app for its own bounded, redacted stderr
// window over `DIAGNOSTICS_SECRET` (lib/diagnostics/capture.ts) — same parser,
// same verdict. Where no secret resolves for that host, it says so and names
// the command that would run it. Browser-side errors are in neither remote
// answer: `[browser] …` is a dev-server channel.
//
// Either pass can be unavailable — and then it SAYS SO, in one line, with the
// reason. A sweep that quietly stopped being signed in would report green
// while checking nothing.
//
// Verdict:
//   5xx                          → FAILURE, exit code 1
//   3xx to /login WHILE SIGNED IN → FAILURE: the session did not take
//   other 2xx/3xx/4xx            → answered. A signed-in page redirecting to
//                                  /plans is a hasPlan() gate doing its job.
//   an error in the log          → FAILURE, even when the page answered 200.
//
// That last line is the one worth understanding. A status code says the server
// answered, not that the page rendered: next-intl catches a bad date, writes
// the error to stderr and renders the raw value into the cell. The page is 200
// and visibly wrong. So the log is read around the sweep, and anything that
// appeared in it counts (scripts/dev/log-errors.mjs).
// ⚠️ **This script reads `process.env.APP_URL` raw and needs the `.env` loaded
// for that and for the diagnostics secret below.** It used to have no
// `lib/env.mjs` import at all and worked by accident: `errors-remote.mjs`
// side-effect-imports it. Written down here rather than left as an accident,
// because somebody reordering imports would take the `.env` with them and the
// remote log check would go quiet without a word.
import "../lib/env.mjs";

import { findErrors, markLog } from "./log-errors.mjs";
import { diagnosticsCredentials, readRemoteFindings, describeWindow } from "./errors-remote.mjs";
import { collectPageRoutes } from "./routes.mjs";
import { renderFindings } from "../../lib/diagnostics/parse.mjs";
import { signInAsOwner, signInAsSmokeMember } from "./sign-in.mjs";
import { runModuleSmoke } from "../modules/inventory.mjs";

const args = process.argv.slice(2);
const wantSignedIn = !args.includes("--no-signed-in");
const baseUrl = (
  args[args.indexOf("--url") + 1]?.startsWith("http")
    ? args[args.indexOf("--url") + 1]
    : process.env.APP_URL || "http://localhost:3000"
).replace(/\/$/, "");

// What counts as a page is `scripts/dev/routes.mjs` — the same walk the security
// check's `live` rung uses, so the sweep and the rung can never disagree about
// which pages this app has. The de-duplication, the sort and the refusal below
// stay HERE: they are this sweep's behaviour, not the walker's.
const routes = [...new Set(collectPageRoutes())].sort();
if (routes.length === 0) {
  console.error("✗ No pages found under app/ — start from the project root.");
  process.exit(1);
}

console.log(`Checking ${routes.length} page(s) on ${baseUrl}\n`);

// The FILE log only exists for a dev server on this machine. `node run.mjs
// smoke` always passes --url (so that it cannot green-light another project
// answering on 3000), which is why the test is "is this host local", not "was
// --url given".
const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/.test(baseUrl);
// Taken before the first request: everything after this mark was caused by us.
const logMark = isLocal ? markLog() : 0;

/**
 * The remote twin of `markLog()`.
 *
 * A deployed app has no `.dev/dev.log` — it keeps a bounded, redacted window of
 * its own stderr instead (`lib/diagnostics/capture.ts`). Taking its `seq` before
 * the sweep and asking with `after=<seq>` afterwards gives the errors THIS
 * sweep caused, exactly as the file offset does locally.
 *
 * Where no secret resolves for this host, the answer is a reason — never a
 * silent pass. It is printed at the end, next to the findings it stands in for.
 */
async function markRemote() {
  const credentials = diagnosticsCredentials(process.env, baseUrl);
  if (credentials.reason) return { reason: credentials.reason };
  const body = await readRemoteFindings({ baseUrl, secret: credentials.secret });
  if (!body.ok) return { reason: body.reason };
  return { secret: credentials.secret, seq: body.seq };
}

const remoteMark = isLocal ? null : await markRemote();

let failures = 0;

/**
 * Call one page and judge the answer.
 *
 * `cookie` is empty on the anonymous pass and holds a real session on the second
 * one — which is the only thing that changes the judgement: being sent to /login
 * is correct without a session and a defect with one.
 *
 * @returns {Promise<{toLogin: boolean}>}
 */
async function callPage(route, cookie = "") {
  const url = `${baseUrl}${route}`;
  try {
    // redirect: "manual" — a 307 to /login is the result we are interested
    // in; following it would only measure /login all over again.
    const answer = await fetch(url, {
      redirect: "manual",
      headers: cookie ? { cookie } : undefined,
    });
    const status = answer.status;
    const location = answer.headers.get("location") ?? "";
    const toLogin = status >= 300 && status < 400 && /\/login(\?|$)/.test(location);

    if (status >= 500) {
      failures++;
      console.log(`  ✗ ${status}  ${route}`);
      // In dev mode the Next error page contains the message — its first line
      // saves you the trip into the log.
      const text = await answer.text();
      const match = text.match(/<h2[^>]*>([^<]+)<\/h2>|"message":"([^"]+)"/);
      if (match) console.log(`         ${(match[1] || match[2]).trim()}`);
      return { toLogin: false };
    }

    if (cookie && toLogin) {
      // We are signed in and the app sent us to the sign-in page anyway. Either
      // the session did not reach the app or the account cannot use it — both
      // mean this page has still not been rendered by anybody.
      failures++;
      console.log(`  ✗ ${status}  ${route} — sent to /login despite a session`);
      return { toLogin: true };
    }

    // A signed-in page redirecting somewhere ELSE is not a defect: that is what
    // a hasPlan() gate looks like from the outside (CLAUDE.md → Access).
    const note = status >= 300 && status < 400 ? ` (redirect → ${location || "?"})` : "";
    console.log(`  ✓ ${status}  ${route}${note}`);
    return { toLogin };
  } catch (err) {
    failures++;
    console.log(`  ✗ ---  ${route} — not reachable: ${err.message}`);
    return { toLogin: false };
  }
}

/**
 * The web app manifest and its icons, called the way a browser calls them.
 *
 * Why this is not part of the page sweep: `/manifest.webmanifest` comes out of
 * `app/manifest.ts`, a Next FILE CONVENTION — there is no `page.tsx` for it, so
 * `collectRoutes()` cannot see it, and adding it there would be a lie about
 * what that function walks.
 *
 * It earns its own call because it is the one thing in this app whose failure is
 * completely invisible from the inside: `npm run build` stays green, every page
 * renders, and the only symptom is on somebody's phone — no offer to install,
 * or an icon showing the browser's default glyph. The failures this catches are
 * real deploy shapes: an image built without `public/`, a bucket that never got
 * the icons, a new domain the manifest does not know it is on.
 *
 * Called WITHOUT a cookie, deliberately. A browser fetches the manifest before
 * anybody is signed in, and on iOS while the user is standing in the share
 * sheet — a manifest that answers 307 to /login is an app that cannot be
 * installed at all.
 */
async function callManifest() {
  const url = `${baseUrl}/manifest.webmanifest`;
  let manifest;
  try {
    const answer = await fetch(url, { redirect: "manual" });
    if (answer.status !== 200) {
      failures++;
      console.log(
        `  ✗ ${answer.status}  /manifest.webmanifest — must answer 200 without a session`,
      );
      return;
    }
    const type = answer.headers.get("content-type") ?? "";
    if (!type.includes("manifest+json")) {
      failures++;
      console.log(`  ✗ 200  /manifest.webmanifest — content-type is "${type}"`);
      return;
    }
    manifest = await answer.json();
  } catch (err) {
    failures++;
    console.log(`  ✗ ---  /manifest.webmanifest — ${err.message}`);
    return;
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (icons.length === 0 || !manifest.start_url || !manifest.display) {
    failures++;
    console.log("  ✗ 200  /manifest.webmanifest — no icons, start_url or display in it");
    return;
  }

  let broken = 0;
  for (const icon of icons) {
    try {
      const answer = await fetch(`${baseUrl}${icon.src}`, { redirect: "manual" });
      const type = answer.headers.get("content-type") ?? "";
      if (answer.status !== 200 || !type.startsWith("image/")) {
        broken++;
        console.log(`  ✗ ${answer.status}  ${icon.src} — declared in the manifest ("${type}")`);
      }
    } catch (err) {
      broken++;
      console.log(`  ✗ ---  ${icon.src} — ${err.message}`);
    }
  }

  // `related_applications` is what `navigator.getInstalledRelatedApps()` matches
  // against, and a wrong origin there is not a broken link — it is a silent
  // empty answer, i.e. an install hint that never goes away with nothing saying
  // why. It only ever shows up on a domain nobody tested on, which is this one.
  const related = manifest.related_applications?.[0]?.url ?? "";
  if (!related.startsWith(`${baseUrl}/`)) {
    broken++;
    console.log(
      `  ✗ 200  /manifest.webmanifest — related_applications points at "${related}",\n` +
        `         not at ${baseUrl}; "is it already installed?" will never be answered`,
    );
  }

  failures += broken;
  if (broken === 0) console.log(`  ✓ 200  /manifest.webmanifest (${icons.length} icons)`);
}

const gated = [];
for (const route of routes) {
  const { toLogin } = await callPage(route);
  if (toLogin) gated.push(route);
}
await callManifest();

// ── the second pass ─────────────────────────────────────────────────────────
// Locally as the owner (development login), remotely as the smoke member (the
// real password sign-in, provisioned by `node run.mjs smoke-account`). Where
// neither door opens, the right answer is that these pages were not checked,
// said plainly.
let signedInPages = 0;
if (gated.length > 0 && wantSignedIn) {
  const session = isLocal ? await signInAsOwner(baseUrl) : await signInAsSmokeMember(baseUrl);
  if (session.skipped) {
    console.log(
      `\n·  ${gated.length} protected page(s) NOT checked — ${session.reason}; ` +
        "the community-off 404 assertion did not run either",
    );
  } else {
    console.log(
      `\nSigned in as ${session.as} (${session.role}) — the ${gated.length} protected page(s) again:\n`,
    );
    if (session.role === "member") {
      console.log("·  as a member — owner-only pages count as a redirect here, not as rendered\n");
    }
    for (const route of gated) await callPage(route, session.cookie);
    signedInPages = gated.length;

    // Whatever an INSTALLED MODULE claims about the running app. A module
    // declaring `smoke` in its manifest ships an `assert(context)` that returns
    // its own failure count, and this loop is the only way such a claim runs.
    //
    // ⚠️ There used to be a second call above this one, naming the community's
    // off-state assertion (AD-67) by importing `./smoke-community.mjs`. That was
    // the sweep's one feature-specific claim, and it survived the community's
    // move into `modules/community/` as a dangling import — the whole script
    // died with ERR_MODULE_NOT_FOUND before it called a single page. Nothing
    // caught it: `smoke` is the tool that finds what tests cannot, so nothing
    // tests `smoke`. The claim did not go away; it is `modules/community/smoke.mjs`
    // and this loop runs it. Whoever adds the next feature-specific assertion
    // puts it in the module it belongs to — a core sweep that names one optional
    // feature is a core sweep that breaks when that feature moves.
    failures += await runModuleSmoke({ baseUrl, cookie: session.cookie, isLocal });
  }
} else if (gated.length > 0) {
  console.log(
    `\n·  ${gated.length} protected page(s) NOT checked — --no-signed-in; ` +
      "no installed module's own smoke claim ran either",
  );
}

if (failures > 0) {
  console.error(
    `\n✗ ${failures} page(s) with a server error.\n` +
      "  Look at the cause in the log: node run.mjs logs\n" +
      "  Do not ship before that is fixed.",
  );
  process.exit(1);
}

console.log(
  `\n✓ All ${routes.length} page(s) answer without a server error` +
    `${signedInPages > 0 ? `, ${signedInPages} of them signed in` : ""}.`,
);

// A page can answer 200 and still be broken. Whatever the requests above wrote
// into the log is exactly that case.
if (isLocal) {
  const logged = findErrors(logMark);
  if (logged.length > 0) {
    console.error(
      `\n✗ …but the log picked up ${logged.length} error(s) while they were being called:\n`,
    );
    for (const { message, location, frame, count } of logged) {
      console.error(`  ${message}${count > 1 ? `  (${count}×)` : ""}`);
      if (location) console.error(`    ${location}`);
      if (frame) console.error(`    ${frame}`);
    }
    console.error("\n  In full, with the hints: node run.mjs errors");
    process.exit(1);
  }
  console.log("✓ Nothing in the log either.");
} else if (remoteMark?.reason) {
  // The skip that says it skipped. This branch used to read "that check exists
  // only for the local app, so a 200 with an error behind it passes here" — it
  // does not any more, and a sentence saying a check does not exist is worse
  // than one saying it did not run, because it stops anybody looking for a way
  // to run it.
  console.log(
    `·  the deployed app's log was NOT read — ${remoteMark.reason}\n` +
      "   so a 200 with an error behind it passes here. Set DIAGNOSTICS_SECRET in the\n" +
      `   host's secrets and in your .env, then: node run.mjs errors --url ${baseUrl}`,
  );
} else if (remoteMark) {
  const body = await readRemoteFindings({
    baseUrl,
    secret: remoteMark.secret,
    after: remoteMark.seq,
  });
  if (!body.ok) {
    console.log(
      `·  the deployed app's log was NOT read — ${body.reason}\n` +
        `   Ask it directly: node run.mjs errors --url ${baseUrl}`,
    );
  } else if (body.findings.length > 0) {
    console.error(
      `\n✗ …but the deployed app logged ${body.findings.length} error(s) while they were ` +
        "being called:\n",
    );
    const { head, body: lines, tail } = renderFindings(body.findings, {
      source: describeWindow(body),
      logHint:
        "The full context, with stack traces, is in the HOST's own log — this app keeps only\n" +
        "a bounded, redacted window of it and cannot read the host's.",
    });
    for (const line of [...head, ...lines, ...tail]) console.error(line);
    process.exit(1);
  } else {
    console.log(`✓ Nothing ${describeWindow(body)} either.`);
  }
}
