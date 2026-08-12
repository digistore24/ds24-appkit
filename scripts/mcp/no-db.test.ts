// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 The MCP server cannot reach a database, and this proves it rather than
// asserting it in a comment.
//
// The rule it protects: there is ONE write path in this product, and it is the
// app's own. A second one here would be a second implementation of every
// domain rule — the transaction, the row lock, the guard, the audit row — and
// the one that drifts is always the one nobody is looking at. It would also put
// a production connection string in an agent's configuration on a laptop, which
// is the thing this whole feature exists to remove.
//
// Written the way `scripts/modules/data-gate.test.ts` is written, and for the
// same reason it exists: a static import is resolved before a single line runs,
// so "we only use it in one branch" is not a defence. `module add` was once
// unusable on a fresh clone because one file imported the driver it never
// called.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveImport } from "@/scripts/lib/import-graph.mjs";
import { blankComments } from "@/scripts/lib/source-text.mjs";

const ENTRY = join(process.cwd(), "scripts/mcp/server.mjs");

/** Anything that could open a connection, by name. */
const FORBIDDEN = [
  "postgres",
  "drizzle-orm",
  "drizzle-orm/postgres-js",
  "@/db",
  "@/db/schema",
  "../../db/index.mjs",
];

/** Every static `import … from "x"` in a source, comments already blanked. */
function importsIn(source: string): string[] {
  const out: string[] = [];
  for (const match of blankComments(source).matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    out.push(match[1]);
  }
  // A bare side-effect import counts too: `import "../lib/env.mjs";`
  for (const match of blankComments(source).matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    out.push(match[1]);
  }
  return out;
}

/** Walks the transitive STATIC import graph from the entry point. */
function closure(entry: string): { files: string[]; specifiers: string[] } {
  const seen = new Set<string>();
  const specifiers: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    for (const specifier of importsIn(readFileSync(file, "utf8"))) {
      // 🚨 Pushed BEFORE any skip. `FORBIDDEN` names `@/db` and `@/db/schema`,
      // and `imports no npm package at all` reads the same array — both need
      // every specifier the walk SAW, not only the ones it followed.
      specifiers.push(specifier);
      // An alias IS walked now: `@/x` is `<app root>/x`, and a file reachable
      // only through one used to sit outside a guarantee that says
      // "transitively". A bare specifier (`postgres`, `node:fs`) answers null
      // and is still not walked — that is npm's and Node's business — and a
      // path of ours with nothing on disk answers `exists: false` rather than
      // the same null, so the two stay distinguishable.
      const target = resolveImport(file, specifier, { root: process.cwd() });
      if (target?.exists) queue.push(target.path);
    }
  }
  return { files: [...seen], specifiers };
}

describe("the MCP server opens no database", () => {
  const { files, specifiers } = closure(ENTRY);

  // The needle probe. A walk that silently found nothing would report green for
  // ever — which is the failure mode of every structural test that reads a tree,
  // and the reason this repo insists on the probe rather than the sweep alone.
  it("actually walked something", () => {
    expect(files.length).toBeGreaterThan(1);
    expect(specifiers.length).toBeGreaterThan(1);
    expect(files.some((file) => file.endsWith("server.mjs"))).toBe(true);
  });

  for (const forbidden of FORBIDDEN) {
    it(`never imports ${forbidden}`, () => {
      const hit = specifiers.find(
        (specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
      );
      expect(
        hit,
        `scripts/mcp/server.mjs reaches ${forbidden} through its import graph. The server is a ` +
          `CLIENT of the app — every write goes through /api/setup, so the transaction, the ` +
          `guard and the audit row exist once. A driver here is a second write path.`,
      ).toBeUndefined();
    });
  }

  it("imports no npm package at all beyond node: builtins", () => {
    // Stronger than the list above, and it is what actually holds: this file
    // ships to customers who run `npm ci`, and a dependency added for a
    // developer-time tool is weight in every deployed app.
    const external = specifiers.filter(
      (specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"),
    );
    expect(external, `unexpected package import(s): ${external.join(", ")}`).toEqual([]);
  });

  it("writes its logs to stderr, never to stdout", () => {
    // stdout IS the protocol on stdio. One `console.log` corrupts the stream,
    // and the symptom is a client that silently sees no tools — the classic way
    // one of these breaks.
    const source = blankComments(readFileSync(ENTRY, "utf8"));
    expect(source).not.toMatch(/console\.(log|info|warn|error)\s*\(/);
    expect(source).toContain("process.stderr.write");
  });

  it("takes its destination from configuration, never from a call", () => {
    // A request carries the key to whatever host it names, so a URL a model can
    // write is a URL a model can be talked into writing.
    const source = blankComments(readFileSync(ENTRY, "utf8"));
    expect(source).toContain("process.env[");
    expect(source).not.toMatch(/args\s*\.\s*url|arguments\s*\.\s*url|input\.url/);
  });

  // 🚨 The variables the server READS are the variables the template DOCUMENTS.
  //
  // This is not pedantry about naming: the refusal used to derive the name
  // (`APP_URL_${name.toUpperCase()}`) and so told an operator to set
  // `APP_URL_PRODUCTION` while the code read `APP_URL_PROD`. They would have
  // set it, nothing would have happened, and nothing would have said why.
  // `production` is spelled `PROD` in the .env because that is the suffix the
  // Digistore and media reference keys already use.
  it("reads exactly the variables .env.example documents", () => {
    const source = blankComments(readFileSync(ENTRY, "utf8"));
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");

    for (const name of [
      "APP_URL",
      "APP_URL_STAGING",
      "APP_URL_PROD",
      "SETUP_KEY",
      "SETUP_KEY_STAGING",
      "SETUP_KEY_PROD",
    ]) {
      expect(source, `the server never names ${name}`).toContain(`"${name}"`);
      expect(example, `.env.example does not document ${name}`).toContain(name);
    }

    // And the spelling that does NOT exist, so a future refactor cannot quietly
    // reintroduce the derived form.
    expect(source).not.toContain("APP_URL_PRODUCTION");
    expect(source).not.toContain("SETUP_KEY_PRODUCTION");
    expect(source).not.toMatch(/toUpperCase\(\)/);
  });
});
