// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading `config.json` — the judgements, with the file handed in.
//
// ── Why the raw object is a PARAMETER ──────────────────────────────────────
// Two runtimes read this config: the app, which imports the JSON through the
// bundler, and `node run.mjs metrics-report`, which is bare Node and reads the
// file off disk. Neither of those is a judgement about the contents, so neither
// belongs here. What belongs here is what the values MEAN — and there is one
// copy of that, or the command and the dashboard would disagree about whether an
// experiment is running.
//
// `./config.ts` is the app's half: it imports the JSON and binds it to these.

/** @typedef {import("../rules.mjs").Variant} Variant */

/** Every key this config understands. An unknown one is a PROBLEM, never ignored. */
export const KNOWN = new Set(["enabled", "retentionDays", "funnel", "experiments"]);

/** How long a milestone row keeps its member link before it is pruned. */
export const DEFAULT_RETENTION_DAYS = 400;

/** @param {unknown} raw */
function asObject(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * The funnel, in the order it is read out — a list of event ids.
 *
 * These are the same strings `track()` is called with. Deliberately NOT
 * predicates: a step's membership is decided at the moment it happens, by the
 * one `track()` call at the place it happened, so there is no second expression
 * of the same truth to drift from the first.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function funnelStepsIn(raw) {
  const value = asObject(raw).funnel;
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.length > 0);
}

/**
 * The split tests this app is running.
 *
 * 🚨 An entry that cannot be parsed is DROPPED here and named by `problemsIn`.
 * Silently keeping a half-formed experiment would be worse: nobody would be
 * assigned to it and the operator would be watching a test that never started.
 *
 * @param {unknown} raw
 * @returns {{ id: string, exposure: string, goal: string, variants: Variant[] }[]}
 */
export function experimentsIn(raw) {
  const value = asObject(raw).experiments;
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    if (typeof entry.exposure !== "string" || entry.exposure.length === 0) continue;
    if (typeof entry.goal !== "string" || entry.goal.length === 0) continue;
    if (!Array.isArray(entry.variants)) continue;
    const variants = entry.variants
      .filter((v) => !!v && typeof v === "object" && !Array.isArray(v))
      .filter((v) => typeof v.id === "string" && typeof v.weight === "number")
      .map((v) => ({ id: v.id, weight: v.weight }));
    if (variants.length === 0) continue;
    out.push({ id: entry.id, exposure: entry.exposure, goal: entry.goal, variants });
  }
  return out;
}

/**
 * How many days a milestone keeps its member link.
 *
 * `Number()` is not used deliberately: `Number(null)` is 0, and a retention of
 * zero would prune everything on the first run.
 *
 * @param {unknown} raw
 */
export function retentionDaysIn(raw) {
  const value = asObject(raw).retentionDays;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_RETENTION_DAYS;
}

/** @param {unknown} raw */
export function isEnabledIn(raw) {
  // `=== true`, so a string "true", a 1 or a missing key are all OFF.
  return asObject(raw).enabled === true;
}

/**
 * What is wrong with the file — empty when nothing is.
 *
 * ⚠️ An unknown key lands here rather than being skipped: a misspelt switch is a
 * setting somebody believes they made. `_`-prefixed keys are documentation, the
 * same convention `config/media.json` established.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function problemsIn(raw) {
  const problems = [];
  const f = asObject(raw);

  for (const key of Object.keys(f)) {
    if (key.startsWith("_")) continue;
    if (!KNOWN.has(key)) problems.push(`unknown field "${key}"`);
  }

  if (f.enabled !== undefined && typeof f.enabled !== "boolean") {
    problems.push(`"enabled" must be true or false, not ${JSON.stringify(f.enabled)}`);
  }
  if (f.retentionDays !== undefined && (typeof f.retentionDays !== "number" || !(f.retentionDays > 0))) {
    problems.push('"retentionDays" must be a number above zero');
  }
  if (f.funnel !== undefined && !Array.isArray(f.funnel)) {
    problems.push('"funnel" must be a list of event ids');
  }
  if (f.experiments !== undefined && !Array.isArray(f.experiments)) {
    problems.push('"experiments" must be a list');
  }

  // 🚨 An experiment that was dropped above is INVISIBLE to every caller — it
  // simply is not in the list, so nobody is assigned, nothing is recorded and
  // the dashboard shows no such test. That is the worst shape a config error can
  // take, so the raw entries are counted against the parsed ones and the
  // difference is named.
  const rawExperiments = Array.isArray(f.experiments) ? f.experiments : [];
  const parsed = new Set(experimentsIn(raw).map((e) => e.id));
  for (const entry of rawExperiments) {
    const e = entry ?? {};
    const id = typeof e.id === "string" && e.id ? e.id : "(an entry with no id)";
    if (parsed.has(id)) continue;
    const missing = ["id", "exposure", "goal"].filter((k) => typeof e[k] !== "string" || !e[k]);
    problems.push(
      missing.length > 0
        ? `experiment ${id} is ignored — it needs ${missing.join(", ")}`
        : `experiment ${id} is ignored — it needs at least one variant with a numeric weight`,
    );
  }

  // A duplicate id in either list is a silent halving: two funnel rows counting
  // the same event, or two experiments assigning against the same name.
  const dupes = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of new Set(dupes(funnelStepsIn(raw)))) problems.push(`funnel names "${id}" twice`);
  for (const id of new Set(dupes(experimentsIn(raw).map((e) => e.id)))) {
    problems.push(`two experiments share the id "${id}"`);
  }
  for (const e of experimentsIn(raw)) {
    const variantIds = e.variants.map((v) => v.id);
    for (const id of new Set(dupes(variantIds))) {
      problems.push(`experiment "${e.id}" names the variant "${id}" twice`);
    }
    if (variantIds.length < 2) {
      problems.push(`experiment "${e.id}" needs at least two variants to compare`);
    }
  }

  return problems;
}

/**
 * Why this module is not running — `null` when it is.
 *
 * `disabledInConfig` wins: an operator who switched it off gets "off", not a
 * lint about a file they deliberately parked.
 *
 * @param {unknown} raw
 * @returns {"disabledInConfig" | "brokenConfig" | null}
 */
export function offReasonIn(raw) {
  if (!isEnabledIn(raw)) return "disabledInConfig";
  if (problemsIn(raw).length > 0) return "brokenConfig";
  return null;
}
