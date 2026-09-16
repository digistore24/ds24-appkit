#!/usr/bin/env node
// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT
//
// language-guard.mjs — every line the customer reads is in THEIR language, or
// it is not written. CLAUDE.md → Rules says so; this is the rule at the three
// moments a session actually decides which language to write in.
//
// ── Why hooks and not the sentence ──────────────────────────────────────────
// Measured 2026-09-15 on three build turns, same German prompt, same template:
// 0, 3 and 24 of the progress lines between two tool calls were English ("Good,
// checkbox and card already exist. Let me look at EmptyState…"). A German
// customer, a German plan, a German hand-back — and in between, whatever the
// last English file the session had read pulled it towards. The rule was in
// CLAUDE.md the whole time. A progress line is written right after a tool
// result, and the tool results are English; the rule is 150 requests back.
//
// There is no hook that sees assistant text before it is shown, so nothing can
// make a wrong line impossible. What these three can do is put the language
// where the decision is made:
//
//   --prompt  UserPromptSubmit. Reads what the customer typed, recognises the
//             language, remembers it in `.dev/customer-language`, and says it
//             for the turn.
//   --post    PostToolUse. One short line after every tool call — the moment
//             right before a progress line is written — naming the language
//             and that a line in any other language is left out.
//   --stop    Stop. If the message the turn ends with is plainly in another
//             language, the turn is refused once with the instruction to write
//             it again. `stop_hook_active` makes it once, never a loop.
//
// English customers get nothing from any of the three: English is where the
// session drifts TO, not away from.
//
// Where the language comes from, first match wins: what this prompt is written
// in (when it is clearly one language); the language remembered from an
// earlier prompt; `docs/app.md` → Language, which the intake writes. A short
// "ok" or a pasted English error message does not switch a German customer to
// English — switching away from a remembered language needs a long, clear
// prompt (see `languageFor`).
//
// Never fatal: any error exits 0 and says nothing. A guard that breaks a
// session over a language guess would be worse than the English line.
//
// Claude Code only — the other three programs run no such hooks
// (`scripts/dev/agent-configs.mjs` records the same asymmetry for the read guard).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { customerLanguage } from "../after-compact-rules.mjs";

/** The languages the template ships (messages/*.json). */
export const LANGUAGES = {
  de: { name: "German", native: "Deutsch" },
  en: { name: "English", native: "English" },
  es: { name: "Spanish", native: "español" },
  fr: { name: "French", native: "français" },
};

// Short, frequent, and as distinctive as function words get. Words two of the
// four languages share ("la", "de", "in", "a") are left out on purpose: they
// would only add the same point to two columns.
const STOPWORDS = {
  de: "der die das den dem und du oder ist sind war nicht ich wir ihr sie er ein eine einen einem einer mit auf für von zu im bei auch noch schon jetzt dann wenn weil dass bitte mein meine meinen dein deine hier wie wo kann soll muss habe hast hat haben werden wird wurde sehen gibt aber nur ganz sehr sich ob alles jede jeden diese dieser dieses nach über unter zum zur man mehr kein keine",
  en: "the and is are were not you we they he she it with for of to at still already now then if because that please my your here what how where can should must have has had would see there but only very this these those from into about which who when just all any more than",
  es: "el los las y son yo tú nosotros una con por para también ya ahora entonces porque mi aquí qué cómo dónde puedo quiero tengo hay pero solo muy este esta estos estas del al lo se sus su como cuando donde",
  fr: "le les et est sont pas je nous vous il elle avec sur pour aussi déjà maintenant alors parce mon ma mes ton ici quoi comment où peux veux ai mais seulement très ce cette ces dans au aux qui quand est-ce une",
};
const STOP = Object.fromEntries(
  Object.entries(STOPWORDS).map(([code, words]) => [code, new Set(words.split(/\s+/))]),
);
const LETTERS = { de: /[äöüß]/gi, es: /[ñ¿¡]/gi, fr: /[çœàèùâêîôû]/gi };

/**
 * The language a text is written in, or null when it is not clearly one.
 *
 * Code, paths and addresses are removed first — a hand-back ends with file
 * names, and `docs/app.md` is not a word of any language.
 *
 * @param {string} text
 * @returns {{ code: keyof typeof LANGUAGES, hits: number, ratio: number } | null}
 */
export function detectLanguage(text) {
  const prose = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/\S*[/\\]\S*/g, " ");
  const words = prose.toLowerCase().match(/[\p{L}-]+/gu) ?? [];
  const score = Object.fromEntries(Object.keys(STOP).map((code) => [code, 0]));
  for (const word of words) {
    for (const code of Object.keys(STOP)) if (STOP[code].has(word)) score[code] += 1;
  }
  for (const [code, pattern] of Object.entries(LETTERS)) {
    score[code] += Math.min(3, (prose.match(pattern) ?? []).length);
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [[code, hits], [, second]] = ranked;
  if (hits < 3) return null;
  const ratio = second === 0 ? Infinity : hits / second;
  if (ratio < 2) return null;
  return { code: /** @type {keyof typeof LANGUAGES} */ (code), hits, ratio };
}

/** `German`, `Deutsch`, `de` … → `de`; anything else → null. */
export function codeFromName(name) {
  const v = String(name ?? "").trim().toLowerCase();
  if (v === "") return null;
  for (const [code, lang] of Object.entries(LANGUAGES)) {
    if (v === code || v === lang.name.toLowerCase() || v === lang.native.toLowerCase()) return code;
  }
  const aliases = { deutsch: "de", german: "de", allemand: "de", alemán: "de", englisch: "en", inglés: "en", anglais: "en", spanisch: "es", espagnol: "es", französisch: "fr", francés: "fr", francais: "fr", espanol: "es" };
  return aliases[v] ?? null;
}

/**
 * Which language this turn is in.
 *
 * @param {{ prompt?: string, stored?: string | null, appMd?: string | null }} input
 * @returns {keyof typeof LANGUAGES | null}
 */
export function languageFor({ prompt, stored = null, appMd = null } = {}) {
  const remembered = LANGUAGES[stored ?? ""] ? stored : codeFromName(customerLanguage(appMd));
  const detected = prompt ? detectLanguage(prompt) : null;
  if (!detected) return remembered ?? null;
  if (!remembered || detected.code === remembered) return detected.code;
  // Switching away from a language already known takes a long, clear prompt:
  // a German customer pasting an English error message is still German.
  return detected.hits >= 8 && detected.ratio >= 3 ? detected.code : remembered;
}

/** The line said at the start of a turn, or null for English / unknown. */
export function promptLine(code) {
  if (!code || code === "en") return null;
  const { name, native } = LANGUAGES[code];
  return (
    `[Customer language: ${name} (${native}) — every line they read is ${name}, the short ` +
    `lines between tool calls included. A line you would write in another language is left out.]`
  );
}

/** The `additionalContext` after a tool call, or null. */
export function postLine(code) {
  if (!code || code === "en") return null;
  const { name } = LANGUAGES[code];
  return `Customer language: ${name}. Your next line to the customer is ${name}, or it is not written.`;
}

/**
 * The Stop decision: a reason to refuse ending the turn, or null.
 *
 * @param {{ code: string | null, message?: string, active?: boolean }} input
 */
export function stopReason({ code, message, active }) {
  if (active || !code || code === "en") return null;
  const said = detectLanguage(message ?? "");
  if (!said || said.code === code || said.hits < 4) return null;
  const { name } = LANGUAGES[code];
  return (
    `Your last message is in ${LANGUAGES[said.code].name}, but the customer writes ${name} ` +
    `(CLAUDE.md → Rules). Write that message again, completely, in ${name} — names of files, ` +
    `commands and functions stay as they are.`
  );
}

// ── the state this hook keeps ────────────────────────────────────────────────

export const STATE_FILE = join(".dev", "customer-language");

function read(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

/** The remembered code for a project directory, then `docs/app.md`. */
export function knownLanguage(cwd) {
  const stored = (read(join(cwd, STATE_FILE)) ?? "").trim();
  return languageFor({ stored, appMd: read(join(cwd, "docs", "app.md")) });
}

// ── CLI: the hook itself ─────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    try {
      const input = raw ? JSON.parse(raw) : {};
      const cwd = resolve(input.cwd ?? process.cwd());
      const mode = process.argv[2];

      if (mode === "--prompt") {
        const stored = (read(join(cwd, STATE_FILE)) ?? "").trim();
        const code = languageFor({
          prompt: input.prompt,
          stored,
          appMd: read(join(cwd, "docs", "app.md")),
        });
        if (code && code !== stored) {
          mkdirSync(join(cwd, ".dev"), { recursive: true });
          writeFileSync(join(cwd, STATE_FILE), `${code}\n`);
        }
        const line = promptLine(code);
        if (line) process.stdout.write(`${line}\n`);
      } else if (mode === "--post") {
        const line = postLine(knownLanguage(cwd));
        if (line) {
          process.stdout.write(
            `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: line } })}\n`,
          );
        }
      } else if (mode === "--stop") {
        const reason = stopReason({
          code: knownLanguage(cwd),
          message: input.last_assistant_message,
          active: input.stop_hook_active === true,
        });
        if (reason) process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
      }
    } catch {
      /* never fatal — see the header */
    }
    process.exit(0);
  });
}

export const HOOK_PATH = fileURLToPath(import.meta.url);
