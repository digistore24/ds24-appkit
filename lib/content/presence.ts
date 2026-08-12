// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// 🚨 "Does this environment hold what it should?" — the contract, and the core's
// own answer to it.
//
// ── Why this is delegated rather than centralised ──────────────────────────
// `content-check` used to answer this from the core: it counted the appliers'
// rows and HEADed the declared media. That was the whole answer only while the
// core could see everything there was. The moment a MODULE owned rows — a
// community's rooms, a course's units — the command was answering a smaller
// question than the one it was named for, and answering it with a green tick.
//
// So the question is asked of whoever owns the rows. The core answers for what
// the core owns; a module answers for its own, by declaring `presence` in its
// manifest. The core aggregates and never inspects. It is the same delegation
// `smoke`, `privacy` and `cron` already use, and `modules/community/smoke.mjs`
// wrote the argument down first: an assertion about a module belongs to the
// module.
//
// ── The one rule that makes it worth having ────────────────────────────────
// **A contributor that cannot answer is a FAILURE, never a pass.** This command
// exists to catch an environment that is empty; if "nothing to report" and "I
// could not look" render the same, it has become the thing it was built to
// prevent.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONTENT_MEDIA_MANIFEST, PRODUCT_MEDIA_ITEM } from "@/lib/content-media/rules.mjs";

import { presenceProblems } from "./presence-rules.mjs";

/** What one owner reports about one environment. */
export interface PresenceReport {
  /** Who is answering — `core`, or a module id. */
  readonly owner: string;
  readonly items: readonly PresenceItem[];
  /**
   * Why this owner could not answer at all.
   *
   * Present means the report is a FAILURE regardless of `items`. A contributor
   * that threw, or that a module shipped without, lands here.
   */
  readonly unanswered?: string;
}

export interface PresenceItem {
  /** What it is, in words an operator recognises: "courses", "product media". */
  readonly what: string;
  /** How many are there. */
  readonly found: number;
  /**
   * How many there should be, when the owner can know.
   *
   * `null` where the number is not knowable from here — an operator's own
   * course catalogue has no expected count, and inventing one would turn a
   * legitimate empty into a false alarm. `found: 0` with `expected: null` is
   * still reported, because zero is exactly the state worth seeing.
   */
  readonly expected: number | null;
  /**
   * Names of what is missing, when the owner can name them.
   *
   * Identifiers, optionally followed by a parenthesised reason where one
   * identifier can be missing in more than one way — product media is missing
   * as a `media` row or as an object in the store, and the two are different
   * repairs. The reason rides along with the name rather than in a second
   * field, because `presenceProblems()` joins these into one sentence.
   */
  readonly missing?: readonly string[];
  /**
   * A word for a reader — **never a problem.**
   *
   * A legitimate state that needs a sentence: `found: 0, expected: null` is the
   * honest answer for an environment with no media manifest, and the number
   * alone does not say what was looked for or where. So the sentence rides
   * along, naming the file and the place.
   *
   * `presenceProblems()` deliberately does not read it, and adding it there
   * would be the over-correction this field exists to avoid: a note is how a
   * legitimate state explains itself, not a fourth way to fail. A contributor
   * may set one; nothing requires it.
   */
  readonly note?: string;
  /**
   * 🚨 **Part of this item's question was NOT ASKED, and why.**
   *
   * The third state, and it is neither of the other two. Product media is the
   * case it was built for: the `media` row is a database answer and the bytes
   * are a store answer, and a store that does not respond has said nothing at
   * all about the customer's content. Rendering that as a missing object would
   * turn every network hiccup into a false alarm about the product; rendering
   * it as a tick is the defect this field was added to close — a `✓` that
   * conceals a HEAD nobody sent.
   *
   * So, like `note`, `presenceProblems()` deliberately does not read it: it is
   * not a fourth way to fail. It is read where the answer is SHOWN —
   * `scripts/content/check.mjs` marks such an item `⏭` instead of `✓` and
   * prints the reason, and the command's closing sentence says how many things
   * were not checked. An owner may set one; nothing requires it.
   */
  readonly notChecked?: string;
}

/** What a contributor is handed. Deliberately nothing but the environment. */
export interface PresenceContext {
  readonly appEnv: string;
}

export interface PresenceContributor {
  readonly id: string;
  check(context: PresenceContext): Promise<PresenceReport>;
}

/**
 * Product media, from the manifest the repo carries — the ONE reader of it.
 *
 * 🚨 **Lifted out of `corePresence` so that it stays one reader**, not because
 * the function was too long. `content_publish`'s plan (Story 34.2) has to answer
 * the same question — what does the target's media store hold against what this
 * repo declares — and the obvious way to give it one is a second `existsSync` +
 * `JSON.parse` + `mediaPresence()` sequence beside this one. That is exactly the
 * fault `media-presence.ts` was repaired for: two readers of one file, and the
 * one nobody is looking at is the one that accepts a key no producer writes.
 *
 * Its three answers are the three states, and every caller inherits them:
 *
 *   no manifest at all            an item, `expected: null`, a note — legitimate
 *   a manifest declaring none     `0 of 0` — legitimate
 *   a manifest that cannot be read   a THROW — "I could not look", a failure
 */
export async function productMediaPresence(): Promise<PresenceItem> {
  // With the manifest here, the expected number is knowable (it names each
  // file), which is what makes a missing one nameable rather than merely a
  // smaller count. 🚨 Without it, the item used to be absent from the report
  // ENTIRELY: `presenceProblems()` was handed nothing to complain about and
  // `content-check` printed "every owner answered, nothing missing" for a
  // question nobody had asked. An environment that did not get the file, and
  // an app that genuinely declares no media, rendered the same — which is the
  // fault this file's own rule (top of the file) is written against.
  //
  // So the absence is now an ANSWER: `expected: null` — nothing here declares
  // an expected count — plus a note naming what was looked for and where. It
  // is a legitimate state, exit 0, and it stays distinguishable from a
  // manifest that declares nothing (`expected: 0`) and from one that cannot be
  // read at all (a throw, which `safely()` turns into `unanswered`).
  //
  // ⚠️ `process.cwd()` is deliberate and unchanged. `next start` runs from the
  // app root; a standalone build's generated `server.js` does
  // `process.chdir(__dirname)` (next 16.2.11,
  // `node_modules/next/dist/build/utils.js:1085`) and tracing copies matched
  // files in app-root-relative, so the join resolves in both. An
  // `import.meta.url`-derived root would be WORSE here — this file is bundled,
  // so it would point into `.next/server/chunks/…`. Whether the file is in the
  // image at all is a tracing question and belongs to `next.config.ts`.
  const manifestPath = join(process.cwd(), ...CONTENT_MEDIA_MANIFEST.split("/"));
  if (existsSync(manifestPath)) {
    const { mediaPresence } = await import("./media-presence");
    return mediaPresence(JSON.parse(readFileSync(manifestPath, "utf8")));
  }
  return {
    what: PRODUCT_MEDIA_ITEM,
    found: 0,
    expected: null,
    note: `no ${CONTENT_MEDIA_MANIFEST} here — this app declares no product media`,
  };
}

/**
 * The core's own answer: the media the repo declares, and the appliers' rows.
 *
 * These are the two things the core owns and can count. Everything else belongs
 * to a module and is asked of that module.
 */
export const corePresence: PresenceContributor = {
  id: "core",
  async check(): Promise<PresenceReport> {
    const items: PresenceItem[] = [await productMediaPresence()];

    // Applier rows. Each applier answers `present(sql)` for itself — that
    // function has been in the contract since `content-apply` shipped and kept
    // its purpose through the withdrawal of the old command precisely so this
    // could use it.
    const { applierPresence } = await import("./applier-presence");
    items.push(...(await applierPresence()));

    return { owner: "core", items };
  },
};

/**
 * Every owner's answer, aggregated — the core's, then each installed module's.
 *
 * ⚠️ A module that declares `presence` and whose file does not export `check`,
 * or whose check throws, gets a report with `unanswered` set. It is NOT skipped
 * and it is NOT counted as clean.
 */
export async function collectPresence(context: PresenceContext): Promise<PresenceReport[]> {
  const { MODULE_PRESENCE } = await import("@/lib/modules/presence-registry");
  const reports: PresenceReport[] = [await safely(corePresence, context)];
  for (const contributor of MODULE_PRESENCE) {
    reports.push(await safely(contributor, context));
  }
  return reports;
}

async function safely(
  contributor: PresenceContributor,
  context: PresenceContext,
): Promise<PresenceReport> {
  try {
    const report = await contributor.check(context);
    return report.owner === contributor.id ? report : { ...report, owner: contributor.id };
  } catch (error) {
    return {
      owner: contributor.id,
      items: [],
      unanswered: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Is the whole answer clean? — re-exported from where it is now computed.
 *
 * ⚠️ **The function moved to `./presence-rules.mjs`; this is a re-export rather
 * than a moved import in every caller.** The reason is one sentence: the OTHER
 * reader of this judgement is `node run.mjs content-check`
 * (`scripts/content/check.mjs`), which is bare Node with no bundler and cannot
 * import a `.ts` file — and the alternative was a second implementation of
 * "what counts as a problem" in the command, which is precisely the defect the
 * presence design exists to prevent. That file's header carries the argument,
 * and the three ways to fail, in full.
 *
 * The re-export is deliberate: `presence.test.ts`, `applier-presence.test.ts`
 * and `modules/courses/presence/check.test.ts` ask THIS module for it, and a
 * move that made those tests edit their import would have been a move that
 * changed something. It did not.
 */
export { presenceProblems };
