// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The assistant's request pipeline — everything AFTER "who is asking".
//
// Two doors lead here, and they answer the who-question differently:
// `app/api/chat/route.ts` proves a session cookie (`currentActiveUser()`),
// `app/api/v1/chat/messages/route.ts` proves a bearer key (`guardApi()`).
// Everything from "is the feature on" to the NDJSON stream is identical, so
// it lives ONCE — a second copy of this pipeline would be a second place for
// the knowledge check, the plan gate and the rate limit to silently disagree.
//
// The `memberId` handed in is already authenticated by the caller. Both doors
// share `CHAT_RATE_BUCKET` keyed by that member, so web and API draw on ONE
// ceiling by construction — a customer cannot double their allowance by
// asking through their phone.
//
// ── Why the answer is a stream of JSON lines ───────────────────────────────
// A support answer takes seconds to write. Without streaming the page shows a
// spinner for all of them and people press the button again. Each line is one
// JSON object:
//
//   {"type":"delta","text":"…"}   a piece of the answer
//   {"type":"tool","name":"…"}    the assistant is looking something up
//   {"type":"link","marker":"…"}  a page this answer may link to (see below)
//   {"type":"done"}               the answer is complete and stored
//   {"type":"error","code":"…"}   a code from lib/ai/rules.ts, for the client to translate
//
// Errors travel IN the stream rather than as a status code once the response
// has begun: by then the headers are long gone, and a stream that simply stops
// is indistinguishable from a network drop. The `tool` and `link` lines are
// additive — a client that predates either ignores unknown types by design,
// and one that ignores `link` renders the marker as literal text, exactly as
// the Media Marker already degrades on a client that does not know it.
//
// ── Why `link` lines, and why they come FIRST ──────────────────────────────
// The markers a browser may turn into links are composed while the answer is
// being written, from content hits a source really returned for this viewer
// (lib/ai/content-links.ts). They have to cross the same wire the answer does,
// and every one of them has to arrive BEFORE the `delta` that contains it —
// otherwise the customer watches raw bracket text sit there and become a link
// a second later. The drain in the loop below is what guarantees that, and it
// is safe because a marker is offered inside a tool's `execute()`, which
// completes before the next round's first delta.
import { LOCALE_LABELS, type Locale } from "@/i18n/config";
import { hasPlan } from "@/lib/entitlements/manage";
import { isLimited, record } from "@/lib/rate-limit";
import { APP_NAME } from "@/lib/app";
import { chatConfig, isChatEnabled } from "@/lib/ai/chat-config";
import { appendTurn, listConversation } from "@/lib/ai/conversation";
import { createLinkLedger, type LinkLedger } from "@/lib/ai/content-links";
import { loadKnowledge } from "@/lib/ai/knowledge";
import { buildSystemBlocks } from "@/lib/ai/prompt";
import { navMenus } from "@/lib/ai/nav-labels";
import { streamTaskWithTools, type ServerTool } from "@/lib/ai/tool-loop";
import { retriever } from "@/lib/ai/retriever";
import { runTool } from "@/lib/ai/run-tool";
import { TOOLS } from "@/lib/ai/tools";
import { spendTokens } from "@/lib/tokens/spend";
import {
  CHAT_RATE_BUCKET,
  chatLimit,
  checkMessage,
  trimHistory,
  type ChatErrorCode,
} from "@/lib/ai/rules";

// ── The assistant's tools ───────────────────────────────────────────────────
//
// The four standard content tools over the content-source registry
// (lib/ai/tools.ts), executed through `runTool` (lib/ai/run-tool.ts) — the
// path that carries the scope check, the plan gate and the TokenError
// mapping, so a tool an app registers later is enforced exactly as the four
// are. The list here is an ALLOW-list on purpose — a registry entry becoming
// a chat tool is a decision, not an inheritance: what a chat tool returns is
// sent to the AI provider (docs/content-source.md).
//
// The DEFINITIONS are derived once at module load — byte-stable across
// requests, which is the cache condition (see ToolDefinition). What cannot be
// module-level is the member, so `chatToolsFor` binds the session's member
// into each executor per request; the definition objects stay the same.
const CHAT_TOOL_NAMES = ["content_search", "content_get", "content_list", "content_media"];

const CHAT_TOOL_DEFINITIONS = TOOLS.filter((tool) =>
  CHAT_TOOL_NAMES.includes(tool.name),
).map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
}));

function chatToolsFor(memberId: string, links: LinkLedger): ServerTool[] {
  return CHAT_TOOL_DEFINITIONS.map((definition) => ({
    definition,
    execute: async (input) => {
      const outcome = await runTool(definition.name, input, {
        memberId,
        // The session is the member in person — scope "write" as a Server
        // Action's would be. Today's four content tools are all read-only;
        // the scope matters the day somebody registers a charging tool here.
        scope: "write",
        // `spendTokens` authenticates the session — so a charging tool bills
        // the member in person, with a Server Action's guarantee.
        spend: (amount, note) => spendTokens({ amount, note }),
        // THIS request's link ledger — the set of pages this one answer may
        // point at. Bound here for the same reason `spend` is: it belongs to
        // one request, and a tool must have no way to reach another's.
        offerLink: (url, anchor, label) => links.offer(url, anchor, label),
      });
      if (outcome.kind === "unknownTool") return "unknownTool";
      // The model reads the result's text — including refusals, which arrive
      // as `isError` results with a sentence it is meant to act on.
      return outcome.result.content.map((block) => block.text).join("\n");
    },
  }));
}

/** A refusal made before a single token was generated. */
function refuse(code: ChatErrorCode, status: number): Response {
  return Response.json({ type: "error", code }, { status });
}

/**
 * Runs one chat request for an ALREADY AUTHENTICATED member.
 *
 * The order below is not cosmetic — each check is cheaper than the one after
 * it, and the expensive one (an API call somebody else pays for) is last:
 *
 *   feature on?  →  handbook readable?  →  plan held?
 *                →  under the rate limit?  →  is the message sane?  →  ask
 */
export async function runChatRequest(args: {
  memberId: string;
  request: Request;
  /** The reader's language, for the answer. The web door reads the cookie. */
  locale: Locale;
}): Promise<Response> {
  const { memberId, request, locale } = args;

  // 1. Is the feature on at all? Cheap, and it is the answer for an app that
  //    ships with the chat switched off.
  if (!isChatEnabled()) return refuse("chatUnavailable", 503);

  const config = chatConfig();

  // 2. Is there anything to answer from? An assistant with no handbook does not
  //    fail, which is the problem — she invents one.
  const knowledge = loadKnowledge();
  if (knowledge.docs.length === 0) {
    console.error("[chat] the knowledge base is empty or unreadable:", knowledge.problems);
    return refuse("chatNoKnowledge", 503);
  }
  // Reported whenever there are any, not only when EVERY document failed. Nine
  // of ten failing validation used to look exactly like a healthy handbook: she
  // answers confidently from the one that parsed and says "I do not know" to
  // everything the other nine cover, and nothing anywhere says why.
  if (knowledge.problems.length > 0) {
    console.warn(
      `[chat] ${knowledge.problems.length} document(s) are not usable and are not being sent:`,
      knowledge.problems,
    );
  }

  // 3. May THIS person use it? `hasPlan` reads `grants` — never a billing
  //    table. `requiresPlan: null` means every signed-in member may.
  if (config.requiresPlan && !(await hasPlan(memberId, config.requiresPlan))) {
    return refuse("chatNoAccess", 403);
  }

  // 4. The cost brake. Metered per member, not per address: the member id is
  //    what the caller's authentication proves, and it does not change when
  //    they edit their profile. ONE bucket for both doors — see the header.
  const limit = chatLimit(config.maxMessagesPer10Min);
  if (isLimited(CHAT_RATE_BUCKET, memberId, limit)) {
    return refuse("chatRateLimited", 429);
  }

  // 5. Is the message something we can send? The body is whatever the caller
  //    posted — the form's `maxlength` is not a check.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("chatEmptyMessage", 400);
  }
  const checked = checkMessage((body as { message?: unknown } | null)?.message);
  if (!checked.ok) return refuse(checked.code, 400);

  record(CHAT_RATE_BUCKET, memberId, limit);

  // The question is stored BEFORE the model is asked. If the call then fails,
  // the transcript keeps the question rather than losing what somebody typed —
  // an unanswered question on reload is honest, a vanished one is a bug report.
  await appendTurn({ memberId, role: "user", content: checked.text });

  const stored = await listConversation(memberId);
  const history = trimHistory(
    stored.map((turn) => ({ role: turn.role, content: turn.content })),
    config.maxHistoryTurns,
  );

  // Which pages THIS answer may point at. It fills up while she looks things
  // up (`lib/ai/content-links.ts`); nothing else may put a link in her mouth.
  //
  // SEEDED from the turns just loaded, and that is not an optimisation: the
  // model sees its own earlier answers in `history` and will legitimately
  // repeat a marker two turns later without calling a tool again. Without the
  // seed that repeat renders as bracket text, which looks like the feature
  // breaking at random. Every seeded marker was itself once offered by a
  // source, so nothing untrue can enter this way.
  //
  // Seeded from the SAME window the model is given, not from everything
  // `listConversation` returned. That used to be up to CONVERSATION_PAGE_SIZE
  // (100) turns against a history of `maxHistoryTurns` (12 exchanges), which
  // made the sentence above false for every turn outside the window: their
  // markers were re-authorised for this answer and pushed to the browser as
  // `link` lines, although the model could not see the turns they came from.
  // The rule the seed rests on is "she may repeat what she can still read", so
  // the window that decides what she can read decides this too.
  //
  // ⚠️ `maxHistoryTurns` counts EXCHANGES — `trimHistory` keeps `-limit * 2`
  // messages — so the message window is twice the number. Getting that wrong
  // in the tightening direction is the bug this seed exists to prevent: too
  // NARROW a seed and a marker she can still see renders as bracket text.
  // Aligned with `trimHistory` rather than re-derived, at most one turn wider
  // where the window opens on an assistant turn that `trimHistory` then drops
  // to start on a question.
  const links = createLinkLedger(
    stored.slice(-config.maxHistoryTurns * 2).flatMap((turn) => turn.links ?? []),
  );

  const system = buildSystemBlocks({
    // The menu she is allowed to point at, in every language the app speaks —
    // read from `messages/*.json`, not from the handbook, which is written
    // once and in one language. Static, so it stays in the cached half.
    persona: { assistantName: config.name, appName: APP_NAME, menus: navMenus() },
    // The handbook read at step 2, not a second read of it.
    knowledge: await retriever(knowledge).blocks(checked.text),
    context: {
      languageLabel: LOCALE_LABELS[locale],
      // The day only, never the time: an ISO timestamp would be a new value on
      // every request. It sits after the cache breakpoint either way, but a
      // date that changes once a day is also one a human can read in a log.
      today: new Date().toISOString().slice(0, 10),
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        // ONE call, and it names a TASK rather than a model. Which company
        // answers, which model, how many tokens and with what tuning is
        // `config/ai-models.json` → tasks.chat — so an Operator moves her to a
        // different vendor without touching this file. What she IS stays here
        // and in `config/ai-chat.json`: her name, her handbook, her history.
        //
        // The loop may make several provider round-trips (content lookups);
        // each writes its own usage row through the layer, including on the
        // failure path below. There is nothing to log here any more. Narration
        // streamed before a lookup joins the stored answer — she said it, so
        // the transcript keeps it.
        let answer = "";
        let sentLinks = 0;

        for await (const event of streamTaskWithTools(
          "chat",
          { system, messages: history, memberId },
          chatToolsFor(memberId, links),
        )) {
          // Drain FIRST, before anything else in this iteration is sent. A
          // marker is offered inside a tool's `execute()`, which has already
          // finished by the time the next event arrives — so every marker is
          // on the wire strictly before any delta that could contain it, and
          // the customer never sees bracket text turn into a link.
          const offered = links.markers();
          for (; sentLinks < offered.length; sentLinks += 1) {
            send({ type: "link", marker: offered[sentLinks] });
          }

          if (event.type === "delta") {
            answer += event.text;
            send({ type: "delta", text: event.text });
          } else if (event.type === "tool") {
            // The NAME only, never the input — the input is model-authored
            // but may quote what the member typed.
            send({ type: "tool", name: event.name });
          }
        }

        if (answer.trim() !== "") {
          // What she USED, not what she was offered: the transcript records
          // what the answer says. Stored with the words so a reload renders
          // the same links — without this the markers survive and their
          // whitelist does not (db/schema-chat.ts).
          await appendTurn({
            memberId,
            role: "assistant",
            content: answer,
            links: links.used(answer),
          });
        }

        send({ type: "done" });
      } catch (error) {
        // Deliberately vague towards the customer, precise in the log: the
        // reason is routinely an invalid key or a rate limit at the API, and
        // neither is theirs to read. The typed provider outcome is already in
        // the usage row and in the layer's own log line — what reaches the
        // Member stays the one sentence she has always seen.
        console.error("[chat] the model call failed:", error);
        send({ type: "error", code: "chatFailed" satisfies ChatErrorCode });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // The answer is streamed; a proxy that buffers it turns this back into a
      // spinner. nginx honours this one.
      "x-accel-buffering": "no",
    },
  });
}
