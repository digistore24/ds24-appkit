// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// How the handbook reaches the model — and the seam to change it later.
//
// The default hands over the WHOLE handbook, marked cacheable, on every
// question. That is the right answer for a SaaS handbook and it is not a
// placeholder: it cannot retrieve the wrong paragraph, it needs no embedding
// job, no chunking and no migration, and the cached prefix makes it cheap from
// the second message on.
//
// ── What changes when it stops fitting ─────────────────────────────────────
// Only this file. A retriever that looks its documents up per question returns
// blocks marked `cacheable: false`, and `lib/ai/prompt.ts` then puts the cache
// breakpoint after the persona instead of after the handbook. The persona stays
// cached, the looked-up part does not, and nothing else in the app notices —
// the route, the UI and the storage never see a document.
//
// That is the whole reason this interface exists rather than `prompt.ts`
// reading `loadKnowledge()` directly. `docs/ai-chat.md` describes when the swap
// is worth making, and what it costs.
import { loadKnowledge, type KnowledgeBase, type KnowledgeDoc } from "./knowledge";

/**
 * A piece of the system prompt. Order is meaningful.
 *
 * ⚠️ Re-exported, not re-declared. This file used to carry its own copy with
 * `cacheable` REQUIRED where the layer's contract has it optional, which made
 * the two assignable in one direction only: a block written to the shipped
 * contract was a type error in `buildSystemBlocks`, so the second task this
 * layer exists for could not reuse the helpers `CLAUDE.md` tells it to
 * use. Every other duplication down here is pinned by a test — `TASKS` against
 * `task-rules.mjs`, `KNOWLEDGE_SECTIONS` against `frontmatter.mjs` — and this
 * one was not. One declaration needs no test.
 *
 * `cacheable` is true only for text that is byte-identical on every request
 * from every user of this installation. Anything that depends on the question,
 * the person or the clock is false — putting it in the prefix does not break
 * the answer, it silently stops the cache from ever hitting.
 */
export type { PromptBlock } from "./providers/types";
import type { PromptBlock } from "./providers/types";

export interface KnowledgeRetriever {
  /** For the log line, so an operator can see which one answered. */
  readonly kind: string;
  blocks(question: string): Promise<PromptBlock[]>;
}

/**
 * The table of contents.
 *
 * Sent ahead of the documents because it is what the model reads to decide
 * *which* document answers the question — the summaries earn their place here.
 * With the full handbook present this is a navigation aid; with a retrieving
 * implementation it becomes the map of what exists but was not fetched.
 */
export function renderContents(docs: readonly KnowledgeDoc[]): string {
  const lines = docs.map(
    (doc) => `- (${doc.section}) ${doc.title} — ${doc.summary} [${doc.path}]`,
  );
  return ["## What the handbook covers", ...lines].join("\n");
}

/**
 * The documents themselves, fenced so the model can tell one from the next.
 *
 * The titles and paths in the fences are for HER, never for the customer: the
 * persona forbids naming any of them in an answer, because `content/knowledge/`
 * is not served anywhere and a customer sent to a document by name has been
 * sent to a door that does not exist.
 *
 * The fences are deliberately XML-ish rather than Markdown headings: the bodies
 * are Markdown and carry headings of their own, and a `##` boundary would be
 * indistinguishable from a section inside a document.
 */
export function renderDocuments(docs: readonly KnowledgeDoc[]): string {
  return docs
    .map(
      (doc) =>
        `<document path="${attribute(doc.path)}" section="${attribute(doc.section)}" title="${attribute(doc.title)}">\n${fenced(doc.body)}\n</document>`,
    )
    .join("\n\n");
}

/**
 * A value that cannot break out of the attribute it sits in.
 *
 * `frontmatter.mjs` checks a title for emptiness and a 120-character limit and
 * nothing else — a quote in it is legal, and it used to end the attribute early.
 */
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/**
 * A body that cannot close its own fence.
 *
 * A container the contained text can close is not a container. A document
 * carrying the literal `</document>` — a how-to about HTML, or a page
 * documenting this very handbook format, both of which the
 * `ai-chat-knowledge` skill will happily write — ended the quoted region early,
 * and everything after it read to the model as top-level system prompt rather
 * than as somebody's handbook. A zero-width space breaks the tag for the parser
 * while leaving the text readable to the model.
 */
function fenced(body: string): string {
  // The closing bracket is escaped rather than separated by a zero-width space.
  // Both stop the fence closing; only one of them is visible to the next person
  // reading this file. An invisible character in source is the trap
  // `hasControlChar` in rules.ts is written as a loop to avoid, and it would be
  // odd to add one here to fix an escaping bug.
  return body.replaceAll("</document>", "&lt;/document>");
}

/** The rendered handbook, keyed by the documents it was built from. */
let rendered: { docs: readonly KnowledgeDoc[]; text: string } | null = null;

/** The whole handbook, in one cacheable block. */
export function fullContextRetriever(
  docs: readonly KnowledgeDoc[],
): KnowledgeRetriever {
  // Memoized on the identity of the docs array, because the text is
  // byte-identical by design — that is the entire premise of this file. Without
  // it the whole handbook was re-rendered on every question: `renderContents`,
  // `renderDocuments` and a `join` over as much as KNOWLEDGE_MAX_CHARS, which
  // is 800,000 characters of string building on the event loop before a single
  // token goes out. `loadKnowledge()` already memoizes the parsed documents in
  // production, so the identity check hits; elsewhere it re-renders, which is
  // what somebody editing the handbook wants.
  if (rendered === null || rendered.docs !== docs) {
    rendered = {
      docs,
      text: [
        "# The handbook",
        "",
        renderContents(docs),
        "",
        "## The documents",
        "",
        renderDocuments(docs),
      ].join("\n"),
    };
  }
  const text = rendered.text;

  return {
    kind: "full-context",
    // Not async in any real sense — the interface is async because the
    // implementations that replace it will be, and a synchronous seam would
    // have to be widened by every caller on the day it changes.
    blocks: async () => [{ text, cacheable: true }],
  };
}

/**
 * The retriever this installation uses.
 *
 * Takes the handbook rather than fetching it, so the caller that already
 * checked it is the caller that hands it over. `app/api/chat/route.ts` loads it
 * to decide whether there is anything to answer from at all; this used to read
 * it a SECOND time, and outside production the two reads are independent — so
 * the check could pass and the prompt still go out with no documents in it,
 * billed in full.
 */
export function retriever(base: KnowledgeBase = loadKnowledge()): KnowledgeRetriever {
  return fullContextRetriever(base.docs);
}
