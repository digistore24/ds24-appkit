// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One real model call, on purpose, so that somebody can find out whether the
// key they pasted in actually works.
//
//   POST /api/diagnostics/ai        { "task": "chat" }
//   Authorization: Bearer <DIAGNOSTICS_SECRET>
//
// Read it with `node run.mjs ai-check --live`. Nothing else calls this.
//
// ── Why the check comes through the APP and not straight out of the script ──
//
// `node run.mjs ai-check` is plain Node and could reach a provider by itself in
// twenty lines. It must not, and the rule is not a style preference: **no call
// site in this app names a provider, builds a vendor client or reads an API
// key** (CLAUDE.md → *Talking to a language model*), and
// `lib/ai/providers/leak-guard.test.ts` fails the build over it. A script that
// did its own HTTP would be a second way to call a model — one that agrees with
// `runTask()` until the day somebody changes a header, and one whose calls
// appear in no `ai_usage` row and on no cost page.
//
// So the check asks the running app, and the app calls `runTask()`. That is the
// same trade `scripts/cron/run.mjs` makes for the jobs, in its own words: one
// registry, one runner, and a manual run exercises the real path rather than a
// second implementation of it. The cost is that `--live` needs the app up; the
// command says so, by name, when it is not.
//
// ── It guards itself ───────────────────────────────────────────────────────
//
// `proxy.ts` matches `/dashboard` only, so everything under `app/api/` is
// public until it protects itself. Here that is `guardDiagnostics()` on the
// first line — the same bodiless 404 for a missing header, a wrong secret and
// an unset `DIAGNOSTICS_SECRET` alike, indistinguishable from a route that was
// never built. The shipped state is exactly that: `.env.example` carries the
// variable commented out.
//
// ⚠️ **This is the one diagnostics door that SPENDS MONEY**, which is why it
// has a meter of its own on top of the guard's. The guard's meter counts failed
// authentications; this one counts successful calls, because the failure mode
// here is not somebody guessing the secret — it is a loop, a retry storm or a
// forgotten watchdog holding a valid one.
//
// ── What it deliberately does not do ───────────────────────────────────────
//
//   · **No image task.** A picture is billed per picture and a probe that draws
//     one costs real cents rather than a fraction of one; `notATextTask` is a
//     refusal naming the task, not a silent skip.
//   · **No member.** `memberId` is null: nothing about anybody is sent, and the
//     row that is written says the call belonged to no customer.
//   · **No prompt of the caller's.** The body chooses a TASK and nothing else.
//     A door that let a caller pass arbitrary text to a paid model with only a
//     host secret in front of it is a door with a different threat model.
import { runTask } from "@/lib/ai/run";
import { bindingFor, isTaskId, type TaskId } from "@/lib/ai/tasks";
import { ProviderError } from "@/lib/ai/providers/types";
import { PROBE_MAX_TOKENS, PROBE_MESSAGE, PROBE_SYSTEM } from "@/lib/ai/probe.mjs";
import { TASKS, kindOfTask } from "@/lib/ai/task-rules.mjs";
import { guardDiagnostics } from "@/lib/diagnostics/guard";
import { isLimited, record } from "@/lib/rate-limit";
import { callerKey } from "@/lib/setup/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How often one caller may spend money here.
 *
 * Twelve in a quarter of an hour is far more than a person running the command
 * by hand, and far less than a loop. It counts every call that got as far as a
 * provider — successful or refused — because a key that answers 401 is billed
 * for nothing and retried just as hard.
 */
const SPEND_LIMIT = { max: 12, windowMs: 15 * 60_000 };
const SPEND_BUCKET = "diagnostics:ai";

/** How much of the model's answer travels back. Proof it spoke, not its output. */
const SAMPLE_CHARS = 60;

/**
 * The task named in the body, or why it cannot be probed.
 *
 * Both refusals name what IS possible — `known` — because the caller on the
 * other end is a command that can print it, and "unknown task" on its own sends
 * somebody to grep the tree.
 *
 * `known` is the tasks that can be PROBED and not every task this app declares:
 * offering `image` in the answer to one refusal and refusing it in the next is
 * a list that costs somebody a second round trip to learn nothing.
 */
const PROBEABLE = TASKS.filter((id) => kindOfTask(id) === "text");

function taskFrom(body: unknown): { task: TaskId } | { error: string; known: string[] } {
  const asked = (body as { task?: unknown } | null)?.task;
  const task = typeof asked === "string" ? asked.trim() : "";

  if (!isTaskId(task)) return { error: "unknownTask", known: PROBEABLE };
  // An image task resolves, binds and prices like any other — and costs a
  // hundred times as much to probe. Refused by name rather than skipped.
  if (kindOfTask(task) !== "text") return { error: "notATextTask", known: PROBEABLE };
  return { task };
}

export async function POST(request: Request): Promise<Response> {
  const refusal = guardDiagnostics(request);
  if (refusal) return refusal;

  // Past the guard the caller is authenticated, so a spoken 429 tells a
  // stranger nothing — they never get here. `guardDiagnostics()` answers its own
  // refusals with the one silent 404 and that stays untouched.
  const caller = callerKey(request);
  if (isLimited(SPEND_BUCKET, caller, SPEND_LIMIT)) {
    return Response.json({ error: "rateLimited" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const chosen = taskFrom(body);
  if ("error" in chosen) return Response.json(chosen, { status: 400 });

  const { task } = chosen;

  // Resolved BEFORE the call, exactly as `run.ts` resolves it, so a failure can
  // still be reported with the provider and model it would have used — which is
  // usually the answer to "why is nothing working" (FR-39a).
  const binding = bindingFor(task);
  const started = Date.now();
  record(SPEND_BUCKET, caller, SPEND_LIMIT);

  try {
    const answer = await runTask(task, {
      system: [{ text: PROBE_SYSTEM }],
      messages: [{ role: "user", content: PROBE_MESSAGE }],
      maxTokens: PROBE_MAX_TOKENS,
      // Nobody's call. The row records no member, and nothing about anybody is
      // sent to the provider.
      memberId: null,
    });

    return Response.json({
      ok: true,
      task,
      provider: answer.provider,
      model: answer.model,
      latencyMs: Date.now() - started,
      usage: answer.usage,
      // The model's own reply to our own prompt — never a Member's text, and
      // truncated because what is wanted is proof that it spoke.
      said: answer.text.trim().slice(0, SAMPLE_CHARS),
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      // 🚨 **200, and the reason is the whole point of this endpoint.** A status
      // outside 2xx here would mean "the app could not answer"; this is the app
      // answering, in full, that it reached the provider layer and was turned
      // away. Collapsing the two would leave the command unable to tell a wrong
      // key from a door that is not there — which is the one distinction it
      // exists to make.
      return Response.json({
        ok: false,
        task,
        provider: binding.provider,
        model: binding.model,
        latencyMs: Date.now() - started,
        outcome: error.code,
      });
    }

    // Not the provider — the app. The detail goes to the log, where
    // `node run.mjs errors` will find it, and never into the response.
    console.error("[ai] the live probe failed before the provider layer:", error);
    return Response.json({ error: "callFailed" }, { status: 500 });
  }
}
