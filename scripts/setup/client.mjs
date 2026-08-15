// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Asking an environment over its setup surface — one spelling, for every script.
//
// Two commands here talk to a deployed app through `/api/setup`
// (`content-check` and `content-publish`), and both have to tell three failures
// apart. NFR-60 is the reason this file exists at all:
//
//   · **unreachable** — nothing answered. The address may be wrong, the host
//     may be down, DNS may not resolve. Nobody has learned anything about the
//     app itself.
//   · **the surface is off there, or that app predates it** — a bodiless 404.
//     From outside, a switched-off surface and a build that never had one are
//     deliberately identical (`lib/setup/dispatch.ts` → `surfaceOffResponse()`),
//     so naming both is the honest answer and guessing one would be a claim.
//   · **refused** — the app answered, with a code. It is there, it is on, and it
//     said no.
//
// 🚨 None of the three may ever be printed as "nothing to publish" or "nothing
// to check". They are the same colour as a clean run only if somebody collapses
// them, and a second copy of these sentences is exactly how one of them drifts:
// the wording was already duplicated in `scripts/content/check.mjs` and
// `scripts/setup/check.mjs`, which is a copy per reader.
//
// ⚠️ `scripts/mcp/server.mjs` is deliberately NOT a caller of this file, and
// that is not an oversight. It needs `configured()` for the `env` enum in its
// `tools/list` answer and its own `setup_unavailable` diagnostic — a synthetic
// TOOL rather than a printed line, because an MCP client that receives no tools
// shows the agent nothing at all. Its refusals travel to a model, not to a
// terminal, so they are worded for one; folding the two would mean one of the
// two audiences getting the other's sentences.
//
// Plain Node, no dependency: it runs on Linux, macOS and in a Git Bash on
// Windows, and `fetch()` is built in (CLAUDE.md → *Three systems*).

/**
 * The environments a script can be pointed at, and the `.env` variables each
 * one reads.
 *
 * ⚠️ **The variable NAMES live here beside the values, and that is not
 * decoration.** They were derived once — `APP_URL_${name.toUpperCase()}` — and
 * the refusal then told an operator to set `APP_URL_PRODUCTION` while the code
 * read `APP_URL_PROD`. They would have set it, nothing would have changed, and
 * nothing would have said why. `production` is spelled `PROD` in the `.env`
 * because that is the suffix `DIGISTORE_IPN_PASSPHRASE_PROD` and
 * `MEDIA_S3_*_PROD` already use; a message that guesses it is a message that
 * will be wrong. The same table, with the same reasoning, is in
 * `scripts/mcp/server.mjs` — see the note at the top of this file for why that
 * one stays.
 */
/**
 * How long any setup request may take before it is abandoned.
 *
 * 🚨 One constant, exported, and imported by every caller — never a second
 * number. The four requests on this path (`scripts/setup/check.mjs` twice, this
 * file, and `scripts/mcp/server.mjs`) had NO bound at all until 2026-08-15,
 * while every other request in this template carries one. Sixty seconds rather
 * than the health probes' ten: a setup call runs a real tool at the far end —
 * a publish, an upload — where ten seconds is a normal wait.
 */
export const SETUP_TIMEOUT_MS = 60_000;

export const ENVIRONMENTS = {
  development: { urlVar: "APP_URL", keyVar: "SETUP_KEY" },
  staging: { urlVar: "APP_URL_STAGING", keyVar: "SETUP_KEY_STAGING" },
  production: { urlVar: "APP_URL_PROD", keyVar: "SETUP_KEY_PROD" },
};

/**
 * What `--env` accepts, resolved to the name the APP validates against.
 *
 * The app's guard checks the claim against the three literals and never
 * normalises it (`lib/setup/guard.ts` step 4), so `prod` and `dev` are expanded
 * here or not at all — `parseEnvClaim()` refuses them by name.
 *
 * @param {string|null} asked  the `--env` value, or null for "this machine"
 * @returns {{env: string} | {error: string}}
 */
export function resolveEnvName(asked) {
  const name =
    asked === "prod"
      ? "production"
      : asked === "dev"
        ? "development"
        : (asked ?? "development");
  if (!Object.hasOwn(ENVIRONMENTS, name)) {
    return { error: `unknown environment "${asked}" — development, staging or production` };
  }
  return { env: name };
}

/**
 * The address and key for one environment, or null when the name is not one.
 *
 * @param {string} name
 * @param {Record<string, string|undefined>} e
 */
export function settingsFor(name, e = process.env) {
  const vars = ENVIRONMENTS[name];
  if (!vars) return null;
  return { ...vars, url: e[vars.urlVar], key: e[vars.keyVar] };
}

/**
 * Which environments this machine is set up to reach at all.
 *
 * @param {Record<string, string|undefined>} e
 */
export function configuredEnvironments(e = process.env) {
  return Object.keys(ENVIRONMENTS).filter((name) => {
    const found = settingsFor(name, e);
    return Boolean(found?.url && found?.key);
  });
}

/**
 * Ask one environment to run one tool.
 *
 * @param {string} env  a name out of ENVIRONMENTS
 * @param {{tool: string, mode?: string, confirmation?: string, input?: object}} body
 * @param {{env?: object, fetch?: Function}} [options]  seams, so the refusals
 *   above are testable without a network
 * @returns {Promise<
 *   | {ok: true, status: number, body: object}
 *   | {ok: false, reason: string, lines: string[], exitCode: number, code?: string}
 * >}
 */
export async function callSetup(env, body, options = {}) {
  const e = options.env ?? process.env;
  const send = options.fetch ?? fetch;

  const target = settingsFor(env, e);
  if (!target) {
    return refusal("unknownEnvironment", 2, [
      `unknown environment "${env}" — development, staging or production`,
    ]);
  }
  if (!target.url || !target.key) {
    // Not one of NFR-60's three: nothing was asked, because there was nothing to
    // ask. Named apart so a missing key never reads as an app that refused.
    const missing = [!target.url && target.urlVar, !target.key && target.keyVar].filter(Boolean);
    return refusal("unconfigured", 2, [
      `${env} is not configured — set ${missing.join(" and ")} in .env`,
      `  A key is minted on /dashboard/admin/setup-keys. See docs/setup-mcp.md.`,
    ]);
  }

  const url = `${target.url.replace(/\/+$/, "")}/api/setup`;
  let response;
  try {
    response = await send(url, {
      method: "POST",
      signal: AbortSignal.timeout(SETUP_TIMEOUT_MS),
      headers: { authorization: `Bearer ${target.key}`, "content-type": "application/json" },
      body: JSON.stringify({ env, ...body }),
    });
  } catch (error) {
    // ① unreachable. Nothing has been learned about the app.
    return refusal("unreachable", 1, [`${target.url} did not answer (${error.message})`]);
  }

  // 🚨 A FOURTH exit, and it is the one this file's own doctrine forbids
  // leaving unnamed. `send()` is wrapped; `response.text()` is not, and it
  // throws when the body is cut off mid-stream. That escaped past all three of
  // NFR-60's sentences as a raw undici stack trace — on the commands
  // `content-check --env prod` and `content-publish`, which `CLAUDE.md` names
  // as the exit condition for a go-live. Same defect as `scripts/cron/run.mjs`,
  // measured there.
  let text;
  try {
    text = await response.text();
  } catch (error) {
    return refusal("unreachable", 1, [
      `${target.url} answered ${response.status} and then stopped sending (${error.message}).`,
      `  The connection was cut while the answer was arriving, so nothing was learned`,
      `  about that app. This is a transport fault, not a refusal — try again.`,
    ]);
  }

  // ② the surface is off there, or that app predates it. A bodiless 404 is the
  // switched-off surface saying nothing, deliberately — and from outside it is
  // identical to a route that was never built.
  if (response.status === 404 && text === "") {
    return refusal("surfaceOff", 1, [
      `${env}: the setup surface is off there, or that app predates it.`,
      `  This asks the environment over that surface, so the door has to be open.`,
      `  Switching it on is a deploy: "enabled": true in config/setup.json.`,
    ]);
  }

  if (!response.ok) {
    // ③ refused, with the code the app named.
    let code = text;
    try {
      code = JSON.parse(text).error ?? text;
    } catch {
      /* keep the raw text */
    }
    // The code travels beside the sentence, not only inside it. A caller that
    // has to tell ONE refusal apart from the others — `courses-diff` and
    // `unknownTool`, where "that environment has no `courses` module" must never
    // be read as "that environment has an empty course" — would otherwise have
    // to match the printed line, which is prose and is allowed to change.
    return refusal("refused", 1, [`${env} refused: ${code}`], code);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refusal("refused", 1, [
      `${env} answered ${response.status} with something that is not JSON`,
    ]);
  }

  return { ok: true, status: response.status, body: parsed };
}

/**
 * The code a TOOL refused with, or null when it did not.
 *
 * A tool that refuses answers 200 with `data.refused` (`lib/setup/dispatch.ts`
 * → `domainCodeOf()`), so a caller that only checks `response.ok` reads a
 * refusal as a success. Asked in one place rather than in every loop.
 */
export function toolRefusal(body) {
  const refused = body?.data?.refused;
  return typeof refused === "string" && refused !== "" ? refused : null;
}

/**
 * Plan, then apply with whatever token the plan handed back.
 *
 * Outside DEV a mutating tool needs `plan` → confirmation → `apply`
 * (`lib/setup/guard.ts` step 12); in DEV the plan issues no token and the apply
 * needs none. Written as "pass the confirmation IF there is one" rather than as
 * a branch on the environment, so this file holds no second opinion about which
 * environments relax the rule.
 *
 * ⚠️ It buys neither a human's agreement nor a still-valid plan — the same
 * sentence `docs/setup-mcp.md` carries. It is here because the surface demands
 * it, not because it proves anything.
 */
export async function applyThroughSetup(env, tool, input, options = {}) {
  const planned = await callSetup(env, { tool, mode: "plan", input }, options);
  if (!planned.ok) return planned;
  if (toolRefusal(planned.body)) return { ...planned, plannedOnly: true };

  const confirmation = planned.body?.confirmation;
  const applied = await callSetup(
    env,
    { tool, mode: "apply", input, ...(confirmation ? { confirmation } : {}) },
    options,
  );
  if (!applied.ok) return applied;
  return { ...applied, planned: planned.body };
}

/** Print a refusal's lines and hand back its exit code. */
export function reportRefusal(answer) {
  for (const [index, line] of answer.lines.entries()) {
    console.error(index === 0 ? `✗ ${line}` : line);
  }
  return answer.exitCode;
}

/** @param {string} [code] the error code the app named, where there was one */
function refusal(reason, exitCode, lines, code) {
  return { ok: false, reason, lines, exitCode, ...(code === undefined ? {} : { code }) };
}
