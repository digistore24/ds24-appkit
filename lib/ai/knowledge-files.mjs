// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Which files under `content/knowledge/` are part of the handbook.
//
// ── Why this is a `.mjs` and why it is next door ───────────────────────────
// `lib/ai/knowledge.ts` and `scripts/ai/kb-check.mjs` have to agree about
// exactly one thing: which files reach the model. They used to hold a
// byte-identical copy of this walk each, with a comment in the script saying it
// "mirrors knowledge.ts" — the same trap `knowledge.ts` names in its own header
// ("a format written down twice is a format that will disagree with itself")
// and the reason `frontmatter.mjs` exists. The parsing was shared; the walk was
// not, and the walk is the part that decides which documents exist at all.
//
// It carries its own stem rather than joining `frontmatter.mjs` because it
// touches `node:fs` and that file is pure — and because `knowledge.ts` sits
// beside it and is a different file, not a typed door onto this one
// ([`docs/conventions.md`](../../docs/conventions.md) → *A `.mjs` beside a
// `.ts`*).
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Past this, `kb-check` warns: the handbook is getting expensive to cache. */
export const KNOWLEDGE_WARN_CHARS = 120_000;

/**
 * Past this the handbook is no longer a prompt.
 *
 * It still fits the context window — that is not the limit being defended. The
 * limit is that beyond this size the full-context approach stops being the
 * cheap option, and the honest answer is to swap the retriever rather than to
 * keep paying to cache a book.
 */
export const KNOWLEDGE_MAX_CHARS = 800_000;

/**
 * Below this, the cached prefix stops being one.
 *
 * Providers do not cache a prefix under a minimum request size, and none of
 * them says so: 512 tokens on the newest models, 1,024 on this template's
 * default, up to 4,096 on others. Nothing is charged extra when you fall under
 * it — no cache is written and no write premium is paid — the request is simply
 * billed as ordinary input, on every single message, for ever. The discount
 * this whole approach exists for is silently absent.
 *
 * The number is the worst case across the five providers (~4,096 tokens), so
 * the warning is never wrong in the direction that costs money. It is a
 * warning and never a refusal: a small handbook still answers, it just does
 * not answer cheaply.
 */
export const KNOWLEDGE_MIN_CHARS = 16_000;

/**
 * Every `.md` below `dir`, as paths relative to it, with forward slashes.
 *
 * Returns problems as well as paths. A directory that cannot be read used to
 * return `[]` from both copies of this function, which made "unreadable" and
 * "empty" the same answer — the documents vanished and nothing said so.
 */
export function markdownFilesIn(dir, prefix = "") {
  const found = [];
  const problems = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    problems.push({
      path: prefix,
      problem: `directory cannot be read: ${String(error)}`,
    });
    return { found, problems };
  }

  for (const entry of entries) {
    // Dotfiles and `_drafts` are skipped, so an operator has somewhere to put a
    // file that is not ready to be answered from.
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      const below = markdownFilesIn(join(dir, entry.name), relative);
      found.push(...below.found);
      problems.push(...below.problems);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      found.push(relative);
    }
  }

  return { found, problems };
}

/**
 * The size that actually lands in the prompt.
 *
 * Bodies alone under-report by roughly a quarter — measured at 6,888 against a
 * rendered 8,482 on the six shipped documents. Every document also carries a
 * line in the table of contents and an XML fence around it, and both are sent
 * on every question. The budgets above are about what is billed, so they have
 * to measure what is billed.
 */
export function renderedChars(docs) {
  return docs.reduce(
    (sum, doc) =>
      sum +
      doc.body.length +
      doc.title.length +
      doc.summary.length +
      doc.path.length +
      // The fence, the contents line and their punctuation. A constant rather
      // than a second copy of the renderer: this is a budget, not an invoice.
      80,
    0,
  );
}
