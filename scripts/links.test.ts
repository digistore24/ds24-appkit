// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Every relative link in the guidance points at a file that exists.
//
// ── Why this is worth a test ───────────────────────────────────────────────
// A skill that says *"the reference is [`docs/visuals.md`](../../docs/visuals.md)"*
// with one `../` too few is a skill that sends an agent looking for a file that
// is not there. Nothing fails, nothing warns — the agent shrugs and carries on
// without the reference it was told to read, and the guidance quietly becomes
// worse than it looks.
//
// Six of these were live in this repo when the check was written, three of them
// years-old, which is exactly the shape of rot a test catches and review does
// not: the wrong number of `../` is invisible unless somebody counts.
//
// It checks relative links only. An `https://` link goes stale in a way no
// local test can see.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Where guidance lives. Everything an agent or a customer is told to read. */
const TREES = [".claude/skills", "docs"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".dev", "reports"]);

function* markdownFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* markdownFiles(rel);
    else if (entry.endsWith(".md")) yield rel;
  }
}

/** `[text](target)` — the target only, and only the local ones. */
function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    links.push(target);
  }
  return links;
}

describe("relative links in the guidance", () => {
  const files = [...TREES.flatMap((tree) => [...markdownFiles(tree)]), "CLAUDE.md"];

  it("finds the guidance to check", () => {
    // A guard against the walk silently finding nothing — which would make
    // every assertion below pass for the wrong reason.
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    const links = relativeLinks(readFileSync(join(ROOT, file), "utf8"));
    if (links.length === 0) continue;

    it(`in ${file} all point at a file that exists`, () => {
      const broken = links.filter((target) => {
        // A fragment is a heading, and this test does not read headings.
        const path = target.split("#")[0];
        if (path === "") return false;
        const full = normalize(resolve(dirname(join(ROOT, file)), path));
        try {
          statSync(full);
          return false;
        } catch {
          return true;
        }
      });

      expect(
        broken,
        `${file}: ${broken.join(", ")} — count the ../ again. A skill file sits ` +
          `three levels down (.claude/skills/<name>/), so the app root is ../../../`,
      ).toEqual([]);
    });
  }
});

// ── No factory paths in the customer's copy ────────────────────────────────
//
// This app is a COPY of `template/` in the source repo, so a path written
// `template/CLAUDE.md` or `template/docs/…` names a folder the customer does
// not have and cannot create. It reads as a typo they should fix, and there is
// nothing to fix — the file is at `CLAUDE.md`, one level up from where the
// sentence sends them.
//
// This is the narrow mistake that survives every other check: not a leaked
// internal note, but a perfectly correct reference written from the wrong point
// of view. One shipped, in `docs/digistore-integration.md`, and a reviewer
// found it rather than a test.
describe("guidance does not point at the factory's tree", () => {
  const files = [...TREES.flatMap((tree) => [...markdownFiles(tree)]), "CLAUDE.md", "AGENTS.md"];

  for (const file of files) {
    it(`${file} names no template/ path`, () => {
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), "utf8");
      } catch {
        return; // AGENTS.md is generated; absent is not this test's problem.
      }

      const offenders = [
        ...text.matchAll(/(?:^|[\s(`])(template\/[A-Za-z0-9._/-]+)/g),
      ].map((match) => match[1]);

      expect(
        offenders,
        `${file} points at ${offenders.join(", ")} — that path exists in the ` +
          `source repo, not in the app the customer cloned. Drop the "template/".`,
      ).toEqual([]);
    });
  }
});
