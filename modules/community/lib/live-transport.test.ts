// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// **One live transport, and a test that says so.**
//
// This guard exists because the same polling loop was written three times and
// then fixed once. Story 20.2 wrote it in `live-discussion.tsx`; Story 21.1
// copied the whole component into `live-conversation.tsx`; Story 22.2 wrote a
// third variant in `feed-list.tsx`. On 2026-08-06 a review found four defects
// in that loop — a visibility change forking a second polling chain, no
// back-off on repeated failures, no latch when the kill switch answers 404, a
// third tie-break currency in the merge — and they were repaired in ONE of the
// three files. The other two stood beside it, unchanged, until a form-check
// found them a day later.
//
// So this is not a style rule. It is the difference between a defect being
// fixed and a defect being fixed *somewhere*.
//
// ── What it checks, and what it deliberately cannot ───────────────────────
//
// It checks the things a machine can be sure about: who talks to the live
// endpoint, and whether anybody has grown a second ordering. It cannot check
// that a hook is used *correctly*, and it does not try — `rules.test.ts` and
// `live-parity.test.ts` own the behaviour.
//
// The mount-key check is line-based, and says so: a `key` on a line further
// down than the ones scanned would slip past. Every mount in this repo is
// written in the shape below, and the day one is not, this test is where the
// reader will be standing. (The same trade, and the same disclosure, as
// `scripts/nested-make.test.mjs` in the factory.)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");

/** Every `.ts`/`.tsx` under the community's client surfaces. */
function sources(dir: string): string[] {
  const full = path.join(ROOT, dir);
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

const FILES = [
  ...sources("modules/community/components"),
  ...sources("modules/community/pages"),
];
/**
 * The one place a scanned file is read — through `blankComments()`.
 *
 * The corpus is `.ts`/`.tsx` and nothing else, so the blind form is right.
 * Every check below hunts a piece of CODE that this module's files talk ABOUT
 * at length: the three defects of 2026-08-06 are recounted in comments beside
 * the very mounts they were found at, and the `key=` on each of those mounts
 * sits under four lines explaining why. A raw read would report a file for
 * naming `fetch("/api/community/live")` in a header, and would let a `key=`
 * written in a comment excuse a mount that has none. Blanking preserves lines
 * and length, so the `file:line` this test prints still points at the mount.
 */
const read = (rel: string) => blankComments(readFileSync(path.join(ROOT, rel), "utf8"));

/** The one file allowed to know how the live endpoint is called. */
const THE_TRANSPORT = "modules/community/components/use-live-scope.ts";

describe("one live transport", () => {
  it("finds the files it is meant to scan", () => {
    // A glob that quietly matches nothing turns every check below green.
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES).toContain(THE_TRANSPORT);
  });

  it("lets only the shared hook call the live endpoint", () => {
    const callers = FILES.filter((file) => {
      if (file === THE_TRANSPORT) return false;
      return /fetch\(\s*["'`]\/api\/community\/live/.test(read(file));
    });
    expect(
      callers,
      "these fetch the live endpoint directly instead of using " +
        `\`useLiveScope\` (${THE_TRANSPORT}). The loop carries the in-flight ` +
        "guard, the generation counter, the back-off and the 404/401 latch — a " +
        "second copy of it is a second place for all four to be wrong: " +
        callers.join(", "),
    ).toEqual([]);
  });

  it("keeps one ordering for arriving rows", () => {
    // `mergeRows()` in `rules.ts` upserts by id and orders with
    // `compareCursor()` — the module's one comparison, the same one the SQL
    // and the read markers spend. A local sort here is a second currency, and
    // `localeCompare` is a third: ICU collation, where this module compares
    // UTF-16 code units and Postgres compares by its own collation.
    const offenders = FILES.filter((file) =>
      read(file).includes("localeCompare"),
    );
    expect(
      offenders,
      "these order rows with `localeCompare` instead of `mergeRows()` from " +
        "modules/community/lib/rules.ts: " +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("gives every live mount a key", () => {
    // Without one React reconciles by POSITION, so navigating between two
    // conversations — or two lesson pages carrying an embed — keeps the first
    // scope's rows, cursor and stop-latch, and polls the second scope with the
    // first scope's cursor.
    const unkeyed: string[] = [];
    for (const file of FILES) {
      const lines = read(file).split("\n");
      lines.forEach((line, index) => {
        if (!/<(LiveDiscussion|LiveConversation)\b/.test(line)) return;
        const window = lines.slice(index, index + 8).join("\n");
        if (!/\bkey=/.test(window)) {
          unkeyed.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(
      unkeyed,
      "a live surface mounted without a `key` keeps the previous scope's " +
        "state when the route changes under it: " + unkeyed.join(", "),
    ).toEqual([]);
  });
});
