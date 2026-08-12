// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Writing down what a model call consumed.
//
// ── The one rule ───────────────────────────────────────────────────────────
// **Recording must never be able to fail a call.** The answer has already been
// delivered by the time this runs; a database hiccup here would turn a
// successful request into an error the Member sees, over bookkeeping they do
// not care about. So it runs after the response and swallows everything into a
// log line — the same shape `lib/tokens/spend.ts` uses for the auto top-up.
//
// The cost of that choice is stated plainly: a failed write loses a row, and a
// lost row is money the report will never show. That is the right trade in this
// direction — an under-reported cost page is recoverable, a Member seeing
// "something went wrong" after a perfectly good answer is not.
import { after } from "next/server";

import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { unexplainedTokens, type ProviderId, type Usage } from "./providers/types";
import { costOf } from "./prices";

/** Everything one row needs. Assembled by `run.ts`, written here. */
export interface UsageRecord {
  task: string;
  /** ALWAYS set, even when the call never reached a provider (AD-20). */
  provider: ProviderId;
  model: string;
  memberId?: string | null;
  /** Null when the provider reported nothing — which is not the same as zero. */
  usage: Usage | null;
  /** "ok", or a code from `lib/ai/providers/types.ts`. */
  outcome: string;
  latencyMs: number;
}

/**
 * Records one call, after the response has gone out.
 *
 * `after()` from `next/server` is what keeps the write off the request. Outside
 * a request context — a script, a test — `after()` throws, so there is a
 * detached fallback: a top-up must never be the reason a spend fails, and a
 * usage row must never be the reason an answer does.
 */
export function recordUsage(record: UsageRecord): void {
  try {
    after(() => writeQuietly(record));
  } catch {
    void writeQuietly(record);
  }
}

/**
 * The write itself. Awaitable, for scripts and tests that want to be sure.
 *
 * Swallows every failure into a log line — see the note at the top of the file.
 */
export async function writeQuietly(record: UsageRecord): Promise<void> {
  try {
    await db.insert(aiUsage).values(rowFor(record));
  } catch (error) {
    // Visible in `node run.mjs logs`. An Operator whose cost page looks light
    // needs this line to exist; the Member does not need to see it.
    console.error("[ai] could not record usage:", error);
  }
}

/** The row, as pure a function of the record as the schema allows. */
export function rowFor(record: UsageRecord): typeof aiUsage.$inferInsert {
  const usage = record.usage;

  // Money is worked out HERE, at the moment of recording, and never later. A
  // row priced on read would change when the price table is edited — and a cost
  // report whose past moves under you is not an accounting record.
  const cost = costOf(record.provider, record.model, usage);

  return {
    task: record.task,
    provider: record.provider,
    model: record.model,
    memberId: record.memberId ?? null,

    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    thinkingTokens: usage?.thinkingTokens ?? 0,
    images: usage?.images ?? 0,
    unexplainedTokens: usage ? unexplainedTokens(usage) : 0,
    usageReported: usage !== null,

    // NULL when no price is on file — never 0 (AD-17). The currency travels
    // with the figure rather than with the installation (AD-21), so a row stays
    // true after the price table is edited, and an app drawing on providers who
    // bill in different currencies stays honest.
    costMicros: cost.micros,
    currency: cost.currency,
    costSource: cost.source,

    outcome: record.outcome,
    latencyMs: record.latencyMs,
  };
}

/**
 * The one line an Operator sees in `node run.mjs logs`.
 *
 * It names the provider and the model (FR-39a), so the terminal and the cost
 * page can never disagree about what ran. Deliberately one line and
 * grep-friendly: `[ai]` is what somebody searches for at two in the morning.
 */
export function logLine(record: UsageRecord): string {
  const u = record.usage;
  const cost = costOf(record.provider, record.model, u);
  const tokens = u
    ? `in=${u.inputTokens} out=${u.outputTokens} cached=${u.cachedInputTokens}` +
      (u.thinkingTokens ? ` thinking=${u.thinkingTokens}` : "") +
      (u.images ? ` images=${u.images}` : "")
    : "usage=none";

  const money =
    cost.micros === null
      ? "cost=unpriced"
      : `cost=${(cost.micros / 1_000_000).toFixed(6)}${cost.currency}` +
        (cost.source === "reported" ? "(reported)" : "");

  return (
    `[ai] task=${record.task} provider=${record.provider} model=${record.model} ` +
    `${tokens} ${money} ms=${record.latencyMs} outcome=${record.outcome}`
  );
}
