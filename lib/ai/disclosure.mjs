// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **The Art. 50(1) rule, written once.**
//
// Since 2 August 2026 a system that talks to people has to say it is a machine,
// "at the latest at the time of the first interaction". `CLAUDE.md` states the
// rule as *anything here that talks to a person as a machine says so* and adds
// *"whatever AI feature you add next inherits it"* — so it is a rule about a
// LIST of surfaces, not about the chat.
//
// ── Why this file exists, and why it is `.mjs` ─────────────────────────────
// The rule used to live in two places: as assertions in
// `lib/ai/disclosure.test.ts`, and as a regular expression inside
// `scripts/legal/check.mjs` carrying the comment *"Mirrors
// lib/ai/disclosure.test.ts"*. Two copies of a rule with a legal deadline
// attached, kept in step by hand — which is exactly what the test file's own
// header says this template does not do.
//
// `.mjs` because `node run.mjs legal-check` is given **no `needs`** on purpose
// (`run.mjs`): it has to run in a half-set-up project, with no bundler, no
// `node_modules` and no database. So it cannot import TypeScript. The same
// arrangement `lib/ai/task-rules.mjs`, `lib/ai/pricing.mjs` and
// `lib/ai/frontmatter.mjs` already use.
//
// ⚠️ **There is no `lib/ai/disclosure.ts` and there must not be one.** An
// extensionless `@/lib/ai/disclosure` would resolve to it for `tsc` and the
// bundler while these scripts kept reading the `.mjs` — one name, two copies of a
// rule with a legal deadline on it, and typecheck green for both. The convention
// in full, including the two shapes in which a shared stem IS allowed:
// [`docs/conventions.md`](../../docs/conventions.md) → *A `.mjs` beside a `.ts`*.
import { moduleDisclosureSurfaces } from "../../scripts/modules/inventory.mjs";

/**
 * How each language names a machine.
 *
 * Word boundaries on purpose: "KI" must not be satisfied by "KIosk", and the
 * German text may not pass by containing the English "AI" — a German customer
 * reads the German string, and that one has to say it.
 *
 * A language with no pattern here is reported as "cannot check automatically"
 * rather than as a pass. Silence is not a verdict.
 */
export const NAMES_A_MACHINE = {
  de: /\bKI\b|\bkünstliche[rn]? Intelligenz\b/i,
  en: /\bAI\b|\bartificial intelligence\b/i,
};

/**
 * Is the support assistant switched on?
 *
 * The literal `true` and nothing else — the fail-closed rule
 * `lib/ai/chat-config.ts` already applies, restated here only because this file
 * cannot import it.
 */
function chatIsOn(config) {
  return config?.enabled === true;
}


/**
 * ⚠️ **Do not answer "does this app have a companion?" by scanning the tree.**
 *
 * It is the obvious reach and it is wrong: the module ships its own call site
 * (`modules/companion/actions.ts`) and it is on disk whether or not the module
 * is installed. So a scan for product-side call sites finds one in **every**
 * app that has the tree, companion or not, and
 * this check would become a permanent false positive that nobody could switch
 * off. The switch is the only thing that distinguishes an app that HAS a
 * companion from one that merely carries the machinery.
 *
 * The switch is also all this file can know. `modules/companion/companions.ts` — the
 * registry — is TypeScript, because its entries carry `load()` functions that
 * query the database, so `legal-check` cannot ask it how many companions an app
 * declares. The consequence is written into the message rather than hidden: an
 * app with `"enabled": true` and an empty registry reads as "on" and owes a
 * notice it does not, in substance, need. That is a misconfiguration, not a
 * lawful state, and a check with a deadline behind it may fail loudly but must
 * never pass quietly — so the false positive is the direction this accepts. Do
 * not "fix" it with a text scan over `companions.ts`: a scan that misreads an
 * entry produces a false NEGATIVE, which is the direction that cannot be
 * accepted.
 */
const CORE_SURFACES = [
  {
    // The id IS the message namespace, so the key is `${id}.disclaimer`.
    id: "chat",
    /** What it is, for a report a person reads. */
    label: "the assistant",
    /** The file that must mount the notice. */
    rendersIn: "app/dashboard/chat/ui.tsx",
    /** Which config decides whether it is live, and how to read that config. */
    configFile: "config/ai-chat.json",
    isOn: chatIsOn,
    /**
     * The extra property this surface has and the other does not: `ChatWindow`
     * is drawn twice, and the shared `conversation` block is what both mount.
     */
    insideBlock: "const conversation = (",
  },
];

/**
 * Every surface in this app that talks to a person — the core's, plus whatever
 * an installed module brings.
 *
 * 🚨 A module that adds an AI surface joins this list by declaring `disclosure`
 * in its manifest. One that does not ships a page talking to a person as a
 * machine without saying so, and nothing else would notice: the page renders,
 * the tests pass, and only the obligation is missed.
 *
 * Top-level `await` rather than an async function, because the consumers need
 * an ARRAY at collection time — `describe.each(DISCLOSURE_SURFACES)` in
 * `disclosure.test.ts` and the loop in `scripts/legal/check.mjs`. An async
 * accessor would have quietly turned both into loops over nothing.
 *
 * Reading the manifests from a `lib/` file is unusual and deliberate: this file
 * is never bundled — nothing under `app/` imports it — and `legal-check` has to
 * run with no bundler at all, which is the same reason it is `.mjs`.
 */
export const DISCLOSURE_SURFACES = [...CORE_SURFACES, ...(await moduleDisclosureSurfaces())];

/** How a surface mounts the notice. One line, so an agent follows it. */
export function mountFor(surfaceId) {
  return `<AiDisclosure surface="${surfaceId}" />`;
}

/**
 * What is wrong with the disclosures, as CODES.
 *
 * Pure over injected readers, so the vitest guard and `legal-check` can call the
 * same function from two very different worlds — one has a bundler and JSON
 * imports, the other has `node:fs` and nothing else. Sentences are NOT produced
 * here; the caller writes them, because a sentence composed in `lib/` exists in
 * exactly one language.
 *
 * @param locales      the locales this app speaks
 * @param messagesFor  (locale) => the parsed message file, or null
 * @param sourceOf     (relative path) => the file as text, or null
 * @param configFor    (relative path) => the parsed config, or null
 * @returns problems, each `{ code, surface, locale?, text?, rendersIn? }`
 */
export function disclosureProblems({ locales, messagesFor, sourceOf, configFor }) {
  const problems = [];

  for (const surface of DISCLOSURE_SURFACES) {
    // A surface that is switched off owes nothing. That is the shipped state of
    // the companion, and it is the honest answer rather than a pass.
    if (!surface.isOn(configFor(surface.configFile))) continue;

    for (const locale of locales) {
      const line = messagesFor(locale)?.[surface.id]?.disclaimer;
      const pattern = NAMES_A_MACHINE[locale];

      if (!line) {
        problems.push({ code: "missingKey", surface: surface.id, locale });
      } else if (!pattern) {
        problems.push({ code: "noPatternForLocale", surface: surface.id, locale, text: line });
      } else if (!pattern.test(line)) {
        problems.push({ code: "doesNotNameAMachine", surface: surface.id, locale, text: line });
      }
    }

    // The sentence existing is not the notice being shown. This is the half a
    // rewrite of the component would break while every message file stayed
    // perfect.
    const source = sourceOf(surface.rendersIn);
    if (!source || !source.includes(`surface="${surface.id}"`)) {
      problems.push({
        code: "nothingRendersIt",
        surface: surface.id,
        rendersIn: surface.rendersIn,
      });
    }
  }

  return problems;
}
