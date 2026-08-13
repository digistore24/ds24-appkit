// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Three claims about the MEMBER's course surface that no behavioural test can
// make, because all three are about the file somebody adds NEXT.
//
//   1. every exported action opens with `viewer()`
//   2. no action takes a member id
//   3. nothing under `pages/` renders text as markup
//
// The sister of `../admin/guard.test.ts`, built the same way and for the same
// stated reason — but the stakes here are the other ones. That surface writes
// CONTENT rows and its guard is `requireOwner()`; this one reads and writes a
// row belonging to a MEMBER, and it renders prose a stranger typed. So claims 1
// and 2 are an IDOR guard rather than an admin guard, and claim 3 exists at all.
//
// 🚨 **Claim 3 is here because nothing else covers this tree.**
// `modules/community/lib/render-safety.test.ts` is the template's guard against
// member text becoming markup, and `CLAUDE.md` describes it as failing "on
// `dangerouslySetInnerHTML` anywhere in the tree" — it does not: its `SCANNED`
// list names three `modules/community/…` paths. This file closes the gap for
// this module. A scanner shared by both trees is the right answer and is not
// this story's; until it exists, two files each say it about their own.
//
// 🚨 **Through `blankComments()`, never a regex of its own.** A checker that
// greps source punishes a file for explaining itself — `actions.ts` says
// "No action takes a member id" in the comment that explains why it never reads
// one, and `unit/page.tsx` names the forbidden call in order to say it is never
// used. `scripts/lib/source-text.mjs` carries the measured post-mortem.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments } from "@/scripts/lib/source-text.mjs";

const ROOT = process.cwd();
const DIR = join("modules", "courses", "pages");

/** Every source file under `pages/`, at any depth. */
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* sourceFiles(rel);
    else if (/\.tsx?$/.test(entry)) yield rel;
  }
}

const FILES = [...sourceFiles(DIR)].map((file) => ({
  file,
  source: blankComments(readFileSync(join(ROOT, file), "utf8")),
}));

/**
 * The renderers this tree hands prose to, wherever they live.
 *
 * 🚨 **Claim 3 is about what reaches the member's screen, not about a
 * directory.** Since 2026-08-12 a lesson body goes through the CORE's markdown
 * subset (`lib/legal/markdown.ts` → `components/legal-body.tsx`) rather than a
 * hand-rolled split inside `pages/`, and a scan of `pages/` alone would have
 * kept saying "no markup here" while the file actually doing the rendering sat
 * one import away and unread. `lib/render-safety.test.ts` scans this module's
 * three directories and would miss it for the same reason.
 *
 * So the imported renderer is scanned too. It is deliberately a SHORT list of
 * named files rather than a walk of the import graph: what this claim protects
 * is prose becoming markup, and there are two files in the template that turn
 * prose into elements.
 */
const RENDERERS = ["components/legal-body.tsx", "lib/legal/markdown.ts"].map((file) => ({
  file,
  source: blankComments(readFileSync(join(ROOT, file), "utf8")),
}));

/**
 * The `"use server"` files, found rather than listed.
 *
 * There is one today. A list kept by hand is one a second file joins late —
 * and what makes "everything exported here" the right set is that an exported
 * function of a `"use server"` file IS a public endpoint.
 */
const SERVER_FILES = FILES.filter(({ file, source }) =>
  file.endsWith(".test.ts") ? false : /^\s*["']use server["']/m.test(source),
);

/**
 * Every `export async function …`, with the text that follows it up to the next
 * one. A split rather than a parser, exactly as on the admin surface: the shape
 * is fixed by this template's own convention.
 */
function actions(source: string): { name: string; body: string }[] {
  const chunks = source.split(/export\s+async\s+function\s+/).slice(1);
  return chunks.map((chunk) => ({
    name: chunk.slice(0, chunk.indexOf("(")).trim(),
    body: chunk,
  }));
}

const FOUND = SERVER_FILES.flatMap(({ file, source }) =>
  actions(source).map((action) => ({ ...action, file })),
);

/**
 * The forbidden call, built from halves.
 *
 * Spelled in one piece, this file would match itself and every run would fail on
 * its own source — the `modules/community/lib/render-safety.test.ts` trick, for
 * the same reason.
 */
const NEEDLE = "dangerously" + "SetInnerHTML";

describe("every action on the course's member surface", () => {
  it("finds the actions at all", () => {
    // The needle that keeps the rest from being vacuous. A scan that matched
    // nothing would report every claim below as satisfied — "green because it
    // checked" and "green because it found nothing" are the same colour.
    expect(SERVER_FILES.map(({ file }) => file)).toEqual([join(DIR, "actions.ts")]);
    expect(FOUND.map((action) => action.name)).toContain("setCompletedAction");
    expect(FOUND.map((action) => action.name)).toContain("submitTaskAction");
  });

  it("🚨 opens with viewer() — the off state, the session and the purchase gate", () => {
    for (const { name, file } of FOUND) {
      expect(name, `${file} → ${name} is exported but is not named …Action`).toMatch(/Action$/);
    }
    for (const { name, file, body } of FOUND) {
      expect(
        body,
        `${file} → ${name} does not call viewer(). A Server Action is an HTTP endpoint of its own — ` +
          `the page that rendered its form proves nothing about a request somebody replayed. ` +
          `viewer() is courseOffReason(), then requireActiveUser(), then courseAccessFor(), and ` +
          `none of the three is optional.`,
      ).toMatch(/await\s+viewer\(\)/);
    }
  });

  it("🚨 takes no member id from its form", () => {
    // The account acted on is always the session's own. This is the surface
    // where it matters most in this module: a submission is somebody's
    // unpublished writing, and a member id out of a `FormData` would be an IDOR
    // straight onto it.
    for (const { name, file, body } of FOUND) {
      expect(
        body,
        `${file} → ${name} reads a member id out of its FormData. The account acted on is never ` +
          `named by the request — the same guarantee spendTokens() and /api/v1 give.`,
      ).not.toMatch(/get\(\s*["'`](memberId|member_id|userId|user_id)["'`]\s*\)/);
    }
  });
});

describe("nothing under the course's member pages renders text as markup", () => {
  it("finds the tree at all", () => {
    expect(
      FILES.map(({ file }) => file).sort(),
      `no source files under ${DIR} — did the tree move? This scan passes vacuously ` +
        `if it reads nothing, which is the failure mode of every grep-the-tree test.`,
    ).toContain(join(DIR, "unit", "ui.tsx"));
    expect(FILES.length).toBeGreaterThanOrEqual(4);

    // The imported renderer is a file on disk too, and a wrong path here would
    // make the scan below read an empty string and pass about nothing.
    for (const { file, source } of RENDERERS) {
      expect(source.length, `${file} read as empty — the renderer moved`).toBeGreaterThan(200);
    }
  });

  it(`🚨 neither this tree nor the renderer it imports turns prose into markup`, () => {
    const offenders: string[] = [];
    for (const { file, source } of [...FILES, ...RENDERERS]) {
      source.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(NEEDLE)) offenders.push(`${file}:${index + 1}`);
      });
    }

    expect(
      offenders,
      `this tree renders a member's own hand-in and an answer written about it — so raw HTML ` +
        `must not be rendered anywhere in it. Prose becomes React elements through parsers that ` +
        `hand back DATA and never a string of markup: a member's text through ` +
        `components/member-text.tsx (paragraphs, deliberately no markdown at all — a clickable ` +
        `foreign link written by a member is a phishing surface), the operator's lesson body ` +
        `through lib/legal/markdown.ts + LegalBody, which are scanned here BY NAME because they ` +
        `live outside this module. Both escape by construction, and neither has a sanitiser to ` +
        `keep current because neither produces HTML. If a renderer that emits HTML ever becomes ` +
        `the right answer, the sanitiser, its allow-list and its tests come first, and the ` +
        `reasoning goes in this comment.`,
    ).toEqual([]);
  });
});

describe("the scans find a planted fault", () => {
  it("🚨 a missing viewer() and a member id in the form both fail", () => {
    // The needle probe. Without it, a scanner that had stopped matching
    // anything would report both claims above as satisfied for ever.
    const noViewer = actions(
      blankComments(
        `export async function badAction(_prev: X, formData: FormData) {\n` +
          `  const slug = String(formData.get("unitSlug"));\n` +
          `  return { error: null, ok: null };\n}\n`,
      ),
    );
    expect(noViewer).toHaveLength(1);
    expect(noViewer[0].body).not.toMatch(/await\s+viewer\(\)/);

    const takesMember = actions(
      blankComments(
        `export async function badAction(_prev: X, formData: FormData) {\n` +
          `  await viewer();\n` +
          `  const who = String(formData.get("memberId"));\n  return who;\n}\n`,
      ),
    );
    expect(takesMember[0].body).toMatch(/get\(\s*["'`]memberId["'`]\s*\)/);
  });

  it("🚨 a planted markup call is seen", () => {
    // The same probe for claim 3, and the reason NEEDLE is assembled from
    // halves: a scan whose needle had gone stale would pass on a tree full of
    // violations. The planted line is built the same way, so this file still
    // does not contain the word.
    const planted = `  <div ${NEEDLE}={{ __html: submission.body }} />`;
    expect(planted.includes(NEEDLE)).toBe(true);
    expect(blankComments(planted).includes(NEEDLE)).toBe(true);
  });

  it("🚨 a comment can neither satisfy nor break a claim", () => {
    // What `blankComments()` is for, stated as a measurement: an action whose
    // guard exists only in prose must still fail, and a comment that NAMES the
    // forbidden call must not be reported as using it.
    const commented = actions(
      blankComments(
        `export async function badAction(_prev: X, formData: FormData) {\n` +
          `  // this one calls await viewer() somewhere, honestly\n  return null;\n}\n`,
      ),
    );
    expect(commented[0].body).not.toMatch(/await\s+viewer\(\)/);

    expect(blankComments(`// never reach for ${NEEDLE} here\n`).includes(NEEDLE)).toBe(false);
  });
});
