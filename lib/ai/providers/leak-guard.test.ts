// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The guard that keeps the provider layer a layer.
//
// Two rules, and both are the kind that decay quietly: somebody in a hurry
// imports a vendor SDK "just for this one thing", or reads an API key straight
// from the environment, and nothing breaks — until the day an Operator switches
// provider and one feature keeps calling the old one.
//
//   1. No vendor SDK is imported outside `lib/ai/providers/`.
//   2. No provider API key is read outside `lib/ai/providers/`.
//
// This is the same shape as `scripts/portability.test.ts` (which greps for
// non-portable shell tools) and `lib/entitlements/leak-guard.test.ts` (which
// greps for the mailer on the wrong page): a rule nobody can remember, enforced
// by something that reads the tree.
//
// ── 🚨 It reads source as TEXT, so it blanks the comments first ────────────
//
// It used not to, and the bill came in twice in one afternoon (Story A84): the
// guard caught a first draft CORRECTLY, and then caught the COMMENT that
// described the catch. Measured on 2026-08-12, all four rules below did it —
// one planted explaining comment per rule, four reds. A guard that punishes a
// file for explaining its own rule is one somebody eventually deletes, and this
// one carries CLAUDE.md's promise that no call site ever names a provider,
// builds a vendor client or reads a key. It is the wrong one to make annoying.
//
// So every rule below is a function over raw source that blanks the comments
// itself, with `blankComments()` from `scripts/lib/source-text.mjs` — never a
// regex of our own (CLAUDE.md, and `scripts/lib/source-text.test.ts` refuses a
// further copy).
//
// ── Why the STRINGS are not blanked as well, except where they must be ─────
//
// Three of these needles live in strings legitimately, and two of them ARE
// strings, so there is no single answer:
//
//  · the vendor SDK rule's needle is a double-quoted specifier, and rule 3's
//    is a provider name that would be a leak in any string it appeared in →
//    strings stay VISIBLE.
//  · the two env-read rules hunt `process.env.X`, which is code — but its
//    dynamic twin `process.env["X"]` keeps the NAME in a string, so blanking
//    would make them silent for half of what they claim. They ask
//    `isQuotedMention()` instead: a match that STARTS inside a quote is a
//    mention (an error message, a test fixture — eight such lines in six
//    files today, with other variables), one that starts at `process` is a read.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { blankComments, isQuotedMention } from "@/scripts/lib/source-text.mjs";

import { PROVIDER_ENV_VARS, PROVIDER_IDS } from "./ids.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where provider-specific knowledge is allowed to live. */
const PROVIDER_DIR = join("lib", "ai", "providers");

/** Where storage credentials are allowed to live. Same rule, different secret. */
const MEDIA_DIR = join("lib", "media");

/**
 * Trees worth scanning. Everything a customer's app is built from.
 *
 * ⚠️ **`modules/` is in that list, and its absence was the sentence going stale
 * rather than a decision.** This comment said "everything a customer's app is
 * built from" while four features moved OUT of the trees beside it — so a
 * module could name a provider, build a vendor client or read `MEDIA_S3_*` and
 * this guard would not look. CLAUDE.md states the rule without an exception
 * ("No call site ever names a provider…"), and a module is precisely the next
 * AI feature it is written for: `modules/companion/` calls a model, and
 * `modules/community/profile-actions.ts` is an upload path.
 *
 * Scanned whether or not the module is INSTALLED, deliberately. The rule is
 * about what may exist in this tree, not about what this app happens to have
 * switched on — a leak that ships dormant is still shipped.
 */
const SCANNED = ["app", "lib", "components", "hooks", "db", "scripts", "i18n", "modules"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "dist"]);

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    const full = join(ROOT, rel);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(rel);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      yield rel;
    }
  }
}

function allFiles(): string[] {
  return SCANNED.flatMap((dir) => [...sourceFiles(dir)]);
}

/** Inside the provider directory — the one place these rules do not apply. */
function isProviderFile(path: string): boolean {
  return path.split(sep).join("/").startsWith(PROVIDER_DIR.split(sep).join("/"));
}

// ── The four needles ────────────────────────────────────────────────────────
//
// Each is a function over RAW source that blanks the comments itself and
// returns WHAT it found. Written that way for one reason: the probes at the
// foot of this file feed them a planted violation and a planted explaining
// comment, and they have to travel the same code path a real file does. A probe
// against a copy of the pattern proves the copy.

/** The vendor SDKs in `package.json`, and the only ones that may be. */
const VENDOR_SDKS = ["@anthropic-ai/sdk"];

/** Every provider key name, from the one table the app and `ai-check` share. */
const KEY_NAMES = Object.values(PROVIDER_ENV_VARS);

/**
 * The storage credentials. Same rule, different secret — added after a code
 * review pointed out that `lib/media/` makes exactly the claim
 * `lib/ai/providers/` makes and nothing enforced it. It was true when it was
 * written, which is precisely when a guard is cheap and nobody writes one.
 */
const MEDIA_ENV_VARS = [
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_BUCKET",
];

const alternation = (names: string[]) => names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const SDK_IMPORT = new RegExp(
  `(?:from\\s+|require\\(\\s*)["'](${alternation(VENDOR_SDKS)})["']`,
  "g",
);

/** Both ways to read one: the dotted form, and the dynamic one via a string. */
const KEY_READ = new RegExp(
  `process\\.env\\.(${alternation(KEY_NAMES)})\\b` +
    `|process\\.env\\[\\s*["'\`](${alternation(KEY_NAMES)})["'\`]\\s*\\]`,
  "g",
);

const MEDIA_READ = new RegExp(
  `(?:process\\.)?env\\.(${alternation(MEDIA_ENV_VARS)})\\b` +
    `|env\\[\\s*["'\`](${alternation(MEDIA_ENV_VARS)})["'\`]`,
  "g",
);

/**
 * Strings stay VISIBLE here: the needle IS a double-quoted specifier, so
 * `isQuotedMention()` would blind the rule completely.
 */
function vendorSdkImportsIn(raw: string): string[] {
  return [...blankComments(raw).matchAll(SDK_IMPORT)].map((m) => m[1]);
}

/** The env READS in a file — a quoted mention of one is not a read. */
function envReadsIn(raw: string, pattern: RegExp): string[] {
  const source = blankComments(raw);
  const found: string[] = [];
  for (const match of source.matchAll(pattern)) {
    // `process.env["ANTHROPIC_API_KEY"]` starts at `process`, outside the
    // quote; `"set process.env.ANTHROPIC_API_KEY"` starts inside it. That is
    // the whole difference between a read and a sentence about one.
    if (isQuotedMention(source, match.index ?? 0)) continue;
    found.push(match[1] ?? match[2]);
  }
  return found;
}

const providerKeyReadsIn = (raw: string) => envReadsIn(raw, KEY_READ);
const mediaCredentialReadsIn = (raw: string) => envReadsIn(raw, MEDIA_READ);

/**
 * Provider names in a file. Strings stay visible on purpose — `provider:
 * "openai"` in the pipeline is the leak this rule exists for; only the comment
 * that says a provider must NOT be named here is exempt.
 */
function providerNamesIn(raw: string): string[] {
  const source = blankComments(raw).toLowerCase();
  return PROVIDER_IDS.filter((id: string) => source.includes(id));
}

function modelNamesIn(raw: string): string[] {
  return [...blankComments(raw).matchAll(/(claude-|gpt-|gemini-|mistral-)/g)].map((m) => m[1]);
}

describe("no vendor SDK outside the provider layer", () => {
  it("holds for every source file", () => {
    // `@anthropic-ai/sdk` is the only vendor SDK in package.json, and the only
    // one that may be. The other four providers are reached with `fetch` — see
    // NFR-13, and `lib/ai/providers/openai-compat.ts` for what that costs.
    const offenders: string[] = [];

    for (const path of allFiles()) {
      if (isProviderFile(path)) continue;
      const found = vendorSdkImportsIn(readFileSync(join(ROOT, path), "utf8"));
      if (found.length > 0) offenders.push(`${path} imports ${found[0]}`);
    }

    expect(
      offenders,
      `these files import a vendor SDK directly. Call a task instead — ` +
        `runTask()/streamTask() in lib/ai/run.ts. See docs/ai-providers.md.`,
    ).toEqual([]);
  });
});

describe("no provider key outside the provider layer", () => {
  it("holds for every source file", () => {
    // `registry.ts` is the one file that turns a provider id into a key. Reading
    // one anywhere else means that file is no longer the single seam, and an
    // OAuth path or a key rotation would have two places to change instead of
    // one.
    //
    // The check command reports which keys are SET without ever using one, and
    // it does that through `PROVIDER_ENV_VARS` rather than by naming a variable
    // itself — so it is not an exception, it simply does not match.
    const offenders: string[] = [];

    for (const path of allFiles()) {
      if (isProviderFile(path)) continue;
      const found = providerKeyReadsIn(readFileSync(join(ROOT, path), "utf8"));
      if (found.length > 0) offenders.push(`${path} reads ${found[0]}`);
    }

    expect(
      offenders,
      `these files read a provider API key. Only lib/ai/providers/registry.ts may:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });
});

describe("the assistant is not an exception", () => {
  // The pipeline both chat doors share — the web route and /api/v1/chat are
  // thin authenticators around it, so THIS is where a provider name would leak.
  const route = readFileSync(join(ROOT, "lib", "ai", "chat-endpoint.ts"), "utf8");

  it("names no provider", () => {
    // The point of the migration: the one feature that shipped with a model
    // call is now the layer's first customer rather than its exception.
    //
    // Its comments are blanked first, and that is not a softening: this file
    // has to be able to SAY that which company answers is not its business,
    // and naming the five to say so was a red build on 2026-08-12.
    expect(
      providerNamesIn(route),
      "lib/ai/chat-endpoint.ts names a provider. It may name a TASK — which " +
        "company answers is config/ai-models.json.",
    ).toEqual([]);
  });

  it("names no model", () => {
    expect(modelNamesIn(route)).toEqual([]);
  });

  it("goes through a task", () => {
    // `streamTaskWithTools("chat", …)` since the assistant gained her content
    // tools — the intent is unchanged: the assistant names a TASK, and which
    // company answers stays in config/ai-models.json. The loop variant calls
    // streamTask() per round, so every round is still the layer's.
    expect(blankComments(route)).toMatch(/streamTask(WithTools)?\(\s*"chat"/);
  });
});

describe("storage credentials stay in lib/media/", () => {
  it("are read nowhere else", () => {
    const offenders: string[] = [];

    for (const file of allFiles()) {
      // `lib/media/` is where they belong. `instrumentation.ts` checks whether
      // they are PRESENT so the app can refuse to start without them, which is
      // a different thing from using one — and it is named here rather than
      // silently allowed by a prefix match.
      if (file.split(sep).join("/").startsWith(MEDIA_DIR.split(sep).join("/"))) continue;
      if (file === "instrumentation.ts") continue;

      // A mention in a comment or in a message is fine — reading the value is
      // not. Both halves of that sentence are now true; the message half was a
      // claim this file made and did not keep until A85.
      for (const name of mediaCredentialReadsIn(readFileSync(join(ROOT, file), "utf8"))) {
        offenders.push(`${file} reads ${name}`);
      }
    }

    expect(
      offenders,
      `storage credentials belong in ${MEDIA_DIR}/ — everything above it takes a ` +
        `MediaStore and does not know which one it has:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

// ── The guard's own guard ───────────────────────────────────────────────────
//
// Everything above is an `.toEqual([])` over a walk. Three ways for that to be
// green for the wrong reason, and all three have been produced for real
// somewhere in this tree: the walk found no files, the LIST it walks with is
// empty, or the pattern cannot match any source that exists.

describe("the scan itself", () => {
  it("actually reads files, so an empty result means something", () => {
    // Non-vacuity: a broken path would make every assertion above pass by
    // scanning nothing at all.
    const files = allFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.includes("chat"))).toBe(true);
  });

  it("🚨 knows some providers, keys and credentials at all", () => {
    // An empty table is not a clean bill of health, it is a rule about nothing.
    // `PROVIDER_IDS` and `PROVIDER_ENV_VARS` come from ids.mjs, so a sixth
    // provider is covered the day it is added — and an emptied table would
    // otherwise make two of these rules unable to find anything, quietly.
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
    expect(KEY_NAMES.length).toBe(PROVIDER_IDS.length);
    expect(VENDOR_SDKS.length).toBeGreaterThan(0);
    expect(MEDIA_ENV_VARS.length).toBeGreaterThan(0);
  });

  it("🚨 every needle is findable in the real tree of the day", () => {
    // A pattern that no source can match is green from the wrong reason. So
    // each one is measured against the places it legitimately occurs — the two
    // homes these rules exempt. If one of these goes empty, the pattern has
    // drifted away from how this app is written, and the rule above it has
    // stopped being a rule.
    //
    // 🚨 **This file is excluded from its own probe, and that is not tidiness.**
    // The plants below are written out here as fixtures, so a pattern that
    // matched nothing else in the tree would still find itself and report that
    // it works. Measured: the SDK pattern was written without room for the space
    // in `from "…"`, matched not one real import, and this probe was green off
    // its own `require('…')` fixture.
    const SELF = join("lib", "ai", "providers", "leak-guard.test.ts");
    const sources = allFiles()
      .filter((f) => f !== SELF)
      .map((f) => readFileSync(join(ROOT, f), "utf8"));

    expect(
      sources.filter((s) => vendorSdkImportsIn(s).length > 0).length,
      "no file in this tree imports a vendor SDK — the pattern matches nothing",
    ).toBeGreaterThan(0);
    expect(
      sources.filter((s) => providerKeyReadsIn(s).length > 0).length,
      "no file in this tree reads a provider key by name — the pattern matches nothing",
    ).toBeGreaterThan(0);
    expect(
      sources.filter((s) => mediaCredentialReadsIn(s).length > 0).length,
      "no file in this tree reads a storage credential — the pattern matches nothing",
    ).toBeGreaterThan(0);
    expect(
      sources.filter((s) => providerNamesIn(s).length > 0).length,
    ).toBeGreaterThan(0);
  });

  it("🚨 would catch a violation, one planted per claim", () => {
    // The guard makes three different claims, so three different plants. Each
    // of these was run for real against the tree before it was written down
    // here (A85): a call site outside lib/ai/providers/ that imports the SDK,
    // one that reads a key, one that builds a vendor client by name.
    expect(vendorSdkImportsIn('import Anthropic from "@anthropic-ai/sdk";')).toEqual([
      "@anthropic-ai/sdk",
    ]);
    expect(vendorSdkImportsIn("const x = require('@anthropic-ai/sdk');")).toEqual([
      "@anthropic-ai/sdk",
    ]);
    expect(providerKeyReadsIn("const key = process.env.ANTHROPIC_API_KEY;")).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
    // The dynamic twin. This is the one a `blankStrings()` would have lost.
    expect(providerKeyReadsIn('const key = process.env["OPENAI_API_KEY"];')).toEqual([
      "OPENAI_API_KEY",
    ]);
    expect(providerNamesIn('const client = new OpenAI({ apiKey });')).toEqual(["openai"]);
    expect(modelNamesIn('model: "claude-sonnet-5"')).toEqual(["claude-"]);
    expect(mediaCredentialReadsIn("const b = process.env.MEDIA_S3_BUCKET;")).toEqual([
      "MEDIA_S3_BUCKET",
    ]);
    expect(mediaCredentialReadsIn('const b = env["MEDIA_S3_ACCESS_KEY_ID"];')).toEqual([
      "MEDIA_S3_ACCESS_KEY_ID",
    ]);

    // And the guard's own import path is real: a needle nobody can write down
    // is the failure `scripts/lib/source-text.test.ts` names.
    expect(vendorSdkImportsIn('import { runTask } from "@/lib/ai/run";')).toEqual([]);
  });

  it("🚨 does not punish a file for explaining the rule", () => {
    // The counter-check, and the reason this file was rewritten. Every line
    // below was a RED build on 2026-08-12, one per rule.
    expect(vendorSdkImportsIn('// Never write: import Anthropic from "@anthropic-ai/sdk";')).toEqual(
      [],
    );
    expect(providerKeyReadsIn("// and never read process.env.OPENAI_API_KEY here")).toEqual([]);
    expect(providerNamesIn("// This file must never name anthropic, openai or gemini.")).toEqual([]);
    expect(mediaCredentialReadsIn("/* process.env.MEDIA_S3_BUCKET belongs in lib/media/ */")).toEqual(
      [],
    );

    // A legitimate string is not a read either — an assertion message or a test
    // fixture that NAMES the read. Eight such lines in six files today, with
    // other variables (scripts/lib/env.test.ts has three of them).
    expect(providerKeyReadsIn('throw new Error("set process.env.OPENAI_API_KEY in .env");')).toEqual(
      [],
    );
    expect(mediaCredentialReadsIn('expect(namesIn("process.env.MEDIA_S3_BUCKET")).toEqual([]);')).toEqual(
      [],
    );

    // …while the bare NAME in a table is untouched by any of it, which is how
    // ids.mjs and `ai-check` may say `ANTHROPIC_API_KEY` out loud.
    expect(providerKeyReadsIn('const vars = { anthropic: "ANTHROPIC_API_KEY" };')).toEqual([]);
  });
});
