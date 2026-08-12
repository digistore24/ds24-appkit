// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The content source every app ships with: the assistant's handbook.
//
// It exists so the standard content tools answer something on day one — a
// registry that ships empty would hand every fresh app a connector with dead
// tools and no on-disk example of the pattern. The handbook is real,
// same-for-all content that already exists wherever the chat is switched on.
//
// Two honest properties, both deliberate:
//
// - **`url` is null on every hit.** The handbook has no served page — it
//   travels as the chat's cached prompt, and `content/knowledge/` is not
//   routed anywhere. A fabricated link would scroll nothing. The tool text
//   tells the model what a null url means: use the returned text directly.
// - **The viewer is ignored.** One handbook for every signed-in member — there
//   is nothing to scope. The signature still carries the viewer, because the
//   interface does and a source that drops it silently is the wrong example
//   to copy.
//
// Cache discipline is inherited, not reimplemented: every call reads
// `loadKnowledge()` (memoized in production, re-read otherwise, absence never
// cached) — the same deal `allowedMediaMarkers()` makes, and for the same
// reason: a second cache is a second thing that can disagree.
import { loadKnowledge, type KnowledgeBase, type KnowledgeDoc } from "@/lib/ai/knowledge";
import {
  KNOWLEDGE_MEDIA_TYPES,
  MEDIA_MARKER_PATTERN,
  markersIn,
} from "@/lib/knowledge-media/rules.mjs";
import { headingSections } from "./anchors";
import { rankRecords, searchTerms, snippetFor, type SearchableRecord } from "./rules";
import type {
  ContentDocument,
  ContentHit,
  ContentSource,
  ContentTocEntry,
  ContentViewer,
} from "./types";

export const HANDBOOK_SOURCE_ID = "handbook";

/** `<path>` for a whole doc, `<path>#<anchor>` for one of its sections. */
function splitRef(ref: string): { path: string; anchor: string | null } {
  const hash = ref.indexOf("#");
  if (hash === -1) return { path: ref, anchor: null };
  return { path: ref.slice(0, hash), anchor: ref.slice(hash + 1) };
}

interface HandbookRecord extends SearchableRecord {
  doc: KnowledgeDoc;
  kind: "page" | "section";
}

function recordsFrom(base: KnowledgeBase): HandbookRecord[] {
  const records: HandbookRecord[] = [];
  for (const doc of base.docs) {
    records.push({ ref: doc.path, title: doc.title, body: doc.body, doc, kind: "page" });
    for (const section of headingSections(doc.body)) {
      records.push({
        ref: `${doc.path}#${section.anchor}`,
        title: `${doc.title} — ${section.title}`,
        body: section.body,
        doc,
        kind: "section",
      });
    }
  }
  return records;
}

const MARKER_RE = new RegExp(MEDIA_MARKER_PATTERN);

/** A marker string, taken apart. The pattern guarantees both groups. */
function parseMarker(marker: string): { path: string; label: string } | null {
  const match = MARKER_RE.exec(marker);
  if (!match) return null;
  return { path: match[1], label: match[2] };
}

function mediaKindOf(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  const entry = (KNOWLEDGE_MEDIA_TYPES as Record<string, { kind: string }>)[extension];
  return entry?.kind ?? "file";
}

function mediaOf(doc: KnowledgeDoc): ContentDocument["media"] {
  const media: ContentDocument["media"] = [];
  for (const marker of markersIn(doc.body)) {
    const parsed = parseMarker(marker);
    if (!parsed) continue;
    media.push({
      path: parsed.path,
      kind: mediaKindOf(parsed.path),
      alt: parsed.label,
      // No served page, so no page anchor — see the header.
      anchor: null,
    });
  }
  return media;
}

/**
 * The source over any handbook loader — the test seam. Production uses
 * `knowledgeSource` below; tests hand in `() => readKnowledgeFrom(fixtureDir)`.
 */
export function handbookSourceFor(load: () => KnowledgeBase): ContentSource {
  return {
    id: HANDBOOK_SOURCE_ID,
    label: "the app's own handbook — how the product works, for its members",

    async search(query, _viewer: ContentViewer, limit) {
      const terms = searchTerms(query);
      const records = recordsFrom(load());
      return rankRecords(records, query, limit).map((record) => {
        const handbook = record as HandbookRecord;
        return {
          sourceId: HANDBOOK_SOURCE_ID,
          ref: handbook.ref,
          kind: handbook.kind,
          title: handbook.title,
          snippet: snippetFor(handbook.body, terms),
          url: null,
          anchor: null,
        };
      });
    },

    async get(ref, _viewer: ContentViewer) {
      const { path, anchor } = splitRef(ref);
      const doc = load().docs.find((candidate) => candidate.path === path);
      if (!doc) return null;

      if (anchor === null) {
        return {
          sourceId: HANDBOOK_SOURCE_ID,
          ref: doc.path,
          title: doc.title,
          url: null,
          body: doc.body,
          sections: headingSections(doc.body).map(({ anchor: a, title }) => ({
            anchor: a,
            title,
          })),
          media: mediaOf(doc),
        };
      }

      const section = headingSections(doc.body).find((s) => s.anchor === anchor);
      if (!section) return null;
      return {
        sourceId: HANDBOOK_SOURCE_ID,
        ref,
        title: `${doc.title} — ${section.title}`,
        url: null,
        body: section.body,
        sections: [],
        media: mediaOf({ ...doc, body: section.body }),
      };
    },

    async list(_viewer: ContentViewer): Promise<ContentTocEntry[]> {
      return load().docs.map((doc) => ({
        sourceId: HANDBOOK_SOURCE_ID,
        ref: doc.path,
        title: doc.title,
        summary: doc.summary,
        url: null,
      }));
    },

    async findMedia(query, _viewer: ContentViewer, limit): Promise<ContentHit[]> {
      const terms = searchTerms(query);
      const hits: ContentHit[] = [];
      const seen = new Set<string>();
      for (const doc of load().docs) {
        for (const entry of mediaOf(doc)) {
          if (seen.has(entry.path)) continue;
          // No query lists everything; a query matches label or path.
          const haystack = `${entry.alt ?? ""} ${entry.path}`.toLowerCase();
          if (terms.length > 0 && !terms.some((term) => haystack.includes(term)))
            continue;
          seen.add(entry.path);
          hits.push({
            sourceId: HANDBOOK_SOURCE_ID,
            ref: doc.path,
            kind: "media",
            title: entry.alt ?? entry.path,
            snippet: `${entry.kind} in "${doc.title}"`,
            url: null,
            anchor: null,
            media: { path: entry.path, kind: entry.kind, alt: entry.alt },
          });
          if (hits.length >= limit) return hits;
        }
      }
      return hits;
    },
  };
}

/** The handbook of this installation, as a content source. */
export const knowledgeSource: ContentSource = handbookSourceFor(loadKnowledge);
