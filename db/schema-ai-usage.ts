// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// One row per model call. The table the AI-costs page is built from.
//
// ── What it is for ─────────────────────────────────────────────────────────
// Before this, the assistant logged one line per answer to `node run.mjs logs`
// and threw the numbers away. That is enough to debug a caching problem and
// nothing at all for the person paying the bill: they could not say what last
// month cost, which feature spent it, or which model. They found out when the
// invoice arrived.
//
// ── It holds NUMBERS, never content ────────────────────────────────────────
// No prompt, no completion, no text a Member submitted. Two reasons, and the
// second is the one that matters: a table with content in it has to be reasoned
// about in `docs/data-protection.md` §7, in the export, in retention, and in
// every future feature that reads it for aggregation. Keeping it to numbers
// means the cost report can be built without a single privacy question. What
// was said is already stored where it belongs — `chat_messages` for the
// assistant, your own tables for anything else.
//
// ── The first table that grows with USAGE ──────────────────────────────────
// Everything else here grows with customers. This grows with calls, and a
// busy app writes a row per model call for ever. `node run.mjs db-prune-ai`
// exists for that, in the shape of `db-prune-ipn`.
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./schema-core";

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // The task, as a plain string and NOT an enum. A customer declaring their
    // own task in lib/ai/task-rules.mjs must not need a migration to do it — an enum
    // would make adding "content.draft" a schema change.
    task: text("task").notNull(),

    // ⚠️ ALWAYS SET, including on calls that never reached a provider (AD-20).
    // The binding is resolved before anything can refuse the call, so a call
    // bound to a provider with no key is still recorded with the provider and
    // model it WOULD have used — which is usually the answer to "why is nothing
    // working". Both columns are NOT NULL so this cannot quietly stop being true.
    provider: text("provider").notNull(),
    model: text("model").notNull(),

    // Whom it was made for, where there was somebody. `set null` on delete and
    // NOT cascade — the opposite of `chat_messages` and the same as `orders`:
    // what the Operator spent is their own accounting record and does not stop
    // being true when a customer leaves. The link goes; the row stays.
    memberId: text("member_id").references(() => users.id, { onDelete: "set null" }),

    // Counts as the provider reported them. Nothing here is estimated.
    // `inputTokens` is the TOTAL including the cached share.
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    thinkingTokens: integer("thinking_tokens").notNull().default(0),
    // Pictures produced. 0 on every text call. A count and not a token,
    // because image models bill per picture — folding it into `output_tokens`
    // would make one column mean two things and mis-price both.
    images: integer("images").notNull().default(0),
    // Billed but not itemised — the standing guard of FR-43a. Expected to stay
    // 0 across all five shipped providers, which is what makes a non-zero
    // reading a signal rather than noise.
    unexplainedTokens: integer("unexplained_tokens").notNull().default(0),

    // Did the provider report any usage at all?
    //
    // Nullable token columns would have said this more directly and would have
    // made every SUM on the cost page a `coalesce`. One boolean instead, and
    // six columns that are always numbers. The distinction matters: zero tokens
    // is a call that consumed nothing, and no usage at all is a call nobody
    // measured — recording the second as the first makes it look free.
    usageReported: boolean("usage_reported").notNull().default(true),

    // Money. NULL when no price is on file — never 0, because "0.00 for a month
    // that cost real money" is worse than saying nothing (AD-17). Filled in by
    // Story 6.5; written null until then.
    costMicros: bigint("cost_micros", { mode: "number" }),
    // Of `costMicros`, and null exactly when it is. On the RECORD rather than on
    // the installation (AD-21): OpenRouter quotes USD whatever the price file
    // says, and a row must stay true after the price table is edited.
    currency: text("currency"),
    // "computed" | "reported" | "none" — so the report can distinguish a figure
    // this app worked out from one the provider stated.
    costSource: text("cost_source").notNull().default("none"),

    // "ok", or one of the codes in lib/ai/providers/types.ts. A failed call
    // gets a row too: the failure rate is exactly what an Operator needs when a
    // provider is having a bad day, and — with no spend ceiling shipping — a
    // runaway is recognised as thousands of rows sharing one outcome.
    outcome: text("outcome").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // ── The indexes, and the query each one exists for ──────────────────────
    //
    // Every one of these is named after a query in `lib/ai/report.ts` or in the
    // pruning job. An index with no query behind it is a write cost nobody
    // asked for, and this is the table that takes the most writes.
    //
    // What they cannot do is worth stating once: a report over a period reads
    // every row in that period, whatever it groups by. These indexes make the
    // period cheap to FIND and the drill-downs cheap to answer; they do not
    // turn a month of calls into a lookup. That is what the retention job is
    // for (`lib/cron/jobs.mjs` → `prune-ai-usage`).

    // Every report starts by cutting the period out, and the prune job scans
    // exactly this. Leading column is the one both range-scan on.
    index("ai_usage_created").on(t.createdAt),

    // "Spend per task over a period" — the page's default grouping, and the
    // per-task drill-down (`callsFor` with `focus.task`).
    index("ai_usage_task_created").on(t.task, t.createdAt),

    // "Spend per provider and model" — the second grouping, and the drill-down
    // behind it. Both columns lead because the page always names them
    // together: a bare `model` index would collide across providers anyway,
    // which is the same reason prices are keyed `provider/model`.
    index("ai_usage_provider_model_created").on(t.provider, t.model, t.createdAt),

    // "Every call with THIS outcome, newest first" — hunting a runaway. With no
    // spend ceiling shipping, that is how one is found: thousands of rows
    // sharing a single outcome on a day that is otherwise flat
    // (`docs/ai-providers.md`).
    //
    // Measured, because the obvious claim about it is wrong: the cost page's
    // own failure count — `outcome <> 'ok'` inside a period, grouped — does
    // NOT use this index and should not. Thirty days out of a year is the
    // narrower cut, so Postgres takes `ai_usage_created` and filters, which at
    // 40k rows is 1.4 ms. What this index is for is the un-periodised
    // equality-plus-order query above: 4.4 ms of sequential scan becomes
    // 0.07 ms of index scan, and that gap grows with the table while the other
    // one does not.
    index("ai_usage_outcome_created").on(t.outcome, t.createdAt),
  ],
);
