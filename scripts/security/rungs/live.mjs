// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Rung 7 — what a STRANGER receives from the real domain.
//
// 🚨 **Every request this rung makes carries no `Cookie`, no `Authorization`, no
// `DIAGNOSTICS_SECRET`, no `CRON_SECRET` and no credential in a query string.
// That is not an omission, it is the claim.** "A stranger can reach this page"
// is only true if a stranger is what asked; a rung that authenticated itself and
// then reported what it could see would be reporting about an operator. So this
// file has no secret to send, deliberately keeps no way to acquire one, and the
// one address resolver it borrows from (`scripts/dev/errors-remote.mjs`) is
// borrowed by its `urlVar` half only — never `diagnosticsCredentials()`, which
// resolves a URL *and* a secret and would grow this rung a credential three
// stories later.
//
// ── The three claims that are genuinely new, and the one that is not ───────
//
//   1. the headers a stranger receives, AFTER every proxy and CDN in the way.
//      `next.config.ts` sets four of them on every response; whether they still
//      ARRIVE is a different question, and nothing here has ever asked it.
//   2. the cookie flags on the real origin. Nothing in this repository has ever
//      looked at a `Set-Cookie` header.
//   3. an anonymous 2xx on a route under `/dashboard`.
//
// ⚠️ **NFR-66 says a structural test outranks a scanner, and it is honoured
// rather than dodged.** `app/route-protection.test.ts` already walks every page
// and handler and fails on any route nobody DECIDED about — and its own header
// says, in as many words, that *"it does not verify that a guard WORKS"*. That
// test is not being replaced and its list is not being duplicated here. It
// catches the route nobody decided about; this rung catches the route that was
// decided correctly and is being served to the world by a misconfigured proxy
// anyway.
//
// ── What DOES cover this today: nothing. Measured ──────────────────────────
//
// `scripts/dev/smoke.mjs`'s `callPage()` rates any 2xx received WITHOUT a cookie
// as `✓`. Measured on 2026-08-10 against a stub answering 200 to every path:
//
//     ✓ 200  /dashboard/admin/users
//     ✓ All 27 page(s) answer without a server error.      exit 0
//
// So `node run.mjs smoke --url https://…` reports a green tick for an admin page
// that renders for anybody on the internet. That is the hole this rung closes,
// and it is written down here because it is the sentence that stops the next
// reader concluding "smoke already does this".
//
// Note what is NOT wrong with smoke: its anonymous pass exists to find out which
// pages are gated, and it is correct for that job. This rung does not change
// smoke's rating — it asks a different question of the same list, and it asks it
// from `scripts/dev/routes.mjs`, which is that list, so the two can never
// disagree about which pages exist.
//
// ── On a developer's machine this rung skips, every run ────────────────────
//
// There is no deployed address in a fresh `.env`, so `.dev/security-check.json`
// carries `complete: false` for ever on a laptop. That is the correct answer —
// nobody looked at a live app — and it is the same property `drift` has when a
// machine is offline. A skip is never a failure and never touches the exit code.
//
// Plain Node, no dependency — Linux, macOS and Git Bash on Windows. Every
// request is `fetch()` with an `AbortSignal.timeout(…)`; no `curl`, no `wget`,
// no shell, no process spawned at all. Nothing here runs at import time.
import { join } from "node:path";

import { readEnvValue } from "../../lib/env-write.mjs";
import { hostOf, resolveAddress } from "../../lib/host-env.mjs";
import { collectPageRoutes } from "../../dev/routes.mjs";
import { ENVIRONMENTS } from "../../dev/errors-remote.mjs";

const SOURCE = "live";

/**
 * How long any one request may take.
 *
 * Bounded because this runs inside a command nobody is watching the network for:
 * a hung request there is indistinguishable from a hung command, somebody
 * reaches for Ctrl-C, and the check they interrupted is the check they stop
 * running. Ten seconds is the same bound `rungs/registry.mjs` and `rungs/drift.mjs`
 * use, so the ladder does not have three opinions about patience.
 */
const TIMEOUT_MS = 10_000;

/** The prefix whose routes this rung probes. Everything else is public by design. */
const PROTECTED_PREFIX = "/dashboard";

/** How many paths a `Where:` line spells out before it starts counting. */
const NAMED = 4;

/**
 * The two public pages this rung reads a `Set-Cookie` off.
 *
 * TWO, and the second one is the reason the first is not enough: a signed-out
 * visitor's home page routinely sets nothing at all, so a rung that looked only
 * there would report "no cookie was inspected" on every healthy app and teach
 * its reader to skip the line. `/login` is where a real app mints its CSRF and
 * callback cookies, so between them the question usually gets an answer.
 */
const COOKIE_PAGES = [
  { path: "/", label: "the home page" },
  { path: "/login", label: "/login" },
];

// ── the pure half ───────────────────────────────────────────────────────────

/**
 * The four spellings of "this machine" — the vocabulary `smoke.mjs` already
 * uses, plus `::1`, which it does not need and this rung does.
 *
 * `new URL("http://[::1]/").hostname` is `"[::1]"` with the brackets kept, and
 * the shared `hostOf()` strips them; both spellings stay in the set so this
 * answer does not depend on which normalisation ran first.
 */
export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Is this address this machine?
 *
 * 🚨 **A private LAN address is deliberately NOT local here.** `192.168.1.40` or
 * `10.0.0.5` may genuinely be somebody's deployed app behind a VPN or on an
 * office network, and refusing it would be refusing an app that really runs —
 * which is the one thing this ladder must never do quietly. The question this
 * function answers is narrow on purpose: is this the loopback.
 *
 * The reason the loopback IS refused is not squeamishness about localhost. In
 * DEV this app renames its session cookies and sets them with `secure: false`
 * on purpose (`lib/auth/cookie-names.ts`), because DEV runs over plain HTTP —
 * so a rung pointed at a local app would report a ❌ HIGH about a decision the
 * template made deliberately, on every developer's machine, for ever.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isLocalAddress(value) {
  const host = hostOf(value);
  return host === null ? false : LOCAL_HOSTS.has(host);
}

/** Is this address served over plain HTTP? */
export function isPlainHttp(value) {
  try {
    return new URL(String(value)).protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Which address is "the real domain", and the refusal to guess one.
 *
 * The order is `--url`, then `APP_URL_PROD`, then `APP_URL_STAGING`, then
 * `APP_URL` — **production first**, because the question this rung asks is what
 * CUSTOMERS receive, and a staging host that happens to be configured is not
 * where they are.
 *
 * The variable names come from `ENVIRONMENTS` in `scripts/dev/errors-remote.mjs`
 * rather than being spelled again here, so there is one place in this project
 * naming `APP_URL_PROD` and not a second opinion about whether it is `_PROD` or
 * `_PRODUCTION`. 🚨 Only the `urlVar` half of that table is read — never
 * `keyVar`. This rung has no credential to scope and must not grow one.
 *
 * The WALK is `resolveAddress()` (`scripts/lib/host-env.mjs`), shared with
 * `node run.mjs health` since 0.24.0 — a pure address resolver with no
 * credential anywhere in its graph. The two sentences a local address earns are
 * still this rung's own, because they say why THIS rung refuses one; `health`
 * allows one and says so in its place.
 *
 * 🚨 **Never a "probably meant" fallback**, the rule `diagnosticsCredentials()`
 * writes out: a value that is set but unreadable is a refusal naming the
 * variable, not a silent fall-through to the next one. A typo in `APP_URL_PROD`
 * that quietly caused a STAGING host to be reported as production would be a
 * check lying about which app it looked at.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 * @returns {{url: string, from: string} | {reason: string}}
 */
export function resolveTarget(env = {}, argv = []) {
  const order = [
    ENVIRONMENTS.production.urlVar,
    ENVIRONMENTS.staging.urlVar,
    ENVIRONMENTS.development.urlVar,
  ];

  const answer = resolveAddress(env, argv, {
    order,
    // The rung's own set, which is wider than the shared one: `0.0.0.0` is a
    // machine's own address too, and this is the one caller that has to refuse
    // it rather than merely notice it.
    isLocal: (host) => LOCAL_HOSTS.has(host),
    refuseLocal: {
      given: (host) =>
        `the address given is local (${host}) — this rung asks what a stranger on ` +
        "the internet receives, and in DEV this app sets its session cookies without Secure " +
        "on purpose, so a local run would report a decision as a defect",
      configured: (name) =>
        `no deployed address to check — ${name} is local and no --url was given`,
    },
    none: (names) =>
      "no deployed address to check — no --url was given and none of " +
      `${names.join(", ")} is set in the .env`,
  });

  if ("reason" in answer) return answer;
  // Narrowed deliberately: `resolveAddress()` also hands back the host and
  // whether it is local, and this rung's contract is the two fields it has
  // always returned.
  return { url: answer.url, from: answer.from };
}

/**
 * The four headers this rung reads, and what each of them was set to.
 *
 * They are reported whether or not any of them is a finding — that is AC4's
 * "each with what is set", and it is what makes the ✓ line worth reading. A
 * tally of zero says nothing about whether anybody looked.
 *
 * @param {Headers} headers
 * @returns {string}
 */
export function headerEvidence(headers) {
  return [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Content-Security-Policy",
  ]
    .map((name) => {
      const value = String(headers?.get?.(name) ?? "").trim();
      return `${name}: ${value || "(absent)"}`;
    })
    .join(" · ");
}

/**
 * The places a Content-Security-Policy is WEAKER than having none at all.
 *
 * 🚨 **A missing CSP is not one of them, and this is the comment that stops the
 * next reader "fixing" the missing finding back in.** This template ships no
 * Content-Security-Policy for its own pages, deliberately, and `next.config.ts`
 * argues it out where the decision lives: Next.js emits inline scripts and
 * styles, so a useful policy needs per-request nonces threaded through the app,
 * and *"a `unsafe-inline` policy pasted in to make it 'green' would only look
 * like protection"*. Rating that absence as a defect would do two things, both
 * bad: it would turn every app's first live check red for ever, and the fix its
 * reader would reach for is the exact pasted policy the template refuses. So the
 * absence is REPORTED, in the evidence line, and raises no finding.
 *
 * A policy that IS present is a different question and gets asked: one that
 * allows `unsafe-inline` or `unsafe-eval` for scripts, or that opens
 * `default-src *`, is a header somebody can point at while the protection is not
 * there — which is worse than the honest nothing above.
 *
 * @param {string} csp
 * @returns {string[]}
 */
export function cspWeaknesses(csp) {
  const text = String(csp ?? "").trim();
  if (!text) return []; // see above — deliberately not a finding

  const directives = new Map();
  for (const part of text.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values.join(" ").toLowerCase());
  }

  const found = [];
  // A browser falls back to `default-src` where there is no `script-src`, so
  // this reads the same pair a browser would rather than only the narrow one.
  const scripts = directives.get("script-src") ?? directives.get("default-src") ?? "";
  if (/'unsafe-inline'/.test(scripts)) found.push("script-src allows 'unsafe-inline'");
  if (/'unsafe-eval'/.test(scripts)) found.push("script-src allows 'unsafe-eval'");
  if ((directives.get("default-src") ?? "").split(/\s+/).includes("*")) {
    found.push("default-src is *");
  }
  return found;
}

const HEADER_FIX_TAIL =
  "`next.config.ts` sets it on every response, so its absence means something in " +
  "FRONT of the app — a proxy, a CDN, a host's edge rule — is stripping or " +
  "replacing it. Look there first, not in the app.";

/**
 * What the response headers of a public page say, rated.
 *
 * Every rating here is ⚠️ MEDIUM and none of them is higher, and the reason is
 * the same for all three: each is a real defence and each needs a SECOND
 * condition before anybody is hurt by its absence — an active attacker on the
 * first request, a page that echoes a file back, a site that frames this one.
 * The one ❌ HIGH is plain HTTP, where no second condition is needed: a session
 * cookie on that origin travels in clear to anybody on the path.
 *
 * @param {Headers} headers
 * @param {string} url
 * @returns {import("../rules.mjs").Finding[]}
 */
export function headerFindings(headers, url) {
  const get = (name) => String(headers?.get?.(name) ?? "").trim();
  const csp = get("content-security-policy");
  const findings = [];

  if (isPlainHttp(url) && !isLocalAddress(url)) {
    findings.push({
      severity: "high",
      title: "The deployed app answers over plain http://",
      where: url,
      why:
        "Everything between this app and its customer can read and rewrite what they " +
        "send: the session cookie travels in clear, so anybody on the same network as " +
        "one of your buyers can take their session and act as them.",
      fix:
        "Put TLS in front of the app — every host in docs/DEPLOY.md does it for you and " +
        "issues the certificate — then set APP_URL_PROD to the https:// address and " +
        "redirect http to it.",
      evidence: `The address answered on ${url}, which is not a local address.`,
      source: SOURCE,
    });
  }

  if (!get("Strict-Transport-Security")) {
    findings.push({
      severity: "medium",
      title: "No Strict-Transport-Security on the live response",
      where: url,
      why:
        "Without it a browser that has only ever been told about your domain will try " +
        "http:// first if somebody types the bare name, and that one request can be " +
        "answered by whoever is on the path before TLS ever starts.",
      fix: `Check the header is still arriving: ${HEADER_FIX_TAIL}`,
      evidence: headerEvidence(headers),
      source: SOURCE,
    });
  }

  if (!/nosniff/i.test(get("X-Content-Type-Options"))) {
    findings.push({
      severity: "medium",
      title: "No X-Content-Type-Options: nosniff on the live response",
      where: url,
      why:
        "A browser may then guess what a response IS from its bytes rather than from " +
        "its declared type, which is how an uploaded or echoed-back file talks its way " +
        "into being run as script on your own origin.",
      fix: `Check the header is still arriving: ${HEADER_FIX_TAIL}`,
      evidence: headerEvidence(headers),
      source: SOURCE,
    });
  }

  if (!get("X-Frame-Options") && !/(^|;)\s*frame-ancestors\b/i.test(csp)) {
    findings.push({
      severity: "medium",
      title: "Nothing stops this app being framed (no X-Frame-Options, no frame-ancestors)",
      where: url,
      why:
        "Somebody else's page can load yours invisibly on top of their own and collect " +
        "the clicks. This app has money-adjacent admin pages and an account page, which " +
        "is where that is worth doing.",
      fix:
        "`next.config.ts` sends X-Frame-Options: DENY on every response. " +
        `${HEADER_FIX_TAIL} A CSP frame-ancestors directive is equally accepted here.`,
      evidence: headerEvidence(headers),
      source: SOURCE,
    });
  }

  for (const weakness of cspWeaknesses(csp)) {
    findings.push({
      severity: "low",
      title: `The Content-Security-Policy on this app is weaker than none: ${weakness}`,
      where: url,
      why:
        "A policy allowing inline script, eval or every origin is a header somebody can " +
        "point at while the protection it names is not there — which reads as done and " +
        "is not.",
      fix:
        "Thread per-request nonces through the app and name them in the policy. 🚨 Never " +
        "paste a wider policy in to make this line go away: this template ships NO CSP " +
        "for its own pages precisely so that nobody is tempted to (next.config.ts).",
      evidence: `Content-Security-Policy: ${csp}`,
      source: SOURCE,
    });
  }

  return findings;
}

/**
 * Cookies for which `HttpOnly` is deliberately absent — a named SET with a
 * reason each, on `scripts/security/accepted.mjs`'s own shape, never a count.
 *
 * A count would go green on the day a new cookie without HttpOnly appears: it
 * would land inside the allowance and nobody would see it. So what is exempt is
 * a set of NAMES, each carrying why, and anything outside it is reported however
 * ordinary it looks.
 *
 * Today that set has exactly one honest member. The theme and the install offer
 * are `localStorage` and never cookies at all — do not add them here;
 * `CLAUDE.md` lists them under § 25 TDDDG rather than under cookies for that
 * reason.
 *
 * @type {Record<string, {reason: string}>}
 */
export const HTTPONLY_EXEMPT = {
  NEXT_LOCALE: {
    reason:
      "The language switcher is a browser-side control: `i18n/actions.ts` sets NEXT_LOCALE " +
      "from a server action with sameSite lax and no httpOnly on purpose, and the value it " +
      "holds is a locale code that the app validates on every read (`isLocale()`). Reading " +
      "or writing it from script gains nobody anything.",
  },
};

/** `name=value; Secure; HttpOnly; SameSite=Lax` → what it declares. Values are never read. */
function parseSetCookie(line) {
  const [pair, ...attributes] = String(line ?? "").split(";");
  const name = String(pair ?? "").split("=")[0].trim();
  const flags = new Set(
    attributes.map((attribute) => attribute.split("=")[0].trim().toLowerCase()),
  );
  const sameSite = attributes
    .map((attribute) => attribute.trim())
    .find((attribute) => /^samesite=/i.test(attribute));
  return {
    name,
    secure: flags.has("secure"),
    httpOnly: flags.has("httponly"),
    sameSite: sameSite ? sameSite.split("=").slice(1).join("=").trim() : "",
  };
}

/**
 * What the `Set-Cookie` headers of one page declare, rated.
 *
 * 🚨 **When a response sets no cookies at all, this says so in words and returns
 * nothing that could be printed as a clean cookie result.** That is this
 * story's own instance of the rule the whole command exists for — "clean" and
 * "nobody asked" must never look the same — and it is the place it is easiest to
 * get wrong by accident, because zero findings out of zero cookies looks exactly
 * like zero findings out of nine. Measured: a signed-out visitor's home page in
 * this template routinely sets nothing. The session cookie is minted at sign-in,
 * the locale cookie by a server action, and the theme is `localStorage`.
 *
 * ⚠️ A cookie carrying the `__Secure-` or `__Host-` prefix is NOT reported a
 * second time for the prefix: the prefix is a guarantee the BROWSER enforces
 * (it refuses such a cookie outright without Secure), so a missing Secure
 * attribute is already the one finding below and a second one about the name
 * would be the same defect counted twice. A production Auth.js session cookie is
 * `__Secure-authjs.session-token`, so this is the normal case rather than an
 * exotic one.
 *
 * @param {string[]} setCookieLines
 * @param {string} label how the page is named in the sentence ("the home page")
 * @returns {{findings: import("../rules.mjs").Finding[],
 *            accepted: import("../rules.mjs").Finding[], note: string}}
 */
export function cookieFindings(setCookieLines, label) {
  const lines = (Array.isArray(setCookieLines) ? setCookieLines : []).filter((line) =>
    String(line ?? "").trim(),
  );

  if (lines.length === 0) {
    return {
      findings: [],
      accepted: [],
      note: `${label} set no cookies, so no cookie flag was inspected`,
    };
  }

  const findings = [];
  const accepted = [];
  const cookies = lines.map(parseSetCookie);

  for (const cookie of cookies) {
    const where = `Set-Cookie on ${label}: ${cookie.name}`;

    if (!cookie.secure) {
      findings.push({
        severity: "high",
        title: `The cookie ${cookie.name} is set without Secure`,
        where,
        why:
          "A cookie without Secure is sent over plain http as well, so one request to the " +
          "bare domain — a typed address, an old link, an http asset — hands it to " +
          "whoever is on the network path. For a session cookie that is the session.",
        fix:
          "Set `secure: true` where the cookie is written. If this is an Auth.js session " +
          "cookie, the app believes it is not in production: check APP_ENV and that " +
          "APP_URL on the host is the https:// address (lib/auth/cookie-names.ts).",
        evidence: `${cookie.name}: Secure absent, HttpOnly ${cookie.httpOnly ? "set" : "absent"}, SameSite ${cookie.sameSite || "absent"}.`,
        source: SOURCE,
      });
    }

    if (!cookie.sameSite) {
      findings.push({
        severity: "medium",
        title: `The cookie ${cookie.name} declares no SameSite`,
        where,
        why:
          "Another site can then cause a browser to send it along with a request it made " +
          "on the customer's behalf. Browsers default to Lax today, which is not the same " +
          "as the app having decided.",
        fix: "Say it where the cookie is written: `sameSite: \"lax\"` unless you need otherwise.",
        evidence: `${cookie.name}: SameSite absent.`,
        source: SOURCE,
      });
    }

    if (!cookie.httpOnly) {
      const exemption = HTTPONLY_EXEMPT[cookie.name];
      const block = {
        severity: "medium",
        title: `The cookie ${cookie.name} is readable from script (no HttpOnly)`,
        where,
        why:
          exemption?.reason ??
          "Any script that ends up running on this origin can read it — an injected " +
            "snippet, a compromised dependency, a browser extension. For anything that " +
            "identifies a customer that is the whole credential.",
        fix: exemption
          ? "Nothing to do — this one is a named exemption in scripts/security/rungs/live.mjs, with its reason. Take the entry out when it stops being true."
          : "Set `httpOnly: true` where the cookie is written, or add it to HTTPONLY_EXEMPT in scripts/security/rungs/live.mjs with the reason written out.",
        evidence: `${cookie.name}: HttpOnly absent, Secure ${cookie.secure ? "set" : "absent"}, SameSite ${cookie.sameSite || "absent"}.`,
        source: SOURCE,
      };
      if (exemption) accepted.push(block);
      else findings.push(block);
    }
  }

  const names = cookies.map((cookie) => cookie.name).join(", ");
  return {
    findings,
    accepted,
    note: `${label} set ${cookies.length} cookie(s): ${names}`,
  };
}

/**
 * A PUBLIC page's status, rated.
 *
 * The counterpart of `routeFinding()` below, and the pair is the whole point of
 * this rung in two functions: on `/` a 200 is the correct answer, and on
 * `/dashboard/admin/users` the same 200 is the finding. A 5xx is a real defect
 * on either — but this rung deliberately builds no health verdict out of it
 * (that is FR-270, Epic 32) and still reads the response's headers, because
 * headers arrive on a 503 too.
 *
 * @param {string} route
 * @param {number} status
 * @returns {import("../rules.mjs").Finding|null}
 */
export function publicPageFinding(route, status) {
  if (status < 500) return null;
  return {
    severity: "high",
    title: `A public page answers ${status}`,
    where: route,
    why:
      "This is a page anybody can reach, and right now nobody can use it. Whatever is " +
      "behind it — a missing environment value, a query against a column the migration " +
      "never created — is failing on the live app rather than on a laptop.",
    fix: "Ask the deployed app what it logged: `node run.mjs errors --url <address>` (docs/DEPLOY.md → Proving it works).",
    evidence: `GET ${route} answered ${status}, with no cookie and no credential sent.`,
    source: SOURCE,
  };
}

/**
 * A protected route's answer to a request with NO session, rated.
 *
 * ```
 *   2xx                       🚨 CRITICAL   a stranger is being shown the page
 *   3xx → /login              (correct)     recorded, never a finding
 *   3xx → anywhere else       ⚠️  MEDIUM    see below
 *   4xx (404 included)        (correct)     recorded, never a finding
 *   5xx                       ❌ HIGH
 * ```
 *
 * The redirect rating uses `smoke.mjs`'s own vocabulary — `/\/login(\?|$)/` on
 * the `location` header — rather than a second opinion about what "sent to the
 * sign-in page" means.
 *
 * ⚠️ **A 3xx to anywhere else is a finding HERE and is not one in smoke, and
 * that is not an inconsistency.** In smoke's signed-in pass a redirect elsewhere
 * is a `hasPlan()` gate doing its job; on the anonymous path there is no such
 * gate, because entitlement gates only fire once somebody is signed in. So
 * something answered and it was not the sign-in page, and what it was is worth a
 * look.
 *
 * A 404 is the correct answer for a module route in an app that has not
 * installed the module: absent and switched off answer deliberately identical
 * 404s (`CLAUDE.md` → *Modules*), which is why it is recorded in the
 * evidence and rated nothing.
 *
 * @param {string} route
 * @param {number} status
 * @param {string} location
 * @returns {import("../rules.mjs").Finding|null}
 */
export function routeFinding(route, status, location = "") {
  if (status >= 500) {
    return {
      severity: "high",
      title: `A protected page answers ${status} to a stranger`,
      where: route,
      why:
        "The page failed instead of refusing. Whatever ran before the refusal did so on " +
        "a request carrying no session at all, and a 500 is where a stack trace or an " +
        "internal path leaks into a response body.",
      fix: "Ask the deployed app what it logged: `node run.mjs errors --url <address>`.",
      evidence: `GET ${route} answered ${status}, with no cookie and no credential sent.`,
      source: SOURCE,
    };
  }

  if (status >= 300 && status < 400) {
    if (/\/login(\?|$)/.test(String(location ?? ""))) return null;
    return {
      severity: "medium",
      title: `A protected page sends a stranger somewhere other than /login`,
      where: route,
      why:
        "On a request with no session there is no entitlement gate to fire — those only " +
        "run once somebody is signed in. So something answered for this page and it was " +
        "not the sign-in page, and where it sent them is worth knowing.",
      fix:
        "Follow the redirect by hand and see what is at the other end. If it is a marketing " +
        "page or a plan chooser, the page is being decided about before the session is " +
        "checked; `authorized()` in auth.config.ts is where the refusal belongs.",
      evidence: `GET ${route} answered ${status} → ${location || "(no location header)"}, with no cookie sent.`,
      source: SOURCE,
    };
  }

  if (status >= 200 && status < 300) {
    return {
      severity: "critical",
      title: "A page under /dashboard renders for anybody on the internet",
      where: route,
      why:
        "Anyone who can type this address gets the page — no account, no purchase, no " +
        "sign-in. Under /dashboard that is the operator's own area: the customer list " +
        "with their email addresses, what each of them bought and what it cost, the " +
        "token balances, the impersonation log. They do not have to guess anything; the " +
        "path is in the page source of your own app.",
      fix:
        "A protected area needs THREE things and this one is missing at least one " +
        "(CLAUDE.md → Rules, first bullet): the path in the `matcher` in proxy.ts, the " +
        "/dashboard prefix decision inside `proxy()`, and `authorized()` in " +
        "auth.config.ts taught about it. Then add the route to app/route-protection.test.ts " +
        "— that test asks whether anybody DECIDED, which is the half this rung cannot see.",
      evidence: `GET ${route} answered ${status}, with no cookie and no credential sent.`,
      source: SOURCE,
    };
  }

  return null; // 4xx, 404 included — recorded in the evidence, rated nothing
}

/** `Where:` for a group of paths — a few named, the rest counted. */
export function whereOf(paths) {
  const list = paths ?? [];
  const shown = list.slice(0, NAMED).join(", ");
  return list.length > NAMED ? `${shown} and ${list.length - NAMED} more` : shown;
}

// ── the half that talks ─────────────────────────────────────────────────────

/**
 * The three address variables, from the environment or the `.env` behind it.
 *
 * Read the way `rungs/drift.mjs` reads its own switch: `process.env` wins, and
 * the file is read through `readEnvValue()` (which splits on `/\r?\n/`, and the
 * `.env` is the one file `.gitattributes` cannot reach) rather than by loading
 * the whole `.env` into this process — a rung has no business changing
 * `process.env` for the rungs after it.
 */
function addresses(cwd) {
  const file = join(cwd, ".env");
  const values = {};
  for (const { urlVar } of Object.values(ENVIRONMENTS)) {
    values[urlVar] = String(process.env[urlVar] ?? "").trim() || readEnvValue(file, urlVar);
  }
  return values;
}

/**
 * One request, as a stranger makes it.
 *
 * `redirect: "manual"` is load-bearing rather than tidy: with `"follow"` a 307
 * to `/login` arrives here as a 200 from the login page, and this rung would
 * then report every correctly protected route as reachable by anybody. It is the
 * single most likely way to build this rung wrong, which is why the pure test
 * asserts on this file's source that no fetch here omits it.
 *
 * No `headers` at all — no cookie, no authorization, nothing. See this file's
 * header: that is the claim, not an omission.
 */
async function probe(url) {
  try {
    const answer = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      ok: true,
      status: answer.status,
      headers: answer.headers,
      location: answer.headers.get("location") ?? "",
      setCookie: answer.headers.getSetCookie?.() ?? [],
    };
  } catch (error) {
    // The transport's own sentence is "TypeError: fetch failed", which names no
    // host — and an operator's first move is to find out WHICH one. A DNS
    // failure, a refused connection and a TLS error all arrive here, each with
    // its own words; a timeout arrives as a `TimeoutError`.
    const name = String(error?.name ?? "") || "the request failed";
    const detail = String(error?.cause?.message ?? error?.message ?? "").trim();
    const said =
      name === "TimeoutError"
        ? `did not answer within ${TIMEOUT_MS / 1000}s`
        : `could not be reached (${name}: ${detail || "no further detail"})`;
    return { ok: false, reason: `${url} ${said}` };
  }
}

/** @type {import("../rules.mjs").Rung} */
export const live = {
  id: "live",
  label: "What a stranger receives from the deployed app (headers, cookies, /dashboard)",
  // Tier 1: no account, no key, nothing to install. The network is not a tool.
  tier: 1,
  covers:
    "the security headers, cookie flags and anonymous route answers a customer sees on the real domain",

  async run({ root, argv = [] } = {}) {
    const cwd = root ?? process.cwd();

    const target = resolveTarget(addresses(cwd), argv);
    if (target.reason) return { state: "skipped", reason: target.reason, findings: [] };

    const base = target.url;
    const findings = [];
    const accepted = [];
    const notes = [];

    // ── the public pages ────────────────────────────────────────────────────
    let headerNote = "";
    for (const [index, page] of COOKIE_PAGES.entries()) {
      const answer = await probe(`${base}${page.path}`);
      if (!answer.ok) {
        // The home page is what everything else here is measured against — if
        // that could not be reached, nothing was measured and the rung says so
        // rather than reporting on the pages it never asked.
        if (index === 0) return { state: "skipped", reason: answer.reason, findings: [] };
        notes.push(`${page.label} was not reached — ${answer.reason}`);
        continue;
      }

      const status = publicPageFinding(page.path, answer.status);
      if (status) findings.push(status);

      if (index === 0) {
        // Headers are read off the home page, on whatever it answered: they
        // arrive on a 503 exactly as they arrive on a 200.
        findings.push(...headerFindings(answer.headers, base));
        headerNote = headerEvidence(answer.headers);
      }

      const cookies = cookieFindings(answer.setCookie, page.label);
      findings.push(...cookies.findings);
      accepted.push(...cookies.accepted);
      notes.push(`${page.label} answered ${answer.status}; ${cookies.note}`);
    }

    // ── every protected route, once, with no session ────────────────────────
    const routes = collectPageRoutes({ cwd })
      .filter((route) => route === PROTECTED_PREFIX || route.startsWith(`${PROTECTED_PREFIX}/`))
      .sort();

    const toLogin = [];
    const notFound = [];
    const unreachable = [];
    for (const route of [...new Set(routes)]) {
      const answer = await probe(`${base}${route}`);
      if (!answer.ok) {
        unreachable.push(route);
        continue;
      }
      const finding = routeFinding(route, answer.status, answer.location);
      if (finding) findings.push(finding);
      else if (answer.status >= 300 && answer.status < 400) toLogin.push(route);
      else if (answer.status >= 400) notFound.push(`${route} (${answer.status})`);
    }

    const asked = routes.length - unreachable.length;
    const evidence =
      `GET ${base}/ and ${base}/login and ${asked} of ${routes.length} route(s) under ` +
      `${PROTECTED_PREFIX}, each once, with no cookie and no credential sent ` +
      `(address from ${target.from}). ${headerNote ? `${headerNote}.` : "No headers were read."} ` +
      `${notes.join(". ")}. ${toLogin.length} route(s) correctly answered a redirect to /login` +
      (notFound.length > 0 ? `; ${notFound.length} answered 4xx: ${whereOf(notFound)}` : "") +
      (unreachable.length > 0
        ? `. ⚠️ ${unreachable.length} route(s) were NOT asked — they could not be reached: ${whereOf(unreachable)}`
        : "") +
      ".";

    // The shape `rungs/registry.mjs` uses, and for its reason: a partly asked
    // question is nearer "nobody asked" than "clean", so it may not report
    // clean — but `aggregate()` DISCARDS a skipped outcome's findings, so a rung
    // that found something must report `found` and carry the incompleteness in
    // its evidence instead.
    if (findings.length > 0) return { state: "found", findings, accepted, evidence };
    if (unreachable.length > 0) {
      return {
        state: "skipped",
        reason: `${unreachable.length} of ${routes.length} route(s) under ${PROTECTED_PREFIX} could not be reached, so the sweep is incomplete`,
        findings: [],
      };
    }
    return { state: "clean", findings: [], accepted, evidence };
  },
};
