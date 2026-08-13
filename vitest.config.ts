// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // 🚨 `.tsx` too, although there is not one in this tree today.
    //
    // With `**/*.test.ts` alone a component test written with JSX is not
    // REJECTED — it is silently not collected, and `vitest run` reports a green
    // suite that never saw it. For a customer writing their first test around a
    // form with client-side validation that is the likeliest trap in this whole
    // setup, and "green because it skipped" is the confusion this repo refuses
    // everywhere else.
    //
    // ⚠️ It does NOT make such a test pass: `environment: "node"` has no DOM,
    // so it fails with `document is not defined` — which is the honest answer
    // and names the missing piece. What components are checked with instead is
    // `node run.mjs smoke` + `errors` against the running app (CLAUDE.md →
    // *Never ship a broken page*); how to add a DOM environment when a unit
    // test really is the right tool is docs/conventions.md.
    include: ["**/*.test.{ts,tsx}"],
    // ── Coverage: a tool, deliberately not a gate ──────────────────────────
    //
    // `npm run test:coverage` — never `npm run test`, and never a threshold.
    //
    // 🚨 **A percentage would be the wrong instrument in this app, and the
    // measurement says so rather than a preference.** Twelve shipped files sit
    // at 0 %, and six of them are `ui.tsx` — client components this project
    // checks with `node run.mjs smoke` + `errors` against the running app
    // instead of by rendering them in isolation (docs/conventions.md → *What
    // checks a component*). A threshold would demand unit tests for exactly the
    // files it was decided not to unit-test, and a gate that asks for the wrong
    // thing is the brake somebody removes — taking the intent with it.
    //
    // What the report is FOR is the other six: server-side logic at or near
    // zero. That reading is what named `lib/digistore/payment-event.ts` (the
    // 411-line money function that had no test at all) and `lib/modules/`
    // (twenty files of registry spine with one). It is a question a maintainer
    // asks on purpose, and the answer is a LIST of files rather than a number.
    //
    // Baseline on 2026-08-13, with the excludes below in force: **64.5 % of
    // statements, 62.4 % of branches**. (Over the raw tree, `ui.tsx` included,
    // it reads 61.8 % — the difference IS the client components, which is the
    // argument above in one number.) Written down so the next reading has
    // something to be a change from — not as a target.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // The shipped tree, minus what a unit test is not the tool for.
      include: ["lib/**", "app/**", "db/**", "modules/*/lib/**"],
      exclude: ["**/*.test.ts", "**/ui.tsx", "**/*-ui.tsx", "lib/modules/*-registry.ts"],
      // No `thresholds` key, on purpose. See above.
    },
    server: {
      deps: {
        // next-auth's ESM files import "next/server" without an extension.
        // Next itself is always consumed through a bundler where that
        // resolves; Node's native ESM resolver — which vitest uses for
        // externalized node_modules — refuses it. Inlining routes next-auth
        // through vite's resolver instead, so proxy.test.ts can execute the
        // real middleware wiring rather than only reading its source.
        inline: ["next-auth"],
      },
    },
  },
});
