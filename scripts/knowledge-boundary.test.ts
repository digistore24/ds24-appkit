// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// AD-51: the corpus is build-time input for agents, never a runtime knowledge
// path. A vendor's videos, ebooks and recordings live in the corpus folder
// under `content/` (the two exact path strings are NEEDLES below — spelling
// them out here would make this file its own first finding), and they inform
// WRITING — the handbook the chat reads stays the one curated set under
// `content/knowledge/`, whole and cacheable. The moment any runtime code
// references the corpus, the boundary that shapes the whole epic is gone: the
// chat starts answering from raw material nobody curated, and the app's cost
// and quality guarantees go with it. An invariant in this template is a
// structural test, not a sentence in a guide — this file is that test.
//
// ── Scan scope is deliberate — do not widen or misread it ───────────────────
// (implementation-readiness report 2026-08-02, Epic Quality Review finding 2)
// It greps `app/`, `lib/` and `scripts/` for the two NEEDLES and NOTHING ELSE.
// The intake documentation under `docs/` and `.claude/skills/` may name them
// freely — those trees are not scanned. And the strings
// `.data/knowledge-media` and `content/knowledge-media` must never be added
// here: Story 18.4's `kb-media-sync` references them legitimately — AD-52 and
// AD-55 design them IN. Widening the scan would forbid the design.
//
// Unlike `portability.test.ts` there is no comment-stripping and no escape
// marker: a corpus path in a comment under `lib/` is still a hit. The
// allowlist below — empty at introduction — is the ONLY exemption mechanism,
// so every future exemption is a reviewed decision with its reason beside it.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

// Built from halves so this file's own needles do not flag this file — with no
// escape marker, a literal here would be the one unavoidable finding.
const NEEDLES = ["content/knowledge-" + "sources", "graphify" + "-out"];

const SCANNED_DIRS = ["app", "lib", "scripts"];

/**
 * Repo-relative file paths allowed to carry one of the needles, each with its
 * reason as a comment beside it. Empty at introduction, and meant to stay
 * close to it: an entry here is a reviewed decision, never a quick fix.
 */
const ALLOWLIST: string[] = [
  // `scripts/dev/journey.mjs` — the project's path as DATA. One of its thirty-one
  // rows is the step `knowledge-intake`, and what proves that step done is that
  // the corpus folder EXISTS: the intake creates it, a fresh app has none. So the
  // path appears there as a `{ kind: "dir", path }` trace and in the comment
  // explaining it.
  //
  // 🚨 **Why this is a decision and not a hole.** AD-51 forbids the corpus being
  // a runtime KNOWLEDGE path — the chat answering out of raw material nobody
  // curated. This file never opens anything in the folder: it asks `readdirSync`
  // whether there is one, exactly as it asks whether `docs/design.md` is there. It
  // is not runtime code either — nothing under `app/` or `lib/` imports it; it is
  // read by `node run.mjs journey` and by the session greeting, which are the
  // agent's own orientation and were always allowed to know the corpus exists
  // (`docs/knowledge.md` and the intake skill say so at length, and those trees
  // are deliberately not scanned).
  //
  // What is still forbidden here, and what this entry must never be stretched to
  // cover: reading a file out of that folder, passing any of it to a model, or
  // putting the path into anything `app/` or `lib/` can import.
  "scripts/dev/journey.mjs",
];

/** All file types are scanned — a JSON fixture naming the corpus path is the
 * same boundary breach as an import. Only genuinely binary files are skipped,
 * the same set `portability.test.ts` skips. */
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?|pdf|zip)$/i;

function filesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, found);
    else if (!BINARY.test(entry)) found.push(full);
  }
  return found;
}

describe("the corpus is never read at runtime (AD-51)", () => {
  it("no file under app/, lib/ or scripts/ references the corpus paths", () => {
    const findings: string[] = [];

    for (const dir of SCANNED_DIRS) {
      for (const file of filesUnder(path.join(ROOT, dir))) {
        const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
        if (ALLOWLIST.includes(relative)) continue;

        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .forEach((line, index) => {
            for (const needle of NEEDLES) {
              if (line.includes(needle)) {
                findings.push(
                  `${relative}:${index + 1} references ${needle} — the corpus is never read at runtime (AD-51)`,
                );
              }
            }
          });
      }
    }

    expect(findings).toEqual([]);
  });
});
