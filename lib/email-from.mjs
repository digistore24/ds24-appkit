// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The sender-domain rule, as code: the sign-in mails' From address must live
// on the app's own domain.
//
// Why this file exists at all: a sign-in mail whose links point at the app's
// domain but whose sender lives on another one is the exact shape of a
// phishing mail. Recipients report it, and enough reports put the app's domain
// on Google's Safe Browsing "Dangerous site" list — which blocks the whole app
// in Chrome, not just the mails. That happened to a real app built from this
// template (a brand-new domain plus a foreign sender), and the recovery is a
// Search Console appeal measured in days. docs/troubleshooting.md tells that
// story; this module is what keeps it from repeating.
//
// It is `.mjs` with zero imports — the same pattern as `lib/cron/rules.mjs` —
// because three very different callers need the same verdict: the boot guard
// (`lib/env-guard.ts`, edge-bundled TS), `scripts/dev/doctor.mjs` (plain Node,
// before any deploy) and `scripts/dev/mail-setup.mjs` (the moment the address
// is typed). A rule with three copies drifts; this one has one.

/**
 * The domain of an email address: `"Name <a@B.de.>"` → `"b.de"`.
 *
 * @param {string | null | undefined} address
 * @returns {string | null} lowercased domain, or null when none can be found
 */
export function emailDomain(address) {
  if (typeof address !== "string") return null;
  let addr = address.trim();
  const angled = addr.match(/<([^<>]+)>\s*$/);
  if (angled) addr = angled[1].trim();
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const domain = addr
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
  return domain || null;
}

/**
 * The hostname of APP_URL, lowercased, trailing dot stripped.
 *
 * @param {string | null | undefined} appUrl
 * @returns {string | null} null when the value is missing or not a URL
 */
export function appHost(appUrl) {
  if (typeof appUrl !== "string" || !appUrl.trim()) return null;
  try {
    const host = new URL(appUrl.trim()).hostname.toLowerCase().replace(/\.+$/, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Hosts the domain rule cannot judge: localhost, loopback and IP literals, and
 * bare machine names without a dot. On those the magic-link URLs are local
 * anyway (they carry APP_URL's origin — lib/auth/auth-url.mjs), so there is no
 * public domain a sender could match — the comparison is skipped, never failed.
 *
 * @param {string | null | undefined} host
 * @returns {boolean}
 */
export function isUnjudgeableHost(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.includes(":")) return true; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 literal
  if (!h.includes(".")) return true; // a bare machine name, not a public domain
  return false;
}

/**
 * Whether two domains belong to the same site: equal, or one is a dot-boundary
 * ancestor of the other. So `mail.fangfertig.de` matches `fangfertig.de` (a
 * sending subdomain) and `fangfertig.de` matches `app.fangfertig.de` (the apex
 * as sender, the app on a subdomain) — but `notfangfertig.de` does not, and
 * neither does a sibling under a multi-part TLD (`other.co.uk` vs
 * `mysite.co.uk`). Deliberately no public-suffix list: the only false pass is a
 * sender literally at a public suffix (`login@co.uk`), which does not occur.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function sameSite(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * The From address the app would actually send with — the same precedence as
 * `emailFrom()` in `lib/email.ts` (which delegates here), but `null` instead
 * of the `"login@localhost"` fallback, so a missing sender is visible as
 * missing rather than disguised as a value.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function resolvedFrom(env) {
  const postmark = Boolean(env.POSTMARK_SERVER_TOKEN && env.POSTMARK_SENDER);
  const from = (postmark ? env.POSTMARK_SENDER : env.SMTP_FROM) || env.EMAIL_FROM || "";
  return from.trim() || null;
}

// Values that are a flag, not a domain. The override must NAME the foreign
// domain — a specific acknowledgment — so `=1` is refused with its own code
// rather than accepted, and nobody learns to cargo-cult it.
const FLAG_VALUES = new Set(["1", "true", "yes", "on", "y"]);

/**
 * The verdict on a sender address against the app's domain.
 *
 * @param {object} input
 * @param {string | null | undefined} input.from        resolved sender (see `resolvedFrom`)
 * @param {string | null | undefined} input.appUrl      the declared public URL (APP_URL)
 * @param {string | null | undefined} [input.foreignDomainAck]
 *        EMAIL_FROM_FOREIGN_DOMAIN — the deliberate-decision override; must
 *        name the sender's domain itself
 * @returns {{ code: "missingFrom" | "foreignFrom" | "badOverride",
 *             from?: string, fromDomain?: string | null, host?: string } | null}
 *          null = fine, or not judgeable
 */
export function senderDomainProblem({ from, appUrl, foreignDomainAck }) {
  const address = typeof from === "string" ? from.trim() : "";
  if (!address) return { code: "missingFrom" };

  const host = appHost(appUrl);
  if (isUnjudgeableHost(host)) return null;

  const fromDomain = emailDomain(address);
  if (fromDomain && sameSite(fromDomain, host)) return null;

  const ack = typeof foreignDomainAck === "string"
    ? foreignDomainAck.trim().toLowerCase().replace(/\.+$/, "")
    : "";
  if (ack) {
    if (FLAG_VALUES.has(ack)) {
      return { code: "badOverride", from: address, fromDomain, host };
    }
    // The ack must match the domain actually sending. An address whose domain
    // cannot even be parsed stays refused — there is nothing to acknowledge.
    if (fromDomain && sameSite(ack, fromDomain)) return null;
  }
  return { code: "foreignFrom", from: address, fromDomain, host };
}
