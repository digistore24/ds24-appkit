// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use server";

import { unstable_rethrow } from "next/navigation";

// Server actions of the Member's own account page.
//
// SECURITY — the difference from the admin actions next door is worth stating,
// because it is easy to copy the wrong shape:
//
//  1. `requireActiveUser()` rather than `requireOwner()`. These belong to every
//     signed-in Member, not to the Operator. It still runs FIRST on every
//     action — a server action is an HTTP endpoint of its own, and the page
//     having guarded itself protects nothing here.
//  2. **The account acted on is always the session's own.** No action takes a
//     user id from the form, and none may ever start doing so. That is what
//     makes an IDOR impossible rather than merely unlikely: there is no
//     parameter to tamper with.
//
// THIS FILE SENDS MAIL, and the neighbouring admin actions must not — the
// difference is the point, not an inconsistency. lib/entitlements/leak-guard.test.ts
// forbids the mailer in `admin/users/[id]/actions.ts` because a balance
// correction is something an OPERATOR did to a customer, and a mail about it
// would explain a change the customer never asked about. A credential change is
// something done to the MEMBER'S OWN way in, and the whole reason to send it is
// the case where the Member did not do it.
//
// LANGUAGE: here — and only here — the codes from lib/credentials/rules.ts
// become sentences, in the language of the Member currently clicking.
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { headers } from "next/headers";

import { requireActiveUser } from "@/lib/authz";
import { setPassword, removePassword } from "@/lib/credentials/manage";
import { CredentialError } from "@/lib/credentials/rules";
import { requestEmailChange } from "@/lib/email-change/manage";
import { EmailChangeError } from "@/lib/email-change/rules";
import type { CredentialChange } from "@/lib/email";

const PAGE = "/dashboard/account";

/**
 * Absolute base for the confirmation link.
 *
 * `APP_URL` first because it is the deliberate answer — it is what the operator
 * configured and what every other outbound URL in this app uses. The request's
 * own origin is the fallback for a local machine where the app moved to another
 * port before `.env` caught up.
 */
async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Tells the Member their credentials moved — and NEVER lets that failure undo
 * the change itself.
 *
 * The order is deliberate: the password is already written when this runs. If
 * the notice cannot go out — no transport configured locally, provider down,
 * mailbox full — the Member has still changed their password, and telling them
 * otherwise would be a lie that also loses the change. So this swallows
 * everything and leaves a log line instead.
 *
 * The mail is loaded at runtime: `lib/email` reaches for `nodemailer`, and a
 * static import here would drag it into this module's graph for the sake of a
 * path that most installations never take.
 */
async function notify(
  email: string | null,
  change: CredentialChange,
): Promise<void> {
  if (!email) return;
  try {
    const { sendCredentialChangeEmail, isEmailLoginEnabled } = await import(
      "@/lib/email"
    );
    // No transport (a DEV machine before `node run.mjs mail-setup`) is a normal
    // state here, not an error — do not log it as one.
    if (!isEmailLoginEnabled()) return;
    await sendCredentialChangeEmail(email, change, new Date());
  } catch (error) {
    console.error(
      `[account] credential notice to ${email} (${change}) could not be sent:`,
      error,
    );
  }
}

/** Return value for useActionState — `error`/`ok` are finished messages. */
import type { ActionState } from "@/lib/action-state";

// Re-exported so the components beside this file keep importing it from here.
// 🚨 WITH the `from` clause, and that is not a style choice. Written
// `export type { ActionState };` — a re-export of a LOCAL binding — Turbopack's
// "use server" transform emits the bare identifier into the server entry list
// (`ensureServerEntryExports([…, ActionState])`) where nothing defines it, and
// the first POST to ANY action in the file dies with
// `ReferenceError: ActionState is not defined`. Measured in this template's own
// production build; `scripts/server-actions.test.ts` now refuses the form.
export type { ActionState } from "@/lib/action-state";

/** Turn an error from the rules/database layer into a displayable message. */
async function toState(error: unknown): Promise<ActionState> {
  // redirect() signals by THROWING — that is how requireActiveUser() sends a
  // signed-out or blocked visitor to /login. Swallowing it would turn a
  // legitimate redirect into "unknown error".
  unstable_rethrow(error);
  const t = await getTranslations("errors");
  if (error instanceof CredentialError) return { error: t(error.code), ok: null };
  if (error instanceof EmailChangeError) return { error: t(error.code), ok: null };

  console.error("[account] unexpected error:", error);
  return { error: t("unknown"), ok: null };
}

/**
 * Sets a first password, or replaces an existing one.
 *
 * Which of the two it is comes from the database, never from the form: a form
 * that claimed "no password yet" would otherwise be a way to skip proving the
 * current one.
 */
export async function setPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireActiveUser();
    const { email, created } = await setPassword(session.user.id, {
      password: String(formData.get("password") ?? ""),
      confirmation: String(formData.get("confirmation") ?? ""),
      current: String(formData.get("current") ?? ""),
    });
    await notify(email, created ? "passwordSet" : "passwordChanged");
    revalidatePath(PAGE);
    const t = await getTranslations("account");
    return { error: null, ok: t("passwordSaved") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Asks to move the account to a new address.
 *
 * Nothing about the account changes here — not the address, not what can sign
 * in. All this does is record the wish and put a link in the new mailbox. If
 * the link is never followed, nothing ever happens.
 *
 * A failed send DOES fail this action, unlike the credential notice. The
 * difference: there the change had already happened and hiding a mail failure
 * would have lost it. Here the mail IS the mechanism — reporting success while
 * no link went anywhere would leave the Member waiting for a mail that does not
 * exist.
 */
export async function requestEmailChangeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireActiveUser();
    const { newEmail, token } = await requestEmailChange(
      session.user.id,
      formData.get("email"),
    );

    const url = `${await appOrigin()}/account/confirm-email?token=${encodeURIComponent(token)}`;
    const { sendEmailChangeConfirmation } = await import("@/lib/email");
    await sendEmailChangeConfirmation(newEmail, url);

    revalidatePath(PAGE);
    const t = await getTranslations("account");
    return { error: null, ok: t("emailChangeRequested", { email: newEmail }) };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Removes the password. Magic-link sign-in is untouched, so the account never
 * ends up without a way in — which is the whole reason this is safe to offer
 * as a plain toggle rather than as a dangerous operation.
 */
export async function removePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireActiveUser();
    const { email } = await removePassword(session.user.id, {
      current: String(formData.get("current") ?? ""),
    });
    await notify(email, "passwordRemoved");
    revalidatePath(PAGE);
    const t = await getTranslations("account");
    return { error: null, ok: t("passwordRemoved") };
  } catch (error) {
    return toState(error);
  }
}

/**
 * Deletes the signed-in member's own account — Art. 17 GDPR, self-service.
 *
 * ── It takes no id, and the FormData is not read at all ───────────────────
 * `deleteOwnAccount()` acts on the session and nothing else. Not even a
 * confirmation string travels here: the confirmation is the AlertDialog, and a
 * value in the form would be a value somebody can supply directly.
 *
 * ── It ends by signing out, and that is not tidiness ──────────────────────
 * Sessions are JWTs. The row is gone the moment the delete returns, but the
 * cookie in the browser still says who they were and stays valid until it
 * expires. Every page would then run its queries against a member id that no
 * longer resolves — a signed-in user of an account that does not exist, which
 * is a state nothing in this app is written for.
 *
 * `signOut({ redirectTo })` throws a redirect, so nothing after it runs and
 * this function never returns normally on success. That is why the toast is on
 * the LANDING page rather than here: there is no page left to show it on.
 */
export async function deleteOwnAccountAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const { deleteOwnAccount } = await import("@/lib/users/manage");
    await deleteOwnAccount();
  } catch (error) {
    // `unstable_rethrow` first: `toState` would otherwise swallow the redirect
    // Next.js throws, and the deletion would look like a failure.
    unstable_rethrow(error);
    return toState(error);
  }

  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/" });
  return { error: null, ok: null };
}
