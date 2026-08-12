// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 `guardSetup()` — the ONE door into the setup surface, and the first line
// of every dispatch. `lib/setup/guard-presence.test.ts` reads the handlers
// rather than trusting a list, because the middleware footgun here is
// structural: `proxy.ts` matches `/dashboard` only, so everything under
// `app/api/` is public until it guards itself.
//
// The order below is the design, not an implementation detail. Three points in
// it are load-bearing and are argued where they happen.

import { isLimited, record } from "@/lib/rate-limit";
import { isSetupEnabled, setupConfig } from "./config";
import {
  bearerFrom,
  isDev,
  mayRunDestructive,
  needsConfirmation,
  parseEnvClaim,
  serverEnv,
  setupError,
  validateInput,
} from "./rules";
import { authenticateKey, spendConfirmation } from "./manage";
import type { SetupTool } from "./types";
import type { AppEnv } from "@/lib/env-guard";

/** Per key. Generous — this is a setup session, not a public API. */
const CALL_LIMIT = { max: 120, windowMs: 60_000 };
/** Per origin. A credential factory deserves a narrower door than a read. */
const AUTH_FAIL_LIMIT = { max: 20, windowMs: 15 * 60_000 };

const CALL_BUCKET = "setup:calls";
const AUTH_BUCKET = "setup:authfail";

export type GuardResult =
  | { ok: false; response: Response }
  | {
      ok: true;
      keyId: string;
      ownerId: string;
      appEnv: AppEnv;
      tool: SetupTool;
      mode: "plan" | "apply";
      input: Record<string, unknown>;
    };

export interface SetupRequestBody {
  tool?: unknown;
  env?: unknown;
  mode?: unknown;
  input?: unknown;
  confirmation?: unknown;
}

/**
 * Everything between a request and a tool running.
 *
 * `callerKey` is how the origin is identified for the failure meter — the
 * caller's address, supplied by the route so this stays testable.
 */
export async function guardSetup(args: {
  request: Request;
  body: SetupRequestBody;
  tools: ReadonlyMap<string, SetupTool>;
  callerKey: string;
}): Promise<GuardResult> {
  const { request, body, tools, callerKey } = args;

  // 1. Origin. Absent is fine (a native client sends none); foreign is not.
  //    The DNS-rebinding guard `/api/v1` already makes, for the same reason.
  const origin = request.headers.get("origin");
  if (origin && !originAllowed(origin)) {
    return { ok: false, response: setupError("badRequest", "Origin not allowed.") };
  }

  // 2. The switch, BEFORE the key. A disabled surface never reaches the key
  //    table: off means off for everybody, the operator included — and the
  //    404 must not depend on whether a credential happened to be good.
  if (!isSetupEnabled()) {
    return { ok: false, response: setupError("setupDisabled") };
  }

  // 3. 🚨 The server's own environment, refusing the empty case. `appEnv("")`
  //    is "development", so a deployed host that lost APP_ENV from its secrets
  //    would otherwise be handed every DEV relaxation this surface grants —
  //    single-call mutations and owner promotion included.
  const appEnv = serverEnv(process.env.APP_ENV);
  if (!appEnv) {
    return {
      ok: false,
      response: setupError("envUnset", "APP_ENV is not set on this host."),
    };
  }

  // 4. The caller's CLAIM — validated against a closed set, never normalised.
  //    Running it through appEnv() would make appEnv("banana") === "production"
  //    true and wave a garbled claim through on exactly the environment this
  //    check protects. Validating and normalising are opposite acts.
  const claimed = parseEnvClaim(body.env);
  if (!claimed) {
    return {
      ok: false,
      response: setupError(
        "badRequest",
        'env must be one of: development, staging, production (not "prod" or "dev").',
      ),
    };
  }
  if (claimed !== appEnv) {
    return {
      ok: false,
      response: setupError(
        "envMismatch",
        `This app is ${appEnv}; the call was addressed to ${claimed}.`,
      ),
    };
  }

  // 5. The failed-authentication meter, before the lookup.
  if (isLimited(AUTH_BUCKET, callerKey, AUTH_FAIL_LIMIT)) {
    return { ok: false, response: setupError("rateLimited", undefined, { "retry-after": "900" }) };
  }

  // 6/7. The key. `authenticateKey()` refuses by prefix before any query, and
  //      re-reads the owner's role from the database at this moment.
  const secret = bearerFrom(request.headers.get("authorization"));
  const key = secret ? await authenticateKey(secret) : null;
  if (!key) {
    record(AUTH_BUCKET, callerKey, AUTH_FAIL_LIMIT);
    // One identical 401 for unknown, revoked, expired, blocked and not-an-owner.
    // The reasons live in the server log; telling them apart from outside is a
    // probing tool.
    return { ok: false, response: setupError("unauthorized") };
  }

  // 8. The per-key ceiling.
  if (isLimited(CALL_BUCKET, key.keyId, CALL_LIMIT)) {
    return { ok: false, response: setupError("rateLimited", undefined, { "retry-after": "60" }) };
  }
  record(CALL_BUCKET, key.keyId, CALL_LIMIT);

  // 9. The tool. The surface is enumerated: what is not declared does not exist.
  const name = typeof body.tool === "string" ? body.tool : "";
  const tool = tools.get(name);
  if (!tool) {
    return { ok: false, response: setupError("unknownTool", `No tool named "${name}".`) };
  }

  const mode = body.mode === "apply" ? "apply" : "plan";

  // 10. Destructive tools are refused outside DEV unless named in the config.
  if (tool.destructive && !mayRunDestructive(appEnv, tool.name, setupConfig().allowDestructive)) {
    return {
      ok: false,
      response: setupError(
        "destructiveRefused",
        `"${tool.name}" destroys data and is refused in ${appEnv}. Name it in config/setup.json to allow it.`,
      ),
    };
  }

  // 11. The input, through the tool's own schema. Unknown keys are REJECTED —
  //     a tool argument is written by a model, and silently ignoring a field it
  //     believed in is how a caller comes to think it asked for something else.
  const validated = validateInput(tool.inputSchema, body.input ?? {});
  if (!validated.ok) {
    return { ok: false, response: setupError("badRequest", validated.detail) };
  }

  // 12. Outside DEV, applying needs the token this key was given for THIS tool
  //     and THIS input — and spending it is a conditional UPDATE, not a lookup.
  if (mode === "apply" && needsConfirmation(appEnv, tool.mutates)) {
    if (typeof body.confirmation !== "string" || body.confirmation === "") {
      return {
        ok: false,
        response: setupError(
          "confirmationRequired",
          `Call ${tool.name} with mode "plan" first and pass the confirmation it returns.`,
        ),
      };
    }
    const problem = await spendConfirmation({
      token: body.confirmation,
      keyId: key.keyId,
      tool: tool.name,
      appEnv,
      toolInput: validated.value,
    });
    if (problem) {
      return {
        ok: false,
        response: setupError(
          problem,
          "That confirmation is spent, expired, or was issued for different input.",
        ),
      };
    }
  }

  return {
    ok: true,
    keyId: key.keyId,
    ownerId: key.ownerId,
    appEnv,
    tool,
    mode,
    input: validated.value,
  };
}

/**
 * Same shape as the API module's origin check, and the same reason: a browser
 * on another origin must not be able to drive this, and a foreign `Origin`
 * header is the cheapest tell.
 */
function originAllowed(origin: string): boolean {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** Exported for the guard's own tests. */
export const SETUP_LIMITS = { CALL_LIMIT, AUTH_FAIL_LIMIT, CALL_BUCKET, AUTH_BUCKET };

/** Whether this environment lets a mutation apply in one call. */
export function singleCallApply(appEnv: AppEnv): boolean {
  return isDev(appEnv);
}
