// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which optional modules this app is made of — the app's side of the answer.
//
// A module is a whole feature (pages, tables, texts, guidance) under
// `modules/<id>/`. `config/modules.json` says which ones this app HAS; the list
// ships empty and `node run.mjs module add <id>` writes into it.
//
// ── 🚨 This one does NOT fail closed, and that is the whole point ───────────
// Every other config reader in this app resolves an unreadable file to OFF —
// `isCommunityEnabled()`, `isApiEnabled()`, `isChatEnabled()`. They answer
// "should this run", and for that question a doubt must fall towards closed.
//
// This file answers a different question: "what is this app MADE OF". Resolving
// a doubt to "nothing" there does not close a door, it hides a room: the schema
// barrel would export no module tables, the subject-access export would emit no
// module sections, and an app holding a year of community posts would answer an
// Art. 15 request with silence about data it demonstrably still has. That is
// the exact failure `lib/privacy/export.ts` carries a correction about.
//
// So a malformed list THROWS, here and in `scripts/modules/installed.mjs`. A
// build that stops is a person reading an error; a build that quietly forgets a
// module is a regulator reading an incomplete export.
//
// ── Two readers, and a test that they agree ────────────────────────────────
// This one is bundled (`import raw from …`), because a path resolved against
// `process.cwd()` breaks under `output: "standalone"` and on any host that
// starts the server from another directory — the trap `instrumentation.ts`
// documents at length. `scripts/modules/installed.mjs` reads the same file with
// `readFileSync` for bare-Node scripts and `next.config.ts`, which run before a
// bundler exists. `lib/modules/installed.test.ts` fails the build when the two
// disagree — the same clamp `lib/ai/tasks.ts` and `lib/ai/task-rules.mjs` use.
import raw from "@/config/modules.json";

/** A module id: lower-case, digits and dashes. The folder name under `modules/`. */
const ID = /^[a-z][a-z0-9-]*$/;

/** Keys `config/modules.json` may carry. `_comment*` is prose, as everywhere. */
const KNOWN = new Set(["installed"]);

/**
 * The ids of the modules this app is made of, in the order they were installed.
 *
 * @throws when `config/modules.json` is not a coherent list. See the note above
 *   for why this is not a fallback to `[]`.
 */
export function installedModules(): string[] {
  return parseInstalled(raw as Record<string, unknown>, "config/modules.json");
}

/** Is this module part of this app? Never "is it switched on" — that is its own config. */
export function isModuleInstalled(id: string): boolean {
  return installedModules().includes(id);
}

/**
 * The pure half, so the bare-Node twin can share the rules rather than
 * re-implement them from the same prose. `where` only shapes the message.
 */
export function parseInstalled(file: Record<string, unknown>, where: string): string[] {
  const refuse = (why: string): never => {
    // Named rather than swallowed: whoever sees this edited the file by hand,
    // and the next thing they need is the field, not a stack trace.
    throw new Error(
      `${where} is not a readable module list: ${why}.\n` +
        `  It decides what this app is made of, so it is refused rather than guessed — ` +
        `an app that forgets a module keeps its tables and stops answering for them.\n` +
        `  Expected: { "installed": ["community", …] }`,
    );
  };

  const unknown = Object.keys(file).filter((k) => !k.startsWith("_") && !KNOWN.has(k));
  if (unknown.length > 0) refuse(`unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")}`);

  const installed = file.installed;
  if (installed === undefined) refuse('no "installed" key');
  if (!Array.isArray(installed)) refuse('"installed" must be an array of module ids');

  const list = installed as unknown[];
  for (const entry of list) {
    if (typeof entry !== "string" || !ID.test(entry)) {
      refuse(`"${String(entry)}" is not a module id (lower-case letters, digits and dashes)`);
    }
  }

  const ids = list as string[];
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) refuse(`"${duplicate}" is listed twice`);

  return ids;
}
