// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What the appliers say about their own rows.
//
// Each applier exports `present(sql)` — it has been in the contract since
// `content-apply` shipped, and it kept its purpose through the withdrawal of the
// old `content-check` precisely so this could use it.
//
// ⚠️ `expected` is `null` for every applier, deliberately. An applier knows how
// many rows it WOULD write, but an operator who has since added ten courses
// through the setup surface has not made the environment wrong — inventing an
// expected number here would turn ordinary growth into a red line. What is worth
// seeing is ZERO, and zero is reported.

import { pathToFileURL } from "node:url";

import { applierSql } from "@/db";
import type { PresenceItem } from "./presence";

export async function applierPresence(): Promise<PresenceItem[]> {
  const { applierSources } = await import("@/scripts/content/_appliers.mjs");

  const items: PresenceItem[] = [];
  // Absolute paths, from the app's own root — the same enumeration
  // `content-apply` walks, so neither can report a module's applier the other
  // never saw.
  for (const { label, file } of applierSources(process.cwd())) {
    // 🚨 **The bundler has to be told to keep its hands off, and `@vite-ignore`
    // is the wrong spell here.** This runs inside the Next bundle — the check is
    // a setup TOOL now, not a bare-Node script — and Next builds with
    // webpack/Turbopack, which answered a fully dynamic specifier with
    // "Cannot find module as expression is too dynamic". That made the CORE's
    // report `unanswered` in every app, which `presenceProblems()` counts as a
    // failure: `node run.mjs content-check` was red everywhere, for a reason
    // that had nothing to do with content. Nothing caught it because
    // `deploy-test-modules` has no setup key and never runs the command.
    //
    // A file URL rather than a bare path: a native dynamic import of an
    // absolute path is deprecated on POSIX and simply fails on Windows, and
    // this template ships to three systems (`scripts/content/apply.mjs` imports
    // its appliers the same way).
    const module = await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */
      pathToFileURL(file).href
    );
    if (typeof module.present !== "function") {
      // 🚨 Not skipped. An applier that cannot say what it put there is exactly
      // the silence this whole check exists to break — `collectPresence()` turns
      // a throw into an `unanswered` report, which is a failure.
      throw new Error(`${file} exports no present(sql) — see docs/content.md`);
    }
    items.push({ what: label, found: await module.present(applierSql), expected: null });
  }
  return items;
}
