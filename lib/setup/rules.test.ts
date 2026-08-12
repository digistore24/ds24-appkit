// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { appEnv } from "@/lib/env-guard";
import {
  APP_ENVS,
  CONFIRMATION_TTL_MS,
  SETUP_ERROR_CODES,
  SETUP_KEY_PREFIX,
  bearerFrom,
  canonicalInputHash,
  canonicalJson,
  confirmationExpired,
  hashSecret,
  isValidToolName,
  looksLikeSetupKey,
  mayAssignOwner,
  mayRunDestructive,
  moduleToolNameProblem,
  needsConfirmation,
  parseEnvClaim,
  serverEnv,
  setupError,
  setupErrorStatus,
  validateInput,
} from "./rules";
import type { ToolSchema } from "./types";
import {
  IMPERSONATION_RETENTION_MONTHS,
  SETUP_AUDIT_RETENTION_MONTHS,
} from "@/lib/cron/jobs";

describe("the environment claim", () => {
  it("accepts exactly the three canonical literals", () => {
    for (const env of APP_ENVS) expect(parseEnvClaim(env)).toBe(env);
  });

  it("refuses the short forms, because the wire carries one spelling", () => {
    for (const claim of ["prod", "dev", "PRODUCTION", "Staging", "local", "test"]) {
      expect(parseEnvClaim(claim)).toBeNull();
    }
  });

  it("refuses a non-string and the empty string", () => {
    for (const claim of [undefined, null, 1, {}, [], ""]) {
      expect(parseEnvClaim(claim)).toBeNull();
    }
  });

  // 🚨 The reason parseEnvClaim exists at all, stated as a measurement.
  //
  // `appEnv()` maps every unknown string to "production" — correct for reading
  // our own configuration, where a typo should yield the strictest environment.
  // Run over a CLAIM it is the opposite: it would make garbage match on a
  // production host and wave the request through. This test fails the moment
  // somebody "simplifies" parseEnvClaim into a call to appEnv.
  it("does NOT normalise — appEnv would make garbage match production", () => {
    expect(appEnv("banana")).toBe("production");
    expect(appEnv("prod")).toBe("production");
    expect(parseEnvClaim("banana")).toBeNull();
    expect(parseEnvClaim("prod")).toBeNull();
  });
});

describe("the server's own environment", () => {
  it("resolves the values appEnv resolves", () => {
    expect(serverEnv("development")).toBe("development");
    expect(serverEnv("dev")).toBe("development");
    expect(serverEnv("staging")).toBe("staging");
    expect(serverEnv("production")).toBe("production");
  });

  it("treats an unknown value as production, like the rest of the app", () => {
    expect(serverEnv("banana")).toBe("production");
  });

  // 🚨 The hole a reviewer found: appEnv("") is "development", so a deployed
  // host whose APP_ENV never reached the secrets would be handed every DEV
  // relaxation this surface grants — owner promotion included. "Unset" is a
  // third state here and it refuses rather than resolving.
  it("refuses an absent or empty APP_ENV instead of calling it development", () => {
    expect(appEnv("")).toBe("development");
    expect(appEnv(undefined)).toBe("development");
    expect(serverEnv("")).toBeNull();
    expect(serverEnv("   ")).toBeNull();
    expect(serverEnv(undefined)).toBeNull();
  });
});

describe("the key", () => {
  const valid = SETUP_KEY_PREFIX + "a".repeat(43);

  it("accepts its own marker with 43 base64url characters", () => {
    expect(looksLikeSetupKey(valid)).toBe(true);
    expect(looksLikeSetupKey(SETUP_KEY_PREFIX + "aA0_-".padEnd(43, "z"))).toBe(true);
  });

  it("refuses a foreign audience marker before any query could happen", () => {
    expect(looksLikeSetupKey("ds24api_" + "a".repeat(43))).toBe(false);
    expect(looksLikeSetupKey("ds24mcp_" + "a".repeat(43))).toBe(false);
    expect(looksLikeSetupKey("a".repeat(43))).toBe(false);
  });

  it("refuses the wrong length and characters outside base64url", () => {
    expect(looksLikeSetupKey(SETUP_KEY_PREFIX + "a".repeat(42))).toBe(false);
    expect(looksLikeSetupKey(SETUP_KEY_PREFIX + "a".repeat(44))).toBe(false);
    expect(looksLikeSetupKey(SETUP_KEY_PREFIX + "+".repeat(43))).toBe(false);
    expect(looksLikeSetupKey(SETUP_KEY_PREFIX + "=".repeat(43))).toBe(false);
    expect(looksLikeSetupKey(SETUP_KEY_PREFIX + "a".repeat(42) + " ")).toBe(false);
  });

  it("refuses a non-string", () => {
    for (const value of [undefined, null, 1, {}]) expect(looksLikeSetupKey(value)).toBe(false);
  });

  it("hashes deterministically and does not echo the secret", () => {
    const hash = hashSecret(valid);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashSecret(valid));
    expect(hash).not.toContain("a".repeat(43));
  });

  it("reads a bearer header, whatever case the scheme is in", () => {
    expect(bearerFrom(`Bearer ${valid}`)).toBe(valid);
    expect(bearerFrom(`bearer ${valid}`)).toBe(valid);
    expect(bearerFrom(`BEARER   ${valid}`)).toBe(valid);
    expect(bearerFrom(null)).toBeNull();
    expect(bearerFrom(valid)).toBeNull();
    expect(bearerFrom("Basic abc")).toBeNull();
  });
});

describe("the canonical input hash", () => {
  it("does not depend on key order", () => {
    expect(canonicalInputHash({ a: 1, b: 2 })).toBe(canonicalInputHash({ b: 2, a: 1 }));
  });

  it("separates values that differ", () => {
    expect(canonicalInputHash({ email: "a@example.com" })).not.toBe(
      canonicalInputHash({ email: "b@example.com" }),
    );
  });

  it("is stable across nesting and arrays", () => {
    expect(canonicalJson({ b: [3, { d: 4, c: 5 }], a: 1 })).toBe(
      '{"a":1,"b":[3,{"c":5,"d":4}]}',
    );
  });

  // 🚨 The divergence this pinning exists for: hashing the RAW arguments and
  // hashing the schema-applied value give different answers the moment a
  // default is filled — so a plan would mint a token the matching apply could
  // never present. One helper, called by both sides.
  it("differs between raw arguments and the schema-applied value", () => {
    const schema: ToolSchema = {
      type: "object",
      properties: { email: { type: "string" }, role: { type: "string", default: "member" } },
      required: ["email"],
    };
    const raw = { email: "a@example.com" };
    const applied = validateInput(schema, raw);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value).toEqual({ email: "a@example.com", role: "member" });
    expect(canonicalInputHash(raw)).not.toBe(canonicalInputHash(applied.value));
  });

  it("expires a plan that sat too long", () => {
    const issued = new Date("2026-08-09T12:00:00Z");
    const inTime = new Date(issued.getTime() + CONFIRMATION_TTL_MS - 1);
    const late = new Date(issued.getTime() + CONFIRMATION_TTL_MS + 1);
    expect(confirmationExpired(issued, inTime)).toBe(false);
    expect(confirmationExpired(issued, late)).toBe(true);
  });
});

describe("tool names", () => {
  it("accepts snake_case verb-on-noun", () => {
    for (const name of ["user_upsert", "list_modules", "community_group_upsert"]) {
      expect(isValidToolName(name)).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const name of ["User_Upsert", "user__upsert", "_user", "user_", "user-upsert", ""]) {
      expect(isValidToolName(name)).toBe(false);
    }
  });

  it("requires a module's tool to wear its module id", () => {
    expect(moduleToolNameProblem("community", "community_group_upsert")).toBeNull();
    expect(moduleToolNameProblem("community", "group_upsert")).toContain("community_");
    expect(moduleToolNameProblem("community", "user_upsert")).toContain("community_");
  });
});

describe("the policies that are decisions", () => {
  it("allows a destructive tool in DEV, and elsewhere only when named", () => {
    expect(mayRunDestructive("development", "x_purge", [])).toBe(true);
    expect(mayRunDestructive("production", "x_purge", [])).toBe(false);
    expect(mayRunDestructive("production", "x_purge", ["x_purge"])).toBe(true);
    expect(mayRunDestructive("staging", "x_purge", ["y_purge"])).toBe(false);
  });

  // 🚨 AD-92. If this ever returns true for staging or production, the shortest
  // path from a prompt injection to an admin account is open again.
  it("refuses owner promotion outside DEV", () => {
    expect(mayAssignOwner("development")).toBe(true);
    expect(mayAssignOwner("staging")).toBe(false);
    expect(mayAssignOwner("production")).toBe(false);
  });

  it("demands a plan for a mutation outside DEV, and never for a read", () => {
    expect(needsConfirmation("production", true)).toBe(true);
    expect(needsConfirmation("staging", true)).toBe(true);
    expect(needsConfirmation("development", true)).toBe(false);
    expect(needsConfirmation("production", false)).toBe(false);
  });
});

describe("input validation", () => {
  const schema: ToolSchema = {
    type: "object",
    properties: {
      email: { type: "string", minLength: 3, maxLength: 200 },
      role: { type: "string", enum: ["owner", "moderator", "member"], default: "member" },
      count: { type: "integer", minimum: 1, maximum: 10 },
      tags: { type: "array", items: { type: "string" } },
      apply: { type: "boolean" },
    },
    required: ["email"],
    additionalProperties: false,
  };

  it("fills defaults and keeps what was given", () => {
    const result = validateInput(schema, { email: "a@example.com" });
    expect(result).toEqual({ ok: true, value: { email: "a@example.com", role: "member" } });
  });

  // ⚠️ Rejected, not dropped. A tool argument is written by a model, and
  // silently ignoring a field it believed in is how a caller comes to think it
  // asked for something it did not.
  it("REFUSES an unknown key rather than dropping it", () => {
    const result = validateInput(schema, { email: "a@example.com", secret: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("secret");
  });

  it("refuses a missing required field", () => {
    const result = validateInput(schema, {});
    expect(result.ok).toBe(false);
  });

  it("enforces types, bounds and enums", () => {
    expect(validateInput(schema, { email: 1 }).ok).toBe(false);
    expect(validateInput(schema, { email: "ab" }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", count: 0 }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", count: 11 }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", count: 1.5 }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", role: "root" }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", apply: "yes" }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", tags: ["a", 2] }).ok).toBe(false);
    expect(validateInput(schema, { email: "a@example.com", tags: ["a", "b"] }).ok).toBe(true);
  });

  it("refuses anything that is not an object", () => {
    for (const raw of [null, "x", 1, [], undefined]) {
      expect(validateInput(schema, raw).ok).toBe(false);
    }
  });

  // 🚨 AD-85: bytes never travel through the model. There is no base64 field in
  // any tool's schema, so an attempt to send one is refused by the validator
  // rather than by a convention somebody has to remember.
  it("refuses a base64 payload because no schema declares one", () => {
    const result = validateInput(schema, { email: "a@example.com", base64: "AAAA" });
    expect(result.ok).toBe(false);
  });
});

describe("the refusal vocabulary", () => {
  it("has a status for every code, and no duplicates", () => {
    expect(new Set(SETUP_ERROR_CODES).size).toBe(SETUP_ERROR_CODES.length);
    for (const code of SETUP_ERROR_CODES) {
      expect(typeof setupErrorStatus(code)).toBe("number");
    }
  });

  // Off is a 404 and never a 403: while the surface is switched off it does not
  // exist, deliberately indistinguishable from a route that was never built.
  it("answers 404 for a disabled surface", () => {
    expect(setupErrorStatus("setupDisabled")).toBe(404);
    expect(setupErrorStatus("unknownTool")).toBe(404);
  });

  // The app is misconfigured, not the caller wrong — a 400 would point the
  // finger at the request.
  it("answers 500 for an unset APP_ENV and 409 for a mismatch", () => {
    expect(setupErrorStatus("envUnset")).toBe(500);
    expect(setupErrorStatus("envMismatch")).toBe(409);
  });
});

describe("what a switched-off surface says", () => {
  // 🚨 Found by curling the running app, not by reading the code.
  //
  // The surface claims that "off" and "never built" are indistinguishable from
  // outside. A JSON body naming the reason breaks that claim in one line — it
  // tells a stranger the app HAS a setup surface and that it is merely off,
  // which is both an invitation to come back and a hint about which door to
  // work on.
  it("answers 404 with NO body — the claim, made true", async () => {
    const response = setupError("setupDisabled");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("still explains every other refusal, because those callers got in", async () => {
    const response = setupError("envMismatch", "This app is production.");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "envMismatch",
      detail: "This app is production.",
    });
  });
});

describe("the retention floor", () => {
  // 🚨 `retentionMonths: 0` is not a retention setting — it deletes the trail
  // every night while leaving something that looks like a policy in the config.
  // The other prune jobs here accept 0 (`months()` guards only against
  // negatives and `Number(null)`); this one refuses, because what it deletes is
  // the compensating control for a surface that takes ids.
  //
  // Asserted against the CONSTANT rather than by calling the database function,
  // which needs one — the number is what `docs/data-protection.md` quotes.
  it("keeps the record two years, not one", () => {
    expect(SETUP_AUDIT_RETENTION_MONTHS).toBe(24);
    // Longer than everything else here, deliberately: this is the only record
    // of writes an AGENT made to a production database, and the questions it
    // answers — a billing dispute, an audit, "who created my account" — arrive
    // late. A year would end just before they do.
    expect(SETUP_AUDIT_RETENTION_MONTHS).toBeGreaterThan(IMPERSONATION_RETENTION_MONTHS);
  });
});
