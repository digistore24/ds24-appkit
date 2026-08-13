// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Guard → run → record, once.
//
// There are two doors into this surface — JSON for everything, multipart for a
// file — and they must not become two implementations of the same sequence.
// The one that drifts is always the one somebody added later: it forgets the
// audit row, or it records a refusal the other door does not, and then the
// trail describes one door instead of the surface. So both routes are thin
// callers of this.

import { after } from "next/server";
import { guardSetup, type SetupRequestBody } from "./guard";
import { issueConfirmation, memberIdForEmail, recordAct, touchKey } from "./manage";
import { callerKey, needsConfirmation, setupError, type SetupErrorCode } from "./rules";
import { toolsByName } from "./registry";
import { isSetupEnabled } from "./config";
import type { SetupContext, SetupResult, SetupTool } from "./types";

// `callerKey()` moved to ./rules — it is pure and a second reader
// (`lib/diagnostics/guard.ts`) must not reach the database through this file.
// Its reasoning travels with it; see there.
export { callerKey };

/** Only for the refusal record; the guard already refuses an unset APP_ENV. */
function envForRecord(): "development" | "staging" | "production" {
  const raw = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (raw === "development" || raw === "dev" || raw === "local") return "development";
  if (raw === "staging" || raw === "test") return "staging";
  return "production";
}

/**
 * The bodiless 404 a switched-off surface answers, or null when it is on.
 *
 * 🚨 Called as the FIRST line of every door, before any parsing — and that
 * ordering is the whole control, not tidiness.
 *
 * Found by probing the running app: both doors used to parse first, so a
 * stranger got `400 "Body must be JSON."` from one and
 * `400 "Attach the file as the form field file."` from the other. Each of those
 * says out loud that this app HAS a setup surface — which is precisely what the
 * 404 exists not to say. A route that was never built cannot complain about
 * your Content-Type.
 */
export function surfaceOffResponse(): Response | null {
  return isSetupEnabled() ? null : new Response(null, { status: 404 });
}

/**
 * 🚨 What the act was ABOUT, taken from the INPUT — for every path that has no
 * `SetupResult` to take it from.
 *
 * A refused act used to lose its target entirely, and that was the defect: the
 * two branches below hold an error, not a result, so the trail said
 * `content_media_confirm | | refused | contentMediaLengthMismatch` — what
 * happened, never to which file. An operator reading that row cannot act on it,
 * and it is the row they are most likely to be reading.
 *
 * The tool declares WHICH field carries it (`SetupTool.targetField`) rather than
 * this file guessing at a name like `path` or `email`: a guess is a rule nobody
 * declared, it would quietly fit a module's field that means something else, and
 * a fifth domain added next year would fall through it in silence. `null` is a
 * real declaration — `content_publish` takes no input and is about the whole
 * repo — and because the field is required, a tool that has not decided does not
 * compile. So an empty `target` here is always somebody's answer.
 *
 * ⚠️ Not sliced, and that is `guard.ts`'s doing rather than trust: this runs on
 * `validateInput()`'s output, so the value is a declared string bounded by its
 * own schema's `maxLength`. (The guard-refusal branch above, which slices, is
 * the opposite case — it has no validated input and never will.) What it does do
 * is trim and treat an empty string as absent, because a target that is three
 * spaces is worse than none: it looks answered.
 */
function targetFromInput(tool: SetupTool, input: Record<string, unknown>): string | null {
  if (tool.targetField === null) return null;
  const value = input[tool.targetField];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 🚨 The two named exceptions to *identifiers and numbers, never payload* —
 * `role` and `reason` — on **every** path that has validated input.
 *
 * ⚠️ **This is a data-protection decision and not a formatting one, so it is
 * written down.** Both columns are argued by name in
 * `docs/data-protection.md` → *The setup surface* and in `docs/setup-mcp.md` →
 * *The record*: the role IS the security question the trail exists to answer,
 * and a written reason IS the accountability. Until now both were recorded only
 * where the act SUCCEEDED — so a refused `grant_revoke` kept no reason at all,
 * although the tool demanded one before it would run. That left the trail
 * thinnest at exactly the acts somebody later demands an account of: the two
 * tools that carry a reason are the two that touch a person's access, one of
 * them irreversibly.
 *
 * What makes recording it on a refusal defensible rather than merely useful:
 *
 * · it is the SAME value, not a wider class. Here `input` is
 *   `validateInput()`'s output, so `reason` is the tool's own declared string
 *   bounded by its schema (`minLength: 3`, `maxLength: 500`) and `role` is one
 *   of three literals from an enum. Nothing a caller can widen.
 * · it belongs to the member and reaches them. The row is sliceable per person
 *   (`subject_member_id`), so it is in BOTH Art. 15 exports.
 * · it goes when they go: `deleteAccountRow()` empties `setup_audit.reason` for
 *   that member in the same transaction as the delete. The ACT stays and the
 *   prose does not — the sentence `docs/data-protection.md` § 14g makes about
 *   every other reason in this app.
 *
 * 🚨 **The guard's refusal branch does NOT call this, and that line stays.** It
 * runs before `validateInput()` has judged anything: there may be no tool at
 * all, and `body.input` is whatever a stranger posted — unbounded, untyped, and
 * chosen by somebody who need not even hold a key. Writing that into a trail
 * whose rule is "identifiers and numbers" would let an unauthenticated caller
 * choose what these columns say.
 */
function accountability(input: Record<string, unknown>): {
  role: string | null;
  reason: string | null;
} {
  return {
    role: typeof input.role === "string" ? input.role : null,
    reason: typeof input.reason === "string" ? input.reason : null,
  };
}

/**
 * 🚨 WHO the act was about, as a `users.id` — the column both Art. 15 exports
 * slice on.
 *
 * The same two-source shape `target` has, and for the same reason: what an act
 * DID beats what it was asked to do. A tool that learns the member by acting
 * hands it back in its result (`grant_revoke` reads it off the grant row); every
 * other one declares the input field that carries the ADDRESS, and the lookup
 * happens here — once, on every path, including the refusals where the tool
 * itself never looked.
 *
 * ⚠️ `null` is written for an address that matches no account, and that is not
 * the same statement as a tool with no subject at all: the declaration says
 * which of the two a row is, and `target` still holds the address that matched
 * nobody. Never a guess, and never the address itself — the column is a foreign
 * key, and a row pointing at an account that does not exist is worse than an
 * empty one.
 *
 * ⚠️ It never throws. A lookup that failed must not turn an act — least of all
 * a refusal — into a 500; the trail loses one column and says nothing untrue.
 */
async function subjectMemberIdFor(
  tool: SetupTool,
  input: Record<string, unknown>,
  result?: SetupResult,
): Promise<string | null> {
  if (result?.subjectMemberId) return result.subjectMemberId;
  if (tool.subjectEmailField === null) return null;
  const value = input[tool.subjectEmailField];
  if (typeof value !== "string") return null;
  try {
    return await memberIdForEmail(value);
  } catch (error) {
    console.error("[setup] could not resolve the subject of an act", tool.name, error);
    return null;
  }
}

export async function runSetupCall(args: {
  request: Request;
  body: SetupRequestBody;
  /** Bytes, when this came through the multipart door. */
  file?: SetupContext["file"];
}): Promise<Response> {
  const { request, body, file } = args;

  const guard = await guardSetup({
    request,
    body,
    tools: toolsByName(),
    callerKey: callerKey(request),
    // 🚨 The bytes reach the guard, not only the tool (A79). A confirmation at
    // the multipart door is bound to the payload as well as to the input, and
    // the guard is where both acts of the protocol meet — see step 12 there.
    file,
  });

  if (!guard.ok) {
    // 🚨 A refusal by the GUARD is recorded too, and this is exactly why
    // `setup_audit.key_id` is nullable: the call you most want on the record is
    // the one made with a key that does not exist.
    const code = await guard.response
      .clone()
      .json()
      .then((json: { error?: string }) => json.error ?? null)
      .catch(() => null);

    // ⚠️ No `target` on THIS branch, and it is a different answer from the
    // declared `null` below rather than the same omission. A guard refusal
    // happens before `validateInput()` has judged anything: there may be no
    // tool at all (`unknownTool`), and `body.input` is whatever a stranger
    // posted — unbounded, untyped, and not necessarily an identifier. Writing
    // it into a trail whose rule is "identifiers and numbers, never content"
    // would let an unauthenticated caller choose what that column says. Which
    // tool was named is recorded (sliced), and that is what this branch knows.
    //
    // Nothing is written for a switched-off surface. While off it does not
    // exist — a row per probe would let an outsider fill this table from
    // outside, and the 404 carries no body for the same reason.
    if (code && code !== "setupDisabled") {
      after(async () => {
        try {
          await recordAct({
            keyId: null,
            ownerId: null,
            appEnv: envForRecord(),
            tool: typeof body.tool === "string" ? String(body.tool).slice(0, 120) : "(none)",
            outcome: "refused",
            code: code as SetupErrorCode,
          });
        } catch {
          /* recording must never turn a refusal into a 500 */
        }
      });
    }
    return guard.response;
  }

  const { tool, mode, input, appEnv, keyId, ownerId, payloadSha } = guard;

  try {
    const result = await tool.run({ appEnv, ownerId, mode, file }, input);

    // A non-DEV plan of a mutating tool hands back the token its apply needs.
    //
    // ⚠️ Not for a plan that REFUSED, and that clause is the same signal read
    // once. A token is a capability with two minutes on it
    // (`CONFIRMATION_TTL_MS`); minting one for an act the tool has just
    // declined offers a second act that will decline identically, and puts the
    // capability in a transcript for nothing. Measured before it was written: a
    // `user_upsert` refused for owner promotion in production handed back a
    // confirmation, and the apply that spent it was refused again. An operator
    // whose refusal has since been resolved plans again — which is what re-reads
    // the state anyway.
    //
    // 🚨 `payloadSha` comes off the GUARD and is not computed again here: it is
    // what the `apply` will be checked against, so a second spelling of it would
    // be a plan and an apply that can disagree about the same file (A79).
    const confirmation =
      mode === "plan" && !result.refused && needsConfirmation(appEnv, tool.mutates)
        ? await issueConfirmation({ keyId, tool: tool.name, appEnv, toolInput: input, payloadSha })
        : undefined;

    await recordAct({
      keyId,
      ownerId,
      // WHO it was about, so the member's own Art. 15 export can find it.
      subjectMemberId: await subjectMemberIdFor(tool, input, result),
      appEnv,
      tool: tool.name,
      // Derived from the result rather than invented per tool — which is the
      // reason SetupResult pins `subjects` at all. The declared field is the
      // fallback and not the source: what an act DID is a better answer than
      // what it was asked to do, and `content_publish` proves the difference —
      // its subjects are the applier labels it actually ran, and no input names
      // them. Written this way so one invariant holds on every path: a tool that
      // declares a target field always records one.
      target: result.subjects[0] ?? targetFromInput(tool, input),
      // One spelling of the two named exceptions, so the success path and the
      // refusal paths cannot drift into recording different things.
      ...accountability(input),
      // 🚨 A tool that REFUSED by answering is recorded as a refusal, and this
      // is the whole of A75. Five branches — `ownerPromotionRefused`,
      // `notFound`, `badRequest`, `noUploadAddress`, `appliersUnreadable` —
      // hand back a `SetupResult` rather than throwing, so this path is the one
      // that runs and it used to write `applied`/`planned` with `code: null`.
      // Measured against a real database, all five. `docs/setup-mcp.md`'s
      // four-state table has always said a refusal before any write is
      // `refused` carrying the refusal's code; this makes the trail say it.
      //
      // ⚠️ Read off `SetupResult.refused`, a DECLARED field, and never guessed.
      // `created === 0` is also what an honest no-op success looks like — a
      // `user_upsert` of somebody who already has that role is `applied` with
      // no rows — and a `detail` beginning "refused:" is prose. A53 settled the
      // same question for `target`: the tool says, this file does not read tea
      // leaves.
      outcome: result.refused ? "refused" : mode === "apply" ? "applied" : "planned",
      // 🚨 Two things in one column, and they cannot collide: `refused` REPLACES
      // the outcome, `code` REFINES it. The refinement is here rather than as a
      // fourth enum value because `setup_outcome` has three, an enum value is a
      // migration, and the one state that could not otherwise be told from this
      // row is a publish that got through half its appliers — `applied` with a
      // plausible number and no code would say the act succeeded. A refusal
      // never has a partial to report, so the `??` is an ordering and not a
      // choice. An identifier, never a sentence — `SetupResult` says so of both.
      code: (result.refused ?? result.code ?? null) as SetupErrorCode | null,
      rows: result.created + result.changed,
    });

    after(async () => {
      try {
        await touchKey(keyId);
      } catch {
        /* a bookkeeping column must never fail a call */
      }
    });

    return Response.json(confirmation ? { ...result, confirmation } : result);
  } catch (error) {
    // 🚨 A DOMAIN refusal is an answer, not a crash — and treating it as one
    // was a real defect, found by uploading a file.
    //
    // Every domain in this app throws a typed error carrying a code:
    // `MediaError("fileDamaged")`, `UserError("invalidEmail")`,
    // `GrantError("unknownProduct")`, `TokenError("tokensNotSold")`. Letting
    // those fall into the branch below turned every one of them into
    // `500 "The tool failed. The server log has the reason."` — which is
    // exactly the sentence an agent cannot act on, about a refusal that was
    // perfectly actionable. The caller here is a program: hand it the code.
    //
    // The vocabulary stays the domain's own (`fileDamaged`, `invalidEmail`),
    // not translated into SETUP_ERROR_CODES. That is AD-95's line held
    // correctly: the guard's refusals are this surface's vocabulary, and a
    // refusal from a tool that RAN belongs to whatever domain refused — the
    // same choice `/api/v1`'s media endpoints already make.
    const domainCode = domainCodeOf(error);
    if (domainCode) {
      await recordAct({
        keyId,
        ownerId,
        subjectMemberId: await subjectMemberIdFor(tool, input),
        appEnv,
        tool: tool.name,
        // 🚨 WHAT it was refused ABOUT. Without this the row said
        // `contentMediaLengthMismatch` and not which of forty files — see
        // `targetFromInput()`.
        target: targetFromInput(tool, input),
        ...accountability(input),
        outcome: "refused",
        // The audit's `code` column is text, and a domain code is what actually
        // happened. Widening SETUP_ERROR_CODES to hold every domain's
        // vocabulary would make that union a union of unions.
        code: domainCode as SetupErrorCode,
      }).catch(() => {});
      return Response.json({
        mode,
        created: 0,
        found: 0,
        changed: 0,
        subjects: [],
        // ⚠️ The code, and the domain's sentence WHEN it wrote one. Every
        // shipped domain error is `super(code)` — `UserError`, `GrantError`,
        // `TokenError` and `MediaError`'s one-argument form all say so in the
        // same comment — so for those two this reads exactly as it always did.
        // A domain that deliberately wrote a sentence (`MediaError`'s second
        // argument, `PublishError`'s refusals) has one worth carrying: the
        // caller here is a program that has to act on the answer, and
        // "appliersUnreadable" on its own does not say WHICH directory could
        // not be read. `data.refused` stays the bare code, so nothing that
        // branches on it is affected.
        detail:
          error instanceof Error && error.message !== "" && error.message !== domainCode
            ? `refused: ${domainCode} — ${error.message}`
            : `refused: ${domainCode}`,
        data: { refused: domainCode },
      });
    }

    // Recorded for the failure too — an act that threw halfway is exactly what
    // somebody goes looking for afterwards, and it is also the row that most
    // needs to say WHICH thing was half done.
    await recordAct({
      keyId,
      ownerId,
      subjectMemberId: await subjectMemberIdFor(tool, input),
      appEnv,
      tool: tool.name,
      target: targetFromInput(tool, input),
      ...accountability(input),
      outcome: "refused",
      code: "internal",
    }).catch(() => {});
    console.error("[setup] tool failed", tool.name, error);
    return setupError("internal", "The tool failed. The server log has the reason.");
  }
}

/**
 * The code a typed domain error carries, or null for a genuine crash.
 *
 * Recognised by SHAPE rather than by `instanceof`, on purpose: importing
 * `MediaError`, `UserError`, `GrantError` and `TokenError` here would make this
 * file depend on four domains in order to tell an answer from an accident, and
 * the fifth domain — the one a module adds next year — would silently fall
 * through into a 500. Every one of them is `class X extends Error` with a
 * `readonly code`, so the shape is the contract.
 *
 * ⚠️ Deliberately narrow: a plain `Error` has no `code`, and a Node system
 * error's code (`ENOENT`, `ECONNREFUSED`) is not a domain refusal — those are
 * crashes and must stay 500s, or a broken database connection would be reported
 * to an agent as a polite "no".
 */
export function domainCodeOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (!error.name.endsWith("Error") || error.name === "Error") return null;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== "string" || code === "") return null;
  // A system error's code is SCREAMING_SNAKE; a domain code is camelCase.
  if (/^[A-Z0-9_]+$/.test(code)) return null;
  return code;
}
