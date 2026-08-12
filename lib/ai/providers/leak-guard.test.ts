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
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

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

describe("no vendor SDK outside the provider layer", () => {
  it("holds for every source file", () => {
    // `@anthropic-ai/sdk` is the only vendor SDK in package.json, and the only
    // one that may be. The other four providers are reached with `fetch` — see
    // NFR-13, and `lib/ai/providers/openai-compat.ts` for what that costs.
    const offenders: string[] = [];

    for (const path of allFiles()) {
      if (isProviderFile(path)) continue;
      const source = readFileSync(join(ROOT, path), "utf8");
      if (/from ["']@anthropic-ai\/sdk["']|require\(["']@anthropic-ai\/sdk["']\)/.test(source)) {
        offenders.push(path);
      }
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
    const keyPattern =
      /process\.env\.(ANTHROPIC|OPENAI|GEMINI|MISTRAL|OPENROUTER)_API_KEY|process\.env\[["'](ANTHROPIC|OPENAI|GEMINI|MISTRAL|OPENROUTER)_API_KEY["']\]/;

    const offenders: string[] = [];

    for (const path of allFiles()) {
      if (isProviderFile(path)) continue;
      // The check command reports which keys are SET without ever using one,
      // and it does that through the shared name table rather than by naming a
      // variable itself — so it is not an exception, it simply does not match.
      const source = readFileSync(join(ROOT, path), "utf8");
      if (keyPattern.test(source)) offenders.push(path);
    }

    expect(
      offenders,
      `these files read a provider API key. Only lib/ai/providers/registry.ts may.`,
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
    for (const provider of ["anthropic", "openai", "gemini", "mistral", "openrouter"]) {
      expect(route.toLowerCase()).not.toContain(provider);
    }
  });

  it("names no model", () => {
    expect(route).not.toMatch(/claude-|gpt-|gemini-|mistral-/);
  });

  it("goes through a task", () => {
    // `streamTaskWithTools("chat", …)` since the assistant gained her content
    // tools — the intent is unchanged: the assistant names a TASK, and which
    // company answers stays in config/ai-models.json. The loop variant calls
    // streamTask() per round, so every round is still the layer's.
    expect(route).toMatch(/streamTask(WithTools)?\(\s*"chat"/);
  });
});

describe("the scan itself", () => {
  it("actually reads files, so an empty result means something", () => {
    // Non-vacuity: a broken path would make every assertion above pass by
    // scanning nothing at all.
    const files = allFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.includes("chat"))).toBe(true);
  });

  it("would catch a violation if there were one", () => {
    // The guard's own guard: prove the pattern matches what it claims to.
    const pattern = /from ["']@anthropic-ai\/sdk["']/;
    expect(pattern.test('import Anthropic from "@anthropic-ai/sdk";')).toBe(true);
    expect(pattern.test('import { runTask } from "@/lib/ai/run";')).toBe(false);
  });
});

// ── The same rule for the storage credentials ──────────────────────────────
//
// Added after a code review pointed out that `lib/media/` makes exactly the
// claim `lib/ai/providers/` makes — "no call site reads a storage credential" —
// and nothing enforced it. It was true when it was written, which is precisely
// when a guard is cheap and precisely when nobody writes one.

describe("storage credentials stay in lib/media/", () => {
  const MEDIA_ENV_VARS = [
    "MEDIA_S3_ACCESS_KEY_ID",
    "MEDIA_S3_SECRET_ACCESS_KEY",
    "MEDIA_S3_ENDPOINT",
    "MEDIA_S3_BUCKET",
  ];

  it("are read nowhere else", () => {
    const offenders: string[] = [];

    for (const dir of SCANNED) {
      for (const file of sourceFiles(dir)) {
        // `lib/media/` is where they belong. `instrumentation.ts` checks whether
        // they are PRESENT so the app can refuse to start without them, which is
        // a different thing from using one — and it is named here rather than
        // silently allowed by a prefix match.
        if (file.startsWith(MEDIA_DIR)) continue;
        if (file === "instrumentation.ts") continue;

        const text = readFileSync(join(ROOT, file), "utf8");
        for (const name of MEDIA_ENV_VARS) {
          // A mention in a comment or a message is fine — reading the value is
          // not. `process.env.NAME` and `env.NAME` are the two ways.
          const reads = new RegExp(`(process\\.)?env\\.${name}\\b|env\\[["\'\`]${name}`, "");
          if (reads.test(text)) offenders.push(`${file} reads ${name}`);
        }
      }
    }

    expect(
      offenders,
      `storage credentials belong in ${MEDIA_DIR}/ — everything above it takes a ` +
        `MediaStore and does not know which one it has:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
