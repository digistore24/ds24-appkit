// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Querying ACROSS the registry — the thin shell the content tools stand on.
//
// One source failing (a table missing in dev, a store not answering) must not
// take every other source's answer down with it: a search that throws where it
// could return partial results turns one broken registry entry into a dead
// tool. So each source is queried guarded; what a failed source costs is a
// log line, never the request.
import { rankRecords } from "./rules";
import { CONTENT_SOURCES, contentSourceById } from "./sources";
import type { ContentDocument, ContentHit, ContentTocEntry, ContentViewer } from "./types";

async function guarded<T>(sourceId: string, work: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.error(`[content-source] source=${sourceId} failed: ${String(error)}`);
    return empty;
  }
}

/**
 * Search every registered source and merge, best first.
 *
 * Sources rank internally with the shared arithmetic from rules.ts, so a
 * cross-source merge on the re-computed score is comparing like with like.
 */
export async function searchAllSources(
  query: string,
  viewer: ContentViewer,
  limit: number,
): Promise<ContentHit[]> {
  const perSource = await Promise.all(
    CONTENT_SOURCES.map((source) =>
      guarded(source.id, () => source.search(query, viewer, limit), [] as ContentHit[]),
    ),
  );
  const merged = perSource.flat();
  // Re-rank the merged list on the same arithmetic the sources used; the
  // snippet stands in for the body — it is what the term windows landed on.
  const ranked = rankRecords(
    merged.map((hit, index) => ({
      ref: String(index),
      title: hit.title,
      body: hit.snippet,
    })),
    query,
    limit,
  );
  return ranked.map((record) => merged[Number(record.ref)]);
}

export async function getFromSource(
  sourceId: string,
  ref: string,
  viewer: ContentViewer,
): Promise<ContentDocument | null | "unknownSource"> {
  const source = contentSourceById(sourceId);
  if (!source) return "unknownSource";
  return guarded(sourceId, () => source.get(ref, viewer), null);
}

export interface SourceToc {
  sourceId: string;
  label: string;
  entries: ContentTocEntry[];
}

/** Every source's table of contents; sources without `list()` are skipped. */
export async function listSources(
  viewer: ContentViewer,
  onlySourceId?: string,
): Promise<SourceToc[]> {
  const sources = onlySourceId
    ? CONTENT_SOURCES.filter((source) => source.id === onlySourceId)
    : CONTENT_SOURCES;
  const tocs: SourceToc[] = [];
  for (const source of sources) {
    if (!source.list) continue;
    const entries = await guarded(source.id, () => source.list!(viewer), []);
    tocs.push({ sourceId: source.id, label: source.label, entries });
  }
  return tocs;
}

/** Media across every source that can answer; merged in registry order. */
export async function findMediaAcrossSources(
  query: string,
  viewer: ContentViewer,
  limit: number,
): Promise<ContentHit[]> {
  const hits: ContentHit[] = [];
  for (const source of CONTENT_SOURCES) {
    if (!source.findMedia) continue;
    const found = await guarded(
      source.id,
      () => source.findMedia!(query, viewer, limit - hits.length),
      [],
    );
    hits.push(...found);
    if (hits.length >= limit) break;
  }
  return hits;
}
