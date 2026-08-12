// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The commit gate: TypeScript check + tests, before a commit is made.
//
// ── Why this exists ────────────────────────────────────────────────────────
// CLAUDE.md has said "green is the commit condition" for as long as there has
// been a CLAUDE.md, and until this file there was nothing behind the sentence.
// Nothing runs the tests after a push either — there is no CI behind an app
// built here, by design: it is the customer's repository, on the customer's
// machine. So a red test that gets committed stays red until somebody looks,
// and "somebody" is usually a session three days later that now cannot tell
// which change broke it.
//
// One command in front of the commit closes that, and it is affordable: the
// whole suite is about five seconds, the TypeScript check a few more.
//
// ── What it does NOT do ────────────────────────────────────────────────────
//  • **It does not stash.** It checks the working tree, not the index, so a
//    commit of a subset of your changes is checked against everything you have
//    open. That is the honest trade: the alternative is stashing somebody's
//    unstaged work inside a git hook, and a hook that loses work is worse than
//    a hook that occasionally judges too much.
//  • **It does not install anything.** A commit hook that starts npm-installing
//    is a commit that hangs for two minutes with no explanation. Without
//    `node_modules` it says so and refuses; `node run.mjs setup` is the answer.
//  • **It does not start the app.** `smoke` and `errors` need a running app and
//    a database — they belong to "am I done", not to "may this be a commit".
//
// ── The deliberate way past it ─────────────────────────────────────────────
// `git commit --no-verify`. CLAUDE.md recommends committing unfinished work
// rather than leaving it lying around, and that advice must stay usable: a WIP
// commit on a red tree is a decision somebody makes, which is exactly what
// `--no-verify` says. What this hook prevents is the OTHER thing — a commit
// made on red because nobody ran the tests.
import { existsSync } from "node:fs";
import { runNpm } from "../lib/proc.mjs";

/** The two checks, in the order `node run.mjs test` runs them: cheapest first. */
const CHECKS = ["typecheck", "test"];

if (!existsSync("node_modules")) {
  console.error(
    [
      "",
      "✗ Cannot check this commit — node_modules is missing.",
      "",
      "  Run `node run.mjs setup` first (it installs, prepares the .env and the",
      "  database). This hook deliberately installs nothing itself: a commit that",
      "  silently turns into a two-minute install is worse than one that says so.",
      "",
      "  Committing anyway, on purpose:  git commit --no-verify",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("→ Checking before the commit: typecheck + tests (a few seconds).");

for (const check of CHECKS) {
  const code = await runNpm(["run", check]);
  if (code === 0) continue;

  console.error(
    [
      "",
      `✗ \`npm run ${check}\` is red — the commit was NOT made.`,
      "",
      "  Fix it and commit again. Nothing runs these for you after a push, so a",
      "  red commit stays red until somebody trips over it (CLAUDE.md → Rules,",
      '  "Tests are mandatory").',
      "",
      "  Deliberate work-in-progress commit:  git commit --no-verify",
      "",
    ].join("\n"),
  );
  process.exit(code);
}
