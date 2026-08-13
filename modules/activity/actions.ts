"use server";

// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one way a learner reaches an interactive element.
//
// A server action, not a route under `app/api/` — for the reason
// `app/companion-actions.ts` spells out: `proxy.ts` covers `/dashboard/:path*`
// and nothing under `app/api/`, so a route there is a second set of guards to
// get right, and the security gateway's own worked example of a finding is a
// server action that forgot one. **This file is an HTTP endpoint too**, and it
// performs the same checks in the same order the companion action documents.
//
// It sits at the app root, like `app/companion-actions.ts`: it is called from
// wherever an app renders an element, not from one page.
//
// One companion check has no counterpart here, deliberately: there is no
// feature switch, because an EMPTY registry is the off state — an element
// exists exactly when an entry does.
//
// ⚠️ A `"use server"` file may export **async functions and nothing else** —
// `app/use-server-exports.test.ts` fails the build otherwise. Type exports are
// fine: they are erased.
import { findActivity } from "@/modules/activity/activities";
import { recordSubmission, resultFor } from "@/modules/activity/results";
import {
  ACTIVITY_RATE_BUCKET,
  ACTIVITY_RATE_LIMIT,
  passedFrom,
  subjectProblem,
  type ActivityErrorCode,
} from "@/modules/activity/rules";
import { requireActiveUser } from "@/lib/authz";
import { hasPlan } from "@/lib/entitlements/manage";
import { isLimited, record } from "@/lib/rate-limit";
import { getTokenAccount, hasSufficientBalance } from "@/lib/tokens/account";
import { spendTokens } from "@/lib/tokens/spend";
import { TokenError } from "@/lib/tokens/rules";

/** What the panel is handed when the element opens. */
export type ActivityState =
  | {
      state: "ready";
      /** What the activity's `load()` returned — never includes the answers. */
      data: unknown;
      /** The resume point and the standing the learner left off with. */
      stored: {
        state: unknown;
        attempts: number;
        score: number | null;
        maxScore: number | null;
        passed: boolean | null;
        completedAt: string | null;
      } | null;
      maxAttempts: number | null;
      costsTokens: number;
    }
  | { state: "off"; code: ActivityErrorCode };

export type ActivitySubmitResult =
  | {
      ok: true;
      verdict: {
        final: boolean;
        score: number | null;
        maxScore: number | null;
        passed: boolean | null;
        feedback: string | null;
      };
      attempts: number;
      /**
       * `false`: a concurrent delivery got there first — the verdict may be
       * shown, the attempt was counted at most once, and NOTHING was charged
       * (the 14.2 contract: only a recorded outcome is metered).
       */
      recorded: boolean;
    }
  | { ok: false; code: ActivityErrorCode };

/**
 * What the panel loads on mount. One code for "off", "broken" and "no such
 * id" — telling a caller which ids exist is telling them what to try.
 */
export async function loadActivityAction(input: {
  activityId: string;
  subject: string;
}): Promise<ActivityState> {
  const session = await requireActiveUser();
  const memberId = session.user.id;

  const activity = findActivity(input.activityId);
  if (!activity) return { state: "off", code: "activityUnavailable" };

  if (subjectProblem(input.subject)) return { state: "off", code: "activityBadSubject" };

  if (activity.requiresPlan && !(await hasPlan(memberId, activity.requiresPlan))) {
    return { state: "off", code: "activityNoAccess" };
  }

  // Server-side and member-scoped; `null` is both "no such subject" and
  // "somebody else's", so nothing here enumerates. A throwing load() is an
  // app bug and must land as a sentence, not as a hung "Loading …".
  //
  // No rate limit on this path, and saying so is the point (the companion
  // documents its own exemption the same way): it is one member-scoped read
  // per panel mount, and a limit here would break a member browsing their
  // own units. The brake sits on the submit path, where the work is.
  let data: unknown;
  try {
    data = await activity.load({ memberId, subject: input.subject });
  } catch (error) {
    console.error(`[activity] load() failed for ${activity.id}:`, error);
    return { state: "off", code: "activityFailed" };
  }
  if (data === null) return { state: "off", code: "activityUnavailable" };

  const stored = await resultFor(memberId, input.activityId, input.subject);

  return {
    state: "ready",
    data,
    stored: stored
      ? {
          state: stored.state,
          attempts: stored.attempts,
          score: stored.score,
          maxScore: stored.maxScore,
          passed: stored.passed,
          // Serialised for the wire; a Date through JSON keeps its type
          // annotation and loses its type (`docs/troubleshooting.md` → Dates
          // and raw SQL).
          completedAt: stored.completedAt ? stored.completedAt.toISOString() : null,
        }
      : null,
    maxAttempts: activity.maxAttempts,
    costsTokens: activity.costsTokens,
  };
}

/**
 * One submission. The guard order is the companion action's, step for step —
 * session, registry, plan, brake, input bounds, balance — then the work, then
 * the charge, and **the charge only for an outcome that was recorded**.
 */
export async function submitActivityAction(input: {
  activityId: string;
  subject: string;
  submission: unknown;
}): Promise<ActivitySubmitResult> {
  // 1. Who is submitting. Redirects rather than answering a status — the
  //    shape every server action in this app uses.
  const session = await requireActiveUser();
  const memberId = session.user.id;

  // 2. Is this an element this app has?
  const activity = findActivity(input.activityId);
  if (!activity) return { ok: false, code: "activityUnavailable" };

  // 3. Input bounds, because this endpoint can be called without the page
  //    ever having been rendered — and in the same position the load action
  //    checks them, so the two answer a malformed request with the same code.
  if (subjectProblem(input.subject)) return { ok: false, code: "activityBadSubject" };
  // A submission has a ceiling too — the subject is bounded, and an unbounded
  // payload would reach grade() and could persist multi-MB jsonb state.
  try {
    if (JSON.stringify(input.submission ?? null).length > 64_000) {
      return { ok: false, code: "activityBadSubject" };
    }
  } catch {
    // Circular or unserialisable — could not be stored either.
    return { ok: false, code: "activityBadSubject" };
  }

  // 4. May THIS person use it?
  if (activity.requiresPlan && !(await hasPlan(memberId, activity.requiresPlan))) {
    return { ok: false, code: "activityNoAccess" };
  }

  // 5. The brake — its own bucket, not the chat's: a submission is not a
  //    model call (see rules.ts).
  if (isLimited(ACTIVITY_RATE_BUCKET, memberId, ACTIVITY_RATE_LIMIT)) {
    return { ok: false, code: "activityRateLimited" };
  }

  // 6. Can they afford it? BEFORE the work — check → work → charge.
  if (activity.costsTokens > 0) {
    const account = await getTokenAccount(memberId);
    if (!hasSufficientBalance(account?.balance ?? 0, activity.costsTokens)) {
      return { ok: false, code: "activityInsufficientBalance" };
    }
  }

  record(ACTIVITY_RATE_BUCKET, memberId, ACTIVITY_RATE_LIMIT);

  // 7. The work. `recordSubmission` refuses over-limit attempts before
  //    grading and persists only what `grade()` decided.
  let outcome;
  try {
    outcome = await recordSubmission({
      memberId,
      activityId: input.activityId,
      subject: input.subject,
      submission: input.submission,
    });
  } catch (error) {
    // A throwing grade() (or an authoring bug its verdict check caught) has
    // written nothing and must not charge anything.
    console.error("[activity] submission failed:", error);
    return { ok: false, code: "activityFailed" };
  }

  if (outcome.outcome === "refused") {
    return { ok: false, code: "activityMaxAttempts" };
  }

  // ── From here on, NOTHING throws. ─────────────────────────────────────
  // The attempt is recorded; an error thrown past this line reaches the
  // panel as "activityFailed", whose sentence promises the attempt did not
  // count — and it did. (The companion carries a `kept` flag for the same
  // truth; here the simpler contract is: recorded ⇒ this function returns
  // the verdict, whatever else fails.)

  // 8. The charge — AFTER the work, and ONLY for a recorded, FINAL outcome.
  //    A lost race or a checkpoint costs the vendor a grading, never the
  //    customer a token (the 14.2 contract). A charge that fails — a
  //    concurrent spend won the race, or a misconfigured price — is the
  //    operator's log line: the verdict is already recorded, and clawing it
  //    back would trade a small, rare accounting gap (accepted, decision of
  //    2026-08-01) for a learner told their real result did not happen.
  if (activity.costsTokens > 0 && outcome.recorded && outcome.verdict.final) {
    try {
      await spendTokens({ amount: activity.costsTokens, note: `activity: ${activity.id}` });
    } catch (error) {
      const label = error instanceof TokenError ? error.code : error;
      console.error(`[activity] charge failed for ${activity.id}:`, label);
    }
  }

  let stored = null;
  try {
    stored = await resultFor(memberId, input.activityId, input.subject);
  } catch (error) {
    console.error("[activity] post-submit read failed:", error);
  }

  return {
    ok: true,
    verdict: {
      final: outcome.verdict.final,
      score: outcome.verdict.score ?? null,
      maxScore: outcome.verdict.maxScore ?? null,
      // THIS delivery's judgement — for a recorded outcome it equals the
      // stored row; for a lost race it must not be stitched from the
      // winner's write (a chimera of two submissions).
      passed:
        outcome.recorded
          ? (stored?.passed ?? null)
          : (outcome.verdict.passed ??
             passedFrom(
               outcome.verdict.score ?? null,
               outcome.verdict.maxScore ?? null,
               activity.passMark,
             )),
      feedback: outcome.verdict.feedback ?? null,
    },
    // The current standing, whichever delivery wrote it.
    attempts: stored?.attempts ?? 0,
    recorded: outcome.recorded,
  };
}
