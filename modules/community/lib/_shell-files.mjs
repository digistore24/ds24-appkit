// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which files make up the community's imperative shell.
//
// It was one — `manage.ts`, 5,902 lines — and a dozen guard tests read it as
// TEXT to ask things a type cannot: does this reader take a participant id, is
// the upload guard called before the store, does the feed derive access from
// the resolver the page uses. Those questions are all still the right ones.
//
// 🚨 **The list lives here so that splitting a file again is one edit.** When
// `manage.ts` became a barrel over eleven domain files, every one of those
// scanners went green-by-emptiness for a moment — they were reading a file that
// now contains only re-exports. That is the failure this module's own tests
// exist to prevent, turned on the tests themselves, and a hand-kept copy of the
// list in each of them would be six chances to miss the next one.
//
// ⚠️ `rules.ts` is deliberately NOT here: it is the pure core, it holds no
// query and no I/O, and a scanner looking for a database call has no business
// reading it. The `_`-prefixed files ARE here — a helper that moved out of
// `manage.ts` did not stop being part of the shell.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The pure core and the readers that are their own thing — not the shell. */
const NOT_SHELL = new Set([
  "rules.ts",
  "config.ts",
  "wire.ts",
  "embeds.ts",
  "dm-actor.ts",
  "dm-presence.ts",
  "room-counts.ts",
  "manage.ts",
]);

/** Every shell file, as `[relativePath, source]`, sorted for a stable read. */
export function shellFiles() {
  return readdirSync(HERE)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !NOT_SHELL.has(name))
    .sort()
    .map((name) => [`modules/community/lib/${name}`, readFileSync(join(HERE, name), "utf8")]);
}

/**
 * The whole shell as one string — what a scanner that used to read `manage.ts`
 * wants now.
 *
 * Each file is preceded by a comment naming it, so a match found here can still
 * be traced back by eye.
 */
export function shellSource() {
  return shellFiles()
    .map(([path, text]) => `// ==== ${path} ====\n${text}`)
    .join("\n");
}
