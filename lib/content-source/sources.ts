// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The registry of this app's content sources.
//
// A second source is a second registry entry, exactly as a second companion is
// a second entry in modules/companion/companions.ts — never a second tool set and
// never a second search implementation. Everything that reads app content for
// an AI (the four `content_*` tools the chat's model calls) walks THIS list.
// The full guide, including the visibility duties, is docs/content-source.md.
//
// ── There are TWO ways onto this list ───────────────────────────────────────
//
//   1. **An entry here.** The app's own content: a table it wrote, a set of
//      constants, anything `app/` and `lib/` own. Add the source's file beside
//      this one and put it in the array below.
//   2. **`"contentSource": "content-source.ts"` in a MODULE's manifest.** A
//      module owns its rows, so it owns the question of what may be searched
//      in them and by whom; `node run.mjs module sync` folds it into
//      `lib/modules/content-source-registry.ts` and it arrives below. The
//      core never names a module — see docs/modules.md.
//
// `modules/courses/content-source.ts` is the worked example, and it is real
// code rather than a comment: the gate, the drip filter, the media rule and
// the anchors are all in it. Read it before writing one of your own.
//
// ── FIVE things ship in that same commit, or the link is worse than none ────
//
//   1. the ROUTE exists and renders at exactly the path `url` emits
//   2. the SOURCE emits it from the same unique slug — one place composes it
//   3. the ANCHOR agrees: slugifyAnchor()/mediaAnchor() here, `id={anchor}`
//      plus `className="scroll-mt-20"` on the page
//   4. the GATE is one function, called from the source AND the page
//   5. app/route-protection.test.ts is answered, not routed around
//
// Miss any of 1–4 and the honest answer is `url: null`: she names the lesson
// in prose and the member is not sent anywhere. A dead link is the one outcome
// worse than no link. docs/content-source.md → "The five things that make a
// link work" is the long form.
import { MODULE_CONTENT_SOURCES } from "@/lib/modules/content-source-registry";
import { knowledgeSource } from "./knowledge-source";
import type { ContentSource } from "./types";

/**
 * Every content source this app answers AI agents from. Order is answer
 * order when hits score equally. Frozen so nothing can push a source onto it
 * at runtime — the same guarantee `lib/ai/tools.ts` makes for its registry.
 *
 * The handbook first, then the modules in installation order: the handbook is
 * the one source every app has, and a member's question about "the app" is
 * more often about the product than about one lesson in it.
 */
export const CONTENT_SOURCES: readonly ContentSource[] = Object.freeze([
  knowledgeSource,
  ...MODULE_CONTENT_SOURCES,
]);

export function contentSourceById(id: string): ContentSource | undefined {
  return CONTENT_SOURCES.find((source) => source.id === id);
}
