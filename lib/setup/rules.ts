// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The pure half of the setup surface. No I/O, no database, no `process.env`
// read that is not handed in — everything here is a function of its arguments,
// so every rule that matters can be tested without a running app.
//
// What lives here is the part of the surface that is a DECISION rather than a
// query: which refusals exist, what an environment claim may say, how an input
// is hashed so plan and apply cannot disagree, what a tool's name may be, and
// what a schema accepts. `manage.ts` does the writing; `guard.ts` asks these
// questions in order.

import { createHash } from "node:crypto";
import type { AppEnv } from "@/lib/env-guard";
import type { SchemaProperty, ToolSchema } from "./types";

// ── refusals ────────────────────────────────────────────────────────────────

/**
 * The ONE refusal vocabulary for this surface (AD-95).
 *
 * A module tool refuses with a code from here and never from its own manifest
 * `errorCodes` export, which stays what it has always been: the member-facing
 * vocabulary `i18n/messages.test.ts` walks. Two lawful vocabularies for one
 * caller is two things to match on, and the caller here is a program.
 *
 * Deliberately NOT in the i18n registry, exactly as `/api/v1` decided: these
 * are English codes for a machine, and `detail` is a courtesy for whoever is
 * reading a terminal. Appended to, never renamed.
 */
export const SETUP_ERROR_CODES = [
  "setupDisabled",
  "badRequest",
  "unauthorized",
  "notOwner",
  "envUnset",
  "envMismatch",
  "rateLimited",
  "unknownTool",
  "destructiveRefused",
  "ownerPromotionRefused",
  "confirmationRequired",
  "confirmationInvalid",
  "notFound",
  "conflict",
  "internal",
] as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[number];

const STATUS_FOR: Record<SetupErrorCode, number> = {
  // 404 and not 403: while the surface is off it does not exist, and from
  // outside that is deliberately indistinguishable from never having been
  // built. `node run.mjs setup-check` is what tells the two apart.
  setupDisabled: 404,
  badRequest: 400,
  unauthorized: 401,
  notOwner: 403,
  // 500, because this is the app misconfigured rather than the caller wrong:
  // a deployed host with no APP_ENV is broken, and saying 400 would point the
  // finger at the request.
  envUnset: 500,
  envMismatch: 409,
  rateLimited: 429,
  unknownTool: 404,
  destructiveRefused: 403,
  ownerPromotionRefused: 403,
  confirmationRequired: 428,
  confirmationInvalid: 403,
  notFound: 404,
  conflict: 409,
  internal: 500,
};

export function setupErrorStatus(code: SetupErrorCode): number {
  return STATUS_FOR[code];
}

/**
 * A guard refusal, on the wire.
 *
 * The dividing line AD-95 draws: a refusal from the GUARD is an HTTP status
 * with `{ error, detail }` — the caller never got in — and the MCP server turns
 * it into a JSON-RPC error. A refusal from a tool that RAN is a normal result
 * carrying the code, because the call succeeded and the answer was no. That is
 * also the line `setup_audit` records as `refused` versus an outcome.
 */
export function setupError(
  code: SetupErrorCode,
  detail?: string,
  headers: Record<string, string> = {},
): Response {
  // 🚨 `setupDisabled` answers with NO BODY, and that is the difference between
  // claiming indistinguishability and having it.
  //
  // While the surface is off it is supposed to look exactly like a route that
  // was never built. A JSON body reading `{"error":"setupDisabled"}` says the
  // opposite out loud: it tells an outsider that this app HAS a setup surface
  // and that it is merely switched off — which is an invitation to come back,
  // and a hint about which door to work on. Found by curling the endpoint
  // rather than by reading the code, which is why the endpoint gets curled.
  //
  // The operator loses nothing: they ask `node run.mjs setup-check`, where they
  // are already authenticated by having a shell.
  if (code === "setupDisabled") {
    return new Response(null, { status: 404, headers });
  }
  return Response.json(detail ? { error: code, detail } : { error: code }, {
    status: STATUS_FOR[code],
    headers,
  });
}

// ── the environment ─────────────────────────────────────────────────────────

/** The closed set. Not `prod`, not `dev`, not `PRODUCTION`. */
export const APP_ENVS = ["development", "staging", "production"] as const;

/**
 * The environment the CALLER claims to be addressing — validated, never
 * normalised (AD-76).
 *
 * 🚨 This must not go through `appEnv()`, and the reason is the whole point of
 * the check. That function maps every unknown string to `"production"`, which
 * is right for reading our own configuration — a typo in a deployment should
 * yield the strictest environment — and catastrophic for reading a claim:
 * `appEnv("banana") === "production"` is true, so a garbled claim would MATCH
 * on a production host and be waved through. Validating a claim and
 * normalising a value are opposite acts.
 */
export function parseEnvClaim(value: unknown): AppEnv | null {
  return typeof value === "string" && (APP_ENVS as readonly string[]).includes(value)
    ? (value as AppEnv)
    : null;
}

/**
 * The server's own environment, refusing the empty case (AD-76).
 *
 * `appEnv("")` returns `"development"` (`lib/env-guard.ts`), which is correct
 * everywhere else — somebody who never wrote the variable is somebody on a
 * laptop. Here it is not: a deployed host whose `APP_ENV` never made it into
 * the secrets would be handed every relaxation this surface grants DEV,
 * including AD-92's owner promotion. So "unset" is a third state, and it is the
 * dangerous one.
 */
export function serverEnv(raw: string | undefined): AppEnv | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "development" || v === "dev" || v === "local") return "development";
  if (v === "staging" || v === "test") return "staging";
  return "production";
}

/** DEV is the only environment with relaxations, and only when it says so. */
export function isDev(env: AppEnv): boolean {
  return env === "development";
}

// ── the key ─────────────────────────────────────────────────────────────────

/**
 * Its own audience and its own marker (AD-77).
 *
 * A credential must not widen by being pasted somewhere else, which is why this
 * surface gets a prefix of its own rather than reusing the API module's
 * `ds24api_`. The prefix is checked before any query, so a key wearing a
 * foreign marker never becomes a database round trip.
 */
export const SETUP_KEY_PREFIX = "ds24setup_";
export const SETUP_KEY_BYTES = 32;

const KEY_BODY = /^[A-Za-z0-9_-]{43}$/;

export function looksLikeSetupKey(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith(SETUP_KEY_PREFIX)) return false;
  return KEY_BODY.test(value.slice(SETUP_KEY_PREFIX.length));
}

/** The stored form. The secret itself is shown once and never written down. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** `Authorization: Bearer …` → the token, or null. Case-insensitive scheme. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Who the failure meter counts against.
 *
 * Behind a proxy the socket address is the proxy's, so the forwarded address is
 * what identifies a caller. Both are spoofable by anybody who can set headers —
 * this is a meter, not an authentication, and what it protects is the key
 * table's patience rather than the key itself.
 *
 * ⚠️ **It lives here, in the PURE file, and not beside its first caller.** It
 * was in `lib/setup/dispatch.ts`, which imports `./guard` → `./manage` → the
 * database. `lib/diagnostics/guard.ts` needs the same meter key and must answer
 * when the database does NOT — an unreachable Postgres is one of the failures
 * that command exists to report, so a diagnostics route that drags a driver in
 * is the one design guaranteed to be silent at the moment it matters
 * (`app/api/diagnostics/no-db.test.ts` fails the build on it). Two functions
 * that agree today is the other way to get this wrong, so there is one, here.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

// ── the confirmation token's input hash ─────────────────────────────────────

/**
 * The canonical form an input is hashed in (AD-78).
 *
 * 🚨 Pinned, because "normalised" is a word two implementations read
 * differently: the core hashing the raw `arguments` and a module hashing the
 * schema-applied value differ on every filled default, so a plan would issue a
 * token that the matching apply could never present. One helper, called by
 * both, and never a second spelling of it.
 *
 * Keys ascending by code unit, no whitespace, and the input is already through
 * `validateInput()` — defaults filled, unknown keys gone.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function canonicalInputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

/** How long a plan stays applicable. Short on purpose — see AD-78. */
export const CONFIRMATION_TTL_MS = 120_000;

export function confirmationExpired(issuedAt: Date, now: Date): boolean {
  return now.getTime() - issuedAt.getTime() > CONFIRMATION_TTL_MS;
}

// ── tool names ──────────────────────────────────────────────────────────────

const TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function isValidToolName(name: string): boolean {
  return TOOL_NAME.test(name) && name.length <= 64;
}

/**
 * A module's tool must wear its module's id (AD-80) — the rule `commands` and
 * `cronJobs` already carry, and the reason a reader of `list_modules` can see
 * at a glance which half of the app a tool came from.
 */
export function moduleToolNameProblem(moduleId: string, name: string): string | null {
  if (!isValidToolName(name)) {
    return `"${name}" is not a tool name — lower case, digits and single underscores`;
  }
  if (!name.startsWith(`${moduleId}_`)) {
    return `"${name}" must start with "${moduleId}_" — a module's tools carry its id, so nobody has to guess where one came from`;
  }
  return null;
}

// ── the policies that are decisions rather than checks ──────────────────────

/**
 * A destructive tool runs in DEV, or where the operator named it (AD-84).
 *
 * `allowDestructive` is a list of NAMES rather than a boolean, so switching one
 * on is a statement about one tool instead of a mood about the surface.
 */
export function mayRunDestructive(
  env: AppEnv,
  toolName: string,
  allowed: readonly string[],
): boolean {
  return isDev(env) || allowed.includes(toolName);
}

/**
 * 🚨 Nobody becomes an operator through this surface outside DEV (AD-92).
 *
 * The shortest path from prompt-injected text to an account takeover: the agent
 * driving these tools reads what other people wrote — community posts, a
 * member's own `name`, support mail — and a tool that can write `role='owner'`
 * turns any of it into an admin account. The two-act protocol does NOT close
 * this: an autonomous agent calls plan and apply two seconds apart, so the
 * token proves the server was consulted, not that a human agreed.
 *
 * DEV is exempt because the first account there already becomes owner by itself
 * (`lib/users/bootstrap.ts`), so refusing would protect nothing and cost the
 * setup path its main job — the same shape as the development sign-in: a
 * capability that exists in exactly one environment, with the condition
 * written down rather than implied.
 */
export function mayAssignOwner(env: AppEnv): boolean {
  return isDev(env);
}

/** A mutation needs a plan first, everywhere but DEV (AD-78). */
export function needsConfirmation(env: AppEnv, mutates: boolean): boolean {
  return mutates && !isDev(env);
}

// ── input validation (AD-94) ────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; detail: string };

/**
 * JSON Schema 2020-12, the subset a setup tool may use, applied by hand.
 *
 * The coercer-with-bounds pattern `config/community.json`'s reader already
 * uses, pointed at input instead of configuration — and no dependency, because
 * the wire format already decided the language (AD-89, AD-94).
 *
 * ⚠️ Unknown keys are REJECTED, not dropped. A tool argument is written by a
 * model, and silently ignoring a field it believed in is how a caller comes to
 * think it asked for something it did not.
 */
export function validateInput(schema: ToolSchema, raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, detail: "input must be an object" };
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(schema.properties, key)) {
      return { ok: false, detail: `unknown field "${key}"` };
    }
  }

  for (const [key, property] of Object.entries(schema.properties)) {
    const present = Object.hasOwn(input, key) && input[key] !== undefined;
    if (!present) {
      if (property.default !== undefined) out[key] = property.default;
      else if (schema.required?.includes(key)) {
        return { ok: false, detail: `"${key}" is required` };
      }
      continue;
    }
    const problem = checkValue(key, property, input[key]);
    if (problem) return { ok: false, detail: problem };
    out[key] = input[key];
  }

  return { ok: true, value: out };
}

function checkValue(key: string, property: SchemaProperty, value: unknown): string | null {
  const { type } = property;

  if (type === "array") {
    if (!Array.isArray(value)) return `"${key}" must be an array`;
    if (property.items) {
      for (const [i, item] of value.entries()) {
        const problem = checkValue(`${key}[${i}]`, property.items, item);
        if (problem) return problem;
      }
    }
    return null;
  }

  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? null
      : `"${key}" must be an object`;
  }

  if (type === "boolean") {
    return typeof value === "boolean" ? null : `"${key}" must be true or false`;
  }

  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `"${key}" must be a number`;
    }
    if (type === "integer" && !Number.isInteger(value)) {
      return `"${key}" must be a whole number`;
    }
    if (property.minimum !== undefined && value < property.minimum) {
      return `"${key}" must be at least ${property.minimum}`;
    }
    if (property.maximum !== undefined && value > property.maximum) {
      return `"${key}" must be at most ${property.maximum}`;
    }
    return enumProblem(key, property, value);
  }

  if (typeof value !== "string") return `"${key}" must be a string`;
  if (property.minLength !== undefined && value.length < property.minLength) {
    return `"${key}" must be at least ${property.minLength} character(s)`;
  }
  if (property.maxLength !== undefined && value.length > property.maxLength) {
    return `"${key}" must be at most ${property.maxLength} character(s)`;
  }
  return enumProblem(key, property, value);
}

function enumProblem(
  key: string,
  property: SchemaProperty,
  value: string | number,
): string | null {
  if (!property.enum) return null;
  return property.enum.includes(value)
    ? null
    : `"${key}" must be one of: ${property.enum.join(", ")}`;
}
