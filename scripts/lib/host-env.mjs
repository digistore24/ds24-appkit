// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which host is which, and which credential may travel to it — the ONE copy.
//
// Four commands here point at a DEPLOYED app and have to answer the same two
// questions before they send anything:
//
//   * **which address** — `--url`, or the first configured `APP_URL_*` in a
//     stated order (`resolveAddress()`)
//   * **which scope that address IS** — so the credential provisioned for it,
//     and no other, is the one that goes (`matchHostScope()`)
//
// They were four hand-written copies of the same loop, with four sets of
// refusal sentences and four opportunities to disagree about what a lookalike
// domain means:
//
//   `smokeCredentials()`      scripts/dev/sign-in.mjs      an email + password pair
//   `diagnosticsCredentials()` scripts/dev/errors-remote.mjs one secret, three scopes, --env
//   `cronSecretFor()`         scripts/cron/remote.mjs      one secret, two scopes, a LOCAL arm
//   `resolveTarget()`         scripts/security/rungs/live.mjs the address half only
//
// The sixteen copies of `blankComments()` (`docs/conventions.md` → *A checker that
// reads source as TEXT*) are the house lesson: the third copy is when you extract. This is the extraction, and the four callers
// above delegate to it while keeping their own names, their own arities and
// their own return shapes.
//
// ── 🚨 The rule this file exists to make impossible to weaken ───────────────
//
// **Never a "probably meant" fallback.** A typo'd domain, a homograph
// neighbour, a host that merely ENDS in the configured one, a staging URL
// against production credentials — every one of them lands in a refusal. A
// secret is never sent to a host it was not provisioned for, and the comparison
// is `===` on a normalised hostname and nothing else. `host-env.test.ts` plants
// the `endsWith` fallback as a needle and watches it go red.
//
// ── What stays with the caller, because the four genuinely differ ───────────
//
// The scope table itself, the credential SHAPE (a pair, one secret, or
// `{ envName: "local" }`), the `--env` override, the local branch, and each
// caller's own fix sentence. ⚠️ **Keys are NAMED, never derived** — this file
// grows no `${base}_${suffix}` convenience: `errors-remote.mjs` and
// `cron/remote.mjs` both record the `_PROD` vs `_PRODUCTION` trap, where an
// operator sets a variable nothing ever reads and nothing says why.
//
// Pure. No I/O, no `process`, no clock, nothing on import — Linux, macOS and
// Git Bash on Windows (CLAUDE.md → Three systems).

/**
 * The hostname of a URL, normalised — or `null` when it is not a URL at all.
 *
 * Three normalisations, and each of them is a host that would otherwise slip
 * past an exact comparison and be handed a secret it was never meant to see:
 * case (hosts are case-insensitive), a trailing dot (`example.com.` is the same
 * host as `example.com`), and the brackets an IPv6 literal keeps in
 * `URL.hostname`, so `http://[::1]:3000` compares as `::1`.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function hostOf(value) {
  try {
    return new URL(String(value))
      .hostname.toLowerCase()
      .replace(/\.+$/, "")
      .replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/** The three spellings of "this machine". */
export function isLocalHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * The one sentence every caller says about a URL that is not one.
 *
 * A function rather than a template repeated four times, for the reason the
 * whole file exists: four copies of a refusal are four refusals that drift.
 */
export function notAUsableUrl(value) {
  return `not a usable URL: ${value}`;
}

/** No trailing slash, so `${base}/api/…` never becomes `//api/…`. */
const trimSlash = (value) => String(value).trim().replace(/\/+$/, "");

/**
 * Which configured scope a `--url` IS — or the reason none of them is.
 *
 * The loop, the `known` list and the two terminal refusals. A scope is any
 * object carrying a `urlVar`; everything else on it (a `keyVar`, a `suffix`, an
 * `envName`) is the caller's business and is handed straight back untouched, so
 * this file never learns what a credential looks like.
 *
 * 🚨 An `APP_URL_*` that is set but unparseable is SKIPPED rather than matched.
 * It still appears in nothing, so the refusal below names only the hosts that
 * were genuinely comparable — which is the honest list: an unreadable variable
 * is not a host anybody could have meant.
 *
 * @template {{ urlVar: string }} S
 * @param {Record<string, string | undefined>} env
 * @param {string} baseUrl the address the operator typed
 * @param {readonly S[]} scopes in the order they should be tried
 * @param {{ hostsLabel: string, neverClause: string,
 *           nothingConfigured: (target: string) => string }} texts
 * @returns {{ scope: S, host: string } | { reason: string }}
 */
export function matchHostScope(env, baseUrl, scopes, texts) {
  const target = hostOf(baseUrl);
  if (!target) return { reason: notAUsableUrl(baseUrl) };

  const known = [];
  for (const scope of scopes ?? []) {
    const configured = env?.[scope.urlVar];
    if (!configured) continue;
    const host = hostOf(configured);
    if (!host) continue;
    known.push({ urlVar: scope.urlVar, host });
    if (host !== target) continue;
    return { scope, host: target };
  }

  if (known.length === 0) return { reason: texts.nothingConfigured(target) };
  return {
    reason:
      `${target} matches none of the ${texts.hostsLabel} (${known
        .map((entry) => `${entry.urlVar}=${entry.host}`)
        .join(", ")}) — ${texts.neverClause}`,
  };
}

/**
 * Which address to ask — `--url`, else the first configured variable in `order`.
 *
 * The order is the caller's, and it is not decoration: `live` and `health` both
 * want production first, because the question both ask is what CUSTOMERS
 * receive, and a staging host that happens to be configured is not where they
 * are.
 *
 * 🚨 **A value that is SET but unreadable is a refusal naming the variable, not
 * a silent fall-through to the next one.** A typo in `APP_URL_PROD` that quietly
 * caused the staging host to be reported as production would be a command lying
 * about which app it looked at.
 *
 * `refuseLocal` is the one axis the callers genuinely differ on, and it is
 * passed rather than decided here. `live` refuses a loopback address (DEV sets
 * its session cookies without `Secure` on purpose, so a local run would report a
 * decision as a defect); `health` allows one, because "is my app up" is a
 * question worth asking of `node run.mjs start`. The two sentences a refusal
 * needs are the caller's own, because they say WHY that caller refuses.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 * @param {{ order: string[],
 *           none: (order: string[]) => string,
 *           isLocal?: (host: string) => boolean,
 *           refuseLocal?: { given: (host: string) => string,
 *                           configured: (name: string) => string } | null }} options
 * @returns {{ url: string, from: string, host: string, local: boolean } | { reason: string }}
 */
export function resolveAddress(env = {}, argv = [], options) {
  const { order = [], none, isLocal = isLocalHost, refuseLocal = null } = options ?? {};

  const at = Array.isArray(argv) ? argv.indexOf("--url") : -1;
  if (at !== -1) {
    const given = String(argv[at + 1] ?? "").trim();
    const host = hostOf(given);
    if (!given || !host) return { reason: notAUsableUrl(given || "(nothing after --url)") };
    if (refuseLocal && isLocal(host)) return { reason: refuseLocal.given(host) };
    return { url: trimSlash(given), from: "--url", host, local: isLocal(host) };
  }

  let local = null;
  for (const name of order) {
    const value = String(env?.[name] ?? "").trim();
    if (!value) continue;
    const host = hostOf(value);
    if (!host) return { reason: `${name} is not a usable URL: ${value}` };
    if (refuseLocal && isLocal(host)) {
      local ??= name;
      continue;
    }
    return { url: trimSlash(value), from: name, host, local: isLocal(host) };
  }

  if (refuseLocal && local) return { reason: refuseLocal.configured(local) };
  return { reason: none(order) };
}
