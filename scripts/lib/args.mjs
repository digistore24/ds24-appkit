// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Reading a `--flag value` off `process.argv`, once.
//
// 🚨 **The rule this file exists for: a flag that is present without a value is
// a REFUSAL, never a guess.** There were six copies of `flag()` under
// `scripts/`, in three semantics, and the difference between them is not
// cosmetic — it decides what `--email --apply` means:
//
//   · `scripts/setup/mint-key.mjs` refused it, and said why: with one owner in
//     the table the command would otherwise mint a key for them and report
//     success, for a person who never named anybody.
//   · `scripts/setup/bootstrap.mjs`, one directory away, returned `"--apply"`
//     as the address — and that script creates the FIRST OWNER and the first
//     setup key of an environment.
//   · `scripts/dev/agent-setup.mjs` wanted the full `--name` spelling, so a
//     call written like every other one silently found nothing.
//
// So the strict reading wins, because it is the one that was reasoned about and
// because the failure modes are not symmetric: refusing costs a re-typed
// command, guessing writes a credential nobody asked for.
//
// `scripts/lib/args.test.ts` refuses a seventh copy — the same arrangement
// `source-text.mjs` and `import-graph.mjs` have, and for the same reason: a
// rule that lives in one file and is re-implemented in the next is a rule that
// only holds where somebody remembered it.

/** A flag given without a usable value. Carries the sentence to print. */
export class FlagError extends Error {
  constructor(message) {
    super(message);
    this.name = "FlagError";
  }
}

/**
 * The value of `--<name>`, or `undefined` when the flag is not there at all.
 *
 * Throws `FlagError` when the flag IS there and the next token cannot be its
 * value — nothing follows it, or what follows is another flag. The pure half,
 * so the rule can be tested without a process to exit.
 *
 * ⚠️ "Another flag" is `startsWith("--")`, deliberately not `startsWith("-")`.
 * A negative number is a legitimate value and there is no `-x` short form
 * anywhere in this tree; refusing `-1` would be a rule that is wrong more often
 * than it is right.
 */
export function flagValue(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new FlagError(`--${name} needs a value.`);
  }
  return value;
}

/**
 * `flagValue()` for a command line: prints the reason and leaves with code 2.
 *
 * 2 rather than 1 is this tree's convention — 1 is a finding, 2 is "you asked
 * me something I cannot act on" (`run.mjs`, and every `*-check` script).
 */
export function flag(argv, name) {
  try {
    return flagValue(argv, name);
  } catch (error) {
    if (!(error instanceof FlagError)) throw error;
    console.error(`✗ ${error.message}`);
    process.exit(2);
  }
}

/**
 * `flag()` with the argument list already bound — what a script says once at the
 * top so its call sites stay `flag("env")`.
 *
 * This exists so that adopting the shared rule is a ONE-LINE change at the top
 * of a file rather than an edit at every call site. A migration that touches
 * every line is a migration somebody does halfway.
 */
export function flagsFrom(argv) {
  return (name) => flag(argv, name);
}
