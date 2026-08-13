"use server";

// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The one way a customer reaches a companion.
//
// ── Why a server action and not a second route ─────────────────────────────
// `app/api/chat/route.ts` guards itself in six steps because `proxy.ts` covers
// `/dashboard/:path*` and nothing under `app/api/`. A second public route is a
// second set of those six to get right, and the security gateway's own worked
// example of a finding is *a server action that forgot one*.
//
// **This file is an HTTP endpoint too, and it is not exempt from a single one of
// those checks** — it performs the same ones in the same order. What it avoids
// is a second public URL, a second rate-limit bucket and a second copy of the
// streaming protocol.
//
// It sits at the app root rather than under a route folder, the way
// `app/impersonation-actions.ts` does: it is called from wherever an app puts a
// companion, not from one page.
//
// ⚠️ A `"use server"` file may export **async functions and nothing else** —
// `app/use-server-exports.test.ts` fails the build otherwise, and the real
// failure only surfaces in `npm run build`, naming the page rather than this
// file. So no `const`, no object, no re-export of the registry from here. A
// `type` export is fine: it is erased.
import { askCompanion } from "./companion";
import {
  checkCompanionMessage,
  checkSubject,
  companionHistoryTurns,
  companionInputChars,
  conversationIdFor,
  type CompanionErrorCode,
  type CompanionTurn,
} from "./rules";
import { companionById } from "./companions";
import {
  companionOffReason,
  isCompanionEnabled,
  type CompanionOffReason,
} from "./switch";
import { appendTurn, listConversation } from "@/lib/ai/conversation";
import { chatConfig } from "@/lib/ai/chat-config";
import { CHAT_RATE_BUCKET, chatLimit, trimHistory } from "@/lib/ai/rules";
import { requireActiveUser } from "@/lib/authz";
import { hasPlan } from "@/lib/entitlements/manage";
import { isLimited, record } from "@/lib/rate-limit";
import { getTokenAccount, hasSufficientBalance } from "@/lib/tokens/account";
import { spendTokens } from "@/lib/tokens/spend";
import { TokenError } from "@/lib/tokens/rules";

/**
 * How the customer's own message is labelled inside the fence.
 *
 * App-authored, like every other label: it is written here and never taken from
 * a request.
 */
const CUSTOMER_TURN_LABEL = "What they just wrote";

/**
 * What this call asks — **written by the app, never by the customer.**
 *
 * `CustomerTextRequest.ask` is appended after the fence, so anything placed there is
 * read by the model as instruction. It is therefore a fixed sentence, and the
 * companion's own `instruction` from its registry entry carries everything that
 * varies.
 */
const ASK = "Respond to what they just wrote, following your instructions above.";

export type CompanionAnswer =
  | { ok: true; answer: string }
  | {
      ok: false;
      code: CompanionErrorCode;
      /**
       * Whether the question was already written to the transcript.
       *
       * The surface cannot work this out and must not guess. A refusal that
       * happens **before** the question is stored (not signed in for this
       * companion, rate limited, message too long) leaves nothing behind, so the
       * panel takes its optimistic row back and hands the text to the customer
       * again. A failure **after** it is stored (the model call failed, the
       * charge failed) leaves the question in `chat_messages` — and taking the
       * row back there would show the customer a transcript that a reload
       * contradicts, and offer them a message they have already sent.
       *
       * *"An unanswered question on reload is honest, a vanished one is a bug
       * report"* — this flag is what makes the panel able to keep that promise.
       */
      kept: boolean;
    };

/**
 * What the panel is handed when it opens.
 *
 * A discriminated result rather than a bare list, because `[]` cannot say the
 * difference between *"nothing said yet"* and *"this feature is off"* — and the
 * panel that cannot tell them apart invites the customer to write eight thousand
 * characters and only then says it is unavailable.
 *
 * The reason travels as a CODE. It also keeps AC 8 true: the page still writes
 * `<CompanionPanel companionId subject />` and nothing else, because the state
 * comes back through the action rather than through a prop every call site would
 * have to resolve.
 */
export type CompanionState =
  | { state: "ready"; turns: CompanionTurn[]; maxInputChars: number }
  | { state: "off"; reason: CompanionOffReason | "noAccess" };

/**
 * Ask a companion about one subject.
 *
 * Returns a CODE, never a sentence: this module has no language (AD-10), and
 * `modules/companion/components/companion-panel.tsx` translates through the `errors` namespace.
 */
export async function askCompanionAction(input: {
  companionId: string;
  subject: string;
  message: string;
}): Promise<CompanionAnswer> {
  // 1. Who is asking. `requireActiveUser()` redirects rather than answering a
  //    status, which is the right shape for a form post and the one every other
  //    server action in this app uses.
  const session = await requireActiveUser();
  const memberId = session.user.id;

  // 2. Is the feature on at all? Product half, machine half and a coherent
  //    registry — `isCompanionEnabled()` is the one answer.
  if (!isCompanionEnabled()) return { ok: false, code: "companionUnavailable", kept: false };

  // 3. Is this a companion this app has? One code for "off", "broken" and "no
  //    such id": telling a caller which ids exist is telling them what to try.
  const companion = companionById(input.companionId);
  if (!companion) return { ok: false, code: "companionUnavailable", kept: false };

  // 4. May THIS person use it? `hasPlan` reads `grants` — never a billing
  //    table. `requiresPlan: null` means every signed-in member may.
  if (companion.requiresPlan && !(await hasPlan(memberId, companion.requiresPlan))) {
    return { ok: false, code: "noAccess", kept: false };
  }

  // 5. The cost brake — and it is the CHAT's bucket, deliberately.
  //    One member, one allowance for causing model calls, and it is the same
  //    operator paying whichever surface the call came from. The consequence is
  //    real and is not an oversight: a customer working hard with a companion
  //    has fewer support questions left in the same ten minutes. Do not "fix"
  //    the shared allowance without a measurement behind it.
  //    `maxMessagesPer10Min` stays the right number even where the assistant
  //    herself is switched off — it is the app's answer to "how often may one
  //    member cause a model call".
  const limit = chatLimit(chatConfig().maxMessagesPer10Min);
  if (isLimited(CHAT_RATE_BUCKET, memberId, limit)) {
    return { ok: false, code: "companionRateLimited", kept: false };
  }

  // 6. Is what arrived something we can use? The textarea's `maxLength` is a
  //    hint; this is the check, because this endpoint can be called without the
  //    page ever having been rendered.
  const subject = checkSubject(input.subject);
  if (!subject.ok) return { ok: false, code: subject.code, kept: false };

  const checked = checkCompanionMessage(
    input.message,
    companionInputChars(companion.maxInputChars),
  );
  if (!checked.ok) return { ok: false, code: checked.code, kept: false };

  // 7. Can they afford it? BEFORE the work — check → work → charge. Doing the
  //    work with no check in front gives the answer away for free.
  if (companion.costsTokens > 0) {
    const account = await getTokenAccount(memberId);
    if (!hasSufficientBalance(account?.balance ?? 0, companion.costsTokens)) {
      return { ok: false, code: "companionInsufficientBalance", kept: false };
    }
  }

  record(CHAT_RATE_BUCKET, memberId, limit);

  const conversationId = conversationIdFor(companion.id, subject.subject);

  // What the companion is allowed to see about this subject, read server-side
  // and scoped to this member. `null` is both "no such subject" and "somebody
  // else's" — the same answer, so nothing here enumerates.
  const material = await companion.load({ memberId, subject: subject.subject });
  if (!material) return { ok: false, code: "companionUnavailable", kept: false };

  // What `load()` returned is bounded by the same ceiling as what the customer
  // typed, and for the same reason: it is re-sent on every turn of a
  // conversation. A `load()` handing back a 500 kB submission is an unbounded
  // bill the operator pays, which is exactly the argument `maxInputChars` was
  // written for — and it was previously applied only to the typed half.
  const ceiling = companionInputChars(companion.maxInputChars);
  const loaded = (material.work ?? []).reduce((sum, entry) => sum + entry.text.length, 0);
  if (loaded > ceiling) {
    console.error(
      `[companion] ${companion.id}: load() returned ${loaded} characters, ceiling is ${ceiling}`,
    );
    return { ok: false, code: "companionFailed", kept: false };
  }

  // The question is stored BEFORE the model is asked, for the chat route's
  // reason: an unanswered question on reload is honest, a vanished one is a bug
  // report.
  const questionId = await appendTurn({
    memberId,
    conversationId,
    role: "user",
    content: checked.text,
  });

  const stored = await listConversation(memberId, conversationId);
  // 🚨 The turn just written is EXCLUDED from the history, and that is not an
  // optimisation. What the customer typed travels below as `work`, inside the
  // fence — sending it as history too would put the same text into the request
  // a second time, unfenced, and bill for it twice. Filtered by id rather than
  // by position, because two rows written in the same microsecond have no
  // guaranteed order.
  const history = trimHistory(
    stored
      .filter((turn) => turn.id !== questionId)
      .map((turn) => ({ role: turn.role, content: turn.content })),
    companionHistoryTurns(companion.maxHistoryTurns ?? chatConfig().maxHistoryTurns),
  );

  let answer: string;
  try {
    const result = await askCompanion({
      instruction: companion.instruction,
      about: material.about,
      // 🚨 What the customer wrote goes into `work`, never into `ask`. `work`
      // is the fenced field: `buildFencedRequest` (`lib/ai/customer-text.ts`)
      // wraps every entry in `<customer-text …>` and neutralises the markers,
      // and the core's standing rule names that tag as content rather than
      // instruction. `ask` is appended after the fence and is therefore
      // app-authored by construction — putting a customer's sentence there
      // would hand the one string an attacker fully controls to the model as
      // an instruction.
      work: [...(material.work ?? []), { label: CUSTOMER_TURN_LABEL, text: checked.text }],
      ask: ASK,
      // `askCompanion` takes history ALREADY trimmed — that is the contract
      // `CustomerTextRequest` states, and this is the caller it was written for.
      history,
      memberId,
    });
    answer = result.text;
  } catch (error) {
    // Deliberately vague towards the customer, precise in the log. The reason is
    // routinely an invalid key or a rate limit at the provider, and neither is
    // theirs to read — no provider message, no stack, no model name.
    console.error("[companion] the model call failed:", error);
    return { ok: false, code: "companionFailed", kept: true };
  }

  // An empty answer is a failed answer. Nothing is stored, nothing is charged,
  // and the customer is told it did not work — the alternative is a phantom
  // bubble that vanishes on reload, paid for.
  if (answer.trim() === "") {
    console.error("[companion] the model returned an empty answer:", companion.id);
    return { ok: false, code: "companionFailed", kept: true };
  }

  // Charge BEFORE the answer is stored, and the order is the whole point.
  // Storing first and charging after means a charge that fails — a parallel
  // spend emptied the balance between the check above and here — returns an
  // error to the customer while the answer sits in `chat_messages` waiting for
  // their next page load: the operator paid, the customer got it free, and was
  // told it failed. Charging first can at worst lose a paid answer to a
  // database error, which is far rarer than a balance race.
  if (companion.costsTokens > 0) {
    try {
      // `note` is a LABEL and reaches a subject access request — never what the
      // customer wrote.
      await spendTokens({ amount: companion.costsTokens, note: `companion: ${companion.id}` });
    } catch (error) {
      if (error instanceof TokenError) return { ok: false, code: "companionInsufficientBalance", kept: true };
      // An illegal price is a configuration defect, not a customer's problem —
      // `spendTokens` throws a plain Error for one, deliberately. Report it as a
      // failure rather than letting it escape into a surface that cannot show it.
      console.error("[companion] could not charge for", companion.id, error);
      return { ok: false, code: "companionFailed", kept: true };
    }
  }

  await appendTurn({ memberId, conversationId, role: "assistant", content: answer });

  return { ok: true, answer };
}

/**
 * This member's turns for one subject — what the panel loads when it opens.
 *
 * **No rate limit, deliberately.** It costs no model call and reads only the
 * caller's own rows, which is the same judgement `loadChatAction` already makes.
 */
export async function loadCompanionAction(input: {
  companionId: string;
  subject: string;
}): Promise<CompanionState> {
  const session = await requireActiveUser();
  const memberId = session.user.id;

  // Why the reason and not just an empty list: the panel renders a notice
  // instead of an input box, so the customer learns before they write rather
  // than after they send. `companionOffReason()` exists for exactly this answer
  // and had no caller until now.
  if (!isCompanionEnabled()) {
    return { state: "off", reason: companionOffReason() ?? "disabledInConfig" };
  }

  const companion = companionById(input.companionId);
  if (!companion) return { state: "off", reason: "brokenConfig" };

  if (companion.requiresPlan && !(await hasPlan(memberId, companion.requiresPlan))) {
    return { state: "off", reason: "noAccess" };
  }

  const subject = checkSubject(input.subject);
  if (!subject.ok) return { state: "off", reason: "brokenConfig" };

  const stored = await listConversation(memberId, conversationIdFor(companion.id, subject.subject));
  return {
    state: "ready",
    turns: stored.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content })),
    // Resolved here rather than passed as a prop: the ceiling lives in the
    // registry, the registry is server-side, and a call site that had to look it
    // up would be a call site that can get it wrong.
    maxInputChars: companionInputChars(companion.maxInputChars),
  };
}
