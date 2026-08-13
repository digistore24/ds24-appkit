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
  /**
   * 🚨 The code this act was REFUSED with — for a tool that refuses by
   * ANSWERING rather than by throwing.
   *
   * Set, the trail records `outcome: refused` and this as its `code`; absent, it
   * records `applied` or `planned` as the mode says. It is the ONLY thing that
   * tells the two apart on this path, and it is a declared field for the same
   * reason `targetField` is one: the alternative is `dispatch.ts` guessing — off
   * `created === 0`, which is also a perfectly honest no-op success, or off a
   * `detail` beginning "refused:", which is prose.
   *
   * 🚨 **It exists because five branches were being recorded as successes.**
   * `user_upsert` refusing an owner promotion, `grant_by_hand` finding no such
   * member, `media_upload` reached through the door that carries no bytes,
   * `content_media_url` on a driver that cannot mint one, and `content_publish`
   * unable to enumerate its own appliers all hand back a `SetupResult` instead
   * of throwing — so `dispatch.ts` read them as successes and wrote
   * `applied`/`planned`, `code: null`, `rows: 0`. Measured against a real
   * database, all five. `docs/setup-mcp.md`'s four-state table has always said a
   * refusal before any write is `refused` with the refusal's code; the code
   * disagreed with it at five places, in the sharpest column the trail has.
   *
   * ⚠️ **Returning rather than throwing is the right shape and stays.** A
   * refusal that is an ANSWER carries what an exception cannot: `subjects`, so
   * the row names what it was about; and a payload the caller acts on —
   * `content_media_url` hands back the two ways forward by name, and
   * `scripts/content/publish.mjs` branches on it. What was wrong was never the
   * tools' shape but that the trail could not see it.
   *
   * ⚠️ An identifier, never a sentence — the same rule `code` above carries, and
   * for the same reason: it lands in a text column an operator reads and it
   * lives 24 months. It is also NOT the wire signal: `data.refused` is what
   * `scripts/setup/client.mjs` → `toolRefusal()` reads, this is what the trail
   * reads, and a tool that refuses sets both where it already set one.
   */
  readonly refused?: string;
  /**
   * The MEMBER this act was about, as a `users.id` — for a tool that learns the
   * id only by ACTING.
   *
   * 🚨 The result-side half of `SetupTool.subjectEmailField`, and the reason
   * both exist: `setup_audit.subject_member_id` is a foreign key on `users.id`,
   * while a tool's input names a person by ADDRESS or not at all. `grant_revoke`
   * is the case that needs this one — its input is a grant id, and which member
   * that grant belongs to is a property of the row, read while the act runs.
   *
   * ⚠️ An id this app issued, never anything a caller sent. `dispatch.ts`
   * prefers it over the declared field for the same reason it prefers
   * `subjects[0]` over `targetField`: what an act DID is a better answer than
   * what it was asked to do.
   */
  readonly subjectMemberId?: string;
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
   * 🚨 WHICH of this tool's own input fields names the MEMBER an act is about,
   * **as an email address**. `null` says this tool never acts on one person.
   *
   * It is a second declaration and not a synonym for `targetField`, because the
   * two answer different questions and are different KINDS of value. `target` is
   * a natural key an operator reads — an address, a slug, a path, a grant id.
   * `setup_audit.subject_member_id` is a foreign key on `users.id`, and it is
   * what makes the trail sliceable per person: `lib/privacy/export.ts` and
   * `scripts/privacy/export-data.mjs` both cut the `setupActs` section with
   * `where subject_member_id = <memberId>`. `docs/data-protection.md` calls that
   * column "what makes the section sliceable per person" — and until this
   * declaration existed nothing wrote it, so that section was EMPTY in both
   * Art. 15 exports of every app while rows about the person sat in the table.
   *
   * ⚠️ **An address is not an id**, which is why this names a field rather than
   * carrying one: the id is known only after somebody has looked, and
   * `dispatch.ts` does that lookup once, on every path — including the refusals,
   * where the tool may not have looked at all.
   *
   * ⚠️ **Required, and `null` is an answer.** The same design `targetField`
   * carries: `content_publish` acts on a repo, `list_modules` on an
   * environment, and a tool that has not decided does not compile. So an empty
   * `subject_member_id` is never "somebody forgot".
   *
   * 🚨 **A null column has two readings and the row tells them apart.** A tool
   * that declares `null` here can never name a member — `describeTools()`
   * carries the declaration, so the surface says so without running anything.
   * A tool that declares a field and still records `null` LOOKED and found
   * nobody: its `target` holds the address that matched no account. Both are
   * honest, and neither is silence.
   *
   * A tool that learns the member by acting fills `SetupResult.subjectMemberId`
   * instead — `grant_revoke`, whose input names a grant.
   */
  readonly subjectEmailField: string | null;
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
