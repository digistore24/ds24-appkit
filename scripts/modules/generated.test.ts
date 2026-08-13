// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The generated registries still say what the manifests say.
//
// They are checked in rather than built, because the deploy contract is
// `npm ci && npm run build` on four hosts and nothing in it runs a generator.
// The cost of that choice is exactly one failure mode — a generated file that
// stopped matching its source and nobody noticed — and this file is the price
// paid for it. Same shape as `agents-md-check` and `knowledge-check` in the
// factory: regenerate into memory, compare byte for byte.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { expectedGenerated, generatedFiles } from "./generate.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";
import { mergeModuleMessages } from "@/lib/modules/messages-merge";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("the generated files match the manifests", () => {
  const expected = expectedGenerated(ROOT);

  it("generates the files this app expects to exist", () => {
    // Non-vacuity: an `expectedGenerated()` that returned nothing would make
    // every comparison below pass on an empty loop.
    expect([...expected.keys()].sort()).toEqual([
      "db/schema-modules.ts",
      "lib/modules/account-notes-registry.ts",
      "lib/modules/component-registry.ts",
      "lib/modules/content-source-registry.ts",
      "lib/modules/cron-ids.mjs",
      "lib/modules/cron-registry.ts",
      "lib/modules/gate-registry.ts",
      "lib/modules/messages.ts",
      "lib/modules/nav-registry.ts",
      "lib/modules/presence-registry.ts",
      "lib/modules/registry.ts",
      "lib/modules/server-exports.ts",
      "lib/modules/setup-registry.ts",
      "lib/modules/slot-registry.ts",
    ]);
  });

  for (const [file, content] of expectedGenerated(ROOT)) {
    it(`${file} is current`, () => {
      const onDisk = readFileSync(join(ROOT, file), "utf8");
      expect(
        onDisk,
        `${file} no longer matches config/modules.json and the manifests. ` +
          `Run \`node run.mjs module sync\` and commit the result — it is an ordinary ` +
          `source file, and the customer's build runs no generator.\n\n` +
          `  This usually means a module.json was edited by hand: only \`add\`, ` +
          `\`remove\` and \`sync\` write these files, and \`npm run build\` builds the ` +
          `stale ones without a word. This test is the only thing that says so.`,
      ).toBe(content);
    });
  }
});

describe("every generated file says so", () => {
  for (const [file] of expectedGenerated(ROOT)) {
    it(`${file} carries the banner`, () => {
      // The one thing standing between a generated file and somebody editing it
      // by hand, then losing the edit at the next sync without a word.
      const onDisk = readFileSync(join(ROOT, file), "utf8");
      expect(onDisk).toContain("GENERATED — do not edit");
      expect(onDisk).toContain("node run.mjs module sync");
    });
  }
});

describe("what the generator produces for a module", () => {
  // The shipped app has no module, so the assertions above only ever see the
  // empty case. These feed the pure half a synthetic module so the interesting
  // branches are measured rather than assumed.
  const record = (id: string, manifest: Record<string, unknown>) => ({
    id,
    dir: `modules/${id}`,
    manifest,
  });
  const noLocales = () => [];

  it("re-exports a module's schema into the barrel", () => {
    const files = generatedFiles([record("community", { schema: "schema.ts" })], noLocales);
    // ⚠️ WITHOUT the file extension. TypeScript refuses
    // `from "…/schema.ts"` unless `allowImportingTsExtensions` is on, and
    // turning that on for one generated line would change how every file in the
    // app may be written. The manifest names FILES, imports name MODULES.
    expect(files.get("db/schema-modules.ts")).toContain(
      'export * from "@/modules/community/schema";',
    );
    expect(files.get("db/schema-modules.ts")).not.toContain("schema.ts\"");
  });

  it("exports nothing — but still exports — with no module", () => {
    // `export {}` and not an empty file: without it TypeScript reads the file as
    // a script, and `export *` from a script is an error.
    expect(generatedFiles([], noLocales).get("db/schema-modules.ts")).toContain("export {};");
  });

  it("leaves a module with no tables out of the schema barrel", () => {
    const files = generatedFiles([record("tiny", {})], noLocales);
    expect(files.get("db/schema-modules.ts")).toContain("export {};");
  });

  it("imports a module's server entry into the registry", () => {
    const files = generatedFiles([record("community", { entry: "module.ts" })], noLocales);
    const registry = files.get("lib/modules/registry.ts")!;
    expect(registry).toContain('import community_entry from "@/modules/community/module";');
    expect(registry).toContain("export const MODULES: readonly ModuleEntry[] = [\n  community_entry,\n]");
  });

  it("leaves a module with no server entry out of the registry", () => {
    // A module that only adds pages implements nothing — an empty entry in the
    // list would be a `mod.eraseFor?.()` on undefined for ever.
    const files = generatedFiles([record("tiny", {})], noLocales);
    expect(files.get("lib/modules/registry.ts")).toContain(
      "export const MODULES: readonly ModuleEntry[] = [];",
    );
  });

  it("types the registry against the hand-written contract", () => {
    // The generator produces the LIST; `lib/modules/types.ts` produces the
    // SHAPE. A contract nobody wrote by hand is one nobody agreed to.
    expect(generatedFiles([], noLocales).get("lib/modules/registry.ts")).toContain(
      'import type { ModuleEntry } from "./types";',
    );
  });

  it("merges a module's texts per locale", () => {
    const files = generatedFiles(
      [record("community", { messages: { namespaces: ["community"], dir: "messages" } })],
      () => ["de", "en"],
    );
    const messages = files.get("lib/modules/messages.ts")!;
    expect(messages).toContain('import community_de from "@/modules/community/messages/de.json";');
    expect(messages).toContain("de: [community_de].reduce(mergeModuleMessages, {}),");
    expect(messages).toContain("en: [community_en].reduce(mergeModuleMessages, {}),");
  });

  it("gives two modules of one locale one entry each", () => {
    const files = generatedFiles(
      [
        record("chat", { messages: { namespaces: ["chat"], dir: "messages" } }),
        record("community", { messages: { namespaces: ["community"], dir: "messages" } }),
      ],
      () => ["de"],
    );
    const messages = files.get("lib/modules/messages.ts")!;
    expect(messages).toContain("de: [chat_de, community_de].reduce(mergeModuleMessages, {}),");
    expect(messages).toContain('import { mergeModuleMessages } from "./messages-merge";');
  });

  it("🚨 does NOT spread two modules over each other", () => {
    // This assertion is the one that was missing, and its absence cost eight
    // refusals rendering as raw keys once a second module was installed.
    //
    // `{ ...chat_de, ...community_de }` looks right and IS right for the
    // namespaces a module owns — the manifest declares those and `loadModules()`
    // refuses a collision. It is wrong for `errors` and `nav`, which no module
    // declares because they belong to the CORE and every module contributes a
    // few keys to them. A spread makes the last module's `errors` the only one.
    const files = generatedFiles(
      [
        record("chat", { messages: { namespaces: ["chat"], dir: "messages" } }),
        record("community", { messages: { namespaces: ["community"], dir: "messages" } }),
      ],
      () => ["de"],
    );
    expect(files.get("lib/modules/messages.ts"), "the flat spread is back").not.toMatch(
      /\.\.\.\w+_de,\s*\.\.\.\w+_de/,
    );
  });

  it("🚨 two modules' `errors` survive each other — measured, not described", () => {
    // The assertions above read the generated TEXT. This one runs the function
    // that text calls, on the shape that actually broke: two modules, each with
    // its own namespace AND a few keys in the shared `errors`.
    const chat = { chat: { title: "Chat" }, errors: { chatTooLong: "…" } };
    const community = { community: { title: "Room" }, errors: { roomClosed: "…" } };

    const merged = [chat, community].reduce(
      (all, one) => mergeModuleMessages(all, one as Record<string, unknown>),
      {} as Record<string, unknown>,
    );

    expect(merged.chat).toEqual({ title: "Chat" });
    expect(merged.community).toEqual({ title: "Room" });
    expect(merged.errors, "the second module deleted the first one's refusals").toEqual({
      chatTooLong: "…",
      roomClosed: "…",
    });
  });

  it("makes a dashed module id a legal identifier", () => {
    // `import ab-x_de from …` does not parse. Found by writing the case, not by
    // hitting it in production.
    const files = generatedFiles(
      [record("ab-x", { messages: { namespaces: ["ab-x"], dir: "messages" } })],
      () => ["de"],
    );
    expect(files.get("lib/modules/messages.ts")).toContain("import ab_x_de from");
    expect(files.get("lib/modules/messages.ts")).not.toContain("import ab-x_de");
  });
});

describe("the consumers really consume it", () => {
  // A generated file nothing imports is the failure every assertion above would
  // sail past.
  it("db/schema.ts re-exports the module barrel", () => {
    expect(readFileSync(join(ROOT, "db/schema.ts"), "utf8")).toContain(
      'export * from "./schema-modules";',
    );
  });

  it("i18n/catalogue.ts merges the module texts, and it is the only place that does", () => {
    // Through `mergeModuleMessages`, never a plain spread — the shared `errors`
    // and `nav` namespaces belong to the core and would be REPLACED by one.
    // `scripts/modules/messages.test.ts` carries that measurement.
    //
    // The merge moved out of `i18n/request.ts` when operator mail needed the
    // catalogue with no request behind it. What matters here is that it moved
    // rather than being copied: a second merge would agree with the first until
    // somebody installed a module.
    const catalogue = readFileSync(join(ROOT, "i18n/catalogue.ts"), "utf8");
    expect(catalogue).toContain("MODULE_MESSAGES");
    expect(catalogue).toMatch(/mergeModuleMessages\(/);

    const request = readFileSync(join(ROOT, "i18n/request.ts"), "utf8");
    expect(request).toMatch(/messagesFor\(/);
    expect(blankComments(request), "a second merge is back in i18n/request.ts").not.toMatch(
      /mergeModuleMessages\(/,
    );
  });

  it("account deletion erases every module, inside the transaction", () => {
    // 🚨 The order is the property: every module scrubs what the member wrote
    // BEFORE the row goes, so there is no window where the account is gone and
    // the words are not. `lib/users/deletion-wiring.test.ts` holds the same
    // line for the community's own scrub.
    const source = readFileSync(join(ROOT, "lib/users/manage.ts"), "utf8");
    const loop = source.indexOf("for (const mod of MODULES) await mod.eraseFor?.(tx, memberId)");
    const rowDelete = source.indexOf("tx.delete(users)");
    expect(loop, "the module erasure loop is gone").toBeGreaterThan(0);
    expect(rowDelete).toBeGreaterThan(loop);
  });
});
