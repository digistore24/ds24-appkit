// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Route protection in front of the app — up to Next.js 15 this file was called
// `middleware.ts`; since 16 the convention is `proxy.ts`.
//
// It uses ONLY the edge-safe auth.config (no database import). Since Next 16
// the proxy runs in the Node runtime, so that is no longer a hard requirement
// — but it stays that way on purpose: auth.config.ts is shared with the real
// auth.ts, and a Postgres import here would put the whole database layer in
// front of every request.
//
// What it can and cannot do is unchanged: it sees the JWT, not the database. A
// blocked user therefore stays signed in until `requireActiveUser()` in
// app/dashboard/layout.tsx throws them out — see lib/users/blocked.ts.
//
// ⚠️ THE MATCHER SAYS WHERE THIS RUNS. IT DOES NOT SAY WHAT IS PROTECTED.
// Protection is the `/dashboard` prefix decision in `proxy()` below plus
// `authorized()` in auth.config.ts. Every other matched path is public and is
// matched only for the cookie sweep — running the session machinery there too
// would decrypt and RE-ISSUE the session JWT on every hit to the busiest
// public pages (@auth/core re-sets the cookie on each session read), in every
// environment, for a sweep that is DEV-only anyway.
import NextAuth from "next-auth";
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import authConfig from "@/auth.config";
import { staleAuthCookieNames } from "@/lib/auth/cookie-names";
import { MODULE_GATES } from "@/lib/modules/gate-registry";

// Deliberately in two steps: Next.js reads this export statically, and a
// destructured `export const { auth: proxy } = …` is not recognized as a
// function — the build then fails with "must export a function".
const { auth } = NextAuth(authConfig);

/**
 * `auth` as the middleware it is — called by us instead of exported directly,
 * so that the answer can be amended before it leaves (see `pruneStaleCookies`).
 *
 * ⚠️ THE CAST IS NECESSARY AND THE ALTERNATIVE IS A SECURITY BUG. Auth.js types
 * `auth` for four uses and the inline-middleware one is not among them — it is
 * dispatched at runtime on `args[0] instanceof Request` (next-auth/lib/index.js),
 * because the documented way to reach it is `export default auth`, where Next's
 * own types accept the function unexamined.
 *
 * The typed alternative — `auth(async (req) => …)` — compiles and quietly
 * removes the route protection: in that shape `handleAuth` runs the user's
 * handler INSTEAD of the branch that redirects an unauthorized request
 * (`else if (userMiddlewareOrRoute)` sits before `else if (!authorized)`). The
 * `authorized()` callback is still called, and its answer is then discarded.
 * Every page under /dashboard would be reachable without a session.
 */
const guarded = auth as unknown as NextMiddleware;

/**
 * The second job: throwing out the session cookies of OTHER local copies of
 * this template, once there are enough of them to break the machine.
 *
 * Cookies know nothing about ports, so every copy ever started on this machine
 * sends its session to every other one. Past Node's 16 KB header limit the
 * request is answered `431` by the HTTP parser — **before Next.js sees it**,
 * which is why the dev log shows the GET of a page and then no POST at all, and
 * why the browser reports "An unexpected response was received from the server."
 * on the sign-in page of the app that is least at fault: the newest one.
 *
 * What is deleted, and when, is `staleAuthCookieNames()` — DEV only, localhost
 * only, and only above a threshold, so two apps worked on side by side keep
 * both sessions. Everything load-bearing about the decision is documented
 * there; this function only carries it out.
 *
 * It has to happen HERE because it has to happen on a GET: a server component
 * may not set a cookie, and by the time an action POST is refused with 431
 * there is no request left to answer. That is also why the matcher below covers
 * the public pages somebody lands on while signed out.
 *
 * One honest limit: past ~16 KB even the GET dies with 431 and this code never
 * runs — a jar can reach that state while this app was closed. From there only
 * clearing the cookies in the browser helps; `node run.mjs errors` says so.
 */
function pruneStaleCookies(request: NextRequest, response: Response): Response {
  const stale = staleAuthCookieNames(request.cookies.getAll(), {
    APP_ENV: process.env.APP_ENV,
    APP_URL: process.env.APP_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
  });
  if (stale.length === 0) return response;

  // A redirect built by `Response.redirect()` has immutable headers, so the
  // deletions go onto a copy rather than onto the answer we were handed.
  const patched = new NextResponse(response.body, response);
  for (const name of stale) patched.cookies.delete(name);
  return patched;
}

/**
 * Runs the Auth.js middleware and REFUSES TO FAIL OPEN.
 *
 * On the middleware path `handleAuth` always returns a Response. The one way to
 * get anything else out of `auth` is next-auth's runtime dispatch
 * (`args[0] instanceof Request`) misfiring — its own source carries a comment
 * saying that check has failed before — after which the API-routes branch
 * returns the SESSION OR NULL instead. A `?? NextResponse.next()` here would
 * turn exactly that failure into a public dashboard, silently. So anything
 * that is not a Response is an error, loudly: a 500 beats an open door.
 */
async function protect(request: NextRequest, event: NextFetchEvent): Promise<Response> {
  const answer = await guarded(request, event);
  if (!(answer instanceof Response)) {
    throw new Error("Auth middleware returned no Response — refusing to fail open.");
  }
  return answer;
}

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // The session machinery runs ONLY where something is protected. The other
  // matched paths are public: for them the answer is always "carry on", and
  // asking Auth.js first would re-issue session cookies on every hit (see the
  // warning at the top of the file).
  const { pathname } = request.nextUrl;
  let response = pathname.startsWith("/dashboard")
    ? await protect(request, event)
    : NextResponse.next();

  // A module's off-state, enforced where the DOCUMENT is still whole.
  //
  // A `notFound()` thrown inside a module's own page renders the not-found
  // boundary wrapped in the dashboard layout — sidebar and all — while a route
  // that never existed renders the bare root not-found. Those two documents
  // differing is exactly what FR-180 forbids: a probing member could tell
  // "switched off" from "never built". So a switched-off module's paths are
  // rewritten HERE to a path no route matches, and the framework answers with
  // the same document a pre-module app would send; `node run.mjs smoke`
  // compares the member-visible document byte for byte (everything outside
  // <script> — its header says why). Auth ran first (a redirect must win —
  // anonymous visitors get the same 307 either way), each page's own
  // `notFound()` stays as defense in depth, and every gate reads its config per
  // request, never cached (AD-67).
  //
  // ⚠️ **This used to be a hand-written block for the community, and the
  // hand-written list is what went wrong.** It covered `/dashboard/community`
  // while missing `/dashboard/admin/community`, so the operator's tree fell
  // through to its own in-page `notFound()` — and that page's `notFound()` runs
  // BEFORE its `requireOwner()`, so any signed-in member could ask for it and
  // read the difference. Claiming the property in `CLAUDE.md` while enforcing
  // it on one of two routes is how it stayed for as long as it did: nothing
  // compared the admin path. A module's `covers()` is built from the `app` list
  // in its manifest (`coversSubtrees()`), so the set that is BUILT and the set
  // that is GUARDED now have one source.
  //
  // The broken-but-wanted state (`enabled: true` with problems) is deliberately
  // NOT rewritten — an operator's diagnosis page must stay reachable, and each
  // module's page makes that fork. 🚨 That is why the test below is
  // `state() === "off"` and not a negated boolean: this paragraph was true as
  // intent and false as code for as long as a gate answered one `enabled()`,
  // which cannot distinguish "switched off" from "on but malformed" — so the
  // diagnosis page this sentence promises was rewritten away with the rest.
  // `ModuleState` in `lib/modules/gate.ts` carries the three-row table.
  // The compare runs on the DECODED path, because the router matches routes
  // that way: `/dashboard/%63ommunity` reaches the community page, and a
  // literal compare would let it slip past the rewrite into the page's
  // defense-in-depth `notFound()` — the layout-wrapped, distinguishable
  // document again, one percent-escape away. A malformed escape cannot be
  // decoded; then the literal path is the only claim there is, and no route
  // matches it either.
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // %-garbage — keep the literal path.
  }
  /**
   * Answer as a route that never existed.
   *
   * One helper for every module gate below, so two copies of it cannot
   * drift: the Set-Cookie carry-over is the part that would go missing
   * in a second copy, and its absence is invisible until somebody compares
   * headers — which the smoke check deliberately does not.
   */
  const answerAsNeverBuilt = (id: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = `/dashboard/__${id}-is-not-built__`;
    const rewritten = NextResponse.rewrite(url);
    // The rewrite replaces the auth response, but its Set-Cookie is not ours
    // to drop: Auth.js re-issues the session cookie on each /dashboard read
    // (see the header), so a 404 WITHOUT that header would differ from the
    // never-existed baseline's 404 in exactly the place a probing client can
    // look — and the smoke comparison reads status and body, never headers.
    // It also keeps the session's sliding window alive on this route.
    for (const cookie of response.headers.getSetCookie()) {
      rewritten.headers.append("set-cookie", cookie);
    }
    return rewritten;
  };

  // The same refusal for every installed module that is switched OFF.
  //
  // Only for the installed-but-off state: a module that is NOT installed has no
  // route files Next would build (`scripts/modules/page-extensions.mjs`), so its
  // paths are already 404s the framework never routed. This is what closes the
  // remaining gap — the one where the module IS built and the operator turned
  // it off.
  //
  // A gate's `covers` is built from the route subtrees its manifest declares
  // (`coversSubtrees`), so the set that is BUILT and the set that is GUARDED
  // have one source. The community's hand-written version of this comparison
  // missed the operator's tree, and nothing noticed.
  //
  // `!response.headers.get("location")` for the same reason as above: a
  // redirect must win, so an anonymous visitor gets the same 307 either way and
  // the refusal never leaks that the path exists.
  for (const gate of MODULE_GATES) {
    if (
      gate.state() === "off" &&
      gate.covers(decodedPathname) &&
      !response.headers.get("location")
    ) {
      response = answerAsNeverBuilt(gate.id);
      break;
    }
  }

  return pruneStaleCookies(request, response);
}

export const config = {
  // Two different reasons to be in this list, and they must not be confused —
  // see the warning at the top of the file.
  //
  //   /dashboard/:path*   is PROTECTED — protect() above + authorized()
  //   /, /login, /plans,  are only SWEPT — the public pages a signed-out
  //   /optin/:path*       person actually lands on, including the Digistore24
  //                       thank-you redirect into /optin/…. All stay public.
  //
  // Everything NOT matched here is public AND unswept. A new protected area
  // needs three things: the path here, the prefix decision in proxy(), and
  // authorized() in auth.config.ts.
  // Staying public by design: auth routes, /account/confirm-email, IPN webhook.
  matcher: ["/dashboard/:path*", "/login", "/", "/plans", "/optin/:path*"],
};
