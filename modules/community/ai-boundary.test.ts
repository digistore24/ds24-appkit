// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// FR-217: **community content feeds no AI by default.** The module registers
// no content source, so the four standard chat tools see nothing of what
// members wrote — and that is a decision rather than a gap.
//
// It matters more here than anywhere else the doctrine applies. What a chat
// tool returns is sent to the AI provider as part of the prompt, and the
// community is this template's largest personal-data surface: its content is
// members writing about themselves and about each other. A source registered
// by accident — or by a well-meaning "the assistant should know what is going
// on in the rooms" — is a disclosure to a third party that nobody decided and
// nobody can take back. An invariant in this template is a structural test,
// not a sentence in a guide; this file is that test.
//
// ── What it forbids, in both directions ────────────────────────────────────
//   1. a file under the community module referencing the content-source layer
//      or naming one of the four `content_*` tools, and
//   2. a file under the content-source layer referencing the community module
//      or naming one of its tables.
//
// Two directions rather than one because the coupling can be written from
// either end, and the second is the likelier accident: a source is where
// somebody adds "…and posts", and it is the file furthest from the invariant.
//
// ── What it deliberately does NOT forbid ───────────────────────────────────
// The recipe in docs/community.md exists precisely so an app CAN register a
// source over public group content. That is a legitimate, recorded decision —
// and its last step is an entry in the ALLOWLIST below, naming the
// `docs/app.md` decision that authorised it. So this test does not prevent the
// opt-in; it turns "a recorded decision" into a BUILD-VISIBLE one. The
// allowlist, empty at introduction, is the only exemption mechanism, so every
// future exemption is a reviewed decision with its reason beside it.
//
// ── Scan scope is deliberate — do not widen it ─────────────────────────────
// Only the two `lib/` domains. NOT `docs/` or `.claude/skills/`: the recipe
// legitimately spells both strings out there, and a doc-scanning version would
// flag its own guidance. NOT `app/`: the community pages neither import the
// content-source layer nor should this test claim jurisdiction over them — the
// tool path is `lib/ai/run-tool.ts` → the registry, and the registry side is
// what is covered here.
//
// Needles are built from halves, as in `knowledge-boundary.test.ts`: a literal
// would make this file its own first finding the moment somebody widens the
// scan.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "..");

// Split so this file does not match its own needles — the tree moved with the
// module, the halves are only spelled differently.
const COMMUNITY_DIR = "modules/" + "community";
const SOURCE_DIR = "lib/" + "content-source";

/**
 * What a file inside the community module may not name.
 *
 * 🚨 **`contentSource` is here because the hyphenated needle did not catch the
 * thing this test exists to catch.** Until Story 8.3 a source could only be
 * registered by editing `lib/content-source/sources.ts`, so a file NAMING that
 * directory was the whole coupling. Since then a module registers one by
 * writing a single line into its own manifest — `"contentSource": "…"` — and
 * `modules/community/module.json` is a file inside the scanned tree that the
 * hyphenated needle reads straight past. The invariant would have been open by
 * one word, in the file where somebody adding the feature would type it.
 *
 * The manifest key is not spelled with a hyphen anywhere, so this is not a
 * duplicate of the entry above: they catch two different ways in.
 */
const AI_NEEDLES = [
  "content-" + "source",
  "content" + "Source",
  "content" + "_search",
  "content" + "_get",
  "content" + "_list",
  "content" + "_media",
];

/** What a file inside the content-source layer may not name. */
const COMMUNITY_NEEDLES = ["modules/" + "community", "commun" + "ity_"];

/**
 * Repo-relative file paths allowed to carry one of the needles, each with its
 * reason as a comment beside it.
 *
 * **An app that opts in adds its entry HERE**, naming the dated `docs/app.md`
 * decision that authorised sending member-written content to an AI provider.
 * Empty at introduction, and an entry is a reviewed decision rather than a way
 * to get to green.
 */
const ALLOWLIST: string[] = [
  // 🚨 This file itself, and it is not a loophole — it is the consequence of the
  // move. While the community lived in `lib/`, this guard sat in `scripts/` and
  // was outside both trees it scans. It now lives INSIDE one of them, and its
  // own prose has to name what it forbids in order to explain it.
  //
  // Not solved with the split-string trick the needles use, deliberately: the
  // needles are matched, the PROSE is what a reader needs whole. An entry with
  // its reason is the honest form, and `holds for a needle really planted`
  // below is what keeps the entry from hiding a real finding.
  "modules/community/ai-boundary.test.ts",
];

/** Only genuinely binary files are skipped — the same set portability.test.ts skips. */
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?|pdf|zip)$/i;

function filesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, found);
    else if (!BINARY.test(entry)) found.push(full);
  }
  return found;
}

function scan(dir: string, needles: string[]): string[] {
  const findings: string[] = [];

  for (const file of filesUnder(path.join(ROOT, dir))) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
    if (ALLOWLIST.includes(relative)) continue;

    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        for (const needle of needles) {
          if (line.includes(needle)) {
            findings.push(
              `${relative}:${index + 1} references ${needle} — community content feeds no AI by default (FR-217)`,
            );
          }
        }
      });
  }

  return findings;
}

describe("community content feeds no AI by default (FR-217)", () => {
  it("no file in the community module reaches into the content-source layer", () => {
    expect(scan(COMMUNITY_DIR, AI_NEEDLES)).toEqual([]);
  });

  it("no file in the content-source layer reaches into the community module", () => {
    expect(scan(SOURCE_DIR, COMMUNITY_NEEDLES)).toEqual([]);
  });

  it("🚨 nor does the generated registry that now stands between them", () => {
    // ── The second direction had moved and the test had not ────────────────
    // `lib/content-source/` was the whole of the far side while `sources.ts`
    // was a hand-edited array. Since Story 8.3 a module's source arrives
    // through `lib/modules/content-source-registry.ts` — GENERATED from the
    // manifests, checked in, and outside every directory this file scanned. So
    // the direction the header calls "the likelier accident" was being asked
    // about a file that no longer carries the coupling.
    //
    // Scanned rather than reasoned about: the registry is regenerated by
    // `module sync`, so what it contains is a consequence of a manifest, and a
    // consequence is exactly the kind of thing that changes without anybody
    // editing the file it appears in.
    //
    // ⚠️ The FILE, not its directory. `lib/modules/` also holds
    // `installed.test.ts`, which names the community as its worked example and
    // is right to — widening the scan to the folder would make this invariant
    // fire on a file that has nothing to do with it, and an invariant that
    // cries wolf is one somebody switches off.
    const registry = readFileSync(
      path.join(ROOT, "lib/" + "modules", "content-source-registry.ts"),
      "utf8",
    );
    for (const needle of COMMUNITY_NEEDLES) {
      expect(
        registry.includes(needle),
        `the generated content-source registry names ${needle} — a community source was ` +
          `registered through a manifest, which is the opt-in this invariant requires to be ` +
          `a recorded decision rather than an edit nobody reviewed`,
      ).toBe(false);
    }
  });

  it("🚨 a community manifest that registered a source would be a finding", () => {
    // The needle probe for the needle that was missing. Without it, adding
    // `contentSource` to AI_NEEDLES is a change nobody has watched work — and
    // this test's whole subject is an invariant that was green while open.
    const planted = [
      '  "tables": true,',
      '  "contentSource": "ai/rooms.ts",',
      '  "presence": "presence/check.ts"',
    ].join("\n");
    const caught = AI_NEEDLES.filter((needle) => planted.includes(needle));
    expect(
      caught,
      "a manifest key registering a community content source slipped past every needle",
    ).toEqual(["content" + "Source"]);

    // …and the real manifest does not carry one today.
    const manifest = readFileSync(
      path.join(ROOT, COMMUNITY_DIR, "module.json"),
      "utf8",
    );
    expect(manifest).not.toContain("content" + "Source");
  });
});
