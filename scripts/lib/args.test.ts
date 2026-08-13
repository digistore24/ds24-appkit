// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `--flag value`, read one way in this tree.
//
// Two questions, and the second is the one that keeps the first from being
// defeated by the next file somebody writes:
//
//   1. does the rule hold — is a flag with no usable value REFUSED
//   2. does every reader in this tree go through `scripts/lib/args.mjs`
//
// The same arrangement `source-text.test.ts` and `import-graph.test.ts` have.
// The history it is guarding is in `args.mjs`: there were SEVEN copies of this
// six-line function in three different semantics, and the difference decided
// what `--email --apply` meant. `scripts/setup/mint-key.mjs` refused it and
// said why. `scripts/setup/bootstrap.mjs`, one directory away, took `"--apply"`
// as the address — in the script that creates an environment's FIRST OWNER.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "./source-text.mjs";
import { FlagError, flagValue, flagsFrom } from "./args.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("flagValue — the rule", () => {
  it("reads a value that follows its flag", () => {
    expect(flagValue(["--env", "prod"], "env")).toBe("prod");
  });

  it("answers undefined when the flag is not there at all", () => {
    // Absent is not an error — most of these flags are optional, and the
    // caller's own `?? default` is the right place to decide.
    expect(flagValue(["--apply"], "env")).toBeUndefined();
  });

  it("🚨 refuses a flag whose value is the NEXT flag", () => {
    // The whole reason this file exists. `--email --apply` used to hand back
    // "--apply" as somebody's address.
    expect(() => flagValue(["--email", "--apply"], "email")).toThrow(FlagError);
  });

  it("🚨 refuses a flag at the very end of the line", () => {
    expect(() => flagValue(["--apply", "--email"], "email")).toThrow(FlagError);
  });

  it("names the flag in the message, so the fix is in the refusal", () => {
    expect(() => flagValue(["--email"], "email")).toThrow("--email needs a value.");
  });

  it("takes a negative number as a value", () => {
    // The counter-proof for the `--` choice. A rule that refused anything
    // starting with `-` would refuse this, and there is no short-flag form in
    // this tree for it to protect.
    expect(flagValue(["--offset", "-1"], "offset")).toBe("-1");
  });

  it("takes a value that merely CONTAINS a double dash", () => {
    expect(flagValue(["--out", "a--b.json"], "out")).toBe("a--b.json");
  });

  it("reads the FIRST occurrence when a flag is given twice", () => {
    // Not a decision worth having an opinion about — pinned so that changing
    // it is a decision rather than a side effect.
    expect(flagValue(["--env", "prod", "--env", "staging"], "env")).toBe("prod");
  });

  it("binds an argument list with flagsFrom", () => {
    const flag = flagsFrom(["--env", "staging"]);
    expect(flag("env")).toBe("staging");
    expect(flag("missing")).toBeUndefined();
  });
});

/** Every `.mjs` in the tree, minus the places that are not ours. */
function scriptFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".next", ".data", ".git", ".dev", "drizzle"]);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".mjs")) out.push(relative(ROOT, full));
    }
  };
  walk(join(ROOT, "scripts"));
  walk(join(ROOT, "modules"));
  return out;
}

describe("no second reading of the command line", () => {
  // A local helper that INDEXES the argument list right after finding a flag.
  // Deliberately narrow: it matches the shape all seven copies had — an
  // `indexOf` of a `--`-prefixed name, and the next element read out — and it
  // does not try to have an opinion about argument parsing in general. A looser
  // rule here would fire on `argv.includes("--apply")`, which is a boolean and
  // is fine, and a rule that is wrong about the common case is one somebody
  // switches off.
  const COPY =
    /indexOf\(\s*`--\$\{[A-Za-z]+\}`\s*\)|indexOf\(\s*name\s*\)[\s\S]{0,80}\[\s*\w+\s*\+\s*1\s*\]/;

  it("finds no file building its own `--flag value` reader", () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const relativePath of scriptFiles()) {
      // 🚨 Comments first — this file's own prose, and `args.mjs`'s, describe
      // the very shape being looked for. A scanner that read them would report
      // the file that DOCUMENTS the rule as breaking it (CLAUDE.md → Rules).
      const source = blankComments(readFileSync(join(ROOT, relativePath), "utf8"));
      scanned += 1;
      if (relativePath === join("scripts", "lib", "args.mjs")) continue;
      if (COPY.test(source)) offenders.push(relativePath);
    }

    // The count guard. Zero scanned means the walk is looking at nothing —
    // the exact way a green check comes to mean "I did not measure".
    expect(scanned, "the walk found no .mjs at all").toBeGreaterThan(100);

    expect(
      offenders,
      "these build their own `--flag value` reader — import `flagsFrom` from " +
        "scripts/lib/args.mjs instead; the argument is in that file's header",
    ).toEqual([]);
  });

  it("🚨 the scan can actually SEE such a reader", () => {
    // The needle. Without this, a regex that matched nothing would make the
    // test above green for the wrong reason — and the rule would be gone with
    // nothing red. This is the exact text of the copy that was in
    // `scripts/setup/bootstrap.mjs`.
    const planted = [
      "const args = process.argv.slice(2);",
      "const flag = (name) => {",
      "  const i = args.indexOf(`--${name}`);",
      "  return i === -1 ? null : (args[i + 1] ?? null);",
      "};",
    ].join("\n");
    expect(COPY.test(blankComments(planted))).toBe(true);
  });

  it("does not fire on a boolean flag or on a bound helper", () => {
    // The other half of the needle: the shapes that must stay allowed.
    expect(COPY.test('const apply = args.includes("--apply");')).toBe(false);
    expect(COPY.test("const flag = flagsFrom(args);")).toBe(false);
  });
});
