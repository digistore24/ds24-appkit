// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Email delivery for the magic-link sign-in. Two transports, chosen by env:
//   1) Postmark  — POSTMARK_SERVER_TOKEN + POSTMARK_SENDER (verified sender)
//   2) SMTP      — SMTP_HOST/PORT/USER/PASSWORD (+ optional SMTP_SECURE, SMTP_FROM)
//
// If neither is configured, the email sign-in is disabled (the sign-in page
// then does not show it). nodemailer is loaded at runtime only (the SMTP path)
// — never import it in auth.config.ts (that config is shared with proxy.ts and
// has to stay free of Node-only dependencies).
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Provider } from "next-auth/providers";
import {
  hasPostmarkConfig,
  hasSmtpConfig,
  hasEmailConfig,
} from "@/lib/env-guard";
import { resolvedFrom } from "@/lib/email-from.mjs";
import { availableLegalPages, legalDocument } from "@/lib/legal/pages";
import { parse as parseLegalMarkdown } from "@/lib/legal/markdown";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { translatorFor } from "@/i18n/translator";

/**
 * Product name for the email.
 *
 * Falls back to `NEXT_PUBLIC_APP_NAME` — the variable the interface reads —
 * because that is the one a deploy actually sets. The two used to be separate,
 * and the measured result was a production app whose sidebar knew its name
 * while its sign-in mail said only "Sign in": whoever configures the host sets
 * the name once, for the interface, and nobody remembers the mails have their
 * own variable. `APP_NAME` stays as the override for the rare app whose mails
 * should say something else.
 */
function appName(): string {
  return (
    process.env.APP_NAME?.trim() ||
    process.env.NEXT_PUBLIC_APP_NAME?.trim() ||
    ""
  );
}

// The detection lives in lib/env-guard.ts (pure env checks, without the
// nodemailer dependency) — here we only apply it to process.env, so that there
// is exactly one source of truth.
export function isPostmarkConfigured(): boolean {
  return hasPostmarkConfig(process.env);
}

export function isSmtpConfigured(): boolean {
  return hasSmtpConfig(process.env);
}

export function isEmailLoginEnabled(): boolean {
  return hasEmailConfig(process.env);
}

/**
 * Sender address (From), depending on the configured transport. The precedence
 * lives in `lib/email-from.mjs` (one resolution, shared with the boot guard
 * and the tooling); the localhost fallback exists for DEV only — in STAGING
 * and PROD a missing sender stops the app from starting (`lib/env-guard.ts`).
 */
export function emailFrom(): string {
  return resolvedFrom(process.env) ?? "login@localhost";
}

/**
 * The texts of the sign-in email — in the language of whoever is signing in.
 *
 * The language comes from the running request (cookie or browser header),
 * because it was in exactly that request that the person clicked "send sign-in
 * link". That is why the texts are built here and not somewhere in the
 * background at send time.
 */
interface MailTexts {
  locale: string;
  subject: string;
  salutation: string;
  heading: string;
  body: string;
  cta: string;
  fallback: string;
  intro: string;
  /** "Didn't ask for this? Ignoring it is safe." — the sign-in mail only. */
  note?: string;
}

async function mailTexts(): Promise<MailTexts> {
  const { getLocale, getTranslations } = await import("next-intl/server");
  const t = await getTranslations("email");
  const name = appName();
  return {
    locale: await getLocale(),
    subject: name ? t("subjectForApp", { app: name }) : t("subject"),
    salutation: t("salutation"),
    heading: name ? t("headingForApp", { app: name }) : t("heading"),
    body: t("body"),
    cta: t("cta"),
    fallback: t("fallback"),
    intro: t("textBody"),
    note: t("loginIgnore"),
  };
}

/** Keeps interpolated values from taking the email's HTML apart. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- The mails wear the app's colour ------------------------------------------
//
// The button in every mail uses the accent the app's own buttons use:
// `--primary` from `app/globals.css`, read once per process and cached. A
// recolour — by hand or through the `design` skill — reaches the mails without
// anybody remembering that they exist. Mail clients render inline styles only
// and the older ones do not understand `hsl()`, so the value is converted to
// hex here; a format this parser cannot read (`oklch(…)`, a `var(…)` chain)
// falls back to the shipped petrol rather than shipping a broken style. Keep
// this value equal to `--primary` in `:root` — it is the answer for an app
// whose stylesheet could not be read, and a fallback in last season's colour
// is a drift nothing reports.
export const DEFAULT_ACCENT = "#076a7e";

/** The `--primary` value of a stylesheet as hex, or null when unreadable. */
export function accentFromCss(css: string): string | null {
  const match = css.match(/--primary:\s*([^;]+);/);
  if (!match) return null;
  const value = match[1].trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].toLowerCase();
    return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
  }

  const rgb = value.match(/^rgb\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)\s*\)$/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));

  const hsl = value.match(
    /^hsl\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*\)$/i,
  );
  if (hsl) return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));

  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1 ? [c, x, 0]
    : sector < 2 ? [x, c, 0]
    : sector < 3 ? [0, c, x]
    : sector < 4 ? [0, x, c]
    : sector < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = light - c / 2;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

let cachedAccent: string | null = null;

async function emailAccent(): Promise<string> {
  if (cachedAccent) return cachedAccent;
  try {
    const css = await readFile(
      path.join(process.cwd(), "app", "globals.css"),
      "utf8",
    );
    cachedAccent = accentFromCss(css) ?? DEFAULT_ACCENT;
  } catch {
    cachedAccent = DEFAULT_ACCENT;
  }
  return cachedAccent;
}

// --- One layout for every mail ------------------------------------------------
//
// Every mail this app sends is the same page: the app's name, a greeting, a
// heading, a short body, at most one button, and a footer that says who sent it
// and where its legal pages live. One renderer keeps them identical — and keeps
// the credential notice inside the same look WITHOUT ever growing a link: its
// layout simply has no `cta` and empty `footerLinks`, and lib/email.test.ts
// holds it there.

export interface MailLink {
  label: string;
  url: string;
}

export interface MailLayout {
  locale: string;
  /** "" renders no app line above the card. */
  app: string;
  salutation?: string;
  heading: string;
  /** The card's body, one string per paragraph. */
  paragraphs: string[];
  /** The one action. Mails that must not carry a link omit it. */
  cta?: { label: string; url: string };
  /** Under the button: "if the button does not work, copy this link". */
  fallbackLabel?: string;
  /** The text version's wording in place of button + fallback. */
  textIntro?: string;
  /** Small print inside the card ("didn't ask for this? ignoring is safe"). */
  note?: string;
  /** Footer sentence naming the sender. Carries no URL. */
  footerLine?: string;
  /** Impressum, Datenschutz, … — MUST stay empty on the credential notice. */
  footerLinks: MailLink[];
  /**
   * The Impressum's CONTENT, one plain line each, rendered below the links.
   *
   * A mail sent in the course of business is a business letter, and the
   * provider details belong IN it — a link to the page does not carry them
   * (§ 35a GmbHG / § 125a HGB for registered companies, § 5 DDG behind it).
   * Stays empty on the credential notice: an Impressum routinely contains a
   * web address and a mail address, both of which clients auto-link, and that
   * mail's no-link rule outranks (see the block comment above it).
   */
  imprint?: string[];
  /** Button colour — the app's `--primary` (see `emailAccent`). */
  accent?: string;
}

export function renderMailHtml(layout: MailLayout): string {
  const accent = layout.accent || DEFAULT_ACCENT;

  const card: string[] = [];
  if (layout.salutation) {
    card.push(
      `<p style="color:#333;margin:0 0 16px">${escapeHtml(layout.salutation)}</p>`,
    );
  }
  card.push(
    `<h1 style="font-size:20px;margin:0 0 8px;color:#111">${escapeHtml(layout.heading)}</h1>`,
  );
  for (const paragraph of layout.paragraphs) {
    card.push(
      `<p style="color:#555;margin:0 0 16px">${escapeHtml(paragraph)}</p>`,
    );
  }
  if (layout.cta) {
    card.push(
      `<p style="margin:24px 0"><a href="${escapeHtml(layout.cta.url)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(layout.cta.label)}</a></p>`,
    );
  }
  if (layout.note) {
    card.push(
      `<p style="color:#777;font-size:13px;margin:16px 0 0">${escapeHtml(layout.note)}</p>`,
    );
  }
  if (layout.cta && layout.fallbackLabel) {
    card.push(
      `<p style="color:#999;font-size:12px;margin:24px 0 0;border-top:1px solid #eee;padding-top:16px;word-break:break-all">${escapeHtml(layout.fallbackLabel)}<br>${escapeHtml(layout.cta.url)}</p>`,
    );
  }

  const footer: string[] = [];
  if (layout.footerLine) {
    footer.push(`<p style="margin:0 0 4px">${escapeHtml(layout.footerLine)}</p>`);
  }
  if (layout.footerLinks.length) {
    footer.push(
      `<p style="margin:0">${layout.footerLinks
        .map(
          (link) =>
            `<a href="${escapeHtml(link.url)}" style="color:#8a8a94">${escapeHtml(link.label)}</a>`,
        )
        .join(" &middot; ")}</p>`,
    );
  }
  if (layout.imprint?.length) {
    footer.push(
      `<p style="margin:12px 0 0">${layout.imprint.map(escapeHtml).join("<br>")}</p>`,
    );
  }

  return `<!doctype html><html lang="${escapeHtml(layout.locale)}"><body style="margin:0;font-family:system-ui,Segoe UI,sans-serif;background:#f5f5fa;padding:24px">
  <div style="max-width:480px;margin:0 auto">
    ${layout.app ? `<p style="text-align:center;font-size:15px;font-weight:700;color:#111;margin:0 0 16px">${escapeHtml(layout.app)}</p>` : ""}
    <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #eee">
    ${card.join("\n    ")}
    </div>
    ${footer.length ? `<div style="text-align:center;color:#8a8a94;font-size:12px;padding:16px 8px">${footer.join("\n    ")}</div>` : ""}
  </div></body></html>`;
}

export function renderMailText(layout: MailLayout): string {
  const lines: string[] = [];
  if (layout.app) lines.push(layout.app, "");
  if (layout.salutation) lines.push(layout.salutation, "");
  lines.push(layout.heading, "");
  if (layout.cta) {
    lines.push(layout.textIntro || layout.cta.label, layout.cta.url);
  } else {
    lines.push(...layout.paragraphs);
  }
  if (layout.note) lines.push("", layout.note);
  const footer: string[] = [];
  if (layout.footerLine) footer.push(layout.footerLine);
  for (const link of layout.footerLinks) footer.push(`${link.label}: ${link.url}`);
  if (layout.imprint?.length) {
    if (footer.length) footer.push("");
    footer.push(...layout.imprint);
  }
  if (footer.length) lines.push("", "--", ...footer);
  return `${lines.join("\n")}\n`;
}

/**
 * A legal document flattened to the plain lines a mail footer can carry.
 *
 * Headings become lines, bold and emphasis lose their markers, a link keeps
 * its TEXT and loses its target — in a footer read as an address block the
 * words are the content, and clients auto-link addresses on their own.
 */
export function imprintLines(markdown: string): string[] {
  const lines: string[] = [];
  for (const block of parseLegalMarkdown(markdown)) {
    if (block.kind === "heading") {
      lines.push(block.text);
      continue;
    }
    const rows = block.kind === "paragraph" ? block.lines : block.items;
    for (const row of rows) lines.push(row.map((part) => part.text).join(""));
  }
  return lines.map((line) => line.trim()).filter((line) => line !== "");
}

/**
 * The Impressum's content for the footer — and nothing while it is the
 * shipped placeholder: that text is instructions to the operator ("run
 * `compliance-check`"), not provider details, and it must never reach a
 * customer's inbox. `node run.mjs legal-check` and `go-live` refuse a launch
 * while the placeholder stands, so a live app's mails carry the real thing.
 */
async function imprintFor(locale: string): Promise<string[]> {
  const doc = await legalDocument("impressum", locale as Locale);
  if (!doc || doc.placeholder) return [];
  return imprintLines(doc.text);
}

/**
 * The footer's legal links: exactly the pages this app actually serves.
 *
 * Read at send time via `availableLegalPages` — an app that has not written its
 * AGB yet must not mail a link to a 404, and one that got them this morning
 * should not need a second list to register them in. The links need an absolute
 * base, so without a usable `APP_URL` (or with a non-HTTP one) there are none —
 * the mail is complete without them.
 */
async function legalFooterLinks(locale: Locale): Promise<MailLink[]> {
  const base = process.env.APP_URL?.trim();
  if (!base || !/^https?:\/\//i.test(base)) return [];
  const t = await translatorFor(locale, "legal");
  const slugs = await availableLegalPages(locale);
  return slugs.map((slug) => ({
    label: t(`${slug}.title`),
    url: new URL(`/${slug}`, base).toString(),
  }));
}

/**
 * The footer every link-carrying mail shares: sender, links, Impressum.
 *
 * 🚨 Its texts come from `translatorFor(locale)` rather than from the running
 * request, and that is what makes the footer usable by a mail with no request
 * behind it (`sendOperatorMail` below).
 *
 * For the three mails that had a footer already this is **almost** unchanged,
 * and the difference is worth naming rather than rounding off: `footerSentBy`
 * used to be resolved through the running request's cookie locale while the
 * legal links beside it already used the locale passed in. The two could
 * disagree — a mail whose links said `de` and whose closing line said `en`. Now
 * both use the parameter, so they cannot. In practice all three senders pass
 * `await getLocale()` and the two agreed anyway; this is a small fix, not an
 * identity, and calling it identity is what would stop the next reader
 * noticing the old inconsistency ever existed.
 *
 * An unknown string falls back to DEFAULT_LOCALE instead of throwing — the value
 * reaches here from `MailTexts.locale`, which is typed `string`, and a mail that
 * refuses to render is a worse answer than one rendered in the app's own
 * language.
 */
async function mailFooter(
  locale: string,
): Promise<{ line?: string; links: MailLink[]; imprint: string[] }> {
  const loc = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const name = appName();
  const t = await translatorFor(loc, "email");
  return {
    line: name ? t("footerSentBy", { app: name }) : undefined,
    links: await legalFooterLinks(loc),
    imprint: await imprintFor(loc),
  };
}

/**
 * One finished message. Everything above this line composes one; everything
 * below only delivers it.
 *
 * The split exists because not every mail this app sends is a link. The sign-in
 * mail is; the credential-change notice deliberately is NOT, and before the
 * split every transport function took a `url` as its second argument, which
 * left no shape for a mail that must not carry one.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function sendViaPostmark(mail: Mail): Promise<void> {
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN as string,
    },
    body: JSON.stringify({
      From: emailFrom(),
      To: mail.to,
      Subject: mail.subject,
      HtmlBody: mail.html,
      TextBody: mail.text,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Postmark delivery failed (HTTP ${res.status}): ${await res.text()}`);
  }
}

async function sendViaSmtp(mail: Mail): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", // true = 465, otherwise STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  await transport.sendMail({
    to: mail.to,
    from: emailFrom(),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

/** Hands one finished message to whichever transport is configured. */
async function deliver(mail: Mail): Promise<void> {
  if (isPostmarkConfigured()) return sendViaPostmark(mail);
  if (isSmtpConfigured()) return sendViaSmtp(mail);
  throw new Error("No email transport configured (Postmark or SMTP).");
}

/** The sign-in mail's layout, assembled from finished texts. */
async function linkMailLayout(url: string, texts: MailTexts): Promise<MailLayout> {
  const footer = await mailFooter(texts.locale);
  return {
    locale: texts.locale,
    app: appName(),
    salutation: texts.salutation,
    heading: texts.heading,
    paragraphs: [texts.body],
    cta: { label: texts.cta, url },
    fallbackLabel: texts.fallback,
    textIntro: texts.intro,
    note: texts.note,
    footerLine: footer.line,
    footerLinks: footer.links,
    imprint: footer.imprint,
    accent: await emailAccent(),
  };
}

/** Sends the magic link to the destination address. Throws on failure. */
export async function sendLoginEmail(to: string, url: string): Promise<void> {
  const texts = await mailTexts();
  const layout = await linkMailLayout(url, texts);
  return deliver({
    to,
    subject: texts.subject,
    text: renderMailText(layout),
    html: renderMailHtml(layout),
  });
}

// --- Credential-change notice ------------------------------------------------
//
// The second mail this app sends, and the opposite shape from the first.
//
// It exists for one case: somebody who is NOT the account's owner reaches an
// unlocked machine, opens the account page and sets a password on themselves.
// They walk away with a credential that outlives the session they borrowed, and
// without this mail the real owner never finds out. Everything else about the
// design deals with that person having to prove something; this deals with the
// case where they did not have to.
//
// ⛔ IT CARRIES NO LINK, AND MUST NOT GROW ONE. Not a "wasn't me" button, not a
// revoke link, not a login link. A security notice that acts on a click is a
// phishing template with our sender address on it — and one that cannot act is
// useless to forge, which is precisely what makes it safe to send to somebody
// whose account may already be in the wrong hands. lib/email.test.ts asserts it.
// What the recipient does with it is contact the Operator.

/**
 * Every kind of credential change, as a value rather than only a type.
 *
 * It exists so a test can walk it. The texts are looked up with a COMPUTED key
 * (`credentialSubject_${change}`), which no parity check can see: adding a
 * fourth change and forgetting its subject shipped the literal string
 * "email.credentialSubject_emailChanged" as a subject line once already, and
 * every test was green while it did. `i18n/messages.test.ts` now walks this.
 */
export const CREDENTIAL_CHANGES = [
  "passwordSet",
  "passwordChanged",
  "passwordRemoved",
  "emailChanged",
] as const;

/** Which credential moved. Deliberately closed — see the i18n keys below. */
export type CredentialChange =
  | "passwordSet"
  | "passwordChanged"
  | "passwordRemoved"
  /**
   * Sent to the address the account has just LEFT — the only party who needs
   * warning is the one losing the account. It names the address it moved to,
   * deliberately: if this was not the owner, that string is the single most
   * useful thing they can hand the Operator.
   */
  | "emailChanged";

export interface CredentialTexts {
  locale: string;
  subject: string;
  heading: string;
  what: string;
  when: string;
  notYou: string;
  /** Optional branding — the notice renders complete without either. */
  app?: string;
  salutation?: string;
}

async function credentialTexts(
  change: CredentialChange,
  at: Date,
  detail?: string,
): Promise<CredentialTexts> {
  const { getLocale, getTranslations, getFormatter } = await import(
    "next-intl/server"
  );
  const t = await getTranslations("email");
  const format = await getFormatter();
  const name = appName();

  // Pinned to UTC and SAID so in the text. A security notice whose timestamp
  // is ambiguous invites the recipient to talk themselves out of it ("that
  // might have been me, an hour out") — which is the one reaction it exists to
  // prevent.
  const when = format.dateTime(at, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  // The subject names WHICH change, not merely that there was one. It is what
  // the recipient reads in a list of unopened mail, and it is where they decide
  // whether this needs them right now — "a password was created" is alarming to
  // somebody who created none, while a generic "something changed" is not.
  const subject = t(`credentialSubject_${change}`);

  return {
    locale: await getLocale(),
    subject: name ? t("credentialSubjectApp", { subject, app: name }) : subject,
    app: name || undefined,
    salutation: t("salutation"),
    heading: t("credentialHeading"),
    // `emailChanged` is the one that carries a value — the address the account
    // moved to. next-intl requires every placeholder a message declares, so the
    // others are called without one.
    what:
      change === "emailChanged"
        ? t("credential_emailChanged", { email: detail ?? "" })
        : t(`credential_${change}`),
    when: t("credentialWhen", { when }),
    notYou: t("credentialNotYou"),
  };
}

/**
 * The two bodies, built from finished texts. Pure on purpose: this is where the
 * "no link" rule either holds or quietly stops holding, and a pure function is
 * one a test can hold to it.
 */
export function credentialBodies(texts: CredentialTexts): {
  html: string;
  text: string;
} {
  // Same look as every other mail, minus everything clickable: no `cta`, and
  // `footerLinks` deliberately empty — even the Impressum stays out, because
  // the test above this function forbids any URL at all, and it is right to.
  const layout: MailLayout = {
    locale: texts.locale,
    app: texts.app ?? "",
    salutation: texts.salutation,
    heading: texts.heading,
    paragraphs: [texts.what, texts.when],
    note: texts.notYou,
    footerLinks: [],
  };
  return { html: renderMailHtml(layout), text: renderMailText(layout) };
}

/**
 * Tells the Member that a credential on their account changed.
 *
 * Throws like every other send — the CALLER decides that a failure here must
 * not undo the change that has already happened (see
 * app/dashboard/account/actions.ts). Swallowing it in here would hide a broken
 * mail setup from the logs entirely.
 */
export async function sendCredentialChangeEmail(
  to: string,
  change: CredentialChange,
  at: Date,
  /** For `emailChanged`: the address the account moved to. */
  detail?: string,
): Promise<void> {
  const texts = await credentialTexts(change, at, detail);
  const { html, text } = credentialBodies(texts);
  return deliver({ to, subject: texts.subject, text, html });
}

// --- Address-change confirmation ---------------------------------------------

/**
 * The link that actually moves an account, sent to the address it would move
 * TO — and to no other. Following it is the entire proof that the requester can
 * read mail there, which is the one thing standing between this feature and a
 * one-click account transfer for anybody who finds an unlocked screen.
 *
 * This one IS a link, unlike the notice above. The two shapes sit side by side
 * on purpose: what a mail is allowed to contain follows from who is supposed to
 * act on it. Here the recipient must act; there they must only be told.
 */
export async function sendEmailChangeConfirmation(
  to: string,
  url: string,
): Promise<void> {
  const { getLocale, getTranslations } = await import("next-intl/server");
  const t = await getTranslations("email");
  const name = appName();

  const texts: MailTexts = {
    locale: await getLocale(),
    subject: name
      ? t("confirmEmailSubjectForApp", { app: name })
      : t("confirmEmailSubject"),
    salutation: t("salutation"),
    heading: t("confirmEmailHeading"),
    body: t("confirmEmailBody", { email: to }),
    cta: t("confirmEmailCta"),
    fallback: t("fallback"),
    intro: t("confirmEmailText", { email: to }),
    // No extra "didn't ask for this?" line — confirmEmailBody already says it.
  };

  const layout = await linkMailLayout(url, texts);
  return deliver({
    to,
    subject: texts.subject,
    text: renderMailText(layout),
    html: renderMailHtml(layout),
  });
}

// --- Operator mail ------------------------------------------------------------
//
// The fourth sender, and the first one that does not write to a MEMBER. It goes
// to whoever owns this app, about the app's own operation — a queue that needs
// answering, something that stopped working. `lib/notify/operators.ts` is what
// decides who that is, whether the channel is on and whether this message has
// already gone out; this function only renders and hands over.
//
// ── Three properties, and each is a decision ──────────────────────────────
//
//  1. **The locale is a PARAMETER.** Nothing here reads a request — no cookie,
//     no header, no `getLocale`. A job has none of those, and a mail that
//     silently rendered in the default language depending on how the job was
//     triggered is the failure `i18n/translator.ts` was written against.
//  2. **The WORDS belong to the caller.** This takes finished strings. A
//     digest's sentences live in the digest's own namespace in
//     `messages/{de,en}.json`, and it resolves them with the translator the
//     channel hands it — so this file never grows a text key per feature.
//  3. **One address.** Not a list, not a `bcc`. Two operators are third parties
//     to each other, and a collective `to` is the shape in which their addresses
//     become known to one another without anybody having decided that. The loop
//     is in the channel, one `deliver()` per recipient.
//
// ── ⛔ It MAY carry a link, and the credential notice still may not ──────────
// The no-link rule above `sendCredentialChangeEmail` is a statement about THAT
// mail, not about this layout: it goes to somebody whose account may already be
// in the wrong hands, and a security notice that acts on a click is a phishing
// template with our sender address on it. Neither half of that holds here — the
// recipient is the app's owner rather than a possibly compromised customer
// account, and the whole point of the message is that they go and DO something.
// A notice with no way to the thing it is about just moves the work into
// searching.
//
// What follows from that, and it is the actual precaution: this sender does NOT
// use `credentialBodies()` and must never be made to. That function is pure so a
// test can hold it to the rule (`lib/email.test.ts`); the moment it grew an
// optional link, the test would be an assertion about one branch instead of
// about a function.

/** One operator message, with its words already chosen by whoever sends it. */
export interface OperatorMail {
  /** Explicit, always — see property 1 above. */
  locale: Locale;
  subject: string;
  heading: string;
  /** The body, one string per paragraph. Numbers and sentences, never a row. */
  paragraphs: string[];
  /** Optional, and allowed — see the block above. */
  cta?: { label: string; url: string };
}

/**
 * Sends one operator message to one address. Throws like every other send.
 *
 * The caller catches: `notifyOperators()` turns a transport failure into a
 * count, because the provider's own error text names the recipient and that
 * string would otherwise reach `cron_runs.lastDetail`.
 */
export async function sendOperatorMail(to: string, mail: OperatorMail): Promise<void> {
  const t = await translatorFor(mail.locale, "email");
  const footer = await mailFooter(mail.locale);

  const layout: MailLayout = {
    locale: mail.locale,
    app: appName(),
    salutation: t("salutation"),
    heading: mail.heading,
    paragraphs: mail.paragraphs,
    cta: mail.cta,
    // `renderMailText` renders EITHER the button's wording or the paragraphs,
    // never both — which is right for a sign-in mail whose whole body is the
    // link, and wrong for a report whose body is the point. So the text version
    // is handed the paragraphs plus the button's label through the field that
    // exists for exactly this ("the text version's wording in place of button +
    // fallback"). No second renderer, and the html is untouched.
    textIntro: mail.cta ? [...mail.paragraphs, mail.cta.label].join("\n\n") : undefined,
    footerLine: footer.line,
    footerLinks: footer.links,
    imprint: footer.imprint,
    accent: await emailAccent(),
  };

  return deliver({
    to,
    subject: mail.subject,
    text: renderMailText(layout),
    html: renderMailHtml(layout),
  });
}

// --- The Auth.js provider -----------------------------------------------------

/**
 * Builds the Auth.js email provider (magic link). Uses the adapter for the
 * verification tokens (in auth.ts). Returns null if no transport is set.
 */
export function buildEmailProvider(): Provider | null {
  if (!isEmailLoginEnabled()) return null;
  return {
    id: "email",
    type: "email",
    name: "Email",
    from: emailFrom(),
    maxAge: 24 * 60 * 60,
    async sendVerificationRequest({ identifier, url }: { identifier: string; url: string }) {
      await sendLoginEmail(identifier, url);
    },
    options: {},
  } as Provider;
}
