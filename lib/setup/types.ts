// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 What a setup tool IS — the contract the core and every module write against.
//
// This is the third delivery layer (spine AD-74). Pages serve a human on a
// session; `/api/v1` serves a member's own program and never accepts an id;
// this serves the OPERATOR's coding agent and accepts ids, because acting on
// somebody else's row is the whole job. That inversion is why the shapes below
// are pinned rather than left to each tool: the surface that takes ids is the
// one where two tools disagreeing about what "done" looks like stops being a
// tidiness problem.
//
// Everything here is data or a pure declaration. A tool's `run` is the only
// place I/O happens, and it is a thin caller of the same `lib/<domain>/manage.ts`
// a page calls — never a second implementation of a rule.

import type { AppEnv } from "@/lib/env-guard";

/**
 * A JSON Schema 2020-12 object schema, as MCP puts it on the wire.
 *
 * Deliberately the literal wire format and not a validation library's type
 * (AD-94): MCP transmits `inputSchema` as JSON Schema, so authoring in anything
 * else means writing a converter — and the unit that hand-writes both drifts
 * from the one that generates one from the other. `zod` is not a dependency of
 * this template and is not introduced for this.
 */
export interface ToolSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, SchemaProperty>>;
  readonly required?: readonly string[];
  /**
   * Always false in practice — `validateInput()` rejects unknown keys whatever
   * this says. It is written out because the value travels to the client, and a
   * schema that claims to accept anything invites a caller to send it.
   */
  readonly additionalProperties?: false;
}

export interface SchemaProperty {
  readonly type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  readonly description?: string;
  readonly enum?: readonly (string | number)[];
  readonly default?: unknown;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: SchemaProperty;
  readonly format?: string;
}

/**
 * What every tool returns, without exception (AD-93).
 *
 * Three tools returning `{ ok: true }`, `{ created, found }` and
 * `{ changes: [...] }` would each satisfy every other rule in the spine and
 * still be incomparable — `setup_audit.rows` becomes underivable, plan and
 * apply differ in shape per tool, and `scripts/mcp/server.mjs`, which holds no
 * domain knowledge on purpose, cannot present what it cannot recognise.
 */
export interface SetupResult {
  readonly mode: "plan" | "apply";
  /** Rows this act created, or would create. */
  readonly created: number;
  /** Rows that already existed — the half of idempotency a caller can see. */
  readonly found: number;
  /** Rows changed in place. */
  readonly changed: number;
  /**
   * The natural keys this act touched — an email, a slug. The audit's `target`
   * is derived from this rather than invented per tool. An act that never
   * finished has no result at all, and there `targetField` below answers the
   * same question off the input.
   *
   * ⚠️ Identifiers, never content. This reaches an audit row and a transcript.
   */
  readonly subjects: readonly string[];
  /**
   * One line of numbers, the `cron_runs.lastDetail` idiom: what happened and
   * how much of it, never what was in it and never anything a member typed.
   */
  readonly detail: string;
  /**
   * Present only on a non-DEV `plan`. Opaque to the caller: store it, echo it,
   * never parse it.
   */
  readonly confirmation?: string;
  /**
   * A refinement of the outcome, on the SUCCESS path — an identifier, never a
   * sentence, never a path (`contentPublishPartial`, and nothing longer).
   *
   * 🚨 It exists because `setup_outcome` is a three-value Postgres enum
   * (`planned | applied | refused`) and a fourth state has to be tellable from
   * the audit row ALONE. A publish that got through two appliers and lost the
   * third is `applied` — and recording it as `applied` with a plausible number
   * and nothing else would make the trail say the publish succeeded. The `code`
   * column is text, is already read on the page and by `list_acts`, and was
   * shipped for exactly this kind of refinement; a new enum value would be a
   * migration, and `applied-in-part` is a refinement of `applied` rather than a
   * peer of it.
   *
   * `dispatch.ts` is what carries it to the row. A tool never writes one.
   */
  readonly code?: string;
  /** A tool's own payload, when it has one. Nothing else interprets this. */
  readonly data?: unknown;
}

/** What a tool is handed. Never a database handle — the tool calls the domain. */
export interface SetupContext {
  /** What the APP resolved, never what the caller claimed (AD-76). */
  readonly appEnv: AppEnv;
  /** The operator this key belongs to, re-read as `owner` at act time (AD-63). */
  readonly ownerId: string;
  /** `plan` reads and reports; `apply` writes. */
  readonly mode: "plan" | "apply";
  /**
   * Bytes, when the call arrived at the multipart door.
   *
   * 🚨 This is the whole of AD-85, and the shape is the point. The tool's
   * SCHEMA declares a `path` — a local file on the developer's machine — and
   * that is what the agent fills in. `scripts/mcp/server.mjs` reads that file
   * and posts it as `multipart/form-data`, carrying the *same* input JSON
   * alongside, so one schema and one canonical hash still describe the call.
   *
   * The app never opens the path and never treats it as a filesystem path: it
   * arrives as text, is length-bounded like any other field, and is used as the
   * act's identifier. The bytes come from the multipart part and nowhere else.
   *
   * Absent when the tool was reached through the JSON-RPC door, which is the
   * refusal a media tool answers there.
   */
  readonly file?: {
    readonly bytes: Uint8Array;
    readonly filename: string | null;
    readonly claimedMime: string | null;
  };
}

export interface SetupTool {
  /**
   * Core tools are `snake_case` verb-on-noun (`user_upsert`). A MODULE's tool
   * must begin with its module id (`community_group_upsert`) — the rule
   * `commands` and `cronJobs` already carry, and what makes the prefix visible
   * in `list_modules`.
   */
  readonly name: string;
  /** One line, shown to the agent choosing a tool. */
  readonly description: string;
  readonly inputSchema: ToolSchema;
  /**
   * 🚨 WHICH of this tool's own input fields names the thing an act is ABOUT —
   * the audit row's `target` on every path that has no `SetupResult` to derive
   * one from. `null` says this tool acts on nothing nameable.
   *
   * It exists because a REFUSED act used to lose its target entirely: the
   * refusal branches in `dispatch.ts` have an error, not a result, so
   * `contentMediaLengthMismatch` said WHAT happened and not to WHICH file. The
   * success path takes `subjects[0]`; this is the same question asked of the
   * INPUT, which is the only thing an act that never finished still has.
   *
   * ⚠️ **Required, and `null` is an answer rather than a default.** That is the
   * whole design: a tool with no natural target says so, and a tool that forgot
   * to decide does not compile — so "this act is about nothing nameable" and
   * "somebody left the identifier out" can never look the same in the trail.
   * `registry.test.ts` holds the other half: a declared field must be a
   * REQUIRED string property of this tool's own schema, so a typo or a field
   * that may be absent is a red suite rather than a silently empty column.
   *
   * ⚠️ Identifiers, never content — the same rule `subjects` carries, and for
   * the same reason: this reaches an audit row that is read by an operator and
   * lives 24 months. A path, an email, a slug, an id. Never prose, and never a
   * field that could carry what somebody wrote.
   */
  readonly targetField: string | null;
  /**
   * False for a read tool. A mutating tool needs plan → confirmation → apply
   * outside DEV (AD-78).
   */
  readonly mutates: boolean;
  /**
   * Refused outside DEV unless `config/setup.json` names it (AD-84).
   *
   * This is for a tool that destroys, not merely one that writes. Note what is
   * NOT expressible here at all: there is no SQL tool, no schema tool and no
   * member deletion, and `SECURITY.md` §8 says why each stays unbuildable.
   */
  readonly destructive?: boolean;
  run(context: SetupContext, input: Record<string, unknown>): Promise<SetupResult>;
}

/** What a module contributes through its manifest's `setup` key (AD-80). */
export interface ModuleSetupTools {
  readonly id: string;
  readonly TOOLS: readonly SetupTool[];
}
